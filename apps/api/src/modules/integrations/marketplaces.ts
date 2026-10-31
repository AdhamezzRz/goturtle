import { createHmac, timingSafeEqual } from 'node:crypto';
import { egpToCents, normalizeEgyptPhone, type OrderSource } from '@goturtle/shared';
import type { CreateOrderInput } from '../orders/orders.contract';
import { MappingError, type ConnectorCredentials, type ConnectorSettings } from './connectors';

/**
 * Inbound order webhooks for the store builders popular with Egyptian
 * sellers: EasyOrders, Zid, Salla and YouCan. Pure functions (signature,
 * event classification, mapping) — no Nest / DB — so they are unit-testable.
 *
 * Signatures
 *  - Salla:  `X-Salla-Signature` = hex HMAC-SHA256(raw body, webhook secret)
 *            ("Signature" strategy), or `Authorization: Bearer <token>` ("Token" strategy).
 *  - YouCan: `x-youcan-signature` = hex HMAC-SHA256(raw body, app client secret).
 *  - Zid:    `X-Zid-Signature` HMAC when present, otherwise a shared secret
 *            (`Authorization: Bearer`, `X-GoTurtle-Token` or `?token=` in the webhook URL).
 *  - EasyOrders: shared secret in the `secret` / `X-EasyOrders-Secret` header
 *            (or the same fallbacks as Zid).
 * Every scheme accepts the platform secret stored in the credentials or the
 * connection's own inboundSecret, compared in constant time.
 */
export const MARKETPLACE_PROVIDERS = ['EASYORDERS', 'ZID', 'SALLA', 'YOUCAN'] as const;
export type MarketplaceProvider = (typeof MARKETPLACE_PROVIDERS)[number];

export const isMarketplace = (p: string): p is MarketplaceProvider => (MARKETPLACE_PROVIDERS as readonly string[]).includes(p);

export const MARKETPLACE_META: Record<MarketplaceProvider, { label: string; slug: string; source: OrderSource; refPrefix: string }> = {
  EASYORDERS: { label: 'EasyOrders', slug: 'easyorders', source: 'EASYORDERS', refPrefix: 'EO' },
  ZID: { label: 'Zid', slug: 'zid', source: 'ZID', refPrefix: 'ZID' },
  SALLA: { label: 'Salla', slug: 'salla', source: 'SALLA', refPrefix: 'SALLA' },
  YOUCAN: { label: 'YouCan', slug: 'youcan', source: 'YOUCAN', refPrefix: 'YC' },
};

export const slugToMarketplace = (slug: string): MarketplaceProvider | null =>
  (Object.keys(MARKETPLACE_META) as MarketplaceProvider[]).find((p) => MARKETPLACE_META[p].slug === slug) ?? null;

export type Headers = Record<string, string | string[] | undefined>;

export interface InboundRequest {
  headers: Headers;
  rawBody: Buffer | undefined;
  body: unknown;
  /** `?token=` from the webhook URL (for platforms that cannot send custom headers). */
  token?: string | null;
}

export interface MarketplaceEvent {
  kind: 'create' | 'cancel' | 'ignore';
  externalId: string;
  reference: string | null;
  reason?: string;
  order: Record<string, unknown>;
}

