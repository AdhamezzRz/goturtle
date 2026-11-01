import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, Download, Landmark, Lock, Receipt, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api, download, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/lib/hooks';
import { cairoToday, dateOnly, dateTime, num, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, DataTable, EmptyState, Input, PageHeader, Pagination, StateBadge, Tabs, type Column } from '@/components/ui';
import { Money, Stat } from '../components/common';
import type { FinanceSummary, Settlement, Statement, StatementLine } from '../components/types';
import './i18n';
import { CashSpeedCards } from '@/features/money/brand/CashSpeed';

const SETTLEMENT_TONE = { DRAFT: 'info', APPROVED: 'progress', PAID: 'success', CANCELLED: 'neutral' } as const;

export default function WalletPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [f, setF] = useQueryState({ tab: 'statement', from: cairoToday(-29), to: cairoToday(), page: '1' });
  const summary = useQuery({ queryKey: ['finance', 'summary'], queryFn: () => api<FinanceSummary>('/finance/brand/summary'), enabled: can('finance.read') });

  if (!can('finance.read')) {
    return (
      <div>
        <PageHeader title={t('brand.nav.wallet')} />
        <Card><EmptyState icon={<Lock className="h-7 w-7" />} title={t('brand.wallet.noAccess')} description={t('brand.wallet.noAccessHint')} /></Card>
      </div>
    );
  }
  const s = summary.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t('brand.nav.wallet')} subtitle={t('brand.wallet.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="relative overflow-hidden bg-gradient-to-br from-turtle-700 to-ink-950 text-white dark:border-turtle-900 lg:row-span-2" padded={false}>
          <div className="pointer-events-none absolute -end-10 -top-10 h-40 w-40 rounded-full bg-turtle-400/20 blur-2xl" />
          <div className="relative flex h-full flex-col justify-between gap-6 p-6">
            <div>
              <p className="flex items-center gap-2 text-sm text-turtle-100/80"><Wallet className="h-4 w-4" />{t('brand.wallet.balance')}</p>
              <p className="mt-2 font-display text-4xl font-bold tracking-tight">{summary.isLoading ? '…' : <Money cents={s?.walletBalanceCents} />}</p>
              <p className="mt-1 text-sm text-turtle-50/80">{t('brand.wallet.balanceHint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-xs text-turtle-100/80">{t('brand.dash.kNext')}</p>
                <p className="mt-0.5 font-semibold">{s?.nextSettlementDate ? dateOnly(s.nextSettlementDate + 'T12:00:00Z') : '—'}</p>
                <p className="text-xs text-turtle-100/70">{s ? t(`brand.cycle.${s.settlementCycle}`) : ''}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-xs text-turtle-100/80">{t('brand.wallet.payoutMethod')}</p>
                <p className="mt-0.5 font-semibold">{s?.payoutMethod ? t(`brand.payout.${s.payoutMethod}`) : t('brand.wallet.notSet')}</p>
                <Link to="/brand/settings?tab=payout" className="text-xs text-turtle-100/80 underline">{t('action.edit')}</Link>
              </div>
            </div>
          </div>
        </Card>
        <Stat loading={summary.isLoading} icon={<Banknote />} tone="sand" label={t('brand.wallet.pendingCod')} value={<Money cents={s?.pendingCodCents} />} hint={t('brand.wallet.pendingCodHint', { n: num(s?.pendingOrders) })} />
        <Stat loading={summary.isLoading} icon={<Receipt />} tone="ink" label={t('brand.wallet.feesMonth')} value={<Money cents={s?.feesThisMonthCents} />} hint={t('brand.wallet.feesMonthHint')} />
        <Stat loading={summary.isLoading} icon={<Landmark />} tone="sky" label={t('brand.wallet.inSettlement')} value={<Money cents={s?.inSettlementCents} />} hint={t('brand.wallet.inSettlementHint')} />
        <Stat
          loading={summary.isLoading}
          icon={<CalendarClock />}
          label={t('brand.wallet.lastPaid')}
          value={s?.lastPaidSettlement ? <Money cents={s.lastPaidSettlement.netPayableCents} /> : '—'}
          hint={s?.lastPaidSettlement ? dateOnly(s.lastPaidSettlement.paidAt) : t('brand.wallet.noPaidYet')}
        />
      </div>

      <CashSpeedCards />

      <Tabs value={f.tab} onChange={(v) => setF({ tab: v })} tabs={[{ value: 'statement', label: t('brand.wallet.statement') }, { value: 'settlements', label: t('brand.wallet.settlements') }]} />
      {f.tab === 'settlements' ? <SettlementsList page={Number(f.page) || 1} onPage={(p) => setF({ page: String(p) })} /> : <StatementView from={f.from} to={f.to} page={Number(f.page) || 1} setF={setF} />}
    </div>
  );
}

function StatementView({ from, to, page, setF }: { from: string; to: string; page: number; setF: (p: Partial<{ from: string; to: string; page: string }>) => void }) {
  const { t } = useI18n();
  const query = { from, to, page, pageSize: 50 };
  const q = useQuery({ queryKey: ['finance', 'statement', query], queryFn: () => api<Statement>('/finance/brand/statement', { query }), placeholderData: keepPreviousData });
  const columns: Column<StatementLine>[] = [
    { key: 'date', header: t('common.date'), cell: (l) => <div className="whitespace-nowrap text-xs"><p className="text-sm text-ink-800 dark:text-ink-100">{dateOnly(l.createdAt)}</p><p className="text-ink-400">{timeOnly(l.createdAt)}</p></div> },
    {
      key: 'desc',
      header: t('brand.wallet.description'),
      cell: (l) => (
        <div className="flex items-center gap-2">
          <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', l.amountCents >= 0 ? 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300' : 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300')}>
            {l.amountCents >= 0 ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-ink-800 dark:text-ink-100">{t(`brand.ledger.${l.kind}`)}</p>
            {l.trackingNumber && l.orderId ? (
              <Link to={`/brand/orders/${l.orderId}`} onClick={(e) => e.stopPropagation()} className="ltr font-mono text-xs text-turtle-700 hover:underline dark:text-turtle-400">{l.trackingNumber}</Link>
            ) : (
              l.description && <p className="truncate text-xs text-ink-500">{l.description}</p>
            )}
          </div>
        </div>
      ),
    },
    { key: 'debit', header: t('brand.wallet.debit'), align: 'end', hideBelow: 'md', cell: (l) => (l.debitCents ? <Money cents={-l.debitCents} className="text-red-600 dark:text-red-400" /> : <span className="text-ink-300">—</span>) },
    { key: 'credit', header: t('brand.wallet.credit'), align: 'end', hideBelow: 'md', cell: (l) => (l.creditCents ? <Money cents={l.creditCents} sign className="text-turtle-700 dark:text-turtle-400" /> : <span className="text-ink-300">—</span>) },
    { key: 'bal', header: t('brand.wallet.runningBalance'), align: 'end', cell: (l) => <Money cents={l.balanceCents} className="font-semibold text-ink-900 dark:text-white" /> },
  ];
  const exportCsv = () => download('/finance/brand/statement.csv', `goturtle-statement-${from}_${to}.csv`, { from, to }).then(() => toast.success(t('brand.orders.exported'))).catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">{t('common.from')}</span><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setF({ from: e.target.value })} /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-ink-500">{t('common.to')}</span><Input type="date" value={to} min={from} max={cairoToday()} onChange={(e) => e.target.value && setF({ to: e.target.value })} /></label>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <Button key={d} size="sm" variant="ghost" onClick={() => setF({ from: cairoToday(-(d - 1)), to: cairoToday() })}>{t('brand.wallet.lastN', { n: num(d) })}</Button>
          ))}
        </div>
        <Button variant="outline" className="ms-auto" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>{t('brand.wallet.downloadCsv')}</Button>
      </div>
      {q.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t('brand.wallet.opening'), q.data.openingBalanceCents],
            [t('brand.wallet.credits'), q.data.totals.creditsCents],
            [t('brand.wallet.debits'), -q.data.totals.debitsCents],
            [t('brand.wallet.closing'), q.data.closingBalanceCents],
          ].map(([label, v]) => (
            <div key={String(label)} className="rounded-2xl border border-ink-100 bg-white px-4 py-3 dark:border-ink-800 dark:bg-ink-900">
              <p className="text-xs text-ink-500">{label}</p>
              <Money cents={Number(v)} className="font-display text-lg font-bold text-ink-900 dark:text-white" />
            </div>
          ))}
        </div>
      )}
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(l) => l.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        dense
        empty={<EmptyState icon={<Receipt className="h-7 w-7" />} title={t('brand.wallet.noLines')} description={t('brand.wallet.noLinesHint')} />}
        mobileCard={(l) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{t(`brand.ledger.${l.kind}`)}</p>
              <p className="text-xs text-ink-500">{dateTime(l.createdAt)}{l.trackingNumber ? <> · <span className="ltr font-mono">{l.trackingNumber}</span></> : null}</p>
            </div>
            <div className="text-end">
              <Money cents={l.amountCents} sign className={cn('text-sm font-semibold', l.amountCents >= 0 ? 'text-turtle-700 dark:text-turtle-400' : 'text-red-600')} />
              <p className="text-xs text-ink-400"><Money cents={l.balanceCents} /></p>
            </div>
          </div>
        )}
        footer={q.data && q.data.meta.total > 0 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : undefined}
      />
    </div>
  );
}

