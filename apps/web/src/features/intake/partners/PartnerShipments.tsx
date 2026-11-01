import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, PackageX, RotateCcw, Truck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { dateTime, money, num, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, DataTable, EmptyState, Field, Input, Modal, Pagination, Select, StatusBadge, Tabs, type Column } from '@/components/ui';
import type { Partner, Shipment } from '../types';
import { PARTNER_FAILURE_REASONS, type Outcome } from './data';
import '../i18n';

type State = 'active' | 'delivered' | 'returned' | 'all';

/** A partner's shipments with bulk outcome entry for manual partners. */
export function PartnerShipments({ partner }: { partner: Partner }) {
  const { t, pick } = useI18n();
  const [state, setState] = useState<State>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['partners', partner.id, 'shipments', state, search, page],
    queryFn: () => api<Paginated<Shipment>>(`/partners/${partner.id}/shipments`, { query: { state, q: search, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => {
    setSelected(new Set());
    setPage(1);
  }, [state, search, partner.id]);
  const rows = q.data?.data ?? [];
  const chosen = rows.filter((r) => selected.has(r.id) && r.withPartner);

  const columns: Column<Shipment>[] = [
    { key: 'tn', header: t('intake.pt.c.order'), cell: (r) => <div><Link to={`/ops/orders/${r.id}`} className="ltr font-mono text-sm font-semibold text-turtle-700 hover:underline dark:text-turtle-400">{r.trackingNumber}</Link><p className="text-xs text-ink-500">{r.brandName}</p></div> },
    { key: 'ptn', header: t('intake.pt.c.waybill'), cell: (r) => (r.partnerTrackingUrl ? <a href={r.partnerTrackingUrl} target="_blank" rel="noreferrer" className="ltr inline-flex items-center gap-1 font-mono text-sm text-turtle-700 hover:underline dark:text-turtle-400">{r.partnerTrackingNumber}<ExternalLink className="h-3 w-3" /></a> : <span className="ltr font-mono text-sm text-ink-500">{r.partnerTrackingNumber ?? '—'}</span>) },
    { key: 'status', header: t('common.status'), cell: (r) => <div className="flex flex-wrap items-center gap-1"><StatusBadge status={r.status} />{r.attempts > 0 && <Badge>{t('intake.pt.attempts', { n: num(r.attempts) })}</Badge>}</div> },
    { key: 'to', header: t('intake.pt.c.destination'), hideBelow: 'lg', cell: (r) => <span className="text-sm">{pick(r.zone, 'name')} · {pick(r.governorate, 'name')}</span> },
    { key: 'cod', header: t('intake.pt.c.cod'), align: 'end', cell: (r) => <div className="text-end"><p className="ltr text-sm font-semibold">{money(r.status === 'DELIVERED' ? r.collectedCents : r.collectCents)}</p>{r.status === 'DELIVERED' && r.collectedCents > 0 && (r.remitted ? <Badge tone="success">{t('intake.pt.remitted')}</Badge> : <Badge tone="warning">{t('intake.pt.owed')}</Badge>)}</div> },
    { key: 'at', header: t('intake.pt.c.handed'), hideBelow: 'xl', cell: (r) => <span className="text-xs text-ink-500">{dateTime(r.handedToPartnerAt)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={state} onChange={setState} tabs={(['active', 'delivered', 'returned', 'all'] as const).map((s) => ({ value: s, label: t(`intake.pt.state.${s}`) }))} />
        <Input className="sm:w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('intake.pt.searchShipments')} aria-label={t('action.search')} />
      </div>
      {chosen.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-turtle-200 bg-turtle-50 px-4 py-3 shadow-card dark:border-turtle-900 dark:bg-turtle-950">
          <p className="text-sm font-semibold text-turtle-900 dark:text-turtle-100">{t('intake.pt.selectedN', { n: num(chosen.length) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setOutcome('DELIVERED')}>{t('intake.pt.outcome.DELIVERED')}</Button>
            <Button size="sm" variant="outline" icon={<XCircle className="h-4 w-4" />} onClick={() => setOutcome('FAILED')}>{t('intake.pt.outcome.FAILED')}</Button>
            <Button size="sm" variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setOutcome('RETURNED')}>{t('intake.pt.outcome.RETURNED')}</Button>
          </div>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        selected={state === 'active' || state === 'all' ? selected : undefined}
        onSelectChange={state === 'active' || state === 'all' ? setSelected : undefined}
        empty={<EmptyState icon={<Truck className="h-7 w-7" />} title={t('intake.pt.noShipments')} description={t('intake.pt.noShipmentsHint')} />}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="ltr text-start font-mono text-sm font-semibold">{r.trackingNumber} <span className="text-ink-400">· {r.partnerTrackingNumber ?? '—'}</span></p>
              <p className="text-xs text-ink-500">{r.brandName} · {pick(r.governorate, 'name')}</p>
              <div className="mt-1"><StatusBadge status={r.status} /></div>
            </div>
            <span className="ltr shrink-0 text-sm font-semibold">{money(r.collectCents)}</span>
          </div>
        )}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      <OutcomeModal partner={partner} outcome={outcome} shipments={chosen} onClose={() => setOutcome(null)} onDone={() => { setOutcome(null); setSelected(new Set()); }} />
    </div>
  );
}

export function OutcomeModal({ partner, outcome, shipments, onClose, onDone }: { partner: Pick<Partner, 'id' | 'name'>; outcome: Outcome | null; shipments: Array<Pick<Shipment, 'id' | 'trackingNumber' | 'collectCents'>>; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [reason, setReason] = useState<string>('CUSTOMER_UNREACHABLE');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [collected, setCollected] = useState('');
  useEffect(() => {
    if (!outcome) return;
    setReason(outcome === 'RETURNED' ? 'CUSTOMER_REFUSED' : 'CUSTOMER_UNREACHABLE');
    setReference('');
    setNote('');
    setCollected(shipments.length === 1 ? String(shipments[0].collectCents / 100) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);
  const single = shipments.length === 1;
  const collectedCents = single && outcome === 'DELIVERED' && collected.trim() ? parseEgp(collected) : null;
  const m = useMutation({
    mutationFn: () =>
      api<{ applied: number; failed: number; results: Array<{ ok: boolean; trackingNumber?: string; message?: string }> }>(`/partners/${partner.id}/status`, {
        method: 'POST',
        body: {
          updates: shipments.map((s) => ({
            orderId: s.id, outcome,
            ...(outcome !== 'DELIVERED' ? { reason } : {}),
            ...(collectedCents !== null ? { collectedCents } : {}),
            ...(reference.trim() ? { partnerReference: reference.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          })),
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['partners'] });
      qc.invalidateQueries({ queryKey: ['order'] });
      if (r.failed) toast.error(t('intake.pt.someFailed', { ok: num(r.applied), failed: num(r.failed), first: r.results.find((x) => !x.ok)?.message ?? '' }));
      else toast.success(t('intake.pt.applied', { n: num(r.applied) }));
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!outcome) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={t(`intake.pt.outcomeTitle.${outcome}`, { n: num(shipments.length) })}
      description={t('intake.pt.outcomeHint', { partner: partner.name })}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button variant={outcome === 'DELIVERED' ? 'primary' : 'danger'} icon={outcome === 'RETURNED' ? <PackageX className="h-4 w-4" /> : undefined} loading={m.isPending} disabled={single && outcome === 'DELIVERED' && collected.trim() !== '' && collectedCents === null} onClick={() => m.mutate()}>{t('action.confirm')}</Button></>}
    >
      <div className="space-y-4">
        {outcome !== 'DELIVERED' && (
          <Field label={t('intake.pt.reason')}>{(id) => <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)} options={PARTNER_FAILURE_REASONS.map((r) => ({ value: r, label: t(`intake.reason.${r}`) }))} />}</Field>
        )}
        {single && outcome === 'DELIVERED' && (
          <Field label={t('intake.pt.collected')} hint={t('intake.pt.collectedHint')}>{(id) => <Input id={id} inputMode="decimal" dir="ltr" value={collected} onChange={(e) => setCollected(e.target.value)} trailing={<span className="text-xs">{t('common.egp')}</span>} />}</Field>
        )}
        {!single && outcome === 'DELIVERED' && <p className="rounded-xl bg-sand-50 px-3 py-2 text-sm text-sand-900 dark:bg-sand-950/40 dark:text-sand-200">{t('intake.pt.bulkCollected', { amount: money(shipments.reduce((s, x) => s + x.collectCents, 0)) })}</p>}
        <Field label={t('intake.pt.reference')} hint={t('intake.pt.referenceHint')}>{(id) => <Input id={id} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />}</Field>
        <Field label={t('common.notes')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
      </div>
    </Modal>
  );
}
