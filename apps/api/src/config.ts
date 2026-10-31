import 'dotenv/config';

/**
 * Typed, validated configuration. Fails fast at boot with a readable list of
 * problems instead of crashing later in a request.
 */
function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    problems.push(`${name} is required`);
    return '';
  }
  return v;
}
/** PORT can be a number or (behind some process managers) a socket / named pipe path. */
function port(): number | string {
  const v = process.env.PORT;
  if (v === undefined || v === '') return 3000;
  return /^\d+$/.test(v) ? Number(v) : v;
}
function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) problems.push(`${name} must be a number`);
  return n;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const problems: string[] = [];
const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';
const devDefault = (v: string) => (isProd ? undefined : v);

export const config = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: port(),
  appUrl: str('APP_URL', 'http://localhost:5173').replace(/\/$/, ''),
  databaseUrl: str('DATABASE_URL', devDefault('mysql://goturtle:goturtle@127.0.0.1:3306/goturtle')),
  dbAutoMigrate: bool('DB_AUTO_MIGRATE', true),
  dbPoolSize: num('DB_POOL_SIZE', 8),
  jwt: {
    accessSecret: str('JWT_ACCESS_SECRET', devDefault('dev-access-secret-change-me-0123456789')),
    refreshSecret: str('JWT_REFRESH_SECRET', devDefault('dev-refresh-secret-change-me-0123456789')),
    accessTtl: str('JWT_ACCESS_TTL', '15m'),
    refreshTtlDays: num('JWT_REFRESH_TTL_DAYS', 30),
    customerTtl: str('JWT_CUSTOMER_TTL', '2h'),
  },
  encryptionKey: str('ENCRYPTION_KEY', devDefault('dev-encryption-key-change-me')),
  bootstrapAdmin: {
    phone: process.env.BOOTSTRAP_ADMIN_PHONE ?? '',
    email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? '',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '',
    name: process.env.BOOTSTRAP_ADMIN_NAME ?? 'GoTurtle Admin',
  },
  cronSecret: str('CRON_SECRET', devDefault('dev-cron')),
  inProcessJobs: bool('IN_PROCESS_JOBS', true),
  uploadDir: str('UPLOAD_DIR', './uploads'),
  maxUploadMb: num('MAX_UPLOAD_MB', 8),
  webDistDir: process.env.WEB_DIST_DIR ?? '',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  notifications: {
    sms: str('SMS_PROVIDER', 'console'),
    whatsapp: str('WHATSAPP_PROVIDER', 'console'),
    email: str('EMAIL_PROVIDER', 'console'),
  },
  payments: { provider: str('PAYMENT_PROVIDER', 'none') },
  geocoder: str('GEOCODER', 'none'),
  /** Return OTP codes in API responses (dev/test only — never in production). */
  exposeOtp: !isProd && bool('EXPOSE_OTP', true),
};

/** Catch the most common Hostinger mistake early: special characters in the DB password not URL-encoded. */
function checkDatabaseUrl(raw: string) {
  if (!raw) return;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    problems.push('DATABASE_URL is not a valid URL — expected mysql://USER:PASSWORD@HOST:3306/DATABASE');
    return;
  }
  if (u.protocol !== 'mysql:') problems.push('DATABASE_URL must start with mysql://');
  if (!u.hostname) problems.push('DATABASE_URL is missing the host (usually localhost on Hostinger)');
  if (!u.pathname || u.pathname === '/') problems.push('DATABASE_URL is missing the database name after the last "/"');
  if (u.hash || (raw.match(/@/g)?.length ?? 0) > 1 || u.search.includes('@')) {
    problems.push('DATABASE_URL password contains special characters that must be URL-encoded (@ → %40, # → %23, / → %2F, ? → %3F, % → %25)');
  }
}
checkDatabaseUrl(config.databaseUrl);

if (isProd) {
  for (const [k, v] of Object.entries({ JWT_ACCESS_SECRET: config.jwt.accessSecret, JWT_REFRESH_SECRET: config.jwt.refreshSecret })) {
    if (v.length < 32 || v.startsWith('change-me')) problems.push(`${k} must be a random string of at least 32 characters`);
  }
}

/**
 * Configuration problems found at load time. The app refuses to start while this
 * is non-empty (main.ts throws a ConfigError and server.js shows a diagnostic page).
 */
export const configProblems: readonly string[] = problems;

export class ConfigError extends Error {
  readonly code = 'CONFIG_INVALID';
  constructor(public readonly problems: readonly string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}\n  See apps/api/.env.example`);
  }
}

export function assertValidConfig() {
  if (problems.length) throw new ConfigError(problems);
}

export type AppConfig = typeof config;
