import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, Bike, ChevronRight, Crosshair, MapPin, Package, Radio, Truck, Wallet } from 'lucide-react';
import type { OrderStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePollInterval, useQueryState } from '@/lib/hooks';
import { ago, money, num, pct, phone as fmtPhone, timeOnly } from '@/lib/format';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Drawer, EmptyState, ErrorState, ProgressBar, Select, Skeleton, StatusBadge } from '@/components/ui';
import { CallButton, LinkButton, Mono, NoAccess, Segmented, SearchInput, useNow } from '../../components/opsa/ui';
import { MAP_COLORS, OpsMap, heroColor, initials, type OpsMarker } from '../../components/opsa/OpsMap';
import { useLookupOptions } from '../../components/opsa/lookups';
import type { LiveHero, LiveSnapshot } from '../../components/opsa/liveTypes';
import './i18n';

interface CourierLiveRow { id: string; code: string; name: string; phone: string; lat: number | null; lng: number | null; lastSeenAt: string | null; availability: LiveHero['availability']; vehicleType: LiveHero['vehicleType']; cashOnHandCents: number; cashLimitCents: number; homeHubId: string | null; stale: boolean }

interface RunsheetStops {
  id: string;
  code: string;
  stops: Array<{ id: string; trackingNumber: string; status: OrderStatus; routeSequence: number | null; recipientName: string; addressLine: string; collectCents: number; eta: string | null; zone: { code: string } | null }>;
}

type Tab = 'heroes' | 'sla' | 'orders';
type HeroFilter = 'all' | 'online' | 'busy' | 'offline' | 'cash';

