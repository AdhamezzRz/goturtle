import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, CheckCircle2, Clock, Download, PackageSearch, Percent, Timer, TrendingUp, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, download } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/lib/hooks';
import { cairoToday, dateOnly, money, num, pct } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, CardHeader, DataTable, EmptyState, ErrorState, Input, Menu, PageHeader, ProgressBar, Skeleton, type Column } from '@/components/ui';
import { Money, nameOf, Segmented, Stat } from '../components/common';
import { axisProps, BarList, ChartTooltip, gridProps, Legend, SERIES } from '../components/charts';
import type { BrandOverview } from '../components/types';
import './i18n';

type ZoneRow = BrandOverview['byZone'][number];

export default function AnalyticsPage() {
  const { t, locale } = useI18n();
  const [f, setF] = useQueryState({ range: '30', from: '', to: '' });
  const from = f.range === 'custom' ? f.from || cairoToday(-29) : cairoToday(-(Number(f.range) - 1));
  const to = f.range === 'custom' ? f.to || cairoToday() : cairoToday();
  const q = useQuery({ queryKey: ['analytics', 'brand', from, to], queryFn: () => api<BrandOverview>('/analytics/brand/overview', { query: { from, to } }), placeholderData: keepPreviousData });
  const d = q.data;
  const k = d?.kpis;

  const daily = useMemo(
    () => (d?.daily ?? []).map((x) => ({ ...x, cod: x.codCollectedCents / 100, rate: x.delivered + x.failedAttempts > 0 ? Math.round((x.delivered / (x.delivered + x.failedAttempts)) * 1000) / 10 : null })),
    [d],
  );
  const dayFmt = (l: string) => dateOnly(l + 'T12:00:00Z');
  const tick = (s: string) => (daily.length > 45 ? s.slice(5) : s.slice(8));

  const exportReport = (report: string) => download(`/analytics/export/${report}`, `goturtle-${report}-${from}_${to}.csv`, { from, to }).then(() => toast.success(t('brand.orders.exported'))).catch((e) => toast.error(errorMessage(e)));

  const zoneCols: Column<ZoneRow>[] = [
    { key: 'z', header: t('common.zone'), cell: (z) => <span className="font-medium text-ink-800 dark:text-ink-100">{nameOf(z, locale)}</span> },
    { key: 'c', header: t('brand.an.created'), align: 'end', cell: (z) => num(z.created) },
    { key: 'd', header: t('brand.an.delivered'), align: 'end', cell: (z) => num(z.delivered) },
    { key: 'r', header: t('brand.an.returned'), align: 'end', hideBelow: 'md', cell: (z) => num(z.returned) },
    {
      key: 's',
      header: t('brand.dash.kSuccess'),
      cell: (z) => (
        <div className="flex min-w-[120px] items-center gap-2">
          <ProgressBar value={z.successRate} tone={z.successRate < 0.7 ? 'red' : z.successRate < 0.85 ? 'sand' : 'turtle'} className="h-1.5" />
          <span className="tabular w-12 text-end text-xs font-semibold">{pct(z.successRate, 0)}</span>
        </div>
      ),
    },
    { key: 'cod', header: t('brand.dash.kCod'), align: 'end', hideBelow: 'lg', cell: (z) => <Money cents={z.codCollectedCents} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('brand.nav.analytics')}
        subtitle={d ? `${dayFmt(d.range.from)} – ${dayFmt(d.range.to)}` : t('brand.an.subtitle')}
        actions={
          <Menu
            trigger={<Button variant="outline" icon={<Download className="h-4 w-4" />}>{t('action.export')}</Button>}
            items={[
              { label: t('brand.an.exportDaily'), onClick: () => exportReport('daily') },
              { label: t('brand.an.exportZones'), onClick: () => exportReport('zones') },
              { label: t('brand.an.exportReasons'), onClick: () => exportReport('failure-reasons') },
            ]}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label={t('brand.an.range')} value={f.range} onChange={(v) => setF({ range: v })} options={[{ value: '7', label: t('brand.wallet.lastN', { n: num(7) }) }, { value: '30', label: t('brand.wallet.lastN', { n: num(30) }) }, { value: '90', label: t('brand.wallet.lastN', { n: num(90) }) }, { value: 'custom', label: t('brand.an.custom') }]} />
        {f.range === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label={t('common.from')} value={from} max={to} onChange={(e) => setF({ from: e.target.value })} className="w-[150px]" />
            <span className="text-ink-400">–</span>
            <Input type="date" aria-label={t('common.to')} value={to} min={from} max={cairoToday()} onChange={(e) => setF({ to: e.target.value })} className="w-[150px]" />
          </div>
        )}
      </div>

      {q.isError && <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>}

      <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5', q.isFetching && !q.isLoading && 'opacity-70 transition-opacity')}>
        <Stat loading={q.isLoading} icon={<PackageSearch />} tone="sky" label={t('brand.an.kOrders')} value={num(k?.ordersCreated)} hint={k ? <span>{t('brand.an.booked')} <Money cents={k.codBookedCents} compact /></span> : undefined} />
        <Stat loading={q.isLoading} icon={<CheckCircle2 />} label={t('brand.dash.kDelivered')} value={num(k?.delivered)} />
        <Stat loading={q.isLoading} icon={<Percent />} tone="violet" label={t('brand.dash.kSuccess')} value={k ? pct(k.successRate) : '—'} hint={k ? t('brand.dash.kFirstAttempt', { v: pct(k.firstAttemptSuccessRate) }) : undefined} />
        <Stat loading={q.isLoading} icon={<Timer />} tone="ink" label={t('brand.an.avgTime')} value={k?.avgHoursToDeliver != null ? t('brand.an.hours', { n: num(k.avgHoursToDeliver) }) : '—'} hint={k ? t('brand.an.onTime', { v: pct(k.onTimeRate) }) : undefined} />
        <Stat loading={q.isLoading} icon={<Banknote />} tone="sand" label={t('brand.dash.kCod')} value={<Money cents={k?.codCollectedCents} />} hint={k ? <span>{t('brand.an.netAfterFees')} <Money cents={k.netCodCents} compact /></span> : undefined} />
        <Stat loading={q.isLoading} icon={<XCircle />} tone="red" label={t('brand.an.failedAttempts')} value={num(k?.failedAttempts)} />
        <Stat loading={q.isLoading} icon={<Undo2 />} tone="violet" label={t('brand.an.returned')} value={num(k?.returned)} hint={k ? t('brand.an.cancelledN', { n: num(k.cancelled) }) : undefined} />
        <Stat loading={q.isLoading} icon={<TrendingUp />} tone="ink" label={t('brand.an.fees')} value={<Money cents={k?.feesCents} />} hint={k ? <span>{t('brand.an.exVat')} <Money cents={k.feesExVatCents} compact /></span> : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <ChartCard title={t('brand.an.volume')} subtitle={t('brand.an.volumeSub')} loading={q.isLoading} empty={!daily.some((x) => x.created || x.delivered)} legend={<Legend items={[{ color: SERIES.created, label: t('brand.an.created') }, { color: SERIES.delivered, label: t('brand.an.delivered') }, { color: SERIES.returned, label: t('brand.an.returned') }]} />}>
          <BarChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={tick} minTickGap={12} />
            <YAxis {...axisProps} allowDecimals={false} width={40} />
            <Tooltip content={<ChartTooltip labelFormat={dayFmt} />} cursor={{ fill: 'currentColor', fillOpacity: 0.05 }} />
            <Bar dataKey="created" name={t('brand.an.created')} fill={SERIES.created} radius={[4, 4, 0, 0]} maxBarSize={14} />
            <Bar dataKey="delivered" name={t('brand.an.delivered')} fill={SERIES.delivered} radius={[4, 4, 0, 0]} maxBarSize={14} />
            <Bar dataKey="returned" name={t('brand.an.returned')} fill={SERIES.returned} radius={[4, 4, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ChartCard>

        <ChartCard title={t('brand.an.successTrend')} subtitle={t('brand.an.successTrendSub')} loading={q.isLoading} empty={!daily.some((x) => x.rate !== null)}>
          <LineChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={tick} minTickGap={12} />
            <YAxis {...axisProps} domain={[0, 100]} width={44} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip content={<ChartTooltip labelFormat={dayFmt} format={(v) => `${v}%`} />} cursor={{ stroke: '#8592ab', strokeDasharray: '3 3' }} />
            <Line type="monotone" dataKey="rate" name={t('brand.dash.kSuccess')} stroke={SERIES.delivered} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
          </LineChart>
        </ChartCard>

        <ChartCard title={t('brand.an.codTrend')} subtitle={k ? <span>{t('brand.an.total')} <Money cents={k.codCollectedCents} /></span> : undefined} loading={q.isLoading} empty={!daily.some((x) => x.cod)}>
          <AreaChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs><linearGradient id="gCod" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SERIES.failed} stopOpacity={0.25} /><stop offset="100%" stopColor={SERIES.failed} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={tick} minTickGap={12} />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => money(v * 100, { compact: true })} />
            <Tooltip content={<ChartTooltip labelFormat={dayFmt} format={(v) => money(v * 100)} />} cursor={{ stroke: '#8592ab', strokeDasharray: '3 3' }} />
            <Area type="monotone" dataKey="cod" name={t('brand.dash.kCod')} stroke={SERIES.failed} strokeWidth={2} fill="url(#gCod)" activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
          </AreaChart>
        </ChartCard>

        <Card>
          <CardHeader title={t('brand.an.reasons')} subtitle={k ? t('brand.an.reasonsSub', { n: num(k.failedAttempts) }) : undefined} />
          {q.isLoading ? (
            <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : !d?.failureReasons.length ? (
            <EmptyState icon={<CheckCircle2 className="h-7 w-7 text-turtle-500" />} title={t('brand.an.noFailures')} />
          ) : (
            <BarList items={d.failureReasons.map((r) => ({ key: r.reason, label: t(`brand.reason.${r.reason}`), value: r.count, color: SERIES.failed }))} format={(v) => `${num(v)} · ${pct(v / Math.max(1, k?.failedAttempts ?? 1), 0)}`} />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5 [&>*]:min-w-0">
        <div className="xl:col-span-3">
          <h2 className="mb-3 font-semibold text-ink-900 dark:text-white">{t('brand.an.zones')}</h2>
          <DataTable
            columns={zoneCols}
            rows={d ? [...d.byZone].sort((a, b) => b.created - a.created) : undefined}
            rowKey={(z) => z.zoneId}
            loading={q.isLoading}
            dense
            empty={t('common.empty')}
            mobileCard={(z) => (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{nameOf(z, locale)}</span>
                  <span className="text-xs text-ink-500">{num(z.delivered)}/{num(z.created)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <ProgressBar value={z.successRate} tone={z.successRate < 0.7 ? 'red' : z.successRate < 0.85 ? 'sand' : 'turtle'} className="h-1.5" />
                  <span className="tabular w-10 text-end text-xs font-semibold">{pct(z.successRate, 0)}</span>
                </div>
              </div>
            )}
          />
        </div>
        <Card className="xl:col-span-2">
          <CardHeader title={t('brand.an.heatmap')} subtitle={t('brand.an.heatmapSub')} />
          {q.isLoading ? <Skeleton className="h-56 w-full" /> : d ? <Heatmap values={d.heatmap.values} /> : null}
        </Card>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, legend, loading, empty, children }: { title: string; subtitle?: React.ReactNode; legend?: React.ReactNode; loading: boolean; empty: boolean; children: React.ReactElement }) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {legend && <div className="mb-3">{legend}</div>}
      {loading ? (
        <Skeleton className="h-60 w-full" />
      ) : empty ? (
        <EmptyState className="h-60 py-0" icon={<Clock className="h-7 w-7" />} title={t('brand.an.noData')} />
      ) : (
        <div className="h-60 text-ink-900 dark:text-ink-100" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/** Deliveries by weekday × hour (Cairo) — when your customers actually receive parcels. */
function Heatmap({ values }: { values: number[][] }) {
  const { locale, t } = useI18n();
  const max = Math.max(1, ...values.flat());
  const hours = Array.from({ length: 15 }, (_, i) => i + 8); // 08:00 – 22:00
  const days = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short' }).format(new Date(Date.UTC(2026, 10, 1 + i))));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th />
              {hours.map((h) => <th key={h} className="text-[10px] font-normal text-ink-400">{h % 3 === 2 ? <span className="ltr">{h}</span> : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {days.map((label, di) => (
              <tr key={di}>
                <th className="whitespace-nowrap pe-1 text-start text-[11px] font-medium text-ink-500">{label}</th>
                {hours.map((h) => {
                  const v = values[di]?.[h] ?? 0;
                  const a = v === 0 ? 0 : 0.25 + 0.75 * (v / max);
                  return (
                    <td key={h} title={`${label} ${h}:00 · ${v}`} className="h-6 min-w-[14px] rounded-[4px] bg-ink-100 dark:bg-ink-800" style={a ? { background: `rgba(0, 128, 76, ${a.toFixed(2)})` } : undefined} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1 text-[11px] text-ink-500">
        {t('brand.an.less')}
        {[0.25, 0.45, 0.65, 0.85, 1].map((a) => <span key={a} className="h-3 w-3 rounded-sm" style={{ background: `rgba(0, 128, 76, ${a})` }} />)}
        {t('brand.an.more')}
      </div>
    </div>
  );
}
