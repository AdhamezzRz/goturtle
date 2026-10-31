import { HttpStatus, Injectable } from '@nestjs/common';
import Papa from 'papaparse';
import {
  egpToCents, normalizeEgyptPhone, normalizeText, toLatinDigits, type FeesPayer, type OrderType, type PaymentMethod, type ServiceLevel,
} from '@goturtle/shared';
import { DomainError } from '../../common/errors';
import type { ActorContext } from '../../common/actor';
import { NetworkService, type ZoneInfo } from '../network/network.service';
import type { CreateOrderInput } from './orders.contract';
import { OrderFactoryService } from './order-factory.service';
import { isDay } from './ops-kit';
import { MAX_COD_CENTS } from './orders.dto';

export const BULK_MAX_ROWS = 500;

type Field =
  | 'reference' | 'recipient_name' | 'phone' | 'alt_phone' | 'address' | 'building' | 'floor' | 'apartment' | 'landmark' | 'zone'
  | 'cod_amount' | 'payment_method' | 'service_level' | 'type' | 'weight_kg' | 'items_count' | 'description' | 'fragile' | 'allow_opening'
  | 'declared_value' | 'fees_paid_by' | 'notes' | 'scheduled_date' | 'otp_required' | 'external_id';

/** Column aliases (English, Arabic, common spreadsheet variants). */
const ALIASES: Record<Field, string[]> = {
  reference: ['reference', 'ref', 'order_number', 'order_no', 'order number', 'order id', 'brand_reference', 'رقم الطلب', 'رقم الاوردر', 'المرجع', 'رقم المرجع'],
  recipient_name: ['recipient_name', 'recipient', 'name', 'customer_name', 'customer', 'اسم المستلم', 'اسم العميل', 'الاسم', 'العميل', 'المستلم'],
  phone: ['phone', 'mobile', 'recipient_phone', 'phone_number', 'phone number', 'رقم الموبايل', 'الموبايل', 'الهاتف', 'رقم الهاتف', 'التليفون', 'موبايل', 'رقم التليفون'],
  alt_phone: ['alt_phone', 'phone2', 'phone 2', 'second_phone', 'alternative_phone', 'هاتف بديل', 'رقم بديل', 'موبايل 2', 'رقم اخر'],
  address: ['address', 'address_line', 'street', 'العنوان', 'عنوان', 'العنوان بالتفصيل'],
  building: ['building', 'bldg', 'building_no', 'العمارة', 'رقم العمارة', 'المبنى', 'رقم المبنى'],
  floor: ['floor', 'الدور', 'الطابق'],
  apartment: ['apartment', 'apt', 'flat', 'الشقة', 'رقم الشقة'],
  landmark: ['landmark', 'near', 'علامة مميزة', 'علامه مميزه', 'بجوار', 'اقرب علامة'],
  zone: ['zone', 'zone_code', 'area', 'district', 'المنطقة', 'المنطقه', 'كود المنطقة', 'الحي'],
  cod_amount: ['cod', 'cod_amount', 'cod amount', 'amount', 'cod_egp', 'collect', 'collect_amount', 'مبلغ التحصيل', 'المبلغ', 'التحصيل', 'قيمة التحصيل', 'المبلغ المطلوب'],
  payment_method: ['payment_method', 'payment', 'payment method', 'طريقة الدفع', 'الدفع'],
  service_level: ['service_level', 'service', 'service level', 'نوع الخدمة', 'الخدمة'],
  type: ['type', 'order_type', 'shipment_type', 'نوع الشحنة', 'نوع الطلب'],
  weight_kg: ['weight_kg', 'weight', 'weight (kg)', 'الوزن', 'الوزن كجم', 'الوزن (كجم)'],
  items_count: ['items_count', 'items', 'pieces', 'quantity', 'qty', 'عدد القطع', 'الكمية', 'العدد'],
  description: ['description', 'content', 'contents', 'package_description', 'الوصف', 'المحتوى', 'محتوى الشحنة', 'وصف الشحنة'],
  fragile: ['fragile', 'is_fragile', 'قابل للكسر'],
  allow_opening: ['allow_opening', 'open', 'can_open', 'open_package', 'يسمح بالفتح', 'السماح بالفتح', 'فتح الشحنة'],
  declared_value: ['declared_value', 'value', 'package_value', 'القيمة المعلنة', 'قيمة الشحنة'],
  fees_paid_by: ['fees_paid_by', 'fees_on', 'shipping_paid_by', 'الرسوم على', 'مصاريف الشحن على', 'الشحن على'],
  notes: ['notes', 'note', 'comments', 'instructions', 'ملاحظات', 'ملاحظة', 'تعليمات'],
  scheduled_date: ['scheduled_date', 'delivery_date', 'date', 'تاريخ التوصيل', 'موعد التوصيل', 'التاريخ'],
  otp_required: ['otp_required', 'otp', 'delivery_otp', 'كود التسليم', 'كود التأكيد'],
  external_id: ['external_id', 'shopify_id', 'store_order_id'],
};

