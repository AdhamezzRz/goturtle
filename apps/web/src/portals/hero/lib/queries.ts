import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, sessionStore, type RequestOptions } from '@/lib/api';
import { usePollInterval } from '@/lib/hooks';
import { toast } from 'sonner';
import { errorMessage } from '@/i18n';
import type {
  Achievements, Dashboard, Earnings, Handover, HeroDocument, Leaderboard, Paged, Payout, PickupDetail, Profile, RunsheetDetail, ShiftList, StopDetail, Today, Wallet,
} from '../types';

/**
 * Hero data layer.
 * - Every query key starts with 'hero'.
 * - The screens a hero needs on the road (today, stops, wallet, profile…) are persisted
 *   to localStorage per signed-in session, so the app opens with the last known data on
 *   weak 4G or offline; React Query refetches in the background as soon as it can.
 */

const PREFIX = 'gt.hero.cache:';
const MAX_AGE_MS = 36 * 3_600_000;

function owner(): string {
  // The refresh token rotates, the user id is in the JWT payload (sub).
  const token = sessionStore.user()?.accessToken;
  if (!token) return 'anon';
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? 'anon';
  } catch {
    return 'anon';
  }
}

const storageKey = (key: QueryKey) => `${PREFIX}${owner()}:${JSON.stringify(key)}`;

function readCache<T>(key: QueryKey): { data: T; at: number } | undefined {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return undefined;
    const hit = JSON.parse(raw) as { data: T; at: number };
    if (Date.now() - hit.at > MAX_AGE_MS) return undefined;
    return hit;
  } catch {
    return undefined;
  }
}

function writeCache(key: QueryKey, data: unknown) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify({ data, at: Date.now() }));
  } catch {
    /* quota — ignore, cache is best effort */
  }
}

/** Removes every persisted hero screen (sign-out). */
export function clearHeroCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

interface HeroQueryOptions {
  query?: RequestOptions['query'];
  /** Poll interval in ms (paused while the tab is hidden). */
  poll?: number;
  /** Persist for offline use (default true). */
  persist?: boolean;
  enabled?: boolean;
  staleTime?: number;
}

export function useHeroQuery<T>(key: QueryKey, path: string, opts: HeroQueryOptions = {}) {
  const persist = opts.persist ?? true;
  const interval = usePollInterval(opts.poll ?? 0);
  const fullKey = ['hero', ...key];
  const id = JSON.stringify(fullKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cached = useMemo(() => (persist ? readCache<T>(fullKey) : undefined), [id, persist]);
  return useQuery<T>({
    queryKey: fullKey,
    queryFn: async ({ signal }) => {
      const data = await api<T>(path, { query: opts.query, signal });
      if (persist) writeCache(fullKey, data);
      return data;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    refetchInterval: opts.poll ? interval : false,
    enabled: opts.enabled ?? true,
    staleTime: opts.staleTime,
  });
}

// ---------------------------------------------------------------- queries

export const useToday = () => useHeroQuery<Today>(['today'], '/hero/tasks/today', { poll: 30_000 });
export const useDashboard = () => useHeroQuery<Dashboard>(['dashboard'], '/hero/me/dashboard', { poll: 60_000 });
export const useProfile = () => useHeroQuery<Profile>(['profile'], '/hero/me', { staleTime: 60_000 });
export const useStop = (id: string | undefined) => useHeroQuery<StopDetail>(['stop', id], `/hero/tasks/orders/${id}`, { enabled: !!id, poll: 60_000 });
export const usePickup = (id: string | undefined) => useHeroQuery<PickupDetail>(['pickup', id], `/hero/tasks/pickups/${id}`, { enabled: !!id });
export const useRunsheet = (id: string | undefined) => useHeroQuery<RunsheetDetail>(['runsheet', id], `/hero/tasks/runsheets/${id}`, { enabled: !!id, poll: 60_000 });
export const useWallet = () => useHeroQuery<Wallet>(['wallet'], '/hero/me/wallet', { poll: 60_000 });
export const useHandovers = () => useHeroQuery<Paged<Handover>>(['handovers'], '/hero/me/handovers', { query: { pageSize: 20 } });
export const usePayouts = () => useHeroQuery<Paged<Payout>>(['payouts'], '/hero/me/payouts', { query: { pageSize: 12 } });
export const useShifts = (from: string, to: string) => useHeroQuery<ShiftList>(['shifts', from, to], '/hero/me/shifts', { query: { from, to }, poll: 60_000 });
export const useAchievements = () => useHeroQuery<Achievements>(['achievements'], '/hero/me/achievements');
export const useLeaderboard = (period: 'day' | 'week' | 'month') => useHeroQuery<Leaderboard>(['leaderboard', period], '/hero/me/leaderboard', { query: { period } });
export const useDocuments = () => useHeroQuery<HeroDocument[]>(['documents'], '/hero/me/documents');

/** Earnings totals for a range (page 1 only) — used for the period cards. */
export const useEarningsTotals = (from: string, to: string) =>
  useHeroQuery<Earnings>(['earnings', from, to], '/hero/me/earnings', { query: { from, to, pageSize: 1 } });

/** Ledger statement with "load more". */
export function useLedger(from: string, to: string) {
  return useInfiniteQuery({
    queryKey: ['hero', 'ledger', from, to],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => api<Earnings>('/hero/me/earnings', { query: { from, to, page: pageParam, pageSize: 20 }, signal }),
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
}

/** Fetches the agenda now (after an action) and updates the cache — used to pick the next stop. */
export async function fetchToday(qc: ReturnType<typeof useQueryClient>): Promise<Today | undefined> {
  try {
    const data = await api<Today>('/hero/tasks/today');
    qc.setQueryData(['hero', 'today'], data);
    writeCache(['hero', 'today'], data);
    return data;
  } catch {
    return qc.getQueryData<Today>(['hero', 'today']);
  }
}

// ---------------------------------------------------------------- mutations

/** Everything that changes after a hero action (agenda, header, wallet, profile…). */
export function useInvalidateHero() {
  const qc = useQueryClient();
  return (...extra: QueryKey[]) => {
    for (const k of [['hero', 'today'], ['hero', 'dashboard'], ['hero', 'wallet'], ['hero', 'profile'], ['hero', 'runsheet'], ...extra]) void qc.invalidateQueries({ queryKey: k });
  };
}

/**
 * A hero mutation: never waits silently for the network (networkMode 'always' →
 * fails fast with a NETWORK error) and toasts API errors by default.
 */
export function useHeroMutation<TBody, TRes>(fn: (body: TBody) => Promise<TRes>, opts: { onSuccess?: (res: TRes, body: TBody) => void; silentError?: boolean } = {}) {
  return useMutation<TRes, unknown, TBody>({
    mutationFn: fn,
    networkMode: 'always',
    onSuccess: opts.onSuccess,
    onError: (err) => {
      if (!opts.silentError) toast.error(errorMessage(err));
    },
  });
}

export { api };
