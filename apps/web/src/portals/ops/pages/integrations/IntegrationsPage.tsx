import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Bell, KeyRound, Plug, RefreshCw, RotateCw, Search, Send, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { DeliveryStatus, IntegrationProvider, NotificationChannel, NotificationStatus, WEBHOOK_EVENTS } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, dateTime, num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useDebounced, useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Skeleton, StateBadge, Tabs, type BadgeTone, type Column } from '@/components/ui';
import { Code, FilterBar, FilterField, InfoRow, JsonBlock, Notice, RequirePermission, Section, enumOptions, useBrandOptions, useEnumLabel } from '@/portals/ops/components/opsb';
import type { ApiKeyRow, Connection, WebhookEndpoint } from '../brands/types';
import './i18n';
import '../brands/i18n';

type DeliveryRow = { id: string; event: string; status: string; attempts: number; nextAttemptAt: string; lastResponseCode: number | null; lastError: string | null; deliveredAt: string | null; createdAt: string };
type DeliveryDetail = DeliveryRow & { endpointId: string; payload: unknown; lastResponseBody: string | null };
type NotificationRow = { id: string; channel: string; recipient: string; userId: string | null; orderId: string | null; template: string; locale: string; title: string | null; body: string; data: Record<string, unknown> | null; status: string; provider: string | null; providerMessageId: string | null; error: string | null; attempts: number; sentAt: string | null; readAt: string | null; createdAt: string };

const deliveryTone: Record<string, BadgeTone> = { PENDING: 'warning', SUCCESS: 'success', FAILED: 'danger', DEAD: 'danger' };

