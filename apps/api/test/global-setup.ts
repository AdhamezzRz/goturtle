import { createConnection } from 'mysql2/promise';

/**
 * Recreates the test database once per `jest` run, applies migrations and
 * seeds the base network (zones, hubs, pricing, staff, 3 brands, 10 heroes).
 * Override with TEST_DATABASE_URL (each parallel worker/branch should use its
 * own database name).
 */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'mysql://goturtle:goturtle@127.0.0.1:3306/goturtle_test';
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!/^[a-zA-Z0-9_]+$/.test(dbName) || !dbName.includes('test')) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const admin = await createConnection({ host: parsed.hostname, port: Number(parsed.port || 3306), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) });
  await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  const { runMigrations } = await import('../src/db/migrate');
  const { createDb } = await import('../src/db/client');
  const { seedBase } = await import('../src/db/seed');
  await runMigrations(url);
  const { db, pool } = createDb(url, { connectionLimit: 2 });
  const log = console.log;
  console.log = () => undefined;
  try {
    await seedBase(db);
  } finally {
    console.log = log;
    await pool.end();
  }
}
