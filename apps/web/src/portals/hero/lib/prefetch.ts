/**
 * Warms the hero screens' code once the app is idle, so they open offline / on weak 4G
 * (the service worker caches the fetched chunks). The Leaflet map is not prefetched.
 */
let done = false;
export function prefetchHeroScreens() {
  if (done || typeof window === 'undefined') return;
  done = true;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return;
  const run = () => {
    if (!navigator.onLine) return;
    void Promise.allSettled([
      import('../pages/TodayPage'),
      import('../pages/StopPage'),
      import('../pages/PickupPage'),
      import('../pages/WalletPage'),
      import('../pages/ShiftsPage'),
      import('../pages/EarningsPage'),
      import('../pages/MePage'),
      import('../pages/AchievementsPage'),
    ]);
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  window.setTimeout(() => (ric ? ric(run, { timeout: 5000 }) : run()), 3000);
}