function SettlementsList({ page, onPage }: { page: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['finance', 'settlements', page], queryFn: () => api<Paginated<Settlement> & { totals: { netPayableCents: number } }>('/finance/brand/settlements', { query: { page, pageSize: 20 } }), placeholderData: keepPreviousData });
  const columns: Column<Settlement>[] = [
    { key: 'code', header: t('brand.wallet.settlement'), cell: (s) => <div><p className="ltr font-mono font-semibold text-ink-900 dark:text-white">{s.code}</p>{s.invoiceNumber && <p className="ltr text-xs text-ink-400">{s.invoiceNumber}</p>}</div> },
    { key: 'period', header: t('brand.wallet.period'), hideBelow: 'md', cell: (s) => <span className="whitespace-nowrap text-sm">{dateOnly(s.periodStart)} – {dateOnly(s.periodEnd)}</span> },
    { key: 'orders', header: t('brand.nav.orders'), align: 'end', hideBelow: 'lg', cell: (s) => num(s.ordersCount) },
    { key: 'cod', header: t('brand.wallet.cod'), align: 'end', hideBelow: 'lg', cell: (s) => <Money cents={s.codCollectedCents} /> },
    { key: 'fees', header: t('common.fees'), align: 'end', hideBelow: 'xl', cell: (s) => <Money cents={-s.feesCents} className="text-ink-500" /> },
    { key: 'net', header: t('brand.wallet.net'), align: 'end', cell: (s) => <Money cents={s.netPayableCents} className="font-semibold text-ink-900 dark:text-white" /> },
    { key: 'status', header: t('common.status'), cell: (s) => <div><StateBadge value={s.status} map={SETTLEMENT_TONE} label={t(`brand.settlementStatus.${s.status}`)} />{s.paidAt && <p className="mt-0.5 text-[11px] text-ink-400">{dateOnly(s.paidAt)}</p>}</div> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.data}
      rowKey={(s) => s.id}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      onRowClick={(s) => navigate(`/brand/wallet/settlements/${s.id}`)}
      empty={<EmptyState icon={<Landmark className="h-7 w-7" />} title={t('brand.wallet.noSettlements')} description={t('brand.wallet.noSettlementsHint')} />}
      mobileCard={(s) => (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="ltr font-mono text-sm font-semibold">{s.code}</span>
            <StateBadge value={s.status} map={SETTLEMENT_TONE} label={t(`brand.settlementStatus.${s.status}`)} />
          </div>
          <div className="flex items-center justify-between text-xs text-ink-500">
            <span>{dateOnly(s.periodStart)} – {dateOnly(s.periodEnd)} · {t('brand.pickups.ordersN', { n: num(s.ordersCount) })}</span>
            <Money cents={s.netPayableCents} className="text-sm font-semibold text-ink-900 dark:text-white" />
          </div>
        </div>
      )}
      footer={q.data && q.data.meta.total > 0 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={onPage} /> : undefined}
    />
  );
}
