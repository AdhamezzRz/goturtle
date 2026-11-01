import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, Loader2, MessageCircle, QrCode as QrIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { CollectionMethod } from '@goturtle/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePollInterval } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input, QrCode } from '@/components/ui';
import { Amount, Ltr, METHOD_ICON } from '../ui';
import type { DoorPaymentStatus, HeroCollectionOptions } from '../types';
import '../i18n';

const NEEDS_REFERENCE: CollectionMethod[] = ['INSTAPAY', 'WALLET', 'CARD'];

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    /* clipboard blocked: the value stays visible */
  }
}

/**
 * Payment method at the door for the hero's deliver sheet. Returns the picker
 * element plus what the sheet needs: whether the money is digital (no cash to
 * count), whether it is ready to submit and the body fields for /deliver.
 */
export function useDoorPayment(stop: { id: string; collectCents: number; recipient?: { phone?: string } }, open: boolean) {
  const [method, setMethod] = useState<CollectionMethod>('CASH');
  const [reference, setReference] = useState('');
  const [linkRequested, setLinkRequested] = useState(false);
  const due = stop.collectCents;

  useEffect(() => {
    if (!open) return;
    setMethod('CASH');
    setReference('');
    setLinkRequested(false);
  }, [open, stop.id]);

  const options = useQuery({
    queryKey: ['hero', 'collection-options'],
    queryFn: () => api<HeroCollectionOptions>('/hero/collections/options'),
    staleTime: 5 * 60_000,
    enabled: open && due > 0,
  });
  const isDigital = method !== 'CASH';
  const ref = reference.trim();
  const ready = !isDigital || (NEEDS_REFERENCE.includes(method) ? ref.length >= 4 : method === 'PAYMENT_LINK' ? linkRequested : true);
  const body = isDigital ? { collectionMethod: method, collectionReference: ref || undefined } : {};

  const picker =
    due > 0 && options.data && options.data.methods.length > 1 ? (
      <DoorPaymentPicker
        stopId={stop.id}
        due={due}
        options={options.data}
        method={method}
        onMethod={setMethod}
        reference={reference}
        onReference={setReference}
        linkRequested={linkRequested}
        onLinkRequested={() => setLinkRequested(true)}
      />
    ) : null;

  return { method, isDigital, ready, body, picker };
}

function DoorPaymentPicker({
  stopId, due, options, method, onMethod, reference, onReference, linkRequested, onLinkRequested,
}: {
  stopId: string; due: number; options: HeroCollectionOptions; method: CollectionMethod; onMethod: (m: CollectionMethod) => void;
  reference: string; onReference: (v: string) => void; linkRequested: boolean; onLinkRequested: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">{t('money.door.how')}</p>
      <div role="radiogroup" aria-label={t('money.door.how')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.methods.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => onMethod(m)}
            className={cn(
              'flex min-h-[48px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition',
              method === m
                ? 'border-turtle-600 bg-turtle-50 text-turtle-800 ring-2 ring-turtle-500/30 dark:border-turtle-500 dark:bg-turtle-950 dark:text-turtle-200'
                : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200',
            )}
          >
            {METHOD_ICON[m]}
            {t(`money.method.${m}`)}
          </button>
        ))}
      </div>

      {method === 'INSTAPAY' && (
        <Destination
          title={t('money.door.instapayTo')}
          value={options.instapayAddress}
          due={due}
          missing={t('money.door.noInstapay')}
          qr
        />
      )}
      {method === 'WALLET' && <Destination title={t('money.door.walletTo')} value={options.walletNumber} due={due} missing={t('money.door.noWallet')} />}
      {method === 'CARD' && <p className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300">{t('money.door.cardHint')}</p>}

      {(method === 'INSTAPAY' || method === 'WALLET' || method === 'CARD') && (
        <Field label={t(method === 'CARD' ? 'money.door.cardRef' : 'money.door.reference')} hint={t('money.door.referenceHint')} required>
          {(id) => (
            <Input
              id={id}
              className="ltr h-12 font-mono text-base"
              autoComplete="off"
              value={reference}
              onChange={(e) => onReference(e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))))}
              maxLength={120}
              placeholder={method === 'CARD' ? '123456' : 'IPN-…'}
            />
          )}
        </Field>
      )}

      {method === 'PAYMENT_LINK' && <PaymentLinkBox stopId={stopId} requested={linkRequested} onRequested={onLinkRequested} />}
    </div>
  );
}

