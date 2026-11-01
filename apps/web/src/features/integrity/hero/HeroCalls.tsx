import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navigation, Phone, PhoneCall, PhoneMissed, PhoneOff, Satellite, ShieldCheck, TriangleAlert } from 'lucide-react';
import { haversineKm, type FailureReason, type OrderStatus } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { num, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button } from '@/components/ui';
import { BigAction, Sheet } from '@/portals/hero/components/kit';
import { requestLocation, useGeo } from '@/portals/hero/lib/geo';
import { directionsLink, telLink } from '@/portals/hero/lib/util';
import type { HeroIntegrity } from '../types';
import '../i18n';

/** Statuses in which a call to the recipient is logged by the API. */
const CALLABLE: OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_OUT', 'PICKED_UP'];
const PENDING_KEY = 'gt.hero.pendingCall';

interface StopLike {
  id: string;
  status: OrderStatus;
  recipient: { phone: string };
  address: { line: string; lat: number | null; lng: number | null };
}

type CallResponse = { callLogId: string; dial: string; provider: string; masked: boolean };

const integrityKey = (orderId: string) => ['hero', 'integrity', orderId];

/**
 * Call the recipient: the call is logged first (masked proxy number when the
 * server has one), then the dialer opens. When the hero comes back to the app
 * a one-tap outcome prompt records how it went.
 */
