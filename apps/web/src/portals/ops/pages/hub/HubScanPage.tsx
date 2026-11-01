import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRightLeft, Camera, CheckCircle2, Clock, Inbox, Package, RotateCcw, Scale, ScanLine, Truck, Undo2, User, XCircle } from 'lucide-react';
import { isValidTrackingNumber, normalizeTrackingNumber, toLatinDigits, type OrderStatus } from '@goturtle/shared';
import { ApiError, api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cairoToday, dateOnly, money, num, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, EmptyState, Field, Input, Modal, ProgressBar, Select, StatusBadge } from '@/components/ui';
import { Mono, NoAccess, Segmented } from '../../components/opsa/ui';
import { useLookupOptions } from '../../components/opsa/lookups';
import type { RunsheetRow } from '../../components/opsa/types';
import './i18n';
import { WeighMode } from '@/features/money/ops/WeighMode';

type Mode = 'inbound' | 'outbound' | 'return' | 'weigh';

interface InboundResult {
  action: 'RECEIVED' | 'TRANSFERRED' | 'RETURN_RECEIVED' | 'ALREADY_SCANNED';
  alreadyScanned: boolean;
  order: { id: string; trackingNumber: string; status: OrderStatus; type: string; collectCents: number; recipientName: string; attempts: number };
  sort: {
    bin: string; zone: { id: string; code: string; nameEn: string; nameAr: string } | null; isReturn: boolean; isCorrectHub: boolean; transferTo: string | null;
    suggestedHero: { id: string; code: string; name: string; score: number } | null; promisedBy: string | null; slaAtRisk: boolean; scheduledDate: string | null;
  };
}
interface OutboundResult { ok: boolean; alreadyLoaded: boolean; trackingNumber: string; routeSequence: number | null; progress: { loaded: number; total: number } }
interface ReturnResult { id: string; trackingNumber: string; status: OrderStatus; returnFee: { totalCents: number } | null }

interface FeedItem {
  key: number;
  at: Date;
  mode: Mode;
  tn: string;
  ok: boolean;
  error?: string;
  inbound?: InboundResult;
  outbound?: OutboundResult;
  ret?: ReturnResult;
}

