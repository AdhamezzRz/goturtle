import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { DB } from '../src/core/database.module';
import type { Db } from '../src/db/client';

export const DEMO_PASSWORD = 'Turtle@2026';

/** Seeded accounts (see src/db/seed.ts). */
export const ACCOUNTS = {
  admin: { identifier: '+201000000000', password: 'Admin@12345' },
  ops: { identifier: '+201000000001', password: DEMO_PASSWORD },
  dispatcher: { identifier: '+201000000002', password: DEMO_PASSWORD },
  hub: { identifier: '+201000000003', password: DEMO_PASSWORD },
  finance: { identifier: '+201000000004', password: DEMO_PASSWORD },
  support: { identifier: '+201000000005', password: DEMO_PASSWORD },
  brandNile: { identifier: '+201110000011', password: DEMO_PASSWORD }, // Nile Threads owner
  brandGadgets: { identifier: '+201110000012', password: DEMO_PASSWORD }, // Cairo Gadgets owner
  brandBloom: { identifier: '+201110000013', password: DEMO_PASSWORD }, // Bloom Beauty owner
  hero1: { identifier: '+201200000001', password: DEMO_PASSWORD }, // Ahmed — freelance, Nasr City/Heliopolis/Sheraton
  hero2: { identifier: '+201200000002', password: DEMO_PASSWORD }, // Mahmoud — freelance, New Cairo
  hero3: { identifier: '+201200000003', password: DEMO_PASSWORD }, // Youssef — SHIFT, Nasr City/Abbassia/Shubra
  hero4: { identifier: '+201200000004', password: DEMO_PASSWORD }, // Mostafa — SHIFT, Maadi
} as const;
export type AccountName = keyof typeof ACCOUNTS;

export interface TestContext {
  app: NestExpressApplication;
  db: Db;
  http: () => ReturnType<typeof request>;
  /** Logs in and returns { token, user }. Cached per account. */
  login: (who: AccountName) => Promise<{ token: string; user: any }>;
  /** Shorthand for an authenticated supertest request builder. */
  as: (who: AccountName) => Promise<{
    get: (url: string) => request.Test;
    post: (url: string) => request.Test;
    patch: (url: string) => request.Test;
    put: (url: string) => request.Test;
    delete: (url: string) => request.Test;
  }>;
  close: () => Promise<void>;
}

/**
 * Boots the full application against the test database.
 *   let t: TestContext;
 *   beforeAll(async () => { t = await createTestApp(); });
 *   afterAll(() => t.close());
 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  await app.init();
  const server = app.getHttpServer();
  const tokens = new Map<AccountName, { token: string; user: any }>();

  const login = async (who: AccountName) => {
    const cached = tokens.get(who);
    if (cached) return cached;
    const res = await request(server).post('/api/v1/auth/login').send(ACCOUNTS[who]);
    if (res.status !== 200) throw new Error(`login ${who} failed: ${res.status} ${JSON.stringify(res.body)}`);
    const out = { token: res.body.accessToken as string, user: res.body.user };
    tokens.set(who, out);
    return out;
  };

  const as = async (who: AccountName) => {
    const { token } = await login(who);
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string) => auth(request(server).post(url)),
      patch: (url: string) => auth(request(server).patch(url)),
      put: (url: string) => auth(request(server).put(url)),
      delete: (url: string) => auth(request(server).delete(url)),
    };
  };

  return {
    app,
    db: app.get<Db>(DB),
    http: () => request(server),
    login,
    as,
    close: () => app.close(),
  };
}
