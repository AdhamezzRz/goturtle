import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueries } from '@tanstack/react-query';
import { AlertOctagon, ArrowDownRight, Banknote, BadgeCheck, Building2, Coins, FileSpreadsheet, Landmark, Percent, Receipt, Scale, Search, TrendingUp, Users, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { cairoToday, dateOnly, dateTime, money, num, pct } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useDebounced, useQueryState } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Skeleton, Switch, Tabs, type Column } from '@/components/ui';
import { InfoRow, Money, Notice, RequirePermission, Section, Stat, StatGrid, addDaysStr, monthEnd, monthStart, useEnumLabel } from '@/portals/ops/components/opsb';
import { CHART, MoneyBars } from '@/portals/ops/components/opsb/charts';
import './i18n';
import '../cash/i18n';

type Line = { code: string; name: string; amountCents: number };
type CashPosition = {
  asOf: string;
  assets: { treasuryCents: number; bankCents: number; paymentGatewayCents: number; liquidCents: number; heroCustodyCents: number; brandReceivablesCents: number; heroReceivablesCents: number };
  liabilities: { brandPayablesCents: number; heroPayablesCents: number; vatPayableCents: number; totalCents: number };
  netPositionCents: number;
  liquidityGapCents: number;
  pipeline: { pendingHandovers: { count: number; declaredCents: number }; openSettlements: { count: number; netPayableCents: number }; openPayouts: { count: number; netCents: number } };
  counts: { heroesHoldingCash: number; brandWallets: number; heroPayables: number };
};
type Pnl = {
  from: string; to: string;
  revenue: { lines: Line[]; totalCents: number };
  expenses: { lines: Line[]; heroPayCents: number; otherCents: number; totalCents: number };
  grossMarginCents: number; grossMarginPct: number; netIncomeCents: number; netMarginPct: number; vatCollectedCents: number;
  volume: { deliveredOrders: number; returnedOrders: number; finalOrders: number; codCollectedCents: number };
  unitEconomics: { revenuePerOrderCents: number; heroCostPerOrderCents: number; otherCostPerOrderCents: number; contributionPerOrderCents: number; netPerOrderCents: number };
};
type TbAccount = { accountId: string; code: string; name: string; type: string; balanceCents: number; debits: number; credits: number; normalSide: string; owner: { kind: string; id: string; code: string; name: string } | null };
type TrialBalance = {
  asOf: string; balanced: boolean; totalDebits: number; totalCredits: number;
  equation: { assetsPlusExpenses: number; liabilitiesEquityRevenue: number; balanced: boolean };
  byType: Record<string, { debits: number; credits: number; balanceCents: number }>;
  accounts: TbAccount[];
};
type StatementLine = { id: string; createdAt: string; debitCents: number; creditCents: number; transactionId: string; kind: string; reference: string | null; description: string | null; orderId: string | null; trackingNumber: string | null; amountCents: number; balanceCents: number };
type Statement = {
  account: { id: string; code: string; name: string; type: string; brandId: string | null; courierId: string | null; balanceCents: number };
  from: string; to: string; openingBalanceCents: number; closingBalanceCents: number; totals: { debitsCents: number; creditsCents: number };
  data: StatementLine[]; meta: { page: number; pageSize: number; total: number; totalPages: number };
};
type Daily = {
  date: string;
  orders: { delivered: number; returned: number; failedAttempts: number; codCollectedCents: number };
  revenue: { lines: Line[]; totalCents: number };
  expenses: { lines: Line[]; totalCents: number };
  netIncomeCents: number; vatCents: number;
  cash: { handoversConfirmed: number; receivedCents: number; varianceCents: number };
  settlementsPaid: { count: number; amountCents: number };
  payoutsPaid: { count: number; amountCents: number };
  ledgerByKind: Record<string, { transactions: number; amountCents: number }>;
};

