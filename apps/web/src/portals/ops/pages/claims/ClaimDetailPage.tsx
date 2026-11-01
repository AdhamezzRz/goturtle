import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, CheckCircle2, Eye, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, parseEgp, statusLabel } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, CardHeader, ConfirmDialog, DescriptionList, ErrorState, Field, PageHeader, Skeleton, Textarea } from '@/components/ui';
import { CourierSelect, MoneyInput, Notice, ReasonDialog, centsToInput } from '@/portals/ops/components/opsb';
import { Amount, Ltr, MoneyState } from '@/features/money/ui';
import { ClaimTimeline, EvidenceGallery } from '@/features/money/claims/parts';
import type { ClaimDetail } from '@/features/money/types';
import '@/features/money/i18n';

export default function ClaimDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['claims', 'detail', id], queryFn: () => api<ClaimDetail>(`/claims/${id}`) });
  const [reject, setReject] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<ClaimDetail>(`/claims/${id}/${path}`, { method: 'POST', body: body ?? {} }),
    onSuccess: (c) => {
      qc.setQueryData(['claims', 'detail', id], c);
      void qc.invalidateQueries({ queryKey: ['claims'] });
      toast.success(t(`state.${c.status}`));
      setReject(false);
      setPayOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96" /></div>;
  if (q.error || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const c = q.data;
  const canDecide = can('tickets.manage') || can('finance.manage');
  const open = c.status === 'OPEN' || c.status === 'UNDER_REVIEW';
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<Link to="/ops/claims" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('money.claims.title')}</Link>}
        title={<span className="flex flex-wrap items-center gap-3"><Ltr className="font-mono">{c.code}</Ltr><MoneyState value={c.status} /></span>}
        subtitle={`${c.brand?.name ?? ''} · ${t(`money.claimType.${c.type}`)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {c.status === 'OPEN' && canDecide && <Button variant="outline" icon={<Eye className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ path: 'review' })}>{t('money.claims.startReview')}</Button>}
            {open && canDecide && <Button variant="outline" className="text-red-600" icon={<XCircle className="h-4 w-4" />} onClick={() => setReject(true)}>{t('money.claims.reject')}</Button>}
            {c.status === 'APPROVED' && can('finance.manage') && <Button icon={<Banknote className="h-4 w-4" />} onClick={() => setPayOpen(true)}>{t('money.claims.pay')}</Button>}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t('money.claims.details')} />
            <DescriptionList
              items={[
                { label: t('money.claims.claimed'), value: <Amount cents={c.claimedCents} className="font-semibold" /> },
                { label: t('money.claims.cap'), value: <span><Amount cents={c.liabilityCapCents} className="font-semibold" /> <span className="text-xs text-ink-500">({t(`money.claims.capBasis.${c.capBasis}`)})</span></span> },
                ...(c.approvedCents ? [{ label: t('money.claims.approvedCol'), value: <Amount cents={c.approvedCents} className="font-semibold text-turtle-700 dark:text-turtle-400" /> }] : []),
                { label: t('money.claims.filedAt'), value: dateTime(c.createdAt) },
                ...(c.paidAt ? [{ label: t('money.claims.paidAt'), value: dateTime(c.paidAt) }] : []),
                { label: t('money.claims.description'), value: <p className="whitespace-pre-line">{c.description}</p>, full: true },
                ...(c.decisionNote ? [{ label: t('money.claims.decision'), value: c.decisionNote, full: true }] : []),
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={t('money.claims.evidence')} subtitle={t('money.claims.nFiles', { n: c.evidence?.length ?? 0 })} />
            <EvidenceGallery urls={c.evidence} />
          </Card>
          <Card>
            <CardHeader title={t('money.claims.timeline')} />
            <ClaimTimeline claim={c} />
          </Card>
        </div>
        <div className="space-y-6">
          {c.order && (
            <Card>
              <CardHeader title={t('money.claims.orderContext')} actions={<Link to={`/ops/orders/${c.order.id}`} className="text-sm font-semibold text-turtle-700 hover:underline dark:text-turtle-400">{t('action.view')}</Link>} />
              <DescriptionList
                cols={1}
                items={[
                  { label: t('money.col.order'), value: <Ltr className="font-mono">{c.order.trackingNumber}</Ltr> },
                  { label: t('common.status'), value: statusLabel(c.order.status) },
                  { label: t('money.claims.recipient'), value: c.order.recipientName },
                  { label: t('money.claims.declared'), value: c.order.declaredValueCents ? <Amount cents={c.order.declaredValueCents} /> : t('money.claims.notDeclared') },
                  { label: t('money.claims.cod'), value: <Amount cents={c.order.codAmountCents} /> },
                  ...(c.order.deliveredAt ? [{ label: t('money.claims.deliveredAt'), value: dateTime(c.order.deliveredAt) }] : []),
                  ...(c.order.returnedAt ? [{ label: t('money.claims.returnedAt'), value: dateTime(c.order.returnedAt) }] : []),
                  ...(c.order.promisedBy ? [{ label: t('money.claims.promisedBy'), value: dateTime(c.order.promisedBy) }] : []),
                  ...(c.courier ? [{ label: t('money.claims.hero'), value: `${c.courier.name} · ${c.courier.code}` }] : []),
                ]}
              />
            </Card>
          )}
          {open && can('finance.manage') && <DecisionForm claim={c} loading={act.isPending} onApprove={(body) => act.mutate({ path: 'approve', body })} />}
          {open && !can('finance.manage') && <Notice tone="info">{t('money.claims.financeDecides')}</Notice>}
        </div>
      </div>
      <ReasonDialog
        open={reject}
        onClose={() => setReject(false)}
        title={t('money.claims.reject')}
        description={t('money.claims.rejectHint')}
        confirmLabel={t('money.claims.reject')}
        danger
        loading={act.isPending}
        onConfirm={(note: string) => act.mutate({ path: 'reject', body: { note } })}
      />
      <ConfirmDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onConfirm={() => act.mutate({ path: 'pay' })}
        loading={act.isPending}
        title={t('money.claims.payTitle', { code: c.code })}
        description={t('money.claims.payHint')}
        confirmLabel={t('money.claims.pay')}
      >
        <p className="text-center font-display text-3xl font-bold text-ink-900 dark:text-white"><Amount cents={c.approvedCents} /></p>
      </ConfirmDialog>
    </div>
  );
}

function DecisionForm({ claim, loading, onApprove }: { claim: ClaimDetail; loading: boolean; onApprove: (body: { approvedCents: number; decisionNote: string; chargeHeroCents?: number; courierId?: string }) => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(centsToInput(claim.liabilityCapCents));
  const [note, setNote] = useState('');
  const [charge, setCharge] = useState('');
  const [courierId, setCourierId] = useState(claim.courierId ?? '');
  useEffect(() => setAmount(centsToInput(claim.liabilityCapCents)), [claim.liabilityCapCents]);
  const cents = parseEgp(amount) ?? 0;
  const chargeCents = parseEgp(charge) ?? 0;
  const over = cents > claim.liabilityCapCents;
  const chargeOver = chargeCents > cents;
  const ok = cents > 0 && !over && note.trim().length >= 3 && !chargeOver && (chargeCents === 0 || !!courierId);
  return (
    <Card>
      <CardHeader title={t('money.claims.decide')} subtitle={<>{t('money.claims.capIs')} <Amount cents={claim.liabilityCapCents} className="font-semibold" /></>} />
      <div className="space-y-4">
        <Field label={t('money.claims.approvedAmount')} error={over ? t('money.claims.overCap') : undefined} required>
          {(id) => <MoneyInput id={id} value={amount} onChange={setAmount} invalid={over} />}
        </Field>
        <Field label={t('money.claims.decisionNote')} required>{(id) => <Textarea id={id} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <div className="rounded-xl border border-dashed border-ink-200 p-3 dark:border-ink-700">
          <p className="mb-2 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('money.claims.chargeHero')}</p>
          <div className="space-y-3">
            <Field label={t('money.claims.chargeAmount')} hint={t('money.claims.chargeHint')} error={chargeOver ? t('money.claims.chargeOver') : undefined}>
              {(id) => <MoneyInput id={id} value={charge} onChange={setCharge} invalid={chargeOver} placeholder="0" />}
            </Field>
            {chargeCents > 0 && <Field label={t('money.claims.hero')} required>{(id) => <CourierSelect id={id} value={courierId} onChange={setCourierId} />}</Field>}
          </div>
        </div>
        <Button block icon={<CheckCircle2 className="h-4 w-4" />} disabled={!ok} loading={loading} onClick={() => onApprove({ approvedCents: cents, decisionNote: note.trim(), ...(chargeCents > 0 ? { chargeHeroCents: chargeCents, courierId } : {}) })}>
          {t('money.claims.approve')}
        </Button>
      </div>
    </Card>
  );
}
