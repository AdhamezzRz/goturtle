import { optimizeRoute, type LatLng } from '@goturtle/shared';
import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { optimizeWithMatrix } from '../src/modules/dispatch/routing/optimize';
import { GoogleProvider, haversineMatrix, OsrmProvider } from '../src/modules/dispatch/routing/providers';
import { RoutingService } from '../src/modules/dispatch/routing/routing.service';
import type { FetchFn } from '../src/modules/dispatch/routing/routing.types';
import type { TestContext } from './helpers';
import { bootTestApp, courierByCode, createTestBrand, hubId, orderBody } from './ops-factories';
import { staffAgent } from './intake-factories';

const API = '/api/v1';

/** Mocked fetch: records URLs and answers with `handler(url)` (or rejects / hangs). */
function mockFetch(handler: (url: string) => unknown | Promise<unknown>, status = 200) {
  const calls: string[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push(url);
    const body = await new Promise<unknown>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      Promise.resolve(handler(url)).then(resolve, reject);
    });
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { fn, calls };
}

/** Points around Nasr City / Heliopolis. */
const POINTS: LatLng[] = [
  { lat: 30.0566, lng: 31.3372 },
  { lat: 30.0590, lng: 31.3420 },
  { lat: 30.0911, lng: 31.3225 },
  { lat: 30.0700, lng: 31.3500 },
  { lat: 30.0450, lng: 31.3600 },
  { lat: 30.1000, lng: 31.3300 },
  { lat: 30.0800, lng: 31.3100 },
];

/** OSRM table answer for the coordinates in a URL, from a reference matrix over POINTS. */
function osrmAnswer(url: string, ref: { km: number[][]; minutes: number[][] }) {
  const path = new URL(url).pathname.split('/').pop()!;
  const coords = path.split(';').map((c) => c.split(',').map(Number));
  const idx = coords.map(([lng, lat]) => POINTS.findIndex((p) => Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lng - lng) < 1e-6));
  const q = new URL(url).searchParams;
  const sources = q.get('sources') ? q.get('sources')!.split(';').map(Number) : idx.map((_, i) => i);
  const dests = q.get('destinations') ? q.get('destinations')!.split(';').map(Number) : idx.map((_, i) => i);
  return {
    code: 'Ok',
    durations: sources.map((a) => dests.map((b) => ref.minutes[idx[a]][idx[b]] * 60)),
    distances: sources.map((a) => dests.map((b) => ref.km[idx[a]][idx[b]] * 1000)),
  };
}

