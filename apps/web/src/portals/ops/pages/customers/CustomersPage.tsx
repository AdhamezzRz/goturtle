import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { UserSquare2 } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { dateOnly, num, phone } from '@/lib/format';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Avatar, Badge, DataTable, EmptyState, Field, PageHeader, Pagination, Select, type Column } from '@/components/ui';
import { NoAccess, ResponsiveFilters, SearchInput } from '../../components/opsa/ui';
import type { CustomerRow } from '../../components/opsa/types';
import './i18n';

export function ReliabilityPill({ score, level }: { score: number; level: CustomerRow['reliabilityLevel'] }) {
  const { t } = useI18n();
  const color = level === 'GOOD' ? 'bg-turtle-500' : level === 'FAIR' ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="ltr text-xs font-semibold text-ink-700 dark:text-ink-200">{num(score)}</span>
      <Badge tone={level === 'GOOD' ? 'success' : level === 'FAIR' ? 'warning' : 'danger'}>{t(`ops.opsa.reliability.${level}`)}</Badge>
    </div>
  );
}

const BANDS: Record<string, { min?: number; max?: number }> = { GOOD: { min: 75 }, FAIR: { min: 50, max: 74 }, POOR: { max: 49 } };

export default function CustomersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useQueryState({ q: '', blocked: '', band: '', sort: 'updatedAt', page: '1' });
  const band = BANDS[f.band] ?? {};
  const query = {
    q: f.q || undefined, isBlocked: f.blocked === '' ? undefined : f.blocked === '1', minReliability: band.min, maxReliability: band.max,
    sort: f.sort, order: f.sort === 'name' ? 'asc' : f.sort === 'reliabilityScore' ? 'asc' : 'desc', page: Number(f.page) || 1, pageSize: 25,
  };
  const list = useQuery({ queryKey: ['customers', query], queryFn: () => api<Paginated<CustomerRow>>('/customers', { query }), placeholderData: keepPreviousData, enabled: can('orders.read') });
  if (!can('orders.read')) return <NoAccess />;

  const columns: Column<CustomerRow>[] = [
    {
      key: 'c',
      header: t('ops.customers.col.customer'),
      cell: (c) => (
        <div className="flex items-center gap-3">
          <Avatar name={c.name} size={34} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium text-ink-900 dark:text-ink-100">{c.name}{c.isBlocked && <Badge tone="danger">{t('ops.customers.blocked')}</Badge>}</p>
            <p className="ltr text-start text-xs text-ink-500">{phone(c.phone)}</p>
          </div>
        </div>
      ),
    },
    { key: 'o', header: t('ops.customers.col.orders'), align: 'center', cell: (c) => <span className="ltr font-semibold">{num(c.totalOrders)}</span> },
    { key: 'd', header: t('ops.customers.col.delivered'), align: 'center', hideBelow: 'lg', cell: (c) => <span className="ltr text-turtle-700 dark:text-turtle-400">{num(c.deliveredOrders)}</span> },
    { key: 'r', header: t('ops.customers.col.refused'), align: 'center', hideBelow: 'lg', cell: (c) => <span className={cn('ltr', c.refusedOrders ? 'font-semibold text-red-600' : 'text-ink-400')}>{num(c.refusedOrders)}</span> },
    { key: 'rel', header: t('ops.customers.col.reliability'), cell: (c) => <ReliabilityPill score={c.reliabilityScore} level={c.reliabilityLevel} /> },
    { key: 's', header: t('ops.customers.col.since'), hideBelow: 'xl', cell: (c) => <span className="text-xs text-ink-500">{dateOnly(c.createdAt)}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('ops.customers.title')} subtitle={t('ops.customers.subtitle')} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t('ops.customers.search')} className="min-w-0 flex-1 md:max-w-sm" />
        <ResponsiveFilters active={[f.blocked, f.band].filter(Boolean).length} onClear={() => setF({ blocked: '', band: '' })} cols={3} defaultOpen={false}>
          <Field label={t('ops.customers.f.status')}>
            {(id) => <Select id={id} value={f.blocked} onChange={(e) => setF({ blocked: e.target.value })} placeholder={t('ops.opsa.any')} options={[{ value: '0', label: t('ops.customers.f.active') }, { value: '1', label: t('ops.customers.f.blocked') }]} />}
          </Field>
          <Field label={t('ops.customers.f.band')}>
            {(id) => <Select id={id} value={f.band} onChange={(e) => setF({ band: e.target.value })} placeholder={t('ops.opsa.any')} options={['GOOD', 'FAIR', 'POOR'].map((b) => ({ value: b, label: t(`ops.opsa.reliability.${b}`) }))} />}
          </Field>
          <Field label={t('ops.customers.f.sort')}>
            {(id) => <Select id={id} value={f.sort} onChange={(e) => setF({ sort: e.target.value })} options={['updatedAt', 'totalOrders', 'refusedOrders', 'reliabilityScore', 'name'].map((s) => ({ value: s, label: t(`ops.customers.sort.${s}`) }))} />}
          </Field>
        </ResponsiveFilters>
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(c) => c.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(c) => navigate(`/ops/customers/${c.id}`)}
        empty={<EmptyState icon={<UserSquare2 className="h-7 w-7" />} title={t('ops.customers.empty')} />}
        mobileCard={(c) => (
          <div className="flex items-start gap-3">
            <Avatar name={c.name} size={36} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium">{c.name}</p>
                {c.isBlocked && <Badge tone="danger">{t('ops.customers.blocked')}</Badge>}
              </div>
              <p className="text-xs text-ink-500"><span className="ltr">{phone(c.phone)}</span> · {t('ops.customers.ordersN', { n: num(c.totalOrders) })}</p>
              <ReliabilityPill score={c.reliabilityScore} level={c.reliabilityLevel} />
            </div>
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : undefined}
      />
    </div>
  );
}
