import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Printer, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, download } from '@/lib/api';
import { dateOnly, dateTime, num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, DataTable, EmptyState, ErrorState, Input, PageHeader, Skeleton, StateBadge, StatusBadge, type Column } from '@/components/ui';
import { Money, Row } from '../components/common';
import type { SettlementDetail } from '../components/types';
import './i18n';

const SETTLEMENT_TONE = { DRAFT: 'info', APPROVED: 'progress', PAID: 'success', CANCELLED: 'neutral' } as const;
type Line = SettlementDetail['lines'][number];

export default function SettlementDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['finance', 'settlement', id], queryFn: () => api<SettlementDetail>(`/finance/brand/settlements/${id}`) });
  const s = q.data;
  const lines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (s?.lines ?? []).filter((l) => !needle || l.trackingNumber.toLowerCase().includes(needle) || l.recipientName.toLowerCase().includes(needle) || (l.brandReference ?? '').toLowerCase().includes(needle));
  }, [s, search]);

  const back = <Link to="/brand/wallet?tab=settlements" className="inline-flex items-center gap-1 hover:text-ink-800 dark:hover:text-ink-200"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('brand.wallet.settlements')}</Link>;
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-40 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (q.isError || !s) {
    return <Card><div className="mb-2 text-sm text-ink-500">{back}</div>{q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title={t('error.NOT_FOUND')} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />}</Card>;
  }

  const delivered = s.lines.filter((l) => l.status === 'DELIVERED').length;
  const returned = s.lines.length - delivered;
  const feesExVat = s.feesCents - s.vatCents;
  const columns: Column<Line>[] = [
    { key: 'tn', header: t('brand.orders.col.tracking'), cell: (l) => <div><span className="ltr font-mono font-semibold">{l.trackingNumber}</span>{l.brandReference && <p className="ltr text-xs text-ink-400">#{l.brandReference}</p>}</div> },
    { key: 'r', header: t('brand.orders.col.recipient'), hideBelow: 'lg', cell: (l) => l.recipientName },
    { key: 'st', header: t('common.status'), cell: (l) => <div><StatusBadge status={l.status} /><p className="mt-0.5 text-[11px] text-ink-400">{dateOnly(l.deliveredAt ?? l.returnedAt)}</p></div> },
    { key: 'cod', header: t('brand.wallet.cod'), align: 'end', cell: (l) => <Money cents={l.codCents} /> },
    { key: 'fees', header: t('common.fees'), align: 'end', hideBelow: 'md', cell: (l) => <Money cents={-l.feesCents} className="text-ink-500" /> },
    { key: 'net', header: t('brand.wallet.net'), align: 'end', cell: (l) => <Money cents={l.netCents} className={l.netCents < 0 ? 'font-semibold text-red-600' : 'font-semibold text-ink-900 dark:text-white'} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={back}
        title={<span className="ltr">{s.code}</span>}
        subtitle={`${dateOnly(s.periodStart)} – ${dateOnly(s.periodEnd)}`}
        actions={
          <>
            <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} className="no-print">{t('action.print')}</Button>
            <Button icon={<Download className="h-4 w-4" />} className="no-print" onClick={() => download(`/finance/brand/settlements/${s.id}/export.csv`, `${s.code}.csv`).catch((e) => toast.error(errorMessage(e)))}>{t('brand.settlement.download')}</Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-ink-500">{t('brand.settlement.netPayable')}</p>
              <Money cents={s.netPayableCents} className="font-display text-4xl font-bold text-ink-900 dark:text-white" />
            </div>
            <StateBadge value={s.status} map={SETTLEMENT_TONE} label={t(`brand.settlementStatus.${s.status}`)} />
          </div>
          <div className="grid gap-x-10 sm:grid-cols-2">
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              <Row label={t('brand.settlement.codCollected')} value={<Money cents={s.codCollectedCents} />} />
              <Row muted label={t('brand.settlement.feesExVat')} value={<Money cents={-feesExVat} />} />
              <Row muted label={t('brand.fee.vat')} value={<Money cents={-s.vatCents} />} />
              {s.adjustmentsCents !== 0 && <Row muted label={t('brand.settlement.adjustments')} value={<Money cents={s.adjustmentsCents} sign />} />}
              <Row strong label={t('brand.settlement.netPayable')} value={<Money cents={s.netPayableCents} />} />
            </div>
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              <Row label={t('brand.nav.orders')} value={num(s.ordersCount)} />
              <Row muted label={t('brand.orders.tab.delivered')} value={num(delivered)} />
              <Row muted label={t('brand.orders.tab.returns')} value={num(returned)} />
              <Row label={t('brand.settlement.invoice')} value={<span className="ltr font-mono">{s.invoiceNumber ?? '—'}</span>} />
            </div>
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><FileText className="h-4 w-4 text-ink-400" />{t('brand.settlement.payment')}</h3>
          <dl className="space-y-3 text-sm">
            <Item label={t('brand.wallet.payoutMethod')} value={s.method ? t(`brand.payout.${s.method}`) : s.brand.payoutMethod ? t(`brand.payout.${s.brand.payoutMethod}`) : '—'} />
            {s.brand.payoutDetails && Object.entries(s.brand.payoutDetails).filter(([, v]) => v).map(([k, v]) => <Item key={k} label={t(`brand.payoutField.${k}`)} value={<span className="ltr">{v}</span>} />)}
            {s.paymentReference && <Item label={t('brand.settlement.reference')} value={<span className="ltr font-mono">{s.paymentReference}</span>} />}
            {s.approvedAt && <Item label={t('brand.settlement.approvedAt')} value={dateTime(s.approvedAt)} />}
            {s.paidAt && <Item label={t('brand.settlement.paidAt')} value={dateTime(s.paidAt)} />}
            <Item label={t('brand.settlement.legal')} value={s.brand.legalName ?? s.brand.name} />
            {s.brand.taxId && <Item label={t('brand.settings.taxId')} value={<span className="ltr">{s.brand.taxId}</span>} />}
            {s.notes && <Item label={t('common.notes')} value={s.notes} />}
          </dl>
          {s.status !== 'PAID' && <p className="mt-4 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-200">{t(`brand.settlement.hint.${s.status}`)}</p>}
        </Card>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('brand.settlement.lines', { n: num(s.lines.length) })}</h2>
          <Input className="w-full sm:w-72" leading={<Search className="h-4 w-4" />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('brand.orders.searchPh')} aria-label={t('action.search')} />
        </div>
        <DataTable
          columns={columns}
          rows={lines}
          rowKey={(l) => l.id}
          dense
          onRowClick={(l) => navigate(`/brand/orders/${l.id}`)}
          empty={t('common.noResults')}
          mobileCard={(l) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2"><span className="ltr font-mono text-sm font-semibold">{l.trackingNumber}</span><StatusBadge status={l.status} /></div>
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span className="truncate">{l.recipientName}</span>
                <Money cents={l.netCents} className={l.netCents < 0 ? 'text-sm font-semibold text-red-600' : 'text-sm font-semibold text-ink-900 dark:text-white'} />
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-end font-medium text-ink-900 dark:text-ink-100">{value}</dd>
    </div>
  );
}
