import type { LatLng } from '@goturtle/shared';
import { fetchWithTimeout, snippet } from '../notifications/providers/http';

/**
 * Forward geocoding, biased to Egypt. Used only as a fallback for orders
 * without a pin whose zone was detected with low confidence: the result is an
 * approximate, unverified point (never used for the failed-attempt geofence).
 *
 *   GEOCODER=none | google (GOOGLE_MAPS_API_KEY) | mapbox (MAPBOX_TOKEN)
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  /** 0..1 — how precise the provider says the match is. */
  confidence: number;
  provider: 'google' | 'mapbox';
  formatted: string | null;
}

export interface Geocoder {
  readonly name: 'none' | 'google' | 'mapbox';
  readonly enabled: boolean;
  geocode(query: string, opts?: { near?: LatLng | null; language?: 'ar' | 'en' }): Promise<GeocodeResult | null>;
}

export class GeocoderError extends Error {}

/** Egypt's bounding box (with a small margin) — anything outside is a wrong match. */
const EGYPT = { minLat: 21.7, maxLat: 31.8, minLng: 24.6, maxLng: 37.0 };
export const insideEgypt = (p: LatLng) => p.lat >= EGYPT.minLat && p.lat <= EGYPT.maxLat && p.lng >= EGYPT.minLng && p.lng <= EGYPT.maxLng;

const TIMEOUT_MS = 6_000;

export class NoGeocoder implements Geocoder {
  readonly name = 'none' as const;
  readonly enabled = false;
  async geocode(): Promise<GeocodeResult | null> {
    return null;
  }
}

const GOOGLE_PRECISION: Record<string, number> = { ROOFTOP: 0.95, RANGE_INTERPOLATED: 0.8, GEOMETRIC_CENTER: 0.6, APPROXIMATE: 0.4 };

export class GoogleGeocoder implements Geocoder {
  readonly name = 'google' as const;
  readonly enabled = true;
  constructor(private readonly apiKey: string) {}

  async geocode(query: string, opts: { near?: LatLng | null; language?: 'ar' | 'en' } = {}): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({ address: query, components: 'country:EG', region: 'eg', language: opts.language ?? 'ar', key: this.apiKey });
    if (opts.near) {
      // ±0.15° (~16 km) viewport around the zone centre biases the match without excluding others.
      const d = 0.15;
      params.set('bounds', `${opts.near.lat - d},${opts.near.lng - d}|${opts.near.lat + d},${opts.near.lng + d}`);
    }
    const res = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { timeoutMs: TIMEOUT_MS });
    if (!res.ok) throw new GeocoderError(`Google geocoding failed (${res.status}): ${snippet(res.text, 200)}`);
    const body = res.json as { status?: string; error_message?: string; results?: Array<{ formatted_address?: string; geometry?: { location?: { lat: number; lng: number }; location_type?: string }; partial_match?: boolean }> };
    if (body.status === 'ZERO_RESULTS') return null;
    if (body.status !== 'OK') throw new GeocoderError(`Google geocoding error ${body.status ?? 'UNKNOWN'}${body.error_message ? `: ${body.error_message}` : ''}`);
    const first = body.results?.[0];
    const loc = first?.geometry?.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || !insideEgypt(loc)) return null;
    let confidence = GOOGLE_PRECISION[first.geometry?.location_type ?? ''] ?? 0.4;
    if (first.partial_match) confidence = Math.max(0.2, confidence - 0.2);
    return { lat: loc.lat, lng: loc.lng, confidence, provider: 'google', formatted: first.formatted_address ?? null };
  }
}

export class MapboxGeocoder implements Geocoder {
  readonly name = 'mapbox' as const;
  readonly enabled = true;
  constructor(private readonly token: string) {}

  async geocode(query: string, opts: { near?: LatLng | null; language?: 'ar' | 'en' } = {}): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({ country: 'eg', limit: '1', language: opts.language === 'en' ? 'en,ar' : 'ar,en', access_token: this.token });
    if (opts.near) params.set('proximity', `${opts.near.lng},${opts.near.lat}`);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.slice(0, 250))}.json?${params}`;
    const res = await fetchWithTimeout(url, { timeoutMs: TIMEOUT_MS });
    if (!res.ok) throw new GeocoderError(`Mapbox geocoding failed (${res.status}): ${snippet(res.text, 200)}`);
    const body = res.json as { features?: Array<{ center?: [number, number]; relevance?: number; place_name?: string; place_type?: string[] }> };
    const f = body.features?.[0];
    if (!f?.center || f.center.length !== 2) return null;
    const point = { lat: f.center[1], lng: f.center[0] };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !insideEgypt(point)) return null;
    // Street / POI results are precise; neighbourhood / place results are approximate.
    const precise = (f.place_type ?? []).some((t) => t === 'address' || t === 'poi');
    const confidence = Math.max(0, Math.min(1, (f.relevance ?? 0.5) * (precise ? 1 : 0.6)));
    return { ...point, confidence, provider: 'mapbox', formatted: f.place_name ?? null };
  }
}

/** Picks the adapter from GEOCODER (+ its key). A provider without its key falls back to none. */
export function geocoderFromEnv(env: NodeJS.ProcessEnv = process.env): Geocoder {
  const kind = (env.GEOCODER ?? 'none').toLowerCase();
  if (kind === 'google' && env.GOOGLE_MAPS_API_KEY) return new GoogleGeocoder(env.GOOGLE_MAPS_API_KEY);
  if (kind === 'mapbox' && env.MAPBOX_TOKEN) return new MapboxGeocoder(env.MAPBOX_TOKEN);
  return new NoGeocoder();
}