function Destination({ title, value, due, missing, qr }: { title: string; value: string | null; due: number; missing: string; qr?: boolean }) {
  const { t } = useI18n();
  if (!value) return <p className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">{missing}</p>;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-sky-50 p-3 ring-1 ring-sky-200 dark:bg-sky-950 dark:ring-sky-900">
      {qr && (
        <div className="shrink-0 rounded-lg bg-white p-1.5">
          <QrCode value={value} size={84} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-sky-900 dark:text-sky-200">{title}</p>
        <p className="mt-0.5 break-all font-mono text-base font-bold text-ink-900 dark:text-white"><Ltr>{value}</Ltr></p>
        <p className="mt-0.5 text-xs text-sky-900/80 dark:text-sky-200/80">{t('money.door.exactly')} <Amount cents={due} className="font-bold" /></p>
      </div>
      <Button variant="outline" size="sm" className="h-11 shrink-0" icon={<Copy className="h-4 w-4" />} aria-label={t('action.copy')} onClick={() => void copy(value, t('action.copied'))}>
        <span className="sr-only sm:not-sr-only">{t('action.copy')}</span>
      </Button>
    </div>
  );
}

function PaymentLinkBox({ stopId, requested, onRequested }: { stopId: string; requested: boolean; onRequested: () => void }) {
  const { t } = useI18n();
  const poll = usePollInterval(4_000);
  const status = useQuery({
    queryKey: ['hero', 'door-payment', stopId],
    queryFn: () => api<DoorPaymentStatus>(`/hero/collections/orders/${stopId}/payment-link`),
    refetchInterval: (q) => (q.state.data?.payment?.status === 'PAID' ? false : poll),
  });
  const create = useMutation({
    mutationFn: () => api<{ checkoutUrl: string; status: string; amountCents: number }>(`/hero/collections/orders/${stopId}/payment-link`, { method: 'POST' }),
    onSuccess: () => {
      onRequested();
      void status.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pay = status.data?.payment;
  useEffect(() => {
    if (pay && !requested) onRequested();
  }, [pay, requested, onRequested]);

  if (!pay) {
    return (
      <Button size="lg" block className="h-12" icon={<QrIcon className="h-5 w-5" />} loading={create.isPending} onClick={() => create.mutate()}>
        {t('money.door.createLink')}
      </Button>
    );
  }
  const paid = pay.status === 'PAID';
  let state: ReactNode;
  if (paid) state = <p className="flex items-center gap-2 text-sm font-bold text-turtle-700 dark:text-turtle-300"><CheckCircle2 className="h-5 w-5" />{t('money.door.paid')}</p>;
  else state = <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300"><Loader2 className="h-4 w-4 animate-spin" />{t('money.door.waiting')}</p>;
  const wa = `https://wa.me/?text=${encodeURIComponent(t('money.door.waText', { link: pay.checkoutUrl }))}`;
  return (
    <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-ink-200 dark:bg-ink-900 dark:ring-ink-700">
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-lg bg-white p-1.5 ring-1 ring-ink-100">
          <QrCode value={pay.checkoutUrl} size={112} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs text-ink-500">{t('money.door.scanHint')}</p>
          <Amount cents={pay.amountCents} className="font-display text-xl font-bold text-ink-900 dark:text-white" />
          {state}
        </div>
      </div>
      {!paid && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" icon={<Copy className="h-4 w-4" />} onClick={() => void copy(pay.checkoutUrl, t('action.copied'))}>{t('action.copy')}</Button>
          <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 text-sm font-semibold text-white">
            <MessageCircle className="h-4 w-4" />{t('action.whatsapp')}
          </a>
        </div>
      )}
      {!paid && <p className="text-xs text-ink-500">{t('money.door.pendingOk')}</p>}
    </div>
  );
}
