import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';
import * as schema from './schema';

/**
 * IMPORTANT — MariaDB compatibility (Hostinger runs MariaDB):
 * Drizzle's relational `with: {...}` queries compile to correlated derived
 * tables that MariaDB rejects ("Unknown column ... in WHERE"). We therefore do
 * NOT register `relations()`; use `db.select().from(a).leftJoin(b, ...)` or the
 * batch helpers in ./helpers.ts. Flat `db.query.<table>.findFirst/findMany`
 * (without `with`) is fine.
 */
export type Db = MySql2Database<typeof schema>;
/** A transaction handle has the same query API as Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string, opts: { connectionLimit?: number } = {}): { db: Db; pool: Pool } {
  const pool = createPool({
    uri: url,
    // Hostinger shares process limits across sites: keep the pool small.
    connectionLimit: opts.connectionLimit ?? 8,
    waitForConnections: true,
    enableKeepAlive: true,
    timezone: 'Z', // store & read DATETIME as UTC
    dateStrings: ['DATE'], // DATE columns stay 'YYYY-MM-DD' strings (business days in Cairo)
    charset: 'utf8mb4_unicode_ci',
    decimalNumbers: true,
    supportBigNumbers: true,
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool };
}
