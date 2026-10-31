import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlarmClock, ArrowUpRight, Banknote, Bike, Boxes, CheckCircle2, ChevronRight, Clock4, Headphones, PackagePlus, PackageSearch, Radar, RotateCcw,
  ScanLine, ShieldAlert, Truck, Wallet, XCircle,
} from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePollInterval } from '@/lib/hooks';
import { cairoToday, dateTime, money, num, pct } from '@/lib/format';
import { useI18n } from '@/i18n';
import { ErrorState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Kpi, LinkButton, SectionCard, addDaysIso } from '../../components/opsa/ui';
import { ChartTooltip, Legend, STATUS_COLORS, useChartTheme } from '../../components/opsa/charts';
import { OpsMap, heroColor, initials, type OpsMarker } from '../../components/opsa/OpsMap';
import { useHubs } from '../../components/opsa/lookups';
import type { LiveSnapshot, OpsOverview } from '../../components/opsa/liveTypes';
import type { OrderCounts } from '../../components/opsa/types';
import './i18n';

function cairoHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(new Date()));
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { me, can } = useAuth();
  const today = cairoToday();
  const from14 = addDaysIso(today, -13);
  const poll = usePollInterval(30_000);

  const canAnalytics = can('analytics.read');
  const canLive = can('dispatch.manage');
  const todayQ = useQuery({ queryKey: ['analytics', 'ops', { from: today, to: today }], queryFn: () => api<OpsOverview>('/analytics/ops/overview', { query: { from: today, to: today } }), enabled: canAnalytics, refetchInterval: poll });
  const rangeQ = useQuery({ queryKey: ['analytics', 'ops', { from: from14, to: today }], queryFn: () => api<OpsOverview>('/analytics/ops/overview', { query: { from: from14, to: today } }), enabled: canAnalytics, staleTime: 120_000 });
  const liveQ = useQuery({ queryKey: ['dispatch', 'live', 'all'], queryFn: () => api<LiveSnapshot>('/dispatch/live'), enabled: canLive, refetchInterval: poll });
  const countsQ = useQuery({ queryKey: ['orders', 'counts', {}], queryFn: () => api<OrderCounts>('/orders/counts'), enabled: can('orders.read'), refetchInterval: poll });
  const cohortQ = useQuery({ queryKey: ['orders', 'counts', { from: from14, to: today }], queryFn: () => api<OrderCounts>('/orders/counts', { query: { from: from14, to: today } }), enabled: can('orders.read'), staleTime: 120_000 });
  const createdTodayQ = useQuery({ queryKey: ['orders', 'counts', { from: today, to: today }], queryFn: () => api<OrderCounts>('/orders/counts', { query: { from: today, to: today } }), enabled: can('orders.read') && !canAnalytics, refetchInterval: poll });
  const pickupsQ = useQuery({ queryKey: ['pickups', { status: 'REQUESTED', pageSize: 1 }], queryFn: () => api<Paginated<unknown>>('/pickups', { query: { status: 'REQUESTED', pageSize: 1 } }), enabled: can('pickups.read'), refetchInterval: poll });
  const ticketsQ = useQuery({ queryKey: ['tickets', { open: true, breached: true, pageSize: 1 }], queryFn: () => api<Paginated<unknown>>('/tickets', { query: { open: true, breached: true, pageSize: 1 } }), enabled: can('tickets.read'), refetchInterval: poll });
  const openTicketsQ = useQuery({ queryKey: ['tickets', { open: true, pageSize: 1 }], queryFn: () => api<Paginated<unknown>>('/tickets', { query: { open: true, pageSize: 1 } }), enabled: can('tickets.read') && !canAnalytics, refetchInterval: poll });

  const k = todayQ.data?.kpis;
  const k14 = rangeQ.data?.kpis;
  const counts = countsQ.data;
  const live = liveQ.data;
  const hour = cairoHour();
  const greetingKey = hour < 12 ? 'ops.dashboard.morning' : hour < 18 ? 'ops.dashboard.afternoon' : 'ops.dashboard.evening';
  const firstName = me?.name.split(' ')[0] ?? '';
  const nearLimit = live?.heroes.filter((h) => h.cashLimitCents > 0 && h.cashUsage >= 0.9).length ?? 0;
  const onlineHeroes = live?.heroes.filter((h) => h.online).length ?? 0;
  const busyHeroes = live?.heroes.filter((h) => h.availability === 'BUSY').length ?? 0;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-3xl">{t(greetingKey, { name: firstName })}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('ops.dashboard.subtitle', { date: dateTime(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {can('orders.create') && <QuickAction to="/ops/orders/new" icon={<PackagePlus className="h-4 w-4" />} label={t('ops.dashboard.newOrder')} primary />}
          {can('hubs.scan') && <QuickAction to="/ops/hub" icon={<ScanLine className="h-4 w-4" />} label={t('ops.dashboard.scan')} />}
          {can('runsheets.read') && <QuickAction to="/ops/dispatch" icon={<Truck className="h-4 w-4" />} label={t('ops.dashboard.dispatch')} />}
          {can('couriers.track') && <QuickAction to="/ops/live" icon={<Radar className="h-4 w-4" />} label={t('ops.dashboard.live')} />}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        <Kpi
          label={t('ops.dashboard.kpi.createdToday')}
          value={num(canAnalytics ? k?.ordersCreated : createdTodayQ.data?.total)}
          loading={canAnalytics ? todayQ.isLoading : createdTodayQ.isLoading}
          icon={<PackagePlus />}
          tone="sky"
          to="/ops/orders"
          hint={k ? money(k.codBookedCents, { compact: true }) : undefined}
        />
        <Kpi
          label={t('ops.dashboard.kpi.active')}
          value={num((counts?.groups.new ?? 0) + (counts?.groups.inTransit ?? 0))}
          loading={countsQ.isLoading}
          icon={<PackageSearch />}
          tone="violet"
          to="/ops/orders?status=inTransit"
          hint={counts ? t('ops.dashboard.kpi.activeHint', { n: num(counts.groups.new) }) : undefined}
        />
        <Kpi label={t('ops.dashboard.kpi.out')} value={num(live?.counters.outForDelivery ?? counts?.byStatus.OUT_FOR_DELIVERY)} loading={countsQ.isLoading && liveQ.isLoading} icon={<Truck />} tone="violet" to="/ops/orders?status=OUT_FOR_DELIVERY" />
        <Kpi label={t('ops.dashboard.kpi.delivered')} value={num(k?.delivered ?? live?.counters.deliveredToday)} loading={canAnalytics ? todayQ.isLoading : liveQ.isLoading} icon={<CheckCircle2 />} tone="turtle" to={`/ops/orders?status=DELIVERED&from=${today}&to=${today}&dateField=deliveredAt`} />
        {canAnalytics && <Kpi label={t('ops.dashboard.kpi.returned')} value={num(k?.returned)} loading={todayQ.isLoading} icon={<RotateCcw />} tone="red" to="/ops/orders?status=returns" />}
        <Kpi label={t('ops.dashboard.kpi.failed')} value={num(k?.failedAttempts ?? live?.counters.failedToday)} loading={canAnalytics ? todayQ.isLoading : liveQ.isLoading} icon={<XCircle />} tone="amber" to="/ops/orders?status=FAILED_ATTEMPT" />
        {canAnalytics && (
          <>
            <Kpi label={t('ops.dashboard.kpi.success')} value={k14?.successRate == null ? '—' : pct(k14.successRate)} loading={rangeQ.isLoading} icon={<ShieldAlert />} tone="turtle" hint={k14?.firstAttemptSuccessRate != null ? t('ops.dashboard.kpi.firstAttempt', { v: pct(k14.firstAttemptSuccessRate) }) : undefined} to="/ops/analytics" />
            <Kpi label={t('ops.dashboard.kpi.onTime')} value={k14?.onTimeRate == null ? '—' : pct(k14.onTimeRate)} loading={rangeQ.isLoading} icon={<Clock4 />} tone="sky" hint={k14?.avgHoursToDeliver != null ? t('ops.dashboard.kpi.avgHours', { n: num(k14.avgHoursToDeliver) }) : undefined} to="/ops/analytics" />
          </>
        )}
        <Kpi label={t('ops.dashboard.kpi.cod')} value={money(k?.codCollectedCents ?? live?.counters.collectedTodayCents)} loading={canAnalytics ? todayQ.isLoading : liveQ.isLoading} icon={<Banknote />} tone="sand" />
        {canAnalytics && <Kpi label={t('ops.dashboard.kpi.custody')} value={money(k?.cashInCustodyCents, { compact: true })} loading={todayQ.isLoading} icon={<Wallet />} tone="sand" to={can('cash.read') ? '/ops/cash' : undefined} />}
        <Kpi
          label={t('ops.dashboard.kpi.heroes')}
          value={num(k?.activeHeroes ?? onlineHeroes)}
          loading={canAnalytics ? todayQ.isLoading : liveQ.isLoading}
          icon={<Bike />}
          tone="turtle"
          hint={live ? t('ops.dashboard.kpi.heroesHint', { n: num(onlineHeroes) }) : undefined}
          to={can('couriers.track') ? '/ops/live' : undefined}
        />
        {can('tickets.read') && (
          <Kpi
            label={t('ops.dashboard.kpi.tickets')}
            value={num(k?.openTickets ?? openTicketsQ.data?.meta.total)}
            loading={canAnalytics ? todayQ.isLoading : openTicketsQ.isLoading}
            icon={<Headphones />}
            tone={ticketsQ.data?.meta.total ? 'red' : 'ink'}
            hint={ticketsQ.data ? t('ops.dashboard.kpi.ticketsHint', { n: num(ticketsQ.data.meta.total) }) : undefined}
            to="/ops/tickets?open=1"
          />
        )}
      </div>

      {/* volume + attention */}
      <div className="grid gap-6 xl:grid-cols-3">
        {canAnalytics ? (
          <SectionCard title={t('ops.dashboard.volume')} subtitle={t('ops.dashboard.volumeSub')} className="xl:col-span-2" actions={<Link to="/ops/analytics" className="text-sm font-medium text-turtle-700 hover:underline dark:text-turtle-400">{t('ops.dashboard.viewAll')}</Link>}>
            {rangeQ.isLoading ? <Skeleton className="h-72 w-full" /> : rangeQ.error ? <ErrorState error={rangeQ.error} onRetry={() => rangeQ.refetch()} /> : <VolumeChart data={rangeQ.data!.daily} />}
          </SectionCard>
        ) : (
          <FunnelCard counts={cohortQ.data} loading={cohortQ.isLoading} className="xl:col-span-2" />
        )}
        <AttentionPanel
          items={[
            canLive && { key: 'sla', icon: <AlarmClock />, label: t('ops.dashboard.att.sla'), hint: t('ops.dashboard.att.slaHint'), count: live?.counters.slaAtRisk, to: '/ops/live?panel=sla', tone: 'red' as const },
            { key: 'breached', icon: <ShieldAlert />, label: t('ops.dashboard.att.breached'), hint: t('ops.dashboard.att.breachedHint'), count: counts?.slaBreached, to: '/ops/orders?sla=1', tone: 'red' as const },
            canLive && { key: 'cash', icon: <Wallet />, label: t('ops.dashboard.att.cash'), hint: t('ops.dashboard.att.cashHint'), count: nearLimit, to: '/ops/live?filter=cash', tone: 'sand' as const },
            can('pickups.read') && { key: 'pickups', icon: <Boxes />, label: t('ops.dashboard.att.pickups'), hint: t('ops.dashboard.att.pickupsHint'), count: pickupsQ.data?.meta.total, to: '/ops/pickups?status=REQUESTED', tone: 'amber' as const },
            { key: 'failed', icon: <XCircle />, label: t('ops.dashboard.att.failed'), hint: t('ops.dashboard.att.failedHint'), count: counts?.byStatus.FAILED_ATTEMPT, to: '/ops/orders?status=FAILED_ATTEMPT', tone: 'amber' as const },
            canLive && { key: 'unassigned', icon: <Truck />, label: t('ops.dashboard.att.unassigned'), hint: t('ops.dashboard.att.unassignedHint'), count: live?.counters.atHub, to: '/ops/dispatch', tone: 'violet' as const },
            { key: 'returns', icon: <RotateCcw />, label: t('ops.dashboard.att.returns'), hint: t('ops.dashboard.att.returnsHint'), count: counts?.byStatus.RETURN_PENDING, to: '/ops/orders?status=RETURN_PENDING', tone: 'violet' as const },
            can('tickets.read') && { key: 'tickets', icon: <Headphones />, label: t('ops.dashboard.att.tickets'), hint: t('ops.dashboard.att.ticketsHint'), count: ticketsQ.data?.meta.total, to: '/ops/tickets?breached=1', tone: 'red' as const },
          ]}
          loading={countsQ.isLoading}
        />
      </div>

      {canAnalytics && (
        <div className="grid gap-6 xl:grid-cols-3">
          <SectionCard
            title={t('ops.dashboard.codTrend')}
            subtitle={rangeQ.data ? t('ops.dashboard.codTrendSub', { total: money(rangeQ.data.kpis.codCollectedCents, { compact: true }) }) : undefined}
            className="xl:col-span-2"
          >
            {rangeQ.isLoading ? <Skeleton className="h-56 w-full" /> : rangeQ.data ? <CodChart data={rangeQ.data.daily} /> : null}
          </SectionCard>
          <FunnelCard counts={cohortQ.data} loading={cohortQ.isLoading} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {canLive && <LiveMiniMap live={live} loading={liveQ.isLoading} online={onlineHeroes} busy={busyHeroes} />}
        {canAnalytics && (
          <SectionCard title={t('ops.dashboard.topZones')} subtitle={t('ops.dashboard.topZonesSub')} className={canLive ? '' : 'xl:col-span-3'} padded={false}>
            {rangeQ.isLoading ? (
              <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {[...(rangeQ.data?.byZone ?? [])].sort((a, b) => b.created - a.created).slice(0, 7).map((z) => (
                  <li key={z.zoneId}>
                    <Link to={`/ops/orders?zone=${z.zoneId}&from=${from14}&to=${today}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800/50 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-100">{locale === 'ar' ? z.nameAr : z.nameEn}</p>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                          <div className="h-full rounded-full bg-turtle-500" style={{ width: `${(z.successRate ?? 0) * 100}%` }} />
                        </div>
                      </div>
                      <div className="w-20 shrink-0 text-end">
                        <p className="ltr text-sm font-semibold text-ink-900 dark:text-white">{num(z.created)}</p>
                        <p className="ltr text-[11px] text-ink-500">{z.successRate == null ? '—' : pct(z.successRate)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function QuickAction({ to, icon, label, primary }: { to: string; icon: ReactNode; label: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turtle-500 focus-visible:ring-offset-2',
        primary ? 'bg-turtle-600 text-white hover:bg-turtle-700' : 'border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:hover:bg-ink-800',
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

const shortDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

function VolumeChart({ data }: { data: OpsOverview['daily'] }) {
  const { t } = useI18n();
  const th = useChartTheme();
  const series = [
    { key: 'delivered', label: t('ops.dashboard.delivered'), color: STATUS_COLORS.good },
    { key: 'failedAttempts', label: t('ops.dashboard.failed'), color: STATUS_COLORS.warning },
    { key: 'returned', label: t('ops.dashboard.returned'), color: STATUS_COLORS.critical },
  ];
  return (
    <div>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} className="mb-3" />
      <div className="h-64 sm:h-72" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={th.grid} />
            <XAxis dataKey="date" tickFormatter={shortDay} tick={th.tick} axisLine={{ stroke: th.axis }} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} tick={th.tick} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: th.dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)' }} content={<ChartTooltip labelFormat={(l) => dateTime(`${l}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short' })} format={(v) => num(v)} />} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} stroke={th.surface} strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={36} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CodChart({ data }: { data: OpsOverview['daily'] }) {
  const { t } = useI18n();
  const th = useChartTheme();
  return (
    <div className="h-56" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="codFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbb324" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#fbb324" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={th.grid} />
          <XAxis dataKey="date" tickFormatter={shortDay} tick={th.tick} axisLine={{ stroke: th.axis }} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={th.tick} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => money(v, { compact: true })} />
          <Tooltip content={<ChartTooltip labelFormat={(l) => dateTime(`${l}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short' })} format={(v) => money(v)} />} />
          <Area type="monotone" dataKey="codCollectedCents" name={t('ops.dashboard.codTrend')} stroke="#d96d06" strokeWidth={2} fill="url(#codFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: th.surface }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function FunnelCard({ counts, loading, className }: { counts?: OrderCounts; loading: boolean; className?: string }) {
  const { t } = useI18n();
  const steps = useMemo(() => {
    if (!counts) return [];
    const s = counts.byStatus;
    const created = counts.total - s.CANCELLED;
    const picked = created - s.CREATED - s.PICKUP_ASSIGNED - s.ON_HOLD;
    const hub = picked - s.PICKED_UP;
    const out = hub - s.RECEIVED_AT_HUB - s.ASSIGNED;
    return [
      { key: 'created', n: created },
      { key: 'picked', n: picked },
      { key: 'hub', n: hub },
      { key: 'out', n: out },
      { key: 'delivered', n: s.DELIVERED },
    ];
  }, [counts]);
  const max = Math.max(1, steps[0]?.n ?? 1);
  return (
    <SectionCard title={t('ops.dashboard.funnel')} subtitle={t('ops.dashboard.funnelSub')} className={className}>
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : (
        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={s.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink-700 dark:text-ink-200">{t(`ops.dashboard.funnel.${s.key}`)}</span>
                <span className="flex items-baseline gap-2">
                  {i > 0 && <span className="text-xs text-ink-500">{pct(s.n / max, 0)}</span>}
                  <b className="font-semibold text-ink-900 dark:text-white">{num(s.n)}</b>
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                <div className="h-full rounded-full transition-all" style={{ width: `${(Math.max(0, s.n) / max) * 100}%`, background: i === steps.length - 1 ? STATUS_COLORS.good : '#2a78d6', opacity: i === steps.length - 1 ? 1 : 1 - i * 0.12 }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

type Tone = 'red' | 'amber' | 'sand' | 'violet';
const toneDot: Record<Tone, string> = {
  red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  sand: 'bg-sand-50 text-sand-700 dark:bg-sand-900/40 dark:text-sand-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
};

function AttentionPanel({ items, loading }: { items: Array<false | { key: string; icon: ReactNode; label: string; hint: string; count: number | undefined; to: string; tone: Tone }>; loading: boolean }) {
  const { t, dir } = useI18n();
  const visible = items.filter((i): i is Exclude<typeof i, false> => !!i);
  const hot = visible.filter((i) => (i.count ?? 0) > 0);
  const calm = visible.filter((i) => !i.count);
  return (
    <SectionCard title={t('ops.dashboard.attention')} subtitle={t('ops.dashboard.attentionSub')} padded={false}>
      {loading ? (
        <div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <>
          {hot.length === 0 && (
            <div className="flex items-center gap-3 px-5 py-6 text-sm text-turtle-700 dark:text-turtle-300">
              <CheckCircle2 className="h-5 w-5" /> {t('ops.dashboard.allClear')}
            </div>
          )}
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {[...hot, ...calm].map((i) => (
              <li key={i.key}>
                <Link to={i.to} className={cn('flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50 sm:px-5', !i.count && 'opacity-60')}>
                  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]', i.count ? toneDot[i.tone] : 'bg-ink-100 text-ink-400 dark:bg-ink-800')}>{i.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900 dark:text-ink-100">{i.label}</span>
                    <span className="block truncate text-xs text-ink-500">{i.hint}</span>
                  </span>
                  <span className={cn('ltr font-display text-lg font-bold', i.count ? 'text-ink-900 dark:text-white' : 'text-ink-400')}>{num(i.count ?? 0)}</span>
                  <ChevronRight className={cn('h-4 w-4 shrink-0 text-ink-300', dir === 'rtl' && 'rotate-180')} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

function LiveMiniMap({ live, loading, online, busy }: { live?: LiveSnapshot; loading: boolean; online: number; busy: number }) {
  const { t } = useI18n();
  const hubs = useHubs();
  const markers = useMemo<OpsMarker[]>(() => {
    const m: OpsMarker[] = [];
    for (const h of hubs.data ?? []) m.push({ id: `hub-${h.id}`, type: 'hub', lat: h.lat, lng: h.lng, title: `${h.name} · ${h.code}` });
    for (const o of live?.orders ?? []) m.push({ id: `o-${o.id}`, type: 'dot', lat: o.lat, lng: o.lng, color: '#2a78d6', title: o.trackingNumber });
    for (const h of live?.heroes ?? []) if (h.lat != null && h.lng != null) m.push({ id: `h-${h.id}`, type: 'hero', lat: h.lat, lng: h.lng, color: heroColor(h), label: initials(h.name), pulse: h.online && !h.stale, title: `${h.name} · ${h.code}` });
    return m;
  }, [live, hubs.data]);
  return (
    <SectionCard
      title={t('ops.dashboard.map')}
      subtitle={live ? t('ops.dashboard.mapSub', { online: num(online), busy: num(busy) }) : undefined}
      className="xl:col-span-2"
      padded={false}
      actions={
        <LinkButton to="/ops/live" iconEnd={<ArrowUpRight />}>{t('ops.dashboard.openTower')}</LinkButton>
      }
    >
      {loading ? <Skeleton className="m-4 h-80" /> : <OpsMap markers={markers} height={340} rounded={false} className="rounded-b-2xl border-0" />}
    </SectionCard>
  );
}
