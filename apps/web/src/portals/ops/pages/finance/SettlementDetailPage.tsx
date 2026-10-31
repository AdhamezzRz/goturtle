import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BadgeCheck, Ban, Download, FileText, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { PayoutMethod } from '@goturtle/shared';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateOnly, dateTime, money } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Card, ConfirmDialog, DataTable, ErrorState, Field, Input, Modal, Select, Skeleton, StateBadge, StatusBadge, type Column } from '@/components/ui';
import { Code, InfoRow, Money, Notice, ReasonDialog, RequirePermission, Section, Stat, StatGrid, enumOptions, useEnumLabel } from '@/portals/ops/components/opsb';
import type { OrderStatus } from '@goturtle/shared';
import type { SettlementRow } from './SettlementsPage';
import './i18n';
import '../brands/i18n';

type SettlementDetail = SettlementRow & {
  brand: SettlementRow['brand'] & { payoutDetails: Record<string, string> | null; legalName: string | null; taxId: string | null };
  lines: Array<{ id: string; trackingNumber: string; brandReference: string | null; status: string; recipientName: string; codAmountCents: number; collectedCents: number; deliveredAt: string | null; returnedAt: string | null; codCents: number; feesCents: number; netCents: number }>;
};

export default function SettlementDetailPage() {
  return (
    <RequirePermission permission="finance.read">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { id = '' } = useParams();
  const { t, dir } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'approve' | 'pay' | 'cancel' | null>(null);
  const [busyCsv, setBusyCsv] = useState(false);
  const q = useQuery({ queryKey: ['finance', 'settlement', id], queryFn: () => api<SettlementDetail>(`/finance/settlements/${id}`) });
  const done = (msg: string) => () => { toast.success(msg); setDialog(null); qc.invalidateQueries({ queryKey: ['finance'] }); };
  const approve = useMutation({ mutationFn: () => api(`/finance/settlements/${id}/approve`, { method: 'POST' }), onSuccess: done(t('ops.settlements.d.approved')), onError: (e) => toast.error(errorMessage(e)) });
  const cancel = useMutation({ mutationFn: (reason: string) => api(`/finance/settlements/${id}/cancel`, { method: 'POST', body: { reason } }), onSuccess: done(t('ops.settlements.d.cancelled')), onError: (e) => toast.error(errorMessage(e)) });

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const manage = can('settlements.manage');
  const csv = async () => {
    setBusyCsv(true);
    try {
      await download(`/finance/settlements/${s.id}/export.csv`, `${s.code}.csv`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyCsv(false);
    }
  };
  const columns: Column<SettlementDetail['lines'][number]>[] = [
    { key: 'tn', header: t('ops.settlements.d.tracking'), cell: (l) => <Link to={`/ops/orders/${l.id}`} className="ltr font-mono text-xs font-semibold text-turtle-700 hover:underline dark:text-turtle-400" onClick={(e) => e.stopPropagation()}>{l.trackingNumber}</Link> },
    { key: 'ref', header: t('ops.opsb.reference'), cell: (l) => <span className="ltr text-xs">{l.brandReference ?? '—'}</span>, hideBelow: 'xl' },
    { key: 'rcp', header: t('ops.settlements.d.recipient'), cell: (l) => l.recipientName, hideBelow: 'lg' },
    { key: 'status', header: t('common.status'), cell: (l) => <StatusBadge status={l.status as OrderStatus} /> },
    { key: 'final', header: t('ops.settlements.d.finalAt'), cell: (l) => <span className="whitespace-nowrap text-xs">{dateOnly(l.deliveredAt ?? l.returnedAt)}</span>, hideBelow: 'md' },
    { key: 'cod', header: t('ops.settlements.col.cod'), align: 'end', cell: (l) => <Money cents={l.codCents} />, hideBelow: 'sm' },
    { key: 'fees', header: t('ops.settlements.col.fees'), align: 'end', cell: (l) => <Money cents={-l.feesCents} className="text-ink-500" />, hideBelow: 'sm' },
    { key: 'net', header: t('ops.settlements.d.lineNet'), align: 'end', cell: (l) => <Money cents={l.netCents} tone="auto" className="font-semibold" /> },
  ];
  const details = s.brand.payoutDetails ?? {};
  return (
    <div>
      <Link to="/ops/finance/settlements" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"><Back className="h-4 w-4" />{t('ops.settlements.d.back')}</Link>
      <Card className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="ltr font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{s.code}</h1>
              <StateBadge value={s.status} />
            </div>
            <p className="mt-1 text-sm text-ink-500">
              <Link to={`/ops/brands/${s.brandId}`} className="font-semibold text-ink-800 hover:underline dark:text-ink-100">{s.brand.name}</Link> · {dateOnly(s.periodStart)} – {dateOnly(s.periodEnd)}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
              {s.invoiceNumber && <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{t('ops.settlements.d.invoice')}: <span className="ltr font-semibold">{s.invoiceNumber}</span></span>}
              {s.approvedAt && <span>{t('ops.settlements.d.approvedAt', { date: dateTime(s.approvedAt) })}</span>}
              {s.paidAt && <span>{t('ops.settlements.d.paidAt', { date: dateTime(s.paidAt) })}</span>}
              {s.paymentReference && <span>{t('ops.opsb.reference')}: <span className="ltr font-semibold">{s.paymentReference}</span> · {en('PayoutMethod', s.method)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={<Download className="h-4 w-4" />} loading={busyCsv} onClick={csv}>{t('ops.settlements.d.csv')}</Button>
            {manage && s.status === 'DRAFT' && <Button icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setDialog('approve')}>{t('ops.settlements.d.approve')}</Button>}
            {manage && s.status === 'APPROVED' && <Button variant="cash" icon={<Wallet className="h-4 w-4" />} onClick={() => setDialog('pay')}>{t('ops.settlements.d.pay')}</Button>}
            {manage && (s.status === 'DRAFT' || s.status === 'APPROVED') && <Button variant="ghost" icon={<Ban className="h-4 w-4 text-red-500" />} onClick={() => setDialog('cancel')}>{t('ops.settlements.d.cancel')}</Button>}
          </div>
        </div>
      </Card>

      <StatGrid cols={5} className="mb-5">
        <Stat label={t('ops.settlements.col.orders')} value={s.ordersCount} tone="ink" />
        <Stat label={t('ops.settlements.col.cod')} value={<Money cents={s.codCollectedCents} compact />} tone="sand" />
        <Stat label={t('ops.settlements.col.fees')} value={<Money cents={s.feesCents} compact />} hint={<span>VAT <Money cents={s.vatCents} /></span>} tone="violet" />
        <Stat label={t('ops.settlements.d.adjustments')} value={<Money cents={s.adjustmentsCents} compact sign />} tone="sky" />
        <Stat label={t('ops.settlements.col.net')} value={<Money cents={s.netPayableCents} compact />} tone="turtle" />
      </StatGrid>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Section title={t('ops.settlements.d.summary')}>
          <InfoRow label={t('ops.settlements.col.cod')} value={<Money cents={s.codCollectedCents} />} />
          <InfoRow label={t('ops.settlements.col.fees')} value={<Money cents={-(s.feesCents - s.vatCents)} tone="auto" />} />
          <InfoRow label={t('ops.finance.pos.vat')} value={<Money cents={-s.vatCents} tone="auto" />} />
          <InfoRow label={t('ops.settlements.d.adjustments')} value={<Money cents={s.adjustmentsCents} sign />} />
          <InfoRow label={t('ops.settlements.col.net')} value={<Money cents={s.netPayableCents} className="text-base font-bold" />} strong />
        </Section>
        <Section title={t('ops.settlements.d.payout')}>
          <InfoRow label={t('ops.settlements.d.legalName')} value={s.brand.legalName ?? '—'} />
          <InfoRow label={t('ops.settlements.d.taxId')} value={<span className="ltr">{s.brand.taxId ?? '—'}</span>} />
          <InfoRow label={t('ops.settlements.d.cycle')} value={en('SettlementCycle', s.brand.settlementCycle)} />
          <InfoRow label={t('ops.opsb.method')} value={en('PayoutMethod', s.brand.payoutMethod)} />
          {Object.entries(details).filter(([, v]) => v).map(([k, v]) => <InfoRow key={k} label={t(`ops.brands.payout.${k}`)} value={<span className="ltr">{v}</span>} />)}
        </Section>
      </div>

      <Section title={t('ops.settlements.d.lines', { n: String(s.lines.length) })}>
        <DataTable
          columns={columns}
          rows={s.lines}
          rowKey={(l) => l.id}
          dense
          mobileCard={(l) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2"><span className="ltr font-mono text-xs font-semibold">{l.trackingNumber}</span><StatusBadge status={l.status as OrderStatus} /></div>
              <div className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{l.recipientName}</span><Money cents={l.netCents} tone="auto" className="font-semibold" /></div>
              <p className="text-xs text-ink-500"><Money cents={l.codCents} /> − <Money cents={l.feesCents} /></p>
            </div>
          )}
        />
      </Section>

      <ConfirmDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        onConfirm={() => approve.mutate()}
        loading={approve.isPending}
        title={t('ops.settlements.d.approveTitle', { code: s.code })}
        confirmLabel={t('ops.settlements.d.approve')}
      >
        <p className="text-sm text-ink-600 dark:text-ink-300">{t('ops.settlements.d.approveDesc', { brand: s.brand.name })}</p>
        <p className="mt-2 font-display text-2xl font-bold"><Money cents={s.netPayableCents} /></p>
      </ConfirmDialog>
      <PaySettlementModal open={dialog === 'pay'} onClose={() => setDialog(null)} s={s} />
      <ReasonDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title={t('ops.settlements.d.cancelTitle', { code: s.code })} description={t('ops.settlements.d.cancelDesc')} danger loading={cancel.isPending} confirmLabel={t('ops.settlements.d.cancel')} onConfirm={(r) => cancel.mutate(r)}>
        <InfoRow label={t('ops.settlements.col.net')} value={<Money cents={s.netPayableCents} className="font-semibold" />} />
      </ReasonDialog>
    </div>
  );
}

function PaySettlementModal({ open, onClose, s }: { open: boolean; onClose: () => void; s: SettlementDetail }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [method, setMethod] = useState(s.brand.payoutMethod);
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (open) { setMethod(s.brand.payoutMethod); setRef(''); setErr(undefined); }
  }, [open, s.brand.payoutMethod]);
  const m = useMutation({
    mutationFn: () => api(`/finance/settlements/${s.id}/pay`, { method: 'POST', body: { method, paymentReference: ref.trim() } }),
    onSuccess: () => { toast.success(t('ops.settlements.d.paid')); qc.invalidateQueries({ queryKey: ['finance'] }); onClose(); },
    onError: (e) => { setErr(errorMessage(e)); toast.error(errorMessage(e)); },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ops.settlements.d.payTitle', { amount: money(s.netPayableCents), brand: s.brand.name })}
      description={t('ops.settlements.d.payDesc')}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button variant="cash" loading={m.isPending} onClick={() => { if (ref.trim().length < 2) { setErr(t('ops.settlements.d.refRequired')); return; } m.mutate(); }}>{t('ops.settlements.d.pay')} · {money(s.netPayableCents)}</Button></>}
    >
      <div className="space-y-4">
        <Notice tone="info"><span className="font-display text-xl font-bold"><Money cents={s.netPayableCents} /></span> → {s.brand.name} <Code>{s.brand.code}</Code></Notice>
        <Field label={t('ops.opsb.method')} required>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)} options={enumOptions('PayoutMethod', Object.values(PayoutMethod))} />}</Field>
        <Field label={t('ops.settlements.d.paymentRef')} required error={err}>{(id) => <Input id={id} dir="ltr" value={ref} onChange={(e) => { setRef(e.target.value); setErr(undefined); }} invalid={!!err} maxLength={120} />}</Field>
      </div>
    </Modal>
  );
}
