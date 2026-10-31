import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, count, desc, eq, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { brandLocations, brands, integrationConnections, orders } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { decryptJson, encryptJson, randomToken } from '../../common/crypto';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { integrationActor } from '../../common/actor';
import { brandScope, isStaff, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { config } from '../../config';
import { ORDER_INTAKE, type CreateOrderInput, type OrderIntake } from '../orders/orders.contract';
import { NotificationsService } from '../notifications/notifications.service';
import { fetchWithTimeout, snippet } from '../notifications/providers/http';
import { validateWebhookUrl } from '../webhooks/url-guard';
import { isBrandOwner } from '../users/access';
import {
  MappingError, mapShopifyOrder, mapWooOrder, normalizeShopifyDomain, normalizeWooDomain, verifyBase64Hmac, withDefaultSettings,
  type ConnectorCredentials, type ConnectorSettings, type ShopifyOrder, type WooOrder,
} from './connectors';
import type { ConnectorProvider, CreateIntegrationDto, IntegrationSettingsDto, IntegrationsQueryDto, UpdateIntegrationDto } from './integrations.dto';

type ConnectionRow = typeof integrationConnections.$inferSelect;

export const SHOPIFY_API_VERSION = '2024-10';

export interface InboundResult {
  ok: boolean;
  action: 'created' | 'duplicate' | 'cancelled' | 'not_cancelled' | 'ignored' | 'rejected' | 'ping';
  trackingNumber?: string;
  reason?: string;
}

/**
 * E-commerce connectors (Shopify, WooCommerce): connection management,
 * signed inbound order webhooks → ORDER_INTAKE, and outbound fulfillment sync.
 * Credentials are stored encrypted (AES-256-GCM) and never returned.
 */
@Injectable()
export class IntegrationsService {
  private readonly log = new Logger('Integrations');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly moduleRef: ModuleRef,
    private readonly notifications: NotificationsService,
  ) {}

  /** Resolved lazily: the Orders module provides it (and tests override it). */
  private intake(): OrderIntake {
    try {
      return this.moduleRef.get<OrderIntake>(ORDER_INTAKE, { strict: false });
    } catch {
      throw new DomainError('ORDER_INTAKE_UNAVAILABLE', 'Order creation is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  // ------------------------------------------------------------- management

  async list(p: Principal, q: IntegrationsQueryDto) {
    const scope = brandScope(p);
    const conds: SQL[] = [];
    if (scope) conds.push(eq(integrationConnections.brandId, scope));
    else if (q.brandId) conds.push(eq(integrationConnections.brandId, q.brandId));
    if (q.provider) conds.push(eq(integrationConnections.provider, q.provider));
    if (q.status) conds.push(eq(integrationConnections.status, q.status));
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({ c: integrationConnections, brandName: brands.name })
        .from(integrationConnections)
        .innerJoin(brands, eq(brands.id, integrationConnections.brandId))
        .where(where)
        .orderBy(desc(integrationConnections.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(integrationConnections).where(where),
    ]);
    return paginate(rows.map((r) => ({ ...this.present(r.c, false), brandName: r.brandName })), Number(n), q);
  }

  async get(p: Principal, id: string) {
    const c = await this.load(p, id);
    return this.present(c, !isStaff(p) && isBrandOwner(p));
  }

  async create(brandId: string, dto: CreateIntegrationDto, actor: Principal, meta: RequestMetaInfo) {
    const shopDomain = await this.domain(dto.provider, dto.shopDomain);
    const settings = await this.settings(brandId, dto.settings, withDefaultSettings(null));
    const credentials = cleanCredentials(dto.credentials ?? {});
    const [existing] = await this.db
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(and(eq(integrationConnections.brandId, brandId), eq(integrationConnections.provider, dto.provider), eq(integrationConnections.shopDomain, shopDomain)))
      .limit(1);
    if (existing) throw new DomainError('INTEGRATION_EXISTS', 'This store is already connected', HttpStatus.CONFLICT);
    const [row] = await this.db
      .insert(integrationConnections)
      .values({
        brandId, provider: dto.provider, shopDomain, settings: settings as unknown as Record<string, unknown>,
        credentials: Object.keys(credentials).length ? encryptJson(credentials) : null, inboundSecret: `gtin_${randomToken(24)}`, status: 'ACTIVE',
      })
      .$returningId();
    await this.audit.record(actor, { action: 'integration.create', entity: 'IntegrationConnection', entityId: row.id, after: { provider: dto.provider, shopDomain, settings } }, meta);
    return this.present(await this.loadRaw(row.id), true);
  }

  async update(p: Principal, id: string, dto: UpdateIntegrationDto, meta: RequestMetaInfo) {
    const before = await this.load(p, id);
    const patch: Partial<typeof integrationConnections.$inferInsert> = {};
    if (dto.shopDomain !== undefined) patch.shopDomain = await this.domain(before.provider as ConnectorProvider, dto.shopDomain);
    if (dto.settings !== undefined) patch.settings = (await this.settings(before.brandId, dto.settings, withDefaultSettings(before.settings))) as unknown as Record<string, unknown>;
    if (dto.credentials !== undefined) {
      const merged = cleanCredentials({ ...this.credentials(before), ...dto.credentials });
      patch.credentials = Object.keys(merged).length ? encryptJson(merged) : null;
    }
    if (dto.status !== undefined) {
      patch.status = dto.status;
      if (dto.status === 'ACTIVE') patch.lastError = null;
    }
    if (Object.keys(patch).length) await this.db.update(integrationConnections).set(patch).where(eq(integrationConnections.id, id));
    await this.audit.record(p, { action: 'integration.update', entity: 'IntegrationConnection', entityId: id, before: this.present(before, false), after: { ...patch, credentials: dto.credentials ? '[updated]' : undefined } }, meta);
    return this.present(await this.loadRaw(id), isBrandOwner(p));
  }

  async remove(p: Principal, id: string, meta: RequestMetaInfo) {
    const before = await this.load(p, id);
    await this.db.delete(integrationConnections).where(eq(integrationConnections.id, id));
    await this.audit.record(p, { action: 'integration.delete', entity: 'IntegrationConnection', entityId: id, before: this.present(before, false) }, meta);
    return { deleted: true };
  }

  async rotateInboundSecret(p: Principal, id: string, meta: RequestMetaInfo) {
    await this.load(p, id);
    const inboundSecret = `gtin_${randomToken(24)}`;
    await this.db.update(integrationConnections).set({ inboundSecret }).where(eq(integrationConnections.id, id));
    await this.audit.record(p, { action: 'integration.rotate_secret', entity: 'IntegrationConnection', entityId: id }, meta);
    return { id, inboundSecret };
  }

  /** Calls the store API with the stored credentials. Updates status/lastError. */
  async test(p: Principal, id: string) {
    const c = await this.load(p, id);
    const creds = this.credentials(c);
    let result: { ok: boolean; message: string; details?: Record<string, unknown> };
    try {
      result = c.provider === 'SHOPIFY' ? await this.testShopify(c, creds) : await this.testWoo(c, creds);
    } catch (err) {
      result = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    await this.db
      .update(integrationConnections)
      .set(result.ok ? { lastError: null, ...(c.status === 'ERROR' ? { status: 'ACTIVE' as const } : {}) } : { lastError: result.message.slice(0, 1000), status: c.status === 'PAUSED' ? 'PAUSED' : 'ERROR' })
      .where(eq(integrationConnections.id, id));
    return result;
  }

  private async testShopify(c: ConnectionRow, creds: ConnectorCredentials) {
    if (!creds.accessToken) return { ok: false, message: 'Add the Shopify Admin API access token first' };
    const res = await fetchWithTimeout(`https://${c.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, { headers: { 'X-Shopify-Access-Token': creds.accessToken, Accept: 'application/json' } });
    if (!res.ok) return { ok: false, message: `Shopify answered ${res.status}: ${snippet(res.text, 200)}` };
    const shop = (res.json as { shop?: { name?: string; domain?: string; currency?: string } } | null)?.shop ?? {};
    const warning = shop.currency && shop.currency !== 'EGP' ? ` Store currency is ${shop.currency}; only EGP orders can be imported.` : '';
    return { ok: true, message: `Connected to ${shop.name ?? c.shopDomain}.${warning}`, details: { name: shop.name, domain: shop.domain, currency: shop.currency } };
  }

  private async testWoo(c: ConnectionRow, creds: ConnectorCredentials) {
    if (!creds.consumerKey || !creds.consumerSecret) return { ok: false, message: 'Add the WooCommerce consumer key and secret first' };
    const base = await validateWebhookUrl(`https://${c.shopDomain}`, { production: config.isProd });
    const res = await fetchWithTimeout(`${base.replace(/\/$/, '')}/wp-json/wc/v3/data/currencies/current`, {
      headers: { Authorization: `Basic ${Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64')}`, Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, message: `WooCommerce answered ${res.status}: ${snippet(res.text, 200)}` };
    const code = (res.json as { code?: string } | null)?.code;
    const warning = code && code !== 'EGP' ? ` Store currency is ${code}; only EGP orders can be imported.` : '';
    return { ok: true, message: `Connected to ${c.shopDomain}.${warning}`, details: { currency: code } };
  }

  // ------------------------------------------------------------- inbound

  async inboundShopify(connectionId: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined, body: unknown): Promise<InboundResult> {
    const c = await this.inboundConnection(connectionId, 'SHOPIFY');
    const creds = this.credentials(c);
    if (!verifyBase64Hmac(rawBody, header(headers, 'x-shopify-hmac-sha256'), [creds.webhookSecret, c.inboundSecret])) {
      throw new DomainError('INVALID_SIGNATURE', 'Webhook signature is invalid', HttpStatus.UNAUTHORIZED);
    }
    if (c.status === 'PAUSED') return { ok: true, action: 'ignored', reason: 'Connection is paused' };
    const topic = header(headers, 'x-shopify-topic') ?? '';
    const order = (body ?? {}) as ShopifyOrder;
    const settings = withDefaultSettings(c.settings);
    if (topic === 'orders/create') {
      if (!settings.autoCreate) return { ok: true, action: 'ignored', reason: 'Automatic order creation is off' };
      return this.importOrder(c, String(order.id ?? ''), () => mapShopifyOrder(order, { brandId: c.brandId, connectionId: c.id, shopDomain: c.shopDomain, settings }), order.name ?? null);
    }
    if (topic === 'orders/cancelled') return this.cancelOrder(c, String(order.id ?? ''), order.name ?? null);
    return { ok: true, action: 'ignored', reason: `Topic ${topic || '(none)'} is not handled` };
  }

  async inboundWoo(connectionId: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined, body: unknown): Promise<InboundResult> {
    const c = await this.inboundConnection(connectionId, 'WOOCOMMERCE');
    const signature = header(headers, 'x-wc-webhook-signature');
    // WooCommerce sends an unsigned form-encoded `webhook_id=…` ping when the webhook is saved.
    if (!signature && body && typeof body === 'object' && 'webhook_id' in body && !('id' in body)) return { ok: true, action: 'ping' };
    const creds = this.credentials(c);
    if (!verifyBase64Hmac(rawBody, signature, [creds.webhookSecret, c.inboundSecret])) {
      throw new DomainError('INVALID_SIGNATURE', 'Webhook signature is invalid', HttpStatus.UNAUTHORIZED);
    }
    if (c.status === 'PAUSED') return { ok: true, action: 'ignored', reason: 'Connection is paused' };
    const topic = header(headers, 'x-wc-webhook-topic') ?? '';
    const order = (body ?? {}) as WooOrder;
    const settings = withDefaultSettings(c.settings);
    const ref = order.number ? `#${order.number}` : null;
    if (order.status === 'cancelled' && (topic === 'order.updated' || topic === 'order.created')) return this.cancelOrder(c, String(order.id ?? ''), ref);
    if (topic === 'order.created' || (topic === 'order.updated' && ['processing', 'on-hold'].includes(order.status ?? ''))) {
      if (!settings.autoCreate) return { ok: true, action: 'ignored', reason: 'Automatic order creation is off' };
      if (['failed', 'pending', 'draft', 'checkout-draft', 'refunded'].includes(order.status ?? '') && order.payment_method !== 'cod') {
        return { ok: true, action: 'ignored', reason: `Order status ${order.status} is not ready to ship` };
      }
      return this.importOrder(c, String(order.id ?? ''), () => mapWooOrder(order, { brandId: c.brandId, connectionId: c.id, shopDomain: c.shopDomain, settings }), ref);
    }
    return { ok: true, action: 'ignored', reason: `Topic ${topic || '(none)'} is not handled` };
  }

  private async importOrder(c: ConnectionRow, externalId: string, map: () => CreateOrderInput, reference: string | null): Promise<InboundResult> {
    const existing = externalId ? await this.findImported(c.brandId, externalId, reference) : null;
    if (existing) return { ok: true, action: 'duplicate', trackingNumber: existing.trackingNumber };
    let input: CreateOrderInput;
    try {
      input = map();
    } catch (err) {
      if (err instanceof MappingError) return this.reject(c, reference ?? externalId, `${err.code}: ${err.message}`);
      throw err;
    }
    try {
      const created = await this.intake().create(input, integrationActor(c.brandId, c.provider));
      await this.db
        .update(integrationConnections)
        .set({ lastSyncAt: new Date(), lastError: null, ...(c.status === 'ERROR' ? { status: 'ACTIVE' as const } : {}) })
        .where(eq(integrationConnections.id, c.id));
      return { ok: true, action: 'created', trackingNumber: created.trackingNumber };
    } catch (err) {
      if (isDuplicateError(err)) {
        const dup = await this.findImported(c.brandId, externalId, input.brandReference ?? null);
        return { ok: true, action: 'duplicate', trackingNumber: dup?.trackingNumber };
      }
      // Business-rule refusals (brand not active, zone not served, validation) will not succeed on retry.
      if (err instanceof DomainError && err.status < 500) return this.reject(c, reference ?? externalId, `${err.code}: ${err.message}`);
      throw err;
    }
  }

  private async cancelOrder(c: ConnectionRow, externalId: string, reference: string | null): Promise<InboundResult> {
    if (!externalId) return { ok: true, action: 'ignored', reason: 'Order id is missing' };
    try {
      const cancelled = await this.intake().cancelByExternalId(c.brandId, externalId, integrationActor(c.brandId, c.provider), `Cancelled in ${c.provider === 'SHOPIFY' ? 'Shopify' : 'WooCommerce'}`);
      await this.db.update(integrationConnections).set({ lastSyncAt: new Date() }).where(eq(integrationConnections.id, c.id));
      return { ok: true, action: cancelled ? 'cancelled' : 'not_cancelled' };
    } catch (err) {
      if (err instanceof DomainError && err.status < 500) return this.reject(c, reference ?? externalId, `${err.code}: ${err.message}`, 'not_cancelled');
      throw err;
    }
  }

  /** Records a non-retryable problem on the connection and tells the brand; the store still gets a 200. */
  private async reject(c: ConnectionRow, reference: string, message: string, action: InboundResult['action'] = 'rejected'): Promise<InboundResult> {
    this.log.warn(`${c.provider} ${c.shopDomain} order ${reference}: ${message}`);
    await this.db.update(integrationConnections).set({ status: 'ERROR', lastError: `${reference}: ${message}`.slice(0, 1000) }).where(eq(integrationConnections.id, c.id));
    await this.notifications
      .notifyBrandOwners(c.brandId, 'integration_error', { provider: c.provider === 'SHOPIFY' ? 'Shopify' : 'WooCommerce', reference, shop: c.shopDomain, error: message.slice(0, 200) }, { data: { connectionId: c.id, link: '/brand/integrations' } })
      .catch(() => undefined);
    return { ok: false, action, reason: message };
  }

  private async findImported(brandId: string, externalId: string, reference: string | null) {
    const [row] = await this.db
      .select({ id: orders.id, trackingNumber: orders.trackingNumber })
      .from(orders)
      .where(and(eq(orders.brandId, brandId), reference ? or(eq(orders.externalId, externalId), eq(orders.brandReference, reference)) : eq(orders.externalId, externalId)))
      .limit(1);
    return row ?? null;
  }

  private async inboundConnection(id: string, provider: ConnectorProvider) {
    const [c] = await this.db.select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.provider, provider))).limit(1);
    if (!c) throw notFound('Integration', id);
    return c;
  }

  // ------------------------------------------------------------- outbound

  /**
   * Shopify fulfillment for a delivered order (fulfillment-orders API,
   * 2024-10). Never throws; failures are recorded on the connection.
   */
  async syncShopifyFulfillment(orderId: string): Promise<'skipped' | 'fulfilled' | 'failed'> {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o || o.source !== 'SHOPIFY' || !o.externalId) return 'skipped';
    const meta = (o.metadata?.integration ?? null) as { connectionId?: string } | null;
    const [c] = await this.db
      .select()
      .from(integrationConnections)
      .where(
        meta?.connectionId
          ? eq(integrationConnections.id, meta.connectionId)
          : and(eq(integrationConnections.brandId, o.brandId), eq(integrationConnections.provider, 'SHOPIFY')),
      )
      .limit(1);
    if (!c || c.brandId !== o.brandId || c.status === 'PAUSED') return 'skipped';
    const creds = this.credentials(c);
    if (!creds.accessToken) return 'skipped';
    const base = `https://${c.shopDomain}/admin/api/${SHOPIFY_API_VERSION}`;
    const headers = { 'X-Shopify-Access-Token': creds.accessToken, 'Content-Type': 'application/json', Accept: 'application/json' };
    try {
      const fo = await fetchWithTimeout(`${base}/orders/${encodeURIComponent(o.externalId)}/fulfillment_orders.json`, { headers });
      if (!fo.ok) throw new Error(`fulfillment_orders ${fo.status}: ${snippet(fo.text, 200)}`);
      const open = ((fo.json as { fulfillment_orders?: Array<{ id: number; status: string }> } | null)?.fulfillment_orders ?? []).filter((f) =>
        ['open', 'in_progress', 'scheduled'].includes(f.status),
      );
      if (!open.length) return 'skipped'; // already fulfilled in Shopify
      const res = await fetchWithTimeout(`${base}/fulfillments.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fulfillment: {
            line_items_by_fulfillment_order: open.map((f) => ({ fulfillment_order_id: f.id })),
            tracking_info: { company: 'GoTurtle', number: o.trackingNumber, url: `${config.appUrl}/t/${o.trackingNumber}` },
            notify_customer: false,
          },
        }),
      });
      if (!res.ok) throw new Error(`fulfillments ${res.status}: ${snippet(res.text, 200)}`);
      await this.db.update(integrationConnections).set({ lastSyncAt: new Date() }).where(eq(integrationConnections.id, c.id));
      return 'fulfilled';
    } catch (err) {
      const message = `Fulfillment for ${o.brandReference ?? o.trackingNumber} failed: ${err instanceof Error ? err.message : String(err)}`;
      this.log.warn(message);
      await this.db.update(integrationConnections).set({ status: 'ERROR', lastError: message.slice(0, 1000) }).where(eq(integrationConnections.id, c.id)).catch(() => undefined);
      return 'failed';
    }
  }

  // ------------------------------------------------------------- helpers

  private async load(p: Principal, id: string) {
    const scope = brandScope(p);
    const [c] = await this.db
      .select()
      .from(integrationConnections)
      .where(scope ? and(eq(integrationConnections.id, id), eq(integrationConnections.brandId, scope)) : eq(integrationConnections.id, id))
      .limit(1);
    if (!c) throw notFound('Integration', id);
    return c;
  }

  private async loadRaw(id: string) {
    const [c] = await this.db.select().from(integrationConnections).where(eq(integrationConnections.id, id)).limit(1);
    if (!c) throw notFound('Integration', id);
    return c;
  }

  private credentials(c: ConnectionRow): ConnectorCredentials {
    if (!c.credentials) return {};
    try {
      return decryptJson<ConnectorCredentials>(c.credentials);
    } catch {
      this.log.error(`credentials of integration ${c.id} cannot be decrypted (ENCRYPTION_KEY changed?)`);
      return {};
    }
  }

  private async domain(provider: ConnectorProvider, input: string) {
    if (provider === 'SHOPIFY') {
      const d = normalizeShopifyDomain(input);
      if (!d) throw new DomainError('INVALID_SHOP_DOMAIN', 'Use your store’s myshopify.com domain, e.g. my-store.myshopify.com', HttpStatus.BAD_REQUEST);
      return d;
    }
    const d = normalizeWooDomain(input);
    if (!d) throw new DomainError('INVALID_SHOP_DOMAIN', 'Enter the store address, e.g. shop.example.com', HttpStatus.BAD_REQUEST);
    if (config.isProd) {
      await validateWebhookUrl(`https://${d}`, { production: true }).catch(() => {
        throw new DomainError('INVALID_SHOP_DOMAIN', 'The store address must be a public host', HttpStatus.BAD_REQUEST);
      });
    }
    return d;
  }

  private async settings(brandId: string, dto: IntegrationSettingsDto | undefined, current: ConnectorSettings): Promise<ConnectorSettings> {
    const next: ConnectorSettings = { ...current };
    if (!dto) return next;
    if (dto.autoCreate !== undefined) next.autoCreate = dto.autoCreate;
    if (dto.defaultServiceLevel !== undefined) next.defaultServiceLevel = dto.defaultServiceLevel;
    if (dto.codGateways !== undefined) next.codGateways = dto.codGateways.map((g) => g.trim()).filter(Boolean);
    if (dto.defaultWeightGrams !== undefined) next.defaultWeightGrams = dto.defaultWeightGrams;
    if (dto.pickupLocationId !== undefined) {
      if (dto.pickupLocationId) {
        const [loc] = await this.db
          .select({ id: brandLocations.id, isActive: brandLocations.isActive })
          .from(brandLocations)
          .where(and(eq(brandLocations.id, dto.pickupLocationId), eq(brandLocations.brandId, brandId)))
          .limit(1);
        if (!loc || !loc.isActive) throw new DomainError('INVALID_LOCATION', 'Pickup location not found for this brand', HttpStatus.BAD_REQUEST);
      }
      next.pickupLocationId = dto.pickupLocationId;
    }
    return next;
  }

  /** Connection for the API: no credentials; inbound secret only for the brand owner. */
  private present(c: ConnectionRow, withSecret: boolean) {
    const creds = this.credentials(c);
    const slug = c.provider === 'SHOPIFY' ? 'shopify' : 'woocommerce';
    return {
      id: c.id,
      brandId: c.brandId,
      provider: c.provider,
      shopDomain: c.shopDomain,
      status: c.status,
      settings: withDefaultSettings(c.settings),
      credentialsSet: Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, !!v])),
      webhookUrl: `${config.appUrl}/api/v1/integrations/${slug}/${c.id}/orders`,
      inboundSecret: withSecret ? c.inboundSecret : undefined,
      lastSyncAt: c.lastSyncAt,
      lastError: c.lastError,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function cleanCredentials(c: ConnectorCredentials): ConnectorCredentials {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()])) as ConnectorCredentials;
}

function isDuplicateError(err: unknown): boolean {
  let cur = err as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.code === 'ER_DUP_ENTRY' || cur.code === 'DUPLICATE') return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}
