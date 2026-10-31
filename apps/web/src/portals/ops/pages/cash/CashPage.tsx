import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Check, Clock, Coins, ExternalLink, Hourglass, Plus, Search, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { HandoverMethod } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cairoToday, dateTime, money, num, parseEgp, pct } from '@/lib/format';
import { useDebounced, usePollInterval, useQueryState } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Checkbox, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, StateBadge, Tabs, Textarea, type Column } from '@/components/ui';
import {
  CashBar, Code, FilterBar, FilterField, InfoRow, Money, MoneyInput, Notice, ReasonDialog, RecordHandoverModal, RequirePermission, Section, Stat, StatGrid, centsToInput, enumOptions, useEnumLabel, useHubName, useHubs,
  type CustodyList, type CustodyRow, type HandoverRow,
} from '@/portals/ops/components/opsb';
import './i18n';

type HandoverList = Paginated<HandoverRow> & { totals: { declaredCents: number; receivedCents: number; varianceCents: number } };

type HubSummary = {
  date: string;
  hubs: Array<{ hubId: string | null; code: string | null; name: string; handovers: number; receivedCents: number; declaredCents: number; varianceCents: number; byMethod: Record<string, { handovers: number; receivedCents: number }>; pendingHandovers: number; pendingDeclaredCents: number }>;
  byMethod: Record<string, { handovers: number; receivedCents: number }>;
  totals: { handovers: number; receivedCents: number; varianceCents: number; pendingHandovers: number };
};

export default function CashPage() {
  return (
    <RequirePermission permission="cash.read">
      <CashInner />
    </RequirePermission>
  );
}

function CashInner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [s, setS] = useQueryState({ tab: 'board' });
  const [drop, setDrop] = useState<CustodyRow | 'pick' | null>(null);
  const poll = usePollInterval(20_000);
  const totals = useQuery({ queryKey: ['cash', 'totals'], queryFn: () => api<CustodyList>('/cash/custody', { query: { pageSize: 1 } }).then((r) => r.totals), refetchInterval: poll });
  const tt = totals.data;

  return (
    <div>
      <PageHeader
        title={t('ops.cash.title')}
        subtitle={t('ops.cash.subtitle')}
        actions={can('cash.manage') && <Button variant="cash" icon={<Plus className="h-4 w-4" />} onClick={() => setDrop('pick')}>{t('ops.cash.recordDrop')}</Button>}
      />
      <StatGrid className="mb-5">
        <Stat icon={<Wallet />} tone="sand" label={t('ops.cash.kpi.custody')} value={<Money cents={tt?.custodyCents} compact />} hint={tt ? t('ops.cash.kpi.heroesHolding', { n: num(tt.heroes) }) : undefined} loading={totals.isLoading} />
        <Stat icon={<AlertTriangle />} tone="red" label={t('ops.cash.kpi.overLimit')} value={num(tt?.overLimit)} hint={tt ? t('ops.cash.kpi.nearLimit', { n: num(tt.nearLimit) }) : undefined} loading={totals.isLoading} />
        <Stat icon={<Hourglass />} tone="violet" label={t('ops.cash.kpi.pending')} value={num(tt?.pendingHandovers)} hint={tt ? <Money cents={tt.pendingDeclaredCents} /> : undefined} loading={totals.isLoading} onClick={() => setS({ tab: 'handovers' })} />
        <Stat icon={<Coins />} tone="ink" label={t('ops.cash.kpi.shortage')} value={<Money cents={tt?.outstandingShortageCents} compact />} loading={totals.isLoading} />
      </StatGrid>
      <Tabs
        className="mb-5"
        value={s.tab}
        onChange={(v) => setS({ tab: v })}
        tabs={[
          { value: 'board', label: t('ops.cash.tab.board') },
          { value: 'handovers', label: t('ops.cash.tab.handovers'), count: tt?.pendingHandovers || undefined },
          { value: 'desk', label: t('ops.cash.tab.desk') },
        ]}
      />
      {s.tab === 'board' && <CustodyBoard onDrop={(r) => setDrop(r)} />}
      {s.tab === 'handovers' && <Handovers />}
      {s.tab === 'desk' && <HubDesk />}
      <RecordHandoverModal
        open={drop !== null}
        onClose={() => setDrop(null)}
        courier={drop && drop !== 'pick' ? { id: drop.courierId, name: drop.name, code: drop.code, cashOnHandCents: drop.cashOnHandCents, homeHubId: drop.homeHubId } : undefined}
      />
    </div>
  );
}