const headerKey = (h: string) => normalizeText(h.replace(/^﻿/, '')).replace(/[\s_]+/g, '');
const HEADER_INDEX = new Map<string, Field>();
for (const [field, list] of Object.entries(ALIASES) as Array<[Field, string[]]>) for (const alias of list) HEADER_INDEX.set(headerKey(alias), field);

const valueKey = (v: string) => normalizeText(v).replace(/[\s_-]+/g, '');
const lookup = <T extends string>(table: Record<string, T>) => {
  const m = new Map(Object.entries(table).map(([k, v]) => [valueKey(k), v]));
  return (raw: string): T | undefined => m.get(valueKey(raw));
};

const paymentOf = lookup<PaymentMethod>({
  cod: 'COD', cash: 'COD', 'cash on delivery': 'COD', 'كاش': 'COD', 'نقدي': 'COD', 'نقدا': 'COD', 'دفع عند الاستلام': 'COD', 'عند الاستلام': 'COD', 'الدفع عند الاستلام': 'COD',
  prepaid: 'PREPAID', paid: 'PREPAID', online: 'PREPAID', card: 'PREPAID', 'مدفوع': 'PREPAID', 'مدفوع مسبقا': 'PREPAID', 'اونلاين': 'PREPAID', 'فيزا': 'PREPAID',
});
const serviceOf = lookup<ServiceLevel>({
  standard: 'STANDARD', normal: 'STANDARD', 'عادي': 'STANDARD', 'عادى': 'STANDARD',
  'same day': 'SAME_DAY', sameday: 'SAME_DAY', 'same_day': 'SAME_DAY', 'نفس اليوم': 'SAME_DAY',
  express: 'EXPRESS', urgent: 'EXPRESS', 'سريع': 'EXPRESS', 'مستعجل': 'EXPRESS', 'اكسبريس': 'EXPRESS',
  scheduled: 'SCHEDULED', 'مجدول': 'SCHEDULED', 'بموعد': 'SCHEDULED',
});
const typeOf = lookup<OrderType>({
  delivery: 'DELIVERY', 'توصيل': 'DELIVERY', exchange: 'EXCHANGE', 'استبدال': 'EXCHANGE', 'تبديل': 'EXCHANGE',
  return: 'RETURN', 'مرتجع': 'RETURN', 'استرجاع': 'RETURN', 'cash collection': 'CASH_COLLECTION', cash_collection: 'CASH_COLLECTION', 'تحصيل': 'CASH_COLLECTION',
});
const feesOf = lookup<FeesPayer>({
  brand: 'BRAND', merchant: 'BRAND', seller: 'BRAND', 'التاجر': 'BRAND', 'الشركة': 'BRAND', 'البراند': 'BRAND', 'المتجر': 'BRAND',
  recipient: 'RECIPIENT', customer: 'RECIPIENT', receiver: 'RECIPIENT', 'العميل': 'RECIPIENT', 'المستلم': 'RECIPIENT',
});
const boolOf = lookup<'true' | 'false'>({
  yes: 'true', y: 'true', true: 'true', '1': 'true', 'نعم': 'true', 'اه': 'true', 'ايوه': 'true', 'ايوة': 'true', '✓': 'true',
  no: 'false', n: 'false', false: 'false', '0': 'false', 'لا': 'false', 'لأ': 'false',
});

export interface RowError {
  field: string | null;
  code: string;
  message: string;
}

