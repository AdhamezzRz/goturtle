import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, PackagePlus, PackageSearch, Printer, X } from 'lucide-react';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { OrderStatus, TERMINAL_STATUSES, type OrderStatus as TOrderStatus } from '@goturtle/shared';
import { api, download, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { cairoToday, dateTime, money, num, phone, statusLabel } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Checkbox, DataTable, EmptyState, Field, Pagination, RiskBadge, Select, StatusBadge, Tabs, type Column } from '@/components/ui';
import { PageHeader } from '@/components/ui';
import { LinkButton, Mono, NoAccess, ResponsiveFilters, SearchInput, SlaChip } from '../../components/opsa/ui';
import { useCouriers, useLookupOptions } from '../../components/opsa/lookups';
import type { OrderCounts, OrderRow } from '../../components/opsa/types';
import './i18n';

export const STATUS_GROUPS: Record<string, TOrderStatus[]> = {
  new: ['CREATED', 'PICKUP_ASSIGNED', 'ON_HOLD'],
  inTransit: ['PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED'],
  delivered: ['DELIVERED'],
  returns: ['RETURN_PENDING', 'RETURN_OUT', 'RETURNED'],
  closed: ['CANCELLED', 'LOST', 'DAMAGED'],
};
const GROUP_KEYS = ['all', 'new', 'inTransit', 'delivered', 'returns', 'closed'] as const;

const DEFAULTS = {
  q: '', status: 'all', customer: '', brand: '', zone: '', hub: '', hero: '', payment: '', risk: '', service: '', from: '', to: '', dateField: 'createdAt', sla: '', sort: 'createdAt', page: '1',
};

