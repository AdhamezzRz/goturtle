import { createHmac, timingSafeEqual } from 'node:crypto';
import { egpToCents, normalizeEgyptPhone, type ServiceLevel } from '@goturtle/shared';
import type { CreateOrderInput } from '../orders/orders.contract';

/**
 * Pure mapping + signature helpers for the e-commerce connectors.
 * Kept free of Nest/DB so they are trivially unit-testable.
 */

export interface ConnectorCredentials {
  accessToken?: string;
  webhookSecret?: string;
  consumerKey?: string;
  consumerSecret?: string;
  /** Zid: the `Authorization` bearer token (the manager token goes in accessToken). */
  authorizationToken?: string;
}

export interface ConnectorSettings {
  autoCreate: boolean;
  defaultServiceLevel: ServiceLevel;
  codGateways: string[];
  defaultWeightGrams: number;
  pickupLocationId: string | null;
}

export const DEFAULT_COD_GATEWAYS = ['Cash on Delivery (COD)', 'cod', 'Cash on delivery', 'الدفع عند الاستلام'];

export const DEFAULT_SETTINGS: ConnectorSettings = {
  autoCreate: true,
  defaultServiceLevel: 'STANDARD',
  codGateways: DEFAULT_COD_GATEWAYS,
  defaultWeightGrams: 1000,
  pickupLocationId: null,
};

export function withDefaultSettings(s: Partial<ConnectorSettings> | Record<string, unknown> | null | undefined): ConnectorSettings {
  const v = (s ?? {}) as Partial<ConnectorSettings>;
  return {
    autoCreate: typeof v.autoCreate === 'boolean' ? v.autoCreate : DEFAULT_SETTINGS.autoCreate,
    defaultServiceLevel: v.defaultServiceLevel ?? DEFAULT_SETTINGS.defaultServiceLevel,
    codGateways: Array.isArray(v.codGateways) && v.codGateways.length ? v.codGateways : DEFAULT_SETTINGS.codGateways,
    defaultWeightGrams: typeof v.defaultWeightGrams === 'number' && v.defaultWeightGrams > 0 ? v.defaultWeightGrams : DEFAULT_SETTINGS.defaultWeightGrams,
    pickupLocationId: v.pickupLocationId ?? null,
  };
}

/** A store order that cannot become a shipment (bad phone, no address …). Not retryable. */
export class MappingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Verifies a base64 HMAC-SHA256 of the raw request body (Shopify
 * `X-Shopify-Hmac-Sha256`, WooCommerce `X-WC-Webhook-Signature`) against any
 * of the candidate secrets, in constant time.
 */
