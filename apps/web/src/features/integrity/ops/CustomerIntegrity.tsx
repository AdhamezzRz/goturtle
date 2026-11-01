import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, MapPin, MapPinOff, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, EmptyState, Skeleton, Switch } from '@/components/ui';
import { SectionCard } from '@/portals/ops/components/opsa/ui';
import type { CustomerAddress } from '../types';
import '../i18n';

const AddressPinsMap = lazy(() => import('./AddressPinsMap'));

interface CustomerRules { id: string; name: string; isBlocked: boolean; blockedReason: string | null; blockedAt: string | null; requirePrepayment: boolean }

/** Ops customer detail: network rules (blocklist reason, prepayment) and the address book with pins. */
export function CustomerIntegrity({ customerId }: { customerId: string }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const c = useQuery({ queryKey: ['customer', customerId], queryFn: () => api<CustomerRules>(`/customers/${customerId}`) });
  const book = useQuery({ queryKey: ['integrity', 'addresses', customerId], queryFn: () => api<{ data: CustomerAddress[] }>(`/customers/${customerId}/addresses`) });
  const prepay = useMutation({
    mutationFn: (required: boolean) => api(`/customers/${customerId}/prepayment`, { method: 'POST', body: { required } }),
    onSuccess: () => { toast.success(t('integrity.saved')); void qc.invalidateQueries({ queryKey: ['customer', customerId] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rules = c.data;
  const list = book.data?.data ?? [];
  const pinned = list.some((a) => a.lat != null);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <SectionCard title={t('integrity.customer.rules')} className="lg:col-span-1">
        {!rules ? <Skeleton className="h-24" /> : (
          <div className="space-y-4">
            {rules.isBlocked && (
              <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900">
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <span>{t('integrity.customer.blockedSince', { t: rules.blockedAt ? ago(rules.blockedAt) : '—', r: rules.blockedReason ?? '—' })}</span>
              </div>
            )}
            <div>
              <Switch checked={rules.requirePrepayment} disabled={!can('orders.update') || prepay.isPending} onChange={(v) => prepay.mutate(v)} label={<span className="text-sm font-medium">{t('integrity.prepayToggle')}</span>} />
              <p className="mt-1 text-xs text-ink-500">{t('integrity.prepayHint')}</p>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t('integrity.customer.addresses')} subtitle={t('integrity.customer.addressesHint')} className="lg:col-span-2" padded={false}>
        {book.isLoading ? <div className="p-5"><Skeleton className="h-40" /></div> : !list.length ? (
          <EmptyState icon={<MapPinOff className="h-6 w-6" />} title={t('integrity.customer.noAddresses')} className="py-8" />
        ) : (
          <div className="grid gap-0 md:grid-cols-2">
            {pinned && (
              <div className="border-b border-ink-100 p-3 dark:border-ink-800 md:border-b-0 md:border-e">
                <Suspense fallback={<Skeleton className="h-[240px] rounded-2xl" />}>
                  <AddressPinsMap addresses={list} selected={selected} onSelect={setSelected} />
                </Suspense>
              </div>
            )}
            <ul className={cn('divide-y divide-ink-100 dark:divide-ink-800', !pinned && 'md:col-span-2')}>
              {list.map((a, i) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setSelected(a.id)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-ink-50 dark:hover:bg-ink-800/50', selected === a.id && 'bg-turtle-50/60 dark:bg-turtle-950/40')}>
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white', a.isVerified ? 'bg-turtle-600' : 'bg-ink-400')}>{a.hasPin ? i + 1 : <MapPin className="h-3.5 w-3.5" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900 dark:text-ink-50">{a.addressLine}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                        {a.isVerified ? <Badge tone="success"><BadgeCheck className="h-3 w-3" />{t('integrity.customer.verified')}</Badge> : <Badge tone="neutral">{t('integrity.customer.unverified')}</Badge>}
                        <Badge tone="info">{t(`integrity.source.${a.source}`)}</Badge>
                        {a.zone && <span>{locale === 'ar' ? a.zone.nameAr : a.zone.nameEn}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-500">{t('integrity.customer.usage', { o: num(a.ordersCount), d: num(a.deliveredCount), b: num(a.brandsCount) })}{a.lastUsedAt ? ` · ${ago(a.lastUsedAt)}` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
