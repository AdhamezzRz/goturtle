import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Gavel, MessageSquareQuote, PhoneCall, ShieldQuestion, Ticket } from 'lucide-react';
import type { AttemptDisputeStatus } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, dateTime, parseEgp, timeOnly } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, Pagination, Skeleton, Textarea } from '@/components/ui';
import { Segmented } from '@/portals/ops/components/opsa/ui';
import { CallsChip, DisputeBadge, DistanceChip } from '../shared';
import type { DisputeRow } from '../types';

const EvidenceMap = lazy(() => import('./EvidenceMap'));

type DisputesPage = Paginated<DisputeRow> & { geofenceMeters: number };

export function DisputesTab() {
  const { t } = useI18n();
  const [s, setS] = useQueryState({ ds: 'DISPUTED', page: '1' });
  const [resolve, setResolve] = useState<DisputeRow | null>(null);
  const q = useQuery({
    queryKey: ['integrity', 'disputes', s],
    queryFn: () => api<DisputesPage>('/integrity/disputes', { query: { status: s.ds, page: s.page, pageSize: 10 } }),
  });
  return (
    <div className="space-y-4">
      <Segmented<AttemptDisputeStatus>
        value={s.ds as AttemptDisputeStatus}
        onChange={(v) => setS({ ds: v })}
        options={(['DISPUTED', 'UPHELD', 'REJECTED', 'CONFIRMED_BY_CUSTOMER'] as const).map((v) => ({ value: v, label: t(`integrity.dispute.${v}`) }))}
      />
      {q.isLoading ? (
        <div className="space-y-4"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <div className="rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900">
          <EmptyState icon={<ShieldQuestion className="h-6 w-6" />} title={t('integrity.emptyDisputes')} description={t('integrity.emptyDisputesHint')} />
        </div>
      ) : (
        <div className="space-y-4">
          {q.data.data.map((d) => <DisputeCard key={d.attemptId} d={d} geofence={q.data.geofenceMeters} onResolve={() => setResolve(d)} />)}
          {q.data.meta.totalPages > 1 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setS({ page: String(p) })} />}
        </div>
      )}
      <ResolveModal dispute={resolve} onClose={() => setResolve(null)} />
    </div>
  );
}

function DisputeCard({ d, geofence, onResolve }: { d: DisputeRow; geofence: number; onResolve: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <article className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-4 py-3 dark:border-ink-800 sm:px-5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/ops/orders/${d.order.id}`} className="font-mono text-sm font-bold text-turtle-700 hover:underline dark:text-turtle-400"><span className="ltr">{d.order.trackingNumber}</span></Link>
            <DisputeBadge status={d.disputeStatus} />
            {d.failureReason && <Badge tone="neutral">{t(`ops.opsa.reason.${d.failureReason}`)}</Badge>}
          </div>
          <p className="text-xs text-ink-500">
            {t('integrity.order.attemptN', { n: d.attemptNo })} · {dateTime(d.at)} · {t('integrity.hero')}: <span className="font-medium text-ink-700 dark:text-ink-200">{d.hero.name}</span> <span className="ltr">({d.hero.code})</span> · {d.order.brandName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d.ticket && <Link to={`/ops/tickets/${d.ticket.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"><Ticket className="h-3.5 w-3.5" /><span className="ltr">{d.ticket.code}</span></Link>}
          {d.disputeStatus === 'DISPUTED' && can('orders.update') && <Button size="sm" icon={<Gavel className="h-4 w-4" />} onClick={onResolve}>{t('integrity.resolve')}</Button>}
        </div>
      </header>
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {d.order.destination || d.heroPosition ? (
            <Suspense fallback={<Skeleton className="h-[200px] rounded-2xl" />}>
              <EvidenceMap destination={d.order.destination} hero={d.heroPosition} geofenceMeters={geofence} labels={{ destination: d.order.addressLine, hero: d.hero.name }} />
            </Suspense>
          ) : (
            <div className="grid h-[200px] place-items-center rounded-2xl bg-ink-50 text-sm text-ink-500 dark:bg-ink-800/60">{t('integrity.noPin')}</div>
          )}
          <p className="mt-2 truncate text-xs text-ink-500">{d.order.addressLine}</p>
        </div>
        <div className="min-w-0 space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('integrity.evidence')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <DistanceChip meters={d.distanceMeters} allowed={geofence} />
              <span className="text-xs text-ink-500">{t('integrity.geofence', { m: geofence })}</span>
              <CallsChip n={d.callCount} />
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('integrity.callTimeline')}</p>
            {d.calls.length ? (
              <ol className="space-y-1.5 border-s-2 border-ink-100 ps-3 dark:border-ink-800">
                {d.calls.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <PhoneCall className="h-3.5 w-3.5 text-ink-400" />
                    <span className="ltr font-medium tabular-nums">{timeOnly(c.startedAt)}</span>
                    <Badge tone={c.status === 'ANSWERED' ? 'success' : c.status === 'INITIATED' ? 'neutral' : 'warning'}>{t(`integrity.call.${c.status}`)}</Badge>
                    {c.durationSeconds > 0 && <span className="ltr text-xs text-ink-500">{c.durationSeconds}s</span>}
                  </li>
                ))}
                <li className="text-xs text-ink-500">{t('integrity.order.attemptN', { n: d.attemptNo })} · <span className="ltr">{timeOnly(d.at)}</span></li>
              </ol>
            ) : (
              <p className="text-sm text-red-600 dark:text-red-400">{t('integrity.noCalls')}</p>
            )}
          </div>
          {(d.customerNote || d.note) && (
            <div className="space-y-2">
              {d.customerNote && (
                <blockquote className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900">
                  <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-amber-800 dark:text-amber-300"><MessageSquareQuote className="h-3.5 w-3.5" />{t('integrity.customerNote')}</p>
                  {d.customerNote}
                </blockquote>
              )}
              {d.note && <p className="text-sm text-ink-600 dark:text-ink-300"><span className="font-semibold">{t('integrity.heroNote')}:</span> {d.note}</p>}
            </div>
          )}
          {d.disputedAt && <p className="text-xs text-ink-500">{t('integrity.disputedAt', { t: ago(d.disputedAt) })}</p>}
        </div>
      </div>
    </article>
  );
}

