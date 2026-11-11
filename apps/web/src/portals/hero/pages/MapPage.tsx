import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock, MapPinOff, Navigation, Store } from 'lucide-react';
import { LiveMap, type MapPoint } from '@/components/ui/Map';
import { timeOnly } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Badge, EmptyState, ErrorState, Skeleton, StatusBadge } from '@/components/ui';
import { Money, RefreshButton, Sheet } from '../components/kit';
import { stopTone } from '../components/rows';
import { useProfile, useToday } from '../lib/queries';
import { useGeo } from '../lib/geo';
import { routeStops, nextStop } from '../lib/agenda';
import { coordsFromMapsUrl, directionsLink } from '../lib/util';
import type { Pickup, TodayStop } from '../types';

type Selected = { kind: 'stop'; stop: TodayStop } | { kind: 'pickup'; pickup: Pickup };

export default function MapPage() {
  const { t } = useI18n();
  const today = useToday();
  const profile = useProfile();
  const geo = useGeo();
  const [selected, setSelected] = useState<Selected | null>(null);

  const stops = useMemo(() => routeStops(today.data), [today.data]);
  const located = useMemo(() => stops.map((s) => ({ s, at: coordsFromMapsUrl(s.mapsUrl) })).filter((x): x is { s: TodayStop & { runsheetId: string }; at: [number, number] } => !!x.at), [stops]);
  const me: [number, number] | null = geo.last ? [geo.last.lat, geo.last.lng] : profile.data?.lastLat != null && profile.data?.lastLng != null ? [profile.data.lastLat, profile.data.lastLng] : null;
  const hub = profile.data?.homeHub?.lat != null && profile.data.homeHub.lng != null ? ([profile.data.homeHub.lat, profile.data.homeHub.lng] as [number, number]) : null;

  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = located.map(({ s, at }) => {
      const tone = stopTone(s.status, s.isOpen);
      return {
        id: s.orderId,
        lat: at[0],
        lng: at[1],
        kind: tone === 'open' ? 'order' : tone === 'done' ? 'done' : tone === 'failed' ? 'order-urgent' : 'hero-offline',
        label: s.seq ?? undefined,
        title: s.recipientName,
        onClick: () => setSelected({ kind: 'stop', stop: s }),
      };
    });
    for (const p of today.data?.pickups ?? []) {
      if (p.location?.lat == null || p.location.lng == null) continue;
      pts.push({ id: `pu-${p.id}`, lat: p.location.lat, lng: p.location.lng, kind: 'pickup', title: p.brand.name, onClick: () => setSelected({ kind: 'pickup', pickup: p }) });
    }
    if (hub) pts.push({ id: 'hub', lat: hub[0], lng: hub[1], kind: 'hub', title: profile.data?.homeHub?.name });
    if (me) pts.push({ id: 'me', lat: me[0], lng: me[1], kind: 'hero', title: t('hero.map.you') });
    return pts;
  }, [located, today.data, hub, me, profile.data, t]);

  const route = useMemo(() => {
    const open = located.filter(({ s }) => s.isOpen).map(({ at }) => at);
    const start = me ?? hub;
    return start ? [start, ...open] : open;
  }, [located, me, hub]);

  if (!today.data && today.isError) return <ErrorState error={today.error} onRetry={() => today.refetch()} />;
  if (!today.data) return <Skeleton className="h-[60vh] rounded-2xl" />;

  const next = nextStop(today.data);
  const open = stops.filter((s) => s.isOpen).length;
  const doneCount = stops.length - open;
  const unlocated = stops.length - located.length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900 dark:text-white">{t('hero.map.title')}</h1>
          <p className="text-xs text-ink-500">{t('hero.map.summary', { open, done: doneCount })}</p>
        </div>
        <RefreshButton spinning={today.isFetching} onClick={() => void today.refetch()} />
      </div>

      {points.length === 0 ? (
        <EmptyState icon={<MapPinOff className="h-7 w-7" />} title={t('hero.map.empty')} description={t('hero.map.emptyHint')} />
      ) : (
        <div className="relative isolate z-0">
          {/* Remount once when my first GPS fix arrives so the initial fit includes me. */}
          <LiveMap key={me ? 'me' : 'no-me'} points={points} route={route} height="calc(100dvh - 360px)" className="min-h-[300px] shadow-card" />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 px-1 text-xs font-semibold text-ink-600 dark:text-ink-300">
        <Legend color="#6d28d9" label={t('hero.map.pending')} />
        <Legend color="#74C465" label={t('hero.map.done')} />
        <Legend color="#dc2626" label={t('hero.map.failed')} />
        <Legend color="#0284c7" label={t('hero.map.pickup')} />
        <Legend color="#00804C" label={t('hero.map.you')} ring />
      </div>
      {unlocated > 0 && <p className="mt-2 px-1 text-xs text-ink-500">{t('hero.map.unlocated', { n: unlocated })}</p>}

      {next && (
        <Link to={`/hero/stops/${next.orderId}`} className="mt-3 flex items-center gap-3 rounded-2xl bg-violet-600 p-3 text-white shadow-card active:scale-[.99]">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white font-display text-xl font-extrabold text-violet-700">{next.seq ?? '·'}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/75">{t('hero.today.nextStop')}</p>
            <p className="truncate font-bold">{next.recipientName}</p>
          </div>
          {next.collectCents > 0 && <Money cents={next.collectCents} className="font-display text-lg font-extrabold text-sand-200" />}
          <ArrowUpRight className="h-5 w-5 shrink-0 rtl:-scale-x-100" />
        </Link>
      )}

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected?.kind === 'stop' ? selected.stop.recipientName : selected?.kind === 'pickup' ? selected.pickup.brand.name : ''}>
        {selected?.kind === 'stop' && <StopPreview stop={selected.stop} />}
        {selected?.kind === 'pickup' && <PickupPreview pickup={selected.pickup} />}
      </Sheet>
    </div>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-full" style={{ background: color, boxShadow: ring ? `0 0 0 3px ${color}40` : undefined }} />
      {label}
    </span>
  );
}