export default function IntegrationsPage() {
  return (
    <RequirePermission permission="integrations.manage">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [s, setS] = useQueryState({ tab: 'webhooks' });
  const tabs = [
    { value: 'webhooks', label: t('ops.int.tab.webhooks') },
    ...(can('audit.read') ? [{ value: 'notifications', label: t('ops.int.tab.notifications') }] : []),
    { value: 'connections', label: t('ops.int.tab.connections') },
    { value: 'keys', label: t('ops.int.tab.keys') },
  ];
  return (
    <div>
      <PageHeader title={t('ops.int.title')} subtitle={t('ops.int.subtitle')} />
      <Tabs className="mb-5" value={s.tab} onChange={(v) => setS({ tab: v })} tabs={tabs} />
      {s.tab === 'webhooks' && <Webhooks />}
      {s.tab === 'notifications' && <Notifications />}
      {s.tab === 'connections' && <Connections />}
      {s.tab === 'keys' && <Keys />}
    </div>
  );
}

/* ───────────────────────────── Webhooks ───────────────────────────── */

function Webhooks() {
  const { t } = useI18n();
  const en = useEnumLabel();
  const brands = useBrandOptions();
  const [f, setF] = useQueryState({ tab: 'webhooks', brandId: '', endpoint: '', status: '', event: '', page: '1' });
  const [open, setOpen] = useState<string | null>(null);
  const eps = useQuery({ queryKey: ['int', 'endpoints', f.brandId], queryFn: () => api<Paginated<WebhookEndpoint>>('/webhooks/endpoints', { query: { brandId: f.brandId, pageSize: 100 } }) });
  const selected = eps.data?.data.find((e) => e.id === f.endpoint) ?? null;
  const dl = useQuery({
    queryKey: ['int', 'deliveries', f.endpoint, f.status, f.event, f.page],
    queryFn: () => api<Paginated<DeliveryRow>>(`/webhooks/endpoints/${f.endpoint}/deliveries`, { query: { status: f.status, event: f.event, page: f.page, pageSize: 25 } }),
    enabled: !!f.endpoint,
    placeholderData: keepPreviousData,
  });
  const columns: Column<DeliveryRow>[] = [
    { key: 'date', header: t('common.date'), cell: (d) => <span className="whitespace-nowrap text-sm">{dateTime(d.createdAt)}</span> },
    { key: 'event', header: t('ops.int.wh.event'), cell: (d) => <Code>{d.event}</Code> },
    { key: 'status', header: t('common.status'), cell: (d) => <Badge tone={deliveryTone[d.status] ?? 'neutral'} dot>{en('DeliveryStatus', d.status)}</Badge> },
    { key: 'code', header: t('ops.int.wh.response'), cell: (d) => (d.lastResponseCode ? <Badge tone={d.lastResponseCode < 300 ? 'success' : 'danger'}><span className="ltr">HTTP {d.lastResponseCode}</span></Badge> : <span className="text-xs text-ink-400">{d.lastError ?? '—'}</span>), hideBelow: 'md' },
    { key: 'att', header: t('ops.int.wh.attempts'), align: 'center', cell: (d) => <span className="ltr tabular">{num(d.attempts)}</span>, hideBelow: 'sm' },
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(320px,380px)_1fr]">
      <Section title={t('ops.int.wh.endpoints')} actions={<Select value={f.brandId} onChange={(e) => setF({ brandId: e.target.value, endpoint: '' })} placeholder={t('ops.opsb.allBrands')} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} aria-label={t('common.brand')} className="!w-40" />}>
        {eps.isLoading ? <Skeleton className="h-32" /> : eps.error ? <ErrorState error={eps.error} onRetry={() => eps.refetch()} /> : !eps.data?.data.length ? <EmptyState icon={<Webhook className="h-7 w-7" />} title={t('ops.int.wh.empty')} className="py-8" /> : (
          <ul className="space-y-2">
            {eps.data.data.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setF({ endpoint: e.id })} aria-pressed={f.endpoint === e.id} className={cn('w-full rounded-xl border p-3 text-start transition focus-visible:ring-2 focus-visible:ring-turtle-500', f.endpoint === e.id ? 'border-turtle-400 bg-turtle-50 dark:border-turtle-700 dark:bg-turtle-950/40' : 'border-ink-100 hover:border-turtle-300 dark:border-ink-800')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{e.brandName}</span>
                    <Badge tone={e.isActive ? 'success' : 'neutral'} dot>{e.isActive ? t('state.ACTIVE') : t('ops.int.wh.inactive')}</Badge>
                  </div>
                  <p className="ltr mt-1 truncate text-start font-mono text-xs text-ink-600 dark:text-ink-300">{e.url}</p>
                  <p className="mt-1 text-xs text-ink-400">{t('ops.brands.d.events', { n: num(e.events.length) })}{e.failureCount > 0 && <span className="text-red-600"> · {t('ops.brands.d.failures', { n: num(e.failureCount) })}</span>}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <div className="min-w-0 space-y-4">
        {!selected ? (
          <Card><EmptyState icon={<Webhook className="h-7 w-7" />} title={t('ops.int.wh.pick')} /></Card>
        ) : (
          <>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/ops/brands/${selected.brandId}?tab=integrations`} className="font-semibold hover:underline">{selected.brandName}</Link>
                  <p className="ltr break-all text-start font-mono text-xs text-ink-600 dark:text-ink-300">{selected.url}</p>
                  {selected.description && <p className="mt-1 text-xs text-ink-500">{selected.description}</p>}
                </div>
                <Badge tone={selected.isActive ? 'success' : 'neutral'} dot>{selected.isActive ? t('state.ACTIVE') : t('ops.int.wh.inactive')}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">{selected.events.map((ev) => <Badge key={ev} tone="neutral"><span className="ltr">{ev}</span></Badge>)}</div>
              <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
                <InfoRow label={t('ops.int.wh.secret')} value={<Code>{selected.secretHint}</Code>} />
                <InfoRow label={t('ops.int.wh.failures')} value={num(selected.failureCount)} tone={selected.failureCount ? 'danger' : undefined} />
              </div>
            </Card>
            <FilterBar activeCount={[f.status, f.event].filter(Boolean).length} onClear={() => setF({ status: '', event: '' })} actions={<Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} aria-label={t('action.refresh')} onClick={() => dl.refetch()} />}>
              <FilterField label={t('common.status')}><Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('ops.opsb.allStatuses')} options={enumOptions('DeliveryStatus', Object.values(DeliveryStatus))} aria-label={t('common.status')} /></FilterField>
              <FilterField label={t('ops.int.wh.event')}><Select value={f.event} onChange={(e) => setF({ event: e.target.value })} placeholder={t('ops.int.wh.allEvents')} options={[...WEBHOOK_EVENTS, 'ping'].map((ev) => ({ value: ev, label: ev }))} aria-label={t('ops.int.wh.event')} /></FilterField>
            </FilterBar>
            <DataTable
              columns={columns}
              rows={dl.data?.data}
              rowKey={(d) => d.id}
              loading={dl.isLoading}
              error={dl.error}
              onRetry={() => dl.refetch()}
              onRowClick={(d) => setOpen(d.id)}
              empty={t('ops.int.wh.noDeliveries')}
              dense
              mobileCard={(d) => (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2"><Code>{d.event}</Code>{columns[2].cell(d)}</div>
                  <p className="text-xs text-ink-500">{dateTime(d.createdAt)} · {t('ops.int.wh.attempts')} {num(d.attempts)}</p>
                </div>
              )}
              footer={dl.data && dl.data.meta.totalPages > 1 ? <Pagination page={dl.data.meta.page} totalPages={dl.data.meta.totalPages} total={dl.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
            />
          </>
        )}
      </div>
      <DeliveryDrawer id={open} onClose={() => setOpen(null)} active={!!selected?.isActive} />
    </div>
  );
}

function DeliveryDrawer({ id, onClose, active }: { id: string | null; onClose: () => void; active: boolean }) {
  const { t } = useI18n();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['int', 'delivery', id], queryFn: () => api<DeliveryDetail>(`/webhooks/deliveries/${id}`), enabled: !!id });
  const re = useMutation({
    mutationFn: () => api(`/webhooks/deliveries/${id}/redeliver`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('ops.int.wh.redelivered')); qc.invalidateQueries({ queryKey: ['int', 'deliveries'] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={t('ops.int.wh.details')} width="max-w-2xl" footer={d && d.event !== 'ping' && <Button icon={<RotateCw className="h-4 w-4" />} loading={re.isPending} disabled={!active} onClick={() => re.mutate()}>{t('ops.int.wh.redeliver')}</Button>}>
      {q.isLoading || !d ? <Skeleton className="h-96" /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><Code className="text-sm">{d.event}</Code><Badge tone={deliveryTone[d.status] ?? 'neutral'} dot>{en('DeliveryStatus', d.status)}</Badge>{d.lastResponseCode && <Badge tone={d.lastResponseCode < 300 ? 'success' : 'danger'}><span className="ltr">HTTP {d.lastResponseCode}</span></Badge>}</div>
          <div>
            <InfoRow label={t('ops.opsb.created')} value={dateTime(d.createdAt)} />
            <InfoRow label={t('ops.int.wh.attempts')} value={num(d.attempts)} />
            {d.deliveredAt && <InfoRow label={t('ops.int.n.sentAt')} value={dateTime(d.deliveredAt)} />}
            {(d.status === 'PENDING' || d.status === 'FAILED') && <InfoRow label={t('ops.int.wh.attempts')} value={t('ops.int.wh.nextAttempt', { ago: ago(d.nextAttemptAt) })} />}
          </div>
          {!active && <Notice tone="warning">{t('error.WEBHOOK_DISABLED')}</Notice>}
          {d.lastError && <Notice tone="danger">{d.lastError}</Notice>}
          <div><p className="mb-1.5 text-xs font-semibold uppercase text-ink-400">{t('ops.int.wh.payload')}</p><JsonBlock value={d.payload} maxHeight={360} /></div>
          <div><p className="mb-1.5 text-xs font-semibold uppercase text-ink-400">{t('ops.int.wh.response')}</p>{d.lastResponseBody ? <JsonBlock value={d.lastResponseBody} maxHeight={220} /> : <p className="text-sm text-ink-500">{t('ops.int.wh.noBody')}</p>}</div>
        </div>
      )}
    </Drawer>
  );
}

/* ───────────────────────────── Notifications ───────────────────────────── */

function Notifications() {
  const { t } = useI18n();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const [f, setF] = useQueryState({ tab: 'notifications', q: '', channel: '', status: '', template: '', from: '', to: '', page: '1' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q, 350);
  useEffect(() => {
    if (dq !== f.q) setF({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const [open, setOpen] = useState<NotificationRow | null>(null);
  const [resend, setResend] = useState<NotificationRow | null>(null);
  const list = useQuery({
    queryKey: ['int', 'notifications', f],
    queryFn: () => api<Paginated<NotificationRow>>('/notifications/admin', { query: { q: f.q, channel: f.channel, status: f.status, template: f.template, from: f.from, to: f.to, page: f.page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  const re = useMutation({
    mutationFn: (n: NotificationRow) => api(`/notifications/admin/${n.id}/resend`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('ops.int.n.resent')); setResend(null); setOpen(null); qc.invalidateQueries({ queryKey: ['int', 'notifications'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resendable = (n: NotificationRow) => n.channel !== 'IN_APP' && n.channel !== 'PUSH' && n.status !== 'QUEUED' && !n.data?.sensitive;
  const columns: Column<NotificationRow>[] = [
    { key: 'date', header: t('common.date'), cell: (n) => <span className="whitespace-nowrap text-sm">{dateTime(n.createdAt)}</span> },
    { key: 'ch', header: t('ops.int.n.channel'), cell: (n) => <Badge tone="neutral">{en('NotificationChannel', n.channel)}</Badge> },
    { key: 'to', header: t('ops.int.n.recipient'), cell: (n) => <span className="ltr block max-w-[180px] truncate text-start text-xs">{n.recipient}</span>, hideBelow: 'md' },
    { key: 'tpl', header: t('ops.int.n.template'), cell: (n) => <div className="min-w-[160px]"><Code>{n.template}</Code>{n.title && <p className="line-clamp-1 text-xs text-ink-500">{n.title}</p>}</div> },
    { key: 'status', header: t('common.status'), cell: (n) => <StateBadge value={n.status} /> },
    { key: 'act', header: '', align: 'end', cell: (n) => (resendable(n) ? <Button size="xs" variant="ghost" icon={<Send className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setResend(n); }}>{t('ops.int.n.resend')}</Button> : null) },
  ];
  return (
    <>
      <FilterBar
        search={<Input type="search" leading={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ops.int.n.search')} aria-label={t('action.search')} />}
        activeCount={[f.channel, f.status, f.template, f.from, f.to].filter(Boolean).length}
        onClear={() => setF({ channel: '', status: '', template: '', from: '', to: '' })}
      >
        <FilterField label={t('ops.int.n.channel')}><Select value={f.channel} onChange={(e) => setF({ channel: e.target.value })} placeholder={t('ops.int.n.allChannels')} options={enumOptions('NotificationChannel', Object.values(NotificationChannel))} aria-label={t('ops.int.n.channel')} /></FilterField>
        <FilterField label={t('common.status')}><Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('ops.opsb.allStatuses')} options={Object.values(NotificationStatus).map((s) => ({ value: s, label: t(`state.${s}`) }))} aria-label={t('common.status')} /></FilterField>
        <FilterField label={t('ops.int.n.template')}><Input value={f.template} onChange={(e) => setF({ template: e.target.value })} placeholder={t('ops.int.n.template')} aria-label={t('ops.int.n.template')} className="md:!w-40" dir="ltr" /></FilterField>
        <FilterField label={t('common.from')}><Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} aria-label={t('common.from')} className="md:!w-40" /></FilterField>
        <FilterField label={t('common.to')}><Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} aria-label={t('common.to')} className="md:!w-40" /></FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(n) => n.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(n) => setOpen(n)}
        empty={<EmptyState icon={<Bell className="h-7 w-7" />} title={t('ops.int.n.empty')} />}
        mobileCard={(n) => (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2"><Badge tone="neutral">{en('NotificationChannel', n.channel)}</Badge><StateBadge value={n.status} /></div>
            <p className="text-sm font-medium">{n.title ?? n.template}</p>
            <p className="ltr truncate text-start text-xs text-ink-500">{n.recipient}</p>
            <p className="text-xs text-ink-400">{dateTime(n.createdAt)}</p>
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.title ?? open?.template} width="max-w-lg" footer={open && resendable(open) && <Button icon={<Send className="h-4 w-4" />} onClick={() => setResend(open)}>{t('ops.int.n.resend')}</Button>}>
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2"><Badge tone="neutral">{en('NotificationChannel', open.channel)}</Badge><StateBadge value={open.status} /><Code>{open.template}</Code></div>
            <div>
              <InfoRow label={t('ops.int.n.recipient')} value={<span className="ltr break-all">{open.recipient}</span>} />
              <InfoRow label={t('ops.opsb.created')} value={dateTime(open.createdAt)} />
              <InfoRow label={t('ops.int.n.sentAt')} value={dateTime(open.sentAt)} />
              <InfoRow label={t('ops.int.n.provider')} value={open.provider ?? '—'} />
              <InfoRow label={t('ops.int.wh.attempts')} value={num(open.attempts)} />
              {open.orderId && <InfoRow label={t('ops.int.n.order')} value={<Link className="text-turtle-700 hover:underline dark:text-turtle-400" to={`/ops/orders/${open.orderId}`}>{t('action.view')}</Link>} />}
            </div>
            {open.error && <Notice tone="danger">{t('ops.int.n.error')}: {open.error}</Notice>}
            {open.data?.sensitive ? <Notice tone="info">{t('ops.int.n.masked')}</Notice> : null}
            <div className="whitespace-pre-wrap rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-800/50" dir="auto">{open.body}</div>
            {open.data && <div><p className="mb-1.5 text-xs font-semibold uppercase text-ink-400">{t('ops.int.n.data')}</p><JsonBlock value={open.data} maxHeight={200} /></div>}
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={!!resend} onClose={() => setResend(null)} onConfirm={() => resend && re.mutate(resend)} loading={re.isPending} title={t('ops.int.n.resendTitle')} description={resend ? t('ops.int.n.resendDesc', { to: resend.recipient }) : undefined} confirmLabel={t('ops.int.n.resend')} />
    </>
  );
}

/* ───────────────────────────── Connections ───────────────────────────── */

function Connections() {
  const { t } = useI18n();
  const en = useEnumLabel();
  const brands = useBrandOptions();
  const [f, setF] = useQueryState({ tab: 'connections', brandId: '', provider: '', status: '' });
  const q = useQuery({ queryKey: ['int', 'connections', f], queryFn: () => api<Paginated<Connection>>('/integrations', { query: { brandId: f.brandId, provider: f.provider, status: f.status, pageSize: 100 } }) });
  const test = useMutation({
    mutationFn: (c: Connection) => api<{ ok?: boolean; message?: string }>(`/integrations/${c.id}/test`, { method: 'POST' }),
    onSuccess: (r) => (r?.ok === false ? toast.error(r.message ?? t('error.generic')) : toast.success(r?.message ?? t('ops.int.c.tested'))),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: Column<Connection>[] = [
    { key: 'brand', header: t('common.brand'), cell: (c) => <Link to={`/ops/brands/${c.brandId}?tab=integrations`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{c.brandName}</Link> },
    { key: 'prov', header: t('ops.int.c.provider'), cell: (c) => <div><p className="text-sm font-medium">{en('IntegrationProvider', c.provider)}</p><p className="ltr text-start text-xs text-ink-500">{c.shopDomain ?? '—'}</p></div> },
    { key: 'status', header: t('common.status'), cell: (c) => <StateBadge value={c.status} /> },
    { key: 'sync', header: t('ops.int.c.lastSync'), cell: (c) => <span className="text-sm">{c.lastSyncAt ? ago(c.lastSyncAt) : t('ops.int.c.never')}</span>, hideBelow: 'md' },
    { key: 'err', header: t('ops.int.n.error'), cell: (c) => <span className="line-clamp-2 max-w-xs text-xs text-ink-500">{c.lastError ?? '—'}</span>, hideBelow: 'lg' },
    { key: 'act', header: '', align: 'end', cell: (c) => <Button size="xs" variant="outline" icon={<Plug className="h-3.5 w-3.5" />} loading={test.isPending && test.variables?.id === c.id} onClick={() => test.mutate(c)}>{t('ops.int.c.test')}</Button> },
  ];
  return (
    <>
      <FilterBar activeCount={[f.brandId, f.provider, f.status].filter(Boolean).length} onClear={() => setF({ brandId: '', provider: '', status: '' })}>
        <FilterField label={t('common.brand')}><Select value={f.brandId} onChange={(e) => setF({ brandId: e.target.value })} placeholder={t('ops.opsb.allBrands')} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} aria-label={t('common.brand')} /></FilterField>
        <FilterField label={t('ops.int.c.provider')}><Select value={f.provider} onChange={(e) => setF({ provider: e.target.value })} placeholder={t('ops.int.c.allProviders')} options={enumOptions('IntegrationProvider', Object.values(IntegrationProvider))} aria-label={t('ops.int.c.provider')} /></FilterField>
        <FilterField label={t('common.status')}><Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('ops.opsb.allStatuses')} options={['ACTIVE', 'PAUSED', 'ERROR'].map((s) => ({ value: s, label: t(`state.${s}`) }))} aria-label={t('common.status')} /></FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(c) => c.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState icon={<Plug className="h-7 w-7" />} title={t('ops.int.c.empty')} />}
        mobileCard={(c) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{c.brandName}</span><StateBadge value={c.status} /></div>
            <p className="text-sm">{en('IntegrationProvider', c.provider)} <span className="ltr text-xs text-ink-500">{c.shopDomain}</span></p>
            {c.lastError && <p className="text-xs text-ink-500">{c.lastError}</p>}
            {columns[5].cell(c)}
          </div>
        )}
      />
    </>
  );
}

/* ───────────────────────────── API keys ───────────────────────────── */

function Keys() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const brands = useBrandOptions();
  const [f, setF] = useQueryState({ tab: 'keys', brandId: '', revoked: '' });
  const [revoke, setRevoke] = useState<ApiKeyRow | null>(null);
  const q = useQuery({ queryKey: ['int', 'keys', f], queryFn: () => api<Paginated<ApiKeyRow>>('/api-keys', { query: { brandId: f.brandId, includeRevoked: f.revoked ? 'true' : undefined, pageSize: 100 } }) });
  const rev = useMutation({
    mutationFn: (k: ApiKeyRow) => api(`/api-keys/${k.id}/revoke`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('ops.brands.d.revoked')); setRevoke(null); qc.invalidateQueries({ queryKey: ['int', 'keys'] }); qc.invalidateQueries({ queryKey: ['brands', 'keys'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: Column<ApiKeyRow>[] = [
    { key: 'name', header: t('common.name'), cell: (k) => <div><p className="font-medium">{k.name}</p><Code>{k.prefix}…</Code></div> },
    { key: 'brand', header: t('common.brand'), cell: (k) => <Link to={`/ops/brands/${k.brandId}?tab=integrations`} className="hover:underline">{k.brandName}</Link> },
    { key: 'scopes', header: t('ops.int.k.scopes'), cell: (k) => <div className="flex max-w-xs flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} tone="neutral"><span className="ltr">{s}</span></Badge>)}</div>, hideBelow: 'lg' },
    { key: 'used', header: t('ops.int.k.lastUsed'), cell: (k) => <span className="text-sm">{k.lastUsedAt ? ago(k.lastUsedAt) : t('ops.brands.d.neverUsed')}</span>, hideBelow: 'md' },
    { key: 'status', header: t('common.status'), cell: (k) => <Badge tone={k.active ? 'success' : 'neutral'} dot>{k.active ? t('state.ACTIVE') : t('ops.int.k.revoked')}</Badge> },
    { key: 'act', header: '', align: 'end', cell: (k) => (k.active ? <Button size="xs" variant="ghost" icon={<Ban className="h-3.5 w-3.5 text-red-500" />} onClick={() => setRevoke(k)}>{t('ops.brands.d.revoke')}</Button> : null) },
  ];
  return (
    <>
      <FilterBar activeCount={[f.brandId, f.revoked].filter(Boolean).length} onClear={() => setF({ brandId: '', revoked: '' })}>
        <FilterField label={t('common.brand')}><Select value={f.brandId} onChange={(e) => setF({ brandId: e.target.value })} placeholder={t('ops.opsb.allBrands')} options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name }))} aria-label={t('common.brand')} /></FilterField>
        <Checkbox label={t('ops.int.k.includeRevoked')} checked={!!f.revoked} onChange={(e) => setF({ revoked: e.target.checked ? '1' : '' })} />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(k) => k.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState icon={<KeyRound className="h-7 w-7" />} title={t('ops.int.k.empty')} />}
        mobileCard={(k) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{k.name}</span>{columns[4].cell(k)}</div>
            <p className="text-xs text-ink-500">{k.brandName} · <Code>{k.prefix}…</Code></p>
            {columns[5].cell(k)}
          </div>
        )}
      />
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(null)} onConfirm={() => revoke && rev.mutate(revoke)} danger loading={rev.isPending} title={revoke ? t('ops.brands.d.revokeTitle', { name: revoke.name }) : ''} description={t('ops.brands.d.revokeDesc')} confirmLabel={t('ops.brands.d.revoke')} />
    </>
  );
}