/** Account names come from the chart of accounts (English); translate the well-known codes. */
const ACCOUNT_AR: Record<string, string> = {
  '1000': 'الخزينة النقدية (المخازن والخزنة)', '1010': 'البنك والمحافظ الإلكترونية', '1020': 'حساب وسيط بوابة الدفع', '1100': 'عهدة نقدية المندوب',
  '2100': 'محفظة التاجر (مستحقات التحصيل)', '2200': 'مستحقات المندوب', '2300': 'ضريبة القيمة المضافة المستحقة (١٤٪)', '3000': 'حقوق الملكية',
  '4000': 'إيرادات الشحن', '4010': 'إيرادات رسوم التحصيل', '4020': 'إيرادات رسوم المرتجعات', '4900': 'إيرادات أخرى (جزاءات)',
  '5000': 'أجور المناديب', '5100': 'مصروفات التشغيل', '5200': 'فروق النقدية والشطب',
};
export function useAccountName() {
  const { locale } = useI18n();
  return (code: string, name: string) => (locale === 'ar' ? ACCOUNT_AR[code.split(':')[0]] ?? name : name);
}

export default function FinancePage() {
  return (
    <RequirePermission permission="finance.read">
      <FinanceInner />
    </RequirePermission>
  );
}

function FinanceInner() {
  const { t } = useI18n();
  const [s, setS] = useQueryState({ tab: 'position', account: '' });
  return (
    <div>
      <PageHeader
        title={t('ops.finance.title')}
        subtitle={t('ops.finance.subtitle')}
        actions={
          <>
            <Link to="/ops/finance/settlements"><Button variant="outline" icon={<Receipt className="h-4 w-4" />}>{t('ops.nav.settlements')}</Button></Link>
            <Link to="/ops/finance/payouts"><Button variant="outline" icon={<Users className="h-4 w-4" />}>{t('ops.nav.payouts')}</Button></Link>
          </>
        }
      />
      <Tabs
        className="mb-5"
        value={s.tab}
        onChange={(v) => setS({ tab: v })}
        tabs={[
          { value: 'position', label: t('ops.finance.tab.position') },
          { value: 'pnl', label: t('ops.finance.tab.pnl') },
          { value: 'daily', label: t('ops.finance.tab.daily') },
          { value: 'tb', label: t('ops.finance.tab.tb') },
          { value: 'statement', label: t('ops.finance.tab.statement') },
        ]}
      />
      {s.tab === 'position' && <Position />}
      {s.tab === 'pnl' && <PnlView />}
      {s.tab === 'daily' && <DailyView />}
      {s.tab === 'tb' && <TrialBalanceView onAccount={(code) => setS({ tab: 'statement', account: code })} />}
      {s.tab === 'statement' && <StatementView />}
    </div>
  );
}

/* ───────────────────────────── Cash position ───────────────────────────── */