function StopPreview({ stop }: { stop: TodayStop }) {
  const { t, pick } = useI18n();
  const at = coordsFromMapsUrl(stop.mapsUrl);
  const nav = stop.mapsUrl ?? directionsLink(at?.[0], at?.[1], stop.address);
  return (
    <div className="space-y-3 pb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="ltr rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">#{stop.seq}</span>
        <StatusBadge status={stop.status} />
        <Badge tone="neutral">{pick(stop.zone, 'name')}</Badge>
        {stop.eta && stop.isOpen && <Badge tone="info"><Clock className="h-3 w-3" /> <span className="ltr">{timeOnly(stop.eta)}</span></Badge>}
      </div>
      <p className="text-sm text-ink-700 dark:text-ink-200">{stop.address}</p>
      {stop.landmark && <p className="text-sm text-ink-500">📍 {stop.landmark}</p>}
      <div className="flex items-center justify-between rounded-2xl bg-sand-50 p-3 dark:bg-ink-800">
        <span className="text-sm font-semibold text-ink-600 dark:text-ink-300">{stop.collectCents > 0 ? t('hero.collect') : t('hero.prepaid')}</span>
        {stop.collectCents > 0 && <Money cents={stop.collectCents} className="font-display text-2xl font-extrabold text-sand-700 dark:text-sand-300" />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a href={nav} target="_blank" rel="noopener noreferrer" className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-sky-600 font-bold text-white">
          <Navigation className="h-5 w-5" /> {t('action.navigate')}
        </a>
        <Link to={`/hero/stops/${stop.orderId}`} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-turtle-600 font-bold text-white">
          {t('hero.map.openStop')}
        </Link>
      </div>
    </div>
  );
}

function PickupPreview({ pickup }: { pickup: Pickup }) {
  const { t } = useI18n();
  const nav = directionsLink(pickup.location?.lat, pickup.location?.lng, pickup.location?.addressLine);
  return (
    <div className="space-y-3 pb-2">
      <p className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200"><Store className="h-4 w-4" /> {pickup.location?.name} — {pickup.location?.addressLine}</p>
      {pickup.timeWindow && <Badge tone="info"><Clock className="h-3 w-3" /> <span className="ltr">{pickup.timeWindow}</span></Badge>}
      <div className="grid grid-cols-2 gap-2">
        <a href={nav} target="_blank" rel="noopener noreferrer" className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-sky-600 font-bold text-white">
          <Navigation className="h-5 w-5" /> {t('action.navigate')}
        </a>
        <Link to={`/hero/pickups/${pickup.id}`} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-turtle-600 font-bold text-white">
          {t('hero.map.openPickup')}
        </Link>
      </div>
    </div>
  );
}
