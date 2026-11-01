import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, BadgeCheck, MapPinned, PhoneCall, Send, ShieldOff, Unlock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, dateTime, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, ConfirmDialog, Field, Skeleton, Textarea } from '@/components/ui';
import { SectionCard } from '@/portals/ops/components/opsa/ui';
import { CallsChip, ConfirmationBadge, DisputeBadge, DistanceChip, HoldBadge } from '../shared';
import { holdKey, type OrderIntegrity } from '../types';
import { RecordAnswerModal, useIsManager } from './QueueTabs';

/**
 * Ops order detail: confirmation state & history, hold banner (release /
 * override), attempts with geofence distance, calls and dispute status, call log.
 */
export function OrderIntegrityPanel({ orderId, recipientName }: { orderId: string; recipientName?: string }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const manager = useIsManager();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'release' | 'override' | null>(null);
  const [record, setRecord] = useState(false);
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: ['integrity', 'order', orderId], queryFn: () => api<OrderIntegrity>(`/integrity/orders/${orderId}`), enabled: can('orders.read') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['integrity'] });
    void qc.invalidateQueries({ queryKey: ['order', orderId] });
  };
  const act = useMutation({
    mutationFn: () => (dialog === 'override'
      ? api(`/integrity/holds/${orderId}/override`, { method: 'POST', body: { reason: text.trim() } })
      : api(`/integrity/holds/${orderId}/release`, { method: 'POST', body: { note: text.trim() || undefined } })),
    onSuccess: () => { toast.success(t(dialog === 'override' ? 'integrity.overridden' : 'integrity.released')); setDialog(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resend = useMutation({
    mutationFn: () => api(`/integrity/confirmations/${orderId}/resend`, { method: 'POST', body: {} }),
    onSuccess: () => { toast.success(t('integrity.resent')); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!q.data) return null;
  const d = q.data;
  const failed = d.attempts.filter((a) => !a.success);
  const showConfirmTools = can('orders.update') && ['PENDING', 'NO_RESPONSE', 'NOT_REQUIRED', 'RESCHEDULED'].includes(d.confirmation.status) && !['DELIVERED', 'RETURNED', 'CANCELLED', 'LOST', 'OUT_FOR_DELIVERY'].includes(d.status);

  return (
    <div className="space-y-4">
      {(d.hold || d.dispatchBlocked) && (
        <div className="flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-amber-950/60 dark:ring-amber-900 sm:flex-row sm:items-center">
          <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-amber-950 dark:text-amber-100">
              {d.hold ? t('integrity.order.heldBanner', { reason: t(holdKey(d.hold.reason)) }) : t('integrity.order.blockedBanner')}
            </p>
            <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
              {d.dispatchBlocked ? t('error.CONFIRMATION_REQUIRED') : null}
              {d.hold?.since && <> · {t('integrity.order.heldSince', { t: ago(d.hold.since) })}</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {d.hold && can('orders.update') && <Button size="sm" variant="outline" icon={<Unlock className="h-4 w-4" />} onClick={() => { setText(''); setDialog('release'); }}>{t('integrity.release')}</Button>}
            {manager && <Button size="sm" variant="outline" icon={<ShieldOff className="h-4 w-4" />} onClick={() => { setText(''); setDialog('override'); }}>{t('integrity.override')}</Button>}
          </div>
        </div>
      )}

      <SectionCard
        title={t('integrity.order.title')}
        subtitle={d.override ? t('integrity.order.override', { name: d.override.byName, reason: d.override.reason }) : undefined}
        actions={
          showConfirmTools ? (
            <>
              <Button size="xs" variant="outline" icon={<PhoneCall className="h-3.5 w-3.5" />} onClick={() => setRecord(true)}>{t('integrity.record')}</Button>
              {d.confirmation.status !== 'RESCHEDULED' && <Button size="xs" variant="ghost" icon={<Send className="h-3.5 w-3.5" />} loading={resend.isPending} onClick={() => resend.mutate()}>{t('integrity.resend')}</Button>}
            </>
          ) : undefined
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('integrity.order.confirmation')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <ConfirmationBadge status={d.confirmation.status} />
                {d.hold && <HoldBadge reason={d.hold.reason} />}
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {d.confirmation.requestedAt && t('integrity.order.requested', { t: ago(d.confirmation.requestedAt) })}
                {d.confirmation.respondedAt && <> · {t('integrity.order.answered', { t: ago(d.confirmation.respondedAt), c: t(`integrity.channel.${d.confirmation.channel ?? 'LINK'}`) })}</>}
              </p>
            </div>
            {d.address && (
              <p className="flex items-center gap-1.5 text-sm text-ink-600 dark:text-ink-300">
                {d.address.isVerified ? <BadgeCheck className="h-4 w-4 text-turtle-600" /> : <MapPinned className="h-4 w-4 text-ink-400" />}
                {t('integrity.order.address', { v: d.address.isVerified ? t('integrity.order.addressVerified', { n: d.address.deliveredCount }) : t('integrity.order.addressNew') })}
              </p>
            )}
            {d.history.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('integrity.order.history')}</p>
                <ol className="space-y-1 border-s-2 border-ink-100 ps-3 text-sm dark:border-ink-800">
                  {d.history.slice(-6).map((h, i) => (
                    <li key={i} className="text-ink-700 dark:text-ink-200">
                      <span className="ltr me-1 text-xs tabular-nums text-ink-400">{dateTime(h.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {h.note ?? h.reason}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t('integrity.order.attempts')}</p>
            {failed.length === 0 ? (
              <p className="text-sm text-ink-500">{t('integrity.order.noAttempts')}</p>
            ) : (
              <ul className="space-y-2">
                {failed.map((a) => (
                  <li key={a.id ?? a.attemptNo} className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{t('integrity.order.attemptN', { n: a.attemptNo })}{a.failureReason && <span className="font-normal text-ink-500"> · {t(`ops.opsa.reason.${a.failureReason}`)}</span>}</span>
                      <DisputeBadge status={a.disputeStatus} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <DistanceChip meters={a.distanceMeters} allowed={d.geofenceMeters} />
                      <CallsChip n={a.callCount ?? 0} />
                      <span className="text-xs text-ink-500">{a.hero?.name} · <span className="ltr">{timeOnly(a.at)}</span></span>
                    </div>
                    {a.disputeNote && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">“{a.disputeNote}”</p>}
                  </li>
                ))}
              </ul>
            )}
            {!!d.calls?.length && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('integrity.order.calls')}</p>
                <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
                  {d.calls.slice(0, 8).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate"><span className="ltr me-1 tabular-nums text-ink-500">{dateTime(c.startedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>{c.hero.name}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {c.provider !== 'direct' && <Badge tone="info">{c.provider}</Badge>}
                        <Badge tone={c.status === 'ANSWERED' ? 'success' : c.status === 'INITIATED' ? 'neutral' : 'warning'}>{t(`integrity.call.${c.status}`)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <ConfirmDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        onConfirm={() => (dialog === 'override' ? text.trim().length >= 5 : true) && act.mutate()}
        loading={act.isPending}
        title={dialog === 'override' ? t('integrity.overrideTitle', { tn: d.trackingNumber }) : t('integrity.release')}
        description={dialog === 'override' ? t('integrity.overrideDesc') : undefined}
        confirmLabel={dialog === 'override' ? t('integrity.override') : t('integrity.release')}
      >
        <Field label={dialog === 'override' ? t('integrity.reasonLabel') : t('integrity.noteLabel')} required={dialog === 'override'}>
          {(id) => <Textarea id={id} rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </ConfirmDialog>
      <RecordAnswerModal order={record ? { id: orderId, recipientName: recipientName ?? '' } : null} onClose={() => { setRecord(false); refresh(); }} />
    </div>
  );
}
