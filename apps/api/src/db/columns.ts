import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { customType, datetime, int, varchar } from 'drizzle-orm/mysql-core';

/**
 * Collision-resistant, URL-safe, sortable-ish ids (25 chars, base36).
 * Time prefix keeps InnoDB clustered-index inserts mostly sequential.
 */
export function newId(): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = BigInt(`0x${randomBytes(10).toString('hex')}`).toString(36).padStart(16, '0').slice(-16);
  return `${time}${rand}`;
}

/** Primary key column: varchar(32) with a generated id. */
export const id = () => varchar({ length: 32 }).primaryKey().$defaultFn(newId);

/** Foreign key column. */
export const ref = () => varchar({ length: 32 });

/** Money in piasters (1 EGP = 100). */
export const cents = () => int().notNull().default(0);

/** DATETIME(3) stored in UTC (the mysql2 pool is configured with timezone 'Z'). */
export const ts = () => datetime({ mode: 'date', fsp: 3 });

export const createdAt = () => ts().notNull().default(sql`CURRENT_TIMESTAMP(3)`);
export const updatedAt = () =>
  ts()
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdateFn(() => new Date());

/**
 * JSON stored as LONGTEXT. MariaDB (what Hostinger runs) implements JSON as a
 * LONGTEXT alias and returns strings, MySQL returns objects — this handles both.
 */
export const json = customType<{ data: unknown; driverData: string }>({
  dataType() {
    return 'longtext';
  },
  toDriver(value) {
    return JSON.stringify(value ?? null);
  },
  fromDriver(value) {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },
});

/** Typed JSON helper: jsonOf<string[]>() */
export const jsonOf = <T>() => json().$type<T>();
