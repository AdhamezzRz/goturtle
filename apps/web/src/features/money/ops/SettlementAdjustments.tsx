import { dateTime } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Card } from '@/components/ui';
import { Amount, Ltr } from '../ui';
import '../i18n';

export type AdjustmentLine = { kind: string; reference: string | null; description: string; orderId: string | null; amountCents: number; createdAt: string | null };

/** Statement lines behind a settlement's adjustments (early payouts, recoveries, claims …); they add up to adjustmentsCents. */
export function SettlementAdjustments({ lines, totalCents }: { lines: AdjustmentLine[] | undefined; totalCents: number }) {
  const { t } = useI18n();
  if (!lines?.length) return null;
  return (
    <Card className="mb-5" padded={false}>
      <div className="border-b border-ink-100 px-5 py-4 dark:border-ink-800">
        <h3 className="font-display text-base font-bold text-ink-900 dark:text-white">{t('money.settle.adjustments')}</h3>
        <p className="text-sm text-ink-500">{t('money.settle.adjustmentsHint')}</p>
      </div>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {lines.map((l, i) => (
          <li key={`${l.reference ?? 'other'}-${i}`} className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900 dark:text-white">{t(`money.settle.kind.${l.kind}`)}</p>
              <p className="truncate text-xs text-ink-500"><Ltr>{l.description}</Ltr>{l.createdAt ? ` · ${dateTime(l.createdAt)}` : ''}</p>
            </div>
            <Amount cents={l.amountCents} sign className={l.amountCents < 0 ? 'shrink-0 font-semibold text-red-600 dark:text-red-400' : 'shrink-0 font-semibold text-turtle-700 dark:text-turtle-400'} />
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 bg-ink-50 px-5 py-3 text-sm font-bold dark:bg-ink-800/50">
          <span>{t('common.total')}</span>
          <Amount cents={totalCents} sign />
        </li>
      </ul>
    </Card>
  );
}
