import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Filter, PackagePlus, Printer, Search, Truck, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { OrderStatus, type OrderStatus as OS } from '@goturtle/shared';
import { api, download, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, usePollInterval, useQueryState } from '@/lib/hooks';
import { cairoToday, dateOnly, num, phone, statusLabel, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StatusBadge, Tabs, type Column } from '@/components/ui';
import { downloadCsv, Ltr, Money, nameOf, useCanCreate, useZones } from '../components/common';
import { OrderMobileCard, RequestPickupModal } from '../components/orders';
import type { OrderCounts, OrderRow } from '../components/types';
import './i18n';

const GROUPS = {
  new: ['CREATED', 'PICKUP_ASSIGNED', 'ON_HOLD'],
  inTransit: ['PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED'],
  delivered: ['DELIVERED'],
  returns: ['RETURN_PENDING', 'RETURN_OUT', 'RETURNED'],
  closed: ['CANCELLED', 'LOST', 'DAMAGED'],
} as const;
type Tab = 'all' | keyof typeof GROUPS;

const DEFAULTS = { tab: 'all', q: '', status: '', from: '', to: '', payment: '', zone: '', page: '1' };

export default function OrdersPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { can } = useAuth();
  const create = useCanCreate();
  const poll = usePollInterval(30_000);
  const [f, setF] = useQueryState(DEFAULTS);
  const [search, setSearch] = useState(f.q ?? '');
  const debounced = useDebounced(search, 350);
  useEffect(() => {
    if ((f.q ?? '') !== debounced) setF({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const zones = useZones();

  const tab = (f.tab in GROUPS ? f.tab : 'all') as Tab;
  const statuses = f.status ? f.status.split(',') : tab !== 'all' ? [...GROUPS[tab as keyof typeof GROUPS]] : [];
  const base = { q: f.q || undefined, from: f.from || undefined, to: f.to || undefined, paymentMethod: f.payment || undefined, zoneId: f.zone || undefined };
  const query = { ...base, status: statuses.length ? statuses.join(',') : undefined, page: Number(f.page) || 1, pageSize: 25 };

  const list = useQuery({ queryKey: ['orders', 'list', query], queryFn: () => api<Paginated<OrderRow>>('/orders', { query }), placeholderData: keepPreviousData, refetchInterval: poll });
  const counts = useQuery({ queryKey: ['orders', 'counts', base], queryFn: () => api<OrderCounts>('/orders/counts', { query: base }), refetchInterval: poll });

  useEffect(() => setSelected(new Set()), [f.tab, f.status, f.q, f.from, f.to, f.payment, f.zone]);

  const rows = list.data?.data;
  const selectedRows = useMemo(() => (rows ?? []).filter((r) => selected.has(r.id)), [rows, selected]);
  const activeFilters = [f.status, f.from || f.to, f.payment, f.zone].filter(Boolean).length;

  const columns: Column<OrderRow>[] = [
    {
      key: 'tn',
      header: t('brand.orders.col.tracking'),
      cell: (o) => (
        <div>
          <Link to={`/brand/orders/${o.id}`} onClick={(e) => e.stopPropagation()} className="ltr font-mono font-semibold text-ink-900 hover:text-turtle-700 hover:underline dark:text-white">{o.trackingNumber}</Link>
          {o.brandReference && <p className="ltr text-xs text-ink-400">#{o.brandReference}</p>}
        </div>
      ),
    },
    {
      key: 'recipient',
      header: t('brand.orders.col.recipient'),
      cell: (o) => (
        <div className="max-w-[220px]">
          <p className="truncate font-medium text-ink-800 dark:text-ink-100">{o.recipientName}</p>
          <p className="text-xs text-ink-500"><Ltr>{phone(o.recipientPhone)}</Ltr></p>
        </div>
      ),
    },
    { key: 'zone', header: t('common.zone'), hideBelow: 'lg', cell: (o) => <span className="whitespace-nowrap">{nameOf(o.zone, locale)}</span> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (o) => (
        <div className="space-y-1">
          <StatusBadge status={o.status} />
          {o.attempts > 0 && o.status !== 'DELIVERED' && <p className="text-[11px] text-ink-400">{t('brand.orders.attemptsOf', { n: num(o.attempts), max: num(o.maxAttempts) })}</p>}
        </div>
      ),
    },
    {
      key: 'cod',
      header: t('brand.orders.col.collect'),
      align: 'end',
      cell: (o) => (
        <div>
          <Money cents={o.collectCents} className="font-semibold text-ink-900 dark:text-white" />
          <p className="text-[11px] text-ink-400">{t(`brand.pay.${o.paymentMethod}`)}</p>
        </div>
      ),
    },
    { key: 'fees', header: t('common.fees'), align: 'end', hideBelow: 'xl', cell: (o) => <Money cents={o.totalFeesCents} className="text-ink-500" /> },
    {
      key: 'created',
      header: t('brand.common.created'),
      hideBelow: 'lg',
      cell: (o) => (
        <div className="whitespace-nowrap text-xs">
          <p>{dateOnly(o.createdAt)}</p>
          <p className="text-ink-400">{timeOnly(o.createdAt)}</p>
        </div>
      ),
    },
  ];

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: 'all', label: t('common.all'), count: counts.data?.total },
    ...(Object.keys(GROUPS) as Array<keyof typeof GROUPS>).map((g) => ({ value: g as Tab, label: t(`brand.orders.tab.${g}`), count: counts.data?.groups[g] })),
  ];

  const exportAll = async () => {
    try {
      await download('/orders/export', `goturtle-orders-${cairoToday()}.csv`, { ...base, status: query.status });
      toast.success(t('brand.orders.exported'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const exportSelected = () => {
    downloadCsv(
      selectedRows.map((o) => ({
        tracking_number: o.trackingNumber, reference: o.brandReference ?? '', status: o.status, recipient: o.recipientName, phone: o.recipientPhone,
        zone: o.zone?.code ?? '', address: o.addressLine, payment: o.paymentMethod, collect_egp: o.collectCents / 100, fees_egp: o.totalFeesCents / 100,
        attempts: o.attempts, created_at: o.createdAt,
      })),
      `goturtle-orders-selected-${cairoToday()}.csv`,
    );
  };

  return (
    <div>
      <PageHeader
        title={t('brand.orders.title')}
        subtitle={t('brand.orders.subtitle')}
        actions={
          <>
            {can('orders.export') && <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportAll}>{t('action.export')}</Button>}
            {create.allowed && (
              <>
                <Link to="/brand/orders/bulk"><Button variant="outline" icon={<Upload className="h-4 w-4" />}>{t('brand.nav.bulk')}</Button></Link>
                <Link to="/brand/orders/new"><Button icon={<PackagePlus className="h-4 w-4" />}>{t('brand.nav.newOrder')}</Button></Link>
              </>
            )}
          </>
        }
      />

      <Tabs value={f.status ? ('' as Tab) : tab} onChange={(v) => setF({ tab: v, status: '' })} tabs={tabs} className="mb-4 scrollbar-none" />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Input
          className="lg:max-w-sm lg:flex-1"
          leading={<Search className="h-4 w-4" />}
          trailing={search ? <button type="button" onClick={() => setSearch('')} aria-label={t('action.clear')}><X className="h-4 w-4" /></button> : undefined}
          placeholder={t('brand.orders.searchPh')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('action.search')}
          type="search"
        />
        <div className="hidden flex-wrap items-center gap-2 lg:flex">
          <FilterControls f={f} setF={setF} zones={zones.data} inline />
        </div>
        <Button variant="outline" className="lg:hidden" icon={<Filter className="h-4 w-4" />} onClick={() => setFiltersOpen(true)}>
          {t('action.filter')}
          {activeFilters > 0 && <Badge tone="success">{num(activeFilters)}</Badge>}
        </Button>
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setF({ status: '', from: '', to: '', payment: '', zone: '' })} icon={<X className="h-4 w-4" />}>
            {t('brand.orders.clearFilters')}
          </Button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-turtle-200 bg-turtle-50/95 px-4 py-2.5 backdrop-blur dark:border-turtle-900 dark:bg-turtle-950/90">
          <span className="me-auto text-sm font-semibold text-turtle-900 dark:text-turtle-100">{t('brand.common.selected', { n: num(selected.size) })}</span>
          <Button size="sm" variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => navigate(`/brand/orders/labels?ids=${[...selected].join(',')}`)}>{t('brand.orders.printLabels')}</Button>
          <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportSelected}>{t('brand.orders.exportSel')}</Button>
          {can('pickups.manage') && <Button size="sm" icon={<Truck className="h-4 w-4" />} disabled={!create.allowed} onClick={() => setPickupOpen(true)}>{t('brand.pickups.request')}</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t('brand.common.clearSel')}</Button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(o) => o.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(o) => navigate(`/brand/orders/${o.id}`)}
        selected={selected}
        onSelectChange={setSelected}
        mobileCard={(o) => <OrderMobileCard o={o} />}
        empty={
          f.q || activeFilters || tab !== 'all' ? (
            <EmptyState icon={<Search className="h-7 w-7" />} title={t('common.noResults')} description={t('brand.orders.noResultsHint')} />
          ) : (
            <EmptyState
              icon={<PackagePlus className="h-7 w-7" />}
              title={t('brand.dash.noOrders')}
              description={t('brand.dash.noOrdersHint')}
              action={create.allowed ? <Link to="/brand/orders/new"><Button icon={<PackagePlus className="h-4 w-4" />}>{t('brand.nav.newOrder')}</Button></Link> : undefined}
            />
          )
        }
        footer={list.data && list.data.meta.total > 0 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : undefined}
      />

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('action.filter')} footer={<Button onClick={() => setFiltersOpen(false)}>{t('brand.orders.showResults')}</Button>}>
        <div className="space-y-4">
          <FilterControls f={f} setF={setF} zones={zones.data} />
        </div>
      </Modal>

      <RequestPickupModal open={pickupOpen} onClose={() => setPickupOpen(false)} expected={selectedRows.filter((o) => o.status === 'CREATED').length || undefined} onDone={() => setSelected(new Set())} />
    </div>
  );
}

