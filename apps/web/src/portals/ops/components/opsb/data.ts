import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isValidEgyptPhone } from '@goturtle/shared';
import { api, ApiError, type Paginated } from '@/lib/api';
import { errorMessage, translate, useI18n } from '@/i18n';
import './i18n';

/* ───────────────────────────── Reference data ───────────────────────────── */

export type HubLite = { id: string; code: string; name: string; nameAr?: string | null; lat: number | null; lng: number | null; isActive: boolean }
export type ZoneLite = { id: string; code: string; nameEn: string; nameAr: string; tier: string; city?: { code: string; nameEn: string; nameAr: string } }
export type CourierLite = { id: string; code: string; name: string; phone: string; employmentType: string; status: string; homeHubId: string | null; cashOnHandCents: number; cashLimitCents: number; hourlyRate?: number }
export type BrandLite = { id: string; code: string; name: string; status: string }
export type StaffLite = { id: string; name: string; role: string }

export function useHubs() {
  return useQuery({ queryKey: ['opsb', 'hubs'], queryFn: () => api<HubLite[]>('/network/hubs'), staleTime: 5 * 60_000 });
}

export function useZones() {
  return useQuery({ queryKey: ['opsb', 'zones'], queryFn: () => api<ZoneLite[]>('/network/zones/serviceable'), staleTime: 5 * 60_000 });
}

/** All heroes (bounded list for pickers). */
export function useCourierOptions(enabled = true) {
  return useQuery({
    queryKey: ['opsb', 'courier-options'],
    queryFn: () => api<Paginated<CourierLite>>('/couriers', { query: { pageSize: 100, sort: 'code' } }).then((r) => r.data),
    staleTime: 60_000,
    enabled,
  });
}

export function useBrandOptions(enabled = true) {
  return useQuery({
    queryKey: ['opsb', 'brand-options'],
    queryFn: () => api<Paginated<BrandLite>>('/brands', { query: { pageSize: 100 } }).then((r) => r.data),
    staleTime: 60_000,
    enabled,
  });
}

export function useStaffOptions(enabled = true) {
  return useQuery({
    queryKey: ['opsb', 'staff-options'],
    queryFn: () => api<Paginated<StaffLite>>('/users', { query: { pageSize: 100, kind: 'staff', status: 'ACTIVE' } }).then((r) => r.data),
    staleTime: 60_000,
    enabled,
  });
}

/** Localised hub name by id (falls back to the given name). */
export function useHubName() {
  const hubs = useHubs();
  const { locale } = useI18n();
  return useCallback(
    (id: string | null | undefined, fallback?: string | null) => {
      const h = hubs.data?.find((x) => x.id === id);
      if (!h) return fallback ?? '—';
      return (locale === 'ar' ? h.nameAr : null) || h.name;
    },
    [hubs.data, locale],
  );
}

/* ───────────────────────────── Labels ───────────────────────────── */

/** Translates an enum value: en('VehicleType', 'MOTORCYCLE'). */
export function useEnumLabel() {
  const { t } = useI18n();
  return useCallback((group: string, value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? '—' : t(`ops.opsb.enum.${group}.${value}`)), [t]);
}

export function enumOptions(group: string, values: readonly string[]) {
  return values.map((v) => ({ value: v, label: translate(`ops.opsb.enum.${group}.${v}`) }));
}

/* ───────────────────────────── Forms ───────────────────────────── */

export type Errors = Record<string, string | undefined>;

/**
 * Minimal controlled-form state: values, field errors, and a helper that maps
 * an API error onto fields (class-validator messages start with the property
 * path; domain errors are mapped with `codeFields`).
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key as string] ? { ...e, [key as string]: undefined } : e));
  }, []);
  const patch = useCallback((p: Partial<T>) => setValues((v) => ({ ...v, ...p })), []);
  const reset = useCallback((next?: T) => {
    setValues(next ?? initial);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { values, set, patch, errors, setErrors, reset };
}

/** Pulls per-field errors out of an ApiError. Returns {} when nothing maps. */
export function apiFieldErrors(err: unknown, fields: string[], codeFields: Record<string, string> = {}): Errors {
  const out: Errors = {};
  if (!(err instanceof ApiError)) return out;
  if (codeFields[err.code]) out[codeFields[err.code]] = errorMessage(err);
  const details = err.details as { errors?: Array<{ field: string; message: string }> } | undefined;
  details?.errors?.forEach((e) => {
    if (fields.includes(e.field)) out[e.field] = e.message;
  });
  for (const msg of err.message.split(' · ')) {
    const path = msg.split(' ')[0] ?? '';
    const match = fields.find((f) => path === f || path.endsWith(`.${f}`) || path.startsWith(`${f}.`));
    if (match && !out[match]) out[match] = msg;
  }
  return out;
}

/* ───────────────────────────── Validators ───────────────────────────── */

export const v = {
  required: (s: string | null | undefined) => (s ?? '').toString().trim().length > 0,
  min: (s: string, n: number) => s.trim().length >= n,
  phone: (s: string) => isValidEgyptPhone(s),
  email: (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()),
};

/* ───────────────────────────── Dates ───────────────────────────── */

/** Cairo calendar day YYYY-MM-DD for an instant. */
export function cairoDay(d: Date | string = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

/** Cairo HH:MM for an instant. */
export function cairoHm(d: Date | string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

export function addDaysStr(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayOfStr = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Sunday-based week start (matches the API's default week). */
export function weekStart(day: string) {
  return addDaysStr(day, -weekdayOfStr(day));
}

export function monthStart(day: string) {
  return `${day.slice(0, 8)}01`;
}

export function monthEnd(day: string) {
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 8)}${String(last).padStart(2, '0')}`;
}

/**
 * UTC ISO instant for a Cairo wall-clock time on a Cairo day (DST aware):
 * probe the offset Cairo has at that moment.
 */
export function cairoToIso(day: string, hm: string) {
  const guess = new Date(`${day}T${hm}:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asCairo = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  const offset = asCairo - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export function minutesLabel(min: number | null | undefined) {
  const m = Math.max(0, Math.round(min ?? 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}:${String(r).padStart(2, '0')}` : `0:${String(r).padStart(2, '0')}`;
}
