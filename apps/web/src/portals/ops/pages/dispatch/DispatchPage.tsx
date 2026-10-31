import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bike, PackageCheck, Plus, Sparkles, Truck, UserPlus, Wand2, X } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { cairoToday, money, num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, DataTable, EmptyState, Field, Modal, PageHeader, Pagination, ProgressBar, Select, Skeleton, StateBadge, Tabs, type Column } from '@/components/ui';
import { Mono, NoAccess, SectionCard, SlaChip, addDaysIso } from '../../components/opsa/ui';
import { useCouriers, useLookupOptions } from '../../components/opsa/lookups';
import type { OrderRow, RunsheetRow } from '../../components/opsa/types';
import { SuggestionCard, type Suggestion } from '../orders/OrderActions';
import '../orders/i18n';
import './i18n';

interface Plan {
  date: string;
  commit: boolean;
  assignments: Array<{ orderId: string; trackingNumber: string; zoneCode: string; courier: { id: string; code: string; name: string; availability: string }; score: number; collectCents: number }>;
  unassigned: Array<{ orderId: string; trackingNumber: string; zoneCode: string; reasons: string[] }>;
  skipped: Array<{ orderId: string; trackingNumber?: string; reasons: string[] }>;
  byCourier: Array<{ courier: { id: string; code: string; name: string; availability: string }; orders: number; codCents: number }>;
  runsheets: Array<{ id: string; code: string; courierId: string; added: number }>;
}

/** Adds orders to the hero's DRAFT runsheet for the day, creating it when needed. */
export async function assignToHeroRunsheet(courierId: string, orderIds: string[], date: string, hubId?: string) {
  const drafts = await api<Paginated<RunsheetRow>>('/runsheets', { query: { courierId, date, status: 'DRAFT', pageSize: 1 } });
  const draft = drafts.data[0];
  if (draft) {
    await api(`/runsheets/${draft.id}/orders`, { method: 'POST', body: { orderIds } });
    return draft;
  }
  return api<RunsheetRow>('/runsheets', { method: 'POST', body: { courierId, date, hubId: hubId || undefined, orderIds } });
}

export default function DispatchPage() {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const [f, setF] = useQueryState({ tab: 'unassigned', hub: me?.hubId ?? '', date: cairoToday(), status: '', page: '1' });
  const { hubs } = useLookupOptions();
  if (!can('runsheets.read')) return <NoAccess />;
  const manage = can('dispatch.manage');
  const tab = manage ? f.tab : 'runsheets';

  return (
    <div className="space-y-4">
      <PageHeader title={t('ops.dispatch.title')} subtitle={t('ops.dispatch.subtitle')} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={t('common.hub')} className="sm:w-64">{(id) => <Select id={id} value={f.hub} onChange={(e) => setF({ hub: e.target.value })} options={hubs} placeholder={t('ops.opsa.anyHub')} />}</Field>
        <Field label={t('ops.dispatch.date')} className="sm:w-48">
          {(id) => <input id={id} type="date" value={f.date} min={tab === 'unassigned' ? cairoToday() : undefined} max={addDaysIso(cairoToday(), 7)} onChange={(e) => e.target.value && setF({ date: e.target.value })} className="ltr h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm dark:border-ink-700 dark:bg-ink-900" />}
        </Field>
      </div>
      {manage && (
        <Tabs
          value={tab}
          onChange={(v) => setF({ tab: v })}
          tabs={[
            { value: 'unassigned', label: t('ops.dispatch.tab.unassigned') },
            { value: 'runsheets', label: t('ops.dispatch.tab.runsheets') },
          ]}
        />
      )}
      {tab === 'unassigned' ? <Unassigned hubId={f.hub} date={f.date} /> : <Runsheets hubId={f.hub} date={f.date} status={f.status} page={Number(f.page) || 1} setF={setF} />}
    </div>
  );
}

// ------------------------------------------------------------------ unassigned

