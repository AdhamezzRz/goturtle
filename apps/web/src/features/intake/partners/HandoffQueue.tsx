import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, PackageCheck, Send, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useQueryState } from '@/lib/hooks';
import { dateTime, money, num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, Pagination, Select, Switch, type Column } from '@/components/ui';
import { useHubs } from '@/portals/ops/components/opsb';
import type { Partner, QueueRow } from '../types';
import { useGovernorates, usePartners } from './data';
import '../i18n';

/** Parcels at the hub that our heroes do not cover → hand them to a partner. */
export function HandoffQueue() {
  const { t, pick } = useI18n();
  const [f, setF] = useQueryState({ all: '', governorate: '', hubId: '', q: '', page: '1' });
  const hubs = useHubs();
  const govs = useGovernorates();
  const partners = usePartners();
  const q = useQuery({
    queryKey: ['partners', 'queue', f],
    queryFn: () => api<Paginated<QueueRow>>('/partners/handoff-queue', { query: { unservedOnly: f.all ? 'false' : 'true', governorate: f.governorate, hubId: f.hubId, q: f.q, page: f.page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [handoff, setHandoff] = useState(false);
  useEffect(() => setSelected(new Set()), [f.all, f.governorate, f.hubId, f.q, f.page]);
  const rows = q.data?.data ?? [];
  const chosen = rows.filter((r) => selected.has(r.id));

  const columns: Column<QueueRow>[] = [
    { key: 'tn', header: t('intake.pt.c.order'), cell: (r) => <div><Link to={`/ops/orders/${r.id}`} className="ltr font-mono text-sm font-semibold text-turtle-700 hover:underline dark:text-turtle-400">{r.trackingNumber}</Link><p className="text-xs text-ink-500">{r.brandName}</p></div> },
    { key: 'to', header: t('intake.pt.c.destination'), cell: (r) => <div><p className="text-sm font-medium">{pick(r.zone, 'name')}</p><p className="text-xs text-ink-500">{pick(r.governorate, 'name')} · <span className="ltr">{r.governorate.code}</span></p></div> },
    { key: 'recipient', header: t('intake.pt.c.recipient'), hideBelow: 'lg', cell: (r) => <span className="text-sm">{r.recipientName}</span> },
    { key: 'cod', header: t('intake.pt.c.cod'), align: 'end', cell: (r) => <span className="ltr text-sm font-semibold">{money(r.collectCents)}</span> },
    { key: 'due', header: t('intake.pt.c.promised'), hideBelow: 'xl', cell: (r) => <span className="text-xs text-ink-500">{dateTime(r.promisedBy)}</span> },
    { key: 'served', header: t('intake.pt.c.coverage'), hideBelow: 'md', cell: (r) => (r.servedByHeroes ? <Badge tone="success">{t('intake.pt.ourHeroes')}</Badge> : <Badge tone="warning">{t('intake.pt.noHeroes')}</Badge>) },
    { key: 'partners', header: t('intake.pt.c.suggested'), hideBelow: 'md', cell: (r) => (r.suggestedPartners.length ? <div className="flex flex-wrap gap-1">{r.suggestedPartners.map((p) => <Badge key={p.id} tone="info">{p.name}</Badge>)}</div> : <span className="text-xs text-ink-400">—</span>) },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label={t('action.search')}>{(id) => <Input id={id} value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder={t('intake.pt.searchQueue')} />}</Field>
          <Field label={t('intake.pt.governorate')}>{(id) => <Select id={id} value={f.governorate} onChange={(e) => setF({ governorate: e.target.value })} placeholder={t('common.all')} options={(govs.data ?? []).map((g) => ({ value: g.code, label: pick(g, 'name') }))} />}</Field>
          <Field label={t('common.hub')}>{(id) => <Select id={id} value={f.hubId} onChange={(e) => setF({ hubId: e.target.value })} placeholder={t('common.all')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} />}</Field>
          <div className="pb-2"><Switch checked={!!f.all} onChange={(v) => setF({ all: v ? '1' : '' })} label={t('intake.pt.showAll')} /></div>
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-turtle-200 bg-turtle-50 px-4 py-3 shadow-card dark:border-turtle-900 dark:bg-turtle-950">
          <p className="text-sm font-semibold text-turtle-900 dark:text-turtle-100">{t('intake.pt.selected', { n: num(selected.size), cod: money(chosen.reduce((s, r) => s + r.collectCents, 0)) })}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t('action.clear')}</Button>
            <Button size="sm" icon={<Send className="h-4 w-4" />} onClick={() => setHandoff(true)}>{t('intake.pt.handoff')}</Button>
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
        selected={selected}
        onSelectChange={setSelected}
        empty={<EmptyState icon={<PackageCheck className="h-7 w-7" />} title={t('intake.pt.queueEmpty')} description={f.all ? t('common.noResults') : t('intake.pt.queueEmptyHint')} />}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="ltr text-start font-mono text-sm font-semibold">{r.trackingNumber}</p>
              <p className="text-xs text-ink-500">{r.brandName} · {pick(r.zone, 'name')} · {pick(r.governorate, 'name')}</p>
              <div className="mt-1 flex flex-wrap gap-1">{r.servedByHeroes ? <Badge tone="success">{t('intake.pt.ourHeroes')}</Badge> : <Badge tone="warning">{t('intake.pt.noHeroes')}</Badge>}{r.suggestedPartners.map((p) => <Badge key={p.id} tone="info">{p.name}</Badge>)}</div>
            </div>
            <span className="ltr shrink-0 text-sm font-semibold">{money(r.collectCents)}</span>
          </div>
        )}
      />
      {q.data && q.data.meta.totalPages > 1 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} />}
      <HandoffModal open={handoff} orders={chosen} partners={partners.data ?? []} onClose={() => setHandoff(false)} onDone={() => { setHandoff(false); setSelected(new Set()); }} />
    </div>
  );
}

export function HandoffModal({ open, orders, partners, onClose, onDone, presetPartnerId }: {
  open: boolean; orders: Array<Pick<QueueRow, 'id' | 'trackingNumber'> & { suggestedPartners?: QueueRow['suggestedPartners'] }>; partners: Partner[]; onClose: () => void; onDone: () => void; presetPartnerId?: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const active = useMemo(() => partners.filter((p) => p.isActive), [partners]);
  const suggested = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) for (const p of o.suggestedPartners ?? []) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }, [orders]);
  const [partnerId, setPartnerId] = useState('');
  const [tns, setTns] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ partner: { name: string }; orders: Array<{ id: string; trackingNumber: string; partnerTrackingNumber: string | null; partnerTrackingUrl: string | null }> } | null>(null);
  useEffect(() => {
    if (!open) return;
    setPartnerId(presetPartnerId || suggested || active[0]?.id || '');
    setTns({});
    setNote('');
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () => api<NonNullable<typeof result>>(`/partners/${partnerId}/handoff`, { method: 'POST', body: { orderIds: orders.map((o) => o.id), partnerTrackingNumbers: orders.map((o) => tns[o.id]?.trim() ?? ''), ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['partners'] });
      qc.invalidateQueries({ queryKey: ['order'] });
      toast.success(t('intake.pt.handedOff', { n: num(r.orders.length), partner: r.partner.name }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={result ? onDone : onClose}
      size="lg"
      title={t('intake.pt.handoffTitle', { n: num(orders.length) })}
      description={t('intake.pt.handoffHint')}
      footer={result ? <Button onClick={onDone}>{t('action.close')}</Button> : <><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button icon={<Truck className="h-4 w-4" />} loading={m.isPending} disabled={!partnerId || !orders.length} onClick={() => m.mutate()}>{t('intake.pt.handoff')}</Button></>}
    >
      {result ? (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {result.orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="ltr font-mono">{o.trackingNumber}</span>
              {o.partnerTrackingUrl ? <a href={o.partnerTrackingUrl} target="_blank" rel="noreferrer" className="ltr inline-flex items-center gap-1 font-mono text-turtle-700 hover:underline dark:text-turtle-400">{o.partnerTrackingNumber}<ExternalLink className="h-3.5 w-3.5" /></a> : <span className="ltr font-mono text-ink-500">{o.partnerTrackingNumber ?? '—'}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          <Field label={t('intake.pt.partner')} required>
            {(id) => <Select id={id} value={partnerId} onChange={(e) => setPartnerId(e.target.value)} placeholder={t('intake.pt.choosePartner')} options={active.map((p) => ({ value: p.id, label: `${p.name}${p.governorateCodes.length ? ` · ${p.governorateCodes.join(', ')}` : ''}` }))} />}
          </Field>
          {!active.length && <p className="text-sm text-amber-700">{t('intake.pt.noPartners')}</p>}
          <div>
            <p className="mb-2 text-sm font-medium text-ink-700 dark:text-ink-200">{t('intake.pt.waybills')}</p>
            <div className="max-h-72 space-y-2 overflow-y-auto pe-1">
              {orders.map((o) => (
                <div key={o.id} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-2">
                  <span className="ltr truncate font-mono text-sm">{o.trackingNumber}</span>
                  <Input dir="ltr" className="font-mono" value={tns[o.id] ?? ''} onChange={(e) => setTns({ ...tns, [o.id]: e.target.value })} placeholder={t('intake.pt.waybillPh')} aria-label={t('intake.pt.waybillFor', { tn: o.trackingNumber })} maxLength={60} />
                </div>
              ))}
            </div>
          </div>
          <Field label={t('common.notes')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
        </div>
      )}
    </Modal>
  );
}
