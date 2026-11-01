import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Banknote, CheckCircle2, HandCoins, Landmark, TrendingUp, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { AdvanceType, PayoutMethod, type AdvanceStatus } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateOnly, dateTime, num } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, CardHeader, DataTable, DescriptionList, Drawer, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, type Column } from '@/components/ui';
import { FilterBar, FilterField, ReasonDialog, RequirePermission, Stat, StatGrid, useBrandOptions } from '@/portals/ops/components/opsb';
import { Amount, Ltr, MoneyState } from '@/features/money/ui';
import type { Advance, AdvancesOverview } from '@/features/money/types';
import '@/features/money/i18n';
import './i18n';

const STATUSES: Array<AdvanceStatus | 'ALL'> = ['REQUESTED', 'APPROVED', 'PAID', 'RECOVERED', 'REJECTED', 'CANCELLED', 'ALL'];

export default function AdvancesPage() {
  return (
    <RequirePermission permission="finance.read">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  const brands = useBrandOptions();
  const [f, setF] = useQueryState({ status: 'REQUESTED', type: '', brandId: '', page: '1', id: '' });
  const q = useQuery({
    queryKey: ['finance', 'advances', f],
    queryFn: () => api<Paginated<Advance>>('/finance/advances', { query: { status: f.status === 'ALL' ? undefined : f.status, type: f.type, brandId: f.brandId, page: f.page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  const ov = useQuery({ queryKey: ['finance', 'advances', 'overview'], queryFn: () => api<AdvancesOverview>('/finance/advances/overview') });
  const queueOf = (s: AdvanceStatus) => (ov.data?.queue ?? []).filter((x) => x.status === s).reduce((a, x) => ({ n: a.n + x.n, cents: a.cents + x.cents }), { n: 0, cents: 0 });
  const detail = useQuery({ queryKey: ['finance', 'advances', 'detail', f.id], queryFn: () => api<Advance>(`/finance/advances/${f.id}`), enabled: !!f.id });
  const selected = f.id ? detail.data ?? q.data?.data.find((a) => a.id === f.id) ?? null : null;
  const columns: Column<Advance>[] = [
    { key: 'code', header: t('money.col.code'), cell: (a) => <div><Ltr className="font-mono text-xs font-semibold">{a.code}</Ltr><p className="text-xs text-ink-500">{dateOnly(a.createdAt)}</p></div> },
    { key: 'brand', header: t('common.brand'), cell: (a) => <span className="font-medium">{a.brand?.name}</span> },
    { key: 'type', header: t('money.col.type'), hideBelow: 'md', cell: (a) => t(`money.advType.${a.type}`) },
    { key: 'amount', header: t('money.adv.amount'), align: 'end', cell: (a) => <Amount cents={a.amountCents} className="font-semibold" /> },
    { key: 'fee', header: t('money.adv.fee'), align: 'end', hideBelow: 'lg', cell: (a) => <Amount cents={a.feeCents} className="text-ink-500" /> },
    { key: 'out', header: t('money.adv.outstanding'), align: 'end', hideBelow: 'xl', cell: (a) => (a.outstandingCents ? <Amount cents={a.outstandingCents} /> : <span className="text-ink-300">—</span>) },
    { key: 'status', header: t('common.status'), cell: (a) => <MoneyState value={a.status} /> },
  ];
  return (
    <div>
      <PageHeader title={t('money.opsAdv.title')} subtitle={t('money.opsAdv.subtitle')} />
      <StatGrid cols={4} className="mb-5">
        <Stat icon={<HandCoins />} tone="sand" label={t('money.opsAdv.toApprove')} value={num(queueOf('REQUESTED').n)} hint={<Amount cents={queueOf('REQUESTED').cents} />} loading={ov.isLoading} onClick={() => setF({ status: 'REQUESTED' })} active={f.status === 'REQUESTED'} />
        <Stat icon={<Banknote />} tone="violet" label={t('money.opsAdv.toPay')} value={num(queueOf('APPROVED').n)} hint={<Amount cents={queueOf('APPROVED').cents} />} loading={ov.isLoading} onClick={() => setF({ status: 'APPROVED' })} active={f.status === 'APPROVED'} />
        <Stat icon={<Landmark />} tone="sky" label={t('money.opsAdv.outstanding')} value={<Amount cents={ov.data?.outstandingTotalCents} />} hint={t('money.opsAdv.brandsN', { n: num(ov.data?.outstandingByBrand.length ?? 0) })} loading={ov.isLoading} />
        <Stat icon={<TrendingUp />} label={t('money.opsAdv.revenue')} value={<Amount cents={ov.data?.feeRevenueMonthCents} />} hint={<>{t('money.opsAdv.revenueTotal')} <Amount cents={ov.data?.feeRevenueCents} /></>} loading={ov.isLoading} />
      </StatGrid>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Tabs className="mb-4" value={f.status} onChange={(v) => setF({ status: v })} tabs={STATUSES.map((s) => ({ value: s, label: s === 'ALL' ? t('common.all') : t(`state.${s}`) }))} />
          <FilterBar activeCount={[f.type, f.brandId].filter(Boolean).length} onClear={() => setF({ type: '', brandId: '' })}>
            <FilterField label={t('money.col.type')}>
              <Select value={f.type} onChange={(e) => setF({ type: e.target.value })} placeholder={t('common.all')} options={Object.values(AdvanceType).map((v) => ({ value: v, label: t(`money.advType.${v}`) }))} aria-label={t('money.col.type')} />
            </FilterField>
            <FilterField label={t('common.brand')}>
              <Select value={f.brandId} onChange={(e) => setF({ brandId: e.target.value })} placeholder={t('ops.opsb.allBrands')} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} aria-label={t('common.brand')} />
            </FilterField>
          </FilterBar>
          <DataTable
            columns={columns}
            rows={q.data?.data}
            rowKey={(a) => a.id}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            onRowClick={(a) => setF({ id: a.id })}
            empty={<EmptyState icon={<HandCoins className="h-7 w-7" />} title={t('money.opsAdv.empty')} />}
            mobileCard={(a) => (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2"><Ltr className="font-mono text-xs font-semibold">{a.code}</Ltr><MoneyState value={a.status} /></div>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{a.brand?.name}</span><Amount cents={a.amountCents} className="font-semibold" /></div>
                <p className="text-xs text-ink-500">{t(`money.advType.${a.type}`)} · {t('money.adv.fee')} <Amount cents={a.feeCents} /></p>
              </div>
            )}
            footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
          />
        </div>
        <Card padded={false} className="h-fit">
          <div className="px-5 pt-5"><CardHeader title={t('money.opsAdv.byBrand')} subtitle={t('money.opsAdv.byBrandHint')} /></div>
          {(ov.data?.outstandingByBrand ?? []).length === 0 ? (
            <EmptyState title={t('money.opsAdv.noneOutstanding')} className="py-8" />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {ov.data!.outstandingByBrand.map((b) => (
                <li key={b.brand.id}>
                  <button type="button" onClick={() => setF({ brandId: b.brand.id, status: 'PAID', type: 'COD_ADVANCE' })} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-start hover:bg-ink-50 dark:hover:bg-ink-800/50">
                    <span className="min-w-0"><span className="block truncate font-medium text-ink-900 dark:text-white">{b.brand.name}</span><span className="text-xs text-ink-500">{t('money.opsAdv.advancesN', { n: num(b.advances) })}</span></span>
                    <Amount cents={b.outstandingCents} className="font-semibold" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <AdvanceDrawer advance={selected} onClose={() => setF({ id: '' })} />
    </div>
  );
}

function AdvanceDrawer({ advance: a, onClose }: { advance: Advance | null; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'reject' | 'cancel' | 'pay' | null>(null);
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<Advance>(`/finance/advances/${a!.id}/${path}`, { method: 'POST', body: body ?? {} }),
    onSuccess: (r) => { toast.success(t(`state.${r.status}`)); setDialog(null); void qc.invalidateQueries({ queryKey: ['finance', 'advances'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const manage = can('finance.manage');
  const details = a?.brand?.payoutDetails ?? null;
  return (
    <Drawer
      open={!!a}
      onClose={onClose}
      title={a ? <span className="flex items-center gap-2"><Ltr className="font-mono">{a.code}</Ltr><MoneyState value={a.status} /></span> : ''}
      footer={
        a && manage && (a.status === 'REQUESTED' || a.status === 'APPROVED') ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setDialog('cancel')}>{t('action.cancel')}</Button>
            <Button variant="outline" className="text-red-600" icon={<XCircle className="h-4 w-4" />} onClick={() => setDialog('reject')}>{t('money.opsAdv.reject')}</Button>
            {a.status === 'REQUESTED' && <Button icon={<CheckCircle2 className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ path: 'approve' })}>{t('money.opsAdv.approve')}</Button>}
            {a.status === 'APPROVED' && <Button icon={<Banknote className="h-4 w-4" />} onClick={() => setDialog('pay')}>{t('money.opsAdv.pay')}</Button>}
          </div>
        ) : null
      }
    >
      {a && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-ink-50 p-4 text-center dark:bg-ink-800/60">
            <p className="text-xs font-semibold text-ink-500">{t(`money.advType.${a.type}`)}</p>
            <p className="font-display text-3xl font-bold text-ink-900 dark:text-white"><Amount cents={a.amountCents} /></p>
            <p className="text-xs text-ink-500">{t('money.adv.fee')} <Amount cents={a.feeCents} /> · {a.type === 'EARLY_PAYOUT' ? t('money.opsAdv.walletDebited') : t('money.opsAdv.recoveredAtSettlement')} <Amount cents={a.type === 'EARLY_PAYOUT' ? a.totalCents : a.amountCents} /></p>
          </div>
          <DescriptionList
            items={[
              { label: t('common.brand'), value: a.brand?.name ?? '—' },
              { label: t('money.opsAdv.requestedBy'), value: a.requestedBy ?? '—' },
              { label: t('money.opsAdv.requestedAt'), value: dateTime(a.createdAt) },
              ...(a.approvedAt ? [{ label: t('money.opsAdv.approvedBy'), value: `${a.approvedBy ?? '—'} · ${dateTime(a.approvedAt)}` }] : []),
              ...(a.paidAt ? [{ label: t('money.opsAdv.paidAt'), value: `${dateTime(a.paidAt)} · ${a.method ? t(`money.payout.${a.method}`) : ''}` }] : []),
              ...(a.paymentReference ? [{ label: t('money.opsAdv.reference'), value: <Ltr className="font-mono">{a.paymentReference}</Ltr> }] : []),
              ...(a.type === 'COD_ADVANCE' && (a.status === 'PAID' || a.status === 'RECOVERED') ? [{ label: t('money.adv.recoveredCol'), value: <span><Amount cents={a.recoveredCents} /> / <Amount cents={a.amountCents} /></span> }] : []),
              { label: t('money.opsAdv.payoutTo'), value: a.brand ? <span>{t(`money.payout.${a.brand.payoutMethod}`)}{details ? <span className="block text-xs text-ink-500 ltr">{Object.values(details).filter(Boolean).join(' · ')}</span> : null}</span> : '—', full: true },
              ...(a.notes ? [{ label: t('common.notes'), value: <p className="whitespace-pre-line">{a.notes}</p>, full: true }] : []),
            ]}
          />
        </div>
      )}
      <ReasonDialog open={dialog === 'reject'} onClose={() => setDialog(null)} title={t('money.opsAdv.reject')} danger loading={act.isPending} confirmLabel={t('money.opsAdv.reject')} onConfirm={(note) => act.mutate({ path: 'reject', body: { note } })} />
      <ReasonDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title={t('money.opsAdv.cancelTitle')} loading={act.isPending} onConfirm={(note) => act.mutate({ path: 'cancel', body: { note } })} />
      {a && dialog === 'pay' && <PayModal advance={a} loading={act.isPending} onClose={() => setDialog(null)} onPay={(body) => act.mutate({ path: 'pay', body })} />}
    </Drawer>
  );
}

function PayModal({ advance, loading, onClose, onPay }: { advance: Advance; loading: boolean; onClose: () => void; onPay: (b: { method: string; reference: string }) => void }) {
  const { t } = useI18n();
  const [method, setMethod] = useState(advance.brand?.payoutMethod ?? 'BANK_TRANSFER');
  const [reference, setReference] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t('money.opsAdv.payTitle', { code: advance.code })}
      description={t('money.opsAdv.payHint')}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={loading} disabled={reference.trim().length < 2} onClick={() => onPay({ method, reference: reference.trim() })}>{t('money.opsAdv.pay')}</Button></>}
    >
      <div className="space-y-4">
        <p className="text-center font-display text-3xl font-bold text-ink-900 dark:text-white"><Amount cents={advance.amountCents} /></p>
        <Field label={t('money.opsAdv.method')}>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)} options={Object.values(PayoutMethod).map((m) => ({ value: m, label: t(`money.payout.${m}`) }))} />}</Field>
        <Field label={t('money.opsAdv.reference')} required>{(id) => <Input id={id} className="ltr font-mono" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />}</Field>
      </div>
    </Modal>
  );
}
