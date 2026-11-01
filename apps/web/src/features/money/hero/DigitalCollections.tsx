import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import type { CollectionStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePollInterval } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/i18n';
import { ErrorState, Skeleton } from '@/components/ui';
import { Amount, Ltr, MethodBadge, MoneyState } from '../ui';
import type { CollectionList } from '../types';
import '../i18n';

const FILTERS: Array<CollectionStatus | 'ALL'> = ['ALL', 'PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'];

/** Hero wallet: InstaPay / wallet / card / link collections, kept apart from cash on hand. */
export function DigitalCollectionsSection() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<CollectionStatus | 'ALL'>('ALL');
  const poll = usePollInterval(30_000);
  const q = useQuery({
    queryKey: ['hero', 'collections', filter],
    queryFn: () => api<CollectionList>('/hero/collections', { query: { status: filter === 'ALL' ? undefined : filter, pageSize: 30 } }),
    refetchInterval: poll,
  });
  const s = q.data?.summary;
  if (q.data && q.data.meta.total === 0 && filter === 'ALL') return null;
  return (
    <section className="mt-6" aria-labelledby="digital-collections">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Smartphone className="h-4 w-4 text-sky-600" />
        <h2 id="digital-collections" className="font-display text-base font-bold text-ink-900 dark:text-white">{t('money.heroWallet.title')}</h2>
      </div>
      <p className="mb-3 px-1 text-xs text-ink-500">{t('money.heroWallet.hint')}</p>
      {!q.data ? (
        q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Skeleton className="h-28 rounded-2xl" />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {(['pending', 'confirmed', 'rejected'] as const).map((k) => (
              <div key={k} className={cn('rounded-2xl p-3', k === 'pending' ? 'bg-amber-50 dark:bg-amber-950' : k === 'confirmed' ? 'bg-turtle-50 dark:bg-turtle-950' : 'bg-red-50 dark:bg-red-950')}>
                <dt className="text-[11px] font-semibold text-ink-600 dark:text-ink-300">{t(`money.heroWallet.${k}`)}</dt>
                <dd><Amount cents={s?.[k].cents} className="text-sm font-bold text-ink-900 dark:text-white" /></dd>
              </div>
            ))}
          </dl>
          {(s?.rejected.n ?? 0) > 0 && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">{t('money.heroWallet.rejectedHint')}</p>}
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn('h-9 shrink-0 rounded-full px-3 text-xs font-semibold', filter === f ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900' : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200')}
              >
                {f === 'ALL' ? t('common.all') : t(`state.${f}`)}
              </button>
            ))}
          </div>
          {q.data.data.length === 0 ? (
            <p className="mt-2 rounded-2xl bg-white p-6 text-center text-sm text-ink-500 shadow-card dark:bg-ink-900">{t('money.heroWallet.empty')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white dark:divide-ink-800 dark:border-ink-800 dark:bg-ink-900">
              {q.data.data.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{c.recipientName}</p>
                    <p className="truncate text-xs text-ink-500"><Ltr className="font-mono">{c.trackingNumber}</Ltr> · {dateTime(c.deliveredAt)}</p>
                    <div className="flex flex-wrap items-center gap-1.5"><MethodBadge method={c.collectionMethod} />{c.collectionReference && <Ltr className="font-mono text-[11px] text-ink-500">{c.collectionReference}</Ltr>}</div>
                    {c.collectionStatus === 'REJECTED' && c.decision?.note && <p className="text-xs text-red-700 dark:text-red-300">{c.decision.note}</p>}
                  </div>
                  <div className="shrink-0 space-y-1 text-end">
                    <Amount cents={c.collectedCents} className="text-sm font-bold text-ink-900 dark:text-white" />
                    <div><MoneyState value={c.collectionStatus} /></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