describe('Routing providers (unit, mocked fetch)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('haversine matrix + matrix optimiser reproduce the original optimiser exactly', () => {
    const [start, ...rest] = POINTS;
    const stops = rest.map((p, i) => ({ id: `o${i}`, ...p }));
    const original = optimizeRoute(start, stops, { vehicle: 'MOTORCYCLE' });
    const plan = optimizeWithMatrix(stops, haversineMatrix(POINTS, 'MOTORCYCLE'));
    expect(plan.stops.map((x) => x.id)).toEqual(original.stops.map((x) => x.id));
    expect(plan.stops.map((x) => x.etaMinutes)).toEqual(original.stops.map((x) => x.etaMinutes));
    expect(plan.stops.map((x) => x.legKm)).toEqual(original.stops.map((x) => x.legKm));
    expect(plan.totalKm).toBeCloseTo(original.totalKm, 1);
    expect(plan.totalMinutes).toBe(original.totalMinutes);
  });

  it('2-opt on an asymmetric matrix follows the cheap direction (one-way streets)', () => {
    // start → A → B is cheap, start → B → A is expensive although distances are equal.
    const m = { km: [[0, 1, 1], [1, 0, 1], [1, 1, 0]], minutes: [[0, 5, 1], [5, 0, 30], [5, 2, 0]] };
    const plan = optimizeWithMatrix([{ id: 'A', lat: 0, lng: 0 }, { id: 'B', lat: 0, lng: 0 }], m);
    expect(plan.stops.map((x) => x.id)).toEqual(['B', 'A']);
    expect(plan.stops.map((x) => x.etaMinutes)).toEqual([1, 1 + 7 + 2]);
    expect(plan.totalMinutes).toBe(1 + 7 + 2 + 7);
  });

  it('OSRM: one table request (lng,lat order) mapped into the matrix', async () => {
    const ref = haversineMatrix(POINTS, 'CAR');
    const { fn, calls } = mockFetch((url) => osrmAnswer(url, ref));
    const m = await new OsrmProvider({ baseUrl: 'https://osrm.example/', fetchFn: fn }).matrix(POINTS);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^https:\/\/osrm\.example\/table\/v1\/driving\/31\.337200,30\.056600;/);
    expect(calls[0]).toContain('annotations=duration,distance');
    expect(m.minutes[1][2]).toBeCloseTo(ref.minutes[1][2], 6);
    expect(m.km[3][4]).toBeCloseTo(ref.km[3][4], 6);
  });

  it('OSRM: batches source × destination blocks beyond the table size', async () => {
    const ref = haversineMatrix(POINTS, 'CAR');
    const { fn, calls } = mockFetch((url) => osrmAnswer(url, ref));
    const m = await new OsrmProvider({ baseUrl: 'https://osrm.example', maxTableSize: 4, fetchFn: fn }).matrix(POINTS);
    // 7 points, blocks of 2 → 4 blocks → 16 requests, each with ≤ 4 coordinates.
    expect(calls).toHaveLength(16);
    for (const c of calls) expect(new URL(c).pathname.split('/').pop()!.split(';').length).toBeLessThanOrEqual(4);
    for (let i = 0; i < POINTS.length; i++) for (let j = 0; j < POINTS.length; j++) expect(m.minutes[i][j]).toBeCloseTo(ref.minutes[i][j], 6);
  });

  it('OSRM: NoRoute / HTTP errors throw', async () => {
    await expect(new OsrmProvider({ baseUrl: 'https://osrm.example', fetchFn: mockFetch(() => ({ code: 'NoTable', message: 'bad' })).fn }).matrix(POINTS)).rejects.toThrow('NoTable');
    await expect(new OsrmProvider({ baseUrl: 'https://osrm.example', fetchFn: mockFetch(() => ({}), 503).fn }).matrix(POINTS)).rejects.toThrow('HTTP 503');
  });

  it('Google: 10 × 10 blocks, traffic-aware durations, per-element fallback, key in the query', async () => {
    const many: LatLng[] = Array.from({ length: 12 }, (_, i) => ({ lat: 30 + i * 0.01, lng: 31.3 + i * 0.005 }));
    const { fn, calls } = mockFetch((url) => {
      const q = new URL(url).searchParams;
      const o = q.get('origins')!.split('|');
      const d = q.get('destinations')!.split('|');
      return {
        status: 'OK',
        rows: o.map((_, a) => ({
          elements: d.map((_, b) => (a === 0 && b === 1 ? { status: 'ZERO_RESULTS' } : { status: 'OK', distance: { value: 2500 }, duration: { value: 600 }, duration_in_traffic: { value: 900 } })),
        })),
      };
    });
    const m = await new GoogleProvider({ apiKey: 'test-key', fetchFn: fn }).matrix(many, { vehicle: 'MOTORCYCLE' });
    expect(calls).toHaveLength(4);
    expect(new URL(calls[0]).searchParams.get('key')).toBe('test-key');
    expect(new URL(calls[0]).searchParams.get('departure_time')).toBe('now');
    expect(m.minutes[2][3]).toBe(15);
    expect(m.km[2][3]).toBe(2.5);
    // ZERO_RESULTS for origin 0 → destination 1 keeps the haversine estimate.
    expect(m.minutes[0][1]).toBeCloseTo(haversineMatrix(many, 'MOTORCYCLE').minutes[0][1], 6);
    await expect(new GoogleProvider({ apiKey: 'k', fetchFn: mockFetch(() => ({ status: 'REQUEST_DENIED', error_message: 'API key invalid' })).fn }).matrix(many)).rejects.toThrow('REQUEST_DENIED');
    await expect(new GoogleProvider({ apiKey: 'k', maxPoints: 5, fetchFn: fn }).matrix(many)).rejects.toThrow('exceed');
  });

  it('RoutingService: provider from env, graceful fallback to haversine on errors, timeouts and missing config', async () => {
    const svc = new RoutingService();
    const [start, ...rest] = POINTS;
    const stops = rest.map((p, i) => ({ id: `o${i}`, ...p }));
    const baseline = optimizeRoute(start, stops, { vehicle: 'MOTORCYCLE' });

    expect((await svc.plan(start, stops, { vehicle: 'MOTORCYCLE' })).provider).toBe('haversine');

    process.env.ROUTING_PROVIDER = 'osrm';
    delete process.env.OSRM_URL;
    const noUrl = await svc.plan(start, stops, { vehicle: 'MOTORCYCLE' });
    expect(noUrl).toMatchObject({ provider: 'haversine', fallbackReason: 'OSRM_URL is not configured' });
    expect(noUrl.stops.map((x) => x.id)).toEqual(baseline.stops.map((x) => x.id));

    process.env.OSRM_URL = 'https://osrm.example';
    svc.fetchFn = mockFetch(() => Promise.reject(new Error('ECONNREFUSED'))).fn;
    const down = await svc.plan(start, stops, { vehicle: 'MOTORCYCLE' });
    expect(down.provider).toBe('haversine');
    expect(down.fallbackReason).toContain('ECONNREFUSED');
    expect(down.stops.map((x) => x.etaMinutes)).toEqual(baseline.stops.map((x) => x.etaMinutes));

    process.env.ROUTING_TIMEOUT_MS = '50';
    svc.fetchFn = mockFetch(() => new Promise(() => undefined)).fn;
    const slow = await svc.plan(start, stops);
    expect(slow.provider).toBe('haversine');
    expect(slow.fallbackReason).toContain('timed out');

    const ref = haversineMatrix(POINTS, 'CAR');
    svc.fetchFn = mockFetch((url) => osrmAnswer(url, ref)).fn;
    const ok = await svc.plan(start, stops);
    expect(ok.provider).toBe('osrm');
    expect(ok.fallbackReason).toBeUndefined();

    process.env.ROUTING_PROVIDER = 'google';
    delete process.env.GOOGLE_MAPS_API_KEY;
    expect((await svc.plan(start, stops)).fallbackReason).toBe('GOOGLE_MAPS_API_KEY is not configured');
  });
});

