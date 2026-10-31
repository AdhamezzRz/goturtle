import { ForbiddenException, HttpStatus, Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Permission } from '@goturtle/shared';
import type { ActorContext } from '../../common/actor';
import { DomainError } from '../../common/errors';
import type { Principal } from '../../common/principal';
import { cairoDateTime, cairoToday } from '../../db/helpers';

/**
 * Small helpers shared by the operations modules (network, pricing, customers,
 * orders, pickups, dispatch, hero-tasks, tracking). Pure functions only — no DI.
 */

/**
 * Collects domain events raised inside a database transaction so they can be
 * emitted only AFTER the transaction commits (listeners never see rolled-back data).
 */
export class PostCommit {
  private readonly items: Array<{ event: string; payload: unknown }> = [];

  emit(event: string, payload: unknown): void {
    this.items.push({ event, payload });
  }

  get size(): number {
    return this.items.length;
  }

  flush(emitter: EventEmitter2, log?: Logger): void {
    const items = this.items.splice(0, this.items.length);
    for (const item of items) {
      try {
        emitter.emit(item.event, item.payload);
      } catch (err) {
        (log ?? new Logger('PostCommit')).error(`listener for ${item.event} failed`, err instanceof Error ? err.stack : String(err));
      }
    }
  }
}

/**
 * AuditService.record() takes a Principal; services work with an ActorContext.
 * The audit writer only reads `kind`, `userId` and `actorType`, so a minimal
 * principal-shaped object is enough to attribute the entry correctly.
 */
export function auditPrincipal(actor: ActorContext): Principal | null {
  if (actor.actorType === 'SYSTEM') return null;
  return {
    kind: actor.actorId ? 'user' : 'apiKey',
    userId: actor.actorId,
    actorType: actor.actorType,
    name: actor.name,
  } as unknown as Principal;
}

/** Throws 403 unless the principal holds at least one of the permissions. */
export function requireAnyPermission(p: Principal, perms: Permission[]): void {
  if (p.kind === 'customer') throw new ForbiddenException('Not allowed');
  if (!perms.some((x) => p.permissions.includes(x))) throw new ForbiddenException(`Missing permission: one of ${perms.join(', ')}`);
}

export const isOpsManager = (p: Principal) => p.kind === 'user' && (p.role === 'SUPER_ADMIN' || p.role === 'OPS_MANAGER');

// ----------------------------------------------------------------- dates

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 'YYYY-MM-DD' + n days (calendar arithmetic, timezone independent). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** End of a Cairo business day as a UTC instant (23:59:59.999 local). */
export function endOfCairoDay(day: string): Date {
  return new Date(cairoDateTime(addDays(day, 1), '00:00').getTime() - 1);
}

export function startOfCairoDay(day: string): Date {
  return cairoDateTime(day, '00:00');
}

/**
 * Parses a filter bound: 'YYYY-MM-DD' is a Cairo day (from → start of day,
 * to → end of day), anything else must be an ISO timestamp.
 */
export function parseBound(value: string | undefined, edge: 'from' | 'to'): Date | undefined {
  if (!value) return undefined;
  if (isDay(value)) return edge === 'from' ? startOfCairoDay(value) : endOfCairoDay(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new DomainError('INVALID_DATE', `Invalid date "${value}"`, HttpStatus.BAD_REQUEST);
  return d;
}

export function assertDayInRange(day: string, opts: { minOffset: number; maxOffset: number; field?: string; code?: string }): void {
  const today = cairoToday();
  const min = addDays(today, opts.minOffset);
  const max = addDays(today, opts.maxOffset);
  if (!isDay(day) || day < min || day > max) {
    throw new DomainError(opts.code ?? 'INVALID_DATE', `${opts.field ?? 'date'} must be between ${min} and ${max}`, HttpStatus.UNPROCESSABLE_ENTITY, { min, max });
  }
}

// ----------------------------------------------------------------- misc

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function uniq<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/** Adds a tag once (tags are a small JSON array on the order). */
export function withTag(tags: string[] | null | undefined, tag: string): string[] {
  const list = tags ?? [];
  return list.includes(tag) ? list : [...list, tag];
}

/** "Ahmed Samir" → "Ahmed" (the tracking page only shows the hero's first name). */
export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

export const mapsLink = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat != null && lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null;

/** Drizzle mysql2 update/delete results → affected row count. */
export function affected(res: unknown): number {
  const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
  return Number(header?.affectedRows ?? 0);
}

/** Finds the MySQL error behind a Drizzle/mysql2 error chain. */
export function mysqlErrorOf(e: unknown): { code?: string; sqlMessage?: string } | null {
  let cur = e as { code?: string; sqlMessage?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && cur; i++) {
    if (typeof cur.code === 'string' && cur.code.startsWith('ER_')) return cur;
    cur = cur.cause as typeof cur;
  }
  return null;
}

export function isDuplicateOn(e: unknown, key: string): boolean {
  const m = mysqlErrorOf(e);
  return m?.code === 'ER_DUP_ENTRY' && (m.sqlMessage ?? '').includes(key);
}