function Position() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['finance', 'cash-position'], queryFn: () => api<CashPosition>('/finance/cash-position'), refetchInterval: 60_000 });
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  const l = q.isLoading;
  return (
    <div className="space-y-5">
      {d && <p className="text-xs text-ink-500">{t('ops.finance.pos.asOf', { date: dateTime(d.asOf) })}</p>}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink-500">{t('ops.finance.pos.assets')}</h2>
        <StatGrid cols={3}>
          <Stat icon={<Banknote />} label={t('ops.finance.pos.treasury')} value={<Money cents={d?.assets.treasuryCents} />} hint={t('ops.finance.pos.treasuryHint')} loading={l} />
          <Stat icon={<Landmark />} tone="sky" label={t('ops.finance.pos.bank')} value={<Money cents={d?.assets.bankCents} tone="auto" />} loading={l} />
          <Stat icon={<Wallet />} tone="sand" label={t('ops.finance.pos.custody')} value={<Money cents={d?.assets.heroCustodyCents} />} hint={d ? t('ops.finance.pos.custodyHint', { n: num(d.counts.heroesHoldingCash) }) : undefined} loading={l} />
        </StatGrid>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink-500">{t('ops.finance.pos.liabilities')}</h2>
        <StatGrid cols={3}>
          <Stat icon={<Building2 />} tone="violet" label={t('ops.finance.pos.brandPayables')} value={<Money cents={d?.liabilities.brandPayablesCents} />} hint={d ? t('ops.finance.pos.brandHint', { n: num(d.counts.brandWallets) }) : undefined} loading={l} />
          <Stat icon={<Users />} tone="ink" label={t('ops.finance.pos.heroPayables')} value={<Money cents={d?.liabilities.heroPayablesCents} />} loading={l} />
          <Stat icon={<Percent />} tone="red" label={t('ops.finance.pos.vat')} value={<Money cents={d?.liabilities.vatPayableCents} />} loading={l} />
        </StatGrid>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t('ops.finance.pos.net')}>
          {l || !d ? <Skeleton className="h-32" /> : (
            <>
              <p className={cn('mb-3 font-display text-3xl font-bold', d.netPositionCents < 0 ? 'text-red-600' : 'text-ink-900 dark:text-white')}><Money cents={d.netPositionCents} /></p>
              <InfoRow label={t('ops.finance.pos.liquid')} value={<Money cents={d.assets.liquidCents} />} />
              <InfoRow label={t('ops.finance.pos.custody')} value={<Money cents={d.assets.heroCustodyCents} />} />
              <InfoRow label={t('ops.finance.pos.liabilities')} value={<Money cents={-d.liabilities.totalCents} tone="auto" />} />
              <InfoRow label={t('ops.finance.pos.gap')} value={<Money cents={d.liquidityGapCents} tone="auto" className="font-semibold" />} strong />
            </>
          )}
        </Section>
        <Section title={t('ops.finance.pos.pipeline')}>
          {l || !d ? <Skeleton className="h-32" /> : (
            <ul className="space-y-3">
              {[
                { to: '/ops/cash?tab=handovers', icon: <Coins className="h-4 w-4" />, label: t('ops.finance.pos.pendingHandovers'), n: d.pipeline.pendingHandovers.count, c: d.pipeline.pendingHandovers.declaredCents },
                { to: '/ops/finance/settlements', icon: <Receipt className="h-4 w-4" />, label: t('ops.finance.pos.openSettlements'), n: d.pipeline.openSettlements.count, c: d.pipeline.openSettlements.netPayableCents },
                { to: '/ops/finance/payouts', icon: <Users className="h-4 w-4" />, label: t('ops.finance.pos.openPayouts'), n: d.pipeline.openPayouts.count, c: d.pipeline.openPayouts.netCents },
              ].map((r) => (
                <li key={r.to}>
                  <Link to={r.to} className="flex items-center gap-3 rounded-xl border border-ink-100 p-3 transition hover:border-turtle-300 dark:border-ink-800">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300">{r.icon}</span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{r.label}</span><span className="text-xs text-ink-500">{t('ops.finance.pos.count', { n: num(r.n) })}</span></span>
                    <Money cents={r.c} className="font-semibold" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ───────────────────────────── Period picker ───────────────────────────── */

function usePeriod() {
  const today = cairoToday();
  const [s, setS] = useQueryState({ tab: 'pnl', from: monthStart(today), to: today });
  const presets = [
    { key: 'thisMonth', from: monthStart(today), to: today },
    { key: 'lastMonth', from: monthStart(addDaysStr(monthStart(today), -1)), to: monthEnd(addDaysStr(monthStart(today), -1)) },
    { key: 'last30', from: addDaysStr(today, -29), to: today },
  ];
  return { from: s.from, to: s.to, set: (from: string, to: string) => setS({ from, to }), presets };
}

function PeriodPicker({ p }: { p: ReturnType<typeof usePeriod> }) {
  const { t } = useI18n();
  const label = (k: string) => (k === 'last30' ? t('common.last30') : t(`ops.opsb.${k}`));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('ops.opsb.period')}>
        {p.presets.map((x) => {
          const on = x.from === p.from && x.to === p.to;
          return <Button key={x.key} size="sm" variant={on ? 'secondary' : 'outline'} aria-pressed={on} onClick={() => p.set(x.from, x.to)}>{label(x.key)}</Button>;
        })}
      </div>
      <div className="flex items-center gap-2">
        <Input type="date" value={p.from} max={p.to} onChange={(e) => e.target.value && p.set(e.target.value, p.to)} aria-label={t('common.from')} className="!w-40" />
        <span className="text-ink-400">–</span>
        <Input type="date" value={p.to} min={p.from} max={cairoToday()} onChange={(e) => e.target.value && p.set(p.from, e.target.value)} aria-label={t('common.to')} className="!w-40" />
      </div>
    </div>
  );
}

/* ───────────────────────────── P&L ───────────────────────────── */

function PnlView() {
  const { t } = useI18n();
  const an = useAccountName();
  const p = usePeriod();
  const q = useQuery({ queryKey: ['finance', 'pnl', p.from, p.to], queryFn: () => api<Pnl>('/finance/pnl', { query: { from: p.from, to: p.to } }), placeholderData: keepPreviousData });
  const d = q.data;
  const revChart = useMemo(() => (d?.revenue.lines ?? []).map((l) => ({ label: an(l.code, l.name), value: l.amountCents })), [d, an]);
  const flow = useMemo(() => d ? [
    { label: t('ops.finance.pnl.revenue'), value: d.revenue.totalCents, kind: 'rev' },
    { label: t('ops.finance.pnl.heroPay'), value: d.expenses.heroPayCents, kind: 'cost' },
    { label: t('ops.finance.pnl.otherPerOrder'), value: d.expenses.otherCents, kind: 'cost' },
    { label: t('ops.finance.pnl.net'), value: d.netIncomeCents, kind: 'rev' },
  ] : [], [d, t]);
  return (
    <div className="space-y-5">
      <PeriodPicker p={p} />
      {q.error ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <>
          <StatGrid>
            <Stat icon={<TrendingUp />} label={t('ops.finance.pnl.revenue')} value={<Money cents={d?.revenue.totalCents} compact />} loading={q.isLoading} />
            <Stat icon={<Users />} tone="sand" label={t('ops.finance.pnl.heroPay')} value={<Money cents={d?.expenses.heroPayCents} compact />} hint={d && d.revenue.totalCents ? t('ops.finance.pnl.ofRevenue', { pct: pct(d.expenses.heroPayCents / d.revenue.totalCents) }) : undefined} loading={q.isLoading} />
            <Stat icon={<BadgeCheck />} tone="sky" label={t('ops.finance.pnl.margin')} value={<Money cents={d?.grossMarginCents} compact />} hint={d ? pct(d.grossMarginPct / 100) : undefined} loading={q.isLoading} />
            <Stat icon={<Scale />} tone={d && d.netIncomeCents < 0 ? 'red' : 'violet'} label={t('ops.finance.pnl.net')} value={<Money cents={d?.netIncomeCents} compact />} hint={d ? pct(d.netMarginPct / 100) : undefined} loading={q.isLoading} />
          </StatGrid>
          <div className="grid gap-5 xl:grid-cols-2">
            <Section title={t('ops.finance.pnl.byAccount')}>
              {q.isLoading ? <Skeleton className="h-64" /> : <MoneyBars data={revChart} series={[{ key: 'value', name: t('ops.finance.pnl.revenue'), color: CHART.revenue }]} />}
            </Section>
            <Section title={t('ops.finance.pnl.waterfall')}>
              {q.isLoading ? <Skeleton className="h-64" /> : <MoneyBars data={flow} series={[{ key: 'value', name: t('common.amount'), color: CHART.revenue }]} colorBy={(r) => (r.kind === 'cost' ? CHART.cost : CHART.revenue)} />}
            </Section>
          </div>
          {d && (
            <div className="grid gap-5 xl:grid-cols-3">
              <Section title={t('ops.finance.pnl.table')} className="xl:col-span-2">
                <p className="mb-1 text-xs font-semibold uppercase text-ink-400">{t('ops.finance.pnl.revenue')}</p>
                {d.revenue.lines.map((l) => <InfoRow key={l.code} label={<span className="inline-flex items-center gap-2"><span className="ltr font-mono text-xs text-ink-400">{l.code}</span>{an(l.code, l.name)}</span>} value={<Money cents={l.amountCents} />} />)}
                <InfoRow label={t('common.total')} value={<Money cents={d.revenue.totalCents} />} strong />
                <p className="mb-1 mt-4 text-xs font-semibold uppercase text-ink-400">{t('ops.finance.pnl.expenses')}</p>
                {d.expenses.lines.map((l) => <InfoRow key={l.code} label={<span className="inline-flex items-center gap-2"><span className="ltr font-mono text-xs text-ink-400">{l.code}</span>{an(l.code, l.name)}</span>} value={<Money cents={-l.amountCents} tone={l.amountCents ? 'auto' : 'none'} />} />)}
                <InfoRow label={t('common.total')} value={<Money cents={-d.expenses.totalCents} tone="auto" />} strong />
                <InfoRow label={t('ops.finance.pnl.net')} value={<Money cents={d.netIncomeCents} tone="auto" className="text-base font-bold" />} strong />
                <InfoRow label={t('ops.finance.pnl.vat')} value={<Money cents={d.vatCollectedCents} />} />
              </Section>
              <div className="space-y-5">
                <Section title={t('ops.finance.pnl.volume')}>
                  <InfoRow label={t('ops.finance.pnl.delivered')} value={num(d.volume.deliveredOrders)} />
                  <InfoRow label={t('ops.finance.pnl.returned')} value={num(d.volume.returnedOrders)} />
                  <InfoRow label={t('ops.finance.pnl.final')} value={num(d.volume.finalOrders)} />
                  <InfoRow label={t('ops.finance.pnl.cod')} value={<Money cents={d.volume.codCollectedCents} />} />
                </Section>
                <Section title={t('ops.finance.pnl.unit')}>
                  <InfoRow label={t('ops.finance.pnl.revPerOrder')} value={<Money cents={d.unitEconomics.revenuePerOrderCents} />} />
                  <InfoRow label={t('ops.finance.pnl.heroPerOrder')} value={<Money cents={-d.unitEconomics.heroCostPerOrderCents} tone="auto" />} />
                  <InfoRow label={t('ops.finance.pnl.otherPerOrder')} value={<Money cents={-d.unitEconomics.otherCostPerOrderCents} tone={d.unitEconomics.otherCostPerOrderCents ? 'auto' : 'none'} />} />
                  <InfoRow label={t('ops.finance.pnl.contribution')} value={<Money cents={d.unitEconomics.contributionPerOrderCents} tone="auto" className="font-bold" />} strong />
                </Section>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Daily ───────────────────────────── */

function DailyView() {
  const { t } = useI18n();
  const en = useEnumLabel();
  const an = useAccountName();
  const [s, setS] = useQueryState({ tab: 'daily', date: cairoToday() });
  const q = useQuery({ queryKey: ['finance', 'daily', s.date], queryFn: () => api<Daily>('/finance/daily', { query: { date: s.date } }) });
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(s.date, i - 6)), [s.date]);
  const trend = useQueries({ queries: week.map((d) => ({ queryKey: ['finance', 'daily', d], queryFn: () => api<Daily>('/finance/daily', { query: { date: d } }), staleTime: 60_000 })) });
  const trendData = trend.every((x) => x.data)
    ? trend.map((x) => ({ label: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${x.data!.date}T12:00:00Z`)), revenue: x.data!.revenue.totalCents, cost: x.data!.expenses.totalCents }))
    : null;
  const d = q.data;
  return (
    <div className="space-y-5">
      <Field label={t('common.date')}>{(id) => <Input id={id} type="date" value={s.date} max={cairoToday()} onChange={(e) => e.target.value && setS({ date: e.target.value })} className="!w-44" />}</Field>
      {q.error ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <>
          <StatGrid>
            <Stat icon={<FileSpreadsheet />} label={t('ops.finance.d.orders')} value={num(d?.orders.delivered)} hint={d ? `${t('ops.finance.pnl.returned')} ${num(d.orders.returned)} · ${t('ops.finance.d.failed')} ${num(d.orders.failedAttempts)}` : undefined} loading={q.isLoading} />
            <Stat icon={<Coins />} tone="sand" label={t('ops.finance.pnl.cod')} value={<Money cents={d?.orders.codCollectedCents} compact />} loading={q.isLoading} />
            <Stat icon={<TrendingUp />} tone="sky" label={t('ops.finance.pnl.revenue')} value={<Money cents={d?.revenue.totalCents} compact />} loading={q.isLoading} />
            <Stat icon={<ArrowDownRight />} tone={d && d.netIncomeCents < 0 ? 'red' : 'violet'} label={t('ops.finance.pnl.net')} value={<Money cents={d?.netIncomeCents} compact />} loading={q.isLoading} />
          </StatGrid>
          <Section title={`${t('ops.finance.pnl.revenue')} / ${t('ops.finance.pnl.expenses')} · ${t('common.last7')}`}>
            {trendData ? <MoneyBars data={trendData} series={[{ key: 'revenue', name: t('ops.finance.pnl.revenue'), color: CHART.revenue }, { key: 'cost', name: t('ops.finance.pnl.expenses'), color: CHART.cost }]} /> : <Skeleton className="h-64" />}
          </Section>
          {d && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Section title={t('ops.finance.tab.daily')}>
                {d.revenue.lines.filter((l) => l.amountCents).map((l) => <InfoRow key={l.code} label={an(l.code, l.name)} value={<Money cents={l.amountCents} />} />)}
                {d.expenses.lines.filter((l) => l.amountCents).map((l) => <InfoRow key={l.code} label={an(l.code, l.name)} value={<Money cents={-l.amountCents} tone="auto" />} />)}
                <InfoRow label={t('ops.finance.pnl.net')} value={<Money cents={d.netIncomeCents} tone="auto" />} strong />
                <InfoRow label={t('ops.finance.pnl.vat')} value={<Money cents={d.vatCents} />} />
                <InfoRow label={t('ops.finance.d.cashReceived')} value={<span><Money cents={d.cash.receivedCents} /> <span className="text-xs text-ink-400">({num(d.cash.handoversConfirmed)})</span></span>} />
                <InfoRow label={t('ops.cash.variance')} value={<Money cents={d.cash.varianceCents} sign tone="auto" />} />
                <InfoRow label={t('ops.finance.d.settlementsPaid')} value={<span><Money cents={d.settlementsPaid.amountCents} /> <span className="text-xs text-ink-400">({num(d.settlementsPaid.count)})</span></span>} />
                <InfoRow label={t('ops.finance.d.payoutsPaid')} value={<span><Money cents={d.payoutsPaid.amountCents} /> <span className="text-xs text-ink-400">({num(d.payoutsPaid.count)})</span></span>} />
              </Section>
              <Section title={t('ops.finance.d.byKind')}>
                {Object.keys(d.ledgerByKind).length === 0 ? <p className="text-sm text-ink-500">{t('ops.opsb.noData')}</p> : (
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                    {Object.entries(d.ledgerByKind).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span><span className="font-medium">{en('LedgerTxKind', k)}</span> <span className="text-xs text-ink-400">{t('ops.finance.d.tx', { n: num(v.transactions) })}</span></span>
                        <Money cents={v.amountCents} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Trial balance ───────────────────────────── */

function TrialBalanceView({ onAccount }: { onAccount: (code: string) => void }) {
  const { t } = useI18n();
  const en = useEnumLabel();
  const an = useAccountName();
  const [zero, setZero] = useState(false);
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['finance', 'tb', zero], queryFn: () => api<TrialBalance>('/finance/trial-balance', { query: { includeZero: zero ? 'true' : undefined } }) });
  const d = q.data;
  const rows = (d?.accounts ?? []).filter((a) => !filter || `${a.code} ${a.name} ${a.owner?.name ?? ''} ${a.owner?.code ?? ''} ${an(a.code, a.name)}`.toLowerCase().includes(filter.toLowerCase()));
  const columns: Column<TbAccount>[] = [
    { key: 'code', header: t('ops.finance.tb.code'), cell: (a) => <div className="min-w-[180px]"><p className="font-medium text-ink-900 dark:text-ink-50">{an(a.code, a.name)}</p><p className="ltr text-start font-mono text-[11px] text-ink-400">{a.code.length > 22 ? `${a.code.slice(0, 13)}…` : a.code}</p></div> },
    { key: 'type', header: t('ops.opsb.type'), cell: (a) => <Badge tone="neutral">{en('LedgerAccountType', a.type)}</Badge>, hideBelow: 'lg' },
    { key: 'owner', header: t('ops.finance.tb.owner'), cell: (a) => (a.owner ? <span className="text-sm">{a.owner.name} <span className="ltr text-xs text-ink-400">{a.owner.code}</span></span> : '—'), hideBelow: 'md' },
    { key: 'dr', header: t('ops.finance.tb.debits'), align: 'end', cell: (a) => <Money cents={a.debits} className="text-ink-600 dark:text-ink-300" />, hideBelow: 'sm' },
    { key: 'cr', header: t('ops.finance.tb.credits'), align: 'end', cell: (a) => <Money cents={a.credits} className="text-ink-600 dark:text-ink-300" />, hideBelow: 'sm' },
    { key: 'bal', header: t('ops.finance.tb.balance'), align: 'end', cell: (a) => <Money cents={a.balanceCents} className={cn('font-semibold', a.balanceCents < 0 && 'text-red-600 dark:text-red-400')} /> },
  ];
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  return (
    <div className="space-y-5">
      {d ? (
        <Notice tone={d.balanced && d.equation.balanced ? 'success' : 'danger'} icon={d.balanced ? <BadgeCheck /> : <AlertOctagon />}>
          <p className="font-semibold">{d.balanced && d.equation.balanced ? t('ops.finance.tb.balanced') : t('ops.finance.tb.unbalanced')}</p>
          <p className="mt-0.5 text-xs">{t('ops.finance.tb.equation', { a: money(d.equation.assetsPlusExpenses), b: money(d.equation.liabilitiesEquityRevenue) })}</p>
        </Notice>
      ) : <Skeleton className="h-16" />}
      {d && (
        <StatGrid cols={5}>
          {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((k) => (
            <Stat key={k} label={en('LedgerAccountType', k)} value={<Money cents={d.byType[k]?.balanceCents ?? 0} compact />} tone={k === 'ASSET' ? 'turtle' : k === 'LIABILITY' ? 'violet' : k === 'REVENUE' ? 'sky' : k === 'EXPENSE' ? 'sand' : 'ink'} />
          ))}
        </StatGrid>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input type="search" leading={<Search className="h-4 w-4" />} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('ops.finance.tb.search')} aria-label={t('ops.finance.tb.search')} className="w-full sm:w-72" />
        <Switch checked={zero} onChange={setZero} label={t('ops.finance.tb.includeZero')} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(a) => a.accountId}
        loading={q.isLoading}
        onRowClick={(a) => onAccount(a.code)}
        dense
        mobileCard={(a) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-medium">{an(a.code, a.name)}</p><p className="text-xs text-ink-500">{a.owner ? `${a.owner.name} · ` : ''}{en('LedgerAccountType', a.type)}</p></div>
            <Money cents={a.balanceCents} className="font-semibold" />
          </div>
        )}
        footer={d && (
          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-ink-100 bg-ink-50/70 px-4 py-3 text-sm font-semibold dark:border-ink-800 dark:bg-ink-950/40">
            <span>{t('ops.finance.tb.totals')}</span>
            <span>{t('ops.finance.tb.debits')}: <Money cents={d.totalDebits} /></span>
            <span>{t('ops.finance.tb.credits')}: <Money cents={d.totalCredits} /></span>
          </div>
        )}
      />
    </div>
  );
}

/* ───────────────────────────── Statement ───────────────────────────── */

function StatementView() {
  const { t } = useI18n();
  const en = useEnumLabel();
  const an = useAccountName();
  const today = cairoToday();
  const [s, setS] = useQueryState({ tab: 'statement', account: '', from: addDaysStr(today, -29), to: today, page: '1' });
  const [code, setCode] = useState(s.account);
  const dcode = useDebounced(code, 500);
  useEffect(() => setCode(s.account), [s.account]);
  const tb = useQuery({ queryKey: ['finance', 'tb', false], queryFn: () => api<TrialBalance>('/finance/trial-balance') });
  const q = useQuery({
    queryKey: ['finance', 'statement', s.account, s.from, s.to, s.page],
    queryFn: () => api<Statement>(`/finance/accounts/${encodeURIComponent(s.account)}/statement`, { query: { from: s.from, to: s.to, page: s.page, pageSize: 25 } }),
    enabled: !!s.account,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const suggestions = (tb.data?.accounts ?? []).filter((a) => dcode && !s.account.startsWith(dcode) && `${a.code} ${a.name} ${a.owner?.name ?? ''}`.toLowerCase().includes(dcode.toLowerCase())).slice(0, 8);
  const d = q.data;
  const columns: Column<StatementLine>[] = [
    { key: 'date', header: t('common.date'), cell: (l) => <span className="whitespace-nowrap text-sm">{dateTime(l.createdAt)}</span> },
    { key: 'kind', header: t('ops.finance.st.kind'), cell: (l) => <Badge tone="neutral">{en('LedgerTxKind', l.kind)}</Badge>, hideBelow: 'md' },
    { key: 'desc', header: t('ops.finance.st.description'), cell: (l) => <div className="min-w-[160px] text-sm"><p>{l.description ?? '—'}</p>{l.trackingNumber && l.orderId && <Link to={`/ops/orders/${l.orderId}`} className="ltr text-xs text-turtle-700 hover:underline dark:text-turtle-400">{l.trackingNumber}</Link>}</div> },
    { key: 'dr', header: t('ops.finance.tb.debits'), align: 'end', cell: (l) => (l.debitCents ? <Money cents={l.debitCents} /> : <span className="text-ink-300">—</span>) },
    { key: 'cr', header: t('ops.finance.tb.credits'), align: 'end', cell: (l) => (l.creditCents ? <Money cents={l.creditCents} /> : <span className="text-ink-300">—</span>) },
    { key: 'bal', header: t('ops.finance.st.running'), align: 'end', cell: (l) => <Money cents={l.balanceCents} className="font-semibold" />, hideBelow: 'sm' },
  ];
  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
          <div className="relative">
            <Field label={t('ops.finance.st.account')} hint={t('ops.finance.st.accountHint')}>
              {(id) => <Input id={id} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setS({ account: code.trim() })} placeholder="1000" />}
            </Field>
            {suggestions.length > 0 && (
              <ul className="absolute inset-x-0 top-[68px] z-20 max-h-64 overflow-y-auto rounded-xl border border-ink-100 bg-white py-1 shadow-pop dark:border-ink-700 dark:bg-ink-900">
                {suggestions.map((a) => (
                  <li key={a.accountId}>
                    <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-ink-50 dark:hover:bg-ink-800" onClick={() => { setCode(a.code); setS({ account: a.code }); }}>
                      <span className="min-w-0 truncate">{an(a.code, a.name)}{a.owner ? ` · ${a.owner.name}` : ''}</span>
                      <span className="ltr shrink-0 font-mono text-xs text-ink-400">{a.code.split(':')[0]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Field label={t('common.from')}>{(id) => <Input id={id} type="date" value={s.from} onChange={(e) => setS({ from: e.target.value })} />}</Field>
          <Field label={t('common.to')}>{(id) => <Input id={id} type="date" value={s.to} max={today} onChange={(e) => setS({ to: e.target.value })} />}</Field>
          <Button className="md:mb-[22px]" onClick={() => setS({ account: code.trim() })} disabled={!code.trim()}>{t('ops.finance.st.load')}</Button>
        </div>
      </Card>
      {!s.account ? (
        <Card><EmptyState icon={<FileSpreadsheet className="h-7 w-7" />} title={t('ops.finance.st.pick')} /></Card>
      ) : q.error ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : (
        <>
          {d && (
            <StatGrid>
              <Stat label={t('ops.finance.tb.code')} value={<span className="text-base">{an(d.account.code, d.account.name)}</span>} hint={<span className="ltr">{d.account.code.split(':')[0]} · {en('LedgerAccountType', d.account.type)}</span>} icon={<Landmark />} />
              <Stat label={t('ops.finance.st.opening')} value={<Money cents={d.openingBalanceCents} />} tone="ink" />
              <Stat label={`${t('ops.finance.tb.debits')} / ${t('ops.finance.tb.credits')}`} value={<span className="text-base"><Money cents={d.totals.debitsCents} /> / <Money cents={d.totals.creditsCents} /></span>} tone="sky" />
              <Stat label={t('ops.finance.st.closing')} value={<Money cents={d.closingBalanceCents} />} tone="violet" hint={`${dateOnly(`${d.from}T12:00:00Z`)} – ${dateOnly(`${d.to}T12:00:00Z`)}`} />
            </StatGrid>
          )}
          <DataTable
            columns={columns}
            rows={d?.data}
            rowKey={(l) => l.id}
            loading={q.isLoading}
            empty={t('ops.finance.st.empty')}
            dense
            mobileCard={(l) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2"><Badge tone="neutral">{en('LedgerTxKind', l.kind)}</Badge><span className="text-xs text-ink-400">{dateTime(l.createdAt)}</span></div>
                <p className="text-sm">{l.description ?? '—'}</p>
                <div className="flex items-center justify-between text-sm"><Money cents={l.debitCents - l.creditCents} sign tone="auto" /><span className="text-xs text-ink-500">{t('ops.finance.st.running')}: <Money cents={l.balanceCents} /></span></div>
              </div>
            )}
            footer={d && d.meta.totalPages > 1 ? <Pagination page={d.meta.page} totalPages={d.meta.totalPages} total={d.meta.total} onPage={(p) => setS({ page: String(p) })} /> : null}
          />
        </>
      )}
    </div>
  );
}
