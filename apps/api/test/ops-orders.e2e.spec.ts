import { eq } from 'drizzle-orm';
import { isValidTrackingNumber } from '@goturtle/shared';
import * as s from '../src/db/schema';
import type { TestContext } from './helpers';
import { bootTestApp, brandByCode, createApiKey, createTestBrand, orderBody, randomPhone, withApiKey, zoneId } from './ops-factories';

const API = '/api/v1';

describe('Orders (e2e)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());

  describe('create', () => {
    it('creates an order with fees equal to the quote and a valid tracking number', async () => {
      const brand = await t.as('brandGadgets');
      const body = orderBody({ codAmountCents: 125_000, package: { weightGrams: 4200, itemsCount: 2 } });
      const quote = await brand.post(`${API}/pricing/quote`).send({ address: body.address.line, codAmountCents: 125_000, weightGrams: 4200 });
      expect(quote.status).toBe(200);
      expect(quote.body.zone.code).toBe('CAI-NASR');

      const res = await brand.post(`${API}/orders`).send(body);
      expect(res.status).toBe(201);
      const o = res.body;
      expect(isValidTrackingNumber(o.trackingNumber)).toBe(true);
      expect(o.status).toBe('CREATED');
      expect(o.source).toBe('PORTAL');
      expect(o.zone.code).toBe('CAI-NASR');
      // Standard plan, tier A: 55 EGP + 2 started extra kg (10 EGP) + COD 1% (12.50) → 77.50 + 14% VAT
      expect(o.shippingFeeCents).toBe(5500);
      expect(o.extraFeesCents).toBe(1000);
      expect(o.codFeeCents).toBe(1250);
      expect(o.vatCents).toBe(1085);
      expect(o.totalFeesCents).toBe(8835);
      expect(o.totalFeesCents).toBe(quote.body.quote.totalFeesCents);
      expect(o.collectCents).toBe(quote.body.quote.collectFromRecipientCents);
      expect(o.collectCents).toBe(125_000);
      expect(o.recipientPhone).toMatch(/^\+201\d{9}$/);
      expect(o.timeline).toHaveLength(1);
      expect(o.timeline[0].status).toBe('CREATED');
      expect(o.pickupLocation.name).toBe('Nasr City warehouse');
      expect(new Date(o.promisedBy).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
      expect(o.internalNotes).toBeUndefined();
      expect(o.ledger).toBeUndefined();
    });

    it('detects the zone from an Arabic address and charges the recipient when asked', async () => {
      const brand = await t.as('brandBloom');
      const res = await brand.post(`${API}/orders`).send(
        orderBody({ address: { line: '١٥ شارع التسعين الجنوبي، التجمع الخامس، القاهرة الجديدة' }, codAmountCents: 80_000, feesPaidBy: 'RECIPIENT', recipient: { name: 'سارة محمود', phone: '٠١٢٢٣٤٥٦٧٨٩' } }),
      );
      expect(res.status).toBe(201);
      expect(res.body.zone.code).toBe('NCAI-TAGAMOA');
      expect(res.body.recipientPhone).toBe('+201223456789');
      // tier B standard 65 + COD max(5, 8) = 73 + VAT 10.22 → 83.22; recipient pays COD + fees
      expect(res.body.totalFeesCents).toBe(8322);
      expect(res.body.collectCents).toBe(80_000 + 8322);
    });

    it('rejects invalid phones, unknown addresses, duplicate references and inactive brands', async () => {
      const brand = await t.as('brandNile');
      const bad = await brand.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Ali', phone: '0123' } }));
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('INVALID_PHONE');

      const unknown = await brand.post(`${API}/orders`).send(orderBody({ address: { line: 'Somewhere far away street 5' } }));
      expect(unknown.status).toBe(422);
      expect(unknown.body.code).toBe('ZONE_NOT_DETECTED');
      expect(unknown.body.details.hint).toContain('district');

      const ref = `NILE-${Date.now()}`;
      expect((await brand.post(`${API}/orders`).send(orderBody({ brandReference: ref }))).status).toBe(201);
      const dup = await brand.post(`${API}/orders`).send(orderBody({ brandReference: ref }));
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('DUPLICATE_REFERENCE');

      const prepaid = await brand.post(`${API}/orders`).send(orderBody({ paymentMethod: 'PREPAID', codAmountCents: 100 }));
      expect(prepaid.status).toBe(422);
      expect(prepaid.body.code).toBe('INVALID_COD');

      const pending = await createTestBrand(t, { status: 'PENDING' });
      const admin = await t.as('admin');
      const inactive = await admin.post(`${API}/orders`).send(orderBody({ brandId: pending.brandId }));
      expect(inactive.status).toBe(422);
      expect(inactive.body.code).toBe('BRAND_INACTIVE');

      const noBrand = await admin.post(`${API}/orders`).send(orderBody());
      expect(noBrand.status).toBe(400);
      expect(noBrand.body.code).toBe('BRAND_REQUIRED');
    });

    it('rejects a pickup location of another brand and validates the payload', async () => {
      const nile = await t.as('brandNile');
      const gadgets = await brandByCode(t, 'CGAD');
      const [loc] = await t.db.select().from(s.brandLocations).where(eq(s.brandLocations.brandId, gadgets.id)).limit(1);
      const res = await nile.post(`${API}/orders`).send(orderBody({ pickupLocationId: loc.id }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_PICKUP_LOCATION');
      const invalid = await nile.post(`${API}/orders`).send({ recipient: { name: 'x' }, codAmountCents: -1, hacker: true });
      expect(invalid.status).toBe(400);
    });

    it('upserts the customer by phone and scores risk', async () => {
      const brand = await t.as('brandNile');
      const phone = randomPhone('011');
      const first = await brand.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Omar', phone }, codAmountCents: 600_000, address: { line: 'Nasr City' } }));
      expect(first.status).toBe(201);
      expect(first.body.riskLevel).not.toBe('LOW');
      await brand.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Omar', phone } }));
      const admin = await t.as('admin');
      const list = await admin.get(`${API}/customers?q=${phone}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].totalOrders).toBe(2);
      const detail = await admin.get(`${API}/customers/${list.body.data[0].id}`);
      expect(detail.body.recentOrders).toHaveLength(2);
      expect(detail.body.stats.active).toBe(2);
      const block = await admin.post(`${API}/customers/${list.body.data[0].id}/block`).send({ reason: 'fraud' });
      expect(block.body.isBlocked).toBe(true);
      const third = await brand.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Omar', phone } }));
      expect(third.body.riskScore).toBeGreaterThanOrEqual(60);
      expect(third.body.tags).toContain('HIGH_RISK');
      const staffView = await admin.get(`${API}/orders/${third.body.id}`);
      expect(staffView.body.tags).toContain('CUSTOMER_BLOCKED');
      expect(staffView.body.risk.factors.map((f: { key: string }) => f.key)).toContain('customer_blocked');
    });
  });

  describe('scoping', () => {
    it('keeps brands out of each other’s orders', async () => {
      const nile = await t.as('brandNile');
      const gadgets = await t.as('brandGadgets');
      const created = await nile.post(`${API}/orders`).send(orderBody());
      const id = created.body.id;
      expect((await gadgets.get(`${API}/orders/${id}`)).status).toBe(404);
      expect((await gadgets.patch(`${API}/orders/${id}`).send({ notes: 'hi' })).status).toBe(404);
      expect((await gadgets.post(`${API}/orders/${id}/cancel`).send({})).status).toBe(404);
      const labels = await gadgets.post(`${API}/orders/labels`).send({ ids: [id] });
      expect(labels.body.labels).toHaveLength(0);
      expect(labels.body.missing).toEqual([id]);
      const list = await gadgets.get(`${API}/orders?pageSize=200`);
      expect(list.body.data.every((o: { brand: { code: string } }) => o.brand.code === 'CGAD')).toBe(true);
      // a brand cannot widen its scope with brandId
      const nileBrand = await brandByCode(t, 'NILE');
      const sneaky = await gadgets.get(`${API}/orders?brandId=${nileBrand.id}`);
      expect(sneaky.body.data.find((o: { id: string }) => o.id === id)).toBeUndefined();
      // brands cannot use the staff status endpoint
      expect((await nile.post(`${API}/orders/${id}/status`).send({ status: 'ON_HOLD' })).status).toBe(403);
    });

    it('authenticates API keys with X-Api-Key and scopes them to their brand', async () => {
      const own = await createTestBrand(t);
      const key = await createApiKey(t, own.brandId);
      const api = withApiKey(t, key);
      const res = await api.post(`${API}/orders`).send(orderBody({ externalId: 'shop-1001' }));
      expect(res.status).toBe(201);
      expect(res.body.source).toBe('API');
      expect(res.body.brand.id).toBe(own.brandId);
      const list = await api.get(`${API}/orders`);
      expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([res.body.id]);
      const other = await (await t.as('brandNile')).post(`${API}/orders`).send(orderBody());
      expect((await api.get(`${API}/orders/${other.body.id}`)).status).toBe(404);
      expect((await withApiKey(t, 'gt_test_wrong').get(`${API}/orders`)).status).toBe(401);
      const detect = await api.post(`${API}/network/detect-zone`).send({ address: 'Road 9, Maadi' });
      expect(detect.body.zone.code).toBe('CAI-MAADI');
    });
  });

  describe('update & cancel', () => {
    it('re-quotes fees on edit and locks the order once cancelled', async () => {
      const brand = await t.as('brandGadgets');
      const created = await brand.post(`${API}/orders`).send(orderBody({ codAmountCents: 100_000 }));
      const id = created.body.id;
      const upd = await brand.patch(`${API}/orders/${id}`).send({ codAmountCents: 300_000, address: { line: 'Road 9, Maadi, Cairo' } });
      expect(upd.status).toBe(200);
      expect(upd.body.zone.code).toBe('CAI-MAADI');
      expect(upd.body.codFeeCents).toBe(3000);
      expect(upd.body.totalFeesCents).toBe(Math.round((5500 + 3000) * 1.14));
      expect(upd.body.timeline.some((e: { reason: string }) => e.reason === 'UPDATED')).toBe(true);
      expect((await brand.patch(`${API}/orders/${id}`).send({ tags: ['VIP'] })).body.code).toBe('FORBIDDEN_FIELD');
      const cancelled = await brand.post(`${API}/orders/${id}/cancel`).send({ reason: 'Customer changed their mind' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.cancelledAt).toBeTruthy();
      const locked = await brand.patch(`${API}/orders/${id}`).send({ notes: 'too late' });
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe('ORDER_LOCKED');
      const again = await brand.post(`${API}/orders/${id}/cancel`).send({});
      expect(again.body.code).toBe('NOT_CANCELLABLE');
    });

    it('lets staff apply any allowed transition and rejects invalid ones', async () => {
      const brand = await t.as('brandNile');
      const admin = await t.as('ops');
      const { body } = await brand.post(`${API}/orders`).send(orderBody());
      const hold = await admin.post(`${API}/orders/${body.id}/status`).send({ status: 'ON_HOLD', note: 'Waiting for brand confirmation' });
      expect(hold.status).toBe(200);
      expect(hold.body.status).toBe('ON_HOLD');
      const bad = await admin.post(`${API}/orders/${body.id}/status`).send({ status: 'DELIVERED' });
      expect(bad.status).toBe(409);
      expect(bad.body.code).toBe('INVALID_TRANSITION');
      expect(bad.body.details).toMatchObject({ from: 'ON_HOLD', to: 'DELIVERED' });
      const back = await admin.post(`${API}/orders/${body.id}/status`).send({ status: 'CREATED' });
      expect(back.body.status).toBe('CREATED');
      expect(back.body.allowedTransitions).toEqual(expect.arrayContaining(['PICKUP_ASSIGNED', 'CANCELLED']));
      const noCourier = await admin.post(`${API}/orders/${body.id}/status`).send({ status: 'PICKUP_ASSIGNED' });
      expect(noCourier.body.code).toBe('COURIER_REQUIRED');
    });
  });

  describe('list, counts, export & labels', () => {
    it('filters, counts and exports', async () => {
      const own = await createTestBrand(t);
      const brand = await own.login();
      const a = await brand.post(`${API}/orders`).send(orderBody({ brandReference: 'A-1', recipient: { name: 'Karim Fawzy', phone: randomPhone() } }));
      const b = await brand.post(`${API}/orders`).send(orderBody({ brandReference: 'B-2', paymentMethod: 'PREPAID', codAmountCents: 0, address: { line: 'Road 9, Maadi' } }));
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      await brand.post(`${API}/orders/${b.body.id}/cancel`).send({});

      const all = await brand.get(`${API}/orders?sort=createdAt&order=asc`);
      expect(all.body.meta.total).toBe(2);
      expect(all.body.data[0].brandReference).toBe('A-1');
      expect((await brand.get(`${API}/orders?q=Karim`)).body.data).toHaveLength(1);
      expect((await brand.get(`${API}/orders?q=${a.body.trackingNumber}`)).body.data[0].id).toBe(a.body.id);
      expect((await brand.get(`${API}/orders?status=CANCELLED,DELIVERED`)).body.data.map((o: { id: string }) => o.id)).toEqual([b.body.id]);
      expect((await brand.get(`${API}/orders?paymentMethod=PREPAID`)).body.meta.total).toBe(1);
      expect((await brand.get(`${API}/orders?zoneId=${await zoneId(t, 'CAI-MAADI')}`)).body.meta.total).toBe(1);
      const today = new Date().toISOString().slice(0, 10);
      expect((await brand.get(`${API}/orders?from=2020-01-01&to=2020-01-02`)).body.meta.total).toBe(0);
      expect((await brand.get(`${API}/orders?from=${today}`)).body.meta.total).toBeGreaterThanOrEqual(1);

      const counts = await brand.get(`${API}/orders/counts`);
      expect(counts.body.total).toBe(2);
      expect(counts.body.byStatus.CREATED).toBe(1);
      expect(counts.body.byStatus.CANCELLED).toBe(1);
      expect(counts.body.groups.new).toBe(1);

      const csv = await brand.get(`${API}/orders/export`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['x-export-rows']).toBe('2');
      const lines = csv.text.replace(/^﻿/, '').trim().split(/\r?\n/);
      expect(lines[0]).toContain('tracking_number');
      expect(lines[0]).not.toContain('risk_score');
      expect(lines).toHaveLength(3);
      expect(csv.text).toContain(a.body.trackingNumber);

      const labels = await brand.post(`${API}/orders/labels`).send({ ids: [a.body.id, b.body.id] });
      expect(labels.status).toBe(200);
      const label = labels.body.labels[0];
      expect(label).toMatchObject({ trackingNumber: a.body.trackingNumber, codToCollectCents: 125_000, pieces: 1, serviceLevel: 'STANDARD', zone: { code: 'CAI-NASR' }, hubCode: 'HUB-NSR' });
      expect(label.brand.code).toBe(own.code);
      expect(label.recipient.phone).toMatch(/^01\d{2} \d{3} \d{4}$/);
    });
  });

  describe('bulk upload', () => {
    it('validates and creates rows from an Arabic CSV', async () => {
      const own = await createTestBrand(t);
      const brand = await own.login();
      const tpl = await brand.get(`${API}/orders/bulk/template?lang=ar`);
      expect(tpl.status).toBe(200);
      expect(tpl.text).toContain('اسم المستلم');

      const csv = [
        'رقم الطلب,اسم المستلم,رقم الموبايل,العنوان,مبلغ التحصيل,طريقة الدفع,نوع الخدمة,الوزن,يسمح بالفتح',
        'R-1,أحمد علي,01012345678,"١٢ شارع عباس العقاد، مدينة نصر","١٬٢٥٠",كاش,عادي,1,نعم',
        'R-2,منى سمير,٠١١٢٣٤٥٦٧٨٩,شارع ٩ المعادي,0,مدفوع,نفس اليوم,0.5,لا',
        'R-3,Bad Phone,12345,Nasr City,100,COD,STANDARD,1,no',
        'R-4,No Zone,01212345678,Unknown place far away,100,COD,STANDARD,1,no',
        'R-1,Dup Ref,01512345678,Heliopolis Korba,100,COD,STANDARD,1,no',
      ].join('\n');
      const v = await brand.post(`${API}/orders/bulk/validate`).attach('file', Buffer.from(csv, 'utf8'), 'orders.csv');
      expect(v.status).toBe(200);
      expect(v.body.total).toBe(5);
      expect(v.body.valid).toBe(2);
      const [r1, r2, r3, r4, r5] = v.body.rows;
      expect(r1.ok).toBe(true);
      expect(r1.zone.code).toBe('CAI-NASR');
      expect(r1.preview.codAmountCents).toBe(125_000);
      expect(r1.fees.totalFeesCents).toBe(Math.round((5500 + 1250) * 1.14));
      expect(r2.ok).toBe(true);
      expect(r2.zone.code).toBe('CAI-MAADI');
      expect(r2.preview).toMatchObject({ paymentMethod: 'PREPAID', serviceLevel: 'SAME_DAY', codAmountCents: 0 });
      expect(r3.errors[0]).toMatchObject({ field: 'phone', code: 'INVALID_PHONE' });
      expect(r4.errors[0].code).toBe('ZONE_NOT_DETECTED');
      expect(r5.errors[0].code).toBe('DUPLICATE_REFERENCE');

      const created = await brand.post(`${API}/orders/bulk`).attach('file', Buffer.from(csv, 'utf8'), 'orders.csv');
      expect(created.status).toBe(201);
      expect(created.body.created).toBe(2);
      expect(created.body.failed).toBe(3);
      const list = await brand.get(`${API}/orders?source=BULK_UPLOAD`);
      expect(list.body.meta.total).toBe(2);

      // JSON rows work too, and re-uploading the same reference is rejected
      const again = await brand.post(`${API}/orders/bulk/validate`).send({ rows: [{ reference: 'R-1', name: 'X Y', phone: '01012345678', address: 'Nasr City 1', cod: '10' }] });
      expect(again.body.rows[0].errors[0].code).toBe('DUPLICATE_REFERENCE');
      const tooMany = await brand.post(`${API}/orders/bulk/validate`).send({ rows: Array.from({ length: 501 }, () => ({ name: 'a' })) });
      expect(tooMany.status).toBe(400);
    });
  });
});
