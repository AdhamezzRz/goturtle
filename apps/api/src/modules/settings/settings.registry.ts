import { HttpStatus } from '@nestjs/common';
import { normalizeEgyptPhone } from '@goturtle/shared';
import { DomainError } from '../../common/errors';

/**
 * Typed registry of the system settings stored in `system_settings`.
 * Each key holds one JSON object. Values are validated field by field and
 * merged over the defaults, so readers always get a complete object even
 * before an admin saved anything.
 */
export interface CompanySettings {
  name: string;
  legalName: string;
  taxId: string;
  address: string;
  supportPhone: string;
  supportWhatsapp: string;
  email: string;
  logoUrl: string;
}

export interface NotificationSettings {
  /** SMS/WhatsApp the recipient when a brand books the shipment. */
  customerSmsOnCreated: boolean;
  onOutForDelivery: boolean;
  onDelivered: boolean;
  onFailed: boolean;
  onReturned: boolean;
  /** Channel used for customer order updates (OTP codes always go by SMS). */
  channel: 'SMS' | 'WHATSAPP';
}

export interface OperationsSettings {
  maxAttempts: number;
  autoReturnOnRefusal: boolean;
  /** COD above this amount requires a delivery OTP (0 = never). */
  deliveryOtpForCodAboveCents: number;
  defaultCashLimitCents: number;
  /** Cairo hour after which pickup requests roll to the next day. */
  pickupCutoffHour: number;
}

export interface BrandingSettings {
  primaryColor: string;
}

/** Delivery integrity: RTO shield (confirmations, holds, prepayment) and failed-attempt proof. */
export interface IntegritySettings {
  /** Ask risky / high-COD recipients to confirm before dispatch. */
  confirmationEnabled: boolean;
  /** Ask for confirmation at or above this COD risk score. */
  confirmAboveRisk: number;
  /** …or when the COD amount is at least this (piasters). */
  confirmCodAboveCents: number;
  /** Unconfirmed orders at or above this risk are held and cannot be dispatched. */
  holdUnconfirmedAboveRisk: number;
  /** Hours without a reply before a confirmation counts as NO_RESPONSE. */
  noResponseAfterHours: number;
  /** COD orders at or above this risk are held until the brand collects online (100 = only the maximum score). */
  prepayAboveRisk: number;
  /** A hero must be this close to the pin to report a failed attempt (0 = off). */
  failedAttemptGeofenceMeters: number;
  /** Logged calls required before "customer unreachable / not present" (0 = off). */
  unreachableMinCalls: number;
  /** Minimum minutes between two counted calls. */
  unreachableMinSpacingMinutes: number;
  /** Hours the customer has to dispute a failed attempt. */
  attemptDisputeWindowHours: number;
  /** Ask recipients without a map pin to share their location before delivery. */
  requestPinWhenMissing: boolean;
  /** Channel for confirmation, attempt verification and location requests. */
  confirmationChannel: 'WHATSAPP' | 'SMS';
}

export interface FinanceSettings {
  /** Company InstaPay address shown to recipients paying at the door. */
  instapayAddress: string;
  /** Company mobile wallet (Vodafone Cash, Orange Cash …) for door payments. */
  walletNumber: string;
  acceptedCollectionMethods: Array<'CASH' | 'INSTAPAY' | 'WALLET' | 'CARD' | 'PAYMENT_LINK'>;
  /** Fee on early payouts of the wallet balance, basis points (100 = 1 %). */
  earlyPayoutFeeBp: number;
  /** Fee on advances against in-transit COD, basis points. */
  codAdvanceFeeBp: number;
  /** Max share of in-transit COD that can be advanced, basis points (5000 = 50 %). */
  codAdvanceMaxRateBp: number;
  advanceMinCents: number;
  /** Liability cap for claims when the order has no declared value. */
  claimDefaultCapCents: number;
  /** Damaged / missing / wrong item claims must be filed within this many hours of delivery or return. */
  claimWindowHours: number;
  weightToleranceGrams: number;
  weightTolerancePct: number;
  /** Volumetric weight (kg) = L × W × H (cm) / divisor. */
  volumetricDivisor: number;
  weightDisputeWindowHours: number;
}

/** A demand multiplier for a date range (Ramadan, White Friday, Eid …), Cairo days inclusive. */
export interface ForecastEvent {
  name: string;
  from: string;
  to: string;
  multiplier: number;
}

