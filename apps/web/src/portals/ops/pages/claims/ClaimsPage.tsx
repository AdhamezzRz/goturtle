import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileWarning } from 'lucide-react';
import { ClaimType, type ClaimStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { dateOnly, num } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { DataTable, EmptyState, Input, PageHeader, Pagination, Select, Tabs, type Column } from '@/components/ui';
import { FilterBar, FilterField, RequirePermission, Stat, StatGrid, useBrandOptions } from '@/portals/ops/components/opsb';
import { Amount, Ltr, MoneyState } from '@/features/money/ui';
import type { Claim, ClaimList } from '@/features/money/types';
import '@/features/money/i18n';

const STATUSES: Array<ClaimStatus | 'ALL'> = ['ALL', 'OPEN', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'REJECTED'];

export default function ClaimsPage() {
  return (
    <RequirePermission permission="orders.read">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  const nav = useNavigate();
  const brands = useBrandOptions();
  const [f, setF] = useQueryState({ status: 'ALL', type: '', brandId: '', q: '', page: '1' });
  const q = useQuery({
    queryKey: ['claims', 'ops', f],
    queryFn: () => api<ClaimList>('/claims', { query: { status: f.status === 'ALL' ? undefined : f.status, type: f.type, brandId: f.brandId, q: f.q, page: f.page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  const counts = q.data?.counts ?? {};
  const columns: Column<Claim>[] = [
    { key: 'code', header: t('money.col.code'), cell: (c) => <div><Ltr className="font-mono text-xs font-semibold">{c.code}</Ltr><p className="text-xs text-ink-500">{dateOnly(c.createdAt)}</p></div> },
    { key: 'brand', header: t('common.brand'), cell: (c) => <span className="font-medium">{c.brand?.name}</span> },
    { key: 'order', header: t('money.col.order'), hideBelow: 'md', cell: (c) => <Ltr className="font-mono text-sm">{c.order?.trackingNumber}</Ltr> },
    { key: 'type', header: t('money.col.type'), hideBelow: 'lg', cell: (c) => t(`money.claimType.${c.type}`) },
    { key: 'claimed', header: t('money.claims.claimed'), align: 'end', hideBelow: 'md', cell: (c) => <Amount cents={c.claimedCents} /> },
    { key: 'cap', header: t('money.claims.cap'), align: 'end', hideBelow: 'xl', cell: (c) => <Amount cents={c.liabilityCapCents} className="text-ink-500" /> },
    { key: 'approved', header: t('money.claims.approvedCol'), align: 'end', cell: (c) => (c.approvedCents ? <Amount cents={c.approvedCents} className="font-semibold" /> : <span className="text-ink-300">—</span>) },
    { key: 'status', header: t('common.status'), cell: (c) => <MoneyState value={c.status} /> },
  ];
  return (
    <div>
      <PageHeader title={t('money.claims.title')} subtitle={t('money.claims.opsSubtitle')} />
      <StatGrid cols={4} className="mb-5">
        <Stat label={t('state.OPEN')} value={num(counts.OPEN?.n ?? 0)} tone="sand" loading={q.isLoading} onClick={() => setF({ status: 'OPEN' })} />
        <Stat label={t('state.UNDER_REVIEW')} value={num(counts.UNDER_REVIEW?.n ?? 0)} tone="sky" loading={q.isLoading} onClick={() => setF({ status: 'UNDER_REVIEW' })} />
        <Stat label={t('money.claims.toPay')} value={<Amount cents={counts.APPROVED?.approvedCents ?? 0} />} hint={t('money.claims.nClaims', { n: num(counts.APPROVED?.n ?? 0) })} tone="violet" loading={q.isLoading} onClick={() => setF({ status: 'APPROVED' })} />
        <Stat label={t('money.claims.kPaid')} value={<Amount cents={counts.PAID?.approvedCents ?? 0} />} hint={t('money.claims.nClaims', { n: num(counts.PAID?.n ?? 0) })} loading={q.isLoading} onClick={() => setF({ status: 'PAID' })} />
      </StatGrid>
      <Tabs className="mb-4" value={f.status} onChange={(v) => setF({ status: v })} tabs={STATUSES.map((s) => ({ value: s, label: s === 'ALL' ? t('common.all') : t(`state.${s}`), count: s === 'ALL' ? undefined : counts[s]?.n }))} />
      <FilterBar activeCount={[f.type, f.brandId, f.q].filter(Boolean).length} onClear={() => setF({ type: '', brandId: '', q: '' })}>
        <FilterField label={t('action.search')}><Input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder={t('money.claims.searchPh')} aria-label={t('action.search')} className="md:!w-56" /></FilterField>
        <FilterField label={t('money.col.type')}>
          <Select value={f.type} onChange={(e) => setF({ type: e.target.value })} placeholder={t('common.all')} options={Object.values(ClaimType).map((v) => ({ value: v, label: t(`money.claimType.${v}`) }))} aria-label={t('money.col.type')} />
        </FilterField>
        <FilterField label={t('common.brand')}>
          <Select value={f.brandId} onChange={(e) => setF({ brandId: e.target.value })} placeholder={t('ops.opsb.allBrands')} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} aria-label={t('common.brand')} />
        </FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(c) => c.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        onRowClick={(c) => nav(`/ops/claims/${c.id}`)}
        empty={<EmptyState icon={<FileWarning className="h-7 w-7" />} title={t('money.claims.emptyOps')} />}
        mobileCard={(c) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><Ltr className="font-mono text-xs font-semibold">{c.code}</Ltr><MoneyState value={c.status} /></div>
            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{c.brand?.name}</span><Amount cents={c.approvedCents || c.claimedCents} className="font-semibold" /></div>
            <p className="text-xs text-ink-500">{t(`money.claimType.${c.type}`)} · <Ltr className="font-mono">{c.order?.trackingNumber}</Ltr></p>
          </div>
        )}
        footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
    </div>
  );
}