export function HeroCallAction({ stop, variant = 'big' }: { stop: StopLike; variant?: 'big' | 'button' }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      const p = raw ? (JSON.parse(raw) as { id: string; orderId: string; at: number }) : null;
      return p && p.orderId === stop.id && Date.now() - p.at < 30 * 60_000 ? p.id : null;
    } catch {
      return null;
    }
  });
  const [ask, setAsk] = useState(false);
  const leftAt = useRef<number | null>(null);

  const remember = (id: string | null) => {
    setPending(id);
    try {
      if (id) sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id, orderId: stop.id, at: Date.now() }));
      else sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  // Back from the dialer → ask how the call went.
  useEffect(() => {
    if (!pending) return;
    const onVisible = () => {
      if (document.visibilityState === 'hidden') leftAt.current = Date.now();
      else if (leftAt.current) setAsk(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    // Desktop / dialer opened in-place: ask after a short delay even without a visibility change.
    const timer = window.setTimeout(() => setAsk(true), 8_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(timer);
    };
  }, [pending]);

  const start = useMutation({
    mutationFn: () => api<CallResponse>(`/hero/tasks/orders/${stop.id}/call`, { method: 'POST', body: {} }),
    onSuccess: (res) => {
      remember(res.callLogId);
      void qc.invalidateQueries({ queryKey: integrityKey(stop.id) });
      if (res.masked) toast.message(t('integrity.hero.masked'));
      window.location.href = res.dial;
    },
    onError: () => {
      // Never block a hero from calling: dial directly (the call is just not logged).
      const tel = telLink(stop.recipient.phone);
      if (tel) window.location.href = tel;
    },
  });
  const report = useMutation({
    mutationFn: (status: 'ANSWERED' | 'NO_ANSWER' | 'BUSY') => {
      const seconds = leftAt.current ? Math.round((Date.now() - leftAt.current) / 1000) : undefined;
      return api(`/hero/tasks/calls/${pending}/result`, { method: 'POST', body: { status, durationSeconds: status === 'ANSWERED' && seconds ? Math.min(seconds, 7200) : undefined } });
    },
    onSuccess: () => {
      toast.success(t('integrity.hero.logged'));
      remember(null);
      setAsk(false);
      leftAt.current = null;
      void qc.invalidateQueries({ queryKey: integrityKey(stop.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onCall = () => {
    if (!CALLABLE.includes(stop.status) || !navigator.onLine) {
      const tel = telLink(stop.recipient.phone);
      if (tel) window.location.href = tel;
      return;
    }
    start.mutate();
  };

  return (
    <>
      {variant === 'big' ? (
        <BigAction onClick={onCall} icon={<Phone />} label={start.isPending ? t('integrity.hero.calling') : t('integrity.hero.call')} tone="green" />
      ) : (
        <Button size="lg" variant="outline" className="border-turtle-300 text-turtle-700 dark:border-turtle-800 dark:text-turtle-300" icon={<PhoneCall className="h-5 w-5" />} loading={start.isPending} onClick={onCall}>
          {t('integrity.hero.callNow')}
        </Button>
      )}
      <Sheet open={ask && !!pending} onClose={() => { setAsk(false); remember(null); }} title={t('integrity.hero.outcomeTitle')}>
        <div className="grid grid-cols-3 gap-2 pb-2">
          {([
            ['ANSWERED', <PhoneCall key="a" />, 'bg-turtle-50 text-turtle-800 ring-turtle-200 dark:bg-turtle-950 dark:text-turtle-200 dark:ring-turtle-900'],
            ['NO_ANSWER', <PhoneMissed key="n" />, 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900'],
            ['BUSY', <PhoneOff key="b" />, 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900'],
          ] as const).map(([status, icon, tone]) => (
            <button
              key={status}
              type="button"
              disabled={report.isPending}
              onClick={() => report.mutate(status)}
              className={cn('flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl text-sm font-bold ring-1 transition active:scale-[.97] [&>svg]:h-7 [&>svg]:w-7', tone)}
            >
              {icon}
              {t(`integrity.hero.outcome.${status}`)}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

/**
 * Fail sheet rules: live GPS distance vs the geofence (with a "go to the
 * address" button when too far) and the calls the chosen reason requires.
 * Mirrors the server rules; API errors (TOO_FAR_FROM_DESTINATION, CALLS_REQUIRED) refresh it.
 */
export function FailIntegrityPanel({ stop, reason, error }: { stop: StopLike; reason: FailureReason | null; error?: unknown }) {
  const { t } = useI18n();
  const geo = useGeo();
  const q = useQuery({ queryKey: integrityKey(stop.id), queryFn: () => api<HeroIntegrity>(`/hero/tasks/orders/${stop.id}/integrity`), refetchInterval: 30_000 });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!geo.last || Date.now() - geo.last.at > 60_000) {
      setChecking(true);
      void requestLocation().finally(() => setChecking(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.id]);

  const apiCode = error instanceof ApiError ? error.code : null;
  useEffect(() => {
    if (apiCode === 'CALLS_REQUIRED' || apiCode === 'TOO_FAR_FROM_DESTINATION') void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const rules = q.data;
  const dest = rules?.destination ?? (stop.address.lat != null && stop.address.lng != null ? { lat: stop.address.lat, lng: stop.address.lng } : null);
  const distance = useMemo(() => (geo.last && dest ? Math.round(haversineKm(geo.last, dest) * 1000) : null), [geo.last, dest]);
  if (!rules) return null;

  const fence = rules.geofenceMeters;
  const serverDistance = apiCode === 'TOO_FAR_FROM_DESTINATION' ? ((error as ApiError).details as { distanceMeters?: number } | undefined)?.distanceMeters ?? null : null;
  const shown = serverDistance ?? distance;
  const far = fence > 0 && dest != null && shown != null && shown > fence;
  const unreachable = reason ? rules.unreachableReasons.includes(reason) : false;
  const required = reason ? (unreachable ? rules.calls.requiredForUnreachable : rules.calls.requiredForOther) : 0;
  const made = rules.calls.made;
  const nav = directionsLink(dest?.lat, dest?.lng, stop.address.line);
  const noFix = geo.permission === 'denied' || (!geo.last && !checking);

  return (
    <div className="space-y-2.5">
      {/* GPS / geofence */}
      {fence > 0 && (
        noFix ? (
          <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200 dark:bg-amber-950 dark:ring-amber-900">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100"><Satellite className="h-5 w-5" />{t('integrity.hero.geoOff')}</p>
            <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">{t('integrity.hero.geoOffHint')}</p>
            <Button size="sm" variant="outline" className="mt-2" loading={checking} onClick={() => { setChecking(true); void requestLocation().finally(() => setChecking(false)); }}>{t('integrity.hero.geoRetry')}</Button>
          </div>
        ) : !dest ? (
          <p className="rounded-2xl bg-ink-50 px-3 py-2 text-sm text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">{t('integrity.hero.noPinInfo')}</p>
        ) : shown == null ? (
          <p className="rounded-2xl bg-ink-50 px-3 py-2 text-sm text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">{t('integrity.hero.geoChecking')}</p>
        ) : far ? (
          <div className="rounded-2xl bg-red-50 p-3 ring-1 ring-red-200 dark:bg-red-950 dark:ring-red-900" role="alert">
            <p className="flex items-center gap-2 text-sm font-bold text-red-800 dark:text-red-200"><TriangleAlert className="h-5 w-5" /><span>{t('integrity.hero.geoFar', { m: num(shown) })}</span></p>
            <p className="mt-1 text-sm text-red-800/90 dark:text-red-200/90">{t('integrity.hero.geoFarHint', { allowed: num(fence) })}</p>
            {nav && (
              <a href={nav} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white">
                <Navigation className="h-4 w-4" />{t('integrity.hero.goToAddress')}
              </a>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-2xl bg-turtle-50 px-3 py-2 text-sm font-semibold text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200"><ShieldCheck className="h-4 w-4" />{t('integrity.hero.geoOk', { m: num(shown) })}</p>
        )
      )}

      {/* Calls */}
      {reason && required > 0 && (
        made >= required ? (
          <p className="flex items-center gap-2 rounded-2xl bg-turtle-50 px-3 py-2 text-sm font-semibold text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200"><PhoneCall className="h-4 w-4" />{t('integrity.hero.callsOk', { made, required })}</p>
        ) : (
          <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200 dark:bg-amber-950 dark:ring-amber-900">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-amber-900 dark:text-amber-100"><span className="ltr">{t('integrity.hero.callsNeeded', { made, required })}</span></p>
              <div className="flex gap-1" aria-hidden>
                {Array.from({ length: required }, (_, i) => <span key={i} className={cn('h-2.5 w-6 rounded-full', i < made ? 'bg-turtle-500' : 'bg-amber-200 dark:bg-amber-800')} />)}
              </div>
            </div>
            <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
              {dest ? t('integrity.hero.callsHint', { required, spacing: rules.calls.spacingMinutes }) : t('integrity.hero.noPinInfo')}
            </p>
            {rules.calls.nextCountedAt && <p className="mt-1 text-xs font-semibold text-amber-800 dark:text-amber-300">{t('integrity.hero.nextCall', { t: timeOnly(rules.calls.nextCountedAt) })}</p>}
            <div className="mt-2"><HeroCallAction stop={stop} variant="button" /></div>
          </div>
        )
      )}
      {reason && reason !== 'PACKAGE_DAMAGED' && <p className="text-xs text-ink-500">{t('integrity.hero.verifyNote')}</p>}
    </div>
  );
}
