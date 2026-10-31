import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BookOpen, CheckCircle2, Eye, History, KeyRound, Pause, Pencil, Play, Plug, Plus, RefreshCw, Send, ShoppingBag, Store, Trash2, Webhook, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/lib/hooks';
import { ago, dateTime, num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, StateBadge, Switch, Tabs, type Column,
} from '@/components/ui';
import { CopyButton, SectionTitle, useLocations } from '../components/common';
import { CodeBlock, LangTabs, SecretBox, snippets } from '../components/devtools';
import type { ApiKey, Integration, WebhookDelivery, WebhookEndpoint } from '../components/types';
import './i18n';

type Tab = 'keys' | 'webhooks' | 'stores' | 'docs';

export default function DevelopersPage() {
  const { t } = useI18n();
  const [f, setF] = useQueryState({ tab: 'keys' });
  const tab = (['keys', 'webhooks', 'stores', 'docs'].includes(f.tab) ? f.tab : 'keys') as Tab;
  return (
    <div>
      <PageHeader title={t('brand.nav.developers')} subtitle={t('brand.dev.subtitle')} />
      <Tabs
        value={tab}
        onChange={(v) => setF({ tab: v })}
        className="mb-6"
        tabs={[
          { value: 'keys', label: t('brand.dev.tab.keys') },
          { value: 'webhooks', label: t('brand.dev.tab.webhooks') },
          { value: 'stores', label: t('brand.dev.tab.stores') },
          { value: 'docs', label: t('brand.dev.tab.docs') },
        ]}
      />
      {tab === 'keys' && <ApiKeys />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'stores' && <Stores />}
      {tab === 'docs' && <QuickStart />}
    </div>
  );
}

// =================================================================== API keys

