import { useEffect, useState, type ReactNode } from 'react';
import { Banknote, Building, HandCoins, Landmark, Receipt, Smartphone, TriangleAlert, Wallet as WalletIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { HandoverMethod } from '@goturtle/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, money, num, parseEgp } from '@/lib/format';
import { useOnline } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Badge, Button, ErrorState, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { Gauge, Ltr, Money, OfflineBlock, Panel, RefreshButton, SectionTitle, Sheet, StickyBar, SuccessOverlay, PhotoInput } from '../components/kit';
import { useHandovers, useHeroMutation, useInvalidateHero, useWallet } from '../lib/queries';
import { ageLabel } from '../lib/util';
import type { Handover, Wallet } from '../types';
import { DigitalCollectionsSection } from '@/features/money/hero/DigitalCollections';

const METHODS: Array<{ value: HandoverMethod; icon: ReactNode }> = [
  { value: 'CASH_AT_HUB', icon: <Building /> },
  { value: 'INSTAPAY', icon: <Smartphone /> },
  { value: 'VODAFONE_CASH', icon: <WalletIcon /> },
  { value: 'BANK_TRANSFER', icon: <Landmark /> },
];

export default function WalletPage() {
  const { t } = useI18n();
  const wallet = useWallet();
  const handovers = useHandovers();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState<Handover | null>(null);

  if (!wallet.data && wallet.isError) return <ErrorState error={wallet.error} onRetry={() => wallet.refetch()} />;
  if (!wallet.data) return <WalletSkeleton />;
  const w = wallet.data;
  const ratio = w.cashLimitCents > 0 ? w.cashOnHandCents / w.cashLimitCents : w.cashOnHandCents > 0 ? 1 : 0;
  const tone = w.warning === 'OVER_LIMIT' ? 'red' : w.warning === 'NEAR_LIMIT' ? 'sand' : 'turtle';

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold text-ink-900 dark:text-white">{t('hero.wallet.title')}</h1>
        <RefreshButton
          spinning={wallet.isFetching}
          onClick={() => {
            void wallet.refetch();
            void handovers.refetch();
          }}
        />
      </div>

      <Panel className="pt-5">
        <Gauge value={ratio} tone={tone}>
          <p className="text-xs font-semibold text-ink-500">{t('hero.wallet.onHand')}</p>
          <Money cents={w.cashOnHandCents} className="font-display text-3xl font-extrabold text-ink-900 dark:text-white" />
        </Gauge>
        <p className="mt-1 text-center text-xs text-ink-500">
          {t('hero.wallet.limit')} <Money cents={w.cashLimitCents} className="font-semibold" /> · <span className="ltr">{num(Math.round(w.usedPct))}%</span>
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl bg-ink-50 p-3 dark:bg-ink-800">
            <dt className="text-[11px] font-semibold text-ink-500">{t('hero.wallet.available')}</dt>
            <dd><Money cents={w.availableToDeclareCents} className="text-base font-bold text-ink-900 dark:text-white" /></dd>
          </div>
          <div className="rounded-2xl bg-ink-50 p-3 dark:bg-ink-800">
            <dt className="text-[11px] font-semibold text-ink-500">{t('hero.wallet.pending')}</dt>
            <dd><Money cents={w.pendingDeclaredCents} className="text-base font-bold text-amber-700 dark:text-amber-300" /></dd>
          </div>
        </dl>
        {w.outstandingShortageCents > 0 && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">
            {t('hero.wallet.shortage')} <Money cents={w.outstandingShortageCents} />
          </p>
        )}
      </Panel>

      {w.warning !== 'OK' && (
        <div className={cn('mt-3 flex gap-3 rounded-2xl p-4 ring-1', w.warning === 'OVER_LIMIT' ? 'bg-red-50 text-red-900 ring-red-200 dark:bg-red-950 dark:text-red-100 dark:ring-red-900' : 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900')}>
          <TriangleAlert className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{w.warning === 'OVER_LIMIT' ? t('hero.wallet.overLimit') : t('hero.wallet.nearLimit')}</p>
        </div>
      )}

      <SectionTitle count={w.unhandedOrders}>{t('hero.wallet.codList')}</SectionTitle>
      {w.orders.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink-500 shadow-card dark:bg-ink-900">{t('hero.wallet.noCod')}</p>
      ) : (
        <>
          <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white dark:divide-ink-800 dark:border-ink-800 dark:bg-ink-900">
            {w.orders.slice(0, 30).map((o) => {
              const old = (o.ageHours ?? 0) >= 48 ? 'red' : (o.ageHours ?? 0) >= 24 ? 'amber' : null;
              return (
                <li key={o.id} className="flex items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{o.recipientName}</p>
                    <p className="truncate text-xs text-ink-500"><Ltr className="font-mono">{o.trackingNumber}</Ltr> · {o.brandName}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <Money cents={o.collectedCents} className="text-sm font-bold text-ink-900 dark:text-white" />
                    <p className={cn('text-[11px] font-semibold', old === 'red' ? 'text-red-600' : old === 'amber' ? 'text-amber-600' : 'text-ink-400')}>{ageLabel(o.ageHours)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {w.orders.length > 30 && <p className="mt-2 text-center text-xs text-ink-500">{t('hero.wallet.more', { n: w.unhandedOrders - 30 })}</p>}
          <p className="mt-2 flex items-center justify-between px-1 text-sm">
            <span className="text-ink-500">{t('common.total')}</span>
            <Money cents={w.unhandedCents} className="font-bold" />
          </p>
        </>
      )}

      <DigitalCollectionsSection />

      <SectionTitle>{t('hero.wallet.history')}</SectionTitle>
      {!handovers.data ? (
        handovers.isError ? <ErrorState error={handovers.error} onRetry={() => handovers.refetch()} /> : <Skeleton className="h-24 rounded-2xl" />
      ) : handovers.data.data.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink-500 shadow-card dark:bg-ink-900">{t('hero.wallet.noHistory')}</p>
      ) : (
        <ul className="space-y-2">
          {handovers.data.data.map((h) => <HandoverRow key={h.id} h={h} />)}
        </ul>
      )}

      <StickyBar>
        {!online && <OfflineBlock className="mb-2" />}
        <Button size="xl" block variant="cash" className="shadow-pop" icon={<HandCoins className="h-6 w-6" />} disabled={!online || w.availableToDeclareCents <= 0} onClick={() => setOpen(true)}>
          {w.availableToDeclareCents > 0 ? t('hero.wallet.handover') : w.pendingDeclaredCents > 0 ? t('hero.wallet.allDeclared') : t('hero.wallet.nothing')}
        </Button>
      </StickyBar>

      <HandoverSheet open={open} onClose={() => setOpen(false)} wallet={w} onDone={(h) => { setOpen(false); setSuccess(h); }} />
      <SuccessOverlay
        open={!!success}
        title={t('hero.handover.doneTitle')}
        subtitle={success ? t('hero.handover.doneHint', { amount: money(success.declaredCents), code: success.code }) : ''}
        continueLabel={t('action.close')}
        autoMs={0}
        onContinue={() => setSuccess(null)}
      />
    </div>
  );
}

function HandoverRow({ h }: { h: Handover }) {
  const { t } = useI18n();
  const tone = h.status === 'CONFIRMED' ? 'success' : h.status === 'REJECTED' ? 'danger' : 'warning';
  const icon = METHODS.find((m) => m.value === h.method)?.icon ?? <Banknote />;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sand-100 text-sand-800 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-bold text-ink-900 dark:text-white">
          <Ltr className="font-mono">{h.code}</Ltr>
          <Badge tone={tone} dot>{t(`hero.handover.status.${h.status}`)}</Badge>
        </p>
        <p className="truncate text-xs text-ink-500">
          {t(`hero.method.${h.method}`)} · {dateTime(h.createdAt, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          {h.reference && <> · <Ltr>{h.reference}</Ltr></>}
        </p>
        {h.status === 'CONFIRMED' && h.varianceCents !== 0 && (
          <p className={cn('text-xs font-semibold', h.varianceCents < 0 ? 'text-red-600' : 'text-turtle-600')}>
            {t('hero.handover.variance')} <Money cents={h.varianceCents} sign />
          </p>
        )}
        {h.status === 'REJECTED' && h.notes && <p className="text-xs font-semibold text-red-600">{h.notes}</p>}
      </div>
      <div className="shrink-0 text-end">
        <Money cents={h.declaredCents} className="text-sm font-extrabold text-ink-900 dark:text-white" />
        {h.proofUrl && (
          <a href={h.proofUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-semibold text-turtle-700 dark:text-turtle-400">
            <Receipt className="h-3 w-3" /> {t('hero.handover.proof')}
          </a>
        )}
      </div>
    </li>
  );
}

function HandoverSheet({ open, onClose, wallet, onDone }: { open: boolean; onClose: () => void; wallet: Wallet; onDone: (h: Handover) => void }) {
  const { t } = useI18n();
  const online = useOnline();
  const invalidate = useInvalidateHero();
  const max = wallet.availableToDeclareCents;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<HandoverMethod>('CASH_AT_HUB');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');

  useEffect(() => {
    if (!open) return;
    setAmount(String(max / 100));
    setMethod('CASH_AT_HUB');
    setReference('');
    setProof(null);
    setNotes('');
    setStep('form');
  }, [open, max]);

  const cents = parseEgp(amount);
  const amountError = cents == null || cents <= 0 ? t('hero.handover.amountRequired') : cents > max ? t('hero.handover.tooMuch', { amount: money(max) }) : null;
  const digital = method !== 'CASH_AT_HUB';
  const refError = digital && reference.trim().length < 3 ? t('hero.handover.refRequired') : null;

  const declare = useHeroMutation(
    () =>
      api<Handover>('/hero/me/handovers', {
        method: 'POST',
        body: { amountCents: cents, method, reference: reference.trim() || undefined, proofUrl: proof ?? undefined, notes: notes.trim() || undefined },
      }),
    {
      onSuccess: (h) => {
        invalidate(['hero', 'handovers']);
        toast.success(t('hero.handover.doneTitle'));
        onDone(h);
      },
    },
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall={step === 'form'}
      title={step === 'form' ? t('hero.handover.title') : t('hero.handover.confirmTitle')}
      subtitle={step === 'form' ? t('hero.handover.subtitle', { amount: money(max) }) : undefined}
      footer={
        <div className="space-y-2 pb-1">
          {!online && <OfflineBlock />}
          {step === 'form' ? (
            <Button size="xl" block variant="cash" disabled={!!amountError || !!refError || proofBusy || !online} onClick={() => setStep('confirm')}>
              {t('action.next')}
            </Button>
          ) : (
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <Button size="xl" variant="outline" onClick={() => setStep('form')} disabled={declare.isPending}>
                {t('action.back')}
              </Button>
              <Button size="xl" variant="cash" loading={declare.isPending} disabled={!online} onClick={() => declare.mutate(undefined)}>
                {t('hero.handover.confirm')}
              </Button>
            </div>
          )}
        </div>
      }
    >
      {step === 'form' ? (
        <div className="space-y-5">
          <Field label={t('common.amount')} error={amount ? amountError ?? undefined : undefined} required>
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!amount && !!amountError} className="ltr h-14 flex-1 text-center font-display text-2xl font-bold" />
                <Button variant="outline" className="h-14 shrink-0 px-4" onClick={() => setAmount(String(max / 100))}>{t('hero.handover.all')}</Button>
              </div>
            )}
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-ink-700 dark:text-ink-200">{t('hero.handover.method')}</p>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={method === m.value}
                  onClick={() => setMethod(m.value)}
                  className={cn(
                    'flex min-h-[72px] flex-col items-start justify-between gap-1 rounded-2xl p-3 text-start text-sm font-bold ring-2 [&>svg]:h-6 [&>svg]:w-6',
                    method === m.value ? 'bg-sand-50 text-ink-900 ring-sand-400 dark:bg-ink-800 dark:text-white' : 'bg-white text-ink-700 ring-ink-100 dark:bg-ink-800 dark:text-ink-200 dark:ring-ink-700',
                  )}
                >
                  <span className={method === m.value ? 'text-sand-600' : 'text-ink-400'}>{m.icon}</span>
                  {t(`hero.method.${m.value}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-500">{t(`hero.method.hint.${method}`)}</p>
          </div>

          {digital && (
            <Field label={t('hero.handover.reference')} required error={reference && refError ? refError : undefined} hint={t('hero.handover.referenceHint')}>
              {(id) => <Input id={id} className="ltr h-12 font-mono" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} autoComplete="off" />}
            </Field>
          )}

          <PhotoInput purpose="handover_proof" label={digital ? t('hero.handover.proofDigital') : t('hero.handover.proofCash')} value={proof} onChange={setProof} onBusy={setProofBusy} />

          <Field label={<>{t('common.notes')} <span className="text-xs font-normal text-ink-400">({t('hero.optional')})</span></>}>
            {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
          </Field>
        </div>
      ) : (
        <div className="space-y-4 py-2 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-sand-100 text-sand-800"><HandCoins className="h-8 w-8" /></div>
          <p className="text-sm text-ink-600 dark:text-ink-300">{t('hero.handover.confirmText')}</p>
          <Money cents={cents ?? 0} className="font-display text-5xl font-extrabold text-ink-900 dark:text-white" />
          <p className="font-semibold text-ink-800 dark:text-ink-100">{t(`hero.method.${method}`)}{reference && <> · <Ltr className="font-mono">{reference}</Ltr></>}</p>
          <p className="rounded-xl bg-ink-50 p-3 text-xs text-ink-500 dark:bg-ink-800">{t('hero.handover.pendingNote')}</p>
        </div>
      )}
    </Sheet>
  );
}

function WalletSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-64 rounded-2xl" />
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
    </div>
  );
}