export default function OrdersPage() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useQueryState(DEFAULTS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const { hubs, zones, brands } = useLookupOptions();
  const couriers = useCouriers();

  const isGroup = (GROUP_KEYS as readonly string[]).includes(f.status);
  const statusList: TOrderStatus[] | undefined = f.status === 'all' ? undefined : isGroup ? STATUS_GROUPS[f.status] : [f.status as TOrderStatus];
  const activeTab = isGroup ? f.status : (Object.entries(STATUS_GROUPS).find(([, l]) => l.includes(f.status as TOrderStatus))?.[0] ?? 'all');

  const baseQuery = {
    q: f.q || undefined, customerId: f.customer || undefined, brandId: f.brand || undefined, zoneId: f.zone || undefined, hubId: f.hub || undefined, courierId: f.hero || undefined,
    paymentMethod: f.payment || undefined, riskLevel: f.risk || undefined, serviceLevel: f.service || undefined,
    from: f.from || undefined, to: f.to || undefined, dateField: f.from || f.to ? f.dateField : undefined, slaBreached: f.sla ? true : undefined,
  };
  const listQuery = { ...baseQuery, status: statusList?.join(','), sort: f.sort, order: f.sort === 'promisedBy' ? 'asc' : 'desc', page: Number(f.page) || 1, pageSize: 25 };

  const list = useQuery({ queryKey: ['orders', 'list', listQuery], queryFn: () => api<Paginated<OrderRow>>('/orders', { query: listQuery }), placeholderData: keepPreviousData, enabled: can('orders.read') });
  const counts = useQuery({ queryKey: ['orders', 'counts', baseQuery], queryFn: () => api<OrderCounts>('/orders/counts', { query: baseQuery }), placeholderData: keepPreviousData, enabled: can('orders.read') });

  const activeFilters = ['customer', 'brand', 'zone', 'hub', 'hero', 'payment', 'risk', 'service', 'from', 'to', 'sla'].filter((k) => f[k as keyof typeof f]).length + (isGroup ? 0 : 1);
  const clear = () => setF({ customer: '', brand: '', zone: '', hub: '', hero: '', payment: '', risk: '', service: '', from: '', to: '', sla: '', status: isGroup ? f.status : 'all' });

  const rows = list.data?.data;
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => selected.has(r.id)), [rows, selected]);

  const exportAll = async () => {
    setExporting(true);
    try {
      await download('/orders/export', `goturtle-orders-${cairoToday()}.csv`, { ...baseQuery, status: statusList?.join(',') });
      toast.success(t('ops.orders.exported'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const exportSelected = () => {
    const csv = Papa.unparse(selectedRows.map((r) => ({
      tracking_number: r.trackingNumber, brand_reference: r.brandReference ?? '', brand: r.brand?.name ?? '', status: r.status, recipient: r.recipientName, phone: r.recipientPhone,
      address: r.addressLine, zone: r.zone?.code ?? '', hub: r.hub?.code ?? '', hero: r.courier?.code ?? '', payment: r.paymentMethod, cod_egp: r.codAmountCents / 100,
      collect_egp: r.collectCents / 100, fees_egp: r.totalFeesCents / 100, attempts: r.attempts, risk: r.riskScore, promised_by: r.promisedBy ?? '', created_at: r.createdAt,
    })));
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goturtle-orders-selected-${cairoToday()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!can('orders.read')) return <NoAccess />;

  const zoneName = (r: OrderRow) => (r.zone ? (locale === 'ar' ? r.zone.nameAr : r.zone.nameEn) : '—');
  const isFinal = (s: TOrderStatus) => TERMINAL_STATUSES.includes(s);

  const columns: Column<OrderRow>[] = [
    {
      key: 'tracking',
      header: t('ops.orders.col.tracking'),
      cell: (r) => (
        <div className="min-w-0">
          <Mono className="font-semibold text-ink-900 dark:text-white">{r.trackingNumber}</Mono>
          <p className="truncate text-xs text-ink-500">{r.brand?.name}{r.brandReference ? <span className="ltr"> · {r.brandReference}</span> : null}</p>
        </div>
      ),
    },
    {
      key: 'recipient',
      header: t('ops.orders.col.recipient'),
      cell: (r) => (
        <div className="max-w-[180px]">
          <p className="truncate font-medium text-ink-900 dark:text-ink-100">{r.recipientName}</p>
          <p className="truncate text-xs text-ink-500"><span className="ltr">{phone(r.recipientPhone)}</span></p>
        </div>
      ),
    },
    {
      key: 'zone',
      header: t('ops.orders.col.zone'),
      hideBelow: 'lg',
      cell: (r) => (
        <div className="max-w-[150px]">
          <p className="truncate">{zoneName(r)}</p>
          {r.hub && <p className="truncate text-[11px] text-ink-400"><span className="ltr">{r.hub.code}</span></p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('ops.orders.col.status'),
      cell: (r) => (
        <div className="space-y-1">
          <StatusBadge status={r.status} />
          {r.attempts > 0 && <p className="text-[11px] text-ink-500">{t('ops.orders.attempts', { n: num(r.attempts), max: num(r.maxAttempts) })}</p>}
        </div>
      ),
    },
    {
      key: 'cod',
      header: t('ops.orders.col.cod'),
      cell: (r) => (
        <div className="space-y-1">
          {r.collectCents ? <p className="whitespace-nowrap font-semibold text-sand-700 dark:text-sand-300"><span className="ltr">{money(r.collectCents)}</span></p> : <Badge>{t('ops.orders.prepaid')}</Badge>}
          {r.paymentMethod === 'COD' && r.riskLevel !== 'LOW' && <RiskBadge score={r.riskScore} />}
        </div>
      ),
    },
    { key: 'hero', header: t('ops.orders.col.hero'), hideBelow: 'xl', cell: (r) => (r.courier ? <span className="whitespace-nowrap">{r.courier.name}</span> : <span className="text-ink-400">—</span>) },
    {
      key: 'sla',
      header: t('ops.orders.col.sla'),
      hideBelow: 'lg',
      cell: (r) => (
        <div className="space-y-1">
          <SlaChip due={r.promisedBy} done={isFinal(r.status)} />
          <p className="whitespace-nowrap text-[11px] text-ink-400">{dateTime(r.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      ),
    },
  ];

  const tabs = GROUP_KEYS.map((k) => ({ value: k, label: t(`ops.orders.tab.${k}`), count: counts.data ? (k === 'all' ? counts.data.total : counts.data.groups[k]) : undefined }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('ops.orders.title')}
        subtitle={list.data ? t('ops.orders.subtitle', { n: num(list.data.meta.total) }) : undefined}
        actions={
          <>
            {can('orders.export') && <Button variant="outline" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={exportAll}>{t('ops.orders.export')}</Button>}
            {can('orders.create') && <LinkButton to="/ops/orders/new" variant="primary" size="md" icon={<PackagePlus />}>{t('ops.orders.new')}</LinkButton>}
          </>
        }
      />

      <Tabs value={activeTab} onChange={(v) => { setF({ status: v }); setSelected(new Set()); }} tabs={tabs} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t('ops.orders.search')} className="min-w-0 flex-1 md:max-w-sm" />
        <ResponsiveFilters active={activeFilters} onClear={clear} cols={6}>
          <Field label={t('ops.orders.f.status')}>
            {(id) => (
              <Select id={id} value={isGroup ? '' : f.status} onChange={(e) => setF({ status: e.target.value || activeTab })} placeholder={t('ops.opsa.anyStatus')}
                options={(Object.keys(OrderStatus) as TOrderStatus[]).map((s) => ({ value: s, label: statusLabel(s) }))} />
            )}
          </Field>
          {can('brands.read') && <Field label={t('ops.orders.f.brand')}>{(id) => <Select id={id} value={f.brand} onChange={(e) => setF({ brand: e.target.value })} options={brands} placeholder={t('ops.opsa.anyBrand')} />}</Field>}
          <Field label={t('ops.orders.f.hub')}>{(id) => <Select id={id} value={f.hub} onChange={(e) => setF({ hub: e.target.value })} options={hubs} placeholder={t('ops.opsa.anyHub')} />}</Field>
          <Field label={t('ops.orders.f.zone')}>{(id) => <Select id={id} value={f.zone} onChange={(e) => setF({ zone: e.target.value })} options={zones} placeholder={t('ops.opsa.anyZone')} />}</Field>
          <Field label={t('ops.orders.f.hero')}>
            {(id) => <Select id={id} value={f.hero} onChange={(e) => setF({ hero: e.target.value })} options={(couriers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.code}` }))} placeholder={t('ops.opsa.anyHero')} />}
          </Field>
          <Field label={t('ops.orders.f.payment')}>
            {(id) => <Select id={id} value={f.payment} onChange={(e) => setF({ payment: e.target.value })} options={['COD', 'PREPAID'].map((v) => ({ value: v, label: t(`ops.opsa.payment.${v}`) }))} placeholder={t('ops.opsa.any')} />}
          </Field>
          <Field label={t('ops.orders.f.risk')}>
            {(id) => <Select id={id} value={f.risk} onChange={(e) => setF({ risk: e.target.value })} options={['LOW', 'MEDIUM', 'HIGH'].map((v) => ({ value: v, label: t(`ops.opsa.riskLevel.${v}`) }))} placeholder={t('ops.opsa.any')} />}
          </Field>
          <Field label={t('ops.orders.f.service')}>
            {(id) => <Select id={id} value={f.service} onChange={(e) => setF({ service: e.target.value })} options={['STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'].map((v) => ({ value: v, label: t(`ops.opsa.service.${v}`) }))} placeholder={t('ops.opsa.any')} />}
          </Field>
          <Field label={t('ops.orders.f.dateField')}>
            {(id) => <Select id={id} value={f.dateField} onChange={(e) => setF({ dateField: e.target.value })} options={['createdAt', 'deliveredAt', 'promisedBy', 'updatedAt'].map((v) => ({ value: v, label: t(`ops.orders.date.${v}`) }))} />}
          </Field>
          <Field label={t('ops.orders.f.from')}>{(id) => <input id={id} type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF({ from: e.target.value })} className="ltr h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm dark:border-ink-700 dark:bg-ink-900" />}</Field>
          <Field label={t('ops.orders.f.to')}>{(id) => <input id={id} type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ to: e.target.value })} className="ltr h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm dark:border-ink-700 dark:bg-ink-900" />}</Field>
          <Field label={t('ops.orders.f.sort')}>
            {(id) => <Select id={id} value={f.sort} onChange={(e) => setF({ sort: e.target.value })} options={['createdAt', 'promisedBy', 'codAmountCents', 'riskScore', 'attempts'].map((v) => ({ value: v, label: t(`ops.orders.sort.${v}`) }))} />}
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label={t('ops.orders.f.sla')} checked={!!f.sla} onChange={(e) => setF({ sla: e.target.checked ? '1' : '' })} />
          </div>
        </ResponsiveFilters>
        {!isGroup && (
          <button type="button" onClick={() => setF({ status: activeTab })} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-turtle-50 px-3 text-xs font-semibold text-turtle-800 ring-1 ring-turtle-200 dark:bg-turtle-950 dark:text-turtle-200 dark:ring-turtle-900">
            {t('ops.orders.statusChip', { s: statusLabel(f.status as TOrderStatus) })}
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {f.sla && (
          <button type="button" onClick={() => setF({ sla: '' })} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-red-50 px-3 text-xs font-semibold text-red-700 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900">
            {t('ops.orders.f.sla')}
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-ink-900 px-4 py-2.5 text-white shadow-pop dark:bg-ink-100 dark:text-ink-900">
          <span className="me-auto text-sm font-semibold">{t('ops.orders.selected', { n: num(selected.size) })}</span>
          <Button size="sm" variant="cash" icon={<Printer className="h-4 w-4" />} onClick={() => navigate(`/ops/orders/labels?ids=${[...selected].join(',')}`)}>{t('ops.orders.printLabels')}</Button>
          <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportSelected}>{t('ops.orders.exportSelected')}</Button>
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 dark:text-ink-900" onClick={() => setSelected(new Set())}>{t('ops.orders.clearSelection')}</Button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        dense
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(r) => navigate(`/ops/orders/${r.id}`)}
        selected={selected}
        onSelectChange={setSelected}
        empty={<EmptyState icon={<PackageSearch className="h-7 w-7" />} title={t('ops.orders.empty')} description={t('ops.orders.emptyHint')} />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Mono className="font-semibold text-ink-900 dark:text-white">{r.trackingNumber}</Mono>
              <StatusBadge status={r.status} />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink-700 dark:text-ink-200">{r.recipientName}</span>
              {r.collectCents ? <span className="ltr shrink-0 font-semibold text-sand-700 dark:text-sand-300">{money(r.collectCents)}</span> : <Badge>{t('ops.orders.prepaid')}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
              <span>{r.brand?.name}</span>
              <span>·</span>
              <span>{zoneName(r)}</span>
              {r.courier && (<><span>·</span><span>{r.courier.name}</span></>)}
              <SlaChip due={r.promisedBy} done={isFinal(r.status)} className="ms-auto" />
            </div>
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => { setF({ page: String(p) }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /> : undefined}
      />
    </div>
  );
}
