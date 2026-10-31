import { and, count, inArray, sql, type SQL } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import type { DbOrTx } from './client';

/**
 * Batch-load rows by id and return a Map — the MariaDB-safe replacement for
 * relational `with`. Usage:
 *   const zoneMap = await loadByIds(db, zones, zones.id, orders.map(o => o.zoneId));
 */
export async function loadByIds<T extends MySqlTable, C extends MySqlColumn>(
  db: DbOrTx,
  table: T,
  column: C,
  ids: Array<string | null | undefined>,
): Promise<Map<string, T['$inferSelect']>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const rows = (await db.select().from(table as MySqlTable).where(inArray(column, unique))) as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [String(r[column.name]), r as T['$inferSelect']]));
}

/** Group rows by a key — for one-to-many lookups. */
export function groupBy<T, K extends string>(rows: T[], key: (row: T) => K | null | undefined): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/** Combine optional filters into a single WHERE (undefined when empty). */
export function whereAll(...conds: Array<SQL | undefined | null | false>): SQL | undefined {
  const list = conds.filter((c): c is SQL => !!c);
  if (!list.length) return undefined;
  return list.length === 1 ? list[0] : and(...list);
}

/** SELECT COUNT(*) with an optional WHERE. */
export async function countRows(db: DbOrTx, table: MySqlTable, where?: SQL): Promise<number> {
  const [row] = await db.select({ n: count() }).from(table).where(where);
  return Number(row?.n ?? 0);
}

/** COALESCE(SUM(col), 0) as a JS number. */
export const sumOf = (column: MySqlColumn) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

/** Escape LIKE wildcards in user input. */
export function likeEscape(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Today's date in Africa/Cairo as YYYY-MM-DD (business day boundary for runsheets, pickups, shifts). */
export function cairoToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Hour of day (0..23) in Africa/Cairo. */
export function cairoHour(at: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(at)) % 24;
}

/**
 * Converts a Cairo wall-clock time to a UTC Date, honouring DST
 * (Egypt re-introduced summer time in 2023).
 */
export function cairoDateTime(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const guess = new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const offsetMin = cairoOffsetMinutes(guess);
  const candidate = new Date(guess.getTime() - offsetMin * 60_000);
  // Re-check once in case the guess crossed a DST boundary.
  const offset2 = cairoOffsetMinutes(candidate);
  return offset2 === offsetMin ? candidate : new Date(guess.getTime() - offset2 * 60_000);
}

export function cairoOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/** True when a (possibly wrapped) MySQL error is a deadlock / lock-wait timeout. */
export function isRetryableLockError(err: unknown): boolean {
  let cur = err as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.code && RETRYABLE.has(cur.code)) return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}

/**
 * Runs `fn` and retries it when InnoDB picked it as a deadlock victim. The whole
 * transaction was rolled back, so `fn` must start its own transaction and be
 * safe to re-run (re-read rows, idempotent postings).
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isRetryableLockError(err)) throw err;
      await new Promise((r) => setTimeout(r, 15 * attempt + Math.floor(Math.random() * 25)));
    }
  }
}