function ResolveModal({ dispute, onClose }: { dispute: DisputeRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [decision, setDecision] = useState<'UPHELD' | 'REJECTED'>('UPHELD');
  const [penalty, setPenalty] = useState('');
  const [note, setNote] = useState('');
  const penaltyCents = penalty.trim() ? parseEgp(penalty) : 0;
  const valid = note.trim().length >= 3 && penaltyCents !== null && penaltyCents <= 100_000;
  const m = useMutation({
    mutationFn: () => api(`/integrity/disputes/${dispute!.attemptId}/resolve`, { method: 'POST', body: { decision, note: note.trim(), penaltyCents: decision === 'UPHELD' && penaltyCents ? penaltyCents : undefined } }),
    onSuccess: () => {
      toast.success(t('integrity.resolved'));
      void qc.invalidateQueries({ queryKey: ['integrity'] });
      onClose();
      setNote('');
      setPenalty('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={!!dispute}
      onClose={onClose}
      title={dispute ? t('integrity.resolveTitle', { tn: dispute.order.trackingNumber }) : ''}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button disabled={!valid} loading={m.isPending} variant={decision === 'UPHELD' ? 'danger' : 'primary'} onClick={() => m.mutate()}>{t('integrity.resolve')}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {(['UPHELD', 'REJECTED'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={decision === v}
              onClick={() => setDecision(v)}
              className={cn('min-h-[56px] rounded-xl p-3 text-start text-sm font-semibold ring-2 transition', decision === v ? (v === 'UPHELD' ? 'bg-red-50 text-red-800 ring-red-500 dark:bg-red-950 dark:text-red-200' : 'bg-turtle-50 text-turtle-800 ring-turtle-500 dark:bg-turtle-950 dark:text-turtle-200') : 'bg-white text-ink-700 ring-ink-100 dark:bg-ink-800 dark:text-ink-200 dark:ring-ink-700')}
            >
              {t(v === 'UPHELD' ? 'integrity.uphold' : 'integrity.reject')}
            </button>
          ))}
        </div>
        {decision === 'UPHELD' && can('couriers.manage') && (
          <Field label={t('integrity.penalty')} hint={t('integrity.penaltyHint')} error={penaltyCents === null ? t('error.VALIDATION') : undefined}>
            {(id) => <Input id={id} dir="ltr" inputMode="decimal" value={penalty} onChange={(e) => setPenalty(e.target.value)} placeholder="0" />}
          </Field>
        )}
        <Field label={t('integrity.noteLabel')} required>{(id) => <Textarea id={id} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
