import { Injectable, Logger, Optional } from '@nestjs/common';
import type { LatLng } from '@goturtle/shared';
import { SettingsService } from '../../settings/settings.service';
import { optimizeWithMatrix, type MatrixPlan, type MatrixStop } from './optimize';
import { GoogleProvider, HaversineProvider, OsrmProvider, haversineMatrix } from './providers';
import type { FetchFn, RoutingProvider, TravelMatrix } from './routing.types';

export type ProviderName = RoutingProvider['name'];

export interface RoutingPlan extends MatrixPlan {
  /** The provider whose matrix was used (haversine after a fallback). */
  provider: ProviderName;
  /** Why the configured provider was not used. */
  fallbackReason?: string;
}

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/**
 * Travel-time matrices for route optimisation. The provider comes from
 * settings `platform.routingProvider` (or ROUTING_PROVIDER):
 *   haversine — crow-flies × road factor (default, offline)
 *   osrm      — OSRM_URL (self-hosted or a hosted OSRM), Table service
 *   google    — GOOGLE_MAPS_API_KEY, Distance Matrix (traffic-aware, billed per element)
 * Any provider error, timeout or missing configuration falls back to haversine
 * so dispatching never blocks on a maps outage.
 */
@Injectable()
export class RoutingService {
  private readonly log = new Logger('Routing');
  private readonly haversine = new HaversineProvider();
  /** Overridable for tests; defaults to the global fetch. */
  fetchFn?: FetchFn;

  constructor(@Optional() private readonly settings?: SettingsService) {}

  /** The configured provider instance, or null + reason when it cannot be used. */
  async provider(): Promise<{ provider: RoutingProvider; reason?: string }> {
    const configured = (process.env.ROUTING_PROVIDER as ProviderName | undefined) || (this.settings ? (await this.settings.get('platform')).routingProvider : 'haversine');
    const timeoutMs = int(process.env.ROUTING_TIMEOUT_MS, 4000);
    if (configured === 'osrm') {
      const baseUrl = process.env.OSRM_URL;
      if (!baseUrl) return { provider: this.haversine, reason: 'OSRM_URL is not configured' };
      return { provider: new OsrmProvider({ baseUrl, timeoutMs, maxTableSize: int(process.env.OSRM_MAX_TABLE_SIZE, 100), profile: process.env.OSRM_PROFILE || 'driving', fetchFn: this.fetchFn }) };
    }
    if (configured === 'google') {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) return { provider: this.haversine, reason: 'GOOGLE_MAPS_API_KEY is not configured' };
      return { provider: new GoogleProvider({ apiKey, timeoutMs, maxPoints: int(process.env.GOOGLE_MATRIX_MAX_POINTS, 25), fetchFn: this.fetchFn }) };
    }
    return { provider: this.haversine };
  }

  /** Matrix over [start, ...points] with graceful fallback. */
  async matrix(points: LatLng[], vehicle?: string): Promise<{ matrix: TravelMatrix; provider: ProviderName; fallbackReason?: string }> {
    const { provider, reason } = await this.provider();
    if (provider.name === 'haversine') return { matrix: haversineMatrix(points, vehicle), provider: 'haversine', fallbackReason: reason };
    try {
      const matrix = await provider.matrix(points, { vehicle });
      return { matrix, provider: provider.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`${provider.name} matrix failed, using haversine: ${message}`);
      return { matrix: haversineMatrix(points, vehicle), provider: 'haversine', fallbackReason: message.slice(0, 200) };
    }
  }

  /** Optimised open route from `start` through `stops` (nearest neighbour + 2-opt on matrix costs). */
  async plan(start: LatLng, stops: MatrixStop[], opts: { vehicle?: string } = {}): Promise<RoutingPlan> {
    if (!stops.length) return { stops: [], totalKm: 0, totalMinutes: 0, provider: 'haversine' };
    const { matrix, provider, fallbackReason } = await this.matrix([start, ...stops], opts.vehicle);
    return { ...optimizeWithMatrix(stops, matrix), provider, ...(fallbackReason ? { fallbackReason } : {}) };
  }
}
