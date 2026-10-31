import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, ArrowUpRight, Banknote, CalendarClock, CheckCircle2, PackagePlus, PackageSearch, Percent, Truck, Upload, Wallet, Boxes,
} from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { usePollInterval } from '@/lib/hooks';
import { ago, cairoToday, dateOnly, num, pct } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, StatusBadge } from '@/components/ui';
import { Money, nameOf, Stat, useCanCreate } from '../components/common';
import { OrderMobileCard, RequestPickupModal } from '../components/orders';
import { axisProps, BarList, ChartTooltip, gridProps, Legend, SERIES } from '../components/charts';
import type { BrandOverview, FinanceSummary, OrderCounts, OrderRow } from '../components/types';
import './i18n';

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { me, can } = useAuth();
  const navigate = useNavigate();
  const poll = usePollInterval(60_000);
  const create = useCanCreate();
  const [pickupOpen, setPickupOpen] = useState(false);
  const monthStart = cairoToday().slice(0, 8) + '01';

  const overview = useQuery({ queryKey: ['analytics', 'brand', 'overview', '30d'], queryFn: () => api<BrandOverview>('/analytics/brand/overview'), enabled: can('analytics.read'), refetchInterval: poll });
  const month = useQuery({ queryKey: ['orders', 'counts', { from: monthStart }], queryFn: () => api<OrderCounts>('/orders/counts', { query: { from: monthStart } }), refetchInterval: poll });
  const all = useQuery({ queryKey: ['orders', 'counts', {}], queryFn: () => api<OrderCounts>('/orders/counts'), refetchInterval: poll });
  const finance = useQuery({ queryKey: ['finance', 'summary'], queryFn: () => api<FinanceSummary>('/finance/brand/summary'), enabled: can('finance.read') });
  const recent = useQuery({ queryKey: ['orders', 'recent'], queryFn: () => api<Paginated<OrderRow>>('/orders', { query: { pageSize: 6 } }), refetchInterval: poll });
  const attention = useQuery({
    queryKey: ['orders', 'attention'],
    queryFn: () => api<Paginated<OrderRow>>('/orders', { query: { status: 'FAILED_ATTEMPT,RESCHEDULED,ON_HOLD', pageSize: 5, sort: 'updatedAt' } }),
    refetchInterval: poll,
  });

  const k = overview.data?.kpis;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? t('brand.dash.morning') : hour < 18 ? t('brand.dash.afternoon') : t('brand.dash.evening');
  const firstName = me?.name.split(' ')[0] ?? '';
  const groups = all.data?.groups;

  const quick = [
    { to: '/brand/orders/new', icon: <PackagePlus />, label: t('brand.nav.newOrder'), hint: t('brand.dash.qNew'), primary: true, needsCreate: true },
    { to: '/brand/orders/bulk', icon: <Upload />, label: t('brand.nav.bulk'), hint: t('brand.dash.qBulk'), needsCreate: true },
    { onClick: () => setPickupOpen(true), icon: <Truck />, label: t('brand.pickups.request'), hint: t('brand.dash.qPickup'), needsCreate: true, hidden: !can('pickups.manage') },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-turtle-700 via-turtle-800 to-ink-950 px-5 py-6 text-white shadow-card sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-turtle-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 end-1/3 h-48 w-48 rounded-full bg-sand-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-turtle-100/80">{greeting}</p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">{t('brand.dash.welcome', { name: firstName })}</h1>
            <p className="mt-2 max-w-xl text-sm text-turtle-50/80">
              {groups ? t('brand.dash.summary', { transit: num(groups.inTransit), fresh: num(groups.new) }) : t('brand.dash.tagline')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {quick.filter((q) => !q.hidden).map((q, i) => {
              const disabled = q.needsCreate && !create.allowed;
              const cls = cn(
                'inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition [&>svg]:h-4 [&>svg]:w-4',
                q.primary ? 'bg-white text-turtle-800 hover:bg-turtle-50' : 'bg-white/10 text-white ring-1 ring-inset ring-white/20 hover:bg-white/20',
                disabled && 'pointer-events-none opacity-50',
              );
              return q.to ? (
                <Link key={i} to={q.to} className={cls} aria-disabled={disabled} tabIndex={disabled ? -1 : undefined} title={disabled ? create.reason : q.hint}>
                  {q.icon}
                  {q.label}
                </Link>
              ) : (
                <button key={i} type="button" onClick={q.onClick} className={cls} disabled={disabled} title={disabled ? create.reason : q.hint}>
                  {q.icon}
                  {q.label}
                </button>
              );
            })}
          </div>
        </div>
        {!create.allowed && <p className="relative mt-4 rounded-xl bg-white/10 px-3 py-2 text-xs text-turtle-50">{create.reason}</p>}
      </section>

      {all.data?.total === 0 && (
        <Card>
          <CardHeader title={t('brand.dash.startTitle')} subtitle={t('brand.dash.startHint')} />
          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { to: '/brand/settings?tab=locations', k: 'location' },
              { to: '/brand/settings?tab=payout', k: 'payout' },
              { to: '/brand/orders/new', k: 'order' },
              { to: '/brand/developers?tab=stores', k: 'store' },
            ].map((s, i) => (
              <li key={s.k}>
                <Link to={s.to} className="flex h-full items-start gap-3 rounded-2xl border border-ink-100 p-4 transition hover:border-turtle-300 hover:bg-turtle-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-turtle-600 text-sm font-bold text-white">{num(i + 1)}</span>
                  <span>
                    <span className="block text-sm font-semibold text-ink-900 dark:text-white">{t(`brand.dash.start.${s.k}`)}</span>
                    <span className="block text-xs text-ink-500">{t(`brand.dash.start.${s.k}Hint`)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat loading={month.isLoading} icon={<PackageSearch />} tone="sky" label={t('brand.dash.kOrdersMonth')} value={num(month.data?.total)} hint={t('brand.dash.kSince', { date: dateOnly(monthStart + 'T12:00:00Z') })} />
        <Stat loading={overview.isLoading} icon={<CheckCircle2 />} label={t('brand.dash.kDelivered')} value={num(k?.delivered)} hint={t('common.last30')} />
        <Stat loading={overview.isLoading} icon={<Percent />} tone="violet" label={t('brand.dash.kSuccess')} value={k ? pct(k.successRate) : '—'} hint={k ? t('brand.dash.kFirstAttempt', { v: pct(k.firstAttemptSuccessRate) }) : undefined} />
        <Stat loading={all.isLoading} icon={<Truck />} tone="ink" label={t('brand.dash.kTransit')} value={num(groups?.inTransit)} hint={t('brand.dash.kOut', { n: num(all.data?.byStatus.OUT_FOR_DELIVERY) })} />
        <Stat loading={overview.isLoading} icon={<Banknote />} tone="sand" label={t('brand.dash.kCod')} value={<Money cents={k?.codCollectedCents} />} hint={t('common.last30')} />
        {can('finance.read') && (
          <>
            <Stat loading={finance.isLoading} icon={<Wallet />} label={t('brand.dash.kPayout')} value={<Money cents={finance.data?.walletBalanceCents} />} hint={finance.data?.pendingCodCents ? <span>{t('brand.wallet.pendingCod')}: <Money cents={finance.data.pendingCodCents} /></span> : t('brand.dash.kPayoutHint')} />
            <Stat loading={finance.isLoading} icon={<CalendarClock />} tone="sky" label={t('brand.dash.kNext')} value={finance.data?.nextSettlementDate ? dateOnly(finance.data.nextSettlementDate + 'T12:00:00Z') : '—'} hint={finance.data ? t(`brand.cycle.${finance.data.settlementCycle}`) : undefined} />
          </>
        )}
        <Stat loading={all.isLoading} icon={<AlertTriangle />} tone="red" label={t('brand.dash.kAttention')} value={num(attention.data?.meta.total)} hint={t('brand.dash.kAttentionHint')} className={can('finance.read') ? '' : 'lg:col-span-1'} />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* 30-day chart */}
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('brand.dash.chart')}
            subtitle={overview.data ? `${dateOnly(overview.data.range.from + 'T12:00:00Z')} – ${dateOnly(overview.data.range.to + 'T12:00:00Z')}` : undefined}
            actions={<Link to="/brand/analytics" className="inline-flex items-center gap-1 text-sm font-medium text-turtle-700 hover:underline dark:text-turtle-400">{t('brand.dash.moreAnalytics')}<ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" /></Link>}
          />
          <Legend className="mb-3" items={[{ color: SERIES.created, label: t('brand.an.created') }, { color: SERIES.delivered, label: t('brand.an.delivered') }]} />
          {overview.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : overview.isError ? (
            <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
          ) : (
            <div className="h-64 text-ink-900 dark:text-ink-100" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={overview.data?.daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SERIES.created} stopOpacity={0.18} /><stop offset="100%" stopColor={SERIES.created} stopOpacity={0} /></linearGradient>
                    <linearGradient id="gDelivered" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SERIES.delivered} stopOpacity={0.25} /><stop offset="100%" stopColor={SERIES.delivered} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => d.slice(8)} minTickGap={16} />
                  <YAxis {...axisProps} allowDecimals={false} width={40} />
                  <Tooltip content={<ChartTooltip labelFormat={(l) => dateOnly(l + 'T12:00:00Z')} />} cursor={{ stroke: '#8592ab', strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="created" name={t('brand.an.created')} stroke={SERIES.created} strokeWidth={2} fill="url(#gCreated)" activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                  <Area type="monotone" dataKey="delivered" name={t('brand.an.delivered')} stroke={SERIES.delivered} strokeWidth={2} fill="url(#gDelivered)" activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Status breakdown */}
        <Card>
          <CardHeader title={t('brand.dash.breakdown')} subtitle={t('brand.dash.breakdownSub', { n: num(all.data?.total) })} />
          {all.isLoading ? (
            <div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : all.isError ? (
            <ErrorState error={all.error} onRetry={() => all.refetch()} />
          ) : (
            <BarList
              format={num}
              items={(['new', 'inTransit', 'delivered', 'returns', 'closed'] as const).map((g) => ({
                key: g,
                label: (
                  <Link to={`/brand/orders?tab=${g}`} className="hover:underline">
                    {t(`brand.orders.tab.${g}`)}
                  </Link>
                ),
                value: groups?.[g] ?? 0,
                color: { new: '#8592ab', inTransit: SERIES.created, delivered: SERIES.delivered, returns: SERIES.returned, closed: '#b0b8c9' }[g],
              }))}
            />
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Recent orders */}
        <Card className="xl:col-span-3" padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title={t('brand.dash.recent')} actions={<Link to="/brand/orders" className="text-sm font-medium text-turtle-700 hover:underline dark:text-turtle-400">{t('brand.dash.viewAll')}</Link>} />
          </div>
          {recent.isLoading ? (
            <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : recent.isError ? (
            <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
          ) : !recent.data?.data.length ? (
            <EmptyState
              icon={<PackagePlus className="h-7 w-7" />}
              title={t('brand.dash.noOrders')}
              description={t('brand.dash.noOrdersHint')}
              action={create.allowed && <Link to="/brand/orders/new"><Button icon={<PackagePlus className="h-4 w-4" />}>{t('brand.nav.newOrder')}</Button></Link>}
            />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {recent.data.data.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => navigate(`/brand/orders/${o.id}`)} className="block w-full px-5 py-3 text-start transition hover:bg-ink-50 focus-visible:bg-ink-50 dark:hover:bg-ink-800/60">
                    <div className="sm:hidden"><OrderMobileCard o={o} /></div>
                    <div className="hidden items-center gap-4 sm:flex">
                      <div className="min-w-0 flex-1">
                        <p><span className="ltr font-mono text-sm font-semibold text-ink-900 dark:text-white">{o.trackingNumber}</span></p>
                        <p className="truncate text-xs text-ink-500">{o.recipientName} · {nameOf(o.zone, locale)}</p>
                      </div>
                      <Money cents={o.collectCents} className="text-sm font-semibold" />
                      <span className="w-40 text-end"><StatusBadge status={o.status} /></span>
                      <span className="hidden w-24 text-end text-xs text-ink-400 md:block">{ago(o.createdAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Needs action */}
        <Card className="xl:col-span-2" padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title={t('brand.dash.attention')} subtitle={t('brand.dash.attentionSub')} />
          </div>
          {attention.isLoading ? (
            <div className="space-y-3 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : attention.isError ? (
            <ErrorState error={attention.error} onRetry={() => attention.refetch()} />
          ) : !attention.data?.data.length ? (
            <EmptyState icon={<CheckCircle2 className="h-7 w-7 text-turtle-500" />} title={t('brand.dash.allGood')} description={t('brand.dash.allGoodHint')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {attention.data.data.map((o) => (
                <li key={o.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link to={`/brand/orders/${o.id}`} className="ltr font-mono text-sm font-semibold text-ink-900 hover:underline dark:text-white">{o.trackingNumber}</Link>
                      <StatusBadge status={o.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {o.recipientName} · {t('brand.orders.attemptsOf', { n: num(o.attempts), max: num(o.maxAttempts) })} · {ago(o.updatedAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link to={`/brand/orders/${o.id}`}><Button size="xs" variant="outline">{t('brand.dash.review')}</Button></Link>
                      <a href={`tel:${o.recipientPhone}`}><Button size="xs" variant="ghost">{t('brand.dash.callCustomer')}</Button></a>
                    </div>
                  </div>
                </li>
              ))}
              {attention.data.meta.total > attention.data.data.length && (
                <li className="px-5 py-3 text-center">
                  <Link to="/brand/orders?status=FAILED_ATTEMPT,RESCHEDULED,ON_HOLD" className="text-sm font-medium text-turtle-700 hover:underline dark:text-turtle-400">
                    {t('brand.dash.viewAllN', { n: num(attention.data.meta.total) })}
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>

      {can('pickups.manage') && (
        <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"><Boxes className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-900 dark:text-white">{t('brand.dash.pickupTitle', { n: num(groups?.new) })}</p>
            <p className="text-sm text-ink-500">{t('brand.dash.pickupHint')}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/brand/pickups"><Button variant="outline">{t('brand.nav.pickups')}</Button></Link>
            <Button disabled={!create.allowed} onClick={() => setPickupOpen(true)} icon={<Truck className="h-4 w-4" />}>{t('brand.pickups.request')}</Button>
          </div>
        </Card>
      )}

      <RequestPickupModal open={pickupOpen} onClose={() => setPickupOpen(false)} />
    </div>
  );
}