const header = (h: Headers, name: string): string | undefined => {
  const v = h[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** Constant-time check of an HMAC-SHA256 given as hex or base64 (optionally `sha256=`-prefixed). */
export function verifyHmacAny(rawBody: Buffer | string | undefined, given: string | undefined, secrets: Array<string | null | undefined>): boolean {
  if (!rawBody || !given) return false;
  const value = given.replace(/^sha256=/i, '').trim();
  const candidates: Buffer[] = [];
  if (/^[0-9a-f]{64}$/i.test(value)) candidates.push(Buffer.from(value, 'hex'));
  const b64 = Buffer.from(value, 'base64');
  if (b64.length === 32) candidates.push(b64);
  if (!candidates.length) return false;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    if (candidates.some((c) => c.length === expected.length && timingSafeEqual(c, expected))) return true;
  }
  return false;
}

/** Constant-time comparison of a shared secret against the candidates. */
export function verifyToken(given: string | null | undefined, secrets: Array<string | null | undefined>): boolean {
  if (!given) return false;
  const g = Buffer.from(given.replace(/^Bearer\s+/i, '').trim());
  if (!g.length) return false;
  return secrets.some((s) => {
    if (!s) return false;
    const e = Buffer.from(s);
    return e.length === g.length && timingSafeEqual(e, g);
  });
}

export const hexHmac = (secret: string, body: string | Buffer) => createHmac('sha256', secret).update(body).digest('hex');

export function verifyMarketplace(provider: MarketplaceProvider, req: InboundRequest, creds: ConnectorCredentials, inboundSecret: string): boolean {
  const secrets = [creds.webhookSecret, inboundSecret];
  const h = req.headers;
  const sharedSecret = () =>
    verifyToken(header(h, 'authorization'), secrets) || verifyToken(header(h, 'x-goturtle-token'), secrets) || verifyToken(req.token ?? null, secrets);
  switch (provider) {
    case 'SALLA': {
      const sig = header(h, 'x-salla-signature');
      if (sig) return verifyHmacAny(req.rawBody, sig, secrets);
      return verifyToken(header(h, 'authorization'), secrets);
    }
    case 'YOUCAN':
      return verifyHmacAny(req.rawBody, header(h, 'x-youcan-signature'), secrets);
    case 'ZID': {
      const sig = header(h, 'x-zid-signature');
      if (sig) return verifyHmacAny(req.rawBody, sig, secrets);
      return sharedSecret();
    }
    case 'EASYORDERS': {
      const sig = header(h, 'x-easyorders-signature');
      if (sig) return verifyHmacAny(req.rawBody, sig, secrets);
      return verifyToken(header(h, 'secret'), secrets) || verifyToken(header(h, 'x-easyorders-secret'), secrets) || sharedSecret();
    }
  }
}

// ------------------------------------------------------------------ helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const first = (...vals: unknown[]): string => vals.map(str).find(Boolean) ?? '';
const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const lower = (v: unknown) => str(v).toLowerCase();

function money(value: unknown, field: string): number {
  const n = num(isObj(value) ? (value as Obj).amount : value);
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

function assertEgp(...currencies: unknown[]) {
  const c = (currencies.map(str).find(Boolean) || 'EGP').toUpperCase();
  if (c !== 'EGP') throw new MappingError('UNSUPPORTED_CURRENCY', `Orders in ${c} are not supported (EGP only)`);
}

const matchesGateway = (names: string[], configured: string[]) => {
  const wanted = configured.map((g) => g.trim().toLowerCase());
  return names.some((n) => n && (wanted.includes(n.toLowerCase()) || /(^|[_\s-])cod($|[_\s-])|cash[_\s-]?on[_\s-]?delivery|الدفع عند الاستلام/i.test(n)));
};

interface Line {
  name: string;
  quantity: number;
  grams: number;
}

function summarize(lines: Line[], settings: ConnectorSettings) {
  const itemsCount = Math.max(1, lines.reduce((s, l) => s + l.quantity, 0));
  const grams = lines.reduce((s, l) => s + l.grams * l.quantity, 0);
  const description = lines.map((l) => `${l.quantity}× ${l.name}`).filter((d) => d.length > 3).join(', ');
  return { itemsCount, weightGrams: Math.max(1, Math.round(grams || settings.defaultWeightGrams)), description: description ? clip(description, 500) : null };
}

/** Kilograms / grams objects ({value, unit}) or plain numbers (kg) → grams. */
function grams(weight: unknown, unit?: unknown): number {
  if (isObj(weight)) return grams(weight.value, weight.unit);
  const n = num(weight);
  if (n === null || n <= 0) return 0;
  const u = lower(unit) || 'kg';
  return u.startsWith('g') ? n : u === 'lb' ? n * 453.6 : n * 1000;
}

const qty = (v: unknown) => Math.max(1, Math.round(num(v) ?? 1));

export interface MapContext {
  brandId: string;
  connectionId: string;
  shopDomain: string;
  settings: ConnectorSettings;
}

function build(provider: MarketplaceProvider, ctx: MapContext, o: {
  externalId: string; reference: string; name: string; phone: string; altPhone: string | null; line: string; landmark?: string | null;
  lat?: number | null; lng?: number | null; cod: boolean; totalCents: number; lines: Line[]; notes?: string | null;
}): CreateOrderInput {
  const meta = MARKETPLACE_META[provider];
  if (!o.line || o.line.length < 5) throw new MappingError('NO_SHIPPING_ADDRESS', 'The order has no shipping address');
  if (!o.name) throw new MappingError('NO_RECIPIENT', 'The order has no recipient name');
  const s = summarize(o.lines, ctx.settings);
  return {
    brandId: ctx.brandId,
    brandReference: clip(`${meta.refPrefix}-${o.reference || o.externalId}`, 100),
    source: meta.source,
    serviceLevel: ctx.settings.defaultServiceLevel,
    recipient: { name: clip(o.name, 150), phone: o.phone, altPhone: o.altPhone && o.altPhone !== o.phone ? o.altPhone : null },
    address: { line: clip(o.line, 500), landmark: o.landmark ? clip(o.landmark, 200) : null, lat: o.lat ?? null, lng: o.lng ?? null },
    package: { description: s.description, itemsCount: s.itemsCount, weightGrams: s.weightGrams, declaredValueCents: o.totalCents },
    paymentMethod: o.cod ? 'COD' : 'PREPAID',
    codAmountCents: o.cod ? o.totalCents : 0,
    pickupLocationId: ctx.settings.pickupLocationId,
    notes: o.notes ? clip(o.notes, 1000) : null,
    externalId: marketplaceExternalId(provider, o.externalId),
    tags: [meta.slug],
    metadata: { integration: { provider, connectionId: ctx.connectionId, shopDomain: ctx.shopDomain, orderId: o.externalId, orderName: o.reference || null } },
  };
}

/** Ids are namespaced per platform so two stores of one brand never collide. */
export const marketplaceExternalId = (provider: MarketplaceProvider, id: string) => `${MARKETPLACE_META[provider].slug}:${id}`.slice(0, 100);

const latLng = (v: unknown): { lat: number | null; lng: number | null } => {
  const o = obj(v);
  const lat = num(o.lat ?? o.latitude);
  const lng = num(o.lng ?? o.lon ?? o.longitude);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : { lat: null, lng: null };
};

const CANCELLED = ['cancelled', 'canceled', 'cancel', 'refunded', 'reversed', 'rejected', 'deleted', 'ملغي'];

// ------------------------------------------------------------------ Salla

export function classifySalla(body: unknown): MarketplaceEvent {
  const b = obj(body);
  const event = str(b.event);
  const order = obj(b.data);
  const externalId = str(order.id);
  const reference = first(order.reference_id, order.reference);
  const status = lower(obj(order.status).slug || order.status);
  if (!externalId) return { kind: 'ignore', externalId: '', reference: null, reason: `Event ${event || '(none)'} has no order`, order };
  if (event === 'order.cancelled' || event === 'order.deleted' || (event === 'order.status.updated' && CANCELLED.includes(status))) {
    return { kind: 'cancel', externalId, reference, order };
  }
  if (event === 'order.created') return { kind: 'create', externalId, reference, order };
  return { kind: 'ignore', externalId, reference, reason: `Event ${event || '(none)'} is not handled`, order };
}

export function mapSallaOrder(order: Obj, ctx: MapContext): CreateOrderInput {
  const amounts = obj(order.amounts);
  assertEgp(obj(amounts.total).currency, order.currency);
  const customer = obj(order.customer);
  const shipping = obj(order.shipping);
  const receiver = obj(shipping.receiver);
  const address = obj(shipping.address ?? shipping.pickup_address ?? order.ship_to);
  const name = first(receiver.name, [str(customer.first_name), str(customer.last_name)].filter(Boolean).join(' '));
  const mobile = (code: unknown, n: unknown) => (str(n) ? `${str(code)}${str(n)}` : '');
  const phone = phoneFrom(receiver.phone, mobile(customer.mobile_code, customer.mobile), customer.mobile);
  const altPhone = normalizeEgyptPhone(mobile(customer.mobile_code, customer.mobile)) ?? null;
  const line = [first(address.shipping_address, address.street, address.address_line), str(address.street_number), first(address.block, address.district), first(address.city, customer.city)]
    .filter(Boolean).join(', ');
  const paymentMethod = lower(order.payment_method);
  const cod = paymentMethod === 'cod' || matchesGateway([paymentMethod], ctx.settings.codGateways);
  const lines = arr(order.items).map((i) => {
    const it = obj(i);
    return { name: first(it.name, obj(it.product).name), quantity: qty(it.quantity), grams: grams(it.weight ?? obj(it.product).weight, it.weight_type) };
  });
  return build('SALLA', ctx, {
    externalId: str(order.id), reference: first(order.reference_id, order.id), name, phone, altPhone, line,
    ...latLng(address.geo_coordinates), cod, totalCents: money(amounts.total ?? order.total, 'amounts.total'), lines, notes: first(order.notes, order.customer_note) || null,
  });
}

// ------------------------------------------------------------------ Zid

export function classifyZid(body: unknown): MarketplaceEvent {
  const b = obj(body);
  const order = obj(isObj(b.order) ? b.order : isObj(b.data) ? b.data : b);
  const externalId = str(order.id);
  const reference = first(order.code, order.id);
  const status = lower(obj(order.order_status).code || order.order_status || order.status);
  if (!externalId) return { kind: 'ignore', externalId: '', reference: null, reason: 'The payload has no order id', order };
  if (CANCELLED.includes(status)) return { kind: 'cancel', externalId, reference, order };
  if (['new', 'preparing', 'ready', 'pending', 'processing', ''].includes(status)) return { kind: 'create', externalId, reference, order };
  return { kind: 'ignore', externalId, reference, reason: `Order status ${status} is not handled`, order };
}

export function mapZidOrder(order: Obj, ctx: MapContext): CreateOrderInput {
  assertEgp(order.currency_code, obj(order.currency).code);
  const customer = obj(order.customer);
  const shipping = obj(order.shipping);
  const address = obj(shipping.address ?? order.address);
  const phone = phoneFrom(address.phone, customer.mobile, customer.phone);
  const altPhone = normalizeEgyptPhone(first(customer.mobile, customer.phone)) ?? null;
  const city = isObj(address.city) ? str(address.city.name) : str(address.city);
  const line = [first(address.formatted_address, address.street, address.line_1), str(address.district), city].filter(Boolean).join(', ');
  const method = obj(obj(order.payment).method);
  const cod = lower(method.type) === 'cod' || matchesGateway([str(method.code), str(method.name)], ctx.settings.codGateways);
  const lines = arr(order.products ?? order.items).map((p) => {
    const it = obj(p);
    return { name: str(it.name), quantity: qty(it.quantity), grams: grams(it.weight) };
  });
  return build('ZID', ctx, {
    externalId: str(order.id), reference: first(order.code, order.id), name: first(address.name, customer.name), phone, altPhone, line,
    landmark: first(address.short_address) || null, ...latLng(address), cod, totalCents: money(order.order_total ?? order.total, 'order_total'), lines,
    notes: first(order.customer_note, order.notes) || null,
  });
}

// ------------------------------------------------------------------ YouCan

export function classifyYouCan(body: unknown, headers: Headers): MarketplaceEvent {
  const b = obj(body);
  const order = obj(isObj(b.order) ? b.order : isObj(b.data) ? b.data : b);
  const externalId = str(order.id);
  const reference = first(order.ref, order.reference, order.id);
  const event = lower(header(headers, 'x-youcan-event') ?? b.event);
  const status = lower(order.status_new ?? order.status);
  const cancelled = event.includes('cancel') || CANCELLED.includes(status) || !!order.canceled_at || !!order.cancelled_at || order.is_canceled === true;
  if (!externalId) return { kind: 'ignore', externalId: '', reference: null, reason: 'The payload has no order id', order };
  if (cancelled) return { kind: 'cancel', externalId, reference, order };
  if (!event || event.includes('order.create') || event.includes('order.update') || event === 'order.created') return { kind: 'create', externalId, reference, order };
  return { kind: 'ignore', externalId, reference, reason: `Event ${event} is not handled`, order };
}

export function mapYouCanOrder(order: Obj, ctx: MapContext): CreateOrderInput {
  assertEgp(order.currency, obj(order.currency).code);
  const customer = obj(order.customer);
  const shipping = obj(order.shipping);
  const addrSrc = shipping.address ?? customer.address ?? order.shipping_address;
  const address = obj(Array.isArray(addrSrc) ? addrSrc[0] : addrSrc);
  const name = first([str(address.first_name), str(address.last_name)].filter(Boolean).join(' '), customer.full_name, [str(customer.first_name), str(customer.last_name)].filter(Boolean).join(' '));
  const phone = phoneFrom(address.phone, customer.phone);
  const altPhone = normalizeEgyptPhone(str(customer.phone)) ?? null;
  const line = [first(address.first_line, address.address, address.address1), first(address.second_line, address.address2), str(address.city), first(address.region, address.state)]
    .filter(Boolean).join(', ');
  const payment = obj(order.payment);
  const paid = ['paid', '1'].includes(lower(payment.status)) || payment.status === 1;
  const gateway = first(payment.gateway, payment.method, order.payment_method, obj(payment.payload).gateway);
  const cod = !paid && (!gateway || matchesGateway([gateway], ctx.settings.codGateways));
  const lines = arr(order.variants ?? order.line_items ?? order.items).map((v) => {
    const it = obj(v);
    const variant = obj(it.variant);
    const product = obj(variant.product ?? it.product);
    return { name: first(product.name, it.name, variant.name), quantity: qty(it.quantity), grams: grams(product.weight ?? variant.weight) };
  });
  return build('YOUCAN', ctx, {
    externalId: str(order.id), reference: first(order.ref, order.reference, order.id), name, phone, altPhone, line, cod,
    totalCents: money(order.total ?? order.total_price, 'total'), lines, notes: first(order.notes, order.note) || null,
  });
}

// ------------------------------------------------------------------ EasyOrders

export function classifyEasyOrders(body: unknown): MarketplaceEvent {
  const b = obj(body);
  const order = obj(isObj(b.order) ? b.order : isObj(b.data) ? b.data : b);
  const externalId = str(order.id);
  const reference = first(order.short_id, order.order_number, order.id);
  const status = lower(order.status);
  const event = lower(b.event ?? b.type);
  if (!externalId) return { kind: 'ignore', externalId: '', reference: null, reason: 'The payload has no order id', order };
  if (event.includes('cancel') || event.includes('delete') || CANCELLED.includes(status)) return { kind: 'cancel', externalId, reference, order };
  if (['', 'pending', 'confirmed', 'new', 'processing', 'paid', 'pending_payment'].includes(status)) return { kind: 'create', externalId, reference, order };
  return { kind: 'ignore', externalId, reference, reason: `Order status ${status} is not handled`, order };
}

export function mapEasyOrdersOrder(order: Obj, ctx: MapContext): CreateOrderInput {
  assertEgp(order.currency);
  const phone = phoneFrom(order.phone, order.phone_alt);
  const altPhone = normalizeEgyptPhone(str(order.phone_alt)) ?? null;
  const line = [str(order.address), first(order.city, order.area), first(order.government, order.governorate)].filter(Boolean).join(', ');
  const method = lower(order.payment_method);
  const cod = !method || method === 'cod' || matchesGateway([method], ctx.settings.codGateways);
  const lines = arr(order.cart_items ?? order.items).map((c) => {
    const it = obj(c);
    const product = obj(it.product);
    return { name: first(product.name, it.name, obj(it.variant).name), quantity: qty(it.quantity), grams: grams(product.weight ?? it.weight) };
  });
  return build('EASYORDERS', ctx, {
    externalId: str(order.id), reference: first(order.short_id, order.order_number, str(order.id).slice(0, 12)), name: first(order.full_name, order.name), phone, altPhone, line,
    cod, totalCents: money(order.total_cost ?? order.total, 'total_cost'), lines, notes: first(order.notes, order.note) || null,
  });
}

export function classifyMarketplace(provider: MarketplaceProvider, body: unknown, headers: Headers): MarketplaceEvent {
  switch (provider) {
    case 'SALLA': return classifySalla(body);
    case 'ZID': return classifyZid(body);
    case 'YOUCAN': return classifyYouCan(body, headers);
    case 'EASYORDERS': return classifyEasyOrders(body);
  }
}

export function mapMarketplaceOrder(provider: MarketplaceProvider, order: Obj, ctx: MapContext): CreateOrderInput {
  switch (provider) {
    case 'SALLA': return mapSallaOrder(order, ctx);
    case 'ZID': return mapZidOrder(order, ctx);
    case 'YOUCAN': return mapYouCanOrder(order, ctx);
    case 'EASYORDERS': return mapEasyOrdersOrder(order, ctx);
  }
}

/** Store identifier: domain, store handle or numeric merchant id (lower-case, no scheme or path). */
export function normalizeStoreRef(input: string): string | null {
  const v = input.trim().replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9.-]{1,120}(\/[a-z0-9._-]{1,60})?$/.test(v) ? v : null;
}

export interface ProbeRequest {
  url: string;
  headers: Record<string, string>;
  missing?: string;
}

/** The read-only API call used by "Test connection" for each platform. */
export function probeRequest(provider: MarketplaceProvider, creds: ConnectorCredentials): ProbeRequest {
  const bearer = (t?: string) => ({ Authorization: `Bearer ${t ?? ''}`, Accept: 'application/json' });
  switch (provider) {
    case 'SALLA':
      return { url: 'https://api.salla.dev/admin/v2/store/info', headers: bearer(creds.accessToken), missing: creds.accessToken ? undefined : 'Add the Salla access token first' };
    case 'YOUCAN':
      return { url: 'https://api.youcan.shop/me', headers: bearer(creds.accessToken), missing: creds.accessToken ? undefined : 'Add the YouCan access token first' };
    case 'ZID':
      return {
        url: 'https://api.zid.sa/v1/managers/account/profile',
        headers: { ...bearer(creds.authorizationToken), 'X-Manager-Token': creds.accessToken ?? '', 'Accept-Language': 'ar' },
        missing: creds.accessToken && creds.authorizationToken ? undefined : 'Add the Zid manager token and authorization token first',
      };
    case 'EASYORDERS':
      return {
        url: 'https://api.easy-orders.net/api/v1/external-apps/orders?limit=1',
        headers: { 'Api-Key': creds.accessToken ?? '', Accept: 'application/json' },
        missing: creds.accessToken ? undefined : 'Add the EasyOrders API key first',
      };
  }
}

/** Store name from the probe response, when the platform returns one. */
export function probeStoreName(provider: MarketplaceProvider, json: unknown): string | null {
  const j = obj(json);
  switch (provider) {
    case 'SALLA': return str(obj(j.data).name) || null;
    case 'YOUCAN': return first(j.name, j.slug) || null;
    case 'ZID': return str(obj(obj(j.user).store).title) || null;
    case 'EASYORDERS': return null;
  }
}
