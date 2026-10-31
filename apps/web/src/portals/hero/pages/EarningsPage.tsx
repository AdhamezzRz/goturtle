import { useState, type ReactNode } from 'react';
import { BadgeCheck, Bike, Clock3, Gift, MinusCircle, Package, PhoneOff, Receipt, Store, Wallet } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dateOnly, dateTime, num } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Badge, Button, ErrorState, Skeleton, Tabs } from '@/components/ui';
import { Ltr, Money, PageTop, Panel, SectionTitle } from '../components/kit';
import { useEarningsTotals, useLedger, usePayouts } from '../lib/queries';
import { minutesLabel, periodRange } from '../lib/util';
import type { EarningCategory, Earnings, LedgerLine } from '../types';

type Period = 'today' | 'week' | 'month';

const CATEGORY_ICON: Partial<Record<EarningCategory, ReactNode>> = {
  delivery: <Bike />,
  pickup: <Store />,
  attempt: <PhoneOff />,
  shift: <Clock3 />,
  salary: <BadgeCheck />,
  bonus: <Gift />,
  reimbursement: <Receipt />,
  other_earning: <Package />,
  payout: <Wallet />,
};
const DEDUCTIONS: EarningCategory[] = ['penalty', 'cash_shortage', 'advance'];
const MAIN: EarningCategory[] = ['delivery', 'pickup', 'attempt', 'shift', 'salary', 'bonus', 'reimbursement', 'other_earning', 'other'];

