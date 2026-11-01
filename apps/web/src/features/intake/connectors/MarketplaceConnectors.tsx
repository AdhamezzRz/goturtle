import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, CheckCircle2, Copy, Pause, Play, Plus, RefreshCw, ShoppingCart, Store, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { ago } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, StateBadge, Switch } from '@/components/ui';
import { copyText, useLocations } from '@/portals/brand/components/common';
import '../i18n';

export type MarketplaceProvider = 'EASYORDERS' | 'ZID' | 'SALLA' | 'YOUCAN';

interface Connection {
  id: string;
  provider: string;
  shopDomain: string;
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  settings: { autoCreate: boolean; defaultServiceLevel: string; defaultWeightGrams: number; pickupLocationId: string | null; codGateways: string[] };
  credentialsSet: Record<string, boolean>;
  webhookUrl: string;
  inboundSecret?: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

type CredKey = 'accessToken' | 'authorizationToken' | 'webhookSecret';

/** Per-platform look, credential fields and how the webhook is authenticated. */
export const MARKETPLACES: Record<MarketplaceProvider, { label: string; color: string; letter: string; creds: CredKey[]; tokenInUrl: boolean; placeholder: string }> = {
  EASYORDERS: { label: 'EasyOrders', color: 'bg-[#ff6b00]', letter: 'E', creds: ['accessToken', 'webhookSecret'], tokenInUrl: true, placeholder: 'mystore.easy-orders.net' },
  ZID: { label: 'Zid', color: 'bg-[#5a2d82]', letter: 'Z', creds: ['accessToken', 'authorizationToken', 'webhookSecret'], tokenInUrl: true, placeholder: '12345 / mystore.zid.store' },
  SALLA: { label: 'Salla', color: 'bg-[#004d5a]', letter: 'S', creds: ['accessToken', 'webhookSecret'], tokenInUrl: false, placeholder: 'mystore.salla.sa' },
  YOUCAN: { label: 'YouCan', color: 'bg-[#6b4eff]', letter: 'Y', creds: ['accessToken', 'webhookSecret'], tokenInUrl: false, placeholder: 'mystore.youcan.shop' },
};
const KEYS = Object.keys(MARKETPLACES) as MarketplaceProvider[];
const isMarketplace = (p: string): p is MarketplaceProvider => (KEYS as string[]).includes(p);

function Logo({ p, size = 'md' }: { p: MarketplaceProvider; size?: 'sm' | 'md' }) {
  return <span className={cn('grid shrink-0 place-items-center rounded-xl font-display font-extrabold text-white', MARKETPLACES[p].color, size === 'md' ? 'h-11 w-11 text-lg' : 'h-9 w-9')}>{MARKETPLACES[p].letter}</span>;
}

/**
 * Brand → Developers → "Egyptian stores": EasyOrders, Zid, Salla and YouCan
 * order webhooks (connect, setup instructions with URL + secret, test, pause,
 * rotate, disconnect).
 */
export function MarketplaceConnectors() {
  const { t } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const isOwner = me?.role === 'BRAND_OWNER';
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api<Paginated<Connection>>('/integrations', { query: { pageSize: 50 } }) });
  const [connect, setConnect] = useState<MarketplaceProvider | null>(null);
  const [edit, setEdit] = useState<Connection | null>(null);
  const [setup, setSetup] = useState<Connection | null>(null);
  const [del, setDel] = useState<Connection | null>(null);
  const [rotate, setRotate] = useState<Connection | null>(null);
  const [testRes, setTestRes] = useState<{ ok: boolean; message: string } | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const rows = (q.data?.data ?? []).filter((c) => isMarketplace(c.provider));
  const pause = useMutation({ mutationFn: (c: Connection) => api(`/integrations/${c.id}`, { method: 'PATCH', body: { status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } }), onSuccess: inv, onError: (e) => toast.error(errorMessage(e)) });
  const test = useMutation({ mutationFn: (c: Connection) => api<{ ok: boolean; message: string }>(`/integrations/${c.id}/test`, { method: 'POST' }), onSuccess: (r) => { setTestRes(r); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (c: Connection) => api(`/integrations/${c.id}`, { method: 'DELETE' }), onSuccess: () => { setDel(null); inv(); toast.success(t('intake.mk.removed')); }, onError: (e) => toast.error(errorMessage(e)) });
  const rot = useMutation({
    mutationFn: (c: Connection) => api<{ inboundSecret: string }>(`/integrations/${c.id}/rotate-secret`, { method: 'POST' }),
    onSuccess: (r, c) => { setRotate(null); inv(); setSetup({ ...c, inboundSecret: r.inboundSecret }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const openSetup = async (c: Connection) => {
    try {
      setSetup(await api<Connection>(`/integrations/${c.id}`));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300"><ShoppingCart className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="font-semibold text-ink-900 dark:text-white">{t('intake.mk.title')}</h2>
            <p className="mt-0.5 text-sm text-ink-500">{t('intake.mk.subtitle')}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {KEYS.map((p) => (
            <button key={p} type="button" disabled={!isOwner} onClick={() => setConnect(p)} className="flex items-center gap-3 rounded-2xl border-2 border-ink-100 p-3 text-start transition hover:border-turtle-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-ink-800">
              <Logo p={p} size="sm" />
              <span className="min-w-0">
                <span className="block break-words text-sm font-semibold text-ink-900 dark:text-white">{MARKETPLACES[p].label}</span>
                <span className="flex items-center gap-1 text-xs text-turtle-700 dark:text-turtle-400"><Plus className="h-3 w-3" />{t('intake.mk.connect')}</span>
              </span>
            </button>
          ))}
        </div>
        {!isOwner && <p className="mt-3 text-xs text-ink-500">{t('intake.mk.ownerOnly')}</p>}
      </Card>

      {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !rows.length ? (
        <Card><EmptyState icon={<Store className="h-7 w-7" />} title={t('intake.mk.none')} description={t('intake.mk.noneHint')} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          {rows.map((c) => {
            const p = c.provider as MarketplaceProvider;
            return (
              <Card key={c.id}>
                <div className="flex items-start gap-3">
                  <Logo p={p} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink-900 dark:text-white">{MARKETPLACES[p].label}</p><StateBadge value={c.status} /></div>
                    <p className="ltr truncate text-start font-mono text-sm text-ink-500">{c.shopDomain}</p>
                  </div>
                </div>
                {c.lastError && <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words">{c.lastError}</span></p>}
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-ink-400">{t('intake.mk.autoCreate')}</dt><dd className="font-medium">{c.settings.autoCreate ? t('common.yes') : t('common.no')}</dd></div>
                  <div><dt className="text-ink-400">{t('intake.mk.lastOrder')}</dt><dd className="font-medium">{c.lastSyncAt ? ago(c.lastSyncAt) : '—'}</dd></div>
                  <div className="col-span-2"><dt className="text-ink-400">{t('intake.mk.credentials')}</dt><dd className="font-medium">{Object.entries(c.credentialsSet).filter(([, v]) => v).map(([k]) => t(`intake.mk.cred.${k}`)).join('، ') || '—'}</dd></div>
                </dl>
                <div className="mt-3">
                  <p className="mb-1 text-xs text-ink-400">{t('intake.mk.webhookUrl')}</p>
                  <UrlRow value={c.webhookUrl} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
                  <Button size="sm" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={test.isPending && test.variables?.id === c.id} onClick={() => test.mutate(c)}>{t('intake.mk.test')}</Button>
                  {isOwner && <Button size="sm" variant="outline" icon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => openSetup(c)}>{t('intake.mk.setup')}</Button>}
                  {isOwner && <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>{t('intake.mk.settings')}</Button>}
                  {isOwner && <Button size="sm" variant="ghost" icon={c.status === 'ACTIVE' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} loading={pause.isPending && pause.variables?.id === c.id} onClick={() => pause.mutate(c)}>{c.status === 'ACTIVE' ? t('intake.mk.pause') : t('intake.mk.resume')}</Button>}
                  {isOwner && <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRotate(c)}>{t('intake.mk.rotate')}</Button>}
                  {isOwner && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDel(c)}>{t('intake.mk.disconnect')}</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConnectModal provider={connect ?? (edit ? (edit.provider as MarketplaceProvider) : null)} conn={edit} onClose={() => { setConnect(null); setEdit(null); }} onCreated={setSetup} />
      <SetupModal conn={setup} onClose={() => setSetup(null)} />
      <Modal open={!!testRes} onClose={() => setTestRes(null)} title={t('intake.mk.testResult')} footer={<Button onClick={() => setTestRes(null)}>{t('action.close')}</Button>}>
        {testRes && (
          <div className={cn('flex items-start gap-3 rounded-xl px-4 py-3 text-sm', testRes.ok ? 'bg-turtle-50 text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200' : 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-200')}>
            {testRes.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
            <p>{testRes.message}</p>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!rotate} onClose={() => setRotate(null)} onConfirm={() => rotate && rot.mutate(rotate)} loading={rot.isPending} danger title={t('intake.mk.rotateTitle')} description={t('intake.mk.rotateBody')} confirmLabel={t('intake.mk.rotate')} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} danger title={t('intake.mk.disconnectTitle', { shop: del?.shopDomain ?? '' })} description={t('intake.mk.disconnectBody')} confirmLabel={t('intake.mk.disconnect')} />
    </div>
  );
}

function UrlRow({ value, secret }: { value: string; secret?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cn('flex items-center gap-1 rounded-lg px-2 py-1', secret ? 'bg-amber-50 dark:bg-amber-950/40' : 'bg-ink-50 dark:bg-ink-800/60')} dir="ltr">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <button type="button" className="rounded p-1 text-ink-500 hover:bg-white dark:hover:bg-ink-700" aria-label={t('action.copy')} onClick={() => copyText(value, t('action.copied'))}><Copy className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function ConnectModal({ provider, conn, onClose, onCreated }: { provider: MarketplaceProvider | null; conn: Connection | null; onClose: () => void; onCreated: (c: Connection) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const locations = useLocations();
  const blank = { shopDomain: '', accessToken: '', authorizationToken: '', webhookSecret: '', autoCreate: true, defaultServiceLevel: 'STANDARD', weight: '1', pickupLocationId: '' };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!provider) return;
    setTouched(false);
    setF(conn ? { ...blank, shopDomain: conn.shopDomain, autoCreate: conn.settings.autoCreate, defaultServiceLevel: conn.settings.defaultServiceLevel, weight: String(conn.settings.defaultWeightGrams / 1000), pickupLocationId: conn.settings.pickupLocationId ?? '' } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, conn]);
  const domainOk = /^[a-z0-9][a-z0-9.-]{1,120}(\/[a-z0-9._-]{1,60})?$/i.test(f.shopDomain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
  const m = useMutation({
    mutationFn: () => {
      const credentials = Object.fromEntries((['accessToken', 'authorizationToken', 'webhookSecret'] as const).filter((k) => f[k].trim()).map((k) => [k, f[k].trim()]));
      const settings = { autoCreate: f.autoCreate, defaultServiceLevel: f.defaultServiceLevel, defaultWeightGrams: Math.max(1, Math.round(Number(f.weight) * 1000) || 1000), pickupLocationId: f.pickupLocationId || null };
      const shopDomain = f.shopDomain.trim();
      return conn
        ? api<Connection>(`/integrations/${conn.id}`, { method: 'PATCH', body: { shopDomain, settings, ...(Object.keys(credentials).length ? { credentials } : {}) } })
        : api<Connection>('/integrations', { method: 'POST', body: { provider, shopDomain, credentials, settings } });
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      onClose();
      if (!conn) onCreated(c);
      else toast.success(t('intake.mk.saved'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!provider) return null;
  const meta = MARKETPLACES[provider];
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={<span className="flex items-center gap-3"><Logo p={provider} size="sm" />{conn ? t('intake.mk.settingsTitle', { p: meta.label }) : t('intake.mk.connectTitle', { p: meta.label })}</span>}
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => { setTouched(true); if (domainOk) m.mutate(); }}>{conn ? t('action.save') : t('intake.mk.connect')}</Button></>}
    >
      <div className="space-y-4">
        <Field label={t('intake.mk.store')} hint={t(`intake.mk.storeHint.${provider}`)} required error={touched && !domainOk ? t('intake.mk.errStore') : undefined}>
          {(id) => <Input id={id} dir="ltr" className="font-mono" value={f.shopDomain} onChange={(e) => setF({ ...f, shopDomain: e.target.value })} placeholder={meta.placeholder} />}
        </Field>
        <fieldset className="space-y-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('intake.mk.credentials')} {conn && <span className="normal-case">· {t('intake.mk.credKeep')}</span>}</legend>
          {meta.creds.map((k) => (
            <Field key={k} label={t(`intake.mk.cred.${k}`)} hint={t(`intake.mk.credHint.${provider}.${k}`)}>
              {(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" className="font-mono" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={conn?.credentialsSet[k] ? '••••••••' : ''} />}
            </Field>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('intake.mk.service')}>{(id) => <Select id={id} value={f.defaultServiceLevel} onChange={(e) => setF({ ...f, defaultServiceLevel: e.target.value })} options={['STANDARD', 'SAME_DAY', 'EXPRESS'].map((s) => ({ value: s, label: t(`intake.service.${s}`) }))} />}</Field>
          <Field label={t('intake.mk.weight')}>{(id) => <Input id={id} type="number" min={0.1} step={0.1} dir="ltr" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} trailing={<span className="text-xs">{t('intake.kg')}</span>} />}</Field>
          <Field label={t('intake.mk.pickup')}>{(id) => <Select id={id} value={f.pickupLocationId} onChange={(e) => setF({ ...f, pickupLocationId: e.target.value })} placeholder={t('intake.mk.defaultLocation')} options={(locations.data ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.name }))} />}</Field>
        </div>
        <Switch checked={f.autoCreate} onChange={(v) => setF({ ...f, autoCreate: v })} label={t('intake.mk.autoCreateHint')} />
      </div>
    </Modal>
  );
}

function SetupModal({ conn, onClose }: { conn: Connection | null; onClose: () => void }) {
  const { t } = useI18n();
  if (!conn || !isMarketplace(conn.provider)) return null;
  const p = conn.provider;
  const meta = MARKETPLACES[p];
  const withToken = conn.inboundSecret && meta.tokenInUrl ? `${conn.webhookUrl}?token=${encodeURIComponent(conn.inboundSecret)}` : null;
  const steps = [1, 2, 3, 4].map((n) => t(`intake.mk.steps.${p}.${n}`));
  return (
    <Modal open onClose={onClose} size="lg" title={t('intake.mk.setupTitle', { p: meta.label })} footer={<Button onClick={onClose}>{t('intake.mk.savedIt')}</Button>}>
      <div className="space-y-4">
        <Labeled label={t('intake.mk.webhookUrl')}><UrlRow value={conn.webhookUrl} /></Labeled>
        {withToken && <Labeled label={t('intake.mk.webhookUrlToken')}><UrlRow value={withToken} secret /></Labeled>}
        {conn.inboundSecret && <Labeled label={t('intake.mk.inboundSecret')}><UrlRow value={conn.inboundSecret} secret /></Labeled>}
        <ol className="list-decimal space-y-2 ps-5 text-sm text-ink-700 dark:text-ink-200">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">{t(`intake.mk.auth.${p}`)}</p>
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('intake.mk.secretPrivate')}</p>
        <Badge tone="info">{t('intake.mk.idempotent')}</Badge>
      </div>
    </Modal>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink-500">{label}</p>
      {children}
    </div>
  );
}
