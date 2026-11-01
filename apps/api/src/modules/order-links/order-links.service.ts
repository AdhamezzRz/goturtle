import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { normalizeEgyptPhone, type PaymentMethod } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brands, orderLinks, orders, type OrderLinkItem } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { SequenceService } from '../../core/sequence.service';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { brandScope, principalUserId, type Principal } from '../../common/principal';
import type { ActorContext } from '../../common/actor';
import type { RequestMetaInfo } from '../../common/decorators';
import { likeEscape, withDeadlockRetry } from '../../db/helpers';
import { config } from '../../config';
import { NetworkService } from '../network/network.service';
import { PricingService } from '../pricing/pricing.service';
import { OrderFactoryService } from '../orders/order-factory.service';
import { ORDER_INTAKE, type CreateOrderInput, type OrderIntake } from '../orders/orders.contract';
import type { CreateOrderLinkDto, OrderLinksQueryDto, PublicDetectZoneDto, PublicOrderDto, UpdateOrderLinkDto } from './order-links.dto';

type LinkRow = typeof orderLinks.$inferSelect;

/** No 0/O, 1/I/L: codes are read aloud and typed from screenshots. */
export const LINK_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const LINK_CODE_LENGTH = 8;
const CODE_RE = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);

export function generateLinkCode(): string {
  let out = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i++) out += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  return out;
}

export const normalizeLinkCode = (raw: string) => String(raw ?? '').trim().toUpperCase();

export const itemsTotal = (items: OrderLinkItem[]) => items.reduce((s, i) => s + i.quantity * i.priceCents, 0);

export type Unavailable = 'INACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'BRAND_INACTIVE';

/** Why a link cannot take orders right now (null = open). */
export function unavailableReason(link: Pick<LinkRow, 'isActive' | 'expiresAt' | 'maxUses' | 'usesCount'>, brandStatus: string, now = new Date()): Unavailable | null {
  if (!link.isActive) return 'INACTIVE';
  if (brandStatus !== 'ACTIVE') return 'BRAND_INACTIVE';
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (link.maxUses != null && link.usesCount >= link.maxUses) return 'EXHAUSTED';
  return null;
}

const unavailable = (reason: Unavailable) =>
  new DomainError('ORDER_LINK_UNAVAILABLE', 'This order link is no longer accepting orders', HttpStatus.NOT_FOUND, { reason });

const cleanItems = (items: Array<{ name: string; quantity: number; priceCents: number }>): OrderLinkItem[] =>
  items.map((i) => ({ name: i.name.trim().slice(0, 120), quantity: i.quantity, priceCents: i.priceCents }));

/**
 * Order links for social-media sellers (Instagram / Facebook / WhatsApp): the
 * brand publishes a short link with the items and price, the buyer fills in
 * name, phone and address, and the order is created through ORDER_INTAKE
 * (source ORDER_LINK) already confirmed by the buyer.
 */
