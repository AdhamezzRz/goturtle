import { and, eq } from 'drizzle-orm';
import { ROLE_PERMISSIONS } from '@goturtle/shared';
import { notifications, users } from '../src/db/schema';
import { UsersService } from '../src/modules/users/users.service';
import type { Principal } from '../src/common/principal';
import { createPlatformTestApp, insertOrder, uniquePhone, userIdOf, waitFor, zoneIdOf, type PlatformTestContext } from './platform-factories';

const meta = { ip: '127.0.0.1', userAgent: 'jest' };

describe('Platform: users & brands (e2e)', () => {
  let t: PlatformTestContext;
  let nasr: string;

  beforeAll(async () => {
    t = await createPlatformTestApp();
    nasr = await zoneIdOf(t.db, 'CAI-NASR');
  });
  afterAll(() => t.close());

  describe('staff users', () => {
    it('invites a staff user with a one-time temporary password and sends it by SMS', async () => {
      const admin = await t.as('admin');
      const phone = uniquePhone('12');
      const res = await admin.post('/api/v1/users').send({ name: 'Omar Support', phone, email: `omar.${Date.now()}@goturtle.test`, role: 'SUPPORT' });
      expect(res.status).toBe(201);
      expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{10}$/);
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.user.invitePending).toBe(true);

      const token = await t.loginWith(phone, res.body.temporaryPassword);
      const me = await (await t.as({ token })).get('/api/v1/auth/me');
      expect(me.body.role).toBe('SUPPORT');

      const sms = await waitFor(async () => {
        const [row] = await t.db.select().from(notifications).where(and(eq(notifications.recipient, phone), eq(notifications.template, 'user_invited'))).limit(1);
        return row?.status === 'SENT' ? row : null;
      });
      expect(sms.provider).toBe('console');
      expect(sms.body).not.toContain(res.body.temporaryPassword); // masked once sent

      const dup = await admin.post('/api/v1/users').send({ name: 'Dup', phone, role: 'SUPPORT' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('PHONE_TAKEN');
    });

    it('validates input and requires users.manage', async () => {
      const admin = await t.as('admin');
      expect((await admin.post('/api/v1/users').send({ name: 'X', phone: uniquePhone(), role: 'BRAND_OWNER' })).status).toBe(400);
      const badPhone = await admin.post('/api/v1/users').send({ name: 'Bad Phone', phone: '0123', role: 'SUPPORT' });
      expect(badPhone.body.code).toBe('INVALID_PHONE');
      const ops = await t.as('ops');
      expect((await ops.get('/api/v1/users')).status).toBe(200); // users.read
      expect((await ops.post('/api/v1/users').send({ name: 'Nope', phone: uniquePhone(), role: 'SUPPORT' })).status).toBe(403);
      expect((await (await t.as('brandNile')).get('/api/v1/users')).status).toBe(403);
    });

    it('lists and searches staff', async () => {
      const admin = await t.as('admin');
      const res = await admin.get('/api/v1/users?role=FINANCE');
      expect(res.status).toBe(200);
      expect(res.body.data.every((u: any) => u.role === 'FINANCE')).toBe(true);
      const search = await admin.get('/api/v1/users?q=01000000004');
      expect(search.body.data.map((u: any) => u.phone)).toContain('+201000000004');
      const brandUsers = await admin.get('/api/v1/users?kind=brand');
      expect(brandUsers.body.data.every((u: any) => ['BRAND_OWNER', 'BRAND_STAFF'].includes(u.role))).toBe(true);
    });

    it('updates, resets the password and suspends (sessions die immediately)', async () => {
      const admin = await t.as('admin');
      const phone = uniquePhone('12');
      const invited = await admin.post('/api/v1/users').send({ name: 'Temp Finance', phone, role: 'FINANCE' });
      const id = invited.body.user.id;
      const token = await t.loginWith(phone, invited.body.temporaryPassword);
      const asUser = await t.as({ token });
      expect((await asUser.get('/api/v1/auth/me')).status).toBe(200);

      const upd = await admin.patch(`/api/v1/users/${id}`).send({ role: 'DISPATCHER', name: 'Temp Dispatcher' });
      expect(upd.status).toBe(200);
      expect(upd.body.role).toBe('DISPATCHER');
      expect((await asUser.get('/api/v1/auth/me')).body.role).toBe('DISPATCHER');

      const reset = await admin.post(`/api/v1/users/${id}/reset-password`);
      expect(reset.status).toBe(200);
      await expect(t.loginWith(phone, invited.body.temporaryPassword)).rejects.toThrow();
      const fresh = await t.loginWith(phone, reset.body.temporaryPassword);

      const suspended = await admin.post(`/api/v1/users/${id}/suspend`);
      expect(suspended.body.status).toBe('SUSPENDED');
      expect((await (await t.as({ token: fresh })).get('/api/v1/auth/me')).status).toBe(401);
      const back = await admin.post(`/api/v1/users/${id}/reactivate`);
      expect(back.body.status).toBe('ACTIVE');
    });

    it('protects super admins: no self-lockout and never zero active super admins', async () => {
      const admin = await t.as('admin');
      const adminId = await userIdOf(t.db, '+201000000000');
      const self = await admin.patch(`/api/v1/users/${adminId}`).send({ role: 'OPS_MANAGER' });
      expect(self.status).toBe(409);
      expect(self.body.code).toBe('SELF_LOCKOUT');
      expect((await admin.post(`/api/v1/users/${adminId}/suspend`)).body.code).toBe('SELF_LOCKOUT');

      // A second super admin who is themselves suspended tries to remove the last active one.
      const second = await admin.post('/api/v1/users').send({ name: 'Second Admin', phone: uniquePhone('12'), role: 'SUPER_ADMIN' });
      expect(second.status).toBe(201);
      await admin.post(`/api/v1/users/${second.body.user.id}/suspend`).expect(200);
      const ghost: Principal = {
        kind: 'user', userId: second.body.user.id, name: 'Second Admin', role: 'SUPER_ADMIN', actorType: 'STAFF', brandId: null, courierId: null, hubId: null,
        permissions: ROLE_PERMISSIONS.SUPER_ADMIN,
      };
      const svc = t.get<UsersService>(UsersService);
      await expect(svc.setStatus(adminId, 'SUSPENDED', ghost, meta)).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
      await expect(svc.updateStaff(adminId, { role: 'OPS_MANAGER' }, ghost, meta)).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
      const [still] = await t.db.select().from(users).where(eq(users.id, adminId));
      expect(still.role).toBe('SUPER_ADMIN');
      expect(still.status).toBe('ACTIVE');
    });
  });

  describe('brands (staff)', () => {
    const code = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;
    let brandId: string;
    let ownerPhone: string;
    let ownerPassword: string;

    it('onboards a brand with owner and default pickup location in one go', async () => {
      const admin = await t.as('admin');
      ownerPhone = uniquePhone('11');
      const res = await admin.post('/api/v1/brands').send({
        code: code.toLowerCase(), name: 'Test Brand', phone: uniquePhone('11'), settlementCycle: 'DAILY', payoutMethod: 'INSTAPAY',
        payoutDetails: { instapayAddress: 'test@instapay' }, owner: { name: 'Test Owner', phone: ownerPhone },
        location: { name: 'HQ', addressLine: '1 Abbas El Akkad, Nasr City', zoneId: nasr },
      });
      expect(res.status).toBe(201);
      expect(res.body.brand.code).toBe(code);
      expect(res.body.brand.status).toBe('ACTIVE');
      expect(res.body.location.isDefault).toBe(true);
      brandId = res.body.brand.id;
      ownerPassword = res.body.temporaryPassword;
      expect(ownerPassword).toBeTruthy();

      const dup = await admin.post('/api/v1/brands').send({
        code, name: 'Dup', phone: uniquePhone('11'), owner: { name: 'X Y', phone: uniquePhone('11') }, location: { name: 'HQ', addressLine: 'Somewhere 12', zoneId: nasr },
      });
      expect(dup.body.code).toBe('BRAND_CODE_TAKEN');
      const badZone = await admin.post('/api/v1/brands').send({
        code: `${code}Z`.slice(0, 12), name: 'Bad', phone: uniquePhone('11'), owner: { name: 'X Y', phone: uniquePhone('11') }, location: { name: 'HQ', addressLine: 'Somewhere 12', zoneId: 'nope' },
      });
      expect(badZone.body.code).toBe('INVALID_ZONE');
      expect((await admin.post('/api/v1/brands').send({ code: 'A', name: 'x' })).status).toBe(400);
    });

    it('shows detail stats and filters the list', async () => {
      await insertOrder(t.db, { brandId, status: 'DELIVERED', collectedCents: 10_000 });
      await insertOrder(t.db, { brandId, status: 'CREATED' });
      const admin = await t.as('admin');
      const detail = await admin.get(`/api/v1/brands/${brandId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.stats.totalOrders).toBe(2);
      expect(detail.body.stats.ordersByStatus).toEqual({ DELIVERED: 1, CREATED: 1 });
      expect(detail.body.stats.last30Days.orders).toBe(2);
      expect(detail.body.stats.walletBalanceCents).toBe(0);
      expect(detail.body.team).toHaveLength(1);
      const list = await admin.get(`/api/v1/brands?q=${code}&cycle=DAILY`);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].orders30d).toBe(2);
      expect((await admin.get('/api/v1/brands?status=PENDING&cycle=DAILY')).body.data.find((b: any) => b.id === brandId)).toBeUndefined();
    });

    it('validates updates (plan must exist, account manager must be staff)', async () => {
      const admin = await t.as('admin');
      expect((await admin.patch(`/api/v1/brands/${brandId}`).send({ pricingPlanId: 'missing' })).body.code).toBe('INVALID_PRICING_PLAN');
      const nileOwner = await userIdOf(t.db, '+201110000011');
      expect((await admin.patch(`/api/v1/brands/${brandId}`).send({ accountManagerId: nileOwner })).body.code).toBe('INVALID_ACCOUNT_MANAGER');
      const ok = await admin.patch(`/api/v1/brands/${brandId}`).send({ allowOpenPackage: true, defaultFeesPaidBy: 'RECIPIENT', accountManagerId: await userIdOf(t.db, '+201000000001') });
      expect(ok.status).toBe(200);
      expect(ok.body.allowOpenPackage).toBe(true);
      expect(ok.body.accountManager.name).toBe('Mona Fathy');
    });

    it('suspends and reactivates (brand users are locked out at once)', async () => {
      const admin = await t.as('admin');
      const token = await t.loginWith(ownerPhone, ownerPassword);
      const owner = await t.as({ token });
      expect((await owner.get('/api/v1/brands/me')).status).toBe(200);
      expect((await admin.post(`/api/v1/brands/${brandId}/suspend`)).body.status).toBe('SUSPENDED');
      expect((await owner.get('/api/v1/brands/me')).status).toBe(401);
      expect((await admin.post(`/api/v1/brands/${brandId}/approve`)).body.code).toBe('INVALID_BRAND_STATUS');
      expect((await admin.post(`/api/v1/brands/${brandId}/reactivate`)).body.status).toBe('ACTIVE');
      expect((await owner.get('/api/v1/brands/me')).status).toBe(200);
    });
  });

  describe('public sign-up', () => {
    it('creates a PENDING brand whose owner can sign in, and alerts ops', async () => {
      const phone = uniquePhone('10');
      const res = await t.http().post('/api/v1/brands/register').send({
        brandName: 'Lotus Home Décor', ownerName: 'Sara Adel', phone, email: `sara.${Date.now()}@lotus.test`, password: 'Lotus2026!',
        location: { name: 'Warehouse', addressLine: '5 Makram Ebeid, Nasr City', zoneId: nasr },
      });
      expect(res.status).toBe(201);
      expect(res.body.brand.status).toBe('PENDING');
      expect(res.body.brand.code).toMatch(/^LOTUSHOM\d*$/);

      const token = await t.loginWith(phone, 'Lotus2026!');
      const me = await (await t.as({ token })).get('/api/v1/brands/me');
      expect(me.body.status).toBe('PENDING');
      expect(me.body.canCreateOrders).toBe(false);
      expect(me.body.locations).toHaveLength(1);

      const opsId = await userIdOf(t.db, '+201000000001');
      await waitFor(async () => {
        const rows = await t.db.select().from(notifications).where(and(eq(notifications.userId, opsId), eq(notifications.template, 'brand_registered')));
        return rows.find((r) => (r.data as any)?.brandId === res.body.brand.id);
      });

      const admin = await t.as('admin');
      expect((await admin.post(`/api/v1/brands/${res.body.brand.id}/approve`)).body.status).toBe('ACTIVE');
      expect((await (await t.as({ token })).get('/api/v1/brands/me')).body.canCreateOrders).toBe(true);

      const weak = await t.http().post('/api/v1/brands/register').send({ brandName: 'Weak', ownerName: 'Weak Pw', phone: uniquePhone('10'), email: 'w@w.test', password: 'short' });
      expect(weak.status).toBe(400);
    });
  });

  describe('brand self-service', () => {
    it('is scoped to the caller brand and keeps payout details owner-only', async () => {
      const owner = await t.as('brandNile');
      const me = await owner.get('/api/v1/brands/me');
      expect(me.body.code).toBe('NILE');
      expect(me.body.payoutDetails.instapayAddress).toBe('nile@instapay');
      expect(me.body.notes).toBeUndefined();
      expect((await owner.get(`/api/v1/brands/${me.body.id}`)).status).toBe(403);
      expect((await owner.get('/api/v1/brands')).status).toBe(403);

      const upd = await owner.patch('/api/v1/brands/me').send({ website: 'https://nilethreads.eg', logoUrl: '/api/v1/files/logo/2026-10/abc.png' });
      expect(upd.status).toBe(200);
      expect(upd.body.website).toBe('https://nilethreads.eg');
      expect((await owner.patch('/api/v1/brands/me').send({ status: 'ACTIVE' })).status).toBe(400);

      // A brand staff member: profile yes, payout no, masked payout details.
      const staffPhone = uniquePhone('11');
      const invited = await owner.post('/api/v1/brands/me/team').send({ name: 'Nile Staff', phone: staffPhone, role: 'BRAND_STAFF' });
      expect(invited.status).toBe(201);
      const staff = await t.as({ token: await t.loginWith(staffPhone, invited.body.temporaryPassword) });
      const staffMe = await staff.get('/api/v1/brands/me');
      expect(staffMe.body.payoutDetails.instapayAddress).toBe('••••');
      const denied = await staff.patch('/api/v1/brands/me').send({ payoutMethod: 'BANK_TRANSFER' });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('OWNER_ONLY');
      expect((await staff.post('/api/v1/brands/me/team').send({ name: 'Nope Nope', phone: uniquePhone(), role: 'BRAND_STAFF' })).status).toBe(403);
    });

    it('manages pickup locations with a single default and active zones only', async () => {
      const owner = await t.as('brandGadgets');
      const before = (await owner.get('/api/v1/brands/me/locations')).body;
      expect(before.filter((l: any) => l.isDefault)).toHaveLength(1);
      expect((await owner.post('/api/v1/brands/me/locations').send({ name: 'Bad', addressLine: '1 Nowhere St', zoneId: 'missing' })).body.code).toBe('INVALID_ZONE');
      const created = await owner.post('/api/v1/brands/me/locations').send({ name: 'Heliopolis store', addressLine: '3 Korba St, Heliopolis', zoneId: await zoneIdOf(t.db, 'CAI-HELIO'), isDefault: true });
      expect(created.status).toBe(201);
      expect(created.body.isDefault).toBe(true);
      const after = (await owner.get('/api/v1/brands/me/locations')).body;
      expect(after.filter((l: any) => l.isDefault).map((l: any) => l.id)).toEqual([created.body.id]);
      expect((await owner.patch(`/api/v1/brands/me/locations/${created.body.id}`).send({ isDefault: false })).body.code).toBe('DEFAULT_LOCATION_REQUIRED');

      const del = await owner.delete(`/api/v1/brands/me/locations/${created.body.id}`);
      expect(del.body.deleted).toBe(true);
      const final = (await owner.get('/api/v1/brands/me/locations')).body;
      expect(final.filter((l: any) => l.isDefault)).toHaveLength(1);
      expect((await owner.delete(`/api/v1/brands/me/locations/${final[0].id}`)).body.code).toBe('LAST_LOCATION');

      const nile = await t.as('brandNile');
      expect((await nile.patch(`/api/v1/brands/me/locations/${final[0].id}`).send({ name: 'Hijack' })).status).toBe(404);
    });
  });

  describe('brand team', () => {
    it('lets owners manage only their own team and keeps an owner', async () => {
      const owner = await t.as('brandBloom');
      const phone = uniquePhone('11');
      const invited = await owner.post('/api/v1/brands/me/team').send({ name: 'Bloom Helper', phone, role: 'BRAND_STAFF' });
      expect(invited.status).toBe(201);
      const team = await owner.get('/api/v1/brands/me/team');
      expect(team.body.map((u: any) => u.phone)).toContain(phone);
      expect(team.body.every((u: any) => u.passwordHash === undefined)).toBe(true);

      const promoted = await owner.patch(`/api/v1/brands/me/team/${invited.body.user.id}`).send({ role: 'BRAND_OWNER' });
      expect(promoted.body.role).toBe('BRAND_OWNER');
      const demoted = await owner.patch(`/api/v1/brands/me/team/${invited.body.user.id}`).send({ role: 'BRAND_STAFF' });
      expect(demoted.body.role).toBe('BRAND_STAFF');

      const ownerId = await userIdOf(t.db, '+201110000013');
      expect((await owner.patch(`/api/v1/brands/me/team/${ownerId}`).send({ role: 'BRAND_STAFF' })).body.code).toBe('SELF_LOCKOUT');
      expect((await owner.delete(`/api/v1/brands/me/team/${ownerId}`)).body.code).toBe('SELF_LOCKOUT');
      const nileOwner = await userIdOf(t.db, '+201110000011');
      expect((await owner.patch(`/api/v1/brands/me/team/${nileOwner}`).send({ name: 'Hacked' })).status).toBe(404);

      // Last-owner guard (service level: the only active owner being demoted by a co-owner who is suspended).
      const svc = t.get<UsersService>(UsersService);
      const coOwner: Principal = {
        kind: 'user', userId: invited.body.user.id, name: 'Bloom Helper', role: 'BRAND_OWNER', actorType: 'BRAND', brandId: invited.body.user.brandId,
        courierId: null, hubId: null, permissions: ROLE_PERMISSIONS.BRAND_OWNER,
      };
      await expect(svc.updateTeamMember(invited.body.user.brandId, ownerId, { role: 'BRAND_STAFF' }, coOwner, meta)).rejects.toMatchObject({ code: 'LAST_BRAND_OWNER' });

      const removed = await owner.delete(`/api/v1/brands/me/team/${invited.body.user.id}`);
      expect(removed.body.removed || removed.body.suspended).toBe(true);
      expect((await owner.get('/api/v1/brands/me/team')).body.map((u: any) => u.phone)).not.toContain(removed.body.removed ? phone : '-');
    });
  });
});
