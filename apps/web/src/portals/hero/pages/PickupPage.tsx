import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CircleCheck, CircleX, Clock, CloudOff, Navigation, Package, PackageCheck, Phone, Play, ScanBarcode, Store, TriangleAlert, User } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { normalizeTrackingNumber } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { num, timeOnly } from '@/lib/format';
import { useOnline } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, ConfirmDialog, ErrorState, Field, Input, ProgressBar, Skeleton, Textarea } from '@/components/ui';
import { BigAction, Chips, Ltr, Money, OfflineBlock, PageTop, Panel, SectionTitle, Sheet, StickyBar, SuccessOverlay } from '../components/kit';
import { cameraScanSupported, extractTrackingNumber, Scanner, type ScanFeedback } from '../components/Scanner';
import { useHeroMutation, useInvalidateHero, usePickup } from '../lib/queries';
import { currentPosition } from '../lib/geo';
import { directionsLink, telLink } from '../lib/util';
import type { PickupDetail, ScanResult } from '../types';

const StopMiniMap = lazy(() => import('../components/StopMiniMap'));

type LogItem = { code: string; ok: boolean; message: string; pending?: boolean };

const offlineKey = (id: string) => `gt.hero.pickupq:${id}`;
const loadOffline = (id: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(offlineKey(id)) ?? '[]');
  } catch {
    return [];
  }
};
const saveOffline = (id: string, codes: string[]) => {
  try {
    if (codes.length) localStorage.setItem(offlineKey(id), JSON.stringify(codes));
    else localStorage.removeItem(offlineKey(id));
  } catch {
    /* ignore */
  }
};

