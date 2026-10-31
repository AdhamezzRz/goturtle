import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck, Package } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePollInterval, useQueryState } from '@/lib/hooks';
import { ago, dateTime } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs } from '@/components/ui';
import type { AppNotification } from '../components/types';
import './i18n';

export default function NotificationsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const poll = usePollInterval(30_000);
  const [f, setF] = useQueryState({ tab: 'all', page: '1' });
  const query = { unread: f.tab === 'unread' || undefined, page: Number(f.page) || 1, pageSize: 20 };
  const q = useQuery({ queryKey: ['notifications', 'list', query], queryFn: () => api<Paginated<AppNotification> & { unread: number }>('/notifications', { query }), placeholderData: keepPreviousData, refetchInterval: poll });
  const inv = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: () => { inv(); toast.success(t('brand.notif.allRead')); }, onError: (e) => toast.error(errorMessage(e)) });
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: inv });

  const open = (n: AppNotification) => {
    if (!n.readAt) read.mutate(n.id);
    const ticketId = typeof n.data?.ticketId === 'string' ? n.data.ticketId : null;
    const settlementId = typeof n.data?.settlementId === 'string' ? n.data.settlementId : null;
    if (n.orderId) navigate(`/brand/orders/${n.orderId}`);
    else if (ticketId) navigate(`/brand/support/${ticketId}`);
    else if (settlementId) navigate(`/brand/wallet/settlements/${settlementId}`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('nav.notifications')}
        subtitle={q.data ? t('brand.notif.unreadN', { n: q.data.unread }) : undefined}
        actions={<Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} disabled={!q.data?.unread} loading={readAll.isPending} onClick={() => readAll.mutate()}>{t('brand.notif.markAll')}</Button>}
      />
      <Tabs value={f.tab} onChange={(v) => setF({ tab: v })} className="mb-4" tabs={[{ value: 'all', label: t('common.all') }, { value: 'unread', label: t('brand.notif.unread'), count: q.data?.unread }]} />
      <Card padded={false}>
        {q.isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.data.length ? (
          <EmptyState icon={f.tab === 'unread' ? <BellOff className="h-7 w-7" /> : <Bell className="h-7 w-7" />} title={f.tab === 'unread' ? t('brand.notif.noneUnread') : t('brand.notif.none')} description={t('brand.notif.noneHint')} />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {q.data.data.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => open(n)} className={cn('flex w-full items-start gap-3 px-5 py-4 text-start transition hover:bg-ink-50 dark:hover:bg-ink-800/50', !n.readAt && 'bg-turtle-50/40 dark:bg-turtle-950/20')}>
                  <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl', n.readAt ? 'bg-ink-100 text-ink-500 dark:bg-ink-800' : 'bg-turtle-100 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300')}>
                    {n.orderId ? <Package className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    {n.title && <span className={cn('block text-sm', n.readAt ? 'text-ink-700 dark:text-ink-200' : 'font-semibold text-ink-900 dark:text-white')}>{n.title}</span>}
                    <span className="block text-sm text-ink-600 dark:text-ink-300">{n.body}</span>
                    <time className="mt-1 block text-xs text-ink-400" title={dateTime(n.createdAt)}>{ago(n.createdAt)}</time>
                  </span>
                  {!n.readAt && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-turtle-500" aria-label={t('brand.notif.unread')} />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.data && q.data.meta.totalPages > 1 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} />}
      </Card>
    </div>
  );
}