describe('Runsheet optimisation through the routing provider (e2e)', () => {
  let t: TestContext;
  const env = { ...process.env };

  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(async () => {
    process.env = { ...env };
    await t.close();
  });

  it('optimises on the OSRM matrix (same output shape, ETAs from the provider) and falls back when it is down', async () => {
    const brand = await createTestBrand(t);
    const b = await brand.login();
    const ops = await staffAgent(t, 'ops');
    const hub = await hubId(t, 'HUB-NSR');
    const hero = await courierByCode(t, 'HR-00010');
    const ids: string[] = [];
    for (const p of POINTS.slice(1, 4)) {
      const o = await b.post(`${API}/orders`).send(orderBody({ codAmountCents: 10_000, address: { line: '12 Makram Ebeid St, Nasr City', lat: p.lat, lng: p.lng } }));
      expect(o.status).toBe(201);
      expect((await ops.post(`${API}/dispatch/scan/inbound`).send({ hubId: hub, trackingNumber: o.body.trackingNumber })).status).toBe(200);
      ids.push(o.body.id);
    }
    const rs = await ops.post(`${API}/runsheets`).send({ courierId: hero.id, orderIds: ids, hubId: hub });
    expect(rs.status).toBe(201);

    // OSRM says every leg takes exactly 10 minutes / 3 km.
    process.env.ROUTING_PROVIDER = 'osrm';
    process.env.OSRM_URL = 'https://osrm.example';
    const routing = t.app.get(RoutingService);
    const { fn, calls } = mockFetch((url) => {
      const n = new URL(url).pathname.split('/').pop()!.split(';').length;
      return { code: 'Ok', durations: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 600))), distances: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 3000))) };
    });
    routing.fetchFn = fn;
    const opt = await ops.post(`${API}/runsheets/${rs.body.id}/optimize`);
    expect(opt.status).toBe(200);
    expect(calls).toHaveLength(1);
    const [row] = await t.db.select().from(s.runsheets).where(eq(s.runsheets.id, rs.body.id));
    expect(row.route).toHaveLength(3);
    expect(row.route!.map((r) => r.etaMinutes)).toEqual([10, 27, 44]); // 10 + 7 service + 10 …
    expect(row.route!.map((r) => r.legKm)).toEqual([3, 3, 3]);
    expect(row.route![0]).toEqual(expect.objectContaining({ orderId: expect.any(String), seq: 1, lat: expect.any(Number), lng: expect.any(Number) }));
    expect(row.totalDistanceKm).toBe(9);
    expect(row.totalMinutes).toBe(51);

    routing.fetchFn = mockFetch(() => Promise.reject(new Error('down'))).fn;
    const fallback = await ops.post(`${API}/runsheets/${rs.body.id}/optimize`);
    expect(fallback.status).toBe(200);
    const [after] = await t.db.select().from(s.runsheets).where(eq(s.runsheets.id, rs.body.id));
    expect(after.route).toHaveLength(3);
    expect(after.totalDistanceKm).not.toBe(9);

    await ops.delete(`${API}/runsheets/${rs.body.id}/orders`).send({ orderIds: ids });
  });
});
