import { useEffect, useSyncExternalStore } from 'react';
import { haversineKm } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';

/**
 * Hero GPS: one shared store (permission, last fix, queue) and a tracker that
 * batches fixes to POST /hero/me/location.
 *  - a point is kept every ≥10 s or ≥50 m; the batch is flushed every ~20 s or at once after ≥50 m;
 *  - the queue survives reloads/offline (localStorage, capped) and is flushed when back online;
 *  - watching stops after the tab has been hidden for 2 minutes and resumes when visible.
 */

export type GeoPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';
export interface Fix { lat: number; lng: number; accuracy: number | null; at: number }

interface QueuedPoint { lat: number; lng: number; accuracy?: number; speed?: number; heading?: number; battery?: number; recordedAt: string }

interface GeoState {
  permission: GeoPermission;
  tracking: boolean;
  paused: boolean;
  last: Fix | null;
  queued: number;
  lastSentAt: number | null;
}

const QUEUE_KEY = 'gt.hero.locq';
const QUEUE_CAP = 300;
const FLUSH_MS = 20_000;
const MIN_POINT_MS = 10_000;
const MOVE_M = 50;
const HIDDEN_PAUSE_MS = 120_000;

const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

let state: GeoState = { permission: supported ? 'unknown' : 'unsupported', tracking: false, paused: false, last: null, queued: loadQueue().length, lastSentAt: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<GeoState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useGeo(): GeoState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

function loadQueue(): QueuedPoint[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedPoint[];
  } catch {
    return [];
  }
}
function saveQueue(q: QueuedPoint[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_CAP)));
  } catch {
    /* ignore */
  }
  set({ queued: Math.min(q.length, QUEUE_CAP) });
}

// Permission state (Chrome/Firefox/Safari 16+). Without the Permissions API we learn it from the first fix/error.
if (supported && navigator.permissions?.query) {
  navigator.permissions
    .query({ name: 'geolocation' as PermissionName })
    .then((st) => {
      set({ permission: st.state as GeoPermission });
      st.onchange = () => set({ permission: st.state as GeoPermission });
    })
    .catch(() => undefined);
}

let battery: number | undefined;
type BatteryLike = { level: number; addEventListener: (e: string, f: () => void) => void };
(navigator as unknown as { getBattery?: () => Promise<BatteryLike> }).getBattery?.()
  .then((b) => {
    battery = Math.round(b.level * 100);
    b.addEventListener('levelchange', () => (battery = Math.round(b.level * 100)));
  })
  .catch(() => undefined);

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineKm(a, b) * 1000;

let lastKept: QueuedPoint | null = null;
let lastFlushedPos: { lat: number; lng: number } | null = null;
let flushing = false;

function onFix(pos: GeolocationPosition) {
  const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
  set({ last: { lat, lng, accuracy: accuracy ?? null, at: pos.timestamp || Date.now() }, permission: 'granted' });
  const now = Date.now();
  const moved = lastKept ? metres(lastKept, { lat, lng }) : Infinity;
  if (lastKept && now - new Date(lastKept.recordedAt).getTime() < MIN_POINT_MS && moved < MOVE_M) return;
  const point: QueuedPoint = {
    lat: round(lat, 6),
    lng: round(lng, 6),
    accuracy: accuracy != null ? Math.min(100_000, round(accuracy, 1)) : undefined,
    speed: speed != null && Number.isFinite(speed) && speed >= 0 ? Math.min(100, round(speed, 2)) : undefined,
    heading: heading != null && Number.isFinite(heading) && heading >= 0 ? Math.min(360, round(heading, 1)) : undefined,
    battery,
    recordedAt: new Date(pos.timestamp || now).toISOString(),
  };
  lastKept = point;
  saveQueue([...loadQueue(), point]);
  if (!lastFlushedPos || metres(lastFlushedPos, point) >= MOVE_M) void flush();
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Sends queued points (20 per request) — keeps them on network errors, drops rejected ones. */
export async function flush() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    let q = loadQueue();
    while (q.length) {
      const batch = q.slice(0, 20);
      try {
        await api('/hero/me/location', { method: 'POST', body: { points: batch } });
        const last = batch[batch.length - 1];
        lastFlushedPos = { lat: last.lat, lng: last.lng };
        set({ lastSentAt: Date.now() });
      } catch (err) {
        // 4xx = the server will never accept these points (validation, not a hero any more): drop them.
        if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500 || err.status === 401 || err.status === 429) break;
      }
      q = loadQueue().slice(batch.length);
      saveQueue(q);
    }
  } finally {
    flushing = false;
  }
}

let watchId: number | null = null;
function startWatch() {
  if (!supported || watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onFix, (err) => {
    if (err.code === err.PERMISSION_DENIED) {
      set({ permission: 'denied' });
      stopWatch();
    }
  }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
  set({ tracking: true, paused: false });
}
function stopWatch(paused = false) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  set({ tracking: false, paused });
}

/** Runs the tracker while `active` (hero ONLINE/BUSY). Mounted once, in the hero header. */
export function useLocationTracker(active: boolean) {
  useEffect(() => {
    if (!active || !supported) {
      stopWatch();
      return;
    }
    if (state.permission !== 'denied') startWatch();
    void flush();
    const timer = window.setInterval(() => void flush(), FLUSH_MS);
    let hiddenTimer: number | undefined;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenTimer = window.setTimeout(() => stopWatch(true), HIDDEN_PAUSE_MS);
      } else {
        window.clearTimeout(hiddenTimer);
        if (state.permission !== 'denied') startWatch();
        void flush();
      }
    };
    const onOnline = () => void flush();
    // Permission granted later (prompt answered or changed in the browser settings) → start watching.
    const onStore = () => {
      if (watchId === null && !state.paused && (state.permission === 'granted' || state.permission === 'prompt') && !document.hidden) startWatch();
    };
    listeners.add(onStore);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(hiddenTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      listeners.delete(onStore);
      stopWatch();
    };
  }, [active]);
}

/** Asks the browser for permission (user gesture) — resolves with the fix or null. */
export function requestLocation(): Promise<Fix | null> {
  if (!supported) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onFix(pos);
        resolve(state.last);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) set({ permission: 'denied' });
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}

/** Best-effort current position for an action (fresh fix ≤ 60 s or a quick one-shot), never throws. */
export async function currentPosition(timeoutMs = 5_000): Promise<{ lat: number; lng: number } | null> {
  const last = state.last;
  if (last && Date.now() - last.at < 60_000) return { lat: last.lat, lng: last.lng };
  if (!supported || state.permission === 'denied') return last ? { lat: last.lat, lng: last.lng } : null;
  return new Promise((resolve) => {
    const done = (v: { lat: number; lng: number } | null) => resolve(v);
    const t = window.setTimeout(() => done(last ? { lat: last.lat, lng: last.lng } : null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(t);
        onFix(pos);
        done({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        window.clearTimeout(t);
        if (err.code === err.PERMISSION_DENIED) set({ permission: 'denied' });
        done(last ? { lat: last.lat, lng: last.lng } : null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/** Forget queued points (sign-out: never post them under another hero). */
export function clearLocationQueue() {
  lastKept = null;
  lastFlushedPos = null;
  saveQueue([]);
}

export const geoSupported = supported;
export { metres as distanceMetres };
