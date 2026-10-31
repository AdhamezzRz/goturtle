import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Ban, Plus, Undo2, Users, Wallet, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { AdjustmentType, PayoutMethod } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cairoToday, dateOnly, dateTime, money, num } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, StateBadge, Tabs, type Column } from '@/components/ui';
import {
  AdjustmentModal, AttendanceFlags, Code, CourierSelect, FilterBar, FilterField, InfoRow, Money, Notice, ReasonDialog, RequirePermission, Section, addDaysStr, apiFieldErrors, enumOptions, minutesLabel, monthStart, useCourierOptions, useEnumLabel,
  type AdjustmentRow, type PayoutRow, type ShiftRow,
} from '@/portals/ops/components/opsb';
import './i18n';
import '../shifts/i18n';

type PayoutList = Paginated<PayoutRow> & { totals: { netCents: number } };
type Cat = { count: number; creditsCents: number; debitsCents: number; netCents: number };
type PayoutDetail = PayoutRow & { payableNowCents: number; categories: Record<string, Cat>; shifts: ShiftRow[]; adjustments: AdjustmentRow[] };
type GenResult = { periodStart: string; periodEnd: string; created: PayoutRow[]; skipped: Array<{ courierId: string; reason: string; payableCents?: number }>; totalNetCents: number };

export default function PayoutsPage() {
  return (
    <RequirePermission permission="finance.read">
      <PayoutsInner />
    </RequirePermission>
  );
}

function PayoutsInner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [s, setS] = useQueryState({ tab: 'payouts' });
  const [gen, setGen] = useState(false);
  const [adj, setAdj] = useState(false);
  return (
    <div>
      <PageHeader
        title={t('ops.payouts.title')}
        subtitle={t('ops.payouts.subtitle')}
        actions={
          <>
            {can('finance.manage') && <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setAdj(true)}>{t('ops.payouts.adj.new')}</Button>}
            {can('payouts.manage') && <Button icon={<Wand2 className="h-4 w-4" />} onClick={() => setGen(true)}>{t('ops.payouts.generate')}</Button>}
          </>
        }
      />
      <Tabs className="mb-4" value={s.tab} onChange={(v) => setS({ tab: v })} tabs={[{ value: 'payouts', label: t('ops.payouts.tab.payouts') }, { value: 'adjustments', label: t('ops.payouts.tab.adjustments') }]} />
      {s.tab === 'payouts' ? <PayoutsList /> : <AdjustmentsList />}
      <GeneratePayrollModal open={gen} onClose={() => setGen(false)} />
      <AdjustmentModal open={adj} onClose={() => setAdj(false)} />
    </div>
  );
}

/* ───────────────────────────── Payouts list ───────────────────────────── */

function PayoutsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useQueryState({ tab: 'payouts', status: '', courierId: '', from: '', to: '', page: '1' });
  const [open, setOpen] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const [act, setAct] = useState<{ kind: 'approve' | 'pay' | 'cancel'; p: PayoutRow } | null>(null);
  const q = useQuery({
    queryKey: ['finance', 'payouts', f],
    queryFn: () => api<PayoutList>('/finance/payouts', { query: { status: f.status, courierId: f.courierId, from: f.from, to: f.to, page: f.page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  useEffect(() => setSel(new Set()), [f.status, f.courierId, f.page]);
  const manage = can('payouts.manage');
  const drafts = (q.data?.data ?? []).filter((p) => sel.has(p.id) && p.status === 'DRAFT');
  const bulkM = useMutation({
    mutationFn: async () => {
      const r = await Promise.allSettled(drafts.map((p) => api(`/finance/payouts/${p.id}/approve`, { method: 'POST' })));
      return { ok: r.filter((x) => x.status === 'fulfilled').length, fail: r.filter((x) => x.status === 'rejected').length };
    },
    onSuccess: (r) => { (r.fail ? toast.error : toast.success)(t('ops.payouts.bulkDone', { ok: num(r.ok), fail: num(r.fail) })); setBulk(false); setSel(new Set()); qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
  const rowActions = (p: PayoutRow) =>
    manage ? (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {p.status === 'DRAFT' && <Button size="sm" variant="outline" icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setAct({ kind: 'approve', p })}>{t('ops.payouts.approve')}</Button>}
        {p.status === 'APPROVED' && <Button size="sm" variant="cash" icon={<Wallet className="h-4 w-4" />} onClick={() => setAct({ kind: 'pay', p })}>{t('ops.payouts.pay')}</Button>}
        {(p.status === 'DRAFT' || p.status === 'APPROVED') && <Button size="sm" variant="ghost" aria-label={t('ops.payouts.cancel')} icon={<Ban className="h-4 w-4 text-red-500" />} onClick={() => setAct({ kind: 'cancel', p })} />}
      </div>
    ) : null;
  const columns: Column<PayoutRow>[] = [
    { key: 'code', header: t('ops.payouts.col.code'), cell: (p) => <div><Code>{p.code}</Code><p className="whitespace-nowrap text-[11px] text-ink-400">{dateOnly(p.periodStart)} – {dateOnly(p.periodEnd)}</p></div> },
    { key: 'hero', header: t('ops.payouts.col.hero'), cell: (p) => <Link to={`/ops/heroes/${p.courierId}?tab=pay`} onClick={(e) => e.stopPropagation()} className="block min-w-[120px] font-medium text-ink-900 hover:underline dark:text-ink-50">{p.courier.name}<span className="block text-xs text-ink-400"><Code>{p.courier.code}</Code></span></Link> },
    { key: 'del', header: t('ops.payouts.col.deliveries'), align: 'center', cell: (p) => <span className="ltr tabular">{num(p.deliveriesCount)}</span>, hideBelow: 'lg' },
    { key: 'pick', header: t('ops.payouts.col.pickups'), align: 'center', cell: (p) => <span className="ltr tabular">{num(p.pickupsCount)}</span>, className: 'hidden 2xl:table-cell' },
    { key: 'hrs', header: t('ops.payouts.col.hours'), align: 'center', cell: (p) => <span className="ltr tabular">{minutesLabel(p.workedMinutes)}</span>, className: 'hidden 2xl:table-cell' },
    { key: 'earn', header: t('ops.payouts.col.earnings'), align: 'end', cell: (p) => <Money cents={p.deliveryEarningsCents + p.hourlyEarningsCents + p.salaryCents} />, hideBelow: 'lg' },
    { key: 'bon', header: t('ops.payouts.col.bonuses'), align: 'end', cell: (p) => (p.bonusesCents ? <Money cents={p.bonusesCents} sign tone="auto" /> : <span className="text-ink-300">—</span>), className: 'hidden 2xl:table-cell' },
    { key: 'ded', header: t('ops.payouts.col.deductions'), align: 'end', cell: (p) => (p.deductionsCents ? <Money cents={-p.deductionsCents} tone="auto" /> : <span className="text-ink-300">—</span>), className: 'hidden 2xl:table-cell' },
    { key: 'net', header: t('ops.payouts.col.net'), align: 'end', cell: (p) => <Money cents={p.netCents} className="font-semibold" /> },
    { key: 'status', header: t('common.status'), cell: (p) => <StateBadge value={p.status} /> },
    { key: 'act', header: '', align: 'end', cell: rowActions },
  ];
  return (
    <>
      <Tabs
        className="mb-4"
        value={f.status || 'ALL'}
        onChange={(v) => setF({ status: v === 'ALL' ? '' : v })}
        tabs={['ALL', 'DRAFT', 'APPROVED', 'PAID', 'CANCELLED'].map((v) => ({ value: v, label: v === 'ALL' ? t('common.all') : t(`state.${v}`) }))}
      />
      <FilterBar
        activeCount={[f.courierId, f.from, f.to].filter(Boolean).length}
        onClear={() => setF({ courierId: '', from: '', to: '' })}
        actions={manage && drafts.length > 0 && <Button size="sm" icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setBulk(true)}>{t('ops.payouts.bulkApprove', { n: num(drafts.length) })}</Button>}
      >
        <FilterField label={t('common.hero')}><CourierSelect value={f.courierId} onChange={(v) => setF({ courierId: v })} placeholder={t('ops.opsb.allHeroes')} /></FilterField>
        <FilterField label={t('common.from')}><Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} aria-label={t('common.from')} className="md:!w-40" /></FilterField>
        <FilterField label={t('common.to')}><Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} aria-label={t('common.to')} className="md:!w-40" /></FilterField>
      </FilterBar>
      {q.data && q.data.meta.total > 0 && <p className="mb-3 text-sm text-ink-500">{t('ops.payouts.totals', { amount: money(q.data.totals.netCents) })}</p>}
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(p) => p.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        onRowClick={(p) => setOpen(p.id)}
        selected={manage ? sel : undefined}
        onSelectChange={manage ? setSel : undefined}
        empty={<EmptyState icon={<Users className="h-7 w-7" />} title={t('ops.payouts.empty')} />}
        mobileCard={(p) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><Code>{p.code}</Code><StateBadge value={p.status} /></div>
            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{p.courier.name}</span><Money cents={p.netCents} className="font-semibold" /></div>
            <p className="text-xs text-ink-500">{dateOnly(p.periodStart)} – {dateOnly(p.periodEnd)} · {t('ops.payouts.col.deliveries')} {num(p.deliveriesCount)}</p>
            {rowActions(p)}
          </div>
        )}
        footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <PayoutDrawer id={open} onClose={() => setOpen(null)} onAct={(kind, p) => setAct({ kind, p })} />
      <PayoutActionDialogs act={act} onClose={() => setAct(null)} />
      <ConfirmDialog open={bulk} onClose={() => setBulk(false)} onConfirm={() => bulkM.mutate()} loading={bulkM.isPending} title={t('ops.payouts.bulkTitle', { n: num(drafts.length) })} confirmLabel={t('ops.payouts.approve')}>
        <p className="text-sm text-ink-600 dark:text-ink-300">{t('ops.payouts.bulkDesc')}</p>
        <p className="mt-1 font-display text-2xl font-bold"><Money cents={drafts.reduce((s, p) => s + p.netCents, 0)} /></p>
      </ConfirmDialog>
    </>
  );
}

function PayoutActionDialogs({ act, onClose }: { act: { kind: 'approve' | 'pay' | 'cancel'; p: PayoutRow } | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [method, setMethod] = useState('VODAFONE_CASH');
  const [ref, setRef] = useState('');
  useEffect(() => {
    if (act?.kind === 'pay') { setMethod(act.p.courier.walletPhone ? 'VODAFONE_CASH' : 'CASH'); setRef(''); }
  }, [act]);
  const ok = (msg: string) => () => { toast.success(msg); qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['heroes'] }); onClose(); };
  const approve = useMutation({ mutationFn: (id: string) => api(`/finance/payouts/${id}/approve`, { method: 'POST' }), onSuccess: ok(t('ops.payouts.approved')), onError: (e) => toast.error(errorMessage(e)) });
  const pay = useMutation({ mutationFn: (id: string) => api(`/finance/payouts/${id}/pay`, { method: 'POST', body: { method, paymentReference: ref.trim() || undefined } }), onSuccess: ok(t('ops.payouts.paid')), onError: (e) => toast.error(errorMessage(e)) });
  const cancel = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/finance/payouts/${id}/cancel`, { method: 'POST', body: { reason } }), onSuccess: ok(t('ops.payouts.cancelled')), onError: (e) => toast.error(errorMessage(e)) });
  const p = act?.p;
  return (
    <>
      <ConfirmDialog open={act?.kind === 'approve'} onClose={onClose} onConfirm={() => p && approve.mutate(p.id)} loading={approve.isPending} title={p ? t('ops.payouts.approveTitle', { code: p.code }) : ''} confirmLabel={t('ops.payouts.approve')}>
        {p && <><p className="text-sm text-ink-600 dark:text-ink-300">{t('ops.payouts.approveDesc', { name: p.courier.name })}</p><p className="mt-1 font-display text-2xl font-bold"><Money cents={p.netCents} /></p></>}
      </ConfirmDialog>
      <Modal
        open={act?.kind === 'pay'}
        onClose={onClose}
        title={p ? t('ops.payouts.payTitle', { amount: money(p.netCents), name: p.courier.name }) : ''}
        description={t('ops.payouts.payDesc')}
        footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button variant="cash" loading={pay.isPending} onClick={() => p && pay.mutate(p.id)}>{t('ops.payouts.pay')} · {p ? money(p.netCents) : ''}</Button></>}
      >
        {p && (
          <div className="space-y-4">
            <Notice tone="info"><span className="font-display text-xl font-bold"><Money cents={p.netCents} /></span> → {p.courier.name}{p.courier.walletPhone && <> · {t('ops.payouts.wallet')} <span className="ltr font-semibold">{p.courier.walletPhone}</span></>}</Notice>
            <Field label={t('ops.opsb.method')} required>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)} options={enumOptions('PayoutMethod', Object.values(PayoutMethod))} />}</Field>
            <Field label={t('ops.settlements.d.paymentRef')} hint={t('ops.opsb.optional')}>{(id) => <Input id={id} dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} />}</Field>
          </div>
        )}
      </Modal>
      <ReasonDialog open={act?.kind === 'cancel'} onClose={onClose} title={p ? t('ops.payouts.cancelTitle', { code: p.code }) : ''} description={t('ops.payouts.cancelDesc')} danger loading={cancel.isPending} confirmLabel={t('ops.payouts.cancel')} onConfirm={(reason) => p && cancel.mutate({ id: p.id, reason })}>
        {p && <InfoRow label={p.courier.name} value={<Money cents={p.netCents} className="font-semibold" />} />}
      </ReasonDialog>
    </>
  );
}

function PayoutDrawer({ id, onClose, onAct }: { id: string | null; onClose: () => void; onAct: (k: 'approve' | 'pay' | 'cancel', p: PayoutRow) => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const q = useQuery({ queryKey: ['finance', 'payout', id], queryFn: () => api<PayoutDetail>(`/finance/payouts/${id}`), enabled: !!id });
  const p = q.data;
  const manage = can('payouts.manage');
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={p ? <span className="ltr">{p.code}</span> : t('ops.payouts.breakdown')}
      width="max-w-lg"
      footer={p && manage && (
        <>
          {(p.status === 'DRAFT' || p.status === 'APPROVED') && <Button variant="ghost" onClick={() => onAct('cancel', p)}>{t('ops.payouts.cancel')}</Button>}
          {p.status === 'DRAFT' && <Button onClick={() => onAct('approve', p)}>{t('ops.payouts.approve')}</Button>}
          {p.status === 'APPROVED' && <Button variant="cash" onClick={() => onAct('pay', p)}>{t('ops.payouts.pay')}</Button>}
        </>
      )}
    >
      {q.isLoading || !p ? <Skeleton className="h-96" /> : (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link to={`/ops/heroes/${p.courierId}?tab=pay`} className="text-lg font-semibold hover:underline">{p.courier.name}</Link>
              <p className="text-sm text-ink-500"><Code>{p.courier.code}</Code> · {en('EmploymentType', p.courier.employmentType)}</p>
              <p className="text-xs text-ink-400">{dateOnly(p.periodStart)} – {dateOnly(p.periodEnd)}</p>
            </div>
            <StateBadge value={p.status} />
          </div>
          <div className="rounded-2xl bg-turtle-50 p-4 text-center dark:bg-turtle-950/40">
            <p className="text-sm text-turtle-800 dark:text-turtle-200">{t('ops.payouts.col.net')}</p>
            <p className="font-display text-3xl font-bold text-turtle-900 dark:text-white"><Money cents={p.netCents} /></p>
            {p.paymentReference && <p className="mt-1 text-xs text-ink-500">{en('PayoutMethod', p.method)} · <span className="ltr">{p.paymentReference}</span></p>}
          </div>
          <Section title={t('ops.payouts.breakdown')} className="!p-4">
            {Object.entries(p.categories).filter(([, c]) => c.count || c.netCents).filter(([k]) => k !== 'payout').map(([k, c]) => (
              <InfoRow key={k} label={<span>{t(`ops.payouts.cat.${k}`)} <span className="text-xs text-ink-400">×{num(c.count)}</span></span>} value={<Money cents={c.netCents} tone="auto" sign />} />
            ))}
            <InfoRow label={t('ops.payouts.periodNet')} value={<Money cents={p.periodNetCents} />} strong />
            {p.carryOverCents !== 0 && <InfoRow label={t('ops.payouts.carryOver')} value={<Money cents={p.carryOverCents} sign />} />}
            <InfoRow label={t('ops.payouts.col.net')} value={<Money cents={p.netCents} className="font-bold" />} strong />
          </Section>
          {p.shifts.length > 0 && (
            <Section title={t('ops.payouts.shifts')} className="!p-4">
              <ul className="space-y-2">
                {p.shifts.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{dateOnly(s.startAt)} · <span className="ltr">{minutesLabel(s.workedMinutes)}</span></span>
                    <AttendanceFlags s={s} compact />
                    <Money cents={s.earnedCents} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {p.adjustments.length > 0 && (
            <Section title={t('ops.payouts.adjustments')} className="!p-4">
              {p.adjustments.map((a) => <InfoRow key={a.id} label={<span>{en('AdjustmentType', a.type)} <span className="text-xs text-ink-400">· {a.reason}</span></span>} value={<Money cents={a.signedAmountCents} sign tone="auto" />} />)}
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}

/* ───────────────────────────── Generate ───────────────────────────── */

function GeneratePayrollModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const heroes = useCourierOptions(open);
  const today = cairoToday();
  const [start, setStart] = useState(addDaysStr(today, -6));
  const [end, setEnd] = useState(today);
  const [salary, setSalary] = useState(false);
  const [some, setSome] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState<Record<string, string | undefined>>({});
  const [res, setRes] = useState<GenResult | null>(null);
  useEffect(() => {
    if (open) { setStart(addDaysStr(today, -6)); setEnd(today); setSalary(false); setSome(false); setSel([]); setErr({}); setRes(null); }
  }, [open, today]);
  const presets = useMemo(() => [
    { label: t('ops.opsb.thisWeek'), from: addDaysStr(today, -new Date(`${today}T12:00:00Z`).getUTCDay()), to: today },
    { label: t('ops.opsb.thisMonth'), from: monthStart(today), to: today },
    { label: t('common.last7'), from: addDaysStr(today, -6), to: today },
  ], [t, today]);
  const name = (id: string) => heroes.data?.find((h) => h.id === id)?.name ?? id;
  const m = useMutation({
    mutationFn: () => api<GenResult>('/finance/payouts/generate', { method: 'POST', body: { periodStart: start, periodEnd: end, includeSalary: salary, courierIds: some ? sel : undefined } }),
    onSuccess: (r) => { setRes(r); toast.success(t('ops.payouts.genDone', { n: num(r.created.length), amount: money(r.totalNetCents) })); qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['heroes'] }); },
    onError: (e) => { setErr(apiFieldErrors(e, ['periodStart', 'periodEnd'], { INVALID_RANGE: 'periodEnd', PERIOD_IN_FUTURE: 'periodEnd' })); toast.error(errorMessage(e)); },
  });
  const submit = () => {
    const e: Record<string, string | undefined> = {};
    if (!start || !end || end < start) e.periodEnd = t('ops.shifts.g.rangeInvalid');
    if (some && !sel.length) e.heroes = t('ops.shifts.g.heroesRequired');
    setErr(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };
  if (res) {
    return (
      <Modal open={open} onClose={onClose} title={t('ops.payouts.genTitle')} footer={<Button onClick={onClose}>{t('action.close')}</Button>}>
        <div className="space-y-3">
          <Notice tone="success">{t('ops.payouts.genDone', { n: num(res.created.length), amount: money(res.totalNetCents) })}</Notice>
          {res.created.length > 0 && (
            <ul className="max-h-56 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-100 text-sm dark:divide-ink-800 dark:border-ink-800">
              {res.created.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2"><span><Code>{p.code}</Code> · {p.courier.name}</span><Money cents={p.netCents} className="font-semibold" /></li>)}
            </ul>
          )}
          {res.skipped.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-500">{t('ops.payouts.genSkipped', { n: num(res.skipped.length) })}</summary>
              <ul className="mt-2 space-y-1">{res.skipped.map((s) => <li key={s.courierId} className="flex justify-between gap-2 text-xs"><span>{name(s.courierId)}</span><Badge tone="neutral">{t(`ops.payouts.skip.${s.reason}`)}</Badge></li>)}</ul>
            </details>
          )}
        </div>
      </Modal>
    );
  }
  return (
    <Modal open={open} onClose={onClose} title={t('ops.payouts.genTitle')} description={t('ops.payouts.genDesc')} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={submit}>{t('ops.payouts.generate')}</Button></>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">{presets.map((p) => <Button key={p.label} size="xs" variant={p.from === start && p.to === end ? 'secondary' : 'outline'} onClick={() => { setStart(p.from); setEnd(p.to); }}>{p.label}</Button>)}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ops.payouts.genStart')} required>{(id) => <Input id={id} type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label={t('ops.payouts.genEnd')} required error={err.periodEnd}>{(id) => <Input id={id} type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        <Checkbox label={t('ops.payouts.genSalary')} checked={salary} onChange={(e) => setSalary(e.target.checked)} />
        <div className="space-y-2">
          <div role="radiogroup" aria-label={t('ops.payouts.genHeroes')} className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2"><input type="radio" checked={!some} onChange={() => setSome(false)} className="text-turtle-600" />{t('ops.payouts.genAllHeroes')}</label>
            <label className="inline-flex items-center gap-2"><input type="radio" checked={some} onChange={() => setSome(true)} className="text-turtle-600" />{t('ops.payouts.genSome')}</label>
          </div>
          {some && (
            <ul className="grid max-h-52 gap-1 overflow-y-auto rounded-xl border border-ink-100 p-2 dark:border-ink-800 sm:grid-cols-2">
              {(heroes.data ?? []).filter((h) => h.status !== 'OFFBOARDED').map((h) => (
                <li key={h.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50 dark:hover:bg-ink-800">
                    <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-turtle-600" checked={sel.includes(h.id)} onChange={() => setSel(sel.includes(h.id) ? sel.filter((x) => x !== h.id) : [...sel, h.id])} />
                    <span className="min-w-0 flex-1 truncate">{h.name}</span><span className="ltr text-xs text-ink-400">{h.code}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {err.heroes && <p className="text-xs font-medium text-red-600">{err.heroes}</p>}
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Adjustments ───────────────────────────── */

function AdjustmentsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const [f, setF] = useQueryState({ tab: 'adjustments', type: '', courierId: '', unpaid: '', from: '', to: '', page: '1' });
  const [rev, setRev] = useState<AdjustmentRow | null>(null);
  const q = useQuery({
    queryKey: ['finance', 'adjustments', f],
    queryFn: () => api<Paginated<AdjustmentRow>>('/finance/adjustments', { query: { type: f.type, courierId: f.courierId, unpaid: f.unpaid ? 'true' : undefined, from: f.from, to: f.to, page: f.page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  const reverse = useMutation({
    mutationFn: ({ a, reason }: { a: AdjustmentRow; reason: string }) => api(`/finance/adjustments/${a.id}/reverse`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success(t('ops.opsb.adj.done')); setRev(null); qc.invalidateQueries({ queryKey: ['finance'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const action = (a: AdjustmentRow) => (can('finance.manage') && !a.isReversal && !a.payoutId ? <Button size="xs" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setRev(a); }}>{t('ops.payouts.adj.reverse')}</Button> : null);
  const columns: Column<AdjustmentRow>[] = [
    { key: 'date', header: t('common.date'), cell: (a) => <span className="whitespace-nowrap text-sm">{dateTime(a.createdAt)}</span> },
    { key: 'hero', header: t('common.hero'), cell: (a) => <Link to={`/ops/heroes/${a.courierId}?tab=pay`} className="font-medium hover:underline">{a.courier.name} <span className="text-xs text-ink-400"><Code>{a.courier.code}</Code></span></Link> },
    { key: 'type', header: t('ops.opsb.type'), cell: (a) => <Badge tone={a.signedAmountCents >= 0 ? 'success' : 'danger'}>{en('AdjustmentType', a.type)}</Badge> },
    { key: 'reason', header: t('ops.opsb.reason'), cell: (a) => <span className="line-clamp-2 max-w-xs text-sm">{a.isReversal && <Badge tone="neutral" className="me-1">{t('ops.payouts.adj.reversal')}</Badge>}{a.reason}</span>, hideBelow: 'lg' },
    { key: 'paid', header: t('common.status'), cell: (a) => (a.payoutId ? <Badge tone="neutral">{t('ops.payouts.adj.inPayout')}</Badge> : <Badge tone="warning">{t('ops.payouts.adj.unpaid')}</Badge>), hideBelow: 'md' },
    { key: 'amount', header: t('common.amount'), align: 'end', cell: (a) => <Money cents={a.signedAmountCents} sign tone="auto" className="font-semibold" /> },
    { key: 'act', header: '', align: 'end', cell: action },
  ];
  return (
    <>
      <FilterBar activeCount={[f.type, f.courierId, f.unpaid, f.from, f.to].filter(Boolean).length} onClear={() => setF({ type: '', courierId: '', unpaid: '', from: '', to: '' })}>
        <FilterField label={t('ops.opsb.type')}><Select value={f.type} onChange={(e) => setF({ type: e.target.value })} placeholder={t('ops.opsb.allTypes')} options={enumOptions('AdjustmentType', Object.values(AdjustmentType))} aria-label={t('ops.opsb.type')} /></FilterField>
        <FilterField label={t('common.hero')}><CourierSelect value={f.courierId} onChange={(v) => setF({ courierId: v })} placeholder={t('ops.opsb.allHeroes')} /></FilterField>
        <FilterField label={t('common.from')}><Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} aria-label={t('common.from')} className="md:!w-40" /></FilterField>
        <FilterField label={t('common.to')}><Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} aria-label={t('common.to')} className="md:!w-40" /></FilterField>
        <Checkbox label={t('ops.payouts.adj.unpaid')} checked={!!f.unpaid} onChange={(e) => setF({ unpaid: e.target.checked ? '1' : '' })} />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(a) => a.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={t('ops.payouts.adj.empty')}
        mobileCard={(a) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2"><Badge tone={a.signedAmountCents >= 0 ? 'success' : 'danger'}>{en('AdjustmentType', a.type)}</Badge><Money cents={a.signedAmountCents} sign tone="auto" className="font-semibold" /></div>
            <p className="font-medium">{a.courier.name}</p>
            <p className="text-sm text-ink-600 dark:text-ink-300">{a.reason}</p>
            <div className="flex items-center justify-between text-xs text-ink-400"><span>{dateTime(a.createdAt)}</span>{action(a)}</div>
          </div>
        )}
        footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <ReasonDialog open={!!rev} onClose={() => setRev(null)} title={t('ops.payouts.adj.reverseTitle')} description={rev ? <span>{rev.courier.name} · {en('AdjustmentType', rev.type)} · <Money cents={rev.signedAmountCents} sign /></span> : undefined} danger loading={reverse.isPending} confirmLabel={t('ops.payouts.adj.reverse')} onConfirm={(reason) => rev && reverse.mutate({ a: rev, reason })} />
    </>
  );
}
