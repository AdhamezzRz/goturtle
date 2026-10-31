import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, Package, Paperclip, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { usePollInterval } from '@/lib/hooks';
import { ago, dateTime } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Skeleton, StateBadge, StatusBadge, Textarea } from '@/components/ui';
import type { TicketDetail } from '../components/types';
import './i18n';

export default function TicketDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const poll = usePollInterval(15_000);
  const q = useQuery({ queryKey: ['tickets', 'detail', id], queryFn: () => api<TicketDetail>(`/tickets/${id}`), refetchInterval: poll });
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Array<{ name: string; url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const count = q.data?.messages.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [count]);

  const reply = useMutation({
    mutationFn: () => api(`/tickets/${id}/messages`, { method: 'POST', body: { body: body.trim(), attachments: files.length ? files.map((f) => f.url) : undefined } }),
    onSuccess: () => {
      setBody('');
      setFiles([]);
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const status = useMutation({
    mutationFn: (s: 'RESOLVED' | 'CLOSED') => api(`/tickets/${id}/status`, { method: 'POST', body: { status: s } }),
    onSuccess: () => {
      toast.success(t('brand.support.resolvedToast'));
      setResolveOpen(false);
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const attach = async (fl: FileList | null) => {
    if (!fl?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(fl).slice(0, 5)) {
        if (f.size > 10 * 1024 * 1024) {
          toast.error(t('brand.support.fileTooBig'));
          continue;
        }
        const up = await uploadFile(f, 'ticket_attachment');
        setFiles((x) => [...x, { name: f.name, url: up.url }]);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const back = <Link to="/brand/support" className="inline-flex items-center gap-1 hover:text-ink-800 dark:hover:text-ink-200"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('brand.support.title')}</Link>;
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-96 w-full" /></div>;
  if (q.isError || !q.data) return <Card><div className="mb-2 text-sm text-ink-500">{back}</div>{q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title={t('error.NOT_FOUND')} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />}</Card>;
  const tk = q.data;
  const closed = tk.status === 'CLOSED';
  const resolved = tk.status === 'RESOLVED';

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-sm text-ink-500">{back}</div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{tk.subject}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-500">
              <span className="ltr font-mono">{tk.code}</span>
              <StateBadge value={tk.status} />
              <StateBadge value={tk.priority} />
              <Badge>{t(`brand.ticketCat.${tk.category}`)}</Badge>
              {tk.breached && <Badge tone="danger">{t('brand.support.overdue')}</Badge>}
            </div>
          </div>
          {can('tickets.manage') && !closed && !resolved && (
            <Button variant="outline" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setResolveOpen(true)}>{t('brand.support.markResolved')}</Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2" padded={false}>
          <ol className="flex-1 space-y-4 p-4 sm:p-6">
            {tk.messages.map((m) => {
              const mine = m.authorType === 'BRAND';
              const staff = m.authorType === 'STAFF';
              return (
                <li key={m.id} className={cn('flex gap-3', mine && 'flex-row-reverse')}>
                  <Avatar name={m.authorName} size={34} className={staff ? 'ring-2 ring-turtle-400' : ''} />
                  <div className={cn('max-w-[85%] sm:max-w-[75%]', mine && 'text-end')}>
                    <div className={cn('mb-1 flex flex-wrap items-baseline gap-2 text-xs text-ink-500', mine && 'justify-end')}>
                      <span className="font-semibold text-ink-700 dark:text-ink-200">{m.authorName}</span>
                      {staff && <span className="rounded bg-turtle-100 px-1.5 text-[10px] font-semibold text-turtle-800 dark:bg-turtle-950 dark:text-turtle-300">{t('brand.support.goturtleTeam')}</span>}
                      <time title={dateTime(m.createdAt)}>{ago(m.createdAt)}</time>
                    </div>
                    <div className={cn('inline-block whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-start text-sm', mine ? 'rounded-se-sm bg-turtle-600 text-white' : 'rounded-ss-sm bg-ink-100 text-ink-800 dark:bg-ink-800 dark:text-ink-100')}>
                      {m.body}
                      {m.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.attachments.map((a, i) => (
                            <a key={a} href={a} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs underline', mine ? 'bg-white/15' : 'bg-white dark:bg-ink-900')}>
                              <Paperclip className="h-3 w-3" />{t('brand.support.attachment', { n: i + 1 })}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            <div ref={endRef} />
          </ol>
          {closed ? (
            <div className="border-t border-ink-100 p-4 text-center text-sm text-ink-500 dark:border-ink-800">{t('brand.support.closedHint')}</div>
          ) : can('tickets.manage') ? (
            <form className="border-t border-ink-100 p-3 dark:border-ink-800 sm:p-4" onSubmit={(e) => { e.preventDefault(); if (body.trim()) reply.mutate(); }}>
              {resolved && <p className="mb-2 flex items-center gap-1 text-xs text-ink-500"><RotateCcw className="h-3.5 w-3.5" />{t('brand.support.reopenHint')}</p>}
              <Textarea
                rows={3}
                value={body}
                maxLength={5000}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('brand.support.replyPh')}
                aria-label={t('brand.support.message')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) reply.mutate();
                }}
              />
              {files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {files.map((f) => (
                    <li key={f.url} className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-1 text-xs dark:bg-ink-800">
                      <Paperclip className="h-3 w-3" />{f.name}
                      <button type="button" aria-label={t('action.delete')} onClick={() => setFiles((x) => x.filter((y) => y.url !== f.url))} className="ms-1 text-ink-400 hover:text-red-600">×</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
                  <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="sr-only" onChange={(e) => attach(e.target.files)} />
                  <Paperclip className="h-4 w-4" />{uploading ? t('common.loading') : t('brand.support.attach')}
                </label>
                <Button type="submit" loading={reply.isPending} disabled={!body.trim() || uploading} icon={<Send className="h-4 w-4 rtl:-scale-x-100" />}>{t('brand.support.send')}</Button>
              </div>
            </form>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <dl className="space-y-3 text-sm">
              <Item label={t('brand.common.created')} value={dateTime(tk.createdAt)} />
              <Item label={t('brand.support.updated')} value={ago(tk.updatedAt)} />
              {tk.slaDueAt && !tk.resolvedAt && <Item label={t('brand.support.dueBy')} value={<span className={cn('inline-flex items-center gap-1', tk.breached && 'text-red-600')}><Clock className="h-3.5 w-3.5" />{dateTime(tk.slaDueAt)}</span>} />}
              {tk.resolvedAt && <Item label={t('brand.support.resolvedAt')} value={dateTime(tk.resolvedAt)} />}
              <Item label={t('brand.support.assignee')} value={tk.assignee?.name ?? t('brand.support.unassigned')} />
              <Item label={t('brand.support.openedBy')} value={t(`brand.actor.${tk.openedByType}`)} />
            </dl>
          </Card>
          {tk.order && (
            <Card>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-white"><Package className="h-4 w-4 text-ink-400" />{t('brand.support.linkedOrder')}</p>
              <Link to={`/brand/orders/${tk.order.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-ink-50 px-3 py-2 hover:bg-ink-100 dark:bg-ink-800/60 dark:hover:bg-ink-800">
                <span className="ltr font-mono text-sm font-semibold text-turtle-700 dark:text-turtle-400">{tk.order.trackingNumber}</span>
                {tk.order.status && <StatusBadge status={tk.order.status} />}
              </Link>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog open={resolveOpen} onClose={() => setResolveOpen(false)} onConfirm={() => status.mutate('RESOLVED')} loading={status.isPending} title={t('brand.support.resolveTitle')} description={t('brand.support.resolveBody')} confirmLabel={t('brand.support.markResolved')} />
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-end font-medium text-ink-900 dark:text-ink-100">{value}</dd>
    </div>
  );
}