/* ───────────────────────────── Custody board ───────────────────────────── */

function ageTone(h: number | null) {
  if (h === null) return 'text-ink-400';
  if (h > 48) return 'text-red-600 dark:text-red-400 font-semibold';
  if (h > 24) return 'text-amber-600 dark:text-amber-400 font-semibold';
  return 'text-ink-600 dark:text-ink-300';
}

function ageLabel(h: number | null, t: (k: string, v?: Record<string, string | number>) => string) {
  if (h === null) return '—';
  if (h >= 48) return t('ops.opsb.days', { n: num(Math.floor(h / 24)) });
  return t('ops.opsb.hours', { n: num(Math.round(h)) });
}

function CustodyBoard({ onDrop }: { onDrop: (r: CustodyRow) => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const hubs = useHubs();
  const hubName = useHubName();
  const poll = usePollInterval(20_000);
  const [f, setF] = useQueryState({ tab: 'board', q: '', hubId: '', sort: 'usedPct', all: '', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q, 350);
  useEffect(() => {
    if (dq !== f.q) setF({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const [shortage, setShortage] = useState<CustodyRow | null>(null);
  const list = useQuery({
    queryKey: ['cash', 'custody', f],
    queryFn: () => api<CustodyList>('/cash/custody', { query: { q: f.q, hubId: f.hubId, sort: f.sort, order: f.sort === 'code' ? 'asc' : 'desc', onlyWithCash: f.all ? 'false' : 'true', page: f.page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
    refetchInterval: poll,
  });
  const conv = useMutation({
    mutationFn: ({ r, reason }: { r: CustodyRow; reason: string }) => api('/cash/shortages', { method: 'POST', body: { courierId: r.courierId, reason } }),
    onSuccess: () => { toast.success(t('ops.cash.shortageDone')); setShortage(null); qc.invalidateQueries({ queryKey: ['cash'] }); qc.invalidateQueries({ queryKey: ['finance'] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const actions = (r: CustodyRow) =>
    can('cash.manage') ? (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {r.outstandingShortageCents > 0 && <Button size="sm" variant="outline" onClick={() => setShortage(r)}>{t('ops.cash.convert')}</Button>}
        {r.cashOnHandCents > 0 && <Button size="sm" variant="cash" icon={<Plus className="h-4 w-4" />} onClick={() => onDrop(r)}>{t('ops.cash.receive')}</Button>}
      </div>
    ) : null;

  const ratio = (r: CustodyRow) => (r.cashLimitCents ? r.cashOnHandCents / r.cashLimitCents : r.cashOnHandCents ? 1 : 0);

  const columns: Column<CustodyRow>[] = [
    {
      key: 'hero', header: t('ops.cash.col.hero'), cell: (r) => (
        <Link to={`/ops/heroes/${r.courierId}?tab=cash`} className="block min-w-[160px]" onClick={(e) => e.stopPropagation()}>
          <p className="font-semibold text-ink-900 hover:underline dark:text-ink-50">{r.name}</p>
          <p className="text-xs text-ink-500"><Code>{r.code}</Code> · {hubName(r.homeHubId, r.hub?.name)}</p>
        </Link>
      ),
    },
    { key: 'cash', header: t('ops.cash.col.custody'), cell: (r) => <div className="w-44"><CashBar onHandCents={r.cashOnHandCents} limitCents={r.cashLimitCents} /></div> },
    { key: 'pct', header: t('ops.cash.col.pct'), align: 'center', cell: (r) => <Badge tone={ratio(r) >= 1 ? 'danger' : ratio(r) >= 0.8 ? 'warning' : 'success'}><span className="ltr">{pct(r.usedPct / 100, 0)}</span></Badge> },
    {
      key: 'oldest', header: t('ops.cash.oldest'),
      cell: (r) => (
        <div className="whitespace-nowrap">
          <span className={cn('inline-flex items-center gap-1 text-sm', ageTone(r.oldestUnhandedHours))}><Clock className="h-3.5 w-3.5" />{ageLabel(r.oldestUnhandedHours, t)}</span>
          <p className="text-xs text-ink-400">{t('ops.cash.ordersN', { n: num(r.unhandedOrders) })}</p>
        </div>
      ),
    },
    { key: 'pending', header: t('ops.cash.pending'), align: 'end', cell: (r) => (r.pendingHandovers ? <span className="whitespace-nowrap"><Money cents={r.pendingDeclaredCents} /> <span className="text-xs text-ink-400">({num(r.pendingHandovers)})</span></span> : <span className="text-ink-300">—</span>), hideBelow: 'xl' },
    { key: 'short', header: t('ops.cash.shortage'), align: 'end', cell: (r) => (r.outstandingShortageCents ? <Money cents={-r.outstandingShortageCents} tone="auto" /> : <span className="text-ink-300">—</span>), hideBelow: 'xl' },
    { key: 'act', header: '', align: 'end', cell: actions },
  ];

  return (
    <>
      <FilterBar
        search={<Input type="search" leading={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ops.cash.search')} aria-label={t('action.search')} />}
        activeCount={[f.hubId, f.all].filter(Boolean).length}
        onClear={() => setF({ hubId: '', all: '' })}
      >
        <FilterField label={t('common.hub')}>
          <Select value={f.hubId} onChange={(e) => setF({ hubId: e.target.value })} placeholder={t('ops.opsb.allHubs')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} aria-label={t('common.hub')} />
        </FilterField>
        <FilterField label={t('ops.cash.sort')}>
          <Select value={f.sort} onChange={(e) => setF({ sort: e.target.value })} options={['usedPct', 'cash', 'oldest', 'code'].map((k) => ({ value: k, label: t(`ops.cash.sort.${k}`) }))} aria-label={t('ops.cash.sort')} />
        </FilterField>
        <Checkbox label={t('ops.cash.onlyWithCash')} checked={!f.all} onChange={(e) => setF({ all: e.target.checked ? '' : '1' })} />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(r) => r.courierId}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={<EmptyState icon={<Wallet className="h-7 w-7" />} title={t('ops.cash.boardEmpty')} />}
        mobileCard={(r) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link to={`/ops/heroes/${r.courierId}?tab=cash`} className="font-semibold text-ink-900 dark:text-ink-50">{r.name}</Link>
                <p className="text-xs text-ink-500"><Code>{r.code}</Code> · {hubName(r.homeHubId, r.hub?.name)}</p>
              </div>
              <Badge tone={ratio(r) >= 1 ? 'danger' : ratio(r) >= 0.8 ? 'warning' : 'success'}><span className="ltr">{pct(r.usedPct / 100, 0)}</span></Badge>
            </div>
            <CashBar onHandCents={r.cashOnHandCents} limitCents={r.cashLimitCents} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className={cn('inline-flex items-center gap-1', ageTone(r.oldestUnhandedHours))}><Clock className="h-3.5 w-3.5" />{t('ops.cash.age', { age: ageLabel(r.oldestUnhandedHours, t) })}</span>
              <span className="text-ink-500">{t('ops.cash.ordersN', { n: num(r.unhandedOrders) })}</span>
              {r.pendingHandovers > 0 && <Badge tone="warning">{t('state.PENDING')} · <Money cents={r.pendingDeclaredCents} /></Badge>}
            </div>
            {actions(r)}
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <ReasonDialog
        open={!!shortage}
        onClose={() => setShortage(null)}
        title={t('ops.cash.shortageTitle')}
        description={shortage ? `${shortage.name} · ${t('ops.cash.shortageDesc', { amount: money(shortage.outstandingShortageCents) })}` : undefined}
        danger
        loading={conv.isPending}
        confirmLabel={t('ops.cash.convert')}
        onConfirm={(reason) => shortage && conv.mutate({ r: shortage, reason })}
      />
    </>
  );
}

/* ───────────────────────────── Handovers ───────────────────────────── */

function Handovers() {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const hubs = useHubs();
  const hubName = useHubName();
  const poll = usePollInterval(20_000);
  const [f, setF] = useQueryState({ tab: 'handovers', status: 'PENDING', method: '', hubId: '', from: '', to: '', page: '1' });
  const [confirming, setConfirming] = useState<HandoverRow | null>(null);
  const [rejecting, setRejecting] = useState<HandoverRow | null>(null);
  const list = useQuery({
    queryKey: ['cash', 'handovers', f],
    queryFn: () => api<HandoverList>('/cash/handovers', { query: { status: f.status === 'ALL' ? undefined : f.status, method: f.method, hubId: f.hubId, from: f.from, to: f.to, page: f.page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
    refetchInterval: poll,
  });
  const reject = useMutation({
    mutationFn: ({ h, reason }: { h: HandoverRow; reason: string }) => api(`/cash/handovers/${h.id}/reject`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success(t('ops.cash.h.rejected')); setRejecting(null); qc.invalidateQueries({ queryKey: ['cash'] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const actions = (h: HandoverRow) =>
    h.status === 'PENDING' && can('cash.manage') ? (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => setConfirming(h)}>{t('ops.cash.h.confirm')}</Button>
        <Button size="sm" variant="ghost" icon={<X className="h-4 w-4 text-red-500" />} onClick={() => setRejecting(h)}>{t('ops.cash.h.reject')}</Button>
      </div>
    ) : null;

  const columns: Column<HandoverRow>[] = [
    { key: 'code', header: t('ops.opsb.code'), cell: (h) => <Code>{h.code}</Code> },
    { key: 'hero', header: t('ops.cash.col.hero'), cell: (h) => <Link to={`/ops/heroes/${h.courierId}?tab=cash`} className="font-medium text-ink-900 hover:underline dark:text-ink-50">{h.courier.name}<span className="ms-1 text-xs text-ink-400"><Code>{h.courier.code}</Code></span></Link> },
    { key: 'method', header: t('ops.opsb.method'), cell: (h) => <span className="whitespace-nowrap text-sm">{en('HandoverMethod', h.method)}{h.reference && <span className="ltr ms-1 text-xs text-ink-400">#{h.reference}</span>}</span>, hideBelow: 'lg' },
    { key: 'hub', header: t('common.hub'), cell: (h) => hubName(h.hubId, h.hub?.name), hideBelow: 'xl' },
    { key: 'date', header: t('common.date'), cell: (h) => <span className="whitespace-nowrap text-sm">{dateTime(h.createdAt)}</span>, hideBelow: 'md' },
    { key: 'status', header: t('common.status'), cell: (h) => <StateBadge value={h.status} /> },
    { key: 'declared', header: t('ops.cash.declared'), align: 'end', cell: (h) => <Money cents={h.declaredCents} className="font-semibold" /> },
    { key: 'received', header: t('ops.cash.received'), align: 'end', cell: (h) => (h.status === 'CONFIRMED' ? <Money cents={h.receivedCents} /> : '—'), hideBelow: 'md' },
    { key: 'variance', header: t('ops.cash.variance'), align: 'end', cell: (h) => (h.status === 'CONFIRMED' && h.varianceCents ? <Money cents={h.varianceCents} sign tone="auto" /> : '—'), hideBelow: 'lg' },
    { key: 'proof', header: '', cell: (h) => (h.proofUrl ? <a href={h.proofUrl} target="_blank" rel="noreferrer" aria-label={t('ops.cash.h.proof')} className="text-turtle-700 dark:text-turtle-400" onClick={(e) => e.stopPropagation()}><ExternalLink className="h-4 w-4" /></a> : null), hideBelow: 'xl' },
    { key: 'act', header: '', align: 'end', cell: actions },
  ];
  const statusTabs = ['PENDING', 'CONFIRMED', 'REJECTED', 'ALL'].map((v) => ({ value: v, label: v === 'ALL' ? t('common.all') : t(`state.${v}`) }));
  const tot = list.data?.totals;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label={t('ops.cash.h.status')}>
        {statusTabs.map((s) => (
          <Button key={s.value} size="sm" variant={f.status === s.value ? 'secondary' : 'outline'} aria-pressed={f.status === s.value} onClick={() => setF({ status: s.value })}>{s.label}</Button>
        ))}
      </div>
      <FilterBar activeCount={[f.method, f.hubId, f.from, f.to].filter(Boolean).length} onClear={() => setF({ method: '', hubId: '', from: '', to: '' })}>
        <FilterField label={t('ops.opsb.method')}>
          <Select value={f.method} onChange={(e) => setF({ method: e.target.value })} placeholder={t('ops.opsb.allMethods')} options={enumOptions('HandoverMethod', Object.values(HandoverMethod))} aria-label={t('ops.opsb.method')} />
        </FilterField>
        <FilterField label={t('common.hub')}>
          <Select value={f.hubId} onChange={(e) => setF({ hubId: e.target.value })} placeholder={t('ops.opsb.allHubs')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} aria-label={t('common.hub')} />
        </FilterField>
        <FilterField label={t('common.from')}><Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} aria-label={t('common.from')} className="md:!w-40" /></FilterField>
        <FilterField label={t('common.to')}><Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} aria-label={t('common.to')} className="md:!w-40" /></FilterField>
      </FilterBar>
      {tot && (list.data?.meta.total ?? 0) > 0 && (
        <p className="mb-3 text-sm text-ink-500">
          {t('ops.cash.h.totals', { declared: money(tot.declaredCents), received: money(tot.receivedCents), variance: money(tot.varianceCents, { sign: true }) })}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(h) => h.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={t('ops.cash.h.empty')}
        mobileCard={(h) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2"><Code>{h.code}</Code><StateBadge value={h.status} /></div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="font-semibold text-ink-900 dark:text-ink-50">{h.courier.name}</p><p className="text-xs text-ink-500">{en('HandoverMethod', h.method)} · {dateTime(h.createdAt)}</p></div>
              <div className="text-end"><Money cents={h.declaredCents} className="font-semibold" />{h.status === 'CONFIRMED' && h.varianceCents !== 0 && <div><Money cents={h.varianceCents} sign tone="auto" className="text-xs" /></div>}</div>
            </div>
            {actions(h)}
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <ConfirmHandoverModal handover={confirming} onClose={() => setConfirming(null)} />
      <ReasonDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={rejecting ? t('ops.cash.h.rejectTitle', { code: rejecting.code }) : ''}
        description={rejecting ? t('ops.cash.h.rejectDesc', { amount: money(rejecting.declaredCents) }) : undefined}
        danger
        loading={reject.isPending}
        confirmLabel={t('ops.cash.h.reject')}
        onConfirm={(reason) => rejecting && reject.mutate({ h: rejecting, reason })}
      />
    </>
  );
}

function ConfirmHandoverModal({ handover, onClose }: { handover: HandoverRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (handover) {
      setAmount(centsToInput(handover.declaredCents));
      setNotes('');
      setErr(undefined);
    }
  }, [handover]);
  const cents = parseEgp(amount);
  const variance = handover && cents !== null ? cents - handover.declaredCents : 0;
  const hero = useQuery({
    queryKey: ['heroes', 'detail', handover?.courierId],
    queryFn: () => api<{ cash: { onHandCents: number } }>(`/couriers/${handover!.courierId}`),
    enabled: !!handover,
  });
  const onHand = hero.data?.cash.onHandCents;
  const m = useMutation({
    mutationFn: () => api(`/cash/handovers/${handover!.id}/confirm`, { method: 'POST', body: { receivedCents: cents, notes: notes.trim() || undefined } }),
    onSuccess: () => { toast.success(t('ops.cash.h.confirmed')); qc.invalidateQueries({ queryKey: ['cash'] }); qc.invalidateQueries({ queryKey: ['heroes'] }); onClose(); },
    onError: (e) => { setErr(errorMessage(e)); toast.error(errorMessage(e)); },
  });
  return (
    <Modal
      open={!!handover}
      onClose={onClose}
      title={handover ? t('ops.cash.h.confirmTitle', { code: handover.code }) : ''}
      description={t('ops.cash.h.confirmDesc')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="cash" loading={m.isPending} onClick={() => { if (cents === null || cents < 0) { setErr(t('ops.opsb.invalidAmount')); return; } if (onHand !== undefined && cents > onHand) { setErr(t('ops.opsb.handover.exceeds', { amount: money(onHand) })); return; } m.mutate(); }}>{t('ops.cash.h.confirmBtn', { amount: money(cents ?? 0) })}</Button>
        </>
      }
    >
      {handover && (
        <div className="space-y-4">
          <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/50">
            <InfoRow label={t('ops.cash.col.hero')} value={<span>{handover.courier.name} · <Code>{handover.courier.code}</Code></span>} />
            <InfoRow label={t('ops.opsb.method')} value={en('HandoverMethod', handover.method)} />
            {handover.reference && <InfoRow label={t('ops.opsb.reference')} value={<span className="ltr">{handover.reference}</span>} />}
            <InfoRow label={t('ops.cash.declared')} value={<Money cents={handover.declaredCents} className="font-semibold" />} />
            <InfoRow label={t('ops.opsb.handover.onHand')} value={onHand === undefined ? '…' : <Money cents={onHand} />} />
          </div>
          <Field label={t('ops.cash.h.receivedAmount')} required error={err}>
            {(id) => <MoneyInput id={id} value={amount} onChange={(v) => { setAmount(v); setErr(undefined); }} invalid={!!err} />}
          </Field>
          {cents !== null && (
            <Notice tone={variance < 0 ? 'danger' : variance > 0 ? 'warning' : 'success'}>
              {variance < 0 ? t('ops.cash.h.short', { amount: money(-variance) }) : variance > 0 ? t('ops.cash.h.over', { amount: money(variance) }) : t('ops.cash.h.exact')}
            </Notice>
          )}
          <Field label={t('common.notes')}>{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────────── Hub desk ───────────────────────────── */

function HubDesk() {
  const { t, pick } = useI18n();
  const en = useEnumLabel();
  const hubs = useHubs();
  const [f, setF] = useQueryState({ tab: 'desk', date: cairoToday(), hubId: '' });
  const q = useQuery({ queryKey: ['cash', 'hub-summary', f.date, f.hubId], queryFn: () => api<HubSummary>('/cash/hub-summary', { query: { date: f.date, hubId: f.hubId } }) });
  const d = q.data;
  const hubName = (h: HubSummary['hubs'][number]) => {
    if (!h.hubId) return t('ops.cash.d.remote');
    const full = hubs.data?.find((x) => x.id === h.hubId);
    return full ? pick(full, 'name') || full.name : h.name;
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('ops.cash.d.date')}>{(id) => <Input id={id} type="date" max={cairoToday()} value={f.date} onChange={(e) => e.target.value && setF({ date: e.target.value })} className="!w-44" />}</Field>
        <Field label={t('common.hub')}>{(id) => <Select id={id} value={f.hubId} onChange={(e) => setF({ hubId: e.target.value })} placeholder={t('ops.opsb.allHubs')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} className="!w-52" />}</Field>
      </div>
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || d.hubs.length === 0 ? (
        <EmptyState icon={<Building2 className="h-7 w-7" />} title={t('ops.cash.d.empty')} />
      ) : (
        <>
          <StatGrid>
            <Stat icon={<Wallet />} tone="sand" label={t('ops.cash.d.totalReceived')} value={<Money cents={d.totals.receivedCents} compact />} hint={t('ops.cash.d.handovers', { n: num(d.totals.handovers) })} />
            <Stat icon={<Coins />} tone={d.totals.varianceCents < 0 ? 'red' : 'turtle'} label={t('ops.cash.variance')} value={<Money cents={d.totals.varianceCents} sign />} />
            <Stat icon={<Hourglass />} tone="violet" label={t('ops.cash.kpi.pending')} value={num(d.totals.pendingHandovers)} />
            <Stat icon={<Building2 />} tone="ink" label={t('ops.cash.d.hubs')} value={num(d.hubs.length)} />
          </StatGrid>
          <Section title={t('ops.cash.d.byMethod')}>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Object.entries(d.byMethod).map(([m, v]) => (
                <li key={m} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                  <p className="text-xs font-medium text-ink-500">{en('HandoverMethod', m)}</p>
                  <p className="mt-1 font-display text-lg font-bold"><Money cents={v.receivedCents} /></p>
                  <p className="text-xs text-ink-400">{t('ops.cash.d.handovers', { n: num(v.handovers) })}</p>
                </li>
              ))}
            </ul>
          </Section>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {d.hubs.map((h) => (
              <Section key={h.hubId ?? 'remote'} title={hubName(h)} subtitle={h.code ? <span className="ltr">{h.code}</span> : undefined}>
                <InfoRow label={t('ops.cash.declared')} value={<Money cents={h.declaredCents} />} />
                <InfoRow label={t('ops.cash.received')} value={<Money cents={h.receivedCents} className="font-semibold" />} />
                <InfoRow label={t('ops.cash.variance')} value={<Money cents={h.varianceCents} sign tone="auto" />} />
                <div className="mt-2 space-y-1 border-t border-ink-100 pt-2 dark:border-ink-800">
                  {Object.entries(h.byMethod).map(([m, v]) => (
                    <div key={m} className="flex items-center justify-between text-xs text-ink-500"><span>{en('HandoverMethod', m)} · {num(v.handovers)}</span><Money cents={v.receivedCents} /></div>
                  ))}
                </div>
                {h.pendingHandovers > 0 && <Notice tone="warning" className="mt-3">{t('ops.cash.d.pending', { n: num(h.pendingHandovers), amount: money(h.pendingDeclaredCents) })}</Notice>}
              </Section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
