import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, CheckCircle2, Lock, Paperclip, RotateCcw, Send, StickyNote, UserCheck } from 'lucide-react';
import { TicketCategory, type TicketStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePollInterval } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Avatar, Badge, Button, ErrorState, Field, Select, Skeleton, StateBadge, StatusBadge, Textarea } from '@/components/ui';
import { InfoRow, Mono, NoAccess, PhoneLink, SectionCard, Segmented, SlaChip } from '../../components/opsa/ui';
import type { TicketMessage, TicketRow } from '../../components/opsa/types';
import { useAssigneeOptions } from './TicketsPage';
import './i18n';

interface TicketDetail extends TicketRow { messages: TicketMessage[] }

const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'];

export default function TicketDetailPage() {
  const { id = '' } = useParams();
  const { t, dir } = useI18n();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const poll = usePollInterval(30_000);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [body, setBody] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api<TicketDetail>(`/tickets/${id}`), enabled: can('tickets.read'), refetchInterval: poll });
  const assignees = useAssigneeOptions().filter((o) => o.value !== 'none');
  const manage = can('tickets.manage');
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['ticket', id] });
    void qc.invalidateQueries({ queryKey: ['tickets'] });
  };
  const reply = useMutation({
    mutationFn: () => api(`/tickets/${id}/messages`, { method: 'POST', body: { body: body.trim(), isInternal: mode === 'note' } }),
    onSuccess: () => {
      toast.success(mode === 'note' ? t('ops.tickets.d.noted') : t('ops.tickets.d.sent'));
      setBody('');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: (status: TicketStatus) => api(`/tickets/${id}/status`, { method: 'POST', body: { status } }),
    onSuccess: () => { toast.success(t('ops.tickets.d.statusChanged')); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const assign = useMutation({
    mutationFn: (assigneeId: string | null) => api(`/tickets/${id}/assign`, { method: 'POST', body: { assigneeId } }),
    onSuccess: () => { toast.success(t('ops.tickets.d.assigned')); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const patch = useMutation({
    mutationFn: (b: Record<string, string>) => api(`/tickets/${id}`, { method: 'PATCH', body: b }),
    onSuccess: () => { toast.success(t('ops.tickets.d.updated')); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const count = q.data?.messages.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [count]);

  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  if (!can('tickets.read')) return <NoAccess />;
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const tk = q.data;
  const closed = tk.status === 'CLOSED';
  const done = tk.status === 'RESOLVED' || closed;
  const resolveAssign = (v: string) => (v === 'me' ? me?.id ?? null : v);

  return (
    <div className="space-y-6">
      <Link to="/ops/tickets" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"><Back className="h-4 w-4" /> {t('ops.tickets.d.back')}</Link>
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Mono className="text-sm text-ink-500">{tk.code}</Mono>
              <StateBadge value={tk.status} />
              <StateBadge value={tk.priority} />
              <Badge>{t(`ops.opsa.ticketCat.${tk.category}`)}</Badge>
              {tk.breached && <Badge tone="danger">{t('ops.tickets.breached')}</Badge>}
            </div>
            <h1 className="mt-1.5 font-display text-xl font-bold text-ink-900 dark:text-white sm:text-2xl">{tk.subject}</h1>
          </div>
          {manage && (
            <div className="flex flex-wrap gap-2">
              {!tk.assigneeId && me && <Button variant="outline" icon={<UserCheck className="h-4 w-4" />} loading={assign.isPending} onClick={() => assign.mutate(me.id)}>{t('ops.tickets.d.assignMe')}</Button>}
              {!done && <Button icon={<CheckCircle2 className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate('RESOLVED')}>{t('ops.tickets.d.resolve')}</Button>}
              {done && <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate('OPEN')}>{t('ops.tickets.d.reopen')}</Button>}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title={t('ops.tickets.d.conversation')} className="min-w-0 lg:col-span-2" padded={false}>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto bg-ink-50/50 p-4 dark:bg-ink-950/30 sm:p-5">
            {tk.messages.map((m) => {
              const mine = m.authorType === 'STAFF';
              return (
                <div key={m.id} className={cn('flex gap-3', mine && 'flex-row-reverse')}>
                  <Avatar name={m.authorName ?? m.authorType} size={32} />
                  <div className={cn('max-w-[85%] min-w-0', mine && 'text-end')}>
                    <p className="mb-1 text-xs text-ink-500">
                      <b className="font-semibold text-ink-700 dark:text-ink-200">{m.authorName ?? t(`ops.opsa.actor.${m.authorType}`)}</b> · {t(`ops.opsa.actor.${m.authorType}`)} · {dateTime(m.createdAt)}
                    </p>
                    <div
                      className={cn(
                        'whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-start text-sm',
                        m.isInternal
                          ? 'border border-dashed border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100'
                          : mine
                            ? 'bg-turtle-600 text-white'
                            : 'border border-ink-100 bg-white text-ink-800 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100',
                      )}
                    >
                      {m.isInternal && <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"><Lock className="h-3 w-3" />{t('ops.tickets.d.internal')}</p>}
                      {m.body}
                      {m.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.attachments.map((a, i) => (
                            <a key={a} href={a} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs underline', mine && !m.isInternal ? 'bg-white/15' : 'bg-ink-100 dark:bg-ink-800')}>
                              <Paperclip className="h-3 w-3" />{t('ops.tickets.d.attachment', { n: i + 1 })}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          {manage && !closed ? (
            <form
              className={cn('space-y-3 border-t p-4 dark:border-ink-800', mode === 'note' ? 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/20' : 'border-ink-100')}
              onSubmit={(e) => { e.preventDefault(); if (body.trim()) reply.mutate(); }}
            >
              <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'reply', label: t('ops.tickets.d.mode.reply') }, { value: 'note', label: <span className="flex items-center gap-1"><StickyNote className="h-3.5 w-3.5" />{t('ops.tickets.d.mode.note')}</span> }]} />
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) reply.mutate(); }}
                placeholder={mode === 'note' ? t('ops.tickets.d.notePh') : t('ops.tickets.d.replyPh')}
                aria-label={mode === 'note' ? t('ops.tickets.d.notePh') : t('ops.tickets.d.replyPh')}
                maxLength={5000}
                className={cn(mode === 'note' && 'border-amber-300 focus:border-amber-500 focus:ring-amber-500/25')}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-500">{mode === 'note' ? t('ops.tickets.d.internalHint') : <span className="ltr">Ctrl + Enter</span>}</p>
                <Button type="submit" variant={mode === 'note' ? 'cash' : 'primary'} icon={mode === 'note' ? <StickyNote className="h-4 w-4" /> : <Send className="h-4 w-4" />} loading={reply.isPending} disabled={!body.trim()}>
                  {mode === 'note' ? t('ops.tickets.d.addNote') : t('ops.tickets.d.send')}
                </Button>
              </div>
            </form>
          ) : closed ? (
            <p className="border-t border-ink-100 p-4 text-center text-sm text-ink-500 dark:border-ink-800">{t('ops.tickets.d.closed')}</p>
          ) : null}
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title={t('ops.tickets.d.details')}>
            <div className="space-y-3">
              {manage && (
                <>
                  <Field label={t('ops.tickets.d.status')}>{(fid) => <Select id={fid} value={tk.status} disabled={setStatus.isPending} onChange={(e) => setStatus.mutate(e.target.value as TicketStatus)} options={STATUSES.map((s) => ({ value: s, label: t(`state.${s}`) }))} />}</Field>
                  <Field label={t('ops.tickets.d.assignee')}>
                    {(fid) => (
                      <Select
                        id={fid}
                        value={tk.assigneeId ?? ''}
                        disabled={assign.isPending}
                        onChange={(e) => assign.mutate(e.target.value ? resolveAssign(e.target.value) : null)}
                        placeholder={t('ops.opsa.unassigned')}
                        options={[...(tk.assignee && !assignees.some((a) => a.value === tk.assigneeId) ? [{ value: tk.assignee.id, label: tk.assignee.name }] : []), ...assignees]}
                      />
                    )}
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('ops.tickets.d.priority')}>{(fid) => <Select id={fid} value={tk.priority} onChange={(e) => patch.mutate({ priority: e.target.value })} options={['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((p) => ({ value: p, label: t(`state.${p}`) }))} />}</Field>
                    <Field label={t('ops.tickets.d.category')}>{(fid) => <Select id={fid} value={tk.category} onChange={(e) => patch.mutate({ category: e.target.value })} options={Object.keys(TicketCategory).map((c) => ({ value: c, label: t(`ops.opsa.ticketCat.${c}`) }))} />}</Field>
                  </div>
                </>
              )}
              <div className="divide-y divide-ink-100 dark:divide-ink-800">
                <InfoRow label={t('ops.tickets.d.slaDue')}><SlaChip due={tk.slaDueAt} done={done && !tk.breached} warnMs={3_600_000} /></InfoRow>
                {!manage && <InfoRow label={t('ops.tickets.d.assignee')}>{tk.assignee?.name ?? t('ops.opsa.unassigned')}</InfoRow>}
                {tk.order && (
                  <InfoRow label={t('ops.tickets.d.order')}>
                    <span className="inline-flex flex-col items-end gap-1">
                      <Link to={`/ops/orders/${tk.order.id}`} className="font-mono text-turtle-700 hover:underline dark:text-turtle-400"><span className="ltr">{tk.order.trackingNumber}</span></Link>
                      {tk.order.status && <StatusBadge status={tk.order.status} />}
                    </span>
                  </InfoRow>
                )}
                {tk.brand && <InfoRow label={t('ops.tickets.d.brand')}>{tk.brand.name}</InfoRow>}
                {(tk.contactName || tk.contactPhone) && <InfoRow label={t('ops.tickets.d.contact')}>{tk.contactName} <PhoneLink value={tk.contactPhone} className="ms-1" /></InfoRow>}
                <InfoRow label={t('ops.tickets.d.openedBy')}>{t(`ops.opsa.actor.${tk.openedByType}`)}</InfoRow>
                <InfoRow label={t('ops.tickets.d.created')}>{dateTime(tk.createdAt)}</InfoRow>
                {tk.resolvedAt && <InfoRow label={t('ops.tickets.d.resolved')}>{dateTime(tk.resolvedAt)}</InfoRow>}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