export default function PickupPage() {
  const { id = '' } = useParams();
  const { t, pick } = useI18n();
  const online = useOnline();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateHero();
  const pickup = usePickup(id);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [log, setLog] = useState<LogItem[]>([]);
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [offlineCodes, setOfflineCodes] = useState<string[]>(() => loadOffline(id));
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; title: string; subtitle: string } | null>(null);
  const manualRef = useRef<HTMLInputElement>(null);

  const refresh = () => invalidate(['hero', 'pickup', id]);

  const push = (item: LogItem) => {
    setLog((l) => [item, ...l.filter((x) => x.code !== item.code)].slice(0, 50));
    setFeedback({ ...item, at: Date.now() });
  };

  const scan = useHeroMutation(
    async (trackingNumber: string) => api<ScanResult>(`/hero/tasks/pickups/${id}/scan`, { method: 'POST', body: { trackingNumber, ...(await currentPosition(2000)) } }),
    {
      silentError: true,
      onSuccess: (r) => {
        push({ code: r.trackingNumber, ok: true, message: r.alreadyScanned ? t('hero.scan.already') : t('hero.scan.ok', { n: r.scannedCount }) });
        qc.setQueryData<PickupDetail>(['hero', 'pickup', id], (old) =>
          old ? { ...old, scannedCount: r.scannedCount, orders: old.orders.map((o) => (o.trackingNumber === r.trackingNumber ? { ...o, scanned: true, status: r.status } : o)) } : old,
        );
      },
    },
  );

  const submitCode = (raw: string) => {
    const tn = extractTrackingNumber(raw) ?? normalizeTrackingNumber(raw);
    if (!extractTrackingNumber(raw)) {
      push({ code: tn || raw, ok: false, message: t('error.INVALID_TRACKING_NUMBER') });
      return;
    }
    if (!navigator.onLine) {
      const next = offlineCodes.includes(tn) ? offlineCodes : [...offlineCodes, tn];
      setOfflineCodes(next);
      saveOffline(id, next);
      push({ code: tn, ok: true, pending: true, message: t('hero.scan.queued') });
      return;
    }
    scan.mutate(tn, {
      onError: (err) => push({ code: tn, ok: false, message: errorMessage(err) }),
    });
  };

  // Back online → send the codes scanned without a connection.
  useEffect(() => {
    if (!online || !offlineCodes.length) return;
    let cancelled = false;
    (async () => {
      const left: string[] = [];
      for (const code of offlineCodes) {
        try {
          const r = await api<ScanResult>(`/hero/tasks/pickups/${id}/scan`, { method: 'POST', body: { trackingNumber: code } });
          if (!cancelled) push({ code: r.trackingNumber, ok: true, message: t('hero.scan.synced') });
        } catch (err) {
          if (err instanceof ApiError && err.status === 0) left.push(code);
          else if (!cancelled) push({ code, ok: false, message: errorMessage(err) });
        }
      }
      if (cancelled) return;
      setOfflineCodes(left);
      saveOffline(id, left);
      refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const start = useHeroMutation(() => api<PickupDetail>(`/hero/tasks/pickups/${id}/start`, { method: 'POST' }), {
    onSuccess: (res) => {
      qc.setQueryData(['hero', 'pickup', id], res);
      refresh();
      toast.success(t('hero.pickup.started'));
    },
  });

  const complete = useHeroMutation(
    () => api<PickupDetail>(`/hero/tasks/pickups/${id}/complete`, { method: 'POST', body: { trackingNumbers: offlineCodes.length ? offlineCodes : undefined } }),
    {
      onSuccess: (res) => {
        setConfirmComplete(false);
        setOfflineCodes([]);
        saveOffline(id, []);
        qc.setQueryData(['hero', 'pickup', id], res);
        refresh();
        res.rejected?.forEach((r) => toast.error(`${r.trackingNumber}: ${errorMessage(r)}`));
        setDone({ ok: true, title: t('hero.pickup.completed'), subtitle: t('hero.pickup.completedHint', { n: res.pickedCount }) });
      },
    },
  );

  const scannedCodes = useMemo(() => new Set((pickup.data?.orders ?? []).filter((o) => o.scanned).map((o) => o.trackingNumber)), [pickup.data]);

  if (!pickup.data && pickup.isError) {
    return (
      <div>
        <PageTop title={t('hero.pickup.title')} />
        <ErrorState error={pickup.error} onRetry={() => pickup.refetch()} />
      </div>
    );
  }
  if (!pickup.data) return <PickupSkeleton />;
  const p = pickup.data;
  const active = p.status === 'ASSIGNED' || p.status === 'IN_PROGRESS';
  const started = p.status === 'IN_PROGRESS';
  const scannedTotal = p.scannedCount + offlineCodes.filter((c) => !scannedCodes.has(c)).length;
  const expected = p.ordersCount || p.expectedCount || 0;
  const unscanned = p.orders.filter((o) => !o.scanned && !offlineCodes.includes(o.trackingNumber));
  const phone = p.location?.phone ?? p.brand.phone;
  const nav = directionsLink(p.location?.lat, p.location?.lng, p.location?.addressLine);

  return (
    <div>
      <PageTop title={p.brand.name} subtitle={<Ltr className="font-mono">{p.code}</Ltr>} end={<PickupBadge status={p.status} />} />

      <Panel>
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"><Store className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-900 dark:text-white">{p.location?.name}</p>
            <p className="text-sm text-ink-500">{p.location?.addressLine}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.timeWindow && <Badge tone="info"><Clock className="h-3 w-3" /> <span className="ltr">{p.timeWindow}</span></Badge>}
              {p.zone && <Badge tone="neutral">{pick(p.zone, 'name')}</Badge>}
              {p.location?.contactName && <Badge tone="neutral"><User className="h-3 w-3" /> {p.location.contactName}</Badge>}
            </div>
          </div>
        </div>
        {p.notes && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">📝 {p.notes}</p>}
        {p.location?.lat != null && p.location?.lng != null && (
          <div className="mt-3">
            <Suspense fallback={<Skeleton className="h-[170px] rounded-2xl" />}>
              <StopMiniMap lat={p.location.lat} lng={p.location.lng} kind="pickup" />
            </Suspense>
          </div>
        )}
      </Panel>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <BigAction href={telLink(phone)} icon={<Phone />} label={t('action.call')} tone="green" disabled={!phone} />
        <BigAction href={nav} icon={<Navigation />} label={t('action.navigate')} tone="sky" external disabled={!nav} />
      </div>

      <Panel className="mt-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-500">{t('hero.pickup.scanned')}</p>
            <p className="font-display text-4xl font-extrabold text-ink-900 dark:text-white">
              <span className="ltr tabular">{num(scannedTotal)}<span className="text-xl text-ink-400"> / {num(expected)}</span></span>
            </p>
          </div>
          <div className="text-end text-xs text-ink-500">
            {p.expectedCount != null && p.expectedCount !== p.ordersCount && <p>{t('hero.pickup.brandExpects', { n: p.expectedCount })}</p>}
            {p.startedAt && <p>{t('hero.pickup.startedAt', { time: timeOnly(p.startedAt) })}</p>}
          </div>
        </div>
        <ProgressBar value={expected ? scannedTotal / expected : 0} className="mt-3 h-3" />
      </Panel>

      {p.status === 'FAILED' && p.failureNote && (
        <div className="mt-3 rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900">{p.failureNote}</div>
      )}
      {p.status === 'COMPLETED' && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-turtle-600 p-4 text-white">
          <PackageCheck className="h-7 w-7" />
          <p className="font-bold">{t('hero.pickup.completedAt', { time: timeOnly(p.completedAt) })}</p>
        </div>
      )}

      {started && (
        <>
          <SectionTitle>{t('hero.scan.title')}</SectionTitle>
          {cameraScanSupported() && (
            <Button size="xl" block variant="secondary" icon={<ScanBarcode className="h-6 w-6" />} onClick={() => setScanning(true)}>
              {t('hero.scan.camera')}
            </Button>
          )}
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!manual.trim()) return;
              submitCode(manual);
              setManual('');
              manualRef.current?.focus();
            }}
          >
            <Input
              ref={manualRef}
              aria-label={t('hero.scan.manualLabel')}
              placeholder="GT0000000000"
              value={manual}
              onChange={(e) => setManual(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              className="ltr h-12 flex-1 font-mono text-base"
              maxLength={20}
            />
            <Button type="submit" size="lg" className="h-12 shrink-0" loading={scan.isPending} disabled={!manual.trim()}>
              {t('action.add')}
            </Button>
          </form>
          {!cameraScanSupported() && <p className="mt-1 px-1 text-xs text-ink-500">{t('hero.scan.noCamera')}</p>}
          {offlineCodes.length > 0 && (
            <p className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <CloudOff className="h-4 w-4" /> {t('hero.scan.offlineQueued', { n: offlineCodes.length })}
            </p>
          )}
          {log.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {log.slice(0, 6).map((l) => (
                <li key={l.code} className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', l.ok ? 'bg-turtle-50 text-turtle-900 dark:bg-turtle-950 dark:text-turtle-100' : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100')}>
                  {l.ok ? <CircleCheck className="h-4 w-4 shrink-0" /> : <CircleX className="h-4 w-4 shrink-0" />}
                  <Ltr className="font-mono font-semibold">{l.code}</Ltr>
                  <span className="min-w-0 flex-1 truncate text-xs opacity-80">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <SectionTitle count={p.orders.length}>{t('hero.pickup.parcelsList')}</SectionTitle>
      {p.orders.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-center text-sm text-ink-500 dark:bg-ink-900">{t('hero.pickup.noParcels')}</p>
      ) : (
        <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white dark:divide-ink-800 dark:border-ink-800 dark:bg-ink-900">
          {p.orders.map((o) => {
            const queued = offlineCodes.includes(o.trackingNumber) && !o.scanned;
            return (
              <li key={o.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', o.scanned ? 'bg-turtle-600 text-white' : queued ? 'bg-amber-400 text-ink-950' : 'bg-ink-100 text-ink-400 dark:bg-ink-800')}>
                  {o.scanned ? <CircleCheck className="h-5 w-5" /> : queued ? <CloudOff className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <Ltr className="font-mono text-sm font-bold text-ink-900 dark:text-white">{o.trackingNumber}</Ltr>
                  <p className="truncate text-xs text-ink-500">{o.recipientName}{o.brandReference ? ` · ${o.brandReference}` : ''}</p>
                </div>
                <div className="text-end text-xs text-ink-500">
                  {o.collectCents > 0 ? <Money cents={o.collectCents} className="font-semibold text-ink-700 dark:text-ink-200" /> : t('hero.prepaid')}
                  <p>{t('hero.stop.items', { n: o.itemsCount })}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {active && (
        <StickyBar>
          {!started ? (
            <Button size="xl" block className="shadow-pop" loading={start.isPending} icon={<Play className="h-5 w-5" />} onClick={() => start.mutate(undefined)}>
              {t('hero.pickup.start')}
            </Button>
          ) : (
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <Button variant="outline" size="xl" className="border-red-200 px-2 text-red-600 dark:border-red-900 dark:text-red-400" onClick={() => setFailOpen(true)} disabled={p.scannedCount > 0}>
                {t('hero.pickup.fail')}
              </Button>
              <Button size="xl" className="px-2 shadow-pop" icon={<PackageCheck className="h-5 w-5" />} disabled={scannedTotal === 0 || !online} onClick={() => setConfirmComplete(true)}>
                {t('hero.pickup.complete', { n: scannedTotal })}
              </Button>
            </div>
          )}
          {started && !online && <OfflineBlock className="mt-2" />}
        </StickyBar>
      )}

      <Scanner open={scanning} onClose={() => setScanning(false)} onCode={submitCode} feedback={feedback} count={scannedTotal} />

      <ConfirmDialog
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        onConfirm={() => complete.mutate(undefined)}
        loading={complete.isPending}
        title={t('hero.pickup.completeTitle', { n: scannedTotal })}
        confirmLabel={t('hero.pickup.completeConfirm')}
      >
        {unscanned.length > 0 ? (
          <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <TriangleAlert className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-bold">{t('hero.pickup.unscannedWarn', { n: unscanned.length })}</p>
              <p className="mt-1 text-xs">{t('hero.pickup.unscannedHint')}</p>
              <p className="ltr mt-2 font-mono text-xs">{unscanned.slice(0, 5).map((o) => o.trackingNumber).join(' · ')}{unscanned.length > 5 ? ' …' : ''}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-600 dark:text-ink-300">{t('hero.pickup.allScanned')}</p>
        )}
      </ConfirmDialog>

      <FailPickupSheet
        open={failOpen}
        onClose={() => setFailOpen(false)}
        pickupId={id}
        onDone={(res) => {
          setFailOpen(false);
          qc.setQueryData(['hero', 'pickup', id], res);
          refresh();
          setDone({ ok: false, title: t('hero.pickup.failed'), subtitle: res.failureNote ?? '' });
        }}
      />

      <SuccessOverlay
        open={!!done}
        tone={done?.ok ? 'green' : 'amber'}
        title={done?.title}
        subtitle={done?.subtitle}
        continueLabel={t('hero.done.backToday')}
        onContinue={() => {
          setDone(null);
          navigate('/hero', { replace: true });
        }}
      />
    </div>
  );
}

function PickupBadge({ status }: { status: PickupDetail['status'] }) {
  const { t } = useI18n();
  const tone = status === 'IN_PROGRESS' ? 'progress' : status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'danger' : status === 'CANCELLED' ? 'neutral' : 'info';
  return <Badge tone={tone} dot>{t(`hero.pickup.status.${status}`)}</Badge>;
}

function FailPickupSheet({ open, onClose, pickupId, onDone }: { open: boolean; onClose: () => void; pickupId: string; onDone: (res: PickupDetail) => void }) {
  const { t } = useI18n();
  const online = useOnline();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) setNote('');
  }, [open]);
  const fail = useHeroMutation(() => api<PickupDetail>(`/hero/tasks/pickups/${pickupId}/fail`, { method: 'POST', body: { note: note.trim() } }), { onSuccess: onDone });
  const quick = ['closed', 'notReady', 'noOne', 'cancelled'] as const;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('hero.pickup.failTitle')}
      footer={
        <div className="space-y-2 pb-1">
          {!online && <OfflineBlock />}
          <Button variant="danger" size="xl" block disabled={note.trim().length < 3 || !online} loading={fail.isPending} onClick={() => fail.mutate(undefined)}>
            {t('hero.pickup.failConfirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Chips value={null} onChange={(v) => setNote(t(`hero.pickup.failReason.${v}`))} options={quick.map((q) => ({ value: q, label: t(`hero.pickup.failReason.${q}`) }))} />
        <Field label={t('hero.pickup.failNote')} required hint={t('hero.pickup.failNoteHint')}>
          {(fid) => <Textarea id={fid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
        </Field>
      </div>
    </Sheet>
  );
}

function PickupSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid grid-cols-2 gap-2"><Skeleton className="h-[68px] rounded-2xl" /><Skeleton className="h-[68px] rounded-2xl" /></div>
      <Skeleton className="h-28 rounded-2xl" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
    </div>
  );
}
