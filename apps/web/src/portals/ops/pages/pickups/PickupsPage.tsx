import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Boxes, Clock, MapPin, UserPlus } from 'lucide-react';
import type { OrderStatus, PickupStatus } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { dateOnly, dateTime, money, num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, ProgressBar, Select, Skeleton, StateBadge, StatusBadge, Textarea, type Column } from '@/components/ui';
import { CallButton, InfoRow, Mono, NoAccess, PhoneLink, ResponsiveFilters, SearchInput, Segmented } from '../../components/opsa/ui';
import { useCouriers, useLookupOptions } from '../../components/opsa/lookups';
import type { CourierRow, PickupRow } from '../../components/opsa/types';
import './i18n';

interface PickupDetail extends PickupRow {
  orders: Array<{ id: string; trackingNumber: string; brandReference: string | null; status: OrderStatus; recipientName: string; codAmountCents: number; collectCents: number; itemsCount: number; pickedUpAt: string | null; scanned: boolean }>;
}

const TABS = ['open', 'REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'all'] as const;
const OPEN: PickupStatus[] = ['REQUESTED', 'ASSIGNED'];

export default function PickupsPage() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const [f, setF] = useQueryState({ status: 'open', q: '', brand: '', hub: '', hero: '', from: '', to: '', page: '1', id: '' });
  const { hubs, brands } = useLookupOptions();
  const couriers = useCouriers();
  const [assignFor, setAssignFor] = useState<PickupRow | null>(null);

  const status = f.status === 'open' ? 'REQUESTED,ASSIGNED,IN_PROGRESS' : f.status === 'all' ? undefined : f.status;
  const query = { status, q: f.q || undefined, brandId: f.brand || undefined, hubId: f.hub || undefined, courierId: f.hero || undefined, from: f.from || undefined, to: f.to || undefined, page: Number(f.page) || 1, pageSize: 25, order: 'asc' };
  const list = useQuery({ queryKey: ['pickups', query], queryFn: () => api<Paginated<PickupRow>>('/pickups', { query }), placeholderData: keepPreviousData, enabled: can('pickups.read') });
  const needs = useQuery({ queryKey: ['pickups', { status: 'REQUESTED', pageSize: 1 }], queryFn: () => api<Paginated<unknown>>('/pickups', { query: { status: 'REQUESTED', pageSize: 1 } }), enabled: can('pickups.read') });

  if (!can('pickups.read')) return <NoAccess />;
  const active = ['brand', 'hub', 'hero', 'from', 'to'].filter((k) => f[k as keyof typeof f]).length;
  const manage = can('pickups.manage');
  const zoneName = (p: PickupRow) => (p.zone ? (locale === 'ar' ? p.zone.nameAr : p.zone.nameEn) : '—');

  const columns: Column<PickupRow>[] = [
    { key: 'code', header: t('ops.pickups.col.code'), cell: (p) => <Mono className="font-semibold text-ink-900 dark:text-white">{p.code}</Mono> },
    {
      key: 'brand',
      header: t('ops.pickups.col.brand'),
      cell: (p) => (
        <div className="max-w-[260px]">
          <p className="truncate font-medium text-ink-900 dark:text-ink-100">{p.brand.name}</p>
          <p className="truncate text-xs text-ink-500">{p.location?.name} · {zoneName(p)}</p>
        </div>
      ),
    },
    {
      key: 'when',
      header: t('ops.pickups.col.when'),
      cell: (p) => (
        <div className="whitespace-nowrap">
          <p>{dateOnly(p.scheduledDate)}</p>
          {p.timeWindow && <p className="ltr text-start text-xs text-ink-500">{p.timeWindow}</p>}
        </div>
      ),
    },
    {
      key: 'parcels',
      header: t('ops.pickups.col.parcels'),
      hideBelow: 'lg',
      cell: (p) => (
        <div className="w-32">
          <p className="text-xs text-ink-600 dark:text-ink-300">{t('ops.pickups.picked', { p: num(p.scannedCount), a: num(p.ordersCount) })}</p>
          <ProgressBar value={p.ordersCount ? p.scannedCount / p.ordersCount : 0} className="mt-1 h-1.5" />
          {p.expectedCount != null && <p className="mt-0.5 text-[11px] text-ink-400">{t('ops.pickups.expected', { n: num(p.expectedCount) })}</p>}
        </div>
      ),
    },
    { key: 'hero', header: t('ops.pickups.col.hero'), cell: (p) => (p.courier ? <span className="whitespace-nowrap">{p.courier.name}</span> : <Badge tone="warning">{t('ops.opsa.unassigned')}</Badge>) },
    { key: 'status', header: t('ops.pickups.col.status'), cell: (p) => <StateBadge value={p.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (p) =>
        manage && OPEN.includes(p.status) ? (
          <Button size="xs" variant={p.courier ? 'outline' : 'primary'} icon={<UserPlus className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setAssignFor(p); }}>
            {p.courier ? t('ops.pickups.reassign') : t('ops.pickups.assign')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('ops.pickups.title')} subtitle={t('ops.pickups.subtitle')} />
      <Segmented
        value={f.status as (typeof TABS)[number]}
        onChange={(v) => setF({ status: v })}
        options={TABS.map((s) => ({ value: s, label: t(`ops.pickups.tab.${s}`), count: s === 'REQUESTED' ? needs.data?.meta.total : s === f.status ? list.data?.meta.total : undefined }))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t('ops.pickups.search')} className="min-w-0 flex-1 md:max-w-sm" />
        <ResponsiveFilters active={active} onClear={() => setF({ brand: '', hub: '', hero: '', from: '', to: '' })} cols={5}>
          {can('brands.read') && <Field label={t('common.brand')}>{(id) => <Select id={id} value={f.brand} onChange={(e) => setF({ brand: e.target.value })} options={brands} placeholder={t('ops.opsa.anyBrand')} />}</Field>}
          <Field label={t('common.hub')}>{(id) => <Select id={id} value={f.hub} onChange={(e) => setF({ hub: e.target.value })} options={hubs} placeholder={t('ops.opsa.anyHub')} />}</Field>
          <Field label={t('common.hero')}>{(id) => <Select id={id} value={f.hero} onChange={(e) => setF({ hero: e.target.value })} options={(couriers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.code}` }))} placeholder={t('ops.opsa.anyHero')} />}</Field>
          <Field label={t('ops.pickups.from')}>{(id) => <input id={id} type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} className="ltr h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm dark:border-ink-700 dark:bg-ink-900" />}</Field>
          <Field label={t('ops.pickups.to')}>{(id) => <input id={id} type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} className="ltr h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm dark:border-ink-700 dark:bg-ink-900" />}</Field>
        </ResponsiveFilters>
      </div>

      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(p) => p.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(p) => setF({ id: p.id })}
        empty={<EmptyState icon={<Boxes className="h-7 w-7" />} title={t('ops.pickups.empty')} />}
        mobileCard={(p) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Mono className="font-semibold">{p.code}</Mono>
              <StateBadge value={p.status} />
            </div>
            <p className="truncate text-sm font-medium">{p.brand.name} <span className="text-ink-500">· {p.location?.name}</span></p>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
              <span>{dateOnly(p.scheduledDate)}</span>
              {p.timeWindow && <span className="ltr">{p.timeWindow}</span>}
              <span>·</span>
              <span>{zoneName(p)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              {p.courier ? <span className="text-xs">{p.courier.name}</span> : <Badge tone="warning">{t('ops.opsa.unassigned')}</Badge>}
              {manage && OPEN.includes(p.status) && (
                <Button size="xs" variant={p.courier ? 'outline' : 'primary'} onClick={(e) => { e.stopPropagation(); setAssignFor(p); }}>{p.courier ? t('ops.pickups.reassign') : t('ops.pickups.assign')}</Button>
              )}
            </div>
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : undefined}
      />

      <PickupDrawer id={f.id} onClose={() => setF({ id: '' })} onAssign={setAssignFor} />
      {assignFor && <AssignPickupModal pickup={assignFor} onClose={() => setAssignFor(null)} />}
    </div>
  );
}

function PickupDrawer({ id, onClose, onAssign }: { id: string; onClose: () => void; onAssign: (p: PickupRow) => void }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['pickup', id], queryFn: () => api<PickupDetail>(`/pickups/${id}`), enabled: !!id });
  const cancel = useMutation({
    mutationFn: () => api(`/pickups/${id}/cancel`, { method: 'POST', body: { reason: reason || undefined } }),
    onSuccess: () => {
      toast.success(t('ops.pickups.cancelled'));
      setCancelOpen(false);
      void qc.invalidateQueries({ queryKey: ['pickups'] });
      void qc.invalidateQueries({ queryKey: ['pickup', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const p = q.data;
  const open = p && OPEN.includes(p.status);
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={p ? t('ops.pickups.detail', { code: p.code }) : '…'}
      footer={
        p && can('pickups.manage') && open ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="ghost" className="text-red-600" icon={<Ban className="h-4 w-4" />} onClick={() => { setReason(''); setCancelOpen(true); }}>{t('ops.pickups.cancel')}</Button>
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => onAssign(p)}>{p.courier ? t('ops.pickups.reassign') : t('ops.pickups.assign')}</Button>
          </div>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : p ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge value={p.status} />
            <span className="text-sm font-semibold">{p.brand.name}</span>
          </div>
          <section className="rounded-2xl border border-ink-100 p-4 dark:border-ink-800">
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              <InfoRow label={t('ops.pickups.date')}>{dateOnly(p.scheduledDate)}</InfoRow>
              {p.timeWindow && <InfoRow label={t('ops.pickups.window')}><span className="ltr">{p.timeWindow}</span></InfoRow>}
              <InfoRow label={t('ops.pickups.location')}>
                <span className="block">{p.location?.name}</span>
                <span className="block text-xs font-normal text-ink-500">{p.location?.addressLine}</span>
              </InfoRow>
              <InfoRow label={t('common.zone')}>{p.zone ? (locale === 'ar' ? p.zone.nameAr : p.zone.nameEn) : '—'}</InfoRow>
              {p.location?.contactName && <InfoRow label={t('ops.pickups.contact')}>{p.location.contactName} <PhoneLink value={p.location.phone} className="ms-1 text-xs" /></InfoRow>}
              <InfoRow label={t('common.hero')}>{p.courier ? <span className="inline-flex items-center gap-2">{p.courier.name}<CallButton value={p.courier.phone} name={p.courier.name} /></span> : <Badge tone="warning">{t('ops.opsa.unassigned')}</Badge>}</InfoRow>
              {p.expectedCount != null && <InfoRow label={t('ops.pickups.col.parcels')}>{t('ops.pickups.expected', { n: num(p.expectedCount) })}</InfoRow>}
              {p.startedAt && <InfoRow label={t('ops.pickups.started')}>{dateTime(p.startedAt)}</InfoRow>}
              {p.completedAt && <InfoRow label={t('ops.pickups.completed')}>{dateTime(p.completedAt)}</InfoRow>}
            </div>
            {p.notes && <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100"><b className="text-xs">{t('ops.pickups.notes')}:</b> {p.notes}</p>}
            {p.failureNote && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"><b className="text-xs">{t('ops.pickups.failure')}:</b> {p.failureNote}</p>}
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('ops.pickups.orders')}</h3>
              <span className="text-xs text-ink-500">{t('ops.pickups.picked', { p: num(p.orders.filter((o) => o.scanned).length), a: num(p.orders.length) })}</span>
            </div>
            {p.orders.length === 0 ? (
              <p className="rounded-xl bg-ink-50 p-4 text-sm text-ink-500 dark:bg-ink-800/60">{t('ops.pickups.noOrders')}</p>
            ) : (
              <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
                {p.orders.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', o.scanned ? 'bg-turtle-500' : 'bg-ink-300')} title={o.scanned ? t('ops.pickups.scanned') : t('ops.pickups.notScanned')} />
                    <div className="min-w-0 flex-1">
                      <Link to={`/ops/orders/${o.id}`} className="font-mono text-xs font-semibold hover:underline"><span className="ltr">{o.trackingNumber}</span></Link>
                      <p className="truncate text-xs text-ink-500">{o.recipientName}</p>
                    </div>
                    <span className="ltr text-xs font-semibold text-sand-700 dark:text-sand-300">{o.collectCents ? money(o.collectCents) : ''}</span>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
      {p && (
        <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={() => cancel.mutate()} loading={cancel.isPending} danger title={t('ops.pickups.cancelTitle', { code: p.code })} description={t('ops.pickups.cancelDesc')} confirmLabel={t('ops.pickups.cancel')}>
          <Field label={t('ops.pickups.cancelReason')}>{(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
        </ConfirmDialog>
      )}
    </Drawer>
  );
}

function AssignPickupModal({ pickup, onClose }: { pickup: PickupRow; onClose: () => void }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const zoneId = pickup.zone?.id;
  const covering = useCouriers({ zoneId });
  const all = useCouriers();
  const assign = useMutation({
    mutationFn: (c: CourierRow) => api(`/pickups/${pickup.id}/assign`, { method: 'POST', body: { courierId: c.id } }).then(() => c),
    onSuccess: (c) => {
      toast.success(t('ops.pickups.assigned', { code: pickup.code, name: c.name }));
      void qc.invalidateQueries({ queryKey: ['pickups'] });
      void qc.invalidateQueries({ queryKey: ['pickup', pickup.id] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rank = (c: CourierRow) => ({ ONLINE: 0, BUSY: 1, ON_BREAK: 2, OFFLINE: 3 }[c.availability] ?? 4);
  const cov = useMemo(() => [...(covering.data ?? [])].sort((a, b) => rank(a) - rank(b) || a.activeOrders - b.activeOrders), [covering.data]);
  const covIds = new Set(cov.map((c) => c.id));
  const others = (all.data ?? []).filter((c) => !covIds.has(c.id) && (!pickup.zone?.hubId || c.homeHubId === pickup.zone.hubId));
  const zone = pickup.zone ? (locale === 'ar' ? pickup.zone.nameAr : pickup.zone.nameEn) : '';

  const Row = ({ c }: { c: CourierRow }) => {
    const primary = c.zones.find((z) => z.zoneId === zoneId)?.isPrimary;
    return (
      <li className="flex items-center gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {c.name} <Mono className="text-xs font-normal text-ink-400">{c.code}</Mono>
            {primary && <Badge tone="success">{t('ops.pickups.primary')}</Badge>}
          </p>
          <p className="text-xs text-ink-500">
            {t(`ops.opsa.avail.${c.availability}`)} · {t('ops.pickups.activeOrders', { n: num(c.activeOrders) })} · {t(`ops.opsa.vehicle.${c.vehicleType}`)}
          </p>
        </div>
        <Button size="sm" variant={c.id === pickup.courierId ? 'outline' : 'primary'} disabled={c.id === pickup.courierId} loading={assign.isPending && assign.variables?.id === c.id} onClick={() => assign.mutate(c)}>
          {t('ops.pickups.assign')}
        </Button>
      </li>
    );
  };

  return (
    <Modal open onClose={onClose} title={t('ops.pickups.assignTitle', { code: pickup.code })} description={<span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{pickup.location?.name} · {zone}{pickup.timeWindow && <><Clock className="ms-2 h-3.5 w-3.5" /><span className="ltr">{pickup.timeWindow}</span></>}</span>} size="lg">
      {covering.isLoading || all.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold">{t('ops.pickups.covering', { zone })}</p>
            {cov.length ? <ul className="space-y-2">{cov.map((c) => <Row key={c.id} c={c} />)}</ul> : <p className="text-sm text-ink-500">{t('ops.pickups.noHeroes')}</p>}
          </div>
          {others.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-600 dark:text-ink-300">{t('ops.pickups.others')}</p>
              <ul className="space-y-2">{others.map((c) => <Row key={c.id} c={c} />)}</ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