export interface PlatformSettings {
  /** Parcels one hero delivers in a shift — staffing = ceil(forecast / this). */
  ordersPerHeroPerShift: number;
  forecastEvents: ForecastEvent[];
  /** Default per-parcel fee owed to a partner carrier (piasters) when the partner has none. */
  partnerFeeCents: number;
  /** Travel-time source for route optimisation (osrm / google need OSRM_URL / GOOGLE_MAPS_API_KEY). */
  routingProvider: 'haversine' | 'osrm' | 'google';
}

export interface SettingsMap {
  company: CompanySettings;
  notifications: NotificationSettings;
  operations: OperationsSettings;
  branding: BrandingSettings;
  integrity: IntegritySettings;
  finance: FinanceSettings;
  platform: PlatformSettings;
}
export type SettingKey = keyof SettingsMap;

type FieldSpec =
  | { type: 'string'; max: number; pattern?: RegExp; format?: 'email' | 'url' | 'mobile' | 'phone' }
  | { type: 'boolean' }
  | { type: 'int'; min: number; max: number }
  | { type: 'enum'; values: readonly string[] }
  /** A set of enum values (stored de-duplicated, in the order of `values`). */
  | { type: 'enumList'; values: readonly string[]; minItems?: number }
  /** JSON array; `item` returns an error message for an invalid element (null = valid). */
  | { type: 'list'; max: number; item: (value: unknown) => string | null };

interface SettingDefinition<T> {
  description: string;
  defaults: T;
  fields: { [K in keyof T]: FieldSpec };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/|\/)[^\s]*$/;
const PHONE = /^\+?[0-9][0-9 -]{2,19}$/;

