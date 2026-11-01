import { SERVICE_MINUTES_PER_STOP, type LatLng } from '@goturtle/shared';
import type { TravelMatrix } from './routing.types';

export interface MatrixStop extends LatLng {
  id: string;
}

export interface MatrixPlannedStop {
  id: string;
  seq: number;
  lat: number;
  lng: number;
  /** Road km of the leg that arrives at this stop. */
  legKm: number;
  /** Minutes after leaving the start until arrival (service time of earlier stops included). */
  etaMinutes: number;
}

export interface MatrixPlan {
  stops: MatrixPlannedStop[];
  totalKm: number;
  totalMinutes: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Travel minutes of start → path (indices into the matrix; the start is index 0). */
function cost(m: TravelMatrix, path: number[]): number {
  let c = 0;
  let prev = 0;
  for (const p of path) {
    c += m.minutes[prev][p];
    prev = p;
  }
  return c;
}

/**
 * Nearest neighbour + 2-opt over a travel-time matrix (index 0 = start,
 * 1..n = stops). Costs are minutes, so one-way streets and traffic count;
 * the tour is open (heroes do not need to come back to the hub).
 */
export function optimizeWithMatrix(stops: MatrixStop[], m: TravelMatrix, opts: { maxPasses?: number } = {}): MatrixPlan {
  if (!stops.length) return { stops: [], totalKm: 0, totalMinutes: 0 };
  // 1. nearest neighbour
  const remaining = new Set(stops.map((_, i) => i + 1));
  const tour: number[] = [];
  let current = 0;
  while (remaining.size) {
    let best = -1;
    let bestCost = Infinity;
    for (const j of remaining) {
      const c = m.minutes[current][j];
      if (c < bestCost || (c === bestCost && j < best)) {
        bestCost = c;
        best = j;
      }
    }
    tour.push(best);
    remaining.delete(best);
    current = best;
  }

  // 2. 2-opt (segment reversal; full re-cost because the matrix may be asymmetric)
  const maxPasses = opts.maxPasses ?? 50;
  let bestCost = cost(m, tour);
  let improved = true;
  for (let pass = 0; improved && pass < maxPasses; pass++) {
    improved = false;
    for (let i = 0; i < tour.length - 1; i++) {
      for (let k = i + 1; k < tour.length; k++) {
        const candidate = [...tour.slice(0, i), ...tour.slice(i, k + 1).reverse(), ...tour.slice(k + 1)];
        const c = cost(m, candidate);
        if (c + 1e-9 < bestCost) {
          tour.splice(0, tour.length, ...candidate);
          bestCost = c;
          improved = true;
        }
      }
    }
  }

  // 3. legs & ETAs
  let prev = 0;
  let elapsed = 0;
  let totalKm = 0;
  const planned = tour.map((idx, seq) => {
    const s = stops[idx - 1];
    const legKm = m.km[prev][idx];
    totalKm += legKm;
    elapsed += m.minutes[prev][idx];
    const eta = Math.round(elapsed);
    elapsed += SERVICE_MINUTES_PER_STOP;
    prev = idx;
    return { id: s.id, seq: seq + 1, lat: s.lat, lng: s.lng, legKm: round2(legKm), etaMinutes: eta };
  });
  return { stops: planned, totalKm: round2(totalKm), totalMinutes: Math.round(elapsed) };
}
