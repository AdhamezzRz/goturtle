import { HttpStatus } from '@nestjs/common';
import type { OrderStatus } from '@goturtle/shared';
import { DomainError } from '../../common/errors';
import { cairoDateTime, cairoToday } from '../../db/helpers';

/**
 * Small, dependency-free helpers shared by the workforce & finance modules
 * (couriers, hero, shifts, cash, finance, gamification). All "days" are Cairo
 * business days as 'YYYY-MM-DD' strings; all instants are UTC Dates.
 */

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Orders physically in a hero's hands / on their runsheet right now. */
export const HERO_ACTIVE_ORDER_STATUSES: OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY', 'RETURN_OUT'];

/** Validates a Cairo day string (format and calendar validity). */
export function assertDay(day: string, field = 'date'): string {
  if (!DAY_PATTERN.test(day)) throw new DomainError('INVALID_DATE', `${field} must be YYYY-MM-DD`, HttpStatus.BAD_REQUEST);
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) {
    throw new DomainError('INVALID_DATE', `${field} is not a valid calendar date`, HttpStatus.BAD_REQUEST);
  }
  return day;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a calendar day. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Whole days from a to b (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Inclusive list of days from → to. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** UTC instant of 00:00 Cairo time on that day (DST aware). */
export const cairoDayStart = (day: string) => cairoDateTime(day, '00:00');

/** [start, end) UTC bounds of a Cairo business day. */
export function cairoDayRange(day: string): { start: Date; end: Date } {
  return { start: cairoDayStart(day), end: cairoDayStart(addDays(day, 1)) };
}

/** The Sunday that starts the (Sunday–Saturday) week containing `day`. */
export function weekStartOf(day: string): string {
  return addDays(day, -weekdayOf(day));
}

export const monthStartOf = (day: string) => `${day.slice(0, 7)}-01`;

export function daysInMonth(day: string): number {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Resolves an optional from/to day pair into UTC bounds: [start of from, end of to).
 * Defaults to the last `defaultDays` days ending today (Cairo).
 */
export function resolveDayRange(from: string | undefined, to: string | undefined, defaultDays = 30, maxDays = 366) {
  const toDay = to ? assertDay(to, 'to') : cairoToday();
  const fromDay = from ? assertDay(from, 'from') : addDays(toDay, -(defaultDays - 1));
  if (fromDay > toDay) throw new DomainError('INVALID_RANGE', '`from` must be on or before `to`', HttpStatus.BAD_REQUEST);
  if (dayDiff(fromDay, toDay) + 1 > maxDays) throw new DomainError('RANGE_TOO_LARGE', `The range may cover at most ${maxDays} days`, HttpStatus.BAD_REQUEST);
  return { from: fromDay, to: toDay, start: cairoDayStart(fromDay), end: cairoDayStart(addDays(toDay, 1)) };
}

/** Percentage with one decimal (0 when the base is 0). */
export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : 0);

export const hoursBetween = (from: Date, to: Date) => Math.max(0, Math.round(((to.getTime() - from.getTime()) / HOUR_MS) * 10) / 10);

export const toNumber = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Escapes a value for CSV (RFC 4180). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',');

/** Piasters → "1234.50" for CSV exports. */
export const egp = (cents: number) => (cents / 100).toFixed(2);

/** Cash usage warning band for a hero's custody. */
export function cashWarning(onHand: number, limit: number): 'OK' | 'NEAR_LIMIT' | 'OVER_LIMIT' {
  if (limit <= 0) return onHand > 0 ? 'OVER_LIMIT' : 'OK';
  if (onHand >= limit) return 'OVER_LIMIT';
  if (onHand >= limit * 0.8) return 'NEAR_LIMIT';
  return 'OK';
}
