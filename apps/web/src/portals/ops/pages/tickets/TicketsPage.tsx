import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Headphones } from 'lucide-react';
import { TicketCategory, TicketStatus } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { ago, num } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Badge, Checkbox, DataTable, EmptyState, Field, PageHeader, Pagination, Select, StateBadge, type Column } from '@/components/ui';
import { Mono, NoAccess, ResponsiveFilters, SearchInput, Segmented, SlaChip } from '../../components/opsa/ui';
import { useStaffUsers } from '../../components/opsa/lookups';
import type { TicketRow } from '../../components/opsa/types';
import './i18n';

const TABS = ['open', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED', 'all'] as const;
const DONE = ['RESOLVED', 'CLOSED'];

export function useAssigneeOptions() {
  const { t } = useI18n();
  const users = useStaffUsers();
  return [
    { value: 'me', label: t('ops.tickets.f.me') },
    { value: 'none', label: t('ops.tickets.f.none') },
    ...(users.data ?? []).map((u) => ({ value: u.id, label: `${u.name} · ${t(`role.${u.role}`)}` })),
  ];
}

export default function TicketsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useQueryState({ status: 'open', q: '', priority: '', category: '', assignee: '', breached: '', open: '', page: '1' });
  const assignees = useAssigneeOptions();
  const status = f.status;
  const query = {
    status: (TicketStatus as Record<string, string>)[status] ? status : undefined,
    open: status === 'open' ? true : undefined,
    q: f.q || undefined, priority: f.priority || undefined, category: f.category || undefined, assigneeId: f.assignee || undefined,
    breached: f.breached ? true : undefined, page: Number(f.page) || 1, pageSize: 25,
  };
  const list = useQuery({ queryKey: ['tickets', query], queryFn: () => api<Paginated<TicketRow>>('/tickets', { query }), placeholderData: keepPreviousData, enabled: can('tickets.read') });
  if (!can('tickets.read')) return <NoAccess />;
  const active = ['priority', 'category', 'assignee', 'breached'].filter((k) => f[k as keyof typeof f]).length;

  const columns: Column<TicketRow>[] = [
    {
      key: 'ticket',
      header: t('ops.tickets.col.ticket'),
      cell: (r) => (
        <div className="max-w-[340px]">
          <p className="flex items-center gap-2"><Mono className="text-xs text-ink-400">{r.code}</Mono><Badge>{t(`ops.opsa.ticketCat.${r.category}`)}</Badge></p>
          <p className="mt-0.5 truncate font-medium text-ink-900 dark:text-ink-100">{r.subject}</p>
          {r.order && <Mono className="text-[11px] text-ink-500">{r.order.trackingNumber}</Mono>}
        </div>
      ),
    },
    { key: 'from', header: t('ops.tickets.col.from'), hideBelow: 'lg', cell: (r) => <div><p className="text-sm">{r.brand?.name ?? r.contactName ?? '—'}</p><p className="text-xs text-ink-400">{t(`ops.opsa.actor.${r.openedByType}`)} · {ago(r.createdAt)}</p></div> },
    { key: 'priority', header: t('ops.tickets.col.priority'), cell: (r) => <StateBadge value={r.priority} /> },
    { key: 'status', header: t('ops.tickets.col.status'), cell: (r) => <StateBadge value={r.status} /> },
    { key: 'assignee', header: t('ops.tickets.col.assignee'), hideBelow: 'xl', cell: (r) => (r.assignee ? r.assignee.name : <span className="text-ink-400">{t('ops.opsa.unassigned')}</span>) },
    { key: 'sla', header: t('ops.tickets.col.sla'), cell: (r) => <SlaChip due={r.slaDueAt} done={DONE.includes(r.status) && !r.breached} warnMs={3_600_000} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('ops.tickets.title')} subtitle={t('ops.tickets.subtitle')} />
      <Segmented
        value={status as (typeof TABS)[number]}
        onChange={(v) => setF({ status: v })}
        options={TABS.map((s) => ({ value: s, label: s === 'open' || s === 'all' ? t(`ops.tickets.tab.${s}`) : t(`state.${s}`), count: s === status ? list.data?.meta.total : undefined }))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={f.q} onChange={(v) => setF({ q: v })} placeholder={t('ops.tickets.search')} className="min-w-0 flex-1 md:max-w-sm" />
        <ResponsiveFilters active={active} onClear={() => setF({ priority: '', category: '', assignee: '', breached: '' })} cols={4}>
          <Field label={t('ops.tickets.f.priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => setF({ priority: e.target.value })} placeholder={t('ops.opsa.any')} options={['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((p) => ({ value: p, label: t(`state.${p}`) }))} />}</Field>
          <Field label={t('ops.tickets.f.category')}>{(id) => <Select id={id} value={f.category} onChange={(e) => setF({ category: e.target.value })} placeholder={t('ops.opsa.any')} options={Object.keys(TicketCategory).map((c) => ({ value: c, label: t(`ops.opsa.ticketCat.${c}`) }))} />}</Field>
          <Field label={t('ops.tickets.f.assignee')}>{(id) => <Select id={id} value={f.assignee} onChange={(e) => setF({ assignee: e.target.value })} placeholder={t('ops.opsa.any')} options={assignees} />}</Field>
          <div className="flex items-end pb-2"><Checkbox label={t('ops.tickets.f.breached')} checked={!!f.breached} onChange={(e) => setF({ breached: e.target.checked ? '1' : '' })} /></div>
        </ResponsiveFilters>
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(r) => navigate(`/ops/tickets/${r.id}`)}
        empty={<EmptyState icon={<Headphones className="h-7 w-7" />} title={t('ops.tickets.empty')} description={t('ops.tickets.emptyHint')} />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Mono className="text-xs text-ink-400">{r.code}</Mono>
              <div className="flex gap-1"><StateBadge value={r.priority} /><StateBadge value={r.status} /></div>
            </div>
            <p className="font-medium">{r.subject}</p>
            <div className="flex items-center justify-between gap-2 text-xs text-ink-500">
              <span className="truncate">{r.brand?.name ?? r.contactName ?? ''} · {t(`ops.opsa.ticketCat.${r.category}`)}</span>
              <SlaChip due={r.slaDueAt} done={DONE.includes(r.status) && !r.breached} warnMs={3_600_000} />
            </div>
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : list.data ? <div className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500 dark:border-ink-800">{t('common.rows', { n: num(list.data.meta.total) })}</div> : undefined}
      />
    </div>
  );
}
