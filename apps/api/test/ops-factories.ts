import request from 'supertest';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import * as s from '../src/db/schema';
import { newId } from '../src/db/columns';
import { sha256 } from '../src/common/crypto';
import { hashPassword } from '../src/modules/auth/auth.service';
import { LedgerService } from '../src/core/ledger/ledger.service';
import type { TestContext } from './helpers';

export type Agent = {
  get: (url: string) => request.Test;
  post: (url: string) => request.Test;
  patch: (url: string) => request.Test;
  put: (url: string) => request.Test;
  delete: (url: string) => request.Test;
};

const agent = (t: TestContext, header: [string, string]): Agent => {
  const server = t.app.getHttpServer();
  const wrap = (r: request.Test) => r.set(header[0], header[1]);
  return {
    get: (u) => wrap(request(server).get(u)),
    post: (u) => wrap(request(server).post(u)),
    patch: (u) => wrap(request(server).patch(u)),
    put: (u) => wrap(request(server).put(u)),
    delete: (u) => wrap(request(server).delete(u)),
  };
};

export const bearer = (t: TestContext, token: string) => agent(t, ['Authorization', `Bearer ${token}`]);
export const withApiKey = (t: TestContext, key: string) => agent(t, ['X-Api-Key', key]);

const randomDigits = (n: number) => Array.from(randomBytes(n), (b) => String(b % 10)).join('');
export const randomPhone = (prefix = '010') => `${prefix}${randomDigits(8)}`;

export async function zoneId(t: TestContext, code: string): Promise<string> {
  const [z] = await t.db.select({ id: s.zones.id }).from(s.zones).where(eq(s.zones.code, code)).limit(1);
  if (!z) throw new Error(`zone ${code} missing`);
  return z.id;
}

export async function hubId(t: TestContext, code: string): Promise<string> {
  const [h] = await t.db.select({ id: s.hubs.id }).from(s.hubs).where(eq(s.hubs.code, code)).limit(1);
  return h.id;
}

export async function courierByCode(t: TestContext, code: string) {
  const [c] = await t.db.select().from(s.couriers).where(eq(s.couriers.code, code)).limit(1);
  return c;
}

export async function brandByCode(t: TestContext, code: string) {
  const [b] = await t.db.select().from(s.brands).where(eq(s.brands.code, code)).limit(1);
  return b;
}

/**
 * A fresh, isolated brand (own wallet) with an owner login and a default pickup location.
 * Tests run in parallel workers, so money assertions use their own brand.
 */
export async function createTestBrand(t: TestContext, opts: { zone?: string; status?: 'ACTIVE' | 'PENDING' | 'SUSPENDED'; planName?: string; feesPaidBy?: 'BRAND' | 'RECIPIENT'; allowOpen?: boolean } = {}) {
  const code = `T${randomDigits(6)}`;
  let planId: string | null = null;
  if (opts.planName) {
    const [plan] = await t.db.select({ id: s.pricingPlans.id }).from(s.pricingPlans).where(eq(s.pricingPlans.name, opts.planName)).limit(1);
    planId = plan.id;
  }
  const brandId = newId();
  await t.db.insert(s.brands).values({
    id: brandId, code, name: `Test Brand ${code}`, phone: `+2011${randomDigits(8)}`, status: opts.status ?? 'ACTIVE', pricingPlanId: planId,
    defaultFeesPaidBy: opts.feesPaidBy ?? 'BRAND', allowOpenPackage: opts.allowOpen ?? false,
  });
  const ownerPhone = `+2011${randomDigits(8)}`;
  const password = 'Owner@2026x';
  await t.db.insert(s.users).values({ name: `Owner ${code}`, phone: ownerPhone, role: 'BRAND_OWNER', brandId, passwordHash: await hashPassword(password) });
  const locationId = newId();
  await t.db.insert(s.brandLocations).values({
    id: locationId, brandId, name: 'Main warehouse', contactName: `Owner ${code}`, phone: ownerPhone, addressLine: '45 Makram Ebeid, Nasr City',
    zoneId: await zoneId(t, opts.zone ?? 'CAI-NASR'), lat: 30.0583, lng: 31.3446, isDefault: true,
  });
  const login = async () => {
    const res = await t.http().post('/api/v1/auth/login').send({ identifier: ownerPhone, password });
    if (res.status !== 200) throw new Error(`brand login failed ${res.status} ${JSON.stringify(res.body)}`);
    return bearer(t, res.body.accessToken);
  };
  return { brandId, code, locationId, ownerPhone, login };
}

/** Inserts an API key row (the API keys module is owned elsewhere) and returns the raw key. */
export async function createApiKey(t: TestContext, brandId: string, scopes: string[] = ['*']) {
  const raw = `gt_test_${randomBytes(18).toString('hex')}`;
  await t.db.insert(s.apiKeys).values({ brandId, name: 'e2e', prefix: raw.slice(0, 16) + randomDigits(4), keyHash: sha256(raw), scopes });
  return raw;
}

export const ledgerOf = (t: TestContext) => t.app.get(LedgerService);

export function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    recipient: { name: 'Mohamed Hassan', phone: randomPhone() },
    address: { line: '12 Makram Ebeid St, Nasr City', building: '12', floor: '3', apartment: '7' },
    codAmountCents: 125_000,
    ...overrides,
  };
}

export async function customerToken(t: TestContext, phone: string, trackingNumber?: string) {
  const otp = await t.http().post('/api/v1/auth/customer/otp').send({ phone, trackingNumber });
  if (otp.status !== 200) throw new Error(`customer otp failed ${otp.status} ${JSON.stringify(otp.body)}`);
  const v = await t.http().post('/api/v1/auth/customer/verify').send({ phone, code: otp.body.devCode, trackingNumber });
  if (v.status !== 200) throw new Error(`customer verify failed ${v.status} ${JSON.stringify(v.body)}`);
  return v.body.accessToken as string;
}
