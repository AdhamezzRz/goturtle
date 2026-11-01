import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, FileWarning, Gavel, Scale, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderStatus } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, Field, Modal, Textarea } from '@/components/ui';
import { Amount, Kg, Ltr, MethodBadge, MoneyState } from '../ui';
import { EvidenceUploader, NewClaimModal } from '../claims/parts';
import type { ClaimList, CollectionRow, WeightPanel } from '../types';
import '../i18n';

const noRetryOn404 = (count: number, err: unknown) => !(err instanceof ApiError && (err.status === 404 || err.status === 403)) && count < 2;

function Panel({ icon, title, children, action }: { icon: ReactNode; title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink-900 dark:text-white"><span className="text-ink-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>{title}</h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="text-end font-medium text-ink-800 dark:text-ink-100">{value}</span>
    </div>
  );
}

function useWeight(orderId: string) {
  return useQuery({ queryKey: ['quality', 'weight', orderId], queryFn: () => api<WeightPanel>(`/quality/orders/${orderId}/weight`), retry: noRetryOn404 });
}
function useOrderClaims(orderId: string) {
  return useQuery({ queryKey: ['claims', 'order', orderId], queryFn: () => api<ClaimList>('/claims', { query: { orderId, pageSize: 20 } }), retry: noRetryOn404 });
}

