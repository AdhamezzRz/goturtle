import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, CheckCircle2, ClipboardPaste, Clock, QrCode, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { CollectionMethod, type CollectionStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, num } from '@/lib/format';
import { usePollInterval, useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea, type Column } from '@/components/ui';
import { CourierSelect, FilterBar, FilterField, Notice, ReasonDialog, RequirePermission, Stat, StatGrid } from '@/portals/ops/components/opsb';
import { Amount, Ltr, MethodBadge, MoneyState } from '@/features/money/ui';
import type { BulkConfirmResult, CollectionList, CollectionRow } from '@/features/money/types';
import '@/features/money/i18n';
import './i18n';

const STATUSES: Array<CollectionStatus | 'ALL'> = ['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'ALL'];

export default function CollectionsPage() {
  return (
    <RequirePermission permission="finance.read">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const poll = usePollInterval(30_000);
  const [f, setF] = useQueryState({ status: 'PENDING_CONFIRMATION', method: '', courierId: '', from: '', to: '', q: '', page: '1' });
  const [bulk, setBulk] = useState(false);
  const [rejecting, setRejecting] = useState<CollectionRow | null>(null);
  const q = useQuery({
    queryKey: ['finance', 'collections', f],
    queryFn: () => api<CollectionList>('/finance/collections', { query: { status: f.status === 'ALL' ? undefined : f.status, method: f.method, courierId: f.courierId, from: f.from, to: f.to, q: f.q, page: f.page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
    refetchInterval: poll,
  });
  const act = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: 'confirm' | 'reject'; body?: unknown }) => api<CollectionRow>(`/finance/collections/${id}/${path}`, { method: 'POST', body: body ?? {} }),
    onSuccess: (r) => { toast.success(t(`state.${r.collectionStatus}`)); setRejecting(null); void qc.invalidateQueries({ queryKey: ['finance', 'collections'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const manage = can('finance.manage');
  const s = q.data?.summary;
  const columns: Column<CollectionRow>[] = [
    { key: 'order', header: t('money.col.order'), cell: (c) => <div><Link to={`/ops/orders/${c.id}`} onClick={(e) => e.stopPropagation()} className="ltr font-mono text-sm font-semibold text-turtle-700 hover:underline dark:text-turtle-400">{c.trackingNumber}</Link><p className="text-xs text-ink-500">{c.brand.name}</p></div> },
    { key: 'method', header: t('money.coll.method'), cell: (c) => <MethodBadge method={c.collectionMethod} /> },
    { key: 'ref', header: t('money.coll.reference'), cell: (c) => <Ltr className="font-mono text-xs">{c.collectionReference ?? '—'}</Ltr> },
    { key: 'hero', header: t('money.coll.hero'), hideBelow: 'lg', cell: (c) => <span className="text-sm">{c.courier ? `${c.courier.name ?? ''}` : '—'}<span className="block text-xs text-ink-400">{c.courier?.code}</span></span> },
    { key: 'at', header: t('money.coll.deliveredAt'), hideBelow: 'xl', cell: (c) => <span className="whitespace-nowrap text-sm">{dateTime(c.deliveredAt)}</span> },
    { key: 'amount', header: t('money.coll.amount'), align: 'end', cell: (c) => <Amount cents={c.collectedCents} className="font-semibold" /> },
    { key: 'status', header: t('common.status'), cell: (c) => <div><MoneyState value={c.collectionStatus} />{c.decision?.note && <p className="mt-1 max-w-[180px] truncate text-xs text-ink-500" title={c.decision.note}>{c.decision.note}</p>}</div> },
    {
      key: 'act', header: '', align: 'end',
      cell: (c) => manage && c.collectionStatus === 'PENDING_CONFIRMATION' ? (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" className="text-red-600" aria-label={t('money.coll.reject')} icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setRejecting(c)} />
          <Button size="xs" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={act.isPending && act.variables?.id === c.id} onClick={() => act.mutate({ id: c.id, path: 'confirm' })}>{t('money.coll.confirm')}</Button>
        </div>
      ) : null,
    },
  ];
  return (
    <div>
      <PageHeader
        title={t('money.coll.title')}
        subtitle={t('money.coll.subtitle')}
        actions={manage && <Button icon={<ClipboardPaste className="h-4 w-4" />} onClick={() => setBulk(true)}>{t('money.coll.bulk')}</Button>}
      />
      <StatGrid cols={3} className="mb-5">
        <Stat icon={<Clock />} tone="sand" label={t('money.coll.kPending')} value={<Amount cents={s?.pending.cents} />} hint={t('money.coll.nCollections', { n: num(s?.pending.n ?? 0) })} loading={q.isLoading} onClick={() => setF({ status: 'PENDING_CONFIRMATION' })} active={f.status === 'PENDING_CONFIRMATION'} />
        <Stat icon={<CheckCheck />} label={t('money.coll.kConfirmed')} value={<Amount cents={s?.confirmed.cents} />} hint={t('money.coll.nCollections', { n: num(s?.confirmed.n ?? 0) })} loading={q.isLoading} onClick={() => setF({ status: 'CONFIRMED' })} active={f.status === 'CONFIRMED'} />
        <Stat icon={<XCircle />} tone="red" label={t('money.coll.kRejected')} value={<Amount cents={s?.rejected.cents} />} hint={t('money.coll.nCollections', { n: num(s?.rejected.n ?? 0) })} loading={q.isLoading} onClick={() => setF({ status: 'REJECTED' })} active={f.status === 'REJECTED'} />
      </StatGrid>
      {s?.pendingByMethod && Object.keys(s.pendingByMethod).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(s.pendingByMethod).map(([m, b]) => (
            <button key={m} type="button" onClick={() => setF({ method: m, status: 'PENDING_CONFIRMATION' })} className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200">
              {t(`money.method.${m}`)} · {num(b!.n)} · <Amount cents={b!.cents} />
            </button>
          ))}
        </div>
      )}
      <Tabs className="mb-4" value={f.status} onChange={(v) => setF({ status: v })} tabs={STATUSES.map((st) => ({ value: st, label: st === 'ALL' ? t('common.all') : t(`state.${st}`) }))} />
      <FilterBar activeCount={[f.method, f.courierId, f.from, f.to, f.q].filter(Boolean).length} onClear={() => setF({ method: '', courierId: '', from: '', to: '', q: '' })}>
        <FilterField label={t('action.search')}><Input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder={t('money.coll.searchPh')} aria-label={t('action.search')} className="md:!w-52" /></FilterField>
        <FilterField label={t('money.coll.method')}>
          <Select value={f.method} onChange={(e) => setF({ method: e.target.value })} placeholder={t('common.all')} options={Object.values(CollectionMethod).filter((m) => m !== 'CASH').map((m) => ({ value: m, label: t(`money.method.${m}`) }))} aria-label={t('money.coll.method')} />
        </FilterField>
        <FilterField label={t('money.coll.hero')}><CourierSelect value={f.courierId} onChange={(v) => setF({ courierId: v })} placeholder={t('common.all')} /></FilterField>
        <FilterField label={t('common.from')}><Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} aria-label={t('common.from')} className="md:!w-40" /></FilterField>
        <FilterField label={t('common.to')}><Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} aria-label={t('common.to')} className="md:!w-40" /></FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(c) => c.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState icon={<QrCode className="h-7 w-7" />} title={f.status === 'PENDING_CONFIRMATION' ? t('money.coll.emptyPending') : t('money.coll.empty')} />}
        mobileCard={(c) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2"><Ltr className="font-mono text-sm font-semibold">{c.trackingNumber}</Ltr><MoneyState value={c.collectionStatus} /></div>
            <div className="flex items-center justify-between gap-2"><MethodBadge method={c.collectionMethod} /><Amount cents={c.collectedCents} className="font-semibold" /></div>
            <p className="text-xs text-ink-500"><Ltr className="font-mono">{c.collectionReference ?? '—'}</Ltr> · {c.courier?.name ?? '—'} · {dateTime(c.deliveredAt)}</p>
            {manage && c.collectionStatus === 'PENDING_CONFIRMATION' && (
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="text-red-600" onClick={() => setRejecting(c)}>{t('money.coll.reject')}</Button>
                <Button size="sm" loading={act.isPending && act.variables?.id === c.id} onClick={() => act.mutate({ id: c.id, path: 'confirm' })}>{t('money.coll.confirm')}</Button>
              </div>
            )}
          </div>
        )}
        footer={q.data && q.data.meta.totalPages > 1 ? <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <ReasonDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={t('money.coll.rejectTitle')}
        description={rejecting ? t('money.coll.rejectHint', { tn: rejecting.trackingNumber }) : undefined}
        danger
        confirmLabel={t('money.coll.reject')}
        loading={act.isPending}
        onConfirm={(note) => rejecting && act.mutate({ id: rejecting.id, path: 'reject', body: { note } })}
      >
        {rejecting && <Notice tone="warning">{t('money.coll.rejectEffect')} <Amount cents={rejecting.collectedCents} className="font-semibold" /></Notice>}
      </ReasonDialog>
      <BulkConfirmModal open={bulk} onClose={() => setBulk(false)} />
    </div>
  );
}

function BulkConfirmModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [result, setResult] = useState<BulkConfirmResult | null>(null);
  const refs = [...new Set(text.split(/[\s,;]+/).map((r) => r.trim()).filter((r) => r.length >= 2))];
  const m = useMutation({
    mutationFn: () => api<BulkConfirmResult>('/finance/collections/bulk-confirm', { method: 'POST', body: { references: refs.slice(0, 500), bankReference: bankRef.trim() || undefined } }),
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: ['finance', 'collections'] }); toast.success(t('money.coll.bulkDone', { n: num(r.confirmed.length) })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = () => { setText(''); setBankRef(''); setResult(null); onClose(); };
  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={t('money.coll.bulkTitle')}
      description={result ? undefined : t('money.coll.bulkHint')}
      footer={result ? <Button onClick={close}>{t('action.close')}</Button> : <><Button variant="outline" onClick={close}>{t('action.cancel')}</Button><Button loading={m.isPending} disabled={!refs.length} onClick={() => m.mutate()}>{t('money.coll.bulkConfirmN', { n: num(refs.length) })}</Button></>}
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <Notice tone="success">{t('money.coll.bulkDone', { n: num(result.confirmed.length) })}</Notice>
          {result.confirmed.length > 0 && <p className="text-ink-600 dark:text-ink-300"><Ltr className="font-mono">{result.confirmed.map((c) => c.trackingNumber).join(', ')}</Ltr></p>}
          {result.alreadyProcessed.length > 0 && <Notice tone="info">{t('money.coll.bulkAlready', { n: num(result.alreadyProcessed.length) })} <Ltr className="font-mono">{result.alreadyProcessed.map((a) => a.reference).join(', ')}</Ltr></Notice>}
          {result.notFound.length > 0 && <Notice tone="warning">{t('money.coll.bulkNotFound', { n: num(result.notFound.length) })} <Ltr className="font-mono">{result.notFound.join(', ')}</Ltr></Notice>}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('money.coll.bulkRefs')} hint={t('money.coll.bulkRefsHint', { n: num(refs.length) })} required>
            {(id) => <Textarea id={id} rows={8} className="ltr font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={'IPN-778812\nVF-55120\n…'} />}
          </Field>
          <Field label={t('money.coll.bulkBankRef')}>{(id) => <Input id={id} className="ltr font-mono" value={bankRef} onChange={(e) => setBankRef(e.target.value)} maxLength={120} placeholder="CIB-STMT-3110" />}</Field>
        </div>
      )}
    </Modal>
  );
}