export default function EarningsPage() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<Period>('today');
  const range = periodRange(period);
  const totals = useEarningsTotals(range.from, range.to);
  const ledger = useLedger(range.from, range.to);
  const payouts = usePayouts();

  return (
    <div>
      <PageTop to="/hero/me" title={t('hero.earnings.title')} />
      <Tabs
        value={period}
        onChange={setPeriod}
        className="mb-4"
        tabs={[
          { value: 'today', label: t('common.today') },
          { value: 'week', label: t('hero.earnings.week') },
          { value: 'month', label: t('hero.earnings.month') },
        ]}
      />

      {!totals.data ? (
        totals.isError ? <ErrorState error={totals.error} onRetry={() => totals.refetch()} /> : <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <TotalsCard e={totals.data} />
      )}

      <SectionTitle>{t('hero.earnings.statement')}</SectionTitle>
      {ledger.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : ledger.isError ? (
        <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} />
      ) : (
        (() => {
          const lines = ledger.data?.pages.flatMap((p) => p.data) ?? [];
          if (!lines.length) return <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink-500 shadow-card dark:bg-ink-900">{t('hero.earnings.noLines')}</p>;
          return (
            <>
              <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white dark:divide-ink-800 dark:border-ink-800 dark:bg-ink-900">
                {lines.map((l) => <LineRow key={l.id} l={l} />)}
              </ul>
              {ledger.hasNextPage && (
                <Button variant="outline" block className="mt-2 h-12" loading={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>
                  {t('hero.loadMore')}
                </Button>
              )}
            </>
          );
        })()
      )}

      <SectionTitle>{t('hero.earnings.payouts')}</SectionTitle>
      {!payouts.data ? (
        payouts.isError ? <ErrorState error={payouts.error} onRetry={() => payouts.refetch()} /> : <Skeleton className="h-20 rounded-2xl" />
      ) : payouts.data.data.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink-500 shadow-card dark:bg-ink-900">{t('hero.earnings.noPayouts')}</p>
      ) : (
        <ul className="space-y-2">
          {payouts.data.data.map((p) => (
            <li key={p.id} className="rounded-2xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-white">
                  <Ltr className="font-mono">{p.code}</Ltr>
                  <Badge tone={p.status === 'PAID' ? 'success' : p.status === 'APPROVED' ? 'info' : p.status === 'CANCELLED' ? 'neutral' : 'warning'} dot>{t(`hero.payout.status.${p.status}`)}</Badge>
                </p>
                <Money cents={p.netCents} className="font-display text-lg font-extrabold text-ink-900 dark:text-white" />
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {dateOnly(p.periodStart)} – {dateOnly(p.periodEnd)}
                {p.paidAt && <> · {t('hero.payout.paidAt', { date: dateOnly(p.paidAt) })}</>}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {p.deliveriesCount > 0 && <Badge tone="neutral">{t('hero.earnings.deliveriesN', { n: p.deliveriesCount })}</Badge>}
                {p.pickupsCount > 0 && <Badge tone="neutral">{t('hero.earnings.pickupsN', { n: p.pickupsCount })}</Badge>}
                {p.workedMinutes > 0 && <Badge tone="neutral">{minutesLabel(p.workedMinutes)}</Badge>}
                {p.bonusesCents > 0 && <Badge tone="success">{t('hero.cat.bonus')} <Money cents={p.bonusesCents} /></Badge>}
                {p.deductionsCents > 0 && <Badge tone="danger">{t('hero.earnings.deductions')} <Money cents={-p.deductionsCents} /></Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TotalsCard({ e }: { e: Earnings }) {
  const { t } = useI18n();
  const by = e.totals.byCategory;
  const deductions = DEDUCTIONS.reduce((s, k) => s + (by[k]?.netCents ?? 0), 0);
  const rows = MAIN.filter((k) => by[k] && (by[k].count > 0 || ['delivery', 'pickup', 'attempt', 'shift'].includes(k)));
  return (
    <Panel>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-500">{t('hero.earnings.earned')}</p>
          <Money cents={e.totals.earnedCents} className="font-display text-4xl font-extrabold text-turtle-700 dark:text-turtle-400" />
        </div>
        <div className="text-end">
          <p className="text-[11px] font-semibold text-ink-500">{t('hero.earnings.payable')}</p>
          <Money cents={e.payableCents} className="text-base font-bold text-ink-900 dark:text-white" />
        </div>
      </div>
      <ul className="mt-4 space-y-1">
        {rows.map((k) => (
          <li key={k} className="flex items-center gap-3 rounded-xl px-1 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300 [&>svg]:h-4 [&>svg]:w-4">{CATEGORY_ICON[k] ?? <Package />}</span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-ink-800 dark:text-ink-100">
              {t(`hero.cat.${k}`)}
              <span className="ms-1 text-xs font-normal text-ink-400">× {num(by[k].count)}</span>
            </span>
            <Money cents={by[k].netCents} className={cn('text-sm font-bold', by[k].netCents ? 'text-ink-900 dark:text-white' : 'text-ink-400')} />
          </li>
        ))}
        <li className="flex items-center gap-3 rounded-xl px-1 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950"><MinusCircle className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{t('hero.earnings.deductions')}</span>
          <Money cents={deductions} className={cn('text-sm font-bold', deductions ? 'text-red-600' : 'text-ink-400')} />
        </li>
      </ul>
      {e.totals.paidOutCents > 0 && (
        <p className="mt-2 flex items-center justify-between border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
          <span className="text-ink-500">{t('hero.earnings.paidOut')}</span>
          <Money cents={e.totals.paidOutCents} className="font-bold" />
        </p>
      )}
    </Panel>
  );
}

function LineRow({ l }: { l: LedgerLine }) {
  const { t } = useI18n();
  const positive = l.amountCents >= 0;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl [&>svg]:h-4 [&>svg]:w-4', positive ? 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300' : 'bg-red-50 text-red-600 dark:bg-red-950')}>
        {CATEGORY_ICON[l.category] ?? (positive ? <Package /> : <MinusCircle />)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{t(`hero.cat.${l.category}`)}</p>
        <p className="truncate text-xs text-ink-500">
          {dateTime(l.createdAt, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          {l.trackingNumber && <> · <Ltr className="font-mono">{l.trackingNumber}</Ltr></>}
        </p>
      </div>
      <Money cents={l.amountCents} sign className={cn('shrink-0 text-sm font-bold', positive ? 'text-turtle-700 dark:text-turtle-400' : 'text-red-600')} />
    </li>
  );
}
