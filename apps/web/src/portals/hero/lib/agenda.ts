import type { Today, TodayStop } from '../types';

/** Stops of today's active runsheets in route order. */
export function routeStops(today: Today | undefined): Array<TodayStop & { runsheetId: string }> {
  if (!today) return [];
  return today.runsheets.flatMap((rs) => [...rs.stops].sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999)).map((s) => ({ ...s, runsheetId: rs.id })));
}

/** The next open stop (route order), optionally skipping one (the stop just finished). */
export function nextStop(today: Today | undefined, skip?: string) {
  const stops = routeStops(today).filter((s) => s.isOpen && s.orderId !== skip);
  return stops.find((s) => s.status === 'OUT_FOR_DELIVERY') ?? stops[0] ?? null;
}

/** Done/total of the day (stops + pickups). */
export function dayProgress(today: Today | undefined) {
  if (!today) return { done: 0, total: 0 };
  const stops = routeStops(today);
  const pickupsDone = today.pickups.filter((p) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(p.status)).length;
  return { done: stops.filter((s) => !s.isOpen).length + pickupsDone, total: stops.length + today.pickups.length };
}