function FilterControls({
  f, setF, zones, inline,
}: {
  f: typeof DEFAULTS; setF: (p: Partial<typeof DEFAULTS>) => void; zones?: Array<{ id: string; nameEn: string; nameAr: string }>; inline?: boolean;
}) {
  const { t, locale } = useI18n();
  const statusOptions = (Object.keys(OrderStatus) as OS[]).map((s) => ({ value: s, label: statusLabel(s) }));
  const zoneOptions = (zones ?? []).map((z) => ({ value: z.id, label: nameOf(z, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale));
  const cls = inline ? 'w-auto min-w-[150px]' : '';
  const controls = [
    { key: 'status', label: t('common.status'), node: (id: string) => <Select id={id} className={cls} value={f.status.includes(',') ? '' : f.status} onChange={(e) => setF({ status: e.target.value, tab: 'all' })} options={statusOptions} placeholder={t('brand.orders.anyStatus')} aria-label={t('common.status')} /> },
    { key: 'payment', label: t('brand.orders.payment'), node: (id: string) => <Select id={id} className={cls} value={f.payment} onChange={(e) => setF({ payment: e.target.value })} options={[{ value: 'COD', label: t('brand.pay.COD') }, { value: 'PREPAID', label: t('brand.pay.PREPAID') }]} placeholder={t('brand.orders.anyPayment')} aria-label={t('brand.orders.payment')} /> },
    { key: 'zone', label: t('common.zone'), node: (id: string) => <Select id={id} className={cls} value={f.zone} onChange={(e) => setF({ zone: e.target.value })} options={zoneOptions} placeholder={t('brand.orders.anyZone')} aria-label={t('common.zone')} /> },
  ];
  const dates = (
    <>
      <Field label={inline ? undefined : t('common.from')}>{(id) => <Input id={id} type="date" className={inline ? 'w-[150px]' : ''} value={f.from} max={f.to || undefined} onChange={(e) => setF({ from: e.target.value })} aria-label={t('common.from')} />}</Field>
      <Field label={inline ? undefined : t('common.to')}>{(id) => <Input id={id} type="date" className={inline ? 'w-[150px]' : ''} value={f.to} min={f.from || undefined} onChange={(e) => setF({ to: e.target.value })} aria-label={t('common.to')} />}</Field>
    </>
  );
  if (inline)
    return (
      <>
        {controls.map((c) => <span key={c.key}>{c.node(`f-${c.key}`)}</span>)}
        {dates}
      </>
    );
  return (
    <>
      {controls.map((c) => <Field key={c.key} label={c.label}>{c.node}</Field>)}
      <div className="grid grid-cols-2 gap-3">{dates}</div>
    </>
  );
}
