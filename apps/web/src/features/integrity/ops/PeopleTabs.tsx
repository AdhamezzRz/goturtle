import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownUp, Ban, ShieldCheck, UserX } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, num, pct, phone } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, Field, Pagination, Switch, Textarea } from '@/components/ui';
import { SearchInput, Segmented } from '@/portals/ops/components/opsa/ui';
import { ScoreBar } from '../shared';
import type { HeroIntegrityRow, NetworkCustomer, NetworkRiskRow } from '../types';

// ---------------------------------------------------------------------------
//  Hero integrity
// ---------------------------------------------------------------------------

type SortKey = 'integrityScore' | 'failedAttempts' | 'failureRate' | 'avgDistanceAtFailureMeters' | 'callsPerFailure' | 'disputes' | 'upheld';

export function HeroesTab() {
  const { t } = useI18n();
  const [s, setS] = useQueryState({ days: '30', sort: 'integrityScore', dir: 'asc' });
  const q = useQuery({
    queryKey: ['integrity', 'heroes', s.days],
    queryFn: () => api<{ days: number; geofenceMeters: number; data: HeroIntegrityRow[] }>('/integrity/heroes', { query: { days: s.days } }),
  });
  const sortKey = s.sort as SortKey;
  const rows = useMemo(() => {
    const list = [...(q.data?.data ?? [])];
    const val = (r: HeroIntegrityRow) => (r[sortKey] ?? -1) as number;
    list.sort((a, b) => (s.dir === 'asc' ? val(a) - val(b) : val(b) - val(a)));
    return list;
  }, [q.data, sortKey, s.dir]);
  const head = (key: SortKey, label: string) => (
    <button type="button" onClick={() => setS({ sort: key, dir: s.sort === key && s.dir === 'asc' ? 'desc' : 'asc' })} className={cn('inline-flex items-center gap-1 font-semibold hover:text-ink-900 dark:hover:text-white', s.sort === key && 'text-turtle-700 dark:text-turtle-400')}>
      {label}<ArrowDownUp className="h-3 w-3" />
    </button>
  );
  return (
    <div className="space-y-4">
      <Segmented value={s.days} onChange={(v) => setS({ days: v })} options={['7', '30', '90'].map((d) => ({ value: d, label: t('integrity.heroes.days', { n: d }) }))} />
      <DataTable
        rows={rows}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => r.courier.id}
        empty={<EmptyState icon={<ShieldCheck className="h-6 w-6" />} title={t('integrity.heroes.empty')} />}
        columns={[
          { key: 'h', header: t('integrity.hero'), cell: (r) => <Link to={`/ops/heroes/${r.courier.id}`} className="block min-w-0 hover:underline"><span className="block truncate font-medium">{r.courier.name}</span><span className="ltr text-xs text-ink-500">{r.courier.code}</span></Link> },
          { key: 'score', header: head('integrityScore', t('integrity.heroes.score')), cell: (r) => <ScoreBar value={r.integrityScore} /> },
          { key: 'f', header: head('failedAttempts', t('integrity.heroes.failed')), align: 'end', cell: (r) => <span className="ltr tabular-nums">{num(r.failedAttempts)}</span> },
          { key: 'fr', header: head('failureRate', t('integrity.heroes.failRate')), align: 'end', hideBelow: 'lg', cell: (r) => <span className="ltr tabular-nums">{r.failureRate == null ? '—' : pct(r.failureRate)}</span> },
          { key: 'd', header: head('avgDistanceAtFailureMeters', t('integrity.heroes.avgDistance')), align: 'end', hideBelow: 'md', cell: (r) => <span className={cn('ltr tabular-nums', r.avgDistanceAtFailureMeters != null && q.data && r.avgDistanceAtFailureMeters > q.data.geofenceMeters && 'font-semibold text-red-600')}>{r.avgDistanceAtFailureMeters == null ? '—' : t('integrity.meters', { m: num(r.avgDistanceAtFailureMeters) })}</span> },
          { key: 'c', header: head('callsPerFailure', t('integrity.heroes.calls')), align: 'end', hideBelow: 'md', cell: (r) => <span className="ltr tabular-nums">{r.callsPerFailure ?? '—'}</span> },
          { key: 'ds', header: head('disputes', t('integrity.heroes.disputes')), align: 'end', hideBelow: 'lg', cell: (r) => <span className="ltr tabular-nums">{num(r.disputes)}</span> },
          { key: 'u', header: head('upheld', t('integrity.heroes.upheld')), align: 'end', cell: (r) => <span className={cn('ltr tabular-nums', r.upheld > 0 && 'font-semibold text-red-600')}>{num(r.upheld)}{r.upheldRate != null ? ` · ${pct(r.upheldRate)}` : ''}</span> },
        ]}
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="truncate font-medium">{r.courier.name}</p><p className="ltr text-xs text-ink-500">{r.courier.code}</p></div>
              <div className="w-32"><ScoreBar value={r.integrityScore} /></div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Cell label={t('integrity.heroes.failed')} value={num(r.failedAttempts)} />
              <Cell label={t('integrity.heroes.avgDistance')} value={r.avgDistanceAtFailureMeters == null ? '—' : t('integrity.meters', { m: num(r.avgDistanceAtFailureMeters) })} />
              <Cell label={t('integrity.heroes.upheld')} value={num(r.upheld)} danger={r.upheld > 0} />
            </div>
          </div>
        )}
      />
    </div>
  );
}