export function verifyBase64Hmac(rawBody: Buffer | string | undefined, header: string | undefined, secrets: Array<string | null | undefined>): boolean {
  if (!rawBody || !header) return false;
  const given = Buffer.from(header.trim(), 'base64');
  if (!given.length) return false;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

export const base64Hmac = (secret: string, body: string | Buffer) => createHmac('sha256', secret).update(body).digest('base64');

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function money(value: unknown, field: string): number {
  const n = num(value);
  if (n === null || n < 0) throw new MappingError('INVALID_AMOUNT', `${field} is not a valid amount`);
  return egpToCents(n);
}

function phoneFrom(...candidates: unknown[]): string {
  for (const c of candidates) {
    const p = normalizeEgyptPhone(str(c));
    if (p) return p;
  }
  const raw = candidates.map(str).find(Boolean);
  throw new MappingError('INVALID_PHONE', raw ? `Recipient phone ${raw} is not a valid Egyptian mobile number` : 'The order has no recipient phone number');
}

const isCod = (gateways: string[], configured: string[]) => {
  const wanted = configured.map((g) => g.trim().toLowerCase());
  return gateways.some((g) => wanted.includes(g.trim().toLowerCase()));
};

// ---------------------------------------------------------------- Shopify

interface ShopifyAddress {
  first_name?: string; last_name?: string; name?: string; address1?: string; address2?: string; city?: string; province?: string;
  zip?: string; country?: string; country_code?: string; phone?: string; company?: string; latitude?: number | string | null; longitude?: number | string | null;
}

export interface ShopifyOrder {
  id: number | string;
  name?: string;
  order_number?: number;
  currency?: string;
  total_price?: string;
  subtotal_price?: string;
  financial_status?: string;
  gateway?: string;
  payment_gateway_names?: string[];
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  total_weight?: number;
  cancelled_at?: string | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  customer?: { first_name?: string; last_name?: string; phone?: string | null; default_address?: ShopifyAddress } | null;
  line_items?: Array<{ title?: string; name?: string; quantity?: number; grams?: number }>;
}

export function mapShopifyOrder(o: ShopifyOrder, ctx: { brandId: string; connectionId: string; shopDomain: string; settings: ConnectorSettings }): CreateOrderInput {
  if (o.id === undefined || o.id === null || str(o.id) === '') throw new MappingError('INVALID_PAYLOAD', 'Order id is missing');
  const currency = str(o.currency || 'EGP').toUpperCase();
  if (currency !== 'EGP') throw new MappingError('UNSUPPORTED_CURRENCY', `Orders in ${currency} are not supported (EGP only)`);
  const ship = o.shipping_address ?? o.customer?.default_address ?? null;
  if (!ship || !str(ship.address1)) throw new MappingError('NO_SHIPPING_ADDRESS', 'The order has no shipping address');

  const name = str(ship.name) || [str(ship.first_name), str(ship.last_name)].filter(Boolean).join(' ') || [str(o.customer?.first_name), str(o.customer?.last_name)].filter(Boolean).join(' ');
  if (!name) throw new MappingError('NO_RECIPIENT', 'The order has no recipient name');
  const phone = phoneFrom(ship.phone, o.phone, o.customer?.phone, o.billing_address?.phone);
  const altPhone = [o.billing_address?.phone, o.phone].map((p) => normalizeEgyptPhone(str(p))).find((p) => p && p !== phone) ?? null;

  const gateways = o.payment_gateway_names?.length ? o.payment_gateway_names : o.gateway ? [o.gateway] : [];
  const paid = o.financial_status === 'paid' || o.financial_status === 'partially_refunded';
  const cod = !paid && isCod(gateways, ctx.settings.codGateways);
  const totalCents = money(o.total_price ?? '0', 'total_price');

  const items = o.line_items ?? [];
  const itemsCount = Math.max(1, items.reduce((s, li) => s + Math.max(0, Number(li.quantity ?? 1)), 0));
  const lineGrams = items.reduce((s, li) => s + Math.max(0, Number(li.grams ?? 0)) * Math.max(1, Number(li.quantity ?? 1)), 0);
  const weightGrams = Math.round(lineGrams || Number(o.total_weight ?? 0) || ctx.settings.defaultWeightGrams);
  const description = items.map((li) => `${Math.max(1, Number(li.quantity ?? 1))}× ${str(li.title ?? li.name)}`).join(', ');

  const line = [str(ship.address1), str(ship.address2), str(ship.city), str(ship.province)].filter(Boolean).join(', ');
  const externalId = str(o.id);
  return {
    brandId: ctx.brandId,
    brandReference: clip(str(o.name) || `#${o.order_number ?? externalId}`, 100),
    source: 'SHOPIFY',
    serviceLevel: ctx.settings.defaultServiceLevel,
    recipient: { name: clip(name, 150), phone, altPhone },
    address: { line: clip(line, 500), landmark: str(ship.company) ? clip(str(ship.company), 200) : null, lat: num(ship.latitude), lng: num(ship.longitude) },
    package: { description: description ? clip(description, 500) : null, itemsCount, weightGrams: Math.max(1, weightGrams), declaredValueCents: totalCents },
    paymentMethod: cod ? 'COD' : 'PREPAID',
    codAmountCents: cod ? totalCents : 0,
    pickupLocationId: ctx.settings.pickupLocationId,
    notes: o.note ? clip(str(o.note), 1000) : null,
    externalId,
    tags: ['shopify'],
    metadata: { integration: { provider: 'SHOPIFY', connectionId: ctx.connectionId, shopDomain: ctx.shopDomain, orderId: externalId, orderName: str(o.name) || null } },
  };
}

// ---------------------------------------------------------------- WooCommerce

interface WooAddress {
  first_name?: string; last_name?: string; company?: string; address_1?: string; address_2?: string; city?: string; state?: string;
  postcode?: string; country?: string; phone?: string; email?: string;
}

export interface WooOrder {
  id: number | string;
  number?: string;
  status?: string;
  currency?: string;
  total?: string;
  payment_method?: string;
  payment_method_title?: string;
  date_paid?: string | null;
  customer_note?: string;
  shipping?: WooAddress;
  billing?: WooAddress;
  line_items?: Array<{ name?: string; quantity?: number }>;
}

export function mapWooOrder(o: WooOrder, ctx: { brandId: string; connectionId: string; shopDomain: string; settings: ConnectorSettings }): CreateOrderInput {
  if (o.id === undefined || o.id === null || str(o.id) === '') throw new MappingError('INVALID_PAYLOAD', 'Order id is missing');
  const currency = str(o.currency || 'EGP').toUpperCase();
  if (currency !== 'EGP') throw new MappingError('UNSUPPORTED_CURRENCY', `Orders in ${currency} are not supported (EGP only)`);
  // WooCommerce leaves `shipping` empty when "ship to a different address" is unticked.
  const ship = o.shipping && str(o.shipping.address_1) ? o.shipping : o.billing;
  if (!ship || !str(ship.address_1)) throw new MappingError('NO_SHIPPING_ADDRESS', 'The order has no shipping address');
  const name = [str(ship.first_name), str(ship.last_name)].filter(Boolean).join(' ') || [str(o.billing?.first_name), str(o.billing?.last_name)].filter(Boolean).join(' ');
  if (!name) throw new MappingError('NO_RECIPIENT', 'The order has no recipient name');
  const phone = phoneFrom(o.shipping?.phone, o.billing?.phone);
  const altPhone = normalizeEgyptPhone(str(o.billing?.phone));

  const cod = o.payment_method === 'cod' || isCod([str(o.payment_method), str(o.payment_method_title)].filter(Boolean), ctx.settings.codGateways);
  const totalCents = money(o.total ?? '0', 'total');
  const items = o.line_items ?? [];
  const itemsCount = Math.max(1, items.reduce((s, li) => s + Math.max(0, Number(li.quantity ?? 1)), 0));
  const description = items.map((li) => `${Math.max(1, Number(li.quantity ?? 1))}× ${str(li.name)}`).join(', ');
  const line = [str(ship.address_1), str(ship.address_2), str(ship.city), str(ship.state)].filter(Boolean).join(', ');
  const externalId = str(o.id);
  return {
    brandId: ctx.brandId,
    brandReference: clip(`#${str(o.number) || externalId}`, 100),
    source: 'WOOCOMMERCE',
    serviceLevel: ctx.settings.defaultServiceLevel,
    recipient: { name: clip(name, 150), phone, altPhone: altPhone && altPhone !== phone ? altPhone : null },
    address: { line: clip(line, 500), landmark: str(ship.company) ? clip(str(ship.company), 200) : null },
    package: { description: description ? clip(description, 500) : null, itemsCount, weightGrams: ctx.settings.defaultWeightGrams, declaredValueCents: totalCents },
    paymentMethod: cod ? 'COD' : 'PREPAID',
    codAmountCents: cod ? totalCents : 0,
    pickupLocationId: ctx.settings.pickupLocationId,
    notes: o.customer_note ? clip(str(o.customer_note), 1000) : null,
    externalId,
    tags: ['woocommerce'],
    metadata: { integration: { provider: 'WOOCOMMERCE', connectionId: ctx.connectionId, shopDomain: ctx.shopDomain, orderId: externalId, orderName: `#${str(o.number) || externalId}` } },
  };
}

/** nile.myshopify.com (accepts URLs / admin links) or null when invalid. */
export function normalizeShopifyDomain(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(host) ? host : null;
}

/** shop.example.com[/path] (no scheme, no trailing slash) or null when invalid. */
export function normalizeWooDomain(input: string): string | null {
  const trimmed = input.trim().replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const [host, ...path] = trimmed.split('/');
  if (!/^[a-z0-9.-]+(:\d{2,5})?$/i.test(host) || !host.includes('.') && !host.startsWith('localhost')) return null;
  return [host.toLowerCase(), ...path].join('/');
}