export interface ValidatedRow {
  row: number;
  ok: boolean;
  errors: RowError[];
  input?: CreateOrderInput;
  preview?: {
    reference: string | null;
    recipientName: string;
    phone: string | null;
    address: string;
    paymentMethod: PaymentMethod;
    serviceLevel: ServiceLevel;
    type: OrderType;
    codAmountCents: number;
  };
  zone?: { id: string; code: string; nameEn: string; nameAr: string; method: string; confidence: number | null };
  fees?: { shippingFeeCents: number; codFeeCents: number; extraFeesCents: number; vatCents: number; totalFeesCents: number; collectCents: number; netToBrandCents: number };
}

/** Parses and validates bulk order uploads (CSV or JSON rows) and creates the valid rows. */
@Injectable()
export class OrdersBulkService {
  constructor(
    private readonly factory: OrderFactoryService,
    private readonly network: NetworkService,
  ) {}

  /** Decodes an uploaded CSV (UTF-8, falls back to Windows-1256 from Arabic Excel). */
  parseCsv(buffer: Buffer): Array<Record<string, unknown>> {
    let text = new TextDecoder('utf-8').decode(buffer);
    if (text.includes('�')) {
      try {
        text = new TextDecoder('windows-1256').decode(buffer);
      } catch {
        /* keep utf-8 */
      }
    }
    const parsed = Papa.parse<Record<string, unknown>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
    if (!parsed.meta.fields?.length) throw new DomainError('INVALID_CSV', 'The file has no header row', HttpStatus.BAD_REQUEST);
    const fatal = parsed.errors.find((e) => e.type === 'Delimiter' || e.code === 'UndetectableDelimiter');
    if (fatal && parsed.meta.fields.length < 2) throw new DomainError('INVALID_CSV', 'Could not read the CSV file — save it as "CSV UTF-8"', HttpStatus.BAD_REQUEST);
    return parsed.data;
  }

  /** CSV template with the canonical headers in English or Arabic and two sample rows. */
  template(lang: 'en' | 'ar' = 'en'): string {
    const fields: Field[] = [
      'reference', 'recipient_name', 'phone', 'alt_phone', 'address', 'building', 'floor', 'apartment', 'landmark', 'zone', 'cod_amount',
      'payment_method', 'service_level', 'type', 'weight_kg', 'items_count', 'description', 'fragile', 'allow_opening', 'declared_value',
      'fees_paid_by', 'notes', 'scheduled_date',
    ];
    const arabic: Record<string, string> = {
      reference: 'رقم الطلب', recipient_name: 'اسم المستلم', phone: 'رقم الموبايل', alt_phone: 'رقم بديل', address: 'العنوان', building: 'العمارة',
      floor: 'الدور', apartment: 'الشقة', landmark: 'علامة مميزة', zone: 'المنطقة', cod_amount: 'مبلغ التحصيل', payment_method: 'طريقة الدفع',
      service_level: 'نوع الخدمة', type: 'نوع الشحنة', weight_kg: 'الوزن', items_count: 'عدد القطع', description: 'المحتوى', fragile: 'قابل للكسر',
      allow_opening: 'يسمح بالفتح', declared_value: 'القيمة المعلنة', fees_paid_by: 'الرسوم على', notes: 'ملاحظات', scheduled_date: 'تاريخ التوصيل',
    };
    const header = fields.map((f) => (lang === 'ar' ? arabic[f] : f));
    const samples =
      lang === 'ar'
        ? [
            ['1001', 'محمد حسن', '01012345678', '', '١٢ شارع مكرم عبيد، مدينة نصر', '12', '3', '7', 'بجوار سيتي ستارز', '', '450', 'كاش', 'عادي', 'توصيل', '1', '1', 'تيشيرت', 'لا', 'نعم', '', 'التاجر', 'اتصل قبل الوصول', ''],
            ['1002', 'سارة أحمد', '01123456789', '', 'شارع ٩، المعادي', '', '', '', '', 'CAI-MAADI', '0', 'مدفوع', 'نفس اليوم', 'توصيل', '0.5', '2', 'كريمات', 'نعم', 'لا', '600', 'التاجر', '', ''],
          ]
        : [
            ['1001', 'Mohamed Hassan', '01012345678', '', '12 Makram Ebeid St, Nasr City', '12', '3', '7', 'Near City Stars', '', '450', 'COD', 'STANDARD', 'DELIVERY', '1', '1', 'T-shirt', 'no', 'yes', '', 'BRAND', 'Call before arrival', ''],
            ['1002', 'Sara Ahmed', '01123456789', '', 'Road 9, Maadi', '', '', '', '', 'CAI-MAADI', '0', 'PREPAID', 'SAME_DAY', 'DELIVERY', '0.5', '2', 'Skin care', 'yes', 'no', '600', 'BRAND', '', ''],
          ];
    return '﻿' + Papa.unparse({ fields: header, data: samples });
  }

