import { and, eq } from 'drizzle-orm';
import { normalizeEgyptPhone } from '@goturtle/shared';
import * as s from '../src/db/schema';
import { AddressBookService } from '../src/modules/address-book/address-book.service';
import { GeocoderError, GoogleGeocoder, MapboxGeocoder, NoGeocoder, geocoderFromEnv, type Geocoder } from '../src/modules/address-book/geocoder';
import type { TestContext } from './helpers';
import { bearer, bootTestApp, courierByCode, createTestBrand, customerTokenFor, hubId, orderBody, randomPhone, tokenFor, zoneId, type Agent } from './ops-factories';
import { orderRow, waitFor } from './integrity-factories';

const API = '/api/v1';
const DOOR = { lat: 30.0573, lng: 31.3461 }; // hero GPS at the customer's door, Nasr City

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Address intelligence: address book, verified pin reuse, customer pins, location requests, geocoder. */
describe('Address intelligence (e2e)', () => {
  let t: TestContext;
  let book: AddressBookService;
  let hubNsr: string;
  let heroId: string;
  let hero: Agent;

  beforeAll(async () => {
    t = await bootTestApp();
    book = t.app.get(AddressBookService);
    hubNsr = await hubId(t, 'HUB-NSR');
    const h = await courierByCode(t, 'HR-00008');
    heroId = h.id;
    hero = bearer(t, await tokenFor(t, h.userId, 'COURIER'));
  });
  afterAll(async () => {
    book.useGeocoder(new NoGeocoder());
    await t.close();
  });

  async function create(b: Agent, phone: string, address: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const res = await b.post(`${API}/orders`).send(orderBody({ recipient: { name: 'Laila Mostafa', phone }, address, codAmountCents: 45_000, ...extra }));
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    // the address book listener runs after the response
    await waitFor(async () => (await orderRow(t, id)).customerAddressId);
    return orderRow(t, id);
  }

  async function deliver(orderId: string, tn: string, gps: { lat: number; lng: number }) {
    await (await t.as('hub')).post(`${API}/dispatch/scan/inbound`).send({ hubId: hubNsr, trackingNumber: tn }).expect(200);
    const rs = await (await t.as('dispatcher')).post(`${API}/runsheets`).send({ courierId: heroId, orderIds: [orderId] });
    expect(rs.status).toBe(201);
    await (await t.as('ops')).post(`${API}/runsheets/${rs.body.id}/dispatch`).send({ override: true }).expect(200);
    const o = await orderRow(t, orderId);
    const res = await hero.post(`${API}/hero/tasks/orders/${orderId}/deliver`).send({ collectedCents: o.collectCents, ...gps });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DELIVERED');
  }

  it('builds the address book, verifies it on delivery and reuses the pin for the next order', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const phone = randomPhone('011');
    const address = { line: '14 Abbas El Akkad St, Nasr City', building: '14', floor: '5', apartment: '12' };
    const first = await create(b, phone, address);
    expect(first.lat).toBeNull();
    const [a0] = await t.db.select().from(s.customerAddresses).where(eq(s.customerAddresses.id, first.customerAddressId!));
    expect(a0).toMatchObject({ customerId: first.customerId, isVerified: false, source: 'ORDER', usageCount: 1, deliveredCount: 0, lat: null });

    await deliver(first.id, first.trackingNumber, DOOR);
    const [a1] = await t.db.select().from(s.customerAddresses).where(eq(s.customerAddresses.id, first.customerAddressId!));
    expect(a1).toMatchObject({ isVerified: true, deliveredCount: 1, lat: DOOR.lat, lng: DOOR.lng });

    // same customer, same address written slightly differently, no pin → the verified pin is reused
    const second = await create(b, phone, { line: '14 Abbas el-Akkad street, Nasr City', building: '14' });
    expect(second).toMatchObject({ lat: DOOR.lat, lng: DOOR.lng, customerAddressId: first.customerAddressId });
    const [note] = await t.db.select().from(s.orderEvents).where(and(eq(s.orderEvents.orderId, second.id), eq(s.orderEvents.reason, 'PIN_REUSED')));
    expect(note).toMatchObject({ note: 'Pin reused from a previous delivery', isPublic: false });
    const [a2] = await t.db.select().from(s.customerAddresses).where(eq(s.customerAddresses.id, first.customerAddressId!));
    expect(a2.usageCount).toBe(2);

    // a different street in the same zone is a new, unverified address (no pin copied)
    const third = await create(b, phone, { line: 'Makram Ebeid, City Stars towers, Nasr City' });
    expect(third.lat).toBeNull();
    expect(third.customerAddressId).not.toBe(first.customerAddressId);

    // staff address book
    const list = await (await t.as('support')).get(`${API}/customers/${first.customerId}/addresses`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.find((x: { id: string }) => x.id === first.customerAddressId)).toMatchObject({ isVerified: true, hasPin: true, deliveredCount: 1, ordersCount: 2, zone: { code: 'CAI-NASR' } });
    expect((await (await t.as('brandNile')).get(`${API}/customers/${first.customerId}/addresses`)).status).toBe(403);
  });

  it('brand suggestions list only that brand’s addresses (no coordinates) plus a verified-pin flag', async () => {
    const phone = randomPhone('012');
    const mine = await createTestBrand(t);
    const other = await createTestBrand(t);
    const b = await mine.login();
    const o = await create(b, phone, { line: '3 Youssef Abbas St, Nasr City', building: '3' });
    await deliver(o.id, o.trackingNumber, DOOR);
    const otherAgent = await other.login();

    const own = await b.get(`${API}/address-book/suggest`).query({ phone });
    expect(own.status).toBe(200);
    expect(own.body.verifiedPinAvailable).toBe(true);
    expect(own.body.addresses).toHaveLength(1);
    expect(own.body.addresses[0]).toMatchObject({ addressLine: '3 Youssef Abbas St, Nasr City', building: '3', verifiedPin: true, ordersCount: 1, zone: { code: 'CAI-NASR' } });
    expect(JSON.stringify(own.body)).not.toMatch(/"lat"|"lng"|customerId/);

    const foreign = await otherAgent.get(`${API}/address-book/suggest`).query({ phone });
    expect(foreign.body).toEqual({ phone: normalizeEgyptPhone(phone), verifiedPinAvailable: true, addresses: [] });
    expect((await otherAgent.get(`${API}/address-book/suggest`).query({ phone: randomPhone() })).body).toMatchObject({ addresses: [], verifiedPinAvailable: false });
    expect((await (await t.as('ops')).get(`${API}/address-book/suggest`).query({ phone })).status).toBe(403);
    // the network risk lookup now sees the verified pin too
    expect((await otherAgent.get(`${API}/customers/risk`).query({ phone })).body.verifiedPinAvailable).toBe(true);
  });

  it('customer pins (tracking page and "drop your pin" link) verify the address; location requests go out once', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const phone = randomPhone('015');
    const e164 = normalizeEgyptPhone(phone)!;

    // existing tracking endpoint (verified session)
    const o1 = await create(b, phone, { line: '22 Hassan El Maamoun, Nasr City' });
    const session = bearer(t, await customerTokenFor(t, e164));
    expect((await session.patch(`${API}/track/${o1.trackingNumber}/address`).send({ lat: 30.0551, lng: 31.3399 })).status).toBe(200);
    const a1 = await waitFor(async () => {
      const [a] = await t.db.select().from(s.customerAddresses).where(eq(s.customerAddresses.id, o1.customerAddressId!));
      return a.isVerified ? a : null;
    });
    expect(a1).toMatchObject({ source: 'CUSTOMER_PIN', lat: 30.0551, lng: 31.3399 });

    // location request job → signed link → pin dropped without logging in
    const o2 = await create(b, phone, { line: 'Villa 9, 10th district, Nasr City' });
    await (await t.as('hub')).post(`${API}/dispatch/scan/inbound`).send({ hubId: hubNsr, trackingNumber: o2.trackingNumber }).expect(200);
    expect(await book.requestMissingPins(new Date(), [o1.id, o2.id])).toBe('requested 1'); // o1 already has a pin
    expect(await book.requestMissingPins(new Date(), [o2.id])).toBe('requested 0'); // once per order
    const [msg] = await t.db.select().from(s.notifications).where(and(eq(s.notifications.orderId, o2.id), eq(s.notifications.template, 'location_request')));
    expect(msg.body).toContain(`/t/${o2.trackingNumber}?pin=1&p=`);
    const token = /[?&]p=([A-Za-z0-9_.-]+)/.exec(msg.body)![1];

    const state = await t.http().get(`${API}/track/${o2.trackingNumber}/integrity`).query({ p: token });
    expect(state.body.pin).toMatchObject({ hasPin: false, canDrop: true, authorized: true, link: 'VALID' });
    expect(state.body.pin.center).toBeTruthy();
    expect((await t.http().post(`${API}/track/${o2.trackingNumber}/pin`).send({ lat: 30.06, lng: 31.34 })).body.code).toBe('LINK_INVALID');
    expect((await t.http().post(`${API}/track/${o2.trackingNumber}/pin`).send({ lat: 31.2, lng: 29.9, token })).body.code).toBe('PIN_OUT_OF_ZONE');
    const pinned = await t.http().post(`${API}/track/${o2.trackingNumber}/pin`).send({ lat: 30.0612, lng: 31.3377, token });
    expect(pinned.status).toBe(200);
    expect(await orderRow(t, o2.id)).toMatchObject({ lat: 30.0612, lng: 31.3377 });
    const [a2] = await t.db.select().from(s.customerAddresses).where(eq(s.customerAddresses.id, o2.customerAddressId!));
    expect(a2).toMatchObject({ isVerified: true, source: 'CUSTOMER_PIN', lat: 30.0612 });
  });

  it('geocodes orders without a pin when zone detection was unsure (approximate, unverified)', async () => {
    const seen: string[] = [];
    const fake: Geocoder = {
      name: 'google',
      enabled: true,
      geocode: async (q) => {
        seen.push(q);
        return { lat: 30.0702, lng: 31.3301, confidence: 0.8, provider: 'google', formatted: 'Nasr City, Cairo' };
      },
    };
    book.useGeocoder(fake);
    try {
      const brand = await createTestBrand(t);
      const o = await create(await brand.login(), randomPhone(), { line: 'Near the big mosque, 8th district', zoneId: await zoneId(t, 'CAI-NASR') });
      const row = await waitFor(async () => {
        const r = await orderRow(t, o.id);
        return (r.metadata as { geocode?: unknown })?.geocode ? r : null;
      });
      expect(row.lat).toBeNull(); // never used as the delivery pin / geofence
      expect((row.metadata as { geocode: { provider: string; confidence: number } }).geocode).toMatchObject({ provider: 'google', confidence: 0.8 });
      expect(seen[0]).toContain('Near the big mosque');
      const [a] = await t.db.select().from(s.customerAddresses).where(eq(s.customerAddresses.id, row.customerAddressId!));
      expect(a).toMatchObject({ source: 'GEOCODER', isVerified: false, lat: 30.0702 });
    } finally {
      book.useGeocoder(new NoGeocoder());
    }
  });

  describe('geocoder adapters (mocked fetch)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('Google: Egypt-biased request, precision → confidence, empty and error responses', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        jsonResponse({ status: 'OK', results: [{ formatted_address: 'Abbas El Akkad, Nasr City', geometry: { location: { lat: 30.059, lng: 31.342 }, location_type: 'ROOFTOP' } }] }),
      );
      const g = new GoogleGeocoder('key-123');
      const hit = await g.geocode('5 عباس العقاد، مدينة نصر', { near: { lat: 30.0566, lng: 31.3439 } });
      expect(hit).toEqual({ lat: 30.059, lng: 31.342, confidence: 0.95, provider: 'google', formatted: 'Abbas El Akkad, Nasr City' });
      const url = new URL(String(spy.mock.calls[0][0]));
      expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/geocode/json');
      expect(url.searchParams.get('components')).toBe('country:EG');
      expect(url.searchParams.get('region')).toBe('eg');
      expect(url.searchParams.get('key')).toBe('key-123');
      expect(url.searchParams.get('bounds')).toBe('29.906600,31.193900|30.206600,31.493900');

      spy.mockResolvedValueOnce(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));
      expect(await g.geocode('nowhere')).toBeNull();
      spy.mockResolvedValueOnce(jsonResponse({ status: 'OK', results: [{ geometry: { location: { lat: 48.85, lng: 2.35 }, location_type: 'ROOFTOP' } }] }));
      expect(await g.geocode('Paris')).toBeNull(); // outside Egypt
      spy.mockResolvedValueOnce(jsonResponse({ status: 'OK', results: [{ partial_match: true, geometry: { location: { lat: 30.05, lng: 31.3 }, location_type: 'GEOMETRIC_CENTER' } }] }));
      expect((await g.geocode('partial'))!.confidence).toBeCloseTo(0.4);
      spy.mockResolvedValueOnce(jsonResponse({ status: 'REQUEST_DENIED', error_message: 'bad key' }));
      await expect(g.geocode('x')).rejects.toBeInstanceOf(GeocoderError);
      spy.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(g.geocode('x')).rejects.toThrow(/500/);
    });

    it('Mapbox: proximity bias, relevance × precision → confidence', async () => {
      const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        jsonResponse({ features: [{ center: [31.342, 30.059], relevance: 0.9, place_type: ['address'], place_name: 'Abbas El Akkad, Nasr City, Cairo, Egypt' }] }),
      );
      const m = new MapboxGeocoder('tok');
      const hit = await m.geocode('Abbas El Akkad, Nasr City', { near: { lat: 30.0566, lng: 31.3439 }, language: 'en' });
      expect(hit).toMatchObject({ lat: 30.059, lng: 31.342, provider: 'mapbox', formatted: 'Abbas El Akkad, Nasr City, Cairo, Egypt' });
      expect(hit!.confidence).toBeCloseTo(0.9);
      const url = new URL(String(spy.mock.calls[0][0]));
      expect(url.pathname).toBe(`/geocoding/v5/mapbox.places/${encodeURIComponent('Abbas El Akkad, Nasr City')}.json`);
      expect(url.searchParams.get('country')).toBe('eg');
      expect(url.searchParams.get('proximity')).toBe('31.3439,30.0566');
      expect(url.searchParams.get('access_token')).toBe('tok');

      spy.mockResolvedValueOnce(jsonResponse({ features: [{ center: [31.3, 30.05], relevance: 1, place_type: ['neighborhood'] }] }));
      expect((await m.geocode('Nasr City'))!.confidence).toBeCloseTo(0.6);
      spy.mockResolvedValueOnce(jsonResponse({ features: [] }));
      expect(await m.geocode('nothing')).toBeNull();
      spy.mockResolvedValueOnce(jsonResponse({ message: 'Not Authorized' }, 401));
      await expect(m.geocode('x')).rejects.toBeInstanceOf(GeocoderError);
    });

    it('picks the adapter from GEOCODER and its key', () => {
      expect(geocoderFromEnv({ GEOCODER: 'google', GOOGLE_MAPS_API_KEY: 'k' } as NodeJS.ProcessEnv).name).toBe('google');
      expect(geocoderFromEnv({ GEOCODER: 'mapbox', MAPBOX_TOKEN: 't' } as NodeJS.ProcessEnv).name).toBe('mapbox');
      expect(geocoderFromEnv({ GEOCODER: 'google' } as NodeJS.ProcessEnv).name).toBe('none'); // no key → off
      expect(geocoderFromEnv({} as NodeJS.ProcessEnv).enabled).toBe(false);
    });
  });
});