@Injectable()
export class OrderLinksService {
  private readonly log = new Logger('OrderLinks');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly network: NetworkService,
    private readonly pricing: PricingService,
    private readonly factory: OrderFactoryService,
    @Inject(ORDER_INTAKE) private readonly intake: OrderIntake,
  ) {}

  // ------------------------------------------------------------------ brand CRUD

  async list(p: Principal, q: OrderLinksQueryDto) {
    const scope = brandScope(p);
    const conds: Array<SQL | undefined> = [
      scope ? eq(orderLinks.brandId, scope) : q.brandId ? eq(orderLinks.brandId, q.brandId) : undefined,
      q.state === 'active' ? eq(orderLinks.isActive, true) : q.state === 'inactive' ? eq(orderLinks.isActive, false) : undefined,
      q.q ? or(like(orderLinks.title, `%${likeEscape(q.q)}%`), eq(orderLinks.code, normalizeLinkCode(q.q))) : undefined,
    ];
    const where = and(...conds);
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({ l: orderLinks, brandName: brands.name })
        .from(orderLinks)
        .innerJoin(brands, eq(brands.id, orderLinks.brandId))
        .where(where)
        .orderBy(desc(orderLinks.createdAt), desc(orderLinks.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(orderLinks).where(where),
    ]);
    const stats = await this.stats(rows.map((r) => r.l));
    return paginate(rows.map((r) => ({ ...this.present(r.l, stats.get(r.l.id)), brandName: r.brandName })), Number(n), q);
  }

  async get(p: Principal, id: string) {
    const link = await this.load(p, id);
    const stats = await this.stats([link]);
    return this.present(link, stats.get(link.id));
  }

  async create(p: Principal, brandId: string, dto: CreateOrderLinkDto, meta: RequestMetaInfo) {
    const items = cleanItems(dto.items);
    const paymentMethod: PaymentMethod = dto.paymentMethod ?? 'COD';
    const values = {
      brandId,
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      items,
      paymentMethod,
      codAmountCents: paymentMethod === 'COD' ? dto.codAmountCents ?? itemsTotal(items) : 0,
      serviceLevel: dto.serviceLevel ?? 'STANDARD',
      weightGrams: dto.weightGrams ?? 1000,
      allowOpening: dto.allowOpening ?? false,
      notes: dto.notes?.trim() || null,
      maxUses: dto.maxUses ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      isActive: dto.isActive ?? true,
      createdById: principalUserId(p),
    };
    this.assertSane(values);
    for (let attempt = 1; ; attempt++) {
      const code = generateLinkCode();
      try {
        const [row] = await this.db.insert(orderLinks).values({ ...values, code }).$returningId();
        await this.audit.record(p, { action: 'order_link.create', entity: 'OrderLink', entityId: row.id, after: { code, title: values.title, codAmountCents: values.codAmountCents } }, meta);
        return this.get(p, row.id);
      } catch (err) {
        // 31^8 ≈ 852 billion codes: a collision is astronomically rare, but never surface it.
        if (attempt < 5 && isDuplicate(err)) continue;
        throw err;
      }
    }
  }

  async update(p: Principal, id: string, dto: UpdateOrderLinkDto, meta: RequestMetaInfo) {
    const before = await this.load(p, id);
    const patch: Partial<typeof orderLinks.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.description !== undefined) patch.description = dto.description.trim() || null;
    if (dto.items !== undefined) patch.items = cleanItems(dto.items);
    if (dto.paymentMethod !== undefined) patch.paymentMethod = dto.paymentMethod;
    if (dto.serviceLevel !== undefined) patch.serviceLevel = dto.serviceLevel;
    if (dto.weightGrams !== undefined) patch.weightGrams = dto.weightGrams;
    if (dto.allowOpening !== undefined) patch.allowOpening = dto.allowOpening;
    if (dto.notes !== undefined) patch.notes = dto.notes.trim() || null;
    if (dto.maxUses !== undefined) patch.maxUses = dto.maxUses;
    if (dto.expiresAt !== undefined) patch.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    // The COD follows the items unless the brand set an explicit amount.
    const method = patch.paymentMethod ?? before.paymentMethod;
    const items = patch.items ?? before.items;
    if (method === 'PREPAID') patch.codAmountCents = 0;
    else if (dto.codAmountCents !== undefined && dto.codAmountCents !== null) patch.codAmountCents = dto.codAmountCents;
    else if (dto.codAmountCents === null || dto.items !== undefined || dto.paymentMethod !== undefined) patch.codAmountCents = itemsTotal(items);
    this.assertSane({ ...before, ...patch });
    if (Object.keys(patch).length) await this.db.update(orderLinks).set(patch).where(eq(orderLinks.id, id));
    await this.audit.record(p, { action: 'order_link.update', entity: 'OrderLink', entityId: id, before: { ...before, items: undefined }, after: { ...patch, items: patch.items ? patch.items.length : undefined } }, meta);
    return this.get(p, id);
  }

  /** Hard delete while unused; once orders exist the link can only be deactivated (keeps their history). */
  async remove(p: Principal, id: string, meta: RequestMetaInfo) {
    const link = await this.load(p, id);
    const [{ n }] = await this.db.select({ n: count() }).from(orders).where(and(eq(orders.brandId, link.brandId), eq(orders.orderLinkId, id)));
    if (Number(n) > 0) {
      throw new DomainError('ORDER_LINK_IN_USE', 'This link already has orders — deactivate it instead', HttpStatus.CONFLICT, { orders: Number(n) });
    }
    await this.db.delete(orderLinks).where(eq(orderLinks.id, id));
    await this.audit.record(p, { action: 'order_link.delete', entity: 'OrderLink', entityId: id, before: { code: link.code, title: link.title } }, meta);
    return { deleted: true };
  }

  /** The latest orders placed through a link. */
  async recentOrders(p: Principal, id: string) {
    const link = await this.load(p, id);
    return this.db
      .select({
        id: orders.id, trackingNumber: orders.trackingNumber, brandReference: orders.brandReference, status: orders.status,
        recipientName: orders.recipientName, recipientPhone: orders.recipientPhone, codAmountCents: orders.codAmountCents, createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(eq(orders.brandId, link.brandId), eq(orders.orderLinkId, id)))
      .orderBy(desc(orders.createdAt))
      .limit(50);
  }

  // ------------------------------------------------------------------ public

  /** What the buyer sees on /o/:code. */
  async publicView(rawCode: string) {
    const { link, brand } = await this.openLink(rawCode);
    return {
      code: link.code,
      title: link.title,
      description: link.description,
      brand: { name: brand.name, logoUrl: brand.logoUrl },
      items: link.items,
      itemsTotalCents: itemsTotal(link.items),
      paymentMethod: link.paymentMethod,
      codAmountCents: link.codAmountCents,
      serviceLevel: link.serviceLevel,
      allowOpening: link.allowOpening,
      feesPaidBy: brand.defaultFeesPaidBy,
      expiresAt: link.expiresAt,
    };
  }

  /** Exact amount the buyer will pay the hero for a zone (shipping is added when the brand bills the recipient). */
  async publicQuote(rawCode: string, zoneId: string) {
    const { link, brand } = await this.openLink(rawCode);
    const zone = await this.network.zoneById(zoneId);
    if (!zone || !zone.isActive) throw new DomainError('INVALID_ZONE', 'This area is not served', HttpStatus.UNPROCESSABLE_ENTITY, { field: 'zoneId' });
    const { card } = await this.pricing.rateCardForBrand(brand.id);
    const q = this.pricing.computeQuote(card, {
      tier: zone.tier, serviceLevel: link.serviceLevel, type: 'DELIVERY', weightGrams: link.weightGrams, paymentMethod: link.paymentMethod,
      codAmountCents: link.codAmountCents, declaredValueCents: 0, feesPaidBy: brand.defaultFeesPaidBy,
    });
    return {
      zone: this.network.zoneSummary(zone),
      feesPaidBy: brand.defaultFeesPaidBy,
      shippingCents: brand.defaultFeesPaidBy === 'RECIPIENT' ? q.totalFeesCents : 0,
      totalToPayCents: q.collectFromRecipientCents,
      slaHours: zone.slaHours,
    };
  }

  async detectZone(dto: PublicDetectZoneDto) {
    const point = dto.lat != null && dto.lng != null ? { lat: dto.lat, lng: dto.lng } : null;
    const res = await this.network.detect(dto.address, point);
    return {
      match: res.match ? { zoneId: res.match.zoneId, method: res.match.method, confidence: res.match.confidence } : null,
      zone: res.zone ? { id: res.zone.id, code: res.zone.code, nameEn: res.zone.nameEn, nameAr: res.zone.nameAr, city: res.zone.city } : null,
      hint: res.hint ?? null,
    };
  }

  /** The buyer submits the form: validate, reserve one use, create the order, mark it confirmed. */
  async submit(rawCode: string, dto: PublicOrderDto, meta: RequestMetaInfo) {
    if (dto.website && dto.website.trim()) {
      this.log.warn(`honeypot filled on order link ${normalizeLinkCode(rawCode)} from ${meta.ip ?? 'unknown'}`);
      throw new DomainError('INVALID_SUBMISSION', 'The form could not be submitted', HttpStatus.BAD_REQUEST);
    }
    const { link } = await this.openLink(rawCode);
    const phone = normalizeEgyptPhone(dto.phone);
    if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number (e.g. 010 1234 5678)', HttpStatus.BAD_REQUEST, { field: 'phone' });
    let altPhone: string | null = null;
    if (dto.altPhone?.trim()) {
      altPhone = normalizeEgyptPhone(dto.altPhone);
      if (!altPhone) throw new DomainError('INVALID_PHONE', 'The second phone number is not a valid Egyptian mobile number', HttpStatus.BAD_REQUEST, { field: 'altPhone' });
      if (altPhone === phone) altPhone = null;
    }

    const input = this.orderInput(link, dto, phone, altPhone, `LINK-${link.code}-0`);
    // Read-only validation first (zone, brand, pickup location) so a bad address never burns a use.
    await this.factory.prepare(input);

    const n = await this.reserve(link.id);
    input.brandReference = `LINK-${link.code}-${n}`;
    let created;
    try {
      // Buyers of a viral link order at the same moment: a deadlock victim is rolled back and simply retried.
      created = await withDeadlockRetry(() => this.intake.create(input, BUYER_ACTOR(dto.name.trim().slice(0, 150), link.brandId)));
    } catch (err) {
      await this.db.update(orderLinks).set({ usesCount: sql`greatest(${orderLinks.usesCount} - 1, 0)` }).where(eq(orderLinks.id, link.id));
      throw err;
    }
    const now = new Date();
    // The buyer typed their own phone and address: no confirmation call needed.
    await this.db
      .update(orders)
      .set({ orderLinkId: link.id, confirmationStatus: 'CONFIRMED', confirmationRespondedAt: now, confirmationChannel: 'ORDER_LINK' })
      .where(eq(orders.id, created.id));
    await this.audit.record(null, { action: 'order_link.order', entity: 'OrderLink', entityId: link.id, after: { orderId: created.id, trackingNumber: created.trackingNumber, n } }, meta);
    return {
      trackingNumber: created.trackingNumber,
      trackingUrl: `${config.appUrl}/t/${created.trackingNumber}`,
      reference: input.brandReference,
      amountToPayCents: created.collectCents,
      paymentMethod: link.paymentMethod,
    };
  }

  // ------------------------------------------------------------------ helpers

  private orderInput(link: LinkRow, dto: PublicOrderDto, phone: string, altPhone: string | null, reference: string): CreateOrderInput {
    const itemsCount = Math.max(1, link.items.reduce((s, i) => s + i.quantity, 0));
    const description = link.items.map((i) => `${i.quantity}× ${i.name}`).join(', ').slice(0, 500);
    const notes = [link.notes, dto.notes?.trim()].filter(Boolean).join(' — ').slice(0, 1000) || null;
    return {
      brandId: link.brandId,
      brandReference: reference,
      source: 'ORDER_LINK',
      serviceLevel: link.serviceLevel,
      recipient: { name: dto.name.trim(), phone, altPhone },
      address: {
        line: dto.addressLine.trim(),
        building: dto.building?.trim() || null,
        floor: dto.floor?.trim() || null,
        apartment: dto.apartment?.trim() || null,
        landmark: dto.landmark?.trim() || null,
        zoneId: dto.zoneId || null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
      },
      package: { description: description || link.title, itemsCount, weightGrams: link.weightGrams, allowOpening: link.allowOpening, declaredValueCents: itemsTotal(link.items) },
      paymentMethod: link.paymentMethod,
      codAmountCents: link.paymentMethod === 'COD' ? link.codAmountCents : 0,
      notes,
      tags: ['order-link'],
      metadata: {
        orderLink: { id: link.id, code: link.code, title: link.title, items: link.items },
        // Read by delivery-integrity: the buyer entered the order themselves.
        confirmation: { status: 'CONFIRMED', channel: 'ORDER_LINK' },
      },
    };
  }

  /** Atomically takes one use of the link; returns the sequence number for the order reference. */
  private async reserve(linkId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [link] = await tx.select().from(orderLinks).where(eq(orderLinks.id, linkId)).for('update').limit(1);
      if (!link) throw unavailable('INACTIVE');
      const [brand] = await tx.select({ status: brands.status }).from(brands).where(eq(brands.id, link.brandId)).limit(1);
      const reason = unavailableReason(link, brand?.status ?? 'SUSPENDED');
      if (reason) throw unavailable(reason);
      await tx.update(orderLinks).set({ usesCount: sql`${orderLinks.usesCount} + 1` }).where(eq(orderLinks.id, linkId));
      return this.sequences.next(`olink:${linkId}`, tx);
    });
  }

  private async openLink(rawCode: string) {
    const code = normalizeLinkCode(rawCode);
    if (!CODE_RE.test(code)) throw notFound('Order link');
    const [row] = await this.db
      .select({ link: orderLinks, brand: brands })
      .from(orderLinks)
      .innerJoin(brands, eq(brands.id, orderLinks.brandId))
      .where(eq(orderLinks.code, code))
      .limit(1);
    if (!row) throw notFound('Order link');
    const reason = unavailableReason(row.link, row.brand.status);
    if (reason) throw unavailable(reason);
    return row;
  }

  private async load(p: Principal, id: string, db: DbOrTx = this.db): Promise<LinkRow> {
    const scope = brandScope(p);
    const [row] = await db.select().from(orderLinks).where(scope ? and(eq(orderLinks.id, id), eq(orderLinks.brandId, scope)) : eq(orderLinks.id, id)).limit(1);
    if (!row) throw notFound('Order link', id);
    return row;
  }

  private assertSane(v: { paymentMethod: PaymentMethod; codAmountCents?: number | null; items: OrderLinkItem[]; expiresAt?: Date | null }) {
    if (v.paymentMethod === 'COD' && (v.codAmountCents ?? 0) <= 0) {
      throw new DomainError('INVALID_COD', 'A cash-on-delivery link needs a price — add item prices or a COD amount', HttpStatus.UNPROCESSABLE_ENTITY, { field: 'codAmountCents' });
    }
    if (itemsTotal(v.items) > 50_000_000) throw new DomainError('INVALID_AMOUNT', 'The items total is too large', HttpStatus.UNPROCESSABLE_ENTITY, { field: 'items' });
  }

  /** Orders created / delivered / returned per link (one grouped query). */
  private async stats(links: LinkRow[]) {
    const out = new Map<string, { orders: number; delivered: number; returned: number; active: number; deliveredCodCents: number }>();
    if (!links.length) return out;
    const rows = await this.db
      .select({
        linkId: orders.orderLinkId,
        n: sql<number>`count(*)`.mapWith(Number),
        delivered: sql<number>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then 1 else 0 end), 0)`.mapWith(Number),
        returned: sql<number>`coalesce(sum(case when ${orders.status} in ('RETURNED','RETURN_PENDING','RETURN_OUT') then 1 else 0 end), 0)`.mapWith(Number),
        cancelled: sql<number>`coalesce(sum(case when ${orders.status} = 'CANCELLED' then 1 else 0 end), 0)`.mapWith(Number),
        deliveredCod: sql<number>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then ${orders.collectedCents} else 0 end), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(and(inArray(orders.brandId, [...new Set(links.map((l) => l.brandId))]), inArray(orders.orderLinkId, links.map((l) => l.id))))
      .groupBy(orders.orderLinkId);
    for (const r of rows) {
      if (!r.linkId) continue;
      out.set(r.linkId, { orders: r.n, delivered: r.delivered, returned: r.returned, active: r.n - r.delivered - r.returned - r.cancelled, deliveredCodCents: r.deliveredCod });
    }
    return out;
  }

  present(l: LinkRow, s?: { orders: number; delivered: number; returned: number; active: number; deliveredCodCents: number }) {
    const stats = s ?? { orders: 0, delivered: 0, returned: 0, active: 0, deliveredCodCents: 0 };
    return {
      id: l.id,
      code: l.code,
      url: `${config.appUrl}/o/${l.code}`,
      brandId: l.brandId,
      title: l.title,
      description: l.description,
      items: l.items,
      itemsTotalCents: itemsTotal(l.items),
      paymentMethod: l.paymentMethod,
      codAmountCents: l.codAmountCents,
      serviceLevel: l.serviceLevel,
      weightGrams: l.weightGrams,
      allowOpening: l.allowOpening,
      notes: l.notes,
      maxUses: l.maxUses,
      usesCount: l.usesCount,
      expiresAt: l.expiresAt,
      isActive: l.isActive,
      availability: unavailableReason(l, 'ACTIVE') ?? 'OPEN',
      stats: { ...stats, deliveryRate: stats.orders ? Math.round((stats.delivered / stats.orders) * 1000) / 10 : null },
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    };
  }
}

function isDuplicate(err: unknown): boolean {
  let cur = err as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.code === 'ER_DUP_ENTRY') return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}

/** Actor used when nobody is logged in (public form submissions). */
export const BUYER_ACTOR = (name: string, brandId: string): ActorContext => ({ actorType: 'CUSTOMER', actorId: null, name, brandId });