function ApiKeys() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [showRevoked, setShowRevoked] = useState(false);
  const q = useQuery({ queryKey: ['api-keys', showRevoked], queryFn: () => api<Paginated<ApiKey>>('/api-keys', { query: { includeRevoked: showRevoked, pageSize: 100 } }) });
  const [creating, setCreating] = useState(false);
  const [revoke, setRevoke] = useState<ApiKey | null>(null);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const rev = useMutation({
    mutationFn: (k: ApiKey) => api(`/api-keys/${k.id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(t('brand.dev.keyRevoked'));
      setRevoke(null);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const columns: Column<ApiKey>[] = [
    { key: 'name', header: t('common.name'), cell: (k) => <div><p className="font-medium text-ink-900 dark:text-white">{k.name}</p><p className="ltr font-mono text-xs text-ink-500">{k.prefix}…</p></div> },
    { key: 'scopes', header: t('brand.dev.scopes'), hideBelow: 'md', cell: (k) => <div className="flex max-w-[320px] flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} className="font-mono">{s === '*' ? t('brand.dev.fullAccess') : s}</Badge>)}</div> },
    { key: 'used', header: t('brand.dev.lastUsed'), hideBelow: 'lg', cell: (k) => <span className="text-xs text-ink-500">{k.lastUsedAt ? ago(k.lastUsedAt) : t('brand.common.never')}</span> },
    { key: 'created', header: t('brand.common.created'), hideBelow: 'lg', cell: (k) => <span className="text-xs text-ink-500">{dateTime(k.createdAt)}{k.createdByName ? ` · ${k.createdByName}` : ''}</span> },
    { key: 'status', header: t('common.status'), cell: (k) => (k.active ? <Badge tone="success" dot>{t('state.ACTIVE')}</Badge> : <Badge dot>{t('brand.dev.revoked')}</Badge>) },
    { key: 'a', header: '', align: 'end', cell: (k) => (k.active ? <Button size="xs" variant="ghost" className="text-red-600" onClick={() => setRevoke(k)}>{t('brand.dev.revoke')}</Button> : null) },
  ];
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle icon={<KeyRound />} title={t('brand.dev.keysTitle')} subtitle={t('brand.dev.keysHint')} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>{t('brand.dev.newKey')}</Button>} />
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="text-ink-500">{t('brand.dev.baseUrl')}: <code className="ltr rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-800 dark:bg-ink-800 dark:text-ink-100">{window.location.origin}/api/v1</code></p>
          <Switch checked={showRevoked} onChange={setShowRevoked} label={t('brand.dev.showRevoked')} />
        </div>
      </Card>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(k) => k.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState icon={<KeyRound className="h-7 w-7" />} title={t('brand.dev.noKeys')} description={t('brand.dev.noKeysHint')} action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>{t('brand.dev.newKey')}</Button>} />}
        mobileCard={(k) => (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{k.name}</p>
              <p className="ltr font-mono text-xs text-ink-500">{k.prefix}…</p>
              <p className="mt-1 text-xs text-ink-500">{k.scopes.includes('*') ? t('brand.dev.fullAccess') : t('brand.dev.nScopes', { n: num(k.scopes.length) })} · {k.lastUsedAt ? ago(k.lastUsedAt) : t('brand.common.never')}</p>
            </div>
            {columns[5].cell(k) ?? columns[4].cell(k)}
          </div>
        )}
      />
      <CreateKeyModal open={creating} onClose={() => setCreating(false)} onCreated={setCreated} />
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(null)} onConfirm={() => revoke && rev.mutate(revoke)} loading={rev.isPending} danger title={t('brand.dev.revokeTitle', { name: revoke?.name ?? '' })} description={t('brand.dev.revokeBody')} confirmLabel={t('brand.dev.revoke')} />
      <Modal open={!!created} onClose={() => setCreated(null)} title={t('brand.dev.keyCreated')} footer={<Button onClick={() => setCreated(null)}>{t('brand.team.savedIt')}</Button>}>
        {created && (
          <div className="space-y-4">
            <SecretBox value={created.key} label={created.name} />
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('brand.dev.keyOnce')}</p>
            <CodeBlock lang="bash" code={`curl ${window.location.origin}/api/v1/orders?pageSize=1 \\\n  -H "X-Api-Key: ${created.key}"`} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateKeyModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: { name: string; key: string }) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const scopes = useQuery({ queryKey: ['api-keys', 'scopes'], queryFn: () => api<{ scopes: string[] }>('/api-keys/scopes'), enabled: open, staleTime: Infinity });
  const [name, setName] = useState('');
  const [full, setFull] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set(['orders.read', 'orders.create']));
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setName('');
      setFull(false);
      setSel(new Set(['orders.read', 'orders.create']));
      setTouched(false);
    }
  }, [open]);
  const m = useMutation({
    mutationFn: () => api<ApiKey & { key: string }>('/api-keys', { method: 'POST', body: { name: name.trim(), scopes: full ? ['*'] : [...sel] } }),
    onSuccess: (k) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      onClose();
      onCreated({ name: k.name, key: k.key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = name.trim().length >= 2 && (full || sel.size > 0);
  const groups = (scopes.data?.scopes ?? []).reduce<Record<string, string[]>>((acc, s) => {
    const g = s.split('.')[0];
    (acc[g] ??= []).push(s);
    return acc;
  }, {});
  return (
    <Modal open={open} onClose={onClose} title={t('brand.dev.newKey')} description={t('brand.dev.newKeyHint')} footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => { setTouched(true); if (valid) m.mutate(); }}>{t('brand.dev.createKey')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('common.name')} required error={touched && name.trim().length < 2 ? t('brand.dev.errName') : undefined}>{(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t('brand.dev.keyNamePh')} />}</Field>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-700 dark:text-ink-200">{t('brand.dev.scopes')}</p>
          <Switch checked={full} onChange={setFull} label={t('brand.dev.fullAccessHint')} />
          {!full && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {scopes.isLoading ? <Skeleton className="h-24 w-full" /> : Object.entries(groups).map(([g, list]) => (
                <fieldset key={g} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t(`brand.dev.scopeGroup.${g}`)}</legend>
                  <div className="space-y-1.5">
                    {list.map((s) => (
                      <Checkbox key={s} label={<span className="font-mono text-xs">{s}</span>} checked={sel.has(s)} onChange={() => setSel((x) => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n; })} />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
          {touched && !full && sel.size === 0 && <p className="mt-2 text-xs font-medium text-red-600">{t('brand.dev.errScopes')}</p>}
        </div>
      </div>
    </Modal>
  );
}

// =================================================================== Webhooks

function Webhooks() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['webhooks', 'endpoints'], queryFn: () => api<Paginated<WebhookEndpoint>>('/webhooks/endpoints', { query: { pageSize: 50 } }) });
  const [editing, setEditing] = useState<WebhookEndpoint | 'new' | null>(null);
  const [secret, setSecret] = useState<{ title: string; secret: string } | null>(null);
  const [del, setDel] = useState<WebhookEndpoint | null>(null);
  const [rotate, setRotate] = useState<WebhookEndpoint | null>(null);
  const [logs, setLogs] = useState<WebhookEndpoint | null>(null);
  const [ping, setPing] = useState<{ ok: boolean; statusCode: number | null; durationMs: number; responseBody: string | null; error: string | null } | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['webhooks'] });

  const reveal = useMutation({ mutationFn: (e: WebhookEndpoint) => api<{ secret: string }>(`/webhooks/endpoints/${e.id}/reveal-secret`, { method: 'POST' }), onSuccess: (r) => setSecret({ title: t('brand.dev.signingSecret'), secret: r.secret }), onError: (e) => toast.error(errorMessage(e)) });
  const rot = useMutation({
    mutationFn: (e: WebhookEndpoint) => api<{ secret: string }>(`/webhooks/endpoints/${e.id}/rotate-secret`, { method: 'POST' }),
    onSuccess: (r) => { setRotate(null); inv(); setSecret({ title: t('brand.dev.newSecret'), secret: r.secret }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (e: WebhookEndpoint) => api(`/webhooks/endpoints/${e.id}`, { method: 'DELETE' }), onSuccess: () => { setDel(null); inv(); toast.success(t('brand.dev.endpointDeleted')); }, onError: (e) => toast.error(errorMessage(e)) });
  const toggle = useMutation({ mutationFn: (e: WebhookEndpoint) => api(`/webhooks/endpoints/${e.id}`, { method: 'PATCH', body: { isActive: !e.isActive } }), onSuccess: inv, onError: (e) => toast.error(errorMessage(e)) });
  const test = useMutation({ mutationFn: (e: WebhookEndpoint) => api<NonNullable<typeof ping>>(`/webhooks/endpoints/${e.id}/test`, { method: 'POST' }), onSuccess: (r) => { setPing(r); inv(); }, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle icon={<Webhook />} title={t('brand.dev.webhooksTitle')} subtitle={t('brand.dev.webhooksHint')} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('brand.dev.addEndpoint')}</Button>} />
      </Card>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : !q.data?.data.length ? (
        <Card><EmptyState icon={<Webhook className="h-7 w-7" />} title={t('brand.dev.noEndpoints')} description={t('brand.dev.noEndpointsHint')} action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>{t('brand.dev.addEndpoint')}</Button>} /></Card>
      ) : (
        q.data.data.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="ltr min-w-0 break-all font-mono text-sm font-semibold text-ink-900 dark:text-white">{e.url}</code>
                  {e.isActive ? <Badge tone="success" dot>{t('state.ACTIVE')}</Badge> : <Badge tone="warning" dot>{t('state.PAUSED')}</Badge>}
                  {e.failureCount > 0 && <Badge tone="danger">{t('brand.dev.failures', { n: num(e.failureCount) })}</Badge>}
                </div>
                {e.description && <p className="mt-1 text-sm text-ink-500">{e.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1">{e.events.map((ev) => <Badge key={ev} className="font-mono">{ev === '*' ? t('brand.dev.allEvents') : ev}</Badge>)}</div>
                <p className="mt-3 text-xs text-ink-500">{t('brand.dev.secretHint')}: <span className="ltr font-mono">{e.secretHint}</span> · {t('brand.common.created')} {ago(e.createdAt)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Switch checked={e.isActive} onChange={() => toggle.mutate(e)} label={t('brand.dev.enabled')} disabled={toggle.isPending} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
              <Button size="sm" variant="outline" icon={<Send className="h-3.5 w-3.5" />} loading={test.isPending && test.variables?.id === e.id} onClick={() => test.mutate(e)}>{t('brand.dev.sendTest')}</Button>
              <Button size="sm" variant="outline" icon={<History className="h-3.5 w-3.5" />} onClick={() => setLogs(e)}>{t('brand.dev.deliveries')}</Button>
              <Button size="sm" variant="outline" icon={<Eye className="h-3.5 w-3.5" />} loading={reveal.isPending && reveal.variables?.id === e.id} onClick={() => reveal.mutate(e)}>{t('brand.dev.revealSecret')}</Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRotate(e)}>{t('brand.dev.rotateSecret')}</Button>
              <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(e)}>{t('action.edit')}</Button>
              <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel(e)}>{t('action.delete')}</Button>
            </div>
          </Card>
        ))
      )}
      <EndpointModal endpoint={editing} onClose={() => setEditing(null)} onCreated={(s) => setSecret({ title: t('brand.dev.signingSecret'), secret: s })} />
      <Modal open={!!secret} onClose={() => setSecret(null)} title={secret?.title} footer={<Button onClick={() => setSecret(null)}>{t('action.close')}</Button>}>
        {secret && <div className="space-y-3"><SecretBox value={secret.secret} /><p className="text-sm text-ink-500">{t('brand.dev.secretUse')}</p></div>}
      </Modal>
      <Modal open={!!ping} onClose={() => setPing(null)} title={t('brand.dev.testResult')} footer={<Button onClick={() => setPing(null)}>{t('action.close')}</Button>}>
        {ping && (
          <div className="space-y-3">
            <div className={cn('flex items-center gap-3 rounded-xl px-4 py-3', ping.ok ? 'bg-turtle-50 text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200' : 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-200')}>
              {ping.ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              <div>
                <p className="font-semibold">{ping.ok ? t('brand.dev.testOk') : t('brand.dev.testFail')}</p>
                <p className="ltr text-xs">HTTP {ping.statusCode ?? '—'} · {num(ping.durationMs)} ms</p>
              </div>
            </div>
            {ping.error && <p className="text-sm text-red-600">{ping.error}</p>}
            {ping.responseBody && <CodeBlock code={ping.responseBody} lang="response" />}
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!rotate} onClose={() => setRotate(null)} onConfirm={() => rotate && rot.mutate(rotate)} loading={rot.isPending} danger title={t('brand.dev.rotateTitle')} description={t('brand.dev.rotateBody')} confirmLabel={t('brand.dev.rotateSecret')} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} danger title={t('brand.dev.deleteEndpoint')} description={<span className="ltr break-all">{del?.url}</span>} confirmLabel={t('action.delete')} />
      <DeliveriesDrawer endpoint={logs} onClose={() => setLogs(null)} />
    </div>
  );
}

function EndpointModal({ endpoint, onClose, onCreated }: { endpoint: WebhookEndpoint | 'new' | null; onClose: () => void; onCreated: (secret: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const isNew = endpoint === 'new';
  const events = useQuery({ queryKey: ['webhooks', 'events'], queryFn: () => api<{ events: string[] }>('/webhooks/events'), enabled: !!endpoint, staleTime: Infinity });
  const [f, setF] = useState({ url: '', description: '', events: new Set<string>(['order.delivered', 'order.failed_attempt', 'order.returned']), all: false, isActive: true });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!endpoint) return;
    setTouched(false);
    if (endpoint === 'new') setF({ url: 'https://', description: '', events: new Set(['order.delivered', 'order.failed_attempt', 'order.returned']), all: false, isActive: true });
    else setF({ url: endpoint.url, description: endpoint.description ?? '', events: new Set(endpoint.events.filter((e) => e !== '*')), all: endpoint.events.includes('*'), isActive: endpoint.isActive });
  }, [endpoint]);
  const urlOk = /^https?:\/\/[^\s/]+\.[^\s]+/.test(f.url.trim());
  const valid = urlOk && (f.all || f.events.size > 0);
  const m = useMutation({
    mutationFn: () => {
      const body = { url: f.url.trim(), description: f.description.trim() || (isNew ? undefined : null), events: f.all ? ['*'] : [...f.events], isActive: f.isActive };
      return isNew ? api<WebhookEndpoint & { secret: string }>('/webhooks/endpoints', { method: 'POST', body }) : api<WebhookEndpoint>(`/webhooks/endpoints/${(endpoint as WebhookEndpoint).id}`, { method: 'PATCH', body });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      onClose();
      const created = r as WebhookEndpoint & { secret?: string };
      if (isNew && created.secret) onCreated(created.secret);
      else toast.success(t('brand.common.saved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={!!endpoint} onClose={onClose} size="lg" title={isNew ? t('brand.dev.addEndpoint') : t('brand.dev.editEndpoint')} footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => { setTouched(true); if (valid) m.mutate(); }}>{t('action.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('brand.dev.endpointUrl')} required error={touched && !urlOk ? t('brand.dev.errUrl') : undefined} hint={t('brand.dev.urlHint')}>{(id) => <Input id={id} dir="ltr" type="url" className="font-mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />}</Field>
        <Field label={t('brand.dev.description')} hint={t('brand.common.optional')}>{(id) => <Input id={id} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="ERP sync" />}</Field>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{t('brand.dev.events')}</p>
            <Switch checked={f.all} onChange={(v) => setF({ ...f, all: v })} label={t('brand.dev.allEvents')} />
          </div>
          {!f.all && (
            <div className="grid gap-2 rounded-xl border border-ink-100 p-3 dark:border-ink-800 sm:grid-cols-2">
              {(events.data?.events ?? []).map((ev) => (
                <label key={ev} className="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-ink-50 dark:hover:bg-ink-800/50">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300 text-turtle-600" checked={f.events.has(ev)} onChange={() => setF((s) => { const n = new Set(s.events); if (n.has(ev)) n.delete(ev); else n.add(ev); return { ...s, events: n }; })} />
                  <span><span className="block font-mono text-xs text-ink-900 dark:text-ink-100">{ev}</span><span className="text-xs text-ink-500">{t(`brand.dev.event.${ev}`)}</span></span>
                </label>
              ))}
            </div>
          )}
          {touched && !f.all && f.events.size === 0 && <p className="mt-2 text-xs font-medium text-red-600">{t('brand.dev.errEvents')}</p>}
        </div>
        <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label={t('brand.dev.enabled')} />
      </div>
    </Modal>
  );
}

const DELIVERY_TONE = { PENDING: 'info', SUCCESS: 'success', FAILED: 'warning', DEAD: 'danger' } as const;

function DeliveriesDrawer({ endpoint, onClose }: { endpoint: WebhookEndpoint | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<string | null>(null);
  useEffect(() => { setStatus(''); setPage(1); }, [endpoint]);
  const q = useQuery({
    queryKey: ['webhooks', 'deliveries', endpoint?.id, status, page],
    queryFn: () => api<Paginated<WebhookDelivery>>(`/webhooks/endpoints/${endpoint!.id}/deliveries`, { query: { status: status || undefined, page, pageSize: 20 } }),
    enabled: !!endpoint,
    placeholderData: keepPreviousData,
  });
  const detail = useQuery({ queryKey: ['webhooks', 'delivery', view], queryFn: () => api<WebhookDelivery>(`/webhooks/deliveries/${view}`), enabled: !!view });
  const redeliver = useMutation({
    mutationFn: (id: string) => api<WebhookDelivery>(`/webhooks/deliveries/${id}/redeliver`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('brand.dev.redelivered')); setView(null); qc.invalidateQueries({ queryKey: ['webhooks', 'deliveries'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Drawer open={!!endpoint} onClose={onClose} title={t('brand.dev.deliveries')} width="max-w-2xl">
      <p className="ltr mb-3 break-all font-mono text-xs text-ink-500">{endpoint?.url}</p>
      <Select className="mb-3 max-w-[220px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder={t('brand.orders.anyStatus')} aria-label={t('common.status')} options={['SUCCESS', 'PENDING', 'FAILED', 'DEAD'].map((s) => ({ value: s, label: t(`brand.dev.dstatus.${s}`) }))} />
      {q.isLoading ? <Skeleton className="h-60 w-full" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? (
        <EmptyState icon={<History className="h-7 w-7" />} title={t('brand.dev.noDeliveries')} description={t('brand.dev.noDeliveriesHint')} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink-100 dark:border-ink-800">
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {q.data.data.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => setView(d.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-ink-50 dark:hover:bg-ink-800/50">
                  <StateBadge value={d.status} map={DELIVERY_TONE} label={t(`brand.dev.dstatus.${d.status}`)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-ink-900 dark:text-ink-100">{d.event}</span>
                    <span className="text-[11px] text-ink-500">{dateTime(d.createdAt)} · {t('brand.dev.attemptsN', { n: num(d.attempts) })}</span>
                  </span>
                  <span className="ltr font-mono text-xs text-ink-500">{d.lastResponseCode ?? '—'}</span>
                </button>
              </li>
            ))}
          </ul>
          {q.data.meta.totalPages > 1 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
        </div>
      )}
      <Modal open={!!view} onClose={() => setView(null)} size="lg" title={detail.data ? <span className="font-mono">{detail.data.event}</span> : t('brand.dev.payload')}
        footer={<><Button variant="outline" onClick={() => setView(null)}>{t('action.close')}</Button>{detail.data && detail.data.event !== 'ping' && <Button icon={<RefreshCw className="h-4 w-4" />} loading={redeliver.isPending} disabled={!endpoint?.isActive} title={endpoint?.isActive ? undefined : t('brand.dev.enableFirst')} onClick={() => redeliver.mutate(detail.data!.id)}>{t('brand.dev.redeliver')}</Button>}</>}>
        {detail.isLoading ? <Skeleton className="h-60 w-full" /> : detail.data ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
              <StateBadge value={detail.data.status} map={DELIVERY_TONE} label={t(`brand.dev.dstatus.${detail.data.status}`)} />
              <span className="ltr">HTTP {detail.data.lastResponseCode ?? '—'}</span>
              <span>{t('brand.dev.attemptsN', { n: num(detail.data.attempts) })}</span>
              {detail.data.deliveredAt && <span>{dateTime(detail.data.deliveredAt)}</span>}
              {detail.data.nextAttemptAt && detail.data.status !== 'SUCCESS' && <span>{t('brand.dev.nextRetry')} {dateTime(detail.data.nextAttemptAt)}</span>}
            </div>
            {detail.data.lastError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300">{detail.data.lastError}</p>}
            <CodeBlock lang="payload" code={JSON.stringify(detail.data.payload, null, 2)} />
            {detail.data.lastResponseBody && <CodeBlock lang="response" code={detail.data.lastResponseBody} />}
          </div>
        ) : null}
      </Modal>
    </Drawer>
  );
}

// =================================================================== Store integrations

const PROVIDERS = {
  SHOPIFY: { label: 'Shopify', color: 'bg-[#95BF47]', icon: <ShoppingBag className="h-5 w-5" /> },
  WOOCOMMERCE: { label: 'WooCommerce', color: 'bg-[#7F54B3]', icon: <Store className="h-5 w-5" /> },
} as const;

function Stores() {
  const { t } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const isOwner = me?.role === 'BRAND_OWNER';
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api<Paginated<Integration>>('/integrations', { query: { pageSize: 50 } }) });
  const [connect, setConnect] = useState(false);
  const [edit, setEdit] = useState<Integration | null>(null);
  const [setup, setSetup] = useState<Integration | null>(null);
  const [del, setDel] = useState<Integration | null>(null);
  const [rotate, setRotate] = useState<Integration | null>(null);
  const [testRes, setTestRes] = useState<{ ok: boolean; message: string } | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const pause = useMutation({ mutationFn: (c: Integration) => api(`/integrations/${c.id}`, { method: 'PATCH', body: { status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } }), onSuccess: inv, onError: (e) => toast.error(errorMessage(e)) });
  const test = useMutation({ mutationFn: (c: Integration) => api<{ ok: boolean; message: string }>(`/integrations/${c.id}/test`, { method: 'POST' }), onSuccess: (r) => { setTestRes(r); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (c: Integration) => api(`/integrations/${c.id}`, { method: 'DELETE' }), onSuccess: () => { setDel(null); inv(); toast.success(t('brand.dev.storeRemoved')); }, onError: (e) => toast.error(errorMessage(e)) });
  const rot = useMutation({
    mutationFn: (c: Integration) => api<{ inboundSecret: string }>(`/integrations/${c.id}/rotate-secret`, { method: 'POST' }),
    onSuccess: (r, c) => { setRotate(null); inv(); setSetup({ ...c, inboundSecret: r.inboundSecret }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const openSetup = async (c: Integration) => {
    try {
      setSetup(await api<Integration>(`/integrations/${c.id}`));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle icon={<Plug />} title={t('brand.dev.storesTitle')} subtitle={t('brand.dev.storesHint')} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setConnect(true)}>{t('brand.dev.connectStore')}</Button>} />
      </Card>
      {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data?.data.length ? (
        <Card><EmptyState icon={<Store className="h-7 w-7" />} title={t('brand.dev.noStores')} description={t('brand.dev.noStoresHint')} action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setConnect(true)}>{t('brand.dev.connectStore')}</Button>} /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {q.data.data.map((c) => (
            <Card key={c.id}>
              <div className="flex items-start gap-3">
                <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white', PROVIDERS[c.provider].color)}>{PROVIDERS[c.provider].icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-900 dark:text-white">{PROVIDERS[c.provider].label}</p>
                    <StateBadge value={c.status} />
                  </div>
                  <p className="ltr truncate text-start font-mono text-sm text-ink-500">{c.shopDomain}</p>
                </div>
              </div>
              {c.lastError && <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{c.lastError}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div><dt className="text-ink-400">{t('brand.dev.autoCreate')}</dt><dd className="font-medium">{c.settings.autoCreate ? t('common.yes') : t('common.no')}</dd></div>
                <div><dt className="text-ink-400">{t('brand.new.service')}</dt><dd className="font-medium">{t(`brand.service.${c.settings.defaultServiceLevel}`)}</dd></div>
                <div><dt className="text-ink-400">{t('brand.dev.lastSync')}</dt><dd className="font-medium">{c.lastSyncAt ? ago(c.lastSyncAt) : t('brand.common.never')}</dd></div>
                <div><dt className="text-ink-400">{t('brand.dev.credentials')}</dt><dd className="font-medium">{Object.entries(c.credentialsSet).filter(([, v]) => v).map(([k]) => t(`brand.dev.cred.${k}`)).join('، ') || '—'}</dd></div>
              </dl>
              <div className="mt-3">
                <p className="mb-1 text-xs text-ink-400">{t('brand.dev.webhookUrl')}</p>
                <div className="flex items-center gap-1 rounded-lg bg-ink-50 px-2 py-1 dark:bg-ink-800/60" dir="ltr"><code className="min-w-0 flex-1 truncate font-mono text-xs">{c.webhookUrl}</code><CopyButton value={c.webhookUrl} size="xs" /></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
                <Button size="sm" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={test.isPending && test.variables?.id === c.id} onClick={() => test.mutate(c)}>{t('brand.dev.testConnection')}</Button>
                {isOwner && <Button size="sm" variant="outline" icon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => openSetup(c)}>{t('brand.dev.setup')}</Button>}
                <Button size="sm" variant="ghost" icon={c.status === 'ACTIVE' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} loading={pause.isPending && pause.variables?.id === c.id} onClick={() => pause.mutate(c)}>{c.status === 'ACTIVE' ? t('brand.dev.pause') : t('brand.dev.resume')}</Button>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(c)}>{t('brand.dev.settings')}</Button>
                <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRotate(c)}>{t('brand.dev.rotateSecret')}</Button>
                <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel(c)}>{t('brand.dev.disconnect')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <StoreModal open={connect || !!edit} conn={edit} onClose={() => { setConnect(false); setEdit(null); }} onCreated={(c) => setSetup(c)} />
      <SetupModal conn={setup} onClose={() => setSetup(null)} />
      <Modal open={!!testRes} onClose={() => setTestRes(null)} title={t('brand.dev.testResult')} footer={<Button onClick={() => setTestRes(null)}>{t('action.close')}</Button>}>
        {testRes && (
          <div className={cn('flex items-start gap-3 rounded-xl px-4 py-3 text-sm', testRes.ok ? 'bg-turtle-50 text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200' : 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-200')}>
            {testRes.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
            <p>{testRes.message}</p>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!rotate} onClose={() => setRotate(null)} onConfirm={() => rotate && rot.mutate(rotate)} loading={rot.isPending} danger title={t('brand.dev.rotateTitle')} description={t('brand.dev.rotateStoreBody')} confirmLabel={t('brand.dev.rotateSecret')} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} danger title={t('brand.dev.disconnectTitle', { shop: del?.shopDomain ?? '' })} description={t('brand.dev.disconnectBody')} confirmLabel={t('brand.dev.disconnect')} />
    </div>
  );
}

function StoreModal({ open, conn, onClose, onCreated }: { open: boolean; conn: Integration | null; onClose: () => void; onCreated: (c: Integration) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const locations = useLocations();
  const blank = { provider: 'SHOPIFY' as 'SHOPIFY' | 'WOOCOMMERCE', shopDomain: '', accessToken: '', webhookSecret: '', consumerKey: '', consumerSecret: '', autoCreate: true, defaultServiceLevel: 'STANDARD', codGateways: 'Cash on Delivery (COD), cod', defaultWeight: '1', pickupLocationId: '' };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setF(conn ? { ...blank, provider: conn.provider, shopDomain: conn.shopDomain, autoCreate: conn.settings.autoCreate, defaultServiceLevel: conn.settings.defaultServiceLevel, codGateways: conn.settings.codGateways.join(', '), defaultWeight: String(conn.settings.defaultWeightGrams / 1000), pickupLocationId: conn.settings.pickupLocationId ?? '' } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conn]);
  const domainOk = f.provider === 'SHOPIFY' ? /^[a-z0-9-]+\.myshopify\.com$/i.test(f.shopDomain.trim()) : /^[^\s/]+\.[^\s]+$/.test(f.shopDomain.trim().replace(/^https?:\/\//, ''));
  const m = useMutation({
    mutationFn: () => {
      const credentials = Object.fromEntries(Object.entries({ accessToken: f.accessToken, webhookSecret: f.webhookSecret, consumerKey: f.consumerKey, consumerSecret: f.consumerSecret }).filter(([, v]) => v.trim()));
      const settings = {
        autoCreate: f.autoCreate,
        defaultServiceLevel: f.defaultServiceLevel,
        codGateways: f.codGateways.split(',').map((s) => s.trim()).filter(Boolean),
        defaultWeightGrams: Math.max(1, Math.round(Number(f.defaultWeight) * 1000) || 1000),
        pickupLocationId: f.pickupLocationId || null,
      };
      const shopDomain = f.shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      return conn
        ? api<Integration>(`/integrations/${conn.id}`, { method: 'PATCH', body: { shopDomain, settings, ...(Object.keys(credentials).length ? { credentials } : {}) } })
        : api<Integration>('/integrations', { method: 'POST', body: { provider: f.provider, shopDomain, credentials, settings } });
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      onClose();
      if (!conn) onCreated(c);
      else toast.success(t('brand.common.saved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const shopify = f.provider === 'SHOPIFY';
  return (
    <Modal open={open} onClose={onClose} size="lg" title={conn ? t('brand.dev.storeSettings') : t('brand.dev.connectStore')} footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => { setTouched(true); if (domainOk) m.mutate(); }}>{conn ? t('action.save') : t('brand.dev.connect')}</Button></>}>
      <div className="space-y-4">
        {!conn && (
          <div className="grid grid-cols-2 gap-3" role="radiogroup">
            {(Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={f.provider === p} onClick={() => setF({ ...f, provider: p })} className={cn('flex items-center gap-3 rounded-2xl border-2 p-3 text-start transition', f.provider === p ? 'border-turtle-500 bg-turtle-50/60 dark:bg-turtle-950/40' : 'border-ink-100 dark:border-ink-800')}>
                <span className={cn('grid h-9 w-9 place-items-center rounded-lg text-white', PROVIDERS[p].color)}>{PROVIDERS[p].icon}</span>
                <span className="font-semibold">{PROVIDERS[p].label}</span>
              </button>
            ))}
          </div>
        )}
        <Field label={t('brand.dev.shopDomain')} required error={touched && !domainOk ? (shopify ? t('brand.dev.errShopify') : t('brand.dev.errDomain')) : undefined}>
          {(id) => <Input id={id} dir="ltr" className="font-mono" value={f.shopDomain} onChange={(e) => setF({ ...f, shopDomain: e.target.value })} placeholder={shopify ? 'your-store.myshopify.com' : 'shop.example.com'} />}
        </Field>
        <fieldset className="space-y-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('brand.dev.credentials')} {conn && <span className="normal-case">· {t('brand.dev.credKeep')}</span>}</legend>
          {shopify ? (
            <>
              <Field label={t('brand.dev.cred.accessToken')} hint={t('brand.dev.cred.accessTokenHint')}>{(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" className="font-mono" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} placeholder={conn?.credentialsSet.accessToken ? '••••••••' : 'shpat_…'} />}</Field>
              <Field label={t('brand.dev.cred.webhookSecret')} hint={t('brand.dev.cred.webhookSecretHint')}>{(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" className="font-mono" value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} placeholder={conn?.credentialsSet.webhookSecret ? '••••••••' : ''} />}</Field>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('brand.dev.cred.consumerKey')}>{(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" className="font-mono" value={f.consumerKey} onChange={(e) => setF({ ...f, consumerKey: e.target.value })} placeholder={conn?.credentialsSet.consumerKey ? '••••••••' : 'ck_…'} />}</Field>
              <Field label={t('brand.dev.cred.consumerSecret')}>{(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" className="font-mono" value={f.consumerSecret} onChange={(e) => setF({ ...f, consumerSecret: e.target.value })} placeholder={conn?.credentialsSet.consumerSecret ? '••••••••' : 'cs_…'} />}</Field>
            </div>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('brand.new.service')}>{(id) => <Select id={id} value={f.defaultServiceLevel} onChange={(e) => setF({ ...f, defaultServiceLevel: e.target.value })} options={['STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'].map((s) => ({ value: s, label: t(`brand.service.${s}`) }))} />}</Field>
          <Field label={t('brand.dev.defaultWeight')}>{(id) => <Input id={id} type="number" min={0.1} step={0.1} value={f.defaultWeight} onChange={(e) => setF({ ...f, defaultWeight: e.target.value })} trailing={<span className="text-xs">{t('brand.new.kg')}</span>} />}</Field>
          <Field label={t('brand.pickups.location')}>{(id) => <Select id={id} value={f.pickupLocationId} onChange={(e) => setF({ ...f, pickupLocationId: e.target.value })} placeholder={t('brand.bulk.defaultLocation')} options={(locations.data ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.name }))} />}</Field>
          <Field label={t('brand.dev.codGateways')} hint={t('brand.dev.codGatewaysHint')}>{(id) => <Input id={id} dir="ltr" value={f.codGateways} onChange={(e) => setF({ ...f, codGateways: e.target.value })} />}</Field>
        </div>
        <Switch checked={f.autoCreate} onChange={(v) => setF({ ...f, autoCreate: v })} label={t('brand.dev.autoCreateHint')} />
      </div>
    </Modal>
  );
}

function SetupModal({ conn, onClose }: { conn: Integration | null; onClose: () => void }) {
  const { t } = useI18n();
  const shopify = conn?.provider === 'SHOPIFY';
  return (
    <Modal open={!!conn} onClose={onClose} size="lg" title={t('brand.dev.setupTitle', { p: conn ? PROVIDERS[conn.provider].label : '' })} footer={<Button onClick={onClose}>{t('brand.team.savedIt')}</Button>}>
      {conn && (
        <div className="space-y-4">
          <SecretBox value={conn.webhookUrl} label={t('brand.dev.webhookUrl')} />
          {conn.inboundSecret && <SecretBox value={conn.inboundSecret} label={t('brand.dev.inboundSecret')} />}
          <ol className="list-decimal space-y-2 ps-5 text-sm text-ink-700 dark:text-ink-200">
            {(shopify ? ['s1', 's2', 's3', 's4'] : ['w1', 'w2', 'w3', 'w4']).map((k) => <li key={k}>{t(`brand.dev.steps.${k}`)}</li>)}
          </ol>
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('brand.dev.secretPrivate')}</p>
        </div>
      )}
    </Modal>
  );
}

// =================================================================== Quick start

function QuickStart() {
  const { t } = useI18n();
  const s = snippets(`${window.location.origin}/api/v1`);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <SectionTitle icon={<KeyRound />} title={t('brand.dev.qsCreate')} subtitle={t('brand.dev.qsCreateHint')} />
        <LangTabs tabs={s.create} />
        <ul className="mt-4 space-y-1.5 text-sm text-ink-600 dark:text-ink-300">
          <li>• {t('brand.dev.qsNote1')}</li>
          <li>• {t('brand.dev.qsNote2')}</li>
          <li>• {t('brand.dev.qsNote3')}</li>
        </ul>
      </Card>
      <Card>
        <SectionTitle icon={<Webhook />} title={t('brand.dev.qsVerify')} subtitle={t('brand.dev.qsVerifyHint')} />
        <LangTabs tabs={s.verify} />
        <CodeBlock className="mt-4" lang="headers" code={'X-GoTurtle-Signature: t=1730000000,v1=5f2b…\nX-GoTurtle-Event:     order.delivered\nX-GoTurtle-Delivery:  <delivery id — stable across retries>'} />
        <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">{t('brand.dev.qsRetries')}</p>
      </Card>
      <Card className="xl:col-span-2">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-ink-900 dark:text-white">{t('brand.dev.qsReference')}</p>
            <p className="text-sm text-ink-500">{t('brand.dev.qsReferenceHint')}</p>
          </div>
          <a href="/api/docs" target="_blank" rel="noreferrer"><Button variant="outline" icon={<BookOpen className="h-4 w-4" />}>{t('brand.dev.openDocs')}</Button></a>
        </div>
      </Card>
    </div>
  );
}
