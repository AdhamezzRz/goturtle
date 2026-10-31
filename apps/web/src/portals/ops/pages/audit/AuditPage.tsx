import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileClock, Search } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useDebounced, useQueryState } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Avatar, Badge, Button, DataTable, Drawer, EmptyState, Input, PageHeader, Pagination, Select, type Column } from '@/components/ui';
import { Code, FilterBar, FilterField, InfoRow, JsonDiff, RequirePermission, useStaffOptions } from '@/portals/ops/components/opsb';
import './i18n';

type AuditRow = {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string; role: string } | null;
};

const ENTITIES = ['Order', 'Pickup', 'Runsheet', 'Ticket', 'Customer', 'Brand', 'BrandLocation', 'PricingPlan', 'Courier', 'CourierDocument', 'Shift', 'ShiftTemplate', 'CashHandover', 'Settlement', 'CourierPayout', 'CourierAdjustment', 'User', 'Setting', 'ApiKey', 'WebhookEndpoint', 'WebhookDelivery', 'IntegrationConnection', 'Zone', 'Hub', 'City', 'Governorate'];

export default function AuditPage() {
  return (
    <RequirePermission permission="audit.read">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  const staff = useStaffOptions();
  const [f, setF] = useQueryState({ entity: '', entityId: '', actorId: '', action: '', from: '', to: '', page: '1' });
  const [action, setAction] = useState(f.action);
  const [eid, setEid] = useState(f.entityId);
  const da = useDebounced(action, 400);
  const de = useDebounced(eid, 400);
  useEffect(() => {
    if (da !== f.action || de !== f.entityId) setF({ action: da.trim(), entityId: de.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [da, de]);
  useEffect(() => { setAction(f.action); setEid(f.entityId); }, [f.action, f.entityId]);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const q = useQuery({
    queryKey: ['audit', f],
    queryFn: () => api<Paginated<AuditRow>>('/audit', { query: { entity: f.entity, entityId: f.entityId, actorId: f.actorId, action: f.action, from: f.from, to: f.to, page: f.page, pageSize: 30 } }),
    placeholderData: keepPreviousData,
  });
  const actorCell = (r: AuditRow) =>
    r.actor ? (
      <span className="inline-flex items-center gap-2"><Avatar name={r.actor.name} size={24} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{r.actor.name}</span><span className="block text-[11px] text-ink-400">{t(`role.${r.actor.role}`)}</span></span></span>
    ) : <Badge tone="neutral">{t(`ops.audit.actorType.${r.actorType}`)}</Badge>;
  const columns: Column<AuditRow>[] = [
    { key: 'date', header: t('common.date'), cell: (r) => <span className="whitespace-nowrap text-sm">{dateTime(r.createdAt, { dateStyle: 'medium', timeStyle: 'medium' })}</span> },
    { key: 'actor', header: t('ops.audit.actor'), cell: actorCell },
    { key: 'action', header: t('ops.audit.action'), cell: (r) => <Code className="text-[13px]">{r.action}</Code> },
    { key: 'entity', header: t('ops.audit.entity'), cell: (r) => <div><p className="text-sm font-medium">{r.entity}</p>{r.entityId && <p className="ltr max-w-[180px] truncate text-start font-mono text-[11px] text-ink-400">{r.entityId}</p>}</div>, hideBelow: 'md' },
    { key: 'ip', header: t('ops.audit.ip'), cell: (r) => <span className="ltr text-xs text-ink-500">{r.ip ?? '—'}</span>, hideBelow: 'xl' },
  ];
  return (
    <div>
      <PageHeader title={t('ops.audit.title')} subtitle={t('ops.audit.subtitle')} />
      <FilterBar
        search={<Input type="search" dir="ltr" leading={<Search className="h-4 w-4" />} value={action} onChange={(e) => setAction(e.target.value)} placeholder={t('ops.audit.search')} aria-label={t('ops.audit.action')} title={t('ops.audit.actionHint')} />}
        activeCount={[f.entity, f.entityId, f.actorId, f.from, f.to].filter(Boolean).length}
        onClear={() => setF({ entity: '', entityId: '', actorId: '', from: '', to: '' })}
      >
        <FilterField label={t('ops.audit.entity')}><Select value={f.entity} onChange={(e) => setF({ entity: e.target.value })} placeholder={t('ops.audit.allEntities')} options={ENTITIES.map((e) => ({ value: e, label: e }))} aria-label={t('ops.audit.entity')} /></FilterField>
        <FilterField label={t('ops.audit.entityId')}><Input dir="ltr" value={eid} onChange={(e) => setEid(e.target.value)} placeholder={t('ops.audit.entityId')} aria-label={t('ops.audit.entityId')} className="md:!w-44" /></FilterField>
        <FilterField label={t('ops.audit.actor')}><Select value={f.actorId} onChange={(e) => setF({ actorId: e.target.value })} placeholder={t('ops.audit.allActors')} options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))} aria-label={t('ops.audit.actor')} /></FilterField>
        <FilterField label={t('common.from')}><Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} aria-label={t('common.from')} className="md:!w-40" /></FilterField>
        <FilterField label={t('common.to')}><Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} aria-label={t('common.to')} className="md:!w-40" /></FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        onRowClick={(r) => setOpen(r)}
        dense
        empty={<EmptyState icon={<FileClock className="h-7 w-7" />} title={t('ops.audit.empty')} />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><Code>{r.action}</Code><span className="text-xs text-ink-400">{dateTime(r.createdAt)}</span></div>
            <div className="flex items-center justify-between gap-2">{actorCell(r)}<span className="text-xs text-ink-500">{r.entity}</span></div>
          </div>
        )}
        footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} title={t('ops.audit.details')} width="max-w-2xl"
        footer={open?.entityId && <Button variant="outline" onClick={() => { setF({ entity: open.entity, entityId: open.entityId ?? '', action: '', actorId: '' }); setOpen(null); }}>{t('ops.audit.filterEntity')}</Button>}
      >
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><Code className="text-sm">{open.action}</Code><Badge tone="neutral">{open.entity}</Badge></div>
            <div>
              <InfoRow label={t('common.date')} value={dateTime(open.createdAt, { dateStyle: 'full', timeStyle: 'medium' })} />
              <InfoRow label={t('ops.audit.actor')} value={actorCell(open)} />
              {open.entityId && <InfoRow label={t('ops.audit.entityId')} value={<span className="ltr break-all font-mono text-xs">{open.entityId}</span>} />}
              <InfoRow label={t('ops.audit.ip')} value={<span className="ltr">{open.ip ?? '—'}</span>} />
              {open.userAgent && <InfoRow label={t('ops.audit.ua')} value={<span className="ltr line-clamp-2 max-w-xs break-all text-xs">{open.userAgent}</span>} />}
            </div>
            <JsonDiff before={open.before} after={open.after} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