export default function LivePage() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const [qs, setQs] = useQueryState({ hub: '', panel: 'heroes', filter: 'all', q: '' });
  const poll = usePollInterval(10_000);
  const full = can('dispatch.manage');
  const { hubs, hubsData } = useLookupOptions();
  const [selected, setSelected] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);

  const liveQ = useQuery({
    queryKey: ['dispatch', 'live', qs.hub || 'all'],
    queryFn: () => api<LiveSnapshot>('/dispatch/live', { query: { hubId: qs.hub || undefined } }),
    enabled: full,
    refetchInterval: poll,
  });
  const couriersQ = useQuery({
    queryKey: ['couriers', 'live', qs.hub || 'all'],
    queryFn: () => api<{ serverTime: string; data: CourierLiveRow[] }>('/couriers/live', { query: { hubId: qs.hub || undefined } }),
    enabled: !full && can('couriers.track'),
    refetchInterval: poll,
  });

  const heroes: LiveHero[] = useMemo(() => {
    if (full) return liveQ.data?.heroes ?? [];
    return (couriersQ.data?.data ?? []).map((c) => ({
      ...c, online: c.availability !== 'OFFLINE', cashUsage: c.cashLimitCents ? c.cashOnHandCents / c.cashLimitCents : 0, runsheet: null,
    }));
  }, [full, liveQ.data, couriersQ.data]);

  const data = liveQ.data;
  const loading = full ? liveQ.isLoading : couriersQ.isLoading;
  const error = full ? liveQ.error : couriersQ.error;
  const updatedAt = full ? liveQ.dataUpdatedAt : couriersQ.dataUpdatedAt;
  const slaIds = useMemo(() => new Set(data?.slaAtRisk.map((o) => o.id)), [data]);

  const filteredHeroes = useMemo(() => {
    const q = qs.q.trim().toLowerCase();
    return heroes
      .filter((h) => {
        const f = qs.filter as HeroFilter;
        if (f === 'online' && !(h.online && h.availability === 'ONLINE')) return false;
        if (f === 'busy' && h.availability !== 'BUSY') return false;
        if (f === 'offline' && h.online) return false;
        if (f === 'cash' && !(h.cashLimitCents > 0 && h.cashUsage >= 0.9)) return false;
        if (q && !`${h.name} ${h.code} ${h.phone}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => Number(b.online) - Number(a.online) || b.cashUsage - a.cashUsage);
  }, [heroes, qs.filter, qs.q]);

  const selectedHero = heroes.find((h) => h.id === selected) ?? null;
  const heroOrders = useMemo(() => (data?.orders ?? []).filter((o) => o.courierId === selected).sort((a, b) => (a.routeSequence ?? 99) - (b.routeSequence ?? 99)), [data, selected]);

  const markers = useMemo<OpsMarker[]>(() => {
    const m: OpsMarker[] = [];
    for (const h of hubsData) if (!qs.hub || qs.hub === h.id) m.push({ id: `hub-${h.id}`, type: 'hub', lat: h.lat, lng: h.lng, title: `${locale === 'ar' ? h.nameAr ?? h.name : h.name} · ${h.code}` });
    for (const o of data?.orders ?? []) {
      const mine = selected && o.courierId === selected;
      if (mine) m.push({ id: `o-${o.id}`, type: 'pin', lat: o.lat, lng: o.lng, color: slaIds.has(o.id) ? MAP_COLORS.urgent : MAP_COLORS.order, label: o.routeSequence ?? undefined, title: `${o.trackingNumber} · ${o.zoneCode}` });
      else m.push({ id: `o-${o.id}`, type: 'dot', lat: o.lat, lng: o.lng, color: slaIds.has(o.id) ? MAP_COLORS.urgent : MAP_COLORS.order, title: `${o.trackingNumber} · ${o.zoneCode}${o.approximate ? ` (${t('ops.live.approx')})` : ''}` });
    }
    for (const h of heroes) {
      if (h.lat == null || h.lng == null) continue;
      m.push({
        id: `h-${h.id}`, type: 'hero', lat: h.lat, lng: h.lng, color: heroColor(h), label: initials(h.name), pulse: h.online && !h.stale, selected: h.id === selected,
        title: `${h.name} · ${h.code}`, onClick: () => setSelected(h.id),
      });
    }
    return m;
  }, [hubsData, data, heroes, selected, slaIds, qs.hub, locale, t]);

  const route = useMemo(() => {
    if (!selectedHero || selectedHero.lat == null || selectedHero.lng == null || !heroOrders.length) return [];
    return [{ id: 'route', positions: [[selectedHero.lat, selectedHero.lng] as [number, number], ...heroOrders.map((o) => [o.lat, o.lng] as [number, number])], dashed: true }];
  }, [selectedHero, heroOrders]);

  const openHero = (h: LiveHero) => {
    setSelected(h.id);
    if (h.lat != null && h.lng != null) setFlyTo([h.lat, h.lng]);
  };

  if (!can('couriers.track') && !full) return <NoAccess />;

  const c = data?.counters;
  const counters = full && c
    ? [
        { k: 'online', v: num(c.heroesOnline), icon: <Bike className="h-4 w-4" />, tone: 'text-turtle-600' },
        { k: 'out', v: num(c.outForDelivery), icon: <Truck className="h-4 w-4" />, tone: 'text-violet-600' },
        { k: 'delivered', v: num(c.deliveredToday), icon: <Package className="h-4 w-4" />, tone: 'text-turtle-600' },
        { k: 'failed', v: num(c.failedToday), icon: <Package className="h-4 w-4" />, tone: 'text-amber-600' },
        { k: 'collected', v: money(c.collectedTodayCents, { compact: true }), icon: <Wallet className="h-4 w-4" />, tone: 'text-sand-600' },
        { k: 'sla', v: num(c.slaAtRisk), icon: <AlarmClock className="h-4 w-4" />, tone: c.slaAtRisk ? 'text-red-600' : 'text-ink-400' },
      ]
    : [];

  return (
    <div className="relative isolate -mx-4 -my-6 flex flex-col sm:-mx-6 lg:-mx-8 lg:h-[calc(100dvh-4rem)] lg:flex-row">
      {/* map */}
      <div className="relative h-[44vh] min-h-[280px] lg:h-auto lg:min-h-0 lg:flex-1">
        {loading ? <Skeleton className="h-full w-full rounded-none" /> : <OpsMap markers={markers} routes={route} height="100%" rounded={false} className="border-0" flyTo={flyTo} fitKey={qs.hub || 'all'} />}
        {counters.length > 0 && (
          <div className="pointer-events-none absolute inset-x-14 top-3 z-[500] hidden justify-center md:flex">
            <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-2xl border border-ink-100 bg-white/95 p-1.5 shadow-pop backdrop-blur dark:border-ink-700 dark:bg-ink-900/95">
              {counters.map((x) => (
                <div key={x.k} className="flex items-center gap-2 rounded-xl px-3 py-1.5">
                  <span className={x.tone}>{x.icon}</span>
                  <span className="text-xs text-ink-500">{t(`ops.live.c.${x.k}`)}</span>
                  <span className="ltr font-display text-sm font-bold text-ink-900 dark:text-white">{x.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <MapLegend />
      </div>

      {/* side panel / bottom sheet */}
      <aside className="relative z-[600] -mt-4 flex flex-col rounded-t-3xl border-ink-100 bg-white shadow-pop dark:border-ink-800 dark:bg-ink-900 lg:mt-0 lg:w-[400px] lg:rounded-none lg:border-s lg:shadow-none xl:w-[430px]">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-ink-200 dark:bg-ink-700 lg:hidden" />
        <div className="space-y-3 border-b border-ink-100 p-4 dark:border-ink-800">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-display text-lg font-bold text-ink-900 dark:text-white">{t('ops.live.title')}</h1>
            <LiveIndicator updatedAt={updatedAt} paused={poll === false} />
          </div>
          {full && c && (
            <div className="grid grid-cols-3 gap-2 md:hidden">
              {counters.slice(0, 6).map((x) => (
                <div key={x.k} className="rounded-xl bg-ink-50 px-2 py-1.5 text-center dark:bg-ink-800/60">
                  <p className="font-display text-sm font-bold text-ink-900 dark:text-white"><span className="ltr">{x.v}</span></p>
                  <p className="truncate text-[11px] text-ink-500">{t(`ops.live.c.${x.k}`)}</p>
                </div>
              ))}
            </div>
          )}
          <Select aria-label={t('common.hub')} value={qs.hub} onChange={(e) => setQs({ hub: e.target.value })} options={hubs} placeholder={t('ops.opsa.anyHub')} />
          {full && (
            <Segmented
              value={qs.panel as Tab}
              onChange={(v) => setQs({ panel: v })}
              className="w-full"
              options={[
                { value: 'heroes', label: t('ops.live.tab.heroes'), count: heroes.length },
                { value: 'sla', label: t('ops.live.tab.sla'), count: data?.slaAtRisk.length ?? 0 },
                { value: 'orders', label: t('ops.live.tab.orders'), count: data?.orders.length ?? 0 },
              ]}
            />
          )}
          {!full && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-200">{t('ops.live.limited')}</p>}
          {qs.panel === 'heroes' || !full ? (
            <>
              <SearchInput value={qs.q} onChange={(v) => setQs({ q: v })} placeholder={t('ops.live.search')} />
              <Segmented
                size="sm"
                value={qs.filter as HeroFilter}
                onChange={(v) => setQs({ filter: v })}
                options={(['all', 'online', 'busy', 'offline', 'cash'] as const).map((f) => ({ value: f, label: t(`ops.live.filter.${f}`) }))}
              />
            </>
          ) : null}
        </div>

        <div className="flex-1 lg:overflow-y-auto">
          {error ? (
            <ErrorState error={error} onRetry={() => (full ? liveQ.refetch() : couriersQ.refetch())} />
          ) : loading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : qs.panel === 'sla' && full ? (
            <SlaList live={data!} onPick={(lat, lng) => setFlyTo([lat, lng])} />
          ) : qs.panel === 'orders' && full ? (
            <OrdersList live={data!} heroes={heroes} onPick={(lat, lng) => setFlyTo([lat, lng])} />
          ) : filteredHeroes.length === 0 ? (
            <EmptyState icon={<Bike className="h-7 w-7" />} title={t('ops.live.noHeroes')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {filteredHeroes.map((h) => (
                <li key={h.id}>
                  <HeroRow hero={h} active={h.id === selected} onClick={() => openHero(h)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <HeroDrawer hero={selectedHero} onClose={() => setSelected(null)} orders={heroOrders.length} />
    </div>
  );
}

function LiveIndicator({ updatedAt, paused }: { updatedAt: number; paused: boolean }) {
  const { t } = useI18n();
  useNow(5_000);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-500" title={paused ? t('ops.live.paused') : undefined}>
      <span className={cn('relative flex h-2 w-2')}>
        {!paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-turtle-400 opacity-75" />}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', paused ? 'bg-ink-300' : 'bg-turtle-500')} />
      </span>
      {updatedAt ? (paused ? t('ops.live.paused') : t('ops.live.updated', { t: ago(new Date(updatedAt)) })) : <Radio className="h-3.5 w-3.5" />}
    </span>
  );
}

function MapLegend() {
  const { t } = useI18n();
  const items: Array<[string, string]> = [
    [MAP_COLORS.online, 'online'],
    [MAP_COLORS.busy, 'busy'],
    [MAP_COLORS.break, 'break'],
    [MAP_COLORS.offline, 'offline'],
    [MAP_COLORS.order, 'order'],
  ];
  return (
    <div className="absolute bottom-6 start-3 z-[500] hidden rounded-xl border border-ink-100 bg-white/95 px-3 py-2 text-[11px] shadow-card backdrop-blur dark:border-ink-700 dark:bg-ink-900/95 sm:block lg:bottom-3">
      <ul className="space-y-1">
        {items.map(([c, k]) => (
          <li key={k} className="flex items-center gap-2 text-ink-600 dark:text-ink-300">
            <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-ink-900" style={{ background: c }} />
            {t(`ops.live.legend.${k}`)}
          </li>
        ))}
        <li className="flex items-center gap-2 text-ink-600 dark:text-ink-300">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-ink-950 ring-2 ring-white dark:ring-ink-600" />
          {t('ops.live.legend.hub')}
        </li>
      </ul>
    </div>
  );
}

function CashBar({ hero }: { hero: LiveHero }) {
  const usage = hero.cashLimitCents ? hero.cashOnHandCents / hero.cashLimitCents : 0;
  return <ProgressBar value={usage} tone={usage >= 1 ? 'red' : usage >= 0.9 ? 'sand' : 'turtle'} className="h-1.5" />;
}

function HeroRow({ hero: h, active, onClick }: { hero: LiveHero; active: boolean; onClick: () => void }) {
  const { t, dir } = useI18n();
  const rs = h.runsheet;
  const done = rs ? rs.progress.delivered + rs.progress.failed : 0;
  return (
    <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-none dark:hover:bg-ink-800/50', active && 'bg-turtle-50/70 dark:bg-turtle-950/40')}>
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: heroColor(h) }}>
        {initials(h.name)}
        {h.online && !h.stale && <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white bg-turtle-400 dark:border-ink-900" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{h.name}</span>
          <Mono className="text-[11px] text-ink-400">{h.code}</Mono>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
          <span>{t(`ops.opsa.avail.${h.availability}`)}</span>
          <span>·</span>
          <span className={cn(h.stale && 'text-amber-600')}>{h.lastSeenAt ? ago(h.lastSeenAt) : '—'}</span>
          {rs && (
            <>
              <span>·</span>
              <span className="ltr">{t('ops.live.stops', { done: num(done), total: num(rs.progress.total) })}</span>
            </>
          )}
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          <CashBar hero={h} />
          <span className={cn('ltr shrink-0 text-[11px] font-medium', h.cashUsage >= 1 ? 'text-red-600' : h.cashUsage >= 0.9 ? 'text-sand-700' : 'text-ink-500')}>{money(h.cashOnHandCents, { compact: true })}</span>
        </span>
      </span>
      <ChevronRight className={cn('h-4 w-4 shrink-0 text-ink-300', dir === 'rtl' && 'rotate-180')} />
    </button>
  );
}

function SlaList({ live, onPick }: { live: LiveSnapshot; onPick: (lat: number, lng: number) => void }) {
  const { t } = useI18n();
  const pos = new Map(live.orders.map((o) => [o.id, o]));
  if (!live.slaAtRisk.length) return <EmptyState icon={<AlarmClock className="h-7 w-7" />} title={t('ops.live.noSla')} />;
  return (
    <ul className="divide-y divide-ink-100 dark:divide-ink-800">
      {live.slaAtRisk.map((o) => {
        const p = pos.get(o.id);
        return (
          <li key={o.id} className="flex items-center gap-3 px-4 py-3">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', o.overdue ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300')}>
              <AlarmClock className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <Link to={`/ops/orders/${o.id}`} className="font-mono text-sm font-semibold text-ink-900 hover:text-turtle-700 hover:underline dark:text-ink-50"><span className="ltr">{o.trackingNumber}</span></Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                <StatusBadge status={o.status} />
                <span className="ltr">{o.zoneCode}</span>
                <span className="ltr">{o.brandCode}</span>
                {o.courierCode && <span className="ltr">{o.courierCode}</span>}
              </div>
            </div>
            <div className="shrink-0 text-end">
              <Badge tone={o.overdue ? 'danger' : 'warning'}>
                {o.minutesLeft == null ? '—' : o.overdue ? t('ops.live.minLate', { n: num(Math.abs(o.minutesLeft)) }) : t('ops.live.minLeft', { n: num(o.minutesLeft) })}
              </Badge>
              {p && (
                <button type="button" onClick={() => onPick(p.lat, p.lng)} className="mt-1 flex items-center gap-1 text-[11px] font-medium text-turtle-700 hover:underline dark:text-turtle-400">
                  <Crosshair className="h-3 w-3" />{t('ops.live.showOnMap')}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OrdersList({ live, heroes, onPick }: { live: LiveSnapshot; heroes: LiveHero[]; onPick: (lat: number, lng: number) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const byId = new Map(heroes.map((h) => [h.id, h]));
  const list = live.orders.filter((o) => !q || `${o.trackingNumber} ${o.zoneCode}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="p-4 pb-2"><SearchInput value={q} onChange={setQ} placeholder={t('ops.live.searchOrders')} /></div>
      {!list.length ? (
        <EmptyState icon={<Truck className="h-7 w-7" />} title={t('ops.live.noOrders')} />
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {list.map((o) => {
            const h = o.courierId ? byId.get(o.courierId) : null;
            return (
              <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                <button type="button" onClick={() => onPick(o.lat, o.lng)} aria-label={t('ops.live.showOnMap')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300">
                  <MapPin className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <Link to={`/ops/orders/${o.id}`} className="font-mono text-sm font-semibold hover:underline"><span className="ltr">{o.trackingNumber}</span></Link>
                  <p className="truncate text-xs text-ink-500"><span className="ltr">{o.zoneCode}</span>{h ? ` · ${h.name}` : ''}{o.routeSequence ? ` · #${o.routeSequence}` : ''}</p>
                </div>
                <span className="ltr shrink-0 text-xs font-semibold text-sand-700 dark:text-sand-300">{o.collectCents ? money(o.collectCents) : '—'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HeroDrawer({ hero, onClose, orders }: { hero: LiveHero | null; onClose: () => void; orders: number }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const rsId = hero?.runsheet?.id;
  const rsQ = useQuery({ queryKey: ['runsheets', rsId], queryFn: () => api<RunsheetStops>(`/runsheets/${rsId}`), enabled: !!rsId && can('runsheets.read') });
  if (!hero) return null;
  const rs = hero.runsheet;
  const usage = hero.cashLimitCents ? hero.cashOnHandCents / hero.cashLimitCents : 0;
  const done = rs ? rs.progress.delivered + rs.progress.failed : 0;
  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-md"
      title={
        <span className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white" style={{ background: heroColor(hero) }}>{initials(hero.name)}</span>
          {hero.name}
        </span>
      }
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          {can('couriers.read') && <LinkButton to={`/ops/heroes/${hero.id}`}>{t('ops.live.openHero')}</LinkButton>}
          {rs && can('runsheets.read') && <LinkButton to={`/ops/dispatch/runsheets/${rs.id}`}>{t('ops.live.openRunsheet')}</LinkButton>}
          <CallButton value={hero.phone} name={hero.name} />
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={hero.online ? (hero.availability === 'BUSY' ? 'progress' : 'success') : 'neutral'} dot>{t(`ops.opsa.avail.${hero.availability}`)}</Badge>
          <Badge>{t(`ops.opsa.vehicle.${hero.vehicleType}`)}</Badge>
          <Mono className="text-xs text-ink-500">{hero.code}</Mono>
          <a href={`tel:${hero.phone}`} className="ltr text-sm text-ink-600 hover:underline dark:text-ink-300">{fmtPhone(hero.phone)}</a>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60">
            <p className="text-xs text-ink-500">{t('ops.live.lastSeen')}</p>
            <p className="mt-0.5 text-sm font-semibold">{hero.lastSeenAt ? ago(hero.lastSeenAt) : '—'}</p>
            {hero.stale && <Badge tone="warning" className="mt-1">{t('ops.live.stale')}</Badge>}
          </div>
          <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60">
            <p className="text-xs text-ink-500">{t('ops.live.tab.orders')}</p>
            <p className="mt-0.5 text-sm font-semibold"><span className="ltr">{num(orders)}</span></p>
          </div>
        </div>

        <section className="rounded-2xl border border-ink-100 p-4 dark:border-ink-800">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Wallet className="h-4 w-4 text-sand-600" />{t('ops.live.cashOnHand')}</h3>
            <span className="ltr font-display text-lg font-bold">{money(hero.cashOnHandCents)}</span>
          </div>
          <ProgressBar value={usage} tone={usage >= 1 ? 'red' : usage >= 0.9 ? 'sand' : 'turtle'} className="mt-3" />
          <div className="mt-1.5 flex justify-between text-xs text-ink-500">
            <span className="ltr">{pct(usage, 0)}</span>
            <span>{t('ops.live.cashLimit', { v: money(hero.cashLimitCents) })}</span>
          </div>
          {usage >= 1 ? <p className="mt-2 text-xs font-medium text-red-600">{t('ops.live.overLimit')}</p> : usage >= 0.9 ? <p className="mt-2 text-xs font-medium text-sand-700">{t('ops.live.nearLimit')}</p> : null}
        </section>

        <section className="rounded-2xl border border-ink-100 p-4 dark:border-ink-800">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Truck className="h-4 w-4 text-violet-600" />{t('ops.live.todayRun')}</h3>
            {rs && <Mono className="text-xs text-ink-500">{rs.code}</Mono>}
          </div>
          {!rs ? (
            <p className="mt-3 text-sm text-ink-500">{t('ops.live.noRunsheet')}</p>
          ) : (
            <>
              <ProgressBar value={rs.progress.total ? done / rs.progress.total : 0} className="mt-3" />
              <p className="mt-1.5 text-xs text-ink-500">{t('ops.live.progress', { p: pct(rs.progress.total ? done / rs.progress.total : 0, 0) })}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label={t('ops.live.delivered')} value={num(rs.progress.delivered)} cls="text-turtle-700 dark:text-turtle-400" />
                <Stat label={t('ops.live.failed')} value={num(rs.progress.failed)} cls="text-amber-700 dark:text-amber-400" />
                <Stat label={t('ops.live.pending')} value={num(rs.progress.pending)} cls="text-ink-900 dark:text-white" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label={t('ops.live.expectedCod')} value={money(rs.expectedCodCents)} cls="text-ink-900 dark:text-white" />
                <Stat label={t('ops.live.collectedCod')} value={money(rs.collectedCents)} cls="text-sand-700 dark:text-sand-300" />
              </div>
              {rsQ.data && (
                <ol className="mt-4 space-y-2">
                  {[...rsQ.data.stops].sort((a, b) => (a.routeSequence ?? 0) - (b.routeSequence ?? 0)).map((s) => (
                    <li key={s.id} className="flex items-start gap-3 rounded-xl border border-ink-100 p-2.5 dark:border-ink-800">
                      <span className="ltr grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-900 text-[11px] font-bold text-white dark:bg-ink-100 dark:text-ink-900">{s.routeSequence ?? '–'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <Link to={`/ops/orders/${s.id}`} className="font-mono text-xs font-semibold hover:underline"><span className="ltr">{s.trackingNumber}</span></Link>
                          <StatusBadge status={s.status} />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-500">{s.recipientName} · {s.addressLine}</p>
                        <p className="mt-0.5 text-[11px] text-ink-400">
                          {s.collectCents ? <span className="ltr me-2 font-semibold text-sand-700 dark:text-sand-300">{money(s.collectCents)}</span> : null}
                          {s.eta && s.status === 'OUT_FOR_DELIVERY' ? <span className="ltr">ETA {timeOnly(s.eta)}</span> : null}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="rounded-xl bg-ink-50 px-2 py-2 dark:bg-ink-800/60">
      <p className={cn('ltr font-display text-base font-bold', cls)}>{value}</p>
      <p className="truncate text-[11px] text-ink-500">{label}</p>
    </div>
  );
}
