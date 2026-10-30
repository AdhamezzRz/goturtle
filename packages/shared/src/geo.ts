export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cairo streets are not straight lines: road distance ≈ 1.35 × crow-flies. */
export const CAIRO_ROAD_FACTOR = 1.35;

export const AVERAGE_SPEED_KMH: Record<string, number> = {
  MOTORCYCLE: 22,
  SCOOTER: 20,
  BICYCLE: 12,
  CAR: 16,
  VAN: 14,
  ON_FOOT: 4.5,
};

/** Minutes spent at each stop (parking, calling the customer, handing over, collecting cash). */
export const SERVICE_MINUTES_PER_STOP = 7;

export function travelMinutes(km: number, vehicle = 'MOTORCYCLE'): number {
  const speed = AVERAGE_SPEED_KMH[vehicle] ?? AVERAGE_SPEED_KMH.MOTORCYCLE;
  return (km * CAIRO_ROAD_FACTOR * 60) / speed;
}

export interface RouteStop<T = unknown> extends LatLng {
  id: string;
  data?: T;
}

export interface PlannedStop<T = unknown> {
  id: string;
  seq: number;
  lat: number;
  lng: number;
  legKm: number;
  etaMinutes: number;
  data?: T;
}

export interface RoutePlan<T = unknown> {
  stops: PlannedStop<T>[];
  totalKm: number;
  totalMinutes: number;
}

function tourLength(start: LatLng, path: LatLng[], returnToStart: boolean): number {
  let d = 0;
  let prev = start;
  for (const p of path) {
    d += haversineKm(prev, p);
    prev = p;
  }
  if (returnToStart && path.length) d += haversineKm(prev, start);
  return d;
}

/**
 * Route optimisation: nearest-neighbour construction followed by 2-opt
 * improvement. O(n²) per pass — instant for a hero's daily 10–60 stops.
 * Swap in an external VRP solver (OSRM, Google Route Optimization) behind the
 * same signature when multi-vehicle optimisation is needed.
 */
export function optimizeRoute<T>(
  start: LatLng,
  stops: RouteStop<T>[],
  opts: { returnToStart?: boolean; vehicle?: string; maxPasses?: number } = {},
): RoutePlan<T> {
  const returnToStart = opts.returnToStart ?? false;
  if (stops.length === 0) return { stops: [], totalKm: 0, totalMinutes: 0 };

  // 1. nearest neighbour
  const remaining = [...stops];
  const tour: RouteStop<T>[] = [];
  let current: LatLng = start;
  while (remaining.length) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i]);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    tour.push(next);
    current = next;
  }

  // 2. 2-opt
  const maxPasses = opts.maxPasses ?? 50;
  let improved = true;
  let passes = 0;
  let best = tourLength(start, tour, returnToStart);
  while (improved && passes < maxPasses) {
    improved = false;
    passes++;
    for (let i = 0; i < tour.length - 1; i++) {
      for (let k = i + 1; k < tour.length; k++) {
        const candidate = [...tour.slice(0, i), ...tour.slice(i, k + 1).reverse(), ...tour.slice(k + 1)];
        const len = tourLength(start, candidate, returnToStart);
        if (len + 1e-9 < best) {
          tour.splice(0, tour.length, ...candidate);
          best = len;
          improved = true;
        }
      }
    }
  }

  // 3. legs & ETAs
  let prev: LatLng = start;
  let elapsed = 0;
  let totalKm = 0;
  const planned = tour.map((s, idx) => {
    const legKm = haversineKm(prev, s);
    totalKm += legKm;
    elapsed += travelMinutes(legKm, opts.vehicle);
    const eta = Math.round(elapsed);
    elapsed += SERVICE_MINUTES_PER_STOP;
    prev = s;
    return { id: s.id, seq: idx + 1, lat: s.lat, lng: s.lng, legKm: round2(legKm * CAIRO_ROAD_FACTOR), etaMinutes: eta, data: s.data };
  });
  if (returnToStart) totalKm += haversineKm(prev, start);

  return { stops: planned, totalKm: round2(totalKm * CAIRO_ROAD_FACTOR), totalMinutes: Math.round(elapsed) };
}

/** Ray casting point-in-polygon for a GeoJSON Polygon's outer ring ([lng, lat] pairs). */
export function pointInPolygon(point: LatLng, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