interface BarcodeDetectorLike { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/** Extracts a GT… tracking number from scanner/QR input (QR codes carry the tracking URL). */
function extractTn(raw: string) {
  const s = toLatinDigits(raw).toUpperCase();
  const m = s.match(/GT[\s-]?\d{10}/);
  return normalizeTrackingNumber(m ? m[0] : s);
}

export default function HubScanPage() {
  const { t, locale } = useI18n();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const { hubs } = useLookupOptions();
  const [mode, setMode] = useState<Mode>('inbound');
  const [hubId, setHubId] = useState(() => me?.hubId ?? localStorage.getItem('gt.ops.scanHub') ?? '');
  const [runsheetId, setRunsheetId] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [value, setValue] = useState('');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [flash, setFlash] = useState<{ ok: boolean; key: number } | null>(null);
  const [focused, setFocused] = useState(true);
  const [camera, setCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const lockedHub = !!me?.hubId;

  useEffect(() => {
    try {
      if (hubId) localStorage.setItem('gt.ops.scanHub', hubId);
    } catch {
      /* ignore */
    }
  }, [hubId]);

  const runsheets = useQuery({
    queryKey: ['runsheets', { date: cairoToday(), hubId, status: 'DRAFT,DISPATCHED,IN_PROGRESS' }],
    queryFn: () => api<Paginated<RunsheetRow>>('/runsheets', { query: { date: cairoToday(), hubId: hubId || undefined, status: 'DRAFT,DISPATCHED,IN_PROGRESS', pageSize: 100 } }),
    enabled: mode === 'outbound' && can('runsheets.read'),
  });

  const refocus = useCallback(() => setTimeout(() => inputRef.current?.focus(), 30), []);
  useEffect(() => { refocus(); }, [mode, refocus]);

  // Keep focus on the scan box: USB scanners type into whatever is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (!typing && !camera && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera]);

  const push = (item: Omit<FeedItem, 'key' | 'at'>) => {
    counter.current += 1;
    setFeed((f) => [{ ...item, key: counter.current, at: new Date() }, ...f].slice(0, 200));
    setFlash({ ok: item.ok, key: counter.current });
  };

  const scan = useMutation({
    mutationFn: async (tn: string) => {
      if (mode === 'inbound') return { inbound: await api<InboundResult>('/dispatch/scan/inbound', { method: 'POST', body: { hubId, trackingNumber: tn } }) };
      if (mode === 'outbound') return { outbound: await api<OutboundResult>('/dispatch/scan/outbound', { method: 'POST', body: { runsheetId, trackingNumber: tn } }) };
      return { ret: await api<ReturnResult>('/dispatch/scan/return-to-brand', { method: 'POST', body: { trackingNumber: tn, receivedBy: receivedBy || undefined } }) };
    },
    onSuccess: (r, tn) => {
      push({ mode, tn, ok: true, ...r });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      if (mode === 'outbound') void qc.invalidateQueries({ queryKey: ['runsheets'] });
    },
    onError: (e, tn) => push({ mode, tn, ok: false, error: e instanceof ApiError || e instanceof Error ? errorMessage(e) : String(e) }),
    onSettled: () => refocus(),
  });

  const ready = mode === 'inbound' ? !!hubId : mode === 'outbound' ? !!runsheetId : true;

  const submit = (raw: string) => {
    const tn = extractTn(raw);
    setValue('');
    if (!tn) return;
    if (!isValidTrackingNumber(tn)) {
      push({ mode, tn, ok: false, error: t('ops.hub.invalid', { tn }) });
      refocus();
      return;
    }
    if (!ready) return;
    scan.mutate(tn);
  };

  const stats = useMemo(() => {
    const ok = feed.filter((f) => f.ok);
    return {
      ok: ok.length,
      errors: feed.length - ok.length,
      transfers: ok.filter((f) => f.inbound?.action === 'TRANSFERRED' || f.inbound?.sort.transferTo).length,
      returns: ok.filter((f) => f.inbound?.sort.isReturn || f.ret).length,
      cod: ok.reduce((s, f) => s + (f.inbound && !f.inbound.alreadyScanned ? f.inbound.order.collectCents : 0), 0),
    };
  }, [feed]);

  if (!can('hubs.scan')) return <NoAccess />;
  const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const rsOptions = (runsheets.data?.data ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.courier.name} · ${t(`ops.opsa.rs.${r.status}`)}` }));
  const selectedRs = runsheets.data?.data.find((r) => r.id === runsheetId);
  const lastOutbound = feed.find((f) => f.outbound && f.mode === 'outbound');

  return (
    <div className="space-y-5">
      {/* flash overlay */}
      {flash && (
        <div
          key={flash.key}
          aria-hidden
          className={cn('pointer-events-none fixed inset-0 z-[60] animate-[gt-flash_.7s_ease-out_forwards] ring-[14px] ring-inset', flash.ok ? 'bg-turtle-400/15 ring-turtle-500/70' : 'bg-red-500/15 ring-red-500/80')}
        />
      )}
      <style>{'@keyframes gt-flash { 0% { opacity: 1 } 100% { opacity: 0 } }'}</style>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{t('ops.hub.title')}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('ops.hub.subtitle')}</p>
        </div>
        <Segmented
          value={mode}
          onChange={(m) => setMode(m)}
          options={[
            { value: 'inbound', label: <span className="flex items-center gap-1.5"><Inbox className="h-4 w-4" />{t('ops.hub.mode.inbound')}</span> },
            { value: 'outbound', label: <span className="flex items-center gap-1.5"><Truck className="h-4 w-4" />{t('ops.hub.mode.outbound')}</span> },
            { value: 'return', label: <span className="flex items-center gap-1.5"><Undo2 className="h-4 w-4" />{t('ops.hub.mode.return')}</span> },
            { value: 'weigh', label: <span className="flex items-center gap-1.5"><Scale className="h-4 w-4" />{t('money.weigh.mode')}</span> },
          ]}
        />
      </div>

      {mode === 'weigh' && <WeighMode />}
      <div className={cn('grid gap-5 lg:grid-cols-5', mode === 'weigh' && 'hidden')}>
        <div className="min-w-0 space-y-4 lg:col-span-3">
          <div className="rounded-3xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900 sm:p-6">
            <p className="mb-4 text-sm text-ink-500">{t(`ops.hub.modeHint.${mode}`)}</p>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {mode === 'inbound' && (
                <Field label={t('ops.hub.hub')} className="sm:col-span-2">
                  {(id) => <Select id={id} value={hubId} disabled={lockedHub} onChange={(e) => { setHubId(e.target.value); refocus(); }} options={hubs} placeholder={t('ops.hub.pickHub')} />}
                </Field>
              )}
              {mode === 'outbound' && (
                <>
                  <Field label={t('ops.hub.hub')}>{(id) => <Select id={id} value={hubId} disabled={lockedHub} onChange={(e) => { setHubId(e.target.value); setRunsheetId(''); }} options={hubs} placeholder={t('ops.opsa.anyHub')} />}</Field>
                  <Field label={t('ops.hub.runsheet')} hint={runsheets.data && !rsOptions.length ? t('ops.hub.noRunsheets') : undefined}>
                    {(id) => <Select id={id} value={runsheetId} onChange={(e) => { setRunsheetId(e.target.value); refocus(); }} options={rsOptions} placeholder={t('ops.hub.pickRunsheet')} />}
                  </Field>
                </>
              )}
              {mode === 'return' && (
                <Field label={t('ops.hub.receivedBy')} className="sm:col-span-2">{(id) => <Input id={id} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && refocus()} maxLength={150} />}</Field>
              )}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); submit(value); }} className="relative">
              <label htmlFor="scan-input" className="sr-only">{t('ops.hub.input')}</label>
              <div className={cn('flex items-center gap-3 rounded-2xl border-2 bg-ink-50 px-4 transition-colors dark:bg-ink-950', focused && ready ? 'border-turtle-500 ring-4 ring-turtle-500/15' : 'border-ink-200 dark:border-ink-700')}>
                <ScanLine className={cn('h-7 w-7 shrink-0', focused && ready ? 'animate-pulse2 text-turtle-600' : 'text-ink-400')} />
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={value}
                  disabled={!ready}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  onChange={(e) => setValue(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder={ready ? t('ops.hub.inputPh') : mode === 'inbound' ? t('ops.hub.pickHub') : t('ops.hub.pickRunsheet')}
                  className="ltr h-16 min-w-0 flex-1 bg-transparent font-mono text-xl font-semibold tracking-wider text-ink-900 placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-400 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed dark:text-white sm:text-2xl"
                />
                <Button type="submit" size="lg" loading={scan.isPending} disabled={!ready || !value.trim()} className="hidden sm:inline-flex">{t('ops.hub.scan')}</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="submit" size="lg" loading={scan.isPending} disabled={!ready || !value.trim()} className="flex-1 sm:hidden">{t('ops.hub.scan')}</Button>
                <Button type="button" variant="outline" size="lg" icon={<Camera className="h-5 w-5" />} disabled={!ready} onClick={() => setCamera(true)} className="flex-1 sm:flex-none">{t('ops.hub.camera')}</Button>
                {!focused && ready && !camera && (
                  <button type="button" onClick={refocus} className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4" /> {t('ops.hub.focusLost')}
                  </button>
                )}
                {focused && ready && <span className="flex items-center gap-1.5 text-sm text-turtle-700 dark:text-turtle-400"><span className="h-2 w-2 animate-pulse rounded-full bg-turtle-500" />{t('ops.hub.ready')}</span>}
              </div>
            </form>

            {mode === 'outbound' && selectedRs && (
              <div className="mt-5 rounded-2xl bg-ink-50 p-4 dark:bg-ink-800/60">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{selectedRs.courier.name} · <span className="ltr">{selectedRs.code}</span></span>
                  {lastOutbound?.outbound && <span className="ltr font-display font-bold">{num(lastOutbound.outbound.progress.loaded)}/{num(lastOutbound.outbound.progress.total)}</span>}
                </div>
                <ProgressBar value={lastOutbound?.outbound ? lastOutbound.outbound.progress.loaded / Math.max(1, lastOutbound.outbound.progress.total) : 0} className="mt-2" />
              </div>
            )}
          </div>

          {/* latest result, big */}
          {feed[0] && <LatestCard item={feed[0]} />}
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-2">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-3">
            <Counter label={t('ops.hub.c.ok')} value={num(stats.ok)} tone="text-turtle-700 dark:text-turtle-400" />
            <Counter label={t('ops.hub.c.errors')} value={num(stats.errors)} tone={stats.errors ? 'text-red-600' : 'text-ink-400'} />
            <Counter label={t('ops.hub.c.transfers')} value={num(stats.transfers)} tone="text-sky-700 dark:text-sky-400" />
            <Counter label={t('ops.hub.c.returns')} value={num(stats.returns)} tone="text-violet-700 dark:text-violet-400" />
            <Counter label={t('ops.hub.c.cod')} value={money(stats.cod, { compact: true })} tone="text-sand-700 dark:text-sand-300" className="col-span-2 sm:col-span-1 lg:col-span-2" />
          </div>
          <section className="rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <header className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
              <h2 className="text-[15px] font-semibold">{t('ops.hub.feed')}</h2>
              {feed.length > 0 && <Button size="xs" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { setFeed([]); refocus(); }}>{t('ops.hub.reset')}</Button>}
            </header>
            {feed.length === 0 ? (
              <EmptyState icon={<ScanLine className="h-7 w-7" />} title={t('ops.hub.feedEmpty')} className="py-10" />
            ) : (
              <ul className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
                {feed.map((f) => <FeedRow key={f.key} item={f} locale={locale} />)}
              </ul>
            )}
          </section>
        </div>
      </div>

      {camera && <CameraScanner supported={hasDetector} onClose={() => { setCamera(false); refocus(); }} onCode={(code) => { setCamera(false); submit(code); }} />}
    </div>
  );
}

function Counter({ label, value, tone, className }: { label: string; value: string; tone: string; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-ink-100 bg-white p-3 text-center shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
      <p className={cn('ltr font-display text-2xl font-bold', tone)}>{value}</p>
      <p className="truncate text-xs text-ink-500">{label}</p>
    </div>
  );
}

function LatestCard({ item }: { item: FeedItem }) {
  const { t, locale } = useI18n();
  const base = 'rounded-3xl border-2 p-5 shadow-card';
  if (!item.ok) {
    return (
      <div className={cn(base, 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/50')} role="alert">
        <div className="flex items-start gap-3">
          <XCircle className="h-8 w-8 shrink-0 text-red-600" />
          <div className="min-w-0">
            <Mono className="text-lg font-bold text-red-900 dark:text-red-100">{item.tn}</Mono>
            <p className="mt-1 text-sm font-medium text-red-800 dark:text-red-200">{item.error}</p>
          </div>
        </div>
      </div>
    );
  }
  if (item.inbound) {
    const r = item.inbound;
    const transfer = !r.sort.isCorrectHub && r.sort.transferTo;
    return (
      <div className={cn(base, transfer ? 'border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40' : r.alreadyScanned ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40' : 'border-turtle-300 bg-turtle-50 dark:border-turtle-900 dark:bg-turtle-950/40')} role="status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {r.alreadyScanned ? <Clock className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-turtle-600" />}
              {t(`ops.hub.action.${r.action}`)}
            </p>
            <Link to={`/ops/orders/${r.order.id}`} className="mt-1 block hover:underline"><Mono className="text-lg font-bold">{r.order.trackingNumber}</Mono></Link>
            <p className="text-sm text-ink-600 dark:text-ink-300">{r.order.recipientName}{r.order.collectCents ? <> · <span className="ltr font-semibold text-sand-700 dark:text-sand-300">{money(r.order.collectCents)}</span></> : null}</p>
          </div>
          <div className="text-end">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{transfer ? t('ops.hub.transferTo', { hub: r.sort.transferTo! }) : r.sort.isReturn ? t('ops.hub.returnShelf') : t('ops.hub.bin')}</p>
            <p className={cn('ltr font-display text-4xl font-black tracking-tight sm:text-5xl', transfer ? 'text-sky-700 dark:text-sky-300' : r.sort.isReturn ? 'text-violet-700 dark:text-violet-300' : 'text-ink-900 dark:text-white')}>{transfer ? r.sort.transferTo : r.sort.bin}</p>
            {r.sort.zone && <p className="text-sm text-ink-500">{locale === 'ar' ? r.sort.zone.nameAr : r.sort.zone.nameEn}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {r.sort.suggestedHero && <Badge tone="success"><User className="h-3 w-3" />{t('ops.hub.suggested', { name: r.sort.suggestedHero.name })}</Badge>}
          {r.sort.slaAtRisk && <Badge tone="danger"><AlertTriangle className="h-3 w-3" />{t('ops.hub.slaRisk')}</Badge>}
          {r.sort.scheduledDate && <Badge tone="info">{t('ops.hub.scheduled', { d: dateOnly(r.sort.scheduledDate) })}</Badge>}
          <StatusBadge status={r.order.status} />
        </div>
      </div>
    );
  }
  if (item.outbound) {
    const r = item.outbound;
    return (
      <div className={cn(base, r.alreadyLoaded ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40' : 'border-turtle-300 bg-turtle-50 dark:border-turtle-900 dark:bg-turtle-950/40')} role="status">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">{r.alreadyLoaded ? <Clock className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-turtle-600" />}{t(r.alreadyLoaded ? 'ops.hub.action.ALREADY_LOADED' : 'ops.hub.action.LOADED')}</p>
            <Mono className="mt-1 block text-lg font-bold">{r.trackingNumber}</Mono>
            <p className="text-sm text-ink-500">{t('ops.hub.loaded', { l: num(r.progress.loaded), t: num(r.progress.total) })}</p>
          </div>
          {r.routeSequence != null && <p className="font-display text-5xl font-black"><span className="ltr">#{r.routeSequence}</span></p>}
        </div>
      </div>
    );
  }
  if (item.ret) {
    return (
      <div className={cn(base, 'border-violet-300 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40')} role="status">
        <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-5 w-5 text-violet-600" />{t('ops.hub.action.RETURNED')}</p>
        <Mono className="mt-1 block text-lg font-bold">{item.ret.trackingNumber}</Mono>
        {item.ret.returnFee && <p className="text-sm text-ink-600 dark:text-ink-300">{t('ops.hub.returnFee', { v: money(item.ret.returnFee.totalCents) })}</p>}
      </div>
    );
  }
  return null;
}

function FeedRow({ item, locale }: { item: FeedItem; locale: string }) {
  const { t } = useI18n();
  const icon = !item.ok ? <XCircle className="h-4 w-4 text-red-600" /> : item.inbound?.sort.transferTo ? <ArrowRightLeft className="h-4 w-4 text-sky-600" /> : item.mode === 'outbound' ? <Truck className="h-4 w-4 text-turtle-600" /> : item.mode === 'return' ? <Undo2 className="h-4 w-4 text-violet-600" /> : <Package className="h-4 w-4 text-turtle-600" />;
  const detail = !item.ok
    ? item.error
    : item.inbound
      ? `${t(`ops.hub.action.${item.inbound.action}`)} · ${item.inbound.sort.transferTo ? `→ ${item.inbound.sort.transferTo}` : item.inbound.sort.bin}${item.inbound.sort.zone ? ` · ${locale === 'ar' ? item.inbound.sort.zone.nameAr : item.inbound.sort.zone.nameEn}` : ''}`
      : item.outbound
        ? `${t(item.outbound.alreadyLoaded ? 'ops.hub.action.ALREADY_LOADED' : 'ops.hub.action.LOADED')}${item.outbound.routeSequence != null ? ` · ${t('ops.hub.seq', { n: item.outbound.routeSequence })}` : ''}`
        : t('ops.hub.action.RETURNED');
  return (
    <li className={cn('flex items-start gap-3 px-4 py-2.5', !item.ok && 'bg-red-50/60 dark:bg-red-950/30')}>
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <Mono className="text-sm font-semibold">{item.tn}</Mono>
        <p className={cn('truncate text-xs', item.ok ? 'text-ink-500' : 'text-red-700 dark:text-red-300')}>{detail}</p>
      </div>
      <span className="ltr shrink-0 text-[11px] text-ink-400">{timeOnly(item.at)}</span>
    </li>
  );
}

function CameraScanner({ supported, onClose, onCode }: { supported: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(supported ? null : t('ops.hub.cameraUnsupported'));
  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ['code_128', 'qr_code', 'code_39', 'ean_13'] });
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.map((c) => extractTn(c.rawValue)).find((c) => isValidTrackingNumber(c));
            if (hit) onCode(hit);
          } catch {
            /* keep trying */
          }
        }, 300);
      })
      .catch(() => setError(t('ops.hub.cameraDenied')));
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);
  return (
    <Modal open onClose={onClose} title={t('ops.hub.cameraTitle')} size="md">
      {error ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,.7)]" />
        </div>
      )}
    </Modal>
  );
}
