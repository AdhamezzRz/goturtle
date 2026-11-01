import { CAIRO_ROAD_FACTOR, haversineKm, travelMinutes, type LatLng } from '@goturtle/shared';
import {
  blocks, emptyMatrix, fetchJson, RoutingProviderError, runLimited, type FetchFn, type MatrixOptions, type RoutingProvider, type TravelMatrix,
} from './routing.types';

// ------------------------------------------------------------------ haversine

/** Crow-flies × Cairo road factor at the vehicle's average speed (the original behaviour; no network). */
export class HaversineProvider implements RoutingProvider {
  readonly name = 'haversine' as const;

  async matrix(points: LatLng[], opts: MatrixOptions = {}): Promise<TravelMatrix> {
    return haversineMatrix(points, opts.vehicle);
  }
}

export function haversineMatrix(points: LatLng[], vehicle?: string): TravelMatrix {
  const m = emptyMatrix(points.length);
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const crow = haversineKm(points[i], points[j]);
      m.km[i][j] = crow * CAIRO_ROAD_FACTOR;
      m.minutes[i][j] = travelMinutes(crow, vehicle);
    }
  }
  return m;
}

// ------------------------------------------------------------------ OSRM

export interface OsrmOptions {
  baseUrl: string;
  /** OSRM's --max-table-size (default 100): coordinates per request. */
  maxTableSize?: number;
  timeoutMs?: number;
  concurrency?: number;
  profile?: string;
  fetchFn?: FetchFn;
}

/**
 * OSRM Table service: `GET {base}/table/v1/{profile}/{lng,lat;…}?annotations=duration,distance`.
 * Larger sets are split into source × destination blocks that each fit the table size.
 */
export class OsrmProvider implements RoutingProvider {
  readonly name = 'osrm' as const;
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: OsrmOptions) {
    this.fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  async matrix(points: LatLng[]): Promise<TravelMatrix> {
    const n = points.length;
    const m = emptyMatrix(n);
    if (n < 2) return m;
    const half = Math.max(1, Math.floor((this.opts.maxTableSize ?? 100) / 2));
    const parts = n <= (this.opts.maxTableSize ?? 100) ? [Array.from({ length: n }, (_, i) => i)] : blocks(n, half);
    const tasks: Array<() => Promise<void>> = [];
    for (const src of parts) {
      for (const dst of parts) {
        tasks.push(async () => {
          const ids = [...new Set([...src, ...dst])];
          const local = new Map(ids.map((g, l) => [g, l]));
          const coords = ids.map((g) => `${points[g].lng.toFixed(6)},${points[g].lat.toFixed(6)}`).join(';');
          const single = parts.length === 1;
          const query = single
            ? 'annotations=duration,distance'
            : `annotations=duration,distance&sources=${src.map((g) => local.get(g)).join(';')}&destinations=${dst.map((g) => local.get(g)).join(';')}`;
          const url = `${this.opts.baseUrl.replace(/\/$/, '')}/table/v1/${this.opts.profile ?? 'driving'}/${coords}?${query}`;
          const body = (await fetchJson(this.fetchFn, 'osrm', url, { timeoutMs: this.opts.timeoutMs ?? 4000 })) as { code?: string; message?: string; durations?: Array<Array<number | null>>; distances?: Array<Array<number | null>> };
          if (body.code !== 'Ok' || !body.durations) throw new RoutingProviderError('osrm', `${body.code ?? 'no code'} ${body.message ?? ''}`.trim());
          const srcIdx = single ? ids : src;
          const dstIdx = single ? ids : dst;
          srcIdx.forEach((gi, a) =>
            dstIdx.forEach((gj, b) => {
              if (gi === gj) return;
              const sec = body.durations![a]?.[b];
              const meters = body.distances?.[a]?.[b];
              if (sec == null) throw new RoutingProviderError('osrm', `no route between points ${gi} and ${gj}`);
              m.minutes[gi][gj] = sec / 60;
              m.km[gi][gj] = meters != null ? meters / 1000 : haversineKm(points[gi], points[gj]) * CAIRO_ROAD_FACTOR;
            }),
          );
        });
      }
    }
    await runLimited(tasks, this.opts.concurrency ?? 2);
    return m;
  }
}

// ------------------------------------------------------------------ Google

export interface GoogleOptions {
  apiKey: string;
  /** Distance Matrix: ≤ 25 origins, ≤ 25 destinations and ≤ 100 elements per request. */
  blockSize?: number;
  /** Elements are billed one by one: above this many points we fall back to haversine. */
  maxPoints?: number;
  timeoutMs?: number;
  concurrency?: number;
  fetchFn?: FetchFn;
  baseUrl?: string;
}

/**
 * Google Distance Matrix API (driving, departure now → traffic-aware
 * durations). Points are batched in 10 × 10 blocks (100 elements, the
 * per-request maximum); elements without a route fall back to the estimate.
 */
export class GoogleProvider implements RoutingProvider {
  readonly name = 'google' as const;
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: GoogleOptions) {
    this.fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  async matrix(points: LatLng[], opts: MatrixOptions = {}): Promise<TravelMatrix> {
    const n = points.length;
    if (n > (this.opts.maxPoints ?? 25)) throw new RoutingProviderError('google', `${n} points exceed the configured maximum of ${this.opts.maxPoints ?? 25}`);
    const m = haversineMatrix(points, opts.vehicle);
    if (n < 2) return m;
    const parts = blocks(n, Math.min(10, this.opts.blockSize ?? 10));
    const fmt = (g: number) => `${points[g].lat.toFixed(6)},${points[g].lng.toFixed(6)}`;
    const tasks: Array<() => Promise<void>> = [];
    for (const src of parts) {
      for (const dst of parts) {
        tasks.push(async () => {
          const params = new URLSearchParams({
            origins: src.map(fmt).join('|'),
            destinations: dst.map(fmt).join('|'),
            mode: 'driving',
            departure_time: 'now',
            units: 'metric',
            key: this.opts.apiKey,
          });
          const url = `${(this.opts.baseUrl ?? 'https://maps.googleapis.com').replace(/\/$/, '')}/maps/api/distancematrix/json?${params.toString()}`;
          const body = (await fetchJson(this.fetchFn, 'google', url, { timeoutMs: this.opts.timeoutMs ?? 5000 })) as {
            status?: string; error_message?: string;
            rows?: Array<{ elements?: Array<{ status?: string; distance?: { value: number }; duration?: { value: number }; duration_in_traffic?: { value: number } }> }>;
          };
          if (body.status !== 'OK' || !body.rows) throw new RoutingProviderError('google', `${body.status ?? 'no status'} ${body.error_message ?? ''}`.trim());
          src.forEach((gi, a) =>
            dst.forEach((gj, b) => {
              if (gi === gj) return;
              const el = body.rows![a]?.elements?.[b];
              if (!el || el.status !== 'OK' || !el.duration) return; // keep the estimate for this pair
              m.minutes[gi][gj] = (el.duration_in_traffic?.value ?? el.duration.value) / 60;
              if (el.distance) m.km[gi][gj] = el.distance.value / 1000;
            }),
          );
        });
      }
    }
    await runLimited(tasks, this.opts.concurrency ?? 3);
    return m;
  }
}