const Cell = ({ label, value, danger }: { label: string; value: string; danger?: boolean }) => (
  <div className="rounded-lg bg-ink-50 px-2 py-1.5 dark:bg-ink-800/60">
    <p className="truncate text-[11px] text-ink-500">{label}</p>
    <p className={cn('ltr font-semibold', danger && 'text-red-600')}>{value}</p>
  </div>
);

// ---------------------------------------------------------------------------
//  Network blocklist
// ---------------------------------------------------------------------------

export function NetworkTab() {
  const { t } = useI18n();
  const [s, setS] = useQueryState({ scope: 'network', q: '', page: '1' });
  const [target, setTarget] = useState<NetworkCustomer | null>(null);
  const q = useQuery({
    queryKey: ['integrity', 'network', s],
    queryFn: () => api<Paginated<NetworkRiskRow>>('/integrity/network-risk', { query: { scope: s.scope, q: s.q || undefined, page: s.page, pageSize: 20 } }),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented value={s.scope as 'network' | 'blocked'} onChange={(v) => setS({ scope: v })} options={(['network', 'blocked'] as const).map((v) => ({ value: v, label: t(`integrity.network.scope.${v}`) }))} />
        <SearchInput value={s.q} onChange={(v) => setS({ q: v })} placeholder={t('integrity.search')} className="lg:max-w-sm lg:flex-1" />
      </div>
      <DataTable
        rows={q.data?.data}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => r.customer.id}
        empty={<EmptyState icon={<UserX className="h-6 w-6" />} title={t('integrity.network.empty')} />}
        columns={[
          { key: 'c', header: t('integrity.col.recipient'), cell: (r) => <CustomerCell c={r.customer} /> },
          { key: 'b', header: t('integrity.col.reason'), cell: (r) => <RiskCell r={r} /> },
          { key: 'rel', header: t('integrity.reliability'), hideBelow: 'lg', align: 'end', cell: (r) => <span className="ltr tabular-nums">{r.customer.reliabilityScore}</span> },
          { key: 'a', header: <span className="sr-only">{t('integrity.col.actions')}</span>, align: 'end', cell: (r) => <RuleActions c={r.customer} onBlock={() => setTarget(r.customer)} /> },
        ]}
        mobileCard={(r) => (
          <div className="space-y-2">
            <CustomerCell c={r.customer} />
            <RiskCell r={r} />
            <RuleActions c={r.customer} onBlock={() => setTarget(r.customer)} />
          </div>
        )}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setS({ page: String(p) })} />}
      <BlockDialog customer={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function CustomerCell({ c }: { c: NetworkCustomer }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <Link to={`/ops/customers/${c.id}`} className="block truncate font-medium hover:underline">{c.name}</Link>
      <p className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
        <span className="ltr">{phone(c.phone)}</span>
        {c.isBlocked && <Badge tone="danger">{t('integrity.blocked')}</Badge>}
        {c.requirePrepayment && <Badge tone="cash">{t('integrity.prepayOnly')}</Badge>}
      </p>
    </div>
  );
}