export const SETTINGS: { [K in SettingKey]: SettingDefinition<SettingsMap[K]> } = {
  company: {
    description: 'Company profile shown on labels, invoices, emails and the tracking page',
    defaults: {
      name: 'GoTurtle',
      legalName: 'GoTurtle Logistics S.A.E.',
      taxId: '',
      address: 'Cairo, Egypt',
      supportPhone: '',
      supportWhatsapp: '',
      email: '',
      logoUrl: '',
    },
    fields: {
      name: { type: 'string', max: 120 },
      legalName: { type: 'string', max: 200 },
      taxId: { type: 'string', max: 50 },
      address: { type: 'string', max: 300 },
      supportPhone: { type: 'string', max: 20, format: 'phone' },
      supportWhatsapp: { type: 'string', max: 20, format: 'mobile' },
      email: { type: 'string', max: 191, format: 'email' },
      logoUrl: { type: 'string', max: 500, format: 'url' },
    },
  },
  notifications: {
    description: 'Which order updates are sent to recipients, and on which channel',
    defaults: {
      customerSmsOnCreated: false,
      onOutForDelivery: true,
      onDelivered: true,
      onFailed: true,
      onReturned: false,
      channel: 'SMS',
    },
    fields: {
      customerSmsOnCreated: { type: 'boolean' },
      onOutForDelivery: { type: 'boolean' },
      onDelivered: { type: 'boolean' },
      onFailed: { type: 'boolean' },
      onReturned: { type: 'boolean' },
      channel: { type: 'enum', values: ['SMS', 'WHATSAPP'] },
    },
  },
  operations: {
    description: 'Delivery rules used by operations (attempts, OTP threshold, cash limits, cut-offs)',
    defaults: {
      maxAttempts: 3,
      autoReturnOnRefusal: true,
      deliveryOtpForCodAboveCents: 500_000,
      defaultCashLimitCents: 500_000,
      pickupCutoffHour: 15,
    },
    fields: {
      maxAttempts: { type: 'int', min: 1, max: 10 },
      autoReturnOnRefusal: { type: 'boolean' },
      deliveryOtpForCodAboveCents: { type: 'int', min: 0, max: 100_000_000 },
      defaultCashLimitCents: { type: 'int', min: 0, max: 100_000_000 },
      pickupCutoffHour: { type: 'int', min: 0, max: 23 },
    },
  },
  branding: {
    description: 'Portal and tracking page branding',
    defaults: { primaryColor: '#1E8E5A' },
    fields: { primaryColor: { type: 'string', max: 7, pattern: /^#[0-9A-Fa-f]{6}$/ } },
  },
  integrity: {
    description: 'Delivery integrity: customer confirmation before dispatch, holds, prepayment and failed-attempt proof',
    defaults: {
      confirmationEnabled: true,
      confirmAboveRisk: 30,
      confirmCodAboveCents: 150_000,
      holdUnconfirmedAboveRisk: 60,
      noResponseAfterHours: 20,
      prepayAboveRisk: 85,
      failedAttemptGeofenceMeters: 300,
      unreachableMinCalls: 2,
      unreachableMinSpacingMinutes: 3,
      attemptDisputeWindowHours: 24,
      requestPinWhenMissing: true,
      confirmationChannel: 'WHATSAPP',
    },
    fields: {
      confirmationEnabled: { type: 'boolean' },
      confirmAboveRisk: { type: 'int', min: 0, max: 100 },
      confirmCodAboveCents: { type: 'int', min: 0, max: 100_000_000 },
      holdUnconfirmedAboveRisk: { type: 'int', min: 0, max: 100 },
      noResponseAfterHours: { type: 'int', min: 1, max: 168 },
      prepayAboveRisk: { type: 'int', min: 1, max: 100 },
      failedAttemptGeofenceMeters: { type: 'int', min: 0, max: 5000 },
      unreachableMinCalls: { type: 'int', min: 0, max: 5 },
      unreachableMinSpacingMinutes: { type: 'int', min: 0, max: 60 },
      attemptDisputeWindowHours: { type: 'int', min: 1, max: 168 },
      requestPinWhenMissing: { type: 'boolean' },
      confirmationChannel: { type: 'enum', values: ['WHATSAPP', 'SMS'] },
    },
  },
  finance: {
    description: 'Digital payment at the door, early payouts & COD advances, claims and hub weighing rules',
    defaults: {
      instapayAddress: '',
      walletNumber: '',
      acceptedCollectionMethods: ['CASH', 'INSTAPAY', 'WALLET', 'CARD', 'PAYMENT_LINK'],
      earlyPayoutFeeBp: 100,
      codAdvanceFeeBp: 250,
      codAdvanceMaxRateBp: 5000,
      advanceMinCents: 10_000,
      claimDefaultCapCents: 500_000,
      claimWindowHours: 72,
      weightToleranceGrams: 200,
      weightTolerancePct: 10,
      volumetricDivisor: 5000,
      weightDisputeWindowHours: 48,
    },
    fields: {
      instapayAddress: { type: 'string', max: 120, pattern: /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$|^\+?[0-9 ]{8,20}$/ },
      walletNumber: { type: 'string', max: 20, format: 'mobile' },
      acceptedCollectionMethods: { type: 'enumList', values: ['CASH', 'INSTAPAY', 'WALLET', 'CARD', 'PAYMENT_LINK'], minItems: 1 },
      earlyPayoutFeeBp: { type: 'int', min: 0, max: 2000 },
      codAdvanceFeeBp: { type: 'int', min: 0, max: 2000 },
      codAdvanceMaxRateBp: { type: 'int', min: 0, max: 9000 },
      advanceMinCents: { type: 'int', min: 100, max: 100_000_000 },
      claimDefaultCapCents: { type: 'int', min: 0, max: 100_000_000 },
      claimWindowHours: { type: 'int', min: 1, max: 2160 },
      weightToleranceGrams: { type: 'int', min: 0, max: 50_000 },
      weightTolerancePct: { type: 'int', min: 0, max: 100 },
      volumetricDivisor: { type: 'int', min: 1000, max: 10_000 },
      weightDisputeWindowHours: { type: 'int', min: 1, max: 720 },
    },
  },
  platform: {
    description: 'Demand forecast & staffing, partner carriers and route optimisation',
    defaults: { ordersPerHeroPerShift: 25, forecastEvents: [], partnerFeeCents: 4000, routingProvider: 'haversine' },
    fields: {
      ordersPerHeroPerShift: { type: 'int', min: 1, max: 500 },
      forecastEvents: { type: 'list', max: 50, item: checkForecastEvent },
      partnerFeeCents: { type: 'int', min: 0, max: 1_000_000 },
      routingProvider: { type: 'enum', values: ['haversine', 'osrm', 'google'] },
    },
  },
};

function checkForecastEvent(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Each event must be an object';
  const e = v as Record<string, unknown>;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 80) return 'Event name is required (max 80 characters)';
  if (typeof e.from !== 'string' || !day.test(e.from) || typeof e.to !== 'string' || !day.test(e.to)) return 'Event dates must be YYYY-MM-DD';
  if (e.to < e.from) return 'Event end date is before its start';
  if (typeof e.multiplier !== 'number' || !Number.isFinite(e.multiplier) || e.multiplier < 0 || e.multiplier > 10) return 'Multiplier must be between 0 and 10';
  return Object.keys(e).some((k) => !['name', 'from', 'to', 'multiplier'].includes(k)) ? 'Unknown event field' : null;
}

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as string[]).includes(key);