  /** Validates every row (zone detection and fee preview included). Nothing is written. */
  async validate(rows: Array<Record<string, unknown>>, ctx: { brandId: string; source: CreateOrderInput['source']; pickupLocationId?: string | null }) {
    if (!rows.length) throw new DomainError('EMPTY_UPLOAD', 'The upload has no rows', HttpStatus.BAD_REQUEST);
    if (rows.length > BULK_MAX_ROWS) {
      throw new DomainError('TOO_MANY_ROWS', `At most ${BULK_MAX_ROWS} rows per upload (got ${rows.length}) — split the file`, HttpStatus.PAYLOAD_TOO_LARGE, { max: BULK_MAX_ROWS, got: rows.length });
    }
    const zones = await this.network.allZones();
    const seenRefs = new Map<string, number>();
    const out: ValidatedRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 1;
      const { input, errors } = this.mapRow(rows[i], ctx, zones);
      const result: ValidatedRow = { row: rowNo, ok: false, errors };
      if (input) {
        result.preview = {
          reference: input.brandReference ?? null,
          recipientName: input.recipient.name,
          phone: normalizeEgyptPhone(input.recipient.phone),
          address: input.address.line,
          paymentMethod: input.paymentMethod ?? 'COD',
          serviceLevel: input.serviceLevel ?? 'STANDARD',
          type: input.type ?? 'DELIVERY',
          codAmountCents: input.codAmountCents,
        };
        if (input.brandReference) {
          const first = seenRefs.get(input.brandReference);
          if (first) errors.push({ field: 'reference', code: 'DUPLICATE_REFERENCE', message: `Reference repeats row ${first}` });
          else seenRefs.set(input.brandReference, rowNo);
        }
      }
      if (input && !errors.length) {
        try {
          const prepared = await this.factory.prepare(input);
          if (input.brandReference) await this.factory.assertReferenceFree(ctx.brandId, input.brandReference);
          result.zone = {
            id: prepared.zone.id, code: prepared.zone.code, nameEn: prepared.zone.nameEn, nameAr: prepared.zone.nameAr,
            method: prepared.detection?.method ?? 'manual', confidence: prepared.detection?.confidence ?? null,
          };
          const q = prepared.quote;
          result.fees = {
            shippingFeeCents: q.shippingFeeCents, codFeeCents: q.codFeeCents, extraFeesCents: q.extraFeesCents, vatCents: q.vatCents,
            totalFeesCents: q.totalFeesCents, collectCents: q.collectFromRecipientCents, netToBrandCents: q.netToBrandCents,
          };
          result.input = input;
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          const details = (err.details ?? {}) as { field?: string; hint?: string };
          errors.push({ field: details.field ?? null, code: err.code, message: details.hint ? `${err.message}. ${details.hint}` : err.message });
        }
      }
      result.ok = errors.length === 0;
      out.push(result);
    }
    const valid = out.filter((r) => r.ok);
    return {
      total: out.length,
      valid: valid.length,
      invalid: out.length - valid.length,
      summary: {
        codCents: valid.reduce((s, r) => s + (r.preview?.codAmountCents ?? 0), 0),
        collectCents: valid.reduce((s, r) => s + (r.fees?.collectCents ?? 0), 0),
        feesCents: valid.reduce((s, r) => s + (r.fees?.totalFeesCents ?? 0), 0),
      },
      rows: out,
    };
  }

  /** Creates the valid rows (one transaction each) and reports per-row results. */
  async create(rows: Array<Record<string, unknown>>, ctx: { brandId: string; source: CreateOrderInput['source']; pickupLocationId?: string | null }, actor: ActorContext) {
    const checked = await this.validate(rows, ctx);
    const results: Array<{ row: number; ok: boolean; orderId?: string; trackingNumber?: string; collectCents?: number; totalFeesCents?: number; errors: RowError[] }> = [];
    for (const r of checked.rows) {
      if (!r.ok || !r.input) {
        results.push({ row: r.row, ok: false, errors: r.errors });
        continue;
      }
      try {
        const created = await this.factory.create(r.input, actor);
        results.push({ row: r.row, ok: true, orderId: created.id, trackingNumber: created.trackingNumber, collectCents: created.collectCents, totalFeesCents: created.totalFeesCents, errors: [] });
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        const details = (err.details ?? {}) as { field?: string };
        results.push({ row: r.row, ok: false, errors: [{ field: details.field ?? null, code: err.code, message: err.message }] });
      }
    }
    const created = results.filter((r) => r.ok).length;
    return { total: results.length, created, failed: results.length - created, rows: results };
  }

  /** Maps one raw row (any header language) to a CreateOrderInput, collecting field errors. */
  mapRow(raw: Record<string, unknown>, ctx: { brandId: string; source: CreateOrderInput['source']; pickupLocationId?: string | null }, zones: ZoneInfo[]): { input?: CreateOrderInput; errors: RowError[] } {
    const errors: RowError[] = [];
    const v: Partial<Record<Field, string>> = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      const field = HEADER_INDEX.get(headerKey(key));
      if (!field || value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text) v[field] = text;
    }
    const err = (field: string, code: string, message: string) => errors.push({ field, code, message });

    const name = v.recipient_name ?? '';
    if (name.length < 2) err('recipient_name', 'REQUIRED', 'Recipient name is required');
    const phoneRaw = v.phone ?? '';
    if (!phoneRaw) err('phone', 'REQUIRED', 'Phone is required');
    else if (!normalizeEgyptPhone(phoneRaw)) err('phone', 'INVALID_PHONE', `"${phoneRaw}" is not a valid Egyptian mobile number`);
    if (v.alt_phone && !normalizeEgyptPhone(v.alt_phone)) err('alt_phone', 'INVALID_PHONE', `"${v.alt_phone}" is not a valid Egyptian mobile number`);
    const address = v.address ?? '';
    if (address.length < 5) err('address', 'REQUIRED', 'Address is required (at least 5 characters)');

    let codAmountCents = 0;
    if (v.cod_amount) {
      const amount = parseAmount(v.cod_amount);
      if (amount === null || amount < 0) err('cod_amount', 'INVALID_AMOUNT', `"${v.cod_amount}" is not a valid amount`);
      else codAmountCents = egpToCents(amount);
      if (codAmountCents > MAX_COD_CENTS) err('cod_amount', 'INVALID_AMOUNT', 'COD amount is too large');
    }
    let paymentMethod: PaymentMethod = codAmountCents > 0 ? 'COD' : 'PREPAID';
    if (v.payment_method) {
      const pm = paymentOf(v.payment_method);
      if (!pm) err('payment_method', 'INVALID_VALUE', `Unknown payment method "${v.payment_method}" (COD / PREPAID)`);
      else paymentMethod = pm;
    }
    const pick = <T>(field: Field, fn: (s: string) => T | undefined, label: string): T | undefined => {
      const s = v[field];
      if (!s) return undefined;
      const out = fn(s);
      if (out === undefined) err(field, 'INVALID_VALUE', `Unknown ${label} "${s}"`);
      return out;
    };
    const serviceLevel = pick('service_level', serviceOf, 'service level');
    const type = pick('type', typeOf, 'order type');
    const feesPaidBy = pick('fees_paid_by', feesOf, 'fees payer (BRAND / RECIPIENT)');
    const bool = (field: Field) => {
      const b = pick(field, boolOf, 'yes/no value');
      return b === undefined ? undefined : b === 'true';
    };
    const isFragile = bool('fragile');
    const allowOpening = bool('allow_opening');
    const otp = bool('otp_required');

    let weightGrams: number | undefined;
    if (v.weight_kg) {
      const kg = parseAmount(v.weight_kg);
      if (kg === null || kg <= 0 || kg > 100) err('weight_kg', 'INVALID_VALUE', 'Weight must be between 0 and 100 kg');
      else weightGrams = Math.max(1, Math.round(kg * 1000));
    }
    let itemsCount: number | undefined;
    if (v.items_count) {
      const n = Number(toLatinDigits(v.items_count));
      if (!Number.isInteger(n) || n < 1 || n > 999) err('items_count', 'INVALID_VALUE', 'Items count must be a whole number between 1 and 999');
      else itemsCount = n;
    }
    let declaredValueCents: number | undefined;
    if (v.declared_value) {
      const amount = parseAmount(v.declared_value);
      if (amount === null || amount < 0) err('declared_value', 'INVALID_AMOUNT', `"${v.declared_value}" is not a valid amount`);
      else declaredValueCents = egpToCents(amount);
    }
    let scheduledDate: string | undefined;
    if (v.scheduled_date) {
      const d = parseDay(v.scheduled_date);
      if (!d) err('scheduled_date', 'INVALID_DATE', 'Use YYYY-MM-DD or DD/MM/YYYY');
      else scheduledDate = d;
    }
    let zoneId: string | undefined;
    if (v.zone) {
      const z = matchZone(zones, v.zone);
      if (!z) err('zone', 'INVALID_ZONE', `Unknown zone "${v.zone}" — use a zone code like CAI-NASR or leave it empty to detect from the address`);
      else zoneId = z.id;
    }
    for (const [field, max] of [['reference', 100], ['building', 50], ['floor', 20], ['apartment', 20], ['landmark', 200], ['description', 500], ['notes', 1000], ['external_id', 100]] as const) {
      if ((v[field]?.length ?? 0) > max) err(field, 'TOO_LONG', `${field} must be at most ${max} characters`);
    }
    if (name.length > 150) err('recipient_name', 'TOO_LONG', 'Recipient name must be at most 150 characters');
    if (address.length > 500) err('address', 'TOO_LONG', 'Address must be at most 500 characters');

    if (!name || !phoneRaw || address.length < 5) return { errors };
    const input: CreateOrderInput = {
      brandId: ctx.brandId,
      brandReference: v.reference ? toLatinDigits(v.reference) : null,
      type,
      serviceLevel,
      source: ctx.source,
      recipient: { name, phone: phoneRaw, altPhone: v.alt_phone ?? null },
      address: { line: address, building: v.building ?? null, floor: v.floor ?? null, apartment: v.apartment ?? null, landmark: v.landmark ?? null, zoneId: zoneId ?? null },
      package: { description: v.description ?? null, itemsCount, weightGrams, isFragile, allowOpening, declaredValueCents },
      paymentMethod,
      codAmountCents: paymentMethod === 'PREPAID' ? 0 : codAmountCents,
      feesPaidBy,
      pickupLocationId: ctx.pickupLocationId ?? null,
      scheduledDate: scheduledDate ?? null,
      notes: v.notes ?? null,
      deliveryOtpRequired: otp,
      externalId: v.external_id ?? null,
    };
    if (paymentMethod === 'PREPAID' && codAmountCents > 0) err('cod_amount', 'INVALID_COD', 'Prepaid orders cannot have a COD amount');
    return { input, errors };
  }
}

/** "1,250.50", "١٢٥٠٫٥", "450 ج.م", "EGP 99" → number (EGP). */
export function parseAmount(raw: string): number | null {
  const s = toLatinDigits(raw).replace(/٫/g, '.').replace(/[٬,\s]/g, '').replace(/(egp|le|l\.e\.?|ج\.?م\.?|جنيه|جنية)/gi, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-11-02", "02/11/2026", "2/11/2026" → "2026-11-02". */
export function parseDay(raw: string): string | null {
  const s = toLatinDigits(raw).trim();
  if (isDay(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  const day = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDay(day) ? day : null;
}

function matchZone(zones: ZoneInfo[], raw: string): ZoneInfo | null {
  const upper = raw.trim().toUpperCase();
  const byCode = zones.find((z) => z.code === upper);
  if (byCode) return byCode;
  const key = normalizeText(raw);
  return zones.find((z) => normalizeText(z.nameEn) === key || normalizeText(z.nameAr) === key) ?? null;
}
