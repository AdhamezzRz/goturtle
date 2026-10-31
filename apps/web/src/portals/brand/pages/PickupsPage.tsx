import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Boxes, CalendarDays, Clock, MapPin, Printer, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePollInterval, useQueryState } from '@/lib/hooks';
import { dateOnly, dateTime, num, phone } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import {
  Button, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Field, PageHeader, Pagination, ProgressBar, Skeleton, StateBadge, StatusBadge, Tabs, Textarea, type Column,
} from '@/components/ui';
import { Ltr, Money, useCanCreate } from '../components/common';
import { RequestPickupModal } from '../components/orders';
import type { Pickup, PickupDetail } from '../components/types';
import './i18n';

const TABS = {
  upcoming: 'REQUESTED,ASSIGNED,IN_PROGRESS',
  completed: 'COMPLETED',
  closed: 'CANCELLED,FAILED',
  all: '',
} as const;
type Tab = keyof typeof TABS;

const day = (d: string) => dateTime(d + 'T12:00:00Z', { weekday: 'short', day: 'numeric', month: 'short' });

export default function PickupsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const create = useCanCreate();
  const poll = usePollInterval(30_000);
  const [f, setF] = useQueryState({ tab: 'upcoming', page: '1', id: '' });
  const [open, setOpen] = useState(false);
  const tab = (f.tab in TABS ? f.tab : 'upcoming') as Tab;
  const query = { status: TABS[tab] || undefined, page: Number(f.page) || 1, pageSize: 20, order: tab === 'upcoming' ? 'asc' : 'desc' };
  const list = useQuery({ queryKey: ['pickups', 'list', query], queryFn: () => api<Paginated<Pickup>>('/pickups', { query }), placeholderData: keepPreviousData, refetchInterval: poll });

  const columns: Column<Pickup>[] = [
    { key: 'code', header: t('brand.pickups.code'), cell: (p) => <span className="ltr font-mono font-semibold text-ink-900 dark:text-white">{p.code}</span> },
    {
      key: 'when',
      header: t('brand.pickups.date'),
      cell: (p) => (
        <div>
          <p className="font-medium text-ink-800 dark:text-ink-100">{day(p.scheduledDate)}</p>
          {p.timeWindow && <p className="ltr text-xs text-ink-500">{p.timeWindow}</p>}
        </div>
      ),
    },
    { key: 'loc', header: t('brand.pickups.location'), hideBelow: 'lg', cell: (p) => <div className="max-w-[240px]"><p className="truncate">{p.location?.name}</p><p className="truncate text-xs text-ink-500">{p.location?.addressLine}</p></div> },
    { key: 'status', header: t('common.status'), cell: (p) => <StateBadge value={p.status} label={t(`brand.pickupStatus.${p.status}`)} /> },
    { key: 'hero', header: t('common.hero'), hideBelow: 'md', cell: (p) => p.courier?.name ?? <span className="text-ink-400">{t('brand.pickups.noHero')}</span> },
    {
      key: 'orders',
      header: t('brand.pickups.parcels'),
      align: 'end',
      cell: (p) => (
        <div className="ms-auto w-28">
          <p className="text-xs text-ink-500">{t('brand.pickups.scannedOf', { n: num(p.status === 'COMPLETED' ? p.pickedCount : p.scannedCount), total: num(Math.max(p.ordersCount, p.expectedCount ?? 0)) })}</p>
          <ProgressBar className="mt-1 h-1.5" value={(p.status === 'COMPLETED' ? p.pickedCount : p.scannedCount) / Math.max(1, p.ordersCount, p.expectedCount ?? 0)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('brand.pickups.title')}
        subtitle={t('brand.pickups.subtitle')}
        actions={can('pickups.manage') && <Button icon={<Truck className="h-4 w-4" />} disabled={!create.allowed} title={create.allowed ? undefined : create.reason} onClick={() => setOpen(true)}>{t('brand.pickups.request')}</Button>}
      />
      <Tabs
        value={tab}
        onChange={(v) => setF({ tab: v })}
        tabs={(Object.keys(TABS) as Tab[]).map((k) => ({ value: k, label: t(`brand.pickups.tab.${k}`) }))}
        className="mb-4"
      />
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(p) => p.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(p) => setF({ id: p.id, page: f.page })}
        mobileCard={(p) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="ltr font-mono text-sm font-semibold">{p.code}</span>
              <StateBadge value={p.status} label={t(`brand.pickupStatus.${p.status}`)} />
            </div>
            <p className="text-sm text-ink-700 dark:text-ink-200">{day(p.scheduledDate)} {p.timeWindow && <span className="ltr text-ink-500">· {p.timeWindow}</span>}</p>
            <p className="flex items-center justify-between text-xs text-ink-500">
              <span className="truncate">{p.location?.name}</span>
              <span>{t('brand.pickups.ordersN', { n: num(p.ordersCount) })}</span>
            </p>
          </div>
        )}
        empty={
          <EmptyState
            icon={<Boxes className="h-7 w-7" />}
            title={tab === 'upcoming' ? t('brand.pickups.emptyUpcoming') : t('common.empty')}
            description={tab === 'upcoming' ? t('brand.pickups.emptyHint') : undefined}
            action={tab === 'upcoming' && can('pickups.manage') && create.allowed ? <Button icon={<Truck className="h-4 w-4" />} onClick={() => setOpen(true)}>{t('brand.pickups.request')}</Button> : undefined}
          />
        }
        footer={list.data && list.data.meta.total > 0 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p), id: '' })} /> : undefined}
      />
      <RequestPickupModal open={open} onClose={() => setOpen(false)} onDone={(p) => setF({ tab: 'upcoming', id: p.id })} />
      <PickupDrawer id={f.id} onClose={() => setF({ id: '', page: f.page })} />
    </div>
  );
}

function PickupDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['pickups', 'detail', id], queryFn: () => api<PickupDetail>(`/pickups/${id}`), enabled: !!id });
  const cancel = useMutation({
    mutationFn: () => api(`/pickups/${id}/cancel`, { method: 'POST', body: { reason: reason.trim() || undefined } }),
    onSuccess: () => {
      toast.success(t('brand.pickups.cancelled'));
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ['pickups'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const p = q.data;
  const cancellable = p && ['REQUESTED', 'ASSIGNED'].includes(p.status) && can('pickups.manage');
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={p ? <span className="ltr">{p.code}</span> : t('brand.pickups.title')}
      footer={
        p && (
          <>
            {cancellable && <Button variant="ghost" className="me-auto text-red-600" icon={<Ban className="h-4 w-4" />} onClick={() => setConfirm(true)}>{t('brand.pickups.cancel')}</Button>}
            {p.orders.length > 0 && <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => navigate(`/brand/orders/labels?ids=${p.orders.map((o) => o.id).join(',')}`)}>{t('brand.orders.printLabels')}</Button>}
          </>
        )
      }
    >
      {q.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : p ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <StateBadge value={p.status} label={t(`brand.pickupStatus.${p.status}`)} />
            <span className="text-xs text-ink-500">{t('brand.common.created')}: {dateTime(p.createdAt)}</span>
          </div>
          <ul className="space-y-3 rounded-2xl bg-ink-50 p-4 text-sm dark:bg-ink-800/50">
            <li className="flex items-start gap-3"><CalendarDays className="mt-0.5 h-4 w-4 text-ink-400" /><span>{dateOnly(p.scheduledDate + 'T12:00:00Z')}</span></li>
            {p.timeWindow && <li className="flex items-start gap-3"><Clock className="mt-0.5 h-4 w-4 text-ink-400" /><span className="ltr">{p.timeWindow}</span></li>}
            {p.location && (
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 text-ink-400" />
                <div><p className="font-medium">{p.location.name}</p><p className="text-ink-500">{p.location.addressLine}</p><p className="text-ink-500">{p.location.contactName} · <Ltr>{phone(p.location.phone)}</Ltr></p></div>
              </li>
            )}
            <li className="flex items-start gap-3"><User className="mt-0.5 h-4 w-4 text-ink-400" /><span>{p.courier ? `${p.courier.name} (${p.courier.code})` : t('brand.pickups.noHero')}</span></li>
            {p.notes && <li className="text-ink-600 dark:text-ink-300">“{p.notes}”</li>}
            {p.failureNote && <li className="text-red-600">{p.failureNote}</li>}
          </ul>
          <div>
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-ink-900 dark:text-white">
              {t('brand.pickups.attached', { n: num(p.orders.length) })}
              {p.expectedCount ? <span className="font-normal text-ink-500">{t('brand.pickups.expectedN', { n: num(p.expectedCount) })}</span> : null}
            </h3>
            {p.orders.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-500 dark:border-ink-700">{t('brand.pickups.noOrders')}</p>
            ) : (
              <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
                {p.orders.map((o) => (
                  <li key={o.id}>
                    <Link to={`/brand/orders/${o.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800/50">
                      <div className="min-w-0 flex-1">
                        <p><span className="ltr font-mono text-sm font-semibold">{o.trackingNumber}</span></p>
                        <p className="truncate text-xs text-ink-500">{o.recipientName}</p>
                      </div>
                      <Money cents={o.collectCents} className="text-sm" />
                      <StatusBadge status={o.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => cancel.mutate()} loading={cancel.isPending} danger title={t('brand.pickups.cancelTitle')} description={t('brand.pickups.cancelBody')} confirmLabel={t('brand.pickups.cancel')}>
        <Field label={t('brand.order.cancelReason')} hint={t('brand.common.optional')}>{(fid) => <Textarea id={fid} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </Drawer>
  );
}
