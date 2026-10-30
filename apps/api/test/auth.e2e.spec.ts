import { createTestApp, type TestContext } from './helpers';

describe('Auth (e2e)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('logs in staff, brand and hero users into the right portal', async () => {
    expect((await t.login('admin')).user.portal).toBe('ops');
    expect((await t.login('brandNile')).user.portal).toBe('brand');
    const hero = await t.login('hero1');
    expect(hero.user.portal).toBe('hero');
    expect(hero.user.courier.code).toBe('HR-00001');
  });

  it('rejects wrong passwords and unknown fields', async () => {
    const bad = await t.http().post('/api/v1/auth/login').send({ identifier: '01000000001', password: 'nope-nope' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    const extra = await t.http().post('/api/v1/auth/login').send({ identifier: 'x', password: 'xxxxxxxx', admin: true });
    expect(extra.status).toBe(400);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const res = await t.http().post('/api/v1/auth/login').send({ identifier: '01000000002', password: 'Turtle@2026' });
    const first = res.body.refreshToken;
    const rotated = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    const replay = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(replay.status).toBe(401);
    const afterTheft = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
    expect(afterTheft.status).toBe(401);
  });

  it('enforces actor kinds', async () => {
    const hero = await t.as('hero1');
    expect((await hero.get('/api/v1/system/jobs')).status).toBe(403);
    const admin = await t.as('admin');
    expect((await admin.get('/api/v1/system/jobs')).status).toBe(200);
    expect((await t.http().get('/api/v1/auth/me')).status).toBe(401);
  });

  it('runs the cron endpoint only with the secret', async () => {
    expect((await t.http().post('/api/v1/system/cron?key=wrong')).status).toBe(401);
    expect((await t.http().post('/api/v1/system/cron?key=test-cron')).status).toBe(200);
  });
});