function RiskCell({ r }: { r: NetworkRiskRow }) {
  const { t } = useI18n();
  if (r.refusalBrands == null) {
    return <p className="text-xs text-ink-500">{r.customer.blockedReason ?? '—'}{r.customer.blockedAt ? ` · ${ago(r.customer.blockedAt)}` : ''}</p>;
  }
  return (
    <div className="space-y-0.5">
      <Badge tone="danger">{t('integrity.network.brands', { n: r.refusalBrands })}</Badge>
      <p className="text-xs text-ink-500">{t('integrity.network.refusals', { r: r.refusals ?? 0, d: r.declines ?? 0 })}</p>
    </div>
  );
}

function RuleActions({ c, onBlock }: { c: NetworkCustomer; onBlock: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const prepay = useMutation({
    mutationFn: (required: boolean) => api(`/customers/${c.id}/prepayment`, { method: 'POST', body: { required } }),
    onSuccess: () => { toast.success(t('integrity.saved')); void qc.invalidateQueries({ queryKey: ['integrity'] }); void qc.invalidateQueries({ queryKey: ['customer', c.id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unblock = useMutation({
    mutationFn: () => api(`/customers/${c.id}/unblock`, { method: 'POST', body: {} }),
    onSuccess: () => { toast.success(t('integrity.saved')); void qc.invalidateQueries({ queryKey: ['integrity'] }); void qc.invalidateQueries({ queryKey: ['customer', c.id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can('orders.update')) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <Switch checked={c.requirePrepayment} disabled={prepay.isPending} onChange={(v) => prepay.mutate(v)} label={<span className="text-xs">{t('integrity.prepayOnly')}</span>} />
      {c.isBlocked
        ? <Button size="xs" variant="outline" icon={<ShieldCheck className="h-3.5 w-3.5" />} loading={unblock.isPending} onClick={() => unblock.mutate()}>{t('integrity.unblock')}</Button>
        : <Button size="xs" variant="danger" icon={<Ban className="h-3.5 w-3.5" />} onClick={onBlock}>{t('integrity.block')}</Button>}
    </div>
  );
}

/** Block with reason + optional network prepayment rule (shared with the customer page). */
export function BlockDialog({ customer, onClose }: { customer: Pick<NetworkCustomer, 'id' | 'name' | 'requirePrepayment'> | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [prepay, setPrepay] = useState(true);
  const m = useMutation({
    mutationFn: () => api(`/customers/${customer!.id}/block`, { method: 'POST', body: { reason: reason.trim() || undefined, requirePrepayment: prepay } }),
    onSuccess: () => {
      toast.success(t('integrity.saved'));
      void qc.invalidateQueries({ queryKey: ['integrity'] });
      void qc.invalidateQueries({ queryKey: ['customer', customer!.id] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
      onClose();
      setReason('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ConfirmDialog open={!!customer} onClose={onClose} onConfirm={() => m.mutate()} loading={m.isPending} danger title={customer ? t('integrity.blockTitle', { name: customer.name }) : ''} description={t('integrity.blockDesc')} confirmLabel={t('integrity.block')}>
      <div className="space-y-3">
        <Field label={t('integrity.reasonLabel')}>{(id) => <Textarea id={id} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60">
          <Switch checked={prepay} onChange={setPrepay} label={<span className="text-sm font-medium">{t('integrity.prepayToggle')}</span>} />
          <p className="mt-1 text-xs text-ink-500">{t('integrity.prepayHint')}</p>
        </div>
      </div>
    </ConfirmDialog>
  );
}
