import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FilePlus2, FileWarning } from 'lucide-react';
import type { ClaimStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateOnly, num } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Button, Card, DataTable, DescriptionList, Drawer, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs, type Column } from '@/components/ui';
import { Amount, Ltr, MoneyState } from '@/features/money/ui';
import { ClaimTimeline, EvidenceGallery, NewClaimModal } from '@/features/money/claims/parts';
import type { Claim, ClaimDetail, ClaimList } from '@/features/money/types';
import '@/features/money/i18n';

const STATUSES: Array<ClaimStatus | 'ALL'> = ['ALL', 'OPEN', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'REJECTED'];

export default function ClaimsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [f, setF] = useQueryState({ status: 'ALL', page: '1', id: '' });
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['claims', 'brand', f.status, f.page],
    queryFn: () => api<ClaimList>('/claims', { query: { status: f.status === 'ALL' ? undefined : f.status, page: f.page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const counts = q.data?.counts ?? {};
  const columns: Column<Claim>[] = [
    { key: 'code', header: t('money.col.code'), cell: (c) => <div><Ltr className="font-mono text-xs font-semibold">{c.code}</Ltr><p className="text-xs text-ink-500">{dateOnly(c.createdAt)}</p></div> },
    { key: 'order', header: t('money.col.order'), cell: (c) => (c.order ? <Link to={`/brand/orders/${c.order.id}`} onClick={(e) => e.stopPropagation()} className="ltr font-mono text-sm text-turtle-700 hover:underline dark:text-turtle-400">{c.order.trackingNumber}</Link> : '—') },
    { key: 'type', header: t('money.col.type'), hideBelow: 'md', cell: (c) => t(`money.claimType.${c.type}`) },
    { key: 'claimed', header: t('money.claims.claimed'), align: 'end', hideBelow: 'md', cell: (c) => <Amount cents={c.claimedCents} /> },
    { key: 'approved', header: t('money.claims.approvedCol'), align: 'end', cell: (c) => (c.status === 'APPROVED' || c.status === 'PAID' ? <Amount cents={c.approvedCents} className="font-semibold text-turtle-700 dark:text-turtle-400" /> : <span className="text-ink-300">—</span>) },
    { key: 'status', header: t('common.status'), cell: (c) => <MoneyState value={c.status} /> },
  ];
  const paidTotal = counts.PAID?.approvedCents ?? 0;
  const openCount = (counts.OPEN?.n ?? 0) + (counts.UNDER_REVIEW?.n ?? 0) + (counts.APPROVED?.n ?? 0);
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('money.claims.title')}
        subtitle={t('money.claims.brandSubtitle')}
        actions={can('tickets.manage') && <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setCreating(true)}>{t('money.claims.new')}</Button>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card><p className="text-xs font-semibold text-ink-500">{t('money.claims.kOpen')}</p><p className="mt-1 font-display text-2xl font-bold text-ink-900 dark:text-white">{num(openCount)}</p></Card>
        <Card><p className="text-xs font-semibold text-ink-500">{t('money.claims.kPaid')}</p><p className="mt-1 font-display text-2xl font-bold text-turtle-700 dark:text-turtle-400"><Amount cents={paidTotal} /></p></Card>
        <Card className="col-span-2 md:col-span-1"><p className="text-xs font-semibold text-ink-500">{t('money.claims.kRejected')}</p><p className="mt-1 font-display text-2xl font-bold text-ink-900 dark:text-white">{num(counts.REJECTED?.n ?? 0)}</p></Card>
      </div>
      <Tabs value={f.status} onChange={(v) => setF({ status: v })} tabs={STATUSES.map((s) => ({ value: s, label: s === 'ALL' ? t('common.all') : t(`state.${s}`), count: s === 'ALL' ? undefined : counts[s]?.n }))} />
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(c) => c.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        onRowClick={(c) => setF({ id: c.id })}
        empty={<EmptyState icon={<FileWarning className="h-7 w-7" />} title={t('money.claims.empty')} description={t('money.claims.emptyHint')} />}
        mobileCard={(c) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><Ltr className="font-mono text-xs font-semibold">{c.code}</Ltr><MoneyState value={c.status} /></div>
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{t(`money.claimType.${c.type}`)}</span><Amount cents={c.status === 'PAID' || c.status === 'APPROVED' ? c.approvedCents : c.claimedCents} className="font-semibold" /></div>
            <p className="text-xs text-ink-500"><Ltr className="font-mono">{c.order?.trackingNumber}</Ltr> · {dateOnly(c.createdAt)}</p>
          </div>
        )}
        footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <NewClaimModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => setF({ id })} />
      <ClaimDrawer id={f.id} onClose={() => setF({ id: '' })} />
    </div>
  );
}

function ClaimDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['claims', 'detail', id], queryFn: () => api<ClaimDetail>(`/claims/${id}`), enabled: !!id });
  const c = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={c ? <span className="flex items-center gap-2"><Ltr className="font-mono">{c.code}</Ltr><MoneyState value={c.status} /></span> : t('money.claims.title')}>
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : c ? (
        <div className="space-y-6">
          <DescriptionList
            items={[
              { label: t('money.col.order'), value: c.order ? <Link to={`/brand/orders/${c.order.id}`} className="ltr font-mono text-turtle-700 hover:underline dark:text-turtle-400">{c.order.trackingNumber}</Link> : '—' },
              { label: t('money.col.type'), value: t(`money.claimType.${c.type}`) },
              { label: t('money.claims.claimed'), value: <Amount cents={c.claimedCents} /> },
              { label: t('money.claims.cap'), value: <span><Amount cents={c.liabilityCapCents} /> <span className="text-xs text-ink-500">({t(`money.claims.capBasis.${c.capBasis}`)})</span></span> },
              ...(c.status === 'APPROVED' || c.status === 'PAID' ? [{ label: t('money.claims.approvedCol'), value: <Amount cents={c.approvedCents} className="font-semibold text-turtle-700 dark:text-turtle-400" /> }] : []),
              { label: t('money.claims.description'), value: <p className="whitespace-pre-line">{c.description}</p>, full: true },
              ...(c.decisionNote ? [{ label: t('money.claims.decision'), value: c.decisionNote, full: true }] : []),
            ]}
          />
          {c.status === 'PAID' && <p className="rounded-xl bg-turtle-50 p-3 text-sm text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200">{t('money.claims.paidHint')}</p>}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('money.claims.evidence')}</h3>
            <EvidenceGallery urls={c.evidence} />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('money.claims.timeline')}</h3>
            <ClaimTimeline claim={c} />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
