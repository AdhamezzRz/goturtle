import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, Check, CheckCheck, ChevronLeft, ChevronRight, Headphones, Package, Receipt, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { ago, dateTime, num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePollInterval, useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, Tabs } from '@/components/ui';
import './i18n';

type Notif = { id: string; template: string; title: string | null; body: string; data: Record<string, unknown> | null; status: string; readAt: string | null; createdAt: string; orderId: string | null };
type NotifPage = Paginated<Notif> & { unread: number };

/** Where a notification should take an ops user. */
function linkOf(n: Notif): string | null {
  const d = n.data ?? {};
  const link = typeof d.link === 'string' ? d.link : '';
  if (link.startsWith('/ops/')) return link;
  if (typeof d.ticketId === 'string') return `/ops/tickets/${d.ticketId}`;
  if (typeof d.settlementId === 'string') return `/ops/finance/settlements/${d.settlementId}`;
  if (typeof d.payoutId === 'string') return '/ops/finance/payouts';
  if (typeof d.handoverId === 'string') return '/ops/cash?tab=handovers';
  if (typeof d.courierId === 'string') return `/ops/heroes/${d.courierId}`;
  if (typeof d.brandId === 'string') return `/ops/brands/${d.brandId}`;
  const orderId = n.orderId ?? (typeof d.orderId === 'string' ? d.orderId : null);
  if (orderId) return `/ops/orders/${orderId}`;
  return null;
}

function iconOf(template: string) {
  if (template.startsWith('ticket')) return <Headphones className="h-4 w-4" />;
  if (template.startsWith('settlement')) return <Receipt className="h-4 w-4" />;
  if (template.includes('cash') || template.includes('handover') || template.includes('payout')) return <Wallet className="h-4 w-4" />;
  if (template.includes('order') || template.includes('deliver')) return <Package className="h-4 w-4" />;
  return <BellRing className="h-4 w-4" />;
}

export default function NotificationsPage() {
  const { t, dir } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const poll = usePollInterval(30_000);
  const [s, setS] = useQueryState({ view: 'all' });
  const unreadOnly = s.view === 'unread';
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list', unreadOnly],
    queryFn: ({ pageParam }) => api<NotifPage>('/notifications', { query: { page: pageParam, pageSize: 20, unread: unreadOnly ? 'true' : undefined } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    refetchInterval: poll,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;
  const read = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => { toast.success(t('ops.account.notif.allRead')); qc.invalidateQueries({ queryKey: ['notifications'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const Arrow = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const open = (n: Notif) => {
    if (!n.readAt) read.mutate(n.id);
    const link = linkOf(n);
    if (link) nav(link);
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('ops.account.notif.title')}
        subtitle={t('ops.account.notif.subtitle')}
        actions={<Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} disabled={!unread} loading={readAll.isPending} onClick={() => readAll.mutate()}>{t('ops.account.notif.markAll')}</Button>}
      />
      <Tabs className="mb-4" value={s.view} onChange={(v) => setS({ view: v })} tabs={[{ value: 'all', label: t('ops.account.notif.all') }, { value: 'unread', label: t('ops.account.notif.unread'), count: unread }]} />
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : q.error ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<Bell className="h-7 w-7" />} title={t('ops.account.notif.empty')} description={t('ops.account.notif.emptyHint')} /></Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {items.map((n) => {
              const link = linkOf(n);
              return (
                <li key={n.id} className={cn('flex items-start gap-3 p-4', !n.readAt && 'bg-turtle-50/50 dark:bg-turtle-950/20')}>
                  <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl', !n.readAt ? 'bg-turtle-100 text-turtle-700 dark:bg-turtle-900/60 dark:text-turtle-200' : 'bg-ink-100 text-ink-500 dark:bg-ink-800')}>{iconOf(n.template)}</span>
                  <button type="button" onClick={() => open(n)} className="min-w-0 flex-1 text-start focus-visible:rounded-lg">
                    <p className={cn('text-sm', !n.readAt ? 'font-semibold text-ink-900 dark:text-white' : 'text-ink-700 dark:text-ink-200')}>{n.title ?? n.template}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-500" dir="auto">{n.body}</p>
                    <p className="mt-1 text-xs text-ink-400" title={dateTime(n.createdAt)}>{ago(n.createdAt)}</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {!n.readAt && <IconButton label={t('ops.account.notif.markRead')} icon={<Check className="h-4 w-4" />} onClick={() => read.mutate(n.id)} />}
                    {link && <IconButton label={t('ops.account.notif.open')} icon={<Arrow className="h-4 w-4" />} onClick={() => open(n)} />}
                  </div>
                </li>
              );
            })}
          </ul>
          {q.hasNextPage && (
            <div className="border-t border-ink-100 p-3 text-center dark:border-ink-800">
              <Button variant="ghost" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{t('action.next')} · {num(items.length)} / {num(q.data?.pages[0]?.meta.total)}</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
