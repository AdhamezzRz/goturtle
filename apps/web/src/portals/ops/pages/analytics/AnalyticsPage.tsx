import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownUp, Banknote, CheckCircle2, Clock4, Download, Gauge as GaugeIcon, PackagePlus, Receipt, RotateCcw, Star, Timer, Wallet, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { dateOnly, dateTime, money, num, pct } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button, DataTable, EmptyState, ErrorState, Menu, PageHeader, Select, Skeleton, type Column } from '@/components/ui';
import { DateRange, Kpi, NoAccess, SectionCard, presetRange } from '../../components/opsa/ui';
import { ChartTooltip, Legend, SEQ_BLUE, STATUS_COLORS, useChartTheme } from '../../components/opsa/charts';
import { useLookupOptions } from '../../components/opsa/lookups';
import type { HeroesReport, OpsOverview } from '../../components/opsa/liveTypes';
import './i18n';

const REPORTS = ['daily', 'zones', 'brands', 'heroes', 'failure-reasons'] as const;

export default function AnalyticsPage() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const def = presetRange(30);
  const [f, setF] = useQueryState({ from: def.from, to: def.to, hub: '' });
  const { hubs } = useLookupOptions();
  const query = { from: f.from, to: f.to, hubId: f.hub || undefined };
  const ov = useQuery({ queryKey: ['analytics', 'ops', query], queryFn: () => api<OpsOverview>('/analytics/ops/overview', { query }), placeholderData: keepPreviousData, enabled: can('analytics.read') });
  const heroes = useQuery({ queryKey: ['analytics', 'heroes', query], queryFn: () => api<HeroesReport>('/analytics/heroes', { query }), placeholderData: keepPreviousData, enabled: can('analytics.read') });

  const exportCsv = async (report: (typeof REPORTS)[number]) => {
    try {
      await download(`/analytics/export/${report}`, `goturtle-${report}-${f.from}_${f.to}.csv`, query);
      toast.success(t('ops.analytics.exported'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!can('analytics.read')) return <NoAccess />;
  const k = ov.data?.kpis;
  const loading = ov.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('ops.analytics.title')}
        subtitle={t('ops.analytics.subtitle', { from: dateOnly(`${f.from}T12:00:00Z`), to: dateOnly(`${f.to}T12:00:00Z`) })}
        actions={
          <Menu
            trigger={<Button variant="outline" icon={<Download className="h-4 w-4" />}>{t('ops.analytics.export')}</Button>}
            items={REPORTS.map((r) => ({ label: t(`ops.analytics.report.${r}`), icon: <Download className="h-4 w-4" />, onClick: () => void exportCsv(r) }))}
          />
        }
      />
      <div className="flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900 lg:flex-row lg:items-center lg:justify-between">
        <DateRange from={f.from} to={f.to} onChange={(r) => setF(r)} presets={[7, 30, 90]} />
        <Select aria-label={t('common.hub')} value={f.hub} onChange={(e) => setF({ hub: e.target.value })} options={hubs} placeholder={t('ops.opsa.anyHub')} className="lg:w-64" />
      </div>

      {ov.error ? <ErrorState error={ov.error} onRetry={() => ov.refetch()} /> : (
        <>
          <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 transition-opacity', ov.isFetching && !loading && 'opacity-70')}>
            <Kpi label={t('ops.analytics.k.created')} value={num(k?.ordersCreated)} hint={k ? t('ops.analytics.k.booked', { v: money(k.codBookedCents, { compact: true }) }) : undefined} icon={<PackagePlus />} tone="sky" loading={loading} />
            <Kpi label={t('ops.analytics.k.delivered')} value={num(k?.delivered)} icon={<CheckCircle2 />} tone="turtle" loading={loading} />
            <Kpi label={t('ops.analytics.k.returned')} value={num(k?.returned)} hint={k ? t('ops.analytics.k.cancelled', { n: num(k.cancelled) }) : undefined} icon={<RotateCcw />} tone="red" loading={loading} />
            <Kpi label={t('ops.analytics.k.failed')} value={num(k?.failedAttempts)} icon={<XCircle />} tone="amber" loading={loading} />
            <Kpi label={t('ops.analytics.k.success')} value={k?.successRate == null ? '—' : pct(k.successRate)} icon={<GaugeIcon />} tone="turtle" loading={loading} />
            <Kpi label={t('ops.analytics.k.firstAttempt')} value={k?.firstAttemptSuccessRate == null ? '—' : pct(k.firstAttemptSuccessRate)} icon={<Star />} tone="violet" loading={loading} />
            <Kpi label={t('ops.analytics.k.onTime')} value={k?.onTimeRate == null ? '—' : pct(k.onTimeRate)} icon={<Clock4 />} tone="sky" loading={loading} />
            <Kpi label={t('ops.analytics.k.avgHours')} value={k?.avgHoursToDeliver == null ? '—' : num(k.avgHoursToDeliver)} icon={<Timer />} tone="ink" loading={loading} />
            <Kpi label={t('ops.analytics.k.cod')} value={money(k?.codCollectedCents, { compact: true })} icon={<Banknote />} tone="sand" loading={loading} />
            <Kpi label={t('ops.analytics.k.fees')} value={money(k?.feesCents, { compact: true })} hint={k ? t('ops.analytics.k.feesEx', { v: money(k.feesExVatCents, { compact: true }) }) : undefined} icon={<Receipt />} tone="ink" loading={loading} />
            <Kpi label={t('ops.analytics.k.revenue')} value={money(k?.revenueCents, { compact: true })} hint={k ? t(`ops.analytics.k.revenueSrc.${k.revenueSource === 'ledger' ? 'ledger' : 'orders'}`) : undefined} icon={<Banknote />} tone="turtle" loading={loading} />
            <Kpi label={t('ops.analytics.k.heroPay')} value={money(k?.heroPayCents, { compact: true })} hint={k ? `${t('ops.analytics.k.custody')}: ${money(k.cashInCustodyCents, { compact: true })}` : undefined} icon={<Wallet />} tone="sand" loading={loading} />
          </div>

          <SectionCard title={t('ops.analytics.daily')} subtitle={t('ops.analytics.dailySub')}>
            {loading ? <Skeleton className="h-72" /> : <DailyChart data={ov.data!.daily} />}
          </SectionCard>

          <div className="grid gap-6 xl:grid-cols-3">
            <SectionCard title={t('ops.analytics.reasons')} subtitle={t('ops.analytics.reasonsSub')}>
              {loading ? <Skeleton className="h-64" /> : <ReasonsDonut data={ov.data!.failureReasons} />}
            </SectionCard>
            <SectionCard title={t('ops.analytics.heatmap')} subtitle={t('ops.analytics.heatmapSub')} className="min-w-0 xl:col-span-2">
              {loading ? <Skeleton className="h-64" /> : <Heatmap values={ov.data!.heatmap.values} />}
            </SectionCard>
          </div>

          <ZonesTable data={ov.data?.byZone} loading={loading} locale={locale} />
          <BrandsTable data={ov.data?.topBrands} loading={loading} />
          <HeroesTable data={heroes.data?.heroes} loading={heroes.isLoading} error={heroes.error} onRetry={() => heroes.refetch()} />
        </>
      )}
    </div>
  );
}

const shortDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

function DailyChart({ data }: { data: OpsOverview['daily'] }) {
  const { t } = useI18n();
  const th = useChartTheme();
  const series = [
    { key: 'delivered', label: t('ops.analytics.s.delivered'), color: STATUS_COLORS.good },
    { key: 'failedAttempts', label: t('ops.analytics.s.failed'), color: STATUS_COLORS.warning },
    { key: 'returned', label: t('ops.analytics.s.returned'), color: STATUS_COLORS.critical },
  ];
  if (!data.some((d) => d.created || d.delivered || d.failedAttempts || d.returned)) return <EmptyState title={t('ops.analytics.empty')} />;
  return (
    <div>
      <Legend items={[...series.map((s) => ({ label: s.label, color: s.color })), { label: t('ops.analytics.s.created'), color: th.series1, shape: 'line' as const }]} className="mb-3" />
      <div className="h-72" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={th.grid} />
            <XAxis dataKey="date" tickFormatter={shortDay} tick={th.tick} axisLine={{ stroke: th.axis }} tickLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tick={th.tick} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: th.dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)' }} content={<ChartTooltip labelFormat={(l) => dateTime(`${l}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short' })} format={(v) => num(v)} />} />
            {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="o" fill={s.color} stroke={th.surface} strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={28} />)}
            <Line type="monotone" dataKey="created" name={t('ops.analytics.s.created')} stroke={th.series1} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: th.surface, strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ReasonsDonut({ data }: { data: OpsOverview['failureReasons'] }) {
  const { t } = useI18n();
  const th = useChartTheme();
  if (!data.length) return <EmptyState icon={<CheckCircle2 className="h-7 w-7" />} title={t('ops.analytics.noFailures')} className="py-10" />;
  // Up to 5 named slices + "Other" (never cycle colours).
  const top = data.slice(0, 5);
  const rest = data.slice(5);
  const slices = [...top.map((r) => ({ name: t(`ops.opsa.reason.${r.reason}`), value: r.count, share: r.share })), ...(rest.length ? [{ name: t('ops.opsa.reason.OTHER'), value: rest.reduce((s, r) => s + r.count, 0), share: rest.reduce((s, r) => s + r.share, 0) }] : [])];
  const colors = [...th.categorical.slice(0, 5), '#8592ab'];
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col 2xl:flex-row">
      <div className="relative h-48 w-48 shrink-0" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={1.5} stroke={th.surface} strokeWidth={2}>
              {slices.map((_, i) => <Cell key={i} fill={colors[i]} />)}
            </Pie>
            <Tooltip content={<ChartTooltip format={(v) => `${num(v)} · ${pct(v / total)}`} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><p className="font-display text-2xl font-bold"><span className="ltr">{num(total)}</span></p><p className="text-[11px] text-ink-500">{t('ops.analytics.s.failed')}</p></div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2 text-sm">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
            <span className="min-w-0 flex-1 truncate text-ink-700 dark:text-ink-200">{s.name}</span>
            <span className="ltr font-semibold">{num(s.value)}</span>
            <span className="ltr w-12 text-end text-xs text-ink-500">{pct(s.share, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Heatmap({ values }: { values: number[][] }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...values.flat());
  const days = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i))));
  const color = (v: number) => SEQ_BLUE[Math.max(1, Math.ceil((v / max) * (SEQ_BLUE.length - 1)))];
  if (!values.flat().some(Boolean)) return <EmptyState title={t('ops.analytics.empty')} />;
  return (
    <div>
      <div className="overflow-x-auto pb-1" dir="ltr">
        <table className="w-full min-w-[620px] border-separate" style={{ borderSpacing: 3 }} role="grid">
          <thead>
            <tr>
              <th className="w-12" />
              {Array.from({ length: 24 }, (_, h) => <th key={h} className="text-center text-[10px] font-normal text-ink-400">{h % 3 === 0 ? h : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {values.map((row, d) => (
              <tr key={d}>
                <th scope="row" className="pe-2 text-end text-[11px] font-medium text-ink-500">{days[d]}</th>
                {row.map((v, h) => (
                  <td
                    key={h}
                    title={t('ops.analytics.heatCell', { day: days[d], hour: h, n: num(v) })}
                    aria-label={t('ops.analytics.heatCell', { day: days[d], hour: h, n: num(v) })}
                    className={cn('h-6 rounded-[4px]', !v && 'bg-ink-100 dark:bg-ink-800')}
                    style={v ? { background: color(v) } : undefined}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-ink-500">
        {t('ops.analytics.heatLess')}
        <span className="h-3 w-3 rounded-[3px] bg-ink-100 dark:bg-ink-800" />
        {SEQ_BLUE.slice(1).map((c) => <span key={c} className="h-3 w-3 rounded-[3px]" style={{ background: c }} />)}
        {t('ops.analytics.heatMore')}
      </div>
    </div>
  );
}

function SuccessBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-400">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><div className={cn('h-full rounded-full', value >= 0.85 ? 'bg-turtle-500' : value >= 0.7 ? 'bg-amber-400' : 'bg-red-500')} style={{ width: `${value * 100}%` }} /></div>
      <span className="ltr text-xs font-semibold">{pct(value, 0)}</span>
    </div>
  );
}

function ZonesTable({ data, loading, locale }: { data?: OpsOverview['byZone']; loading: boolean; locale: string }) {
  const { t } = useI18n();
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.created - a.created), [data]);
  const columns: Column<OpsOverview['byZone'][number]>[] = [
    { key: 'z', header: t('ops.analytics.col.zone'), cell: (z) => <div><p className="font-medium">{locale === 'ar' ? z.nameAr : z.nameEn}</p><p className="text-xs text-ink-400"><span className="ltr">{z.code}</span></p></div> },
    { key: 'c', header: t('ops.analytics.col.created'), align: 'end', cell: (z) => <span className="ltr font-semibold">{num(z.created)}</span> },
    { key: 'd', header: t('ops.analytics.col.delivered'), align: 'end', cell: (z) => <span className="ltr">{num(z.delivered)}</span> },
    { key: 'r', header: t('ops.analytics.col.returned'), align: 'end', hideBelow: 'lg', cell: (z) => <span className="ltr">{num(z.returned)}</span> },
    { key: 'p', header: t('ops.analytics.col.inProgress'), align: 'end', hideBelow: 'lg', cell: (z) => <span className="ltr">{num(z.inProgress)}</span> },
    { key: 's', header: t('ops.analytics.col.success'), cell: (z) => <SuccessBar value={z.successRate} /> },
    { key: 'cod', header: t('ops.analytics.col.cod'), align: 'end', hideBelow: 'xl', cell: (z) => <span className="ltr text-sand-700 dark:text-sand-300">{money(z.codCollectedCents)}</span> },
  ];
  return (
    <SectionCard title={t('ops.analytics.zones')} subtitle={t('ops.analytics.zonesSub')} padded={false} bodyClassName="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
      <DataTable columns={columns} rows={rows} rowKey={(z) => z.zoneId} loading={loading} dense empty={t('ops.analytics.empty')}
        mobileCard={(z) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="font-medium">{locale === 'ar' ? z.nameAr : z.nameEn}</p><p className="text-xs text-ink-500"><span className="ltr">{num(z.created)}</span> · {t('ops.analytics.col.delivered')} <span className="ltr">{num(z.delivered)}</span></p></div>
            <SuccessBar value={z.successRate} />
          </div>
        )}
      />
    </SectionCard>
  );
}

function BrandsTable({ data, loading }: { data?: OpsOverview['topBrands']; loading: boolean }) {
  const { t } = useI18n();
  const columns: Column<OpsOverview['topBrands'][number]>[] = [
    { key: 'b', header: t('ops.analytics.col.brand'), cell: (b) => <div><p className="font-medium">{b.name}</p><p className="text-xs text-ink-400"><span className="ltr">{b.code}</span></p></div> },
    { key: 'c', header: t('ops.analytics.col.created'), align: 'end', cell: (b) => <span className="ltr font-semibold">{num(b.created)}</span> },
    { key: 'd', header: t('ops.analytics.col.delivered'), align: 'end', cell: (b) => <span className="ltr">{num(b.delivered)}</span> },
    { key: 'r', header: t('ops.analytics.col.returned'), align: 'end', hideBelow: 'md', cell: (b) => <span className="ltr">{num(b.returned)}</span> },
    { key: 's', header: t('ops.analytics.col.success'), cell: (b) => <SuccessBar value={b.successRate} /> },
    { key: 'cod', header: t('ops.analytics.col.cod'), align: 'end', hideBelow: 'lg', cell: (b) => <span className="ltr text-sand-700 dark:text-sand-300">{money(b.codCollectedCents)}</span> },
    { key: 'f', header: t('ops.analytics.col.fees'), align: 'end', hideBelow: 'lg', cell: (b) => <span className="ltr">{money(b.feesCents)}</span> },
  ];
  return (
    <SectionCard title={t('ops.analytics.brands')} padded={false} bodyClassName="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
      <DataTable columns={columns} rows={data} rowKey={(b) => b.brandId} loading={loading} dense empty={t('ops.analytics.empty')}
        mobileCard={(b) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="font-medium">{b.name}</p><p className="text-xs text-ink-500"><span className="ltr">{num(b.created)}</span> · <span className="ltr">{money(b.codCollectedCents, { compact: true })}</span></p></div>
            <SuccessBar value={b.successRate} />
          </div>
        )}
      />
    </SectionCard>
  );
}

type HeroRow = HeroesReport['heroes'][number];
type HeroSort = 'delivered' | 'successRate' | 'deliveriesPerActiveDay' | 'codCollectedCents' | 'earningsCents' | 'failedAttempts' | 'rating';

function HeroesTable({ data, loading, error, onRetry }: { data?: HeroRow[]; loading: boolean; error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const [sort, setSort] = useState<HeroSort>('delivered');
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => Number(b[sort] ?? -1) - Number(a[sort] ?? -1)), [data, sort]);
  const H = ({ k, label }: { k: HeroSort; label: string }) => (
    <button type="button" onClick={() => setSort(k)} className={cn('inline-flex items-center gap-1 uppercase', sort === k && 'text-turtle-700 dark:text-turtle-400')}>
      {label}{sort === k && <ArrowDownUp className="h-3 w-3" />}
    </button>
  );
  const columns: Column<HeroRow>[] = [
    { key: 'h', header: t('ops.analytics.h.hero'), cell: (h) => <div><p className="font-medium">{h.name}</p><p className="text-xs text-ink-400"><span className="ltr">{h.code}</span> · {t('ops.analytics.h.days', { n: num(h.activeDays) })}</p></div> },
    { key: 'a', header: t('ops.analytics.h.attempts'), align: 'end', hideBelow: 'lg', cell: (h) => <span className="ltr">{num(h.attempts)}</span> },
    { key: 'd', header: <H k="delivered" label={t('ops.analytics.h.delivered')} />, align: 'end', cell: (h) => <span className="ltr font-semibold">{num(h.delivered)}</span> },
    { key: 'f', header: <H k="failedAttempts" label={t('ops.analytics.h.failed')} />, align: 'end', hideBelow: 'md', cell: (h) => <span className="ltr">{num(h.failedAttempts)}</span> },
    { key: 's', header: <H k="successRate" label={t('ops.analytics.h.success')} />, cell: (h) => <SuccessBar value={h.successRate} /> },
    { key: 'p', header: <H k="deliveriesPerActiveDay" label={t('ops.analytics.h.perDay')} />, align: 'end', hideBelow: 'lg', cell: (h) => <span className="ltr">{num(h.deliveriesPerActiveDay)}</span> },
    { key: 'c', header: <H k="codCollectedCents" label={t('ops.analytics.h.cod')} />, align: 'end', hideBelow: 'xl', cell: (h) => <span className="ltr text-sand-700 dark:text-sand-300">{money(h.codCollectedCents, { compact: true })}</span> },
    { key: 'e', header: <H k="earningsCents" label={t('ops.analytics.h.earnings')} />, align: 'end', hideBelow: 'xl', cell: (h) => <span className="ltr">{money(h.earningsCents)}</span> },
    { key: 'r', header: <H k="rating" label={t('ops.analytics.h.rating')} />, align: 'end', hideBelow: 'md', cell: (h) => <span className="ltr inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-sand-400 text-sand-400" />{num(Math.round(h.rating * 10) / 10)}</span> },
  ];
  return (
    <SectionCard title={t('ops.analytics.heroes')} padded={false} bodyClassName="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
      <DataTable columns={columns} rows={rows} rowKey={(h) => h.courierId} loading={loading} error={error} onRetry={onRetry} dense empty={t('ops.analytics.empty')}
        mobileCard={(h) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2"><p className="font-medium">{h.name}</p><SuccessBar value={h.successRate} /></div>
            <p className="text-xs text-ink-500">{t('ops.analytics.h.delivered')} <span className="ltr font-semibold">{num(h.delivered)}</span> · {t('ops.analytics.h.failed')} <span className="ltr">{num(h.failedAttempts)}</span> · <span className="ltr">{money(h.codCollectedCents, { compact: true })}</span></p>
          </div>
        )}
      />
    </SectionCard>
  );
}
