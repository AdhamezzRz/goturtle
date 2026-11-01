import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, History, Info, Rocket, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { applyBp, type AdvanceType } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateOnly, num, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, DataTable, EmptyState, Field, Input, Modal, Pagination, Skeleton, Textarea, type Column } from '@/components/ui';
import { Amount, Bp, Ltr, MoneyState } from '../ui';
import type { Advance, Eligibility } from '../types';
import '../i18n';

/**
 * Brand wallet: "Get paid now" (early payout of the wallet balance) and
 * "COD advance" (cash against parcels still on the road), with fee preview,
 * request flow and history.
 */
export function CashSpeedCards() {
  const { t } = useI18n();
  const { me } = useAuth();
  const isOwner = me?.role === 'BRAND_OWNER';
  const [open, setOpen] = useState<AdvanceType | null>(null);
  const elig = useQuery({ queryKey: ['finance', 'advances', 'eligibility'], queryFn: () => api<Eligibility>('/finance/brand/advances/eligibility') });
  const e = elig.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SpeedCard
          tone="turtle"
          icon={<Rocket className="h-5 w-5" />}
          title={t('money.adv.earlyTitle')}
          subtitle={t('money.adv.earlySubtitle')}
          loading={elig.isLoading}
          amount={e?.earlyPayout.maxAmountCents}
          feeLine={e ? <>{t('money.adv.fee')} <Bp bp={e.earlyPayout.feeBp} /></> : null}
          details={
            e && (
              <>
                <Line label={t('money.adv.wallet')} cents={e.earlyPayout.walletCents} />
                {e.earlyPayout.openSettlementsCents !== 0 && <Line label={t('money.adv.inSettlement')} cents={-e.earlyPayout.openSettlementsCents} />}
                {e.earlyPayout.pendingRequestsCents !== 0 && <Line label={t('money.adv.pendingRequests')} cents={-e.earlyPayout.pendingRequestsCents} />}
                {e.earlyPayout.inTransitWalletCents !== 0 && <Line label={t('money.adv.inTransitWallet')} cents={-e.earlyPayout.inTransitWalletCents} />}
              </>
            )
          }
          action={
            <Button disabled={!isOwner || !e?.earlyPayout.eligible} onClick={() => setOpen('EARLY_PAYOUT')} icon={<HandCoins className="h-4 w-4" />}>
              {t('money.adv.requestEarly')}
            </Button>
          }
          footnote={!isOwner ? t('money.adv.ownerOnly') : e && !e.earlyPayout.eligible ? t('money.adv.notEligible') : null}
          min={e?.minAmountCents}
        />
        <SpeedCard
          tone="sand"
          icon={<Truck className="h-5 w-5" />}
          title={t('money.adv.codTitle')}
          subtitle={t('money.adv.codSubtitle')}
          loading={elig.isLoading}
          amount={e?.codAdvance.maxAmountCents}
          feeLine={e ? <>{t('money.adv.fee')} <Bp bp={e.codAdvance.feeBp} /> · {t('money.adv.upTo')} <Bp bp={e.codAdvance.maxRateBp} /></> : null}
          details={
            e && (
              <>
                <Line label={t('money.adv.inTransit', { n: num(e.codAdvance.inTransitOrders) })} cents={e.codAdvance.inTransitCodCents} />
                <Line label={t('money.adv.cap')} cents={e.codAdvance.capCents} />
                {e.codAdvance.outstandingCents > 0 && <Line label={t('money.adv.outstanding')} cents={-e.codAdvance.outstandingCents} />}
              </>
            )
          }
          action={
            <Button variant="cash" disabled={!isOwner || !e?.codAdvance.eligible} onClick={() => setOpen('COD_ADVANCE')} icon={<HandCoins className="h-4 w-4" />}>
              {t('money.adv.requestCod')}
            </Button>
          }
          footnote={!isOwner ? t('money.adv.ownerOnly') : e && !e.codAdvance.eligible ? t('money.adv.notEligible') : t('money.adv.codRecovery')}
          min={e?.minAmountCents}
        />
      </div>
      <AdvanceHistory isOwner={isOwner} />
      {e && open && <RequestModal type={open} eligibility={e} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Line({ label, cents }: { label: ReactNode; cents: number }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-ink-500">{label}</span>
      <Amount cents={cents} className="font-medium text-ink-700 dark:text-ink-200" />
    </div>
  );
}

function SpeedCard({ tone, icon, title, subtitle, loading, amount, feeLine, details, action, footnote, min }: {
  tone: 'turtle' | 'sand'; icon: ReactNode; title: string; subtitle: string; loading: boolean; amount: number | undefined; feeLine: ReactNode;
  details: ReactNode; action: ReactNode; footnote: ReactNode; min: number | undefined;
}) {
  const { t } = useI18n();
  const iconTone = tone === 'turtle' ? 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300' : 'bg-sand-50 text-sand-800 dark:bg-ink-800 dark:text-sand-300';
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${iconTone}`}>{icon}</div>
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-ink-900 dark:text-white">{title}</h3>
          <p className="text-sm text-ink-500">{subtitle}</p>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-20" />
      ) : (
        <div>
          <p className="text-xs font-semibold text-ink-500">{t('money.adv.availableNow')}</p>
          <p className="font-display text-3xl font-bold tracking-tight text-ink-900 dark:text-white"><Amount cents={amount} /></p>
          <p className="mt-0.5 text-xs text-ink-500">{feeLine}</p>
          <div className="mt-3 space-y-1 rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60">{details}</div>
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        {action}
        {min !== undefined && <span className="text-xs text-ink-400">{t('money.adv.min')} <Amount cents={min} /></span>}
      </div>
      {footnote && <p className="flex items-start gap-1.5 text-xs text-ink-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{footnote}</p>}
    </Card>
  );
}

function RequestModal({ type, eligibility, onClose }: { type: AdvanceType; eligibility: Eligibility; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [notes, setNotes] = useState('');
  const e = type === 'EARLY_PAYOUT' ? eligibility.earlyPayout : eligibility.codAdvance;
  const amount = parseEgp(raw) ?? 0;
  const fee = amount > 0 ? applyBp(amount, e.feeBp) : 0;
  const tooBig = amount > e.maxAmountCents;
  const tooSmall = amount > 0 && amount < eligibility.minAmountCents;
  const m = useMutation({
    mutationFn: () => api<Advance>('/finance/brand/advances', { method: 'POST', body: { type, amountCents: amount, notes: notes.trim() || undefined } }),
    onSuccess: (a) => {
      toast.success(t('money.adv.requested', { code: a.code }));
      void qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={type === 'EARLY_PAYOUT' ? t('money.adv.requestEarly') : t('money.adv.requestCod')}
      description={type === 'EARLY_PAYOUT' ? t('money.adv.earlyExplain') : t('money.adv.codExplain')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button loading={m.isPending} disabled={amount <= 0 || tooBig || tooSmall} onClick={() => m.mutate()}>{t('money.adv.submit')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('money.adv.amount')}
          hint={t('money.adv.maxHint')}
          error={tooBig ? t('money.adv.tooBig') : tooSmall ? t('money.adv.tooSmall') : undefined}
          required
        >
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} inputMode="decimal" autoComplete="off" value={raw} onChange={(ev) => setRaw(ev.target.value)} placeholder="0" className="ltr h-12 flex-1 text-center font-display text-xl font-bold" invalid={tooBig || tooSmall} />
              <Button variant="outline" className="h-12" onClick={() => setRaw(String(e.maxAmountCents / 100))}>{t('money.adv.max')}</Button>
            </div>
          )}
        </Field>
        <p className="-mt-2 text-xs text-ink-500">{t('money.adv.maxIs')} <Amount cents={e.maxAmountCents} className="font-semibold" /></p>
        <div className="space-y-1.5 rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-800/60">
          <div className="flex justify-between"><span>{t('money.adv.youReceive')}</span><Amount cents={amount} className="font-semibold" /></div>
          <div className="flex justify-between text-ink-500"><span>{t('money.adv.fee')} (<Bp bp={e.feeBp} />)</span><Amount cents={fee} /></div>
          <div className="flex justify-between border-t border-ink-200 pt-1.5 font-semibold dark:border-ink-700">
            <span>{type === 'EARLY_PAYOUT' ? t('money.adv.deducted') : t('money.adv.recovered')}</span>
            <Amount cents={type === 'EARLY_PAYOUT' ? amount + fee : amount} />
          </div>
          {type === 'COD_ADVANCE' && <p className="text-xs text-ink-500">{t('money.adv.feeFromWallet')} <Amount cents={fee} /></p>}
        </div>
        <Field label={t('money.adv.notes')}>{(id) => <Textarea id={id} rows={2} maxLength={500} value={notes} onChange={(ev) => setNotes(ev.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function AdvanceHistory({ isOwner }: { isOwner: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['finance', 'advances', 'mine', page], queryFn: () => api<Paginated<Advance>>('/finance/brand/advances', { query: { page, pageSize: 10 } }) });
  const cancel = useMutation({
    mutationFn: (id: string) => api<Advance>(`/finance/brand/advances/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('money.adv.cancelled')); void qc.invalidateQueries({ queryKey: ['finance'] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const columns: Column<Advance>[] = [
    { key: 'code', header: t('money.col.code'), cell: (a) => <div><Ltr className="font-mono text-xs font-semibold">{a.code}</Ltr><p className="text-xs text-ink-500">{t(`money.advType.${a.type}`)}</p></div> },
    { key: 'date', header: t('common.date'), hideBelow: 'md', cell: (a) => <span className="text-sm">{dateOnly(a.createdAt)}</span> },
    { key: 'amount', header: t('money.adv.amount'), align: 'end', cell: (a) => <Amount cents={a.amountCents} className="font-semibold" /> },
    { key: 'fee', header: t('money.adv.fee'), align: 'end', hideBelow: 'md', cell: (a) => <Amount cents={a.feeCents} className="text-ink-500" /> },
    { key: 'rec', header: t('money.adv.recoveredCol'), align: 'end', hideBelow: 'lg', cell: (a) => (a.type === 'COD_ADVANCE' ? <Amount cents={a.recoveredCents} /> : <span className="text-ink-300">—</span>) },
    { key: 'status', header: t('common.status'), cell: (a) => <MoneyState value={a.status} /> },
    {
      key: 'act', header: '', align: 'end',
      cell: (a) => (isOwner && a.status === 'REQUESTED' ? <Button size="xs" variant="ghost" loading={cancel.isPending && cancel.variables === a.id} onClick={(ev) => { ev.stopPropagation(); cancel.mutate(a.id); }}>{t('action.cancel')}</Button> : null),
    },
  ];
  return (
    <Card padded={false}>
      <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <History className="h-4 w-4 text-ink-400" />
        <h3 className="font-display text-sm font-bold text-ink-900 dark:text-white">{t('money.adv.history')}</h3>
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(a) => a.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState icon={<HandCoins className="h-6 w-6" />} title={t('money.adv.empty')} className="py-8" />}
        mobileCard={(a) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2"><Ltr className="font-mono text-xs font-semibold">{a.code}</Ltr><MoneyState value={a.status} /></div>
            <div className="flex items-center justify-between gap-2"><span className="text-sm">{t(`money.advType.${a.type}`)}</span><Amount cents={a.amountCents} className="font-semibold" /></div>
            <p className="text-xs text-ink-500">{dateOnly(a.createdAt)} · {t('money.adv.fee')} <Amount cents={a.feeCents} /></p>
            {isOwner && a.status === 'REQUESTED' && <Button size="xs" variant="outline" onClick={() => cancel.mutate(a.id)}>{t('action.cancel')}</Button>}
          </div>
        )}
        footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} /> : null}
      />
    </Card>
  );
}