/** Fields of each setting that are safe to expose on the public (unauthenticated) endpoint. */
export const PUBLIC_SETTINGS = {
  company: ['name', 'supportPhone', 'supportWhatsapp', 'logoUrl', 'email'],
  branding: ['primaryColor'],
} as const;

/** Defaults merged with whatever is stored (ignores unknown / invalid stored fields). */
export function withDefaults<K extends SettingKey>(key: K, stored: unknown): SettingsMap[K] {
  const def = SETTINGS[key];
  const out = { ...def.defaults } as Record<string, unknown>;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [field, value] of Object.entries(stored as Record<string, unknown>)) {
      const spec = (def.fields as Record<string, FieldSpec>)[field];
      if (spec && checkField(spec, value) === null) out[field] = normalizeField(spec, value);
    }
  }
  return out as unknown as SettingsMap[K];
}

/**
 * Validates a partial update and returns the complete merged value.
 * Throws INVALID_SETTING (400) with per-field errors.
 */
export function validateSetting<K extends SettingKey>(key: K, patch: unknown, current: SettingsMap[K]): SettingsMap[K] {
  const def = SETTINGS[key];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new DomainError('INVALID_SETTING', `Setting "${key}" must be an object`, HttpStatus.BAD_REQUEST);
  }
  const errors: Array<{ field: string; message: string }> = [];
  const out = { ...current } as Record<string, unknown>;
  for (const [field, value] of Object.entries(patch as Record<string, unknown>)) {
    const spec = (def.fields as Record<string, FieldSpec>)[field];
    if (!spec) {
      errors.push({ field, message: 'Unknown field' });
      continue;
    }
    const problem = checkField(spec, value);
    if (problem) errors.push({ field, message: problem });
    else out[field] = normalizeField(spec, value);
  }
  if (errors.length) {
    throw new DomainError('INVALID_SETTING', `Invalid value for setting "${key}"`, HttpStatus.BAD_REQUEST, { errors });
  }
  return out as unknown as SettingsMap[K];
}

function checkField(spec: FieldSpec, value: unknown): string | null {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Must be true or false';
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'Must be an integer';
      return value < spec.min || value > spec.max ? `Must be between ${spec.min} and ${spec.max}` : null;
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value) ? null : `Must be one of ${spec.values.join(', ')}`;
    case 'enumList':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !spec.values.includes(v))) return `Must be a list of ${spec.values.join(', ')}`;
      return new Set(value).size < (spec.minItems ?? 0) ? `Choose at least ${spec.minItems}` : null;
    case 'list': {
      if (!Array.isArray(value)) return 'Must be a list';
      if (value.length > spec.max) return `At most ${spec.max} entries`;
      for (const [i, item] of value.entries()) {
        const problem = spec.item(item);
        if (problem) return `Entry ${i + 1}: ${problem}`;
      }
      return null;
    }
    case 'string': {
      if (typeof value !== 'string') return 'Must be a string';
      const v = value.trim();
      if (v.length > spec.max) return `At most ${spec.max} characters`;
      if (!v) return null; // empty clears optional text
      if (spec.pattern && !spec.pattern.test(v)) return 'Invalid format';
      if (spec.format === 'email' && !EMAIL.test(v)) return 'Must be a valid email';
      if (spec.format === 'url' && !URL_RE.test(v)) return 'Must be an http(s) URL or an absolute path';
      if (spec.format === 'phone' && !PHONE.test(v)) return 'Must be a phone number';
      if (spec.format === 'mobile' && !normalizeEgyptPhone(v)) return 'Must be a valid Egyptian mobile number';
      return null;
    }
  }
}

function normalizeField(spec: FieldSpec, value: unknown): unknown {
  if (spec.type === 'enumList') return spec.values.filter((v) => (value as string[]).includes(v));
  if (spec.type === 'list') return (value as unknown[]).map((v) => (v && typeof v === 'object' && 'name' in v ? { ...(v as object), name: String((v as { name: unknown }).name).trim() } : v));
  if (spec.type !== 'string') return value;
  const v = String(value).trim();
  if (spec.format === 'mobile' && v) return normalizeEgyptPhone(v);
  if (spec.format === 'email') return v.toLowerCase();
  return v;
}
