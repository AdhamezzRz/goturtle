import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, CreditCard, History, Link2, Loader2, PhoneCall, ShieldAlert, ShieldCheck } from 'lucide-react';
import { normalizeEgyptPhone } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, ConfirmDialog } from '@/components/ui';
import { ConfirmationBadge } from '../shared';
import type { AddressSuggestion, OrderIntegrity, RecipientRisk } from '../types';
import '../i18n';

const LEVEL_TONE = { LOW: 'success', MEDIUM: 'warning', HIGH: 'danger' } as const;

/**
 * Brand new-order form: network risk of the recipient phone (debounced, coarse
 * signals only) and the addresses this brand already used for it.
 */
export function RecipientInsights({ phone, codCents, onUseAddress }: { phone: string; codCents?: number | null; onUseAddress: (a: AddressSuggestion) => void }) {
  const { t, locale } = useI18n();
  const e164 = normalizeEgyptPhone(phone);
  const debounced = useDebounced(e164, 400);
  const cod = useDebounced(codCents ?? 0, 600);
  const risk = useQuery({
    queryKey: ['integrity', 'risk', debounced, cod],
    queryFn: () => api<RecipientRisk>('/customers/risk', { query: { phone: debounced!, codAmountCents: cod || undefined } }),
    enabled: !!debounced,
    staleTime: 60_000,
  });
  const book = useQuery({
    queryKey: ['integrity', 'suggest', debounced],
    queryFn: () => api<{ addresses: AddressSuggestion[]; verifiedPinAvailable: boolean }>('/address-book/suggest', { query: { phone: debounced! } }),
    enabled: !!debounced,
    staleTime: 60_000,
  });
  if (!e164) return null;
  if (risk.isLoading) return <p className="mt-3 flex items-center gap-2 text-xs text-ink-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('integrity.brand.checking')}</p>;
  const r = risk.data;
  const addresses = book.data?.addresses ?? [];
  if (!r) return null;
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-ink-100 bg-ink-50/60 p-3 dark:border-ink-800 dark:bg-ink-800/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-700 dark:text-ink-200">
          {r.level === 'LOW' ? <ShieldCheck className="h-4 w-4 text-turtle-600" /> : <ShieldAlert className={cn('h-4 w-4', r.level === 'HIGH' ? 'text-red-600' : 'text-amber-600')} />}
          {t('integrity.brand.riskTitle')}
        </span>
        <Badge tone={LEVEL_TONE[r.level]}>{t(`risk.${r.level}`)} · <span className="ltr">{r.score}</span></Badge>
        {r.flags.map((f) => <Badge key={f} tone={f === 'RELIABLE' ? 'success' : f === 'NEW_RECIPIENT' ? 'neutral' : 'warning'}>{t(`integrity.brand.flag.${f}`)}</Badge>)}
      </div>
      {r.requiresPrepayment && <p className="rounded-xl bg-sand-50 px-3 py-2 text-sm font-medium text-sand-800 ring-1 ring-sand-200 dark:bg-sand-900/30 dark:text-sand-200 dark:ring-sand-800">{t('integrity.brand.prepayWarn')}</p>}
      {r.verifiedPinAvailable && <p className="flex items-center gap-1.5 text-sm text-turtle-700 dark:text-turtle-400"><BadgeCheck className="h-4 w-4" />{t('integrity.brand.verifiedPin')}</p>}
      {addresses.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><History className="h-3.5 w-3.5" />{t('integrity.brand.saved')}</p>
          <ul className="space-y-1.5">
            {addresses.slice(0, 4).map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 dark:bg-ink-900">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">{a.addressLine}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                    {a.zone && <span>{locale === 'ar' ? a.zone.nameAr : a.zone.nameEn}</span>}
                    <span>{t('integrity.brand.usedN', { n: a.ordersCount })}</span>
                    {a.verifiedPin && <Badge tone="success"><BadgeCheck className="h-3 w-3" />{t('integrity.customer.verified')}</Badge>}
                  </p>
                </div>
                <Button size="xs" variant="outline" onClick={() => { onUseAddress(a); toast.success(t('integrity.brand.applied')); }}>{t('integrity.brand.use')}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Brand order detail: confirmation status and hold reason, with the prepayment CTA. */
export function BrandOrderIntegrity({ orderId }: { orderId: string }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [switchOpen, setSwitchOpen] = useState(false);
  const q = useQuery({ queryKey: ['integrity', 'order', orderId], queryFn: () => api<OrderIntegrity>(`/integrity/orders/${orderId}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['integrity', 'order', orderId] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };
  const link = useMutation({
    mutationFn: () => api<{ checkoutUrl: string | null }>(`/payments/orders/${orderId}/link`, { method: 'POST', body: { notifyCustomer: true } }),
    onSuccess: (r) => {
      if (r.checkoutUrl) void navigator.clipboard?.writeText(r.checkoutUrl).catch(() => undefined);
      toast.success(t('integrity.brand.linkSent'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toPrepaid = useMutation({
    mutationFn: async () => {
      await api(`/orders/${orderId}`, { method: 'PATCH', body: { paymentMethod: 'PREPAID' } });
      await api(`/integrity/holds/${orderId}/release`, { method: 'POST', body: { note: 'Switched to prepaid by the brand' } });
    },
    onSuccess: () => { setSwitchOpen(false); toast.success(t('integrity.brand.switched')); refresh(); },
    onError: (e) => { toast.error(errorMessage(e)); refresh(); },
  });
  const d = q.data;
  if (!d) return null;
  const prepayHold = d.hold?.reason === 'PREPAY_REQUIRED';
  const waiting = !d.hold && ['PENDING', 'NO_RESPONSE'].includes(d.confirmation.status);
  const unconfirmedHold = d.hold?.reason === 'UNCONFIRMED';
  if (!prepayHold && !waiting && !unconfirmedHold && d.confirmation.status === 'NOT_REQUIRED') return null;

  return (
    <Card className={cn(prepayHold && 'ring-1 ring-sand-300 dark:ring-sand-800', (waiting || unconfirmedHold) && 'ring-1 ring-amber-200 dark:ring-amber-900')}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', prepayHold ? 'bg-sand-50 text-sand-700 dark:bg-sand-900/40 dark:text-sand-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300')}>
          {prepayHold ? <CreditCard className="h-5 w-5" /> : waiting || unconfirmedHold ? <PhoneCall className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink-900 dark:text-white">
              {prepayHold ? t('integrity.brand.prepayTitle') : waiting || unconfirmedHold ? t('integrity.brand.unconfirmedTitle') : t('integrity.brand.cardTitle')}
            </h3>
            <ConfirmationBadge status={d.confirmation.status} />
          </div>
          <p className="mt-1 text-sm text-ink-500">{prepayHold ? t('integrity.brand.prepayHint') : waiting || unconfirmedHold ? t('integrity.brand.unconfirmedHint') : null}</p>
          {prepayHold && can('orders.update') && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon={<Link2 className="h-4 w-4" />} loading={link.isPending} onClick={() => link.mutate()}>{t('integrity.brand.paymentLink')}</Button>
              <Button variant="outline" icon={<CreditCard className="h-4 w-4" />} onClick={() => setSwitchOpen(true)}>{t('integrity.brand.switchPrepaid')}</Button>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog open={switchOpen} onClose={() => setSwitchOpen(false)} onConfirm={() => toPrepaid.mutate()} loading={toPrepaid.isPending} title={t('integrity.brand.switchTitle')} description={t('integrity.brand.switchDesc')} confirmLabel={t('integrity.brand.switchPrepaid')} />
    </Card>
  );
}