function Unassigned({ hubId, date }: { hubId: string; date: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [suggestFor, setSuggestFor] = useState<OrderRow | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const query = { status: 'RECEIVED_AT_HUB', hubId: hubId || undefined, pageSize: 200, sort: 'promisedBy', order: 'asc' };
  const list = useQuery({ queryKey: ['orders', 'list', query], queryFn: () => api<Paginated<OrderRow>>('/orders', { query }), placeholderData: keepPreviousData });

  const preview = useMutation({
    mutationFn: () => api<Plan>('/dispatch/auto-assign', { method: 'POST', body: { hubId: hubId || undefined, date, orderIds: selected.size ? [...selected] : undefined, commit: false } }),
    onSuccess: setPlan,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const commit = useMutation({
    mutationFn: () => api<Plan>('/dispatch/auto-assign', { method: 'POST', body: { hubId: hubId || undefined, date, orderIds: plan?.assignments.map((a) => a.orderId), commit: true } }),
    onSuccess: (p) => {
      toast.success(t('ops.dispatch.plan.committed', { n: num(p.runsheets.length) }));
      setPlan(null);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['runsheets'] });
      void qc.invalidateQueries({ queryKey: ['dispatch'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<OrderRow>[] = [
    {
      key: 'order',
      header: t('ops.dispatch.col.order'),
      cell: (r) => (
        <div>
          <Link to={`/ops/orders/${r.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline"><Mono className="font-semibold">{r.trackingNumber}</Mono></Link>
          <p className="truncate text-xs text-ink-500">{r.brand?.name} · {r.recipientName}</p>
        </div>
      ),
    },
    { key: 'zone', header: t('ops.dispatch.col.zone'), cell: (r) => <span className="whitespace-nowrap">{r.zone ? (locale === 'ar' ? r.zone.nameAr : r.zone.nameEn) : '—'}</span> },
    { key: 'collect', header: t('ops.dispatch.col.collect'), cell: (r) => (r.collectCents ? <span className="ltr font-semibold text-sand-700 dark:text-sand-300">{money(r.collectCents)}</span> : <Badge>{t('ops.orders.prepaid')}</Badge>) },
    { key: 'attempts', header: t('ops.dispatch.col.attempts'), hideBelow: 'lg', cell: (r) => <span className="ltr">{num(r.attempts)}/{num(r.maxAttempts)}</span> },
    { key: 'sla', header: t('ops.dispatch.col.sla'), hideBelow: 'md', cell: (r) => <SlaChip due={r.promisedBy} /> },
    {
      key: 'act',
      header: '',
      align: 'end',
      cell: (r) => <Button size="xs" variant="outline" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setSuggestFor(r); }}>{t('ops.dispatch.suggest')}</Button>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<Wand2 className="h-4 w-4" />} loading={preview.isPending} disabled={!list.data?.data.length} onClick={() => preview.mutate()}>
          {selected.size ? t('ops.dispatch.autoPreviewSel', { n: num(selected.size) }) : t('ops.dispatch.autoPreview')}
        </Button>
        {selected.size > 0 && <Button variant="outline" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAssignOpen(true)}>{t('ops.dispatch.assignSelected', { n: num(selected.size) })}</Button>}
        {list.data && <span className="ms-auto text-sm text-ink-500">{t('common.rows', { n: num(list.data.meta.total) })}</span>}
      </div>

      {plan && <PlanPanel plan={plan} onDiscard={() => setPlan(null)} onCommit={() => commit.mutate()} committing={commit.isPending} />}

      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        selected={selected}
        onSelectChange={setSelected}
        onRowClick={(r) => navigate(`/ops/orders/${r.id}`)}
        dense
        empty={<EmptyState icon={<PackageCheck className="h-7 w-7" />} title={t('ops.dispatch.empty')} description={t('ops.dispatch.emptyHint')} />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Mono className="font-semibold">{r.trackingNumber}</Mono>
              {r.collectCents ? <span className="ltr text-sm font-semibold text-sand-700 dark:text-sand-300">{money(r.collectCents)}</span> : <Badge>{t('ops.orders.prepaid')}</Badge>}
            </div>
            <p className="truncate text-xs text-ink-500">{r.brand?.name} · {r.zone ? (locale === 'ar' ? r.zone.nameAr : r.zone.nameEn) : ''}</p>
            <div className="flex items-center justify-between gap-2">
              <SlaChip due={r.promisedBy} />
              <Button size="xs" variant="outline" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setSuggestFor(r); }}>{t('ops.dispatch.suggest')}</Button>
            </div>
          </div>
        )}
      />

      {suggestFor && <SuggestModal order={suggestFor} date={date} hubId={hubId} onClose={() => setSuggestFor(null)} />}
      {assignOpen && <AssignManyModal orderIds={[...selected]} date={date} hubId={hubId} onClose={() => setAssignOpen(false)} onDone={() => setSelected(new Set())} />}
    </div>
  );
}

function PlanPanel({ plan, onDiscard, onCommit, committing }: { plan: Plan; onDiscard: () => void; onCommit: () => void; committing: boolean }) {
  const { t } = useI18n();
  return (
    <SectionCard
      title={<span className="flex items-center gap-2"><Wand2 className="h-4 w-4 text-turtle-600" />{t('ops.dispatch.plan.title')}</span>}
      subtitle={t('ops.dispatch.plan.sub', { a: num(plan.assignments.length), h: num(plan.byCourier.length), u: num(plan.unassigned.length + plan.skipped.length) })}
      className="border-turtle-200 ring-1 ring-turtle-100 dark:border-turtle-900 dark:ring-turtle-950"
      actions={
        <>
          <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={onDiscard}>{t('ops.dispatch.plan.discard')}</Button>
          <Button size="sm" icon={<Truck className="h-4 w-4" />} loading={committing} disabled={!plan.assignments.length} onClick={onCommit}>{t('ops.dispatch.plan.commit')}</Button>
        </>
      }
    >
      {!plan.assignments.length && <p className="mb-3 text-sm text-ink-500">{t('ops.dispatch.plan.nothing')}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plan.byCourier.map((b) => (
          <div key={b.courier.id} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold"><Bike className="h-4 w-4 text-turtle-600" />{b.courier.name}</p>
              <Mono className="text-xs text-ink-400">{b.courier.code}</Mono>
            </div>
            <p className="mt-1 text-xs text-ink-500">{t('ops.dispatch.plan.orders', { n: num(b.orders) })} · <span className="ltr">{t('ops.dispatch.plan.cod', { v: money(b.codCents) })}</span></p>
            <ul className="mt-2 flex flex-wrap gap-1">
              {plan.assignments.filter((a) => a.courier.id === b.courier.id).map((a) => (
                <li key={a.orderId}><Badge className="font-mono" ><span className="ltr">{a.trackingNumber}</span> · <span className="ltr">{a.zoneCode}</span></Badge></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {(plan.unassigned.length > 0 || plan.skipped.length > 0) && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600">{t('ops.dispatch.plan.unassigned')}</p>
          <ul className="space-y-1">
            {[...plan.unassigned, ...plan.skipped].map((u) => (
              <li key={u.orderId} className="flex flex-wrap items-center gap-2 text-sm">
                <Mono>{u.trackingNumber ?? u.orderId}</Mono>
                {'zoneCode' in u && <span className="ltr text-xs text-ink-500">{(u as { zoneCode: string }).zoneCode}</span>}
                {u.reasons.map((r) => <Badge key={r} tone="danger">{t(`ops.orders.reason.${r}`)}</Badge>)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function useAssignMutation(onSuccess: () => void) {
  const { t } = useI18n();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { courierId: string; orderIds: string[]; date: string; hubId?: string }) => assignToHeroRunsheet(v.courierId, v.orderIds, v.date, v.hubId),
    onSuccess: (rs) => {
      toast.success(t('ops.dispatch.assigned', { code: rs.code }));
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['runsheets'] });
      void qc.invalidateQueries({ queryKey: ['dispatch'] });
      onSuccess();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function SuggestModal({ order, date, hubId, onClose }: { order: OrderRow; date: string; hubId: string; onClose: () => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['dispatch', 'suggest', order.id], queryFn: () => api<{ candidates: Suggestion[]; ineligible: Suggestion[] }>(`/dispatch/suggest/${order.id}`) });
  const m = useAssignMutation(onClose);
  const list = [...(q.data?.candidates ?? []), ...(q.data?.ineligible ?? [])];
  return (
    <Modal open onClose={onClose} size="lg" title={t('ops.dispatch.suggestTitle', { tn: order.trackingNumber })} description={t('ops.dispatch.assignHint')}>
      {q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState title={t('ops.orders.assign.none')} />
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.courier.id}>
              <SuggestionCard s={s} loading={m.isPending && m.variables?.courierId === s.courier.id} onPick={() => m.mutate({ courierId: s.courier.id, orderIds: [order.id], date, hubId: hubId || order.hubId || undefined })} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function AssignManyModal({ orderIds, date, hubId, onClose, onDone }: { orderIds: string[]; date: string; hubId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const couriers = useCouriers({ hubId: hubId || undefined });
  const [courierId, setCourier] = useState('');
  const m = useAssignMutation(() => { onDone(); onClose(); });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('ops.dispatch.assignTitle', { n: num(orderIds.length) })}
      description={t('ops.dispatch.assignHint')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={!courierId} loading={m.isPending} onClick={() => m.mutate({ courierId, orderIds, date, hubId: hubId || undefined })}>{t('ops.orders.assign.choose')}</Button>
        </>
      }
    >
      <Field label={t('ops.dispatch.pickHero')}>
        {(id) => (
          <Select
            id={id}
            value={courierId}
            onChange={(e) => setCourier(e.target.value)}
            placeholder="—"
            options={(couriers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.code} · ${t(`ops.opsa.avail.${c.availability}`)} · ${money(c.cashOnHandCents, { compact: true })}` }))}
          />
        )}
      </Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ runsheets

function Runsheets({ hubId, date, status, page, setF }: { hubId: string; date: string; status: string; page: number; setF: (p: Record<string, string>) => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const query = { date, hubId: hubId || undefined, status: status || undefined, page, pageSize: 25 };
  const list = useQuery({ queryKey: ['runsheets', query], queryFn: () => api<Paginated<RunsheetRow>>('/runsheets', { query }), placeholderData: keepPreviousData });
  const columns: Column<RunsheetRow>[] = [
    { key: 'code', header: t('ops.dispatch.rs.col.code'), cell: (r) => <Mono className="font-semibold">{r.code}</Mono> },
    { key: 'hero', header: t('ops.dispatch.rs.col.hero'), cell: (r) => <div><p className="font-medium">{r.courier.name}</p><p className="ltr text-start text-xs text-ink-400">{r.hub?.code}</p></div> },
    { key: 'status', header: t('ops.dispatch.rs.status'), cell: (r) => <StateBadge value={r.status} label={t(`ops.opsa.rs.${r.status}`)} /> },
    {
      key: 'progress',
      header: t('ops.dispatch.rs.col.progress'),
      cell: (r) => (
        <div className="w-40">
          <div className="mb-1 flex justify-between text-xs text-ink-500"><span>{t('ops.dispatch.rs.stops', { done: num(r.progress.done), total: num(r.progress.total) })}</span><span className="ltr">{num(r.progress.percent)}%</span></div>
          <div className="flex h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
            <div className="bg-turtle-500" style={{ width: `${r.progress.total ? (r.progress.delivered / r.progress.total) * 100 : 0}%` }} />
            <div className="bg-amber-400" style={{ width: `${r.progress.total ? ((r.progress.failed + r.progress.returns) / r.progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'cod',
      header: t('ops.dispatch.rs.col.cod'),
      hideBelow: 'lg',
      cell: (r) => (
        <div className="w-40">
          <p className="ltr text-start text-xs"><b className="text-sand-700 dark:text-sand-300">{money(r.collectedCents)}</b> <span className="text-ink-400">/ {money(r.expectedCodCents)}</span></p>
          <ProgressBar value={r.expectedCodCents ? r.collectedCents / r.expectedCodCents : 0} tone="sand" className="mt-1 h-1.5" />
        </div>
      ),
    },
    { key: 'route', header: t('ops.dispatch.rs.col.route'), hideBelow: 'xl', cell: (r) => <span className="whitespace-nowrap text-xs text-ink-500">{r.totalDistanceKm != null ? t('ops.opsa.unit.km', { n: num(r.totalDistanceKm) }) : '—'} · {r.totalMinutes != null ? t('ops.opsa.unit.min', { n: num(r.totalMinutes) }) : '—'}</span> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('ops.dispatch.rs.status')} value={status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('ops.opsa.anyStatus')} options={['DRAFT', 'DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'].map((s) => ({ value: s, label: t(`ops.opsa.rs.${s}`) }))} className="w-48" />
        {can('runsheets.manage') && <Button variant="outline" className="ms-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>{t('ops.dispatch.rs.new')}</Button>}
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(r) => navigate(`/ops/dispatch/runsheets/${r.id}`)}
        empty={<EmptyState icon={<Truck className="h-7 w-7" />} title={t('ops.dispatch.rs.empty')} />}
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Mono className="font-semibold">{r.code}</Mono>
              <StateBadge value={r.status} label={t(`ops.opsa.rs.${r.status}`)} />
            </div>
            <p className="text-sm font-medium">{r.courier.name} <span className="ltr text-xs text-ink-400">{r.hub?.code}</span></p>
            <ProgressBar value={r.progress.percent / 100} />
            <div className="flex justify-between text-xs text-ink-500">
              <span>{t('ops.dispatch.rs.stops', { done: num(r.progress.done), total: num(r.progress.total) })}</span>
              <span className="ltr">{money(r.collectedCents)} / {money(r.expectedCodCents)}</span>
            </div>
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : undefined}
      />
      {newOpen && <NewRunsheetModal date={date} hubId={hubId} onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function NewRunsheetModal({ date, hubId, onClose }: { date: string; hubId: string; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const couriers = useCouriers({ hubId: hubId || undefined });
  const [courierId, setCourier] = useState('');
  const m = useMutation({
    mutationFn: () => api<RunsheetRow>('/runsheets', { method: 'POST', body: { courierId, date, hubId: hubId || undefined } }),
    onSuccess: (rs) => {
      toast.success(t('ops.dispatch.rs.created', { code: rs.code }));
      void qc.invalidateQueries({ queryKey: ['runsheets'] });
      navigate(`/ops/dispatch/runsheets/${rs.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('ops.dispatch.rs.newTitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={!courierId} loading={m.isPending} onClick={() => m.mutate()}>{t('action.create')}</Button>
        </>
      }
    >
      <Field label={t('ops.dispatch.pickHero')}>
        {(id) => <Select id={id} value={courierId} onChange={(e) => setCourier(e.target.value)} placeholder="—" options={(couriers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.code}` }))} />}
      </Field>
    </Modal>
  );
}
