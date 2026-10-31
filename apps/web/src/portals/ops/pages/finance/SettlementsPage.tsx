import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateOnly, money, num } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StateBadge, Tabs, type Column } from '@/components/ui';
import { Code, FilterBar, FilterField, Money, Notice, RequirePermission, useBrandOptions, useEnumLabel } from '@/portals/ops/components/opsb';
import './i18n';
import '../cash/i18n';

export type SettlementRow = {
  id: string;
  code: string;
  brandId: string;
  periodStart: string;
  periodEnd: string;
  ordersCount: number;
  codCollectedCents: number;
  feesCents: number;
  vatCents: number;
  adjustmentsCents: number;
  netPayableCents: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
  method: string | null;
  paymentReference: string | null;
  invoiceNumber: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  brand: { id: string; code: string; name: string; settlementCycle: string; payoutMethod: string };
};
type SettlementList = Paginated<SettlementRow> & { totals: { netPayableCents: number; codCollectedCents: number; feesCents: number } };

export default function SettlementsPage() {
  return (
    <RequirePermission permission="finance.read">
      <SettlementsInner />
    </RequirePermission>
  );
}

function SettlementsInner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const nav = useNavigate();
  const brands = useBrandOptions();
  const [f, setF] = useQueryState({ status: '', brandId: '', from: '', to: '', page: '1' });
  const [gen, setGen] = useState(false);
  const q = useQuery({
    queryKey: ['finance', 'settlements', f],
    queryFn: () => api<SettlementList>('/finance/settlements', { query: { status: f.status, brandId: f.brandId, from: f.from, to: f.to, page: f.page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const columns: Column<SettlementRow>[] = [
    { key: 'code', header: t('ops.settlements.col.code'), cell: (s) => <div><Code>{s.code}</Code>{s.invoiceNumber && <p className="ltr text-start text-[11px] text-ink-400">{s.invoiceNumber}</p>}</div> },
    { key: 'brand', header: t('common.brand'), cell: (s) => <div className="min-w-[120px]"><p className="font-medium text-ink-900 dark:text-ink-50">{s.brand.name}</p><p className="text-xs text-ink-500">{en('SettlementCycle', s.brand.settlementCycle)}</p></div> },
    { key: 'period', header: t('ops.settlements.col.period'), cell: (s) => <span className="whitespace-nowrap text-sm">{dateOnly(s.periodStart)} – {dateOnly(s.periodEnd)}</span>, hideBelow: 'lg' },
    { key: 'orders', header: t('ops.settlements.col.orders'), align: 'center', cell: (s) => <span className="ltr tabular">{num(s.ordersCount)}</span>, hideBelow: 'md' },
    { key: 'cod', header: t('ops.settlements.col.cod'), align: 'end', cell: (s) => <Money cents={s.codCollectedCents} />, hideBelow: 'xl' },
    { key: 'fees', header: t('ops.settlements.col.fees'), align: 'end', cell: (s) => <Money cents={-(s.feesCents)} className="text-ink-500" />, hideBelow: 'xl' },
    { key: 'net', header: t('ops.settlements.col.net'), align: 'end', cell: (s) => <Money cents={s.netPayableCents} className="font-semibold" /> },
    { key: 'status', header: t('common.status'), cell: (s) => <StateBadge value={s.status} /> },
  ];
  const tot = q.data?.totals;
  return (
    <div>
      <PageHeader
        title={t('ops.settlements.title')}
        subtitle={t('ops.settlements.subtitle')}
        actions={can('settlements.manage') && <Button icon={<Wand2 className="h-4 w-4" />} onClick={() => setGen(true)}>{t('ops.settlements.generate')}</Button>}
      />
      <Tabs
        className="mb-4"
        value={f.status || 'ALL'}
        onChange={(v) => setF({ status: v === 'ALL' ? '' : v })}
        tabs={['ALL', 'DRAFT', 'APPROVED', 'PAID', 'CANCELLED'].map((v) => ({ value: v, label: v === 'ALL' ? t('common.all') : t(`state.${v}`) }))}
      />
      <FilterBar activeCount={[f.brandId, f.from, f.to].filter(Boolean).length} onClear={() => setF({ brandId: '', from: '', to: '' })}>
        <FilterField label={t('common.brand')}>
          <Select value={f.brandId} onChange={(e) => setF({ brandId: e.target.value })} placeholder={t('ops.opsb.allBrands')} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} aria-label={t('common.brand')} />
        </FilterField>
        <FilterField label={t('common.from')}><Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} aria-label={t('common.from')} className="md:!w-40" /></FilterField>
        <FilterField label={t('common.to')}><Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} aria-label={t('common.to')} className="md:!w-40" /></FilterField>
      </FilterBar>
      {tot && (q.data?.meta.total ?? 0) > 0 && (
        <p className="mb-3 text-sm text-ink-500">{t('ops.settlements.totals', { cod: money(tot.codCollectedCents), fees: money(tot.feesCents), net: money(tot.netPayableCents) })}</p>
      )}
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(s) => s.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        onRowClick={(s) => nav(`/ops/finance/settlements/${s.id}`)}
        empty={<EmptyState icon={<Receipt className="h-7 w-7" />} title={t('ops.settlements.empty')} />}
        mobileCard={(s) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><Code>{s.code}</Code><StateBadge value={s.status} /></div>
            <div className="flex items-center justify-between gap-2"><p className="font-semibold">{s.brand.name}</p><Money cents={s.netPayableCents} className="font-semibold" /></div>
            <p className="text-xs text-ink-500">{dateOnly(s.periodStart)} – {dateOnly(s.periodEnd)} · {t('ops.cash.ordersN', { n: num(s.ordersCount) })}</p>
          </div>
        )}
        footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <GenerateSettlementsModal open={gen} onClose={() => setGen(false)} />
    </div>
  );
}

function GenerateSettlementsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const brands = useBrandOptions(open);
  const [brandId, setBrandId] = useState('');
  const [end, setEnd] = useState('');
  const [result, setResult] = useState<{ created: SettlementRow[]; skipped: Array<{ brandId: string; code: string; reason: string }> } | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ created: SettlementRow[]; skipped: Array<{ brandId: string; code: string; reason: string }> }>('/finance/settlements/generate', { method: 'POST', body: { brandId: brandId || undefined, periodEnd: end ? new Date(end).toISOString() : undefined } }),
    onSuccess: (r) => { setResult(r); toast.success(t('ops.settlements.genDone', { n: num(r.created.length) })); qc.invalidateQueries({ queryKey: ['finance'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = () => { setResult(null); setBrandId(''); setEnd(''); onClose(); };
  return (
    <Modal
      open={open}
      onClose={close}
      title={t('ops.settlements.genTitle')}
      description={result ? undefined : t('ops.settlements.genDesc')}
      footer={result ? <Button onClick={close}>{t('action.close')}</Button> : <><Button variant="outline" onClick={close}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => m.mutate()}>{t('ops.settlements.generate')}</Button></>}
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone={result.created.length ? 'success' : 'info'}>{t('ops.settlements.genDone', { n: num(result.created.length) })}</Notice>
          {result.created.length > 0 && (
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 text-sm dark:divide-ink-800 dark:border-ink-800">
              {result.created.map((s) => <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2"><span><Code>{s.code}</Code> · {s.brand.name}</span><Money cents={s.netPayableCents} className="font-semibold" /></li>)}
            </ul>
          )}
          {result.skipped.length > 0 && <p className="text-xs text-ink-500">{t('ops.settlements.genSkipped', { n: num(result.skipped.length) })}: <span className="ltr">{result.skipped.map((s) => s.code).join(', ')}</span></p>}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('ops.settlements.genBrand')}>{(id) => <Select id={id} value={brandId} onChange={(e) => setBrandId(e.target.value)} placeholder={t('ops.settlements.genAllBrands')} options={(brands.data ?? []).filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />}</Field>
          <Field label={t('ops.settlements.genPeriodEnd')} hint={t('ops.settlements.genPeriodHint')}>{(id) => <Input id={id} type="datetime-local" value={end} max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
      )}
    </Modal>
  );
}
