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

export interface SettingsMap {
  company: CompanySettings;
  notifications: NotificationSettings;
  operations: OperationsSettings;
  branding: BrandingSettings;
  integrity: IntegritySettings;
}
export type SettingKey = keyof SettingsMap;

type FieldSpec =
  | { type: 'string'; max: number; pattern?: RegExp; format?: 'email' | 'url' | 'mobile' | 'phone' }
  | { type: 'boolean' }
  | { type: 'int'; min: number; max: number }
  | { type: 'enum'; values: readonly string[] };

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
};

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
  if (spec.type !== 'string') return value;
  const v = String(value).trim();
  if (spec.format === 'mobile' && v) return normalizeEgyptPhone(v);
  if (spec.format === 'email') return v.toLowerCase();
  return v;
}
