import type { LatLng } from '@goturtle/shared';

/**
 * Travel-time / distance matrix between points: `km[i][j]` and `minutes[i][j]`
 * for driving from point i to point j (road distance, not crow-flies).
 * Matrices may be asymmetric (one-way streets, traffic).
 */
export interface TravelMatrix {
  km: number[][];
  minutes: number[][];
}

export interface MatrixOptions {
  /** couriers.vehicleType — used by estimators (haversine speed table). */
  vehicle?: string;
}

export interface RoutingProvider {
  readonly name: 'haversine' | 'osrm' | 'google';
  matrix(points: LatLng[], opts?: MatrixOptions): Promise<TravelMatrix>;
}

export type FetchFn = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export class RoutingProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

/** One fetch with a hard timeout; HTTP errors become RoutingProviderError. */
export async function fetchJson(fetchFn: FetchFn, provider: string, url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs: number }): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetchFn(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body, signal: controller.signal });
    if (!res.ok) throw new RoutingProviderError(provider, `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return await res.json();
  } catch (err) {
    if (controller.signal.aborted) throw new RoutingProviderError(provider, `timed out after ${init.timeoutMs} ms`);
    throw err instanceof RoutingProviderError ? err : new RoutingProviderError(provider, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** Splits 0..n-1 into consecutive blocks of at most `size` indices. */
export function blocks(n: number, size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i += size) out.push(Array.from({ length: Math.min(size, n - i) }, (_, k) => i + k));
  return out;
}

/** Runs async tasks with bounded concurrency. */
export async function runLimited<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

export const emptyMatrix = (n: number): TravelMatrix => ({
  km: Array.from({ length: n }, () => new Array<number>(n).fill(0)),
  minutes: Array.from({ length: n }, () => new Array<number>(n).fill(0)),
});