function WeightBody({ w }: { w: WeightPanel }) {
  const { t } = useI18n();
  return (
    <div className="divide-y divide-ink-100 dark:divide-ink-800">
      <div className="pb-2">
        <Row label={t('money.weight.declared')} value={<Kg grams={w.declaredGrams} />} />
        <Row label={t('money.weight.actual')} value={<Kg grams={w.actualGrams} />} />
        {w.dimensionsCm && <Row label={t('money.weight.dims')} value={<Ltr>{w.dimensionsCm.l}×{w.dimensionsCm.w}×{w.dimensionsCm.h} cm</Ltr>} />}
        {!!w.volumetricGrams && <Row label={t('money.weight.volumetric')} value={<Kg grams={w.volumetricGrams} />} />}
        <Row label={t('money.weight.billable')} value={<Kg grams={w.billableGrams} className="font-bold" />} />
      </div>
      {w.adjustmentCents > 0 && (
        <div className="pt-2">
          <Row label={t('money.weight.adjustment')} value={<Amount cents={w.adjustmentCents} sign className={w.status === 'REVERSED' ? 'text-ink-400 line-through' : 'font-bold text-amber-700 dark:text-amber-300'} />} />
          <p className="text-end text-xs text-ink-500">{t('money.weight.feeVat')} <Amount cents={w.feeCents} /> + <Amount cents={w.vatCents} /></p>
          {w.weighedAt && <p className="mt-1 text-xs text-ink-400">{dateTime(w.weighedAt)}{w.weighedBy ? ` · ${w.weighedBy}` : ''}</p>}
        </div>
      )}
      {w.dispute && (
        <div className="space-y-1 pt-2 text-sm">
          <p className="font-semibold text-ink-700 dark:text-ink-200">{t('money.weight.dispute')}</p>
          <p className="text-ink-600 dark:text-ink-300">{w.dispute.note}</p>
          {w.dispute.decisionNote && <p className="text-xs text-ink-500">{t('money.weight.decision')}: {w.dispute.decisionNote}</p>}
          {w.dispute.ticket && <p className="text-xs text-ink-500">{t('money.weight.ticket')} <Ltr className="font-mono">{w.dispute.ticket.code}</Ltr></p>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ops

/** Ops order detail: digital collection, weight adjustment (+ dispute decision) and claims. */
export function OpsOrderMoneyPanel({ orderId }: { orderId: string }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const collection = useQuery({ queryKey: ['finance', 'collections', 'order', orderId], queryFn: () => api<CollectionRow>(`/finance/collections/${orderId}`), retry: noRetryOn404, enabled: can('finance.read') });
  const weight = useWeight(orderId);
  const claims = useOrderClaims(orderId);
  const [resolve, setResolve] = useState<'ACCEPTED' | 'REVERSED' | null>(null);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: () => api<WeightPanel>(`/quality/weight-disputes/${orderId}/resolve`, { method: 'POST', body: { decision: resolve, note: note.trim() } }),
    onSuccess: (w) => { qc.setQueryData(['quality', 'weight', orderId], w); toast.success(t(`state.${w.status}`)); setResolve(null); setNote(''); void qc.invalidateQueries({ queryKey: ['orders'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const w = weight.data;
  const c = collection.data;
  const list = claims.data?.data ?? [];
  const canResolve = can('tickets.manage') || can('finance.manage');
  return (
    <>
      {c && (
        <Panel icon={<Smartphone />} title={t('money.panel.collection')} action={<MoneyState value={c.collectionStatus} />}>
          <Row label={t('money.coll.method')} value={<MethodBadge method={c.collectionMethod} />} />
          <Row label={t('money.coll.reference')} value={<Ltr className="font-mono text-xs">{c.collectionReference ?? '—'}</Ltr>} />
          <Row label={t('money.coll.amount')} value={<Amount cents={c.collectedCents} />} />
          {c.decision?.note && <p className="mt-1 text-xs text-ink-500">{c.decision.note}</p>}
          {c.collectionStatus === 'PENDING_CONFIRMATION' && <Link to="/ops/finance/collections" className="mt-2 inline-block text-sm font-semibold text-turtle-700 hover:underline dark:text-turtle-400">{t('money.panel.openQueue')}</Link>}
        </Panel>
      )}
      {w && w.actualGrams !== null && (
        <Panel
          icon={<Scale />}
          title={t('money.panel.weight')}
          action={w.status !== 'NONE' ? <MoneyState value={w.status} /> : undefined}
        >
          <WeightBody w={w} />
          {w.status === 'DISPUTED' && canResolve && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => setResolve('ACCEPTED')}>{t('money.weight.keep')}</Button>
              <Button size="sm" icon={<Gavel className="h-4 w-4" />} onClick={() => setResolve('REVERSED')}>{t('money.weight.reverse')}</Button>
            </div>
          )}
        </Panel>
      )}
      {list.length > 0 && (
        <Panel icon={<FileWarning />} title={t('money.panel.claims')}>
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {list.map((cl) => (
              <li key={cl.id}>
                <Link to={`/ops/claims/${cl.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:underline">
                  <span><Ltr className="font-mono text-xs">{cl.code}</Ltr> · {t(`money.claimType.${cl.type}`)}</span>
                  <MoneyState value={cl.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Modal
        open={!!resolve}
        onClose={() => setResolve(null)}
        size="sm"
        title={resolve === 'REVERSED' ? t('money.weight.reverseTitle') : t('money.weight.keepTitle')}
        description={resolve === 'REVERSED' ? t('money.weight.reverseHint') : t('money.weight.keepHint')}
        footer={<><Button variant="outline" onClick={() => setResolve(null)}>{t('action.cancel')}</Button><Button loading={decide.isPending} disabled={note.trim().length < 3} onClick={() => decide.mutate()}>{t('action.confirm')}</Button></>}
      >
        <Field label={t('money.weight.decisionNote')} required>{(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}</Field>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ brand

const NO_CLAIM: OrderStatus[] = ['CREATED', 'PICKUP_ASSIGNED', 'CANCELLED'];

/** Brand order detail: weight adjustment with dispute, and claims with "file a claim". */
export function BrandOrderMoneyPanel({ order }: { order: { id: string; trackingNumber: string; status: OrderStatus } }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const weight = useWeight(order.id);
  const claims = useOrderClaims(order.id);
  const [dispute, setDispute] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const send = useMutation({
    mutationFn: () => api<WeightPanel>('/quality/weight-disputes', { method: 'POST', body: { orderId: order.id, note: note.trim(), evidence } }),
    onSuccess: (w) => { qc.setQueryData(['quality', 'weight', order.id], w); toast.success(t('money.weight.disputeSent')); setDispute(false); setNote(''); setEvidence([]); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const w = weight.data;
  const list = claims.data?.data ?? [];
  const canFile = can('tickets.manage') && !NO_CLAIM.includes(order.status);
  return (
    <>
      {w && w.actualGrams !== null && w.status !== 'NONE' && (
        <Panel icon={<Scale />} title={t('money.panel.weight')} action={<MoneyState value={w.status} />}>
          <WeightBody w={w} />
          {w.canDispute && can('tickets.manage') && (
            <div className="mt-3">
              <Button block variant="outline" icon={<Gavel className="h-4 w-4" />} onClick={() => setDispute(true)}>{t('money.weight.disputeBtn')}</Button>
              {w.disputeDeadline && <p className="mt-1 text-center text-xs text-ink-500">{t('money.weight.until', { at: dateTime(w.disputeDeadline) })}</p>}
            </div>
          )}
        </Panel>
      )}
      {(list.length > 0 || canFile) && (
        <Panel
          icon={<FileWarning />}
          title={t('money.panel.claims')}
          action={canFile ? <Button size="sm" variant="ghost" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setClaimOpen(true)}>{t('money.claims.fileShort')}</Button> : undefined}
        >
          {list.length === 0 ? (
            <p className="text-sm text-ink-500">{t('money.panel.noClaims')}</p>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {list.map((cl) => (
                <li key={cl.id}>
                  <Link to={`/brand/claims?id=${cl.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:underline">
                    <span><Ltr className="font-mono text-xs">{cl.code}</Ltr> · {t(`money.claimType.${cl.type}`)}</span>
                    <span className="flex items-center gap-2">{cl.approvedCents > 0 && <Amount cents={cl.approvedCents} className="text-xs font-semibold" />}<MoneyState value={cl.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <NewClaimModal open={claimOpen} onClose={() => setClaimOpen(false)} preset={{ orderId: order.id, trackingNumber: order.trackingNumber }} onCreated={() => void qc.invalidateQueries({ queryKey: ['claims', 'order', order.id] })} />
      <Modal
        open={dispute}
        onClose={() => setDispute(false)}
        title={t('money.weight.disputeTitle')}
        description={t('money.weight.disputeHint')}
        footer={<><Button variant="outline" onClick={() => setDispute(false)}>{t('action.cancel')}</Button><Button loading={send.isPending} disabled={note.trim().length < 5 || busy} onClick={() => send.mutate()}>{t('money.weight.disputeSend')}</Button></>}
      >
        <div className="space-y-4">
          <Field label={t('money.weight.disputeNote')} required>{(id) => <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />}</Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('money.claims.evidence')}</p>
            <EvidenceUploader value={evidence} onChange={setEvidence} onBusy={setBusy} />
          </div>
        </div>
      </Modal>
    </>
  );
}
