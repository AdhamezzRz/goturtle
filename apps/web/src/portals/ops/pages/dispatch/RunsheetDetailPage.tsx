import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Lock, Navigation, PackagePlus, Printer, Route, Send, Trash2, Wallet } from 'lucide-react';
import type { OrderStatus } from '@goturtle/shared';
import { ApiError, api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePollInterval } from '@/lib/hooks';
import { dateOnly, dateTime, money, num, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, ConfirmDialog, DataTable, ErrorState, Field, IconButton, Modal, ProgressBar, Skeleton, StateBadge, StatusBadge, Textarea } from '@/components/ui';
import { CallButton, MiniStat, Mono, NoAccess, SectionCard } from '../../components/opsa/ui';
import { MAP_COLORS, OpsMap, heroColor, initials, type OpsMarker } from '../../components/opsa/OpsMap';
import type { OrderRow, RunsheetProgress } from '../../components/opsa/types';
import '../orders/i18n';
import './i18n';

interface Stop {
  id: string; trackingNumber: string; status: OrderStatus; type: string; routeSequence: number | null; recipientName: string; recipientPhone: string; addressLine: string;
  landmark: string | null; lat: number | null; lng: number | null; notes: string | null; collectCents: number; collectedCents: number; paymentMethod: string; itemsCount: number;
  attempts: number; promisedBy: string | null; deliveredAt: string | null; zone: { id: string; code: string; nameEn: string; nameAr: string; centerLat: number; centerLng: number } | null;
  brand: { id: string; code: string; name: string } | null; isOpen: boolean; etaMinutes: number | null; eta: string | null; legKm: number | null; mapsUrl: string | null;
}
interface RunsheetDetail {
  id: string; code: string; courierId: string; hubId: string | null; date: string; status: 'DRAFT' | 'DISPATCHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';
  route: Array<{ orderId: string; seq: number; lat: number; lng: number; etaMinutes: number; legKm: number }> | null;
  totalDistanceKm: number | null; totalMinutes: number | null; expectedCodCents: number; collectedCents: number; codToCollectCents: number; dispatchedAt: string | null; closedAt: string | null;
  courier: { id: string; code: string; name: string; vehicleType: string; vehiclePlate: string | null; phone: string; cashOnHandCents: number; cashLimitCents: number; lastLat: number | null; lastLng: number | null; lastSeenAt: string | null };
  hub: { id: string; code: string; name: string; lat: number; lng: number } | null;
  progress: RunsheetProgress;
  stops: Stop[];
}
interface Manifest {
  code: string; date: string; status: string; generatedAt: string;
  hero: { code: string; name: string; phone: string; vehicleType: string; vehiclePlate: string | null };
  hub: { code: string; name: string } | null;
  totals: { stops: number; codCents: number; pieces: number; distanceKm: number | null; minutes: number | null };
  stops: Array<{ seq: number | null; trackingNumber: string; brandCode: string; recipientName: string; phone: string; address: string; landmark: string | null; zone: string; collectCents: number; paymentMethod: string; pieces: number; notes: string | null; allowOpening: boolean; otpRequired: boolean; status: string }>;
}

export default function RunsheetDetailPage() {
  const { id = '' } = useParams();
  const { t, dir, locale } = useI18n();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const poll = usePollInterval(20_000);
  const [modal, setModal] = useState<null | 'dispatch' | 'cash' | 'close' | 'add'>(null);
  const [cashInfo, setCashInfo] = useState<{ cashLimitCents: number; cashOnHandCents: number; outForDeliveryCents: number; runsheetCodCents: number } | null>(null);
  const [removeStop, setRemoveStop] = useState<Stop | null>(null);
  const [closeNotes, setCloseNotes] = useState('');
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['runsheets', id], queryFn: () => api<RunsheetDetail>(`/runsheets/${id}`), enabled: can('runsheets.read'), refetchInterval: poll });
  const manifest = useQuery({ queryKey: ['runsheets', id, 'manifest'], queryFn: () => api<Manifest>(`/runsheets/${id}/manifest`), enabled: false });
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const manage = can('runsheets.manage');
  const canOverride = me?.role === 'SUPER_ADMIN' || me?.role === 'OPS_MANAGER';

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['runsheets'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['dispatch'] });
  };
  const optimize = useMutation({
    mutationFn: () => api<RunsheetDetail>(`/runsheets/${id}/optimize`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(t('ops.dispatch.d.optimized', { km: t('ops.opsa.unit.km', { n: num(r.totalDistanceKm ?? 0) }), min: t('ops.opsa.unit.min', { n: num(r.totalMinutes ?? 0) }) }));
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dispatch = useMutation({
    mutationFn: (override: boolean) => api(`/runsheets/${id}/dispatch`, { method: 'POST', body: { override: override || undefined } }),
    onSuccess: () => {
      toast.success(t('ops.dispatch.d.dispatched'));
      setModal(null);
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'CASH_LIMIT_EXCEEDED') {
        setCashInfo((e.details as typeof cashInfo) ?? null);
        setModal('cash');
        return;
      }
      toast.error(errorMessage(e));
    },
  });
  const close = useMutation({
    mutationFn: () => api(`/runsheets/${id}/close`, { method: 'POST', body: { notes: closeNotes || undefined } }),
    onSuccess: () => {
      toast.success(t('ops.dispatch.d.closed'));
      setModal(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (orderId: string) => api(`/runsheets/${id}/orders`, { method: 'DELETE', body: { orderIds: [orderId] } }),
    onSuccess: () => {
      toast.success(t('ops.dispatch.d.removed'));
      setRemoveStop(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rs = q.data;
  const stops = useMemo(() => [...(rs?.stops ?? [])].sort((a, b) => (a.routeSequence ?? 999) - (b.routeSequence ?? 999)), [rs]);
  const markers = useMemo<OpsMarker[]>(() => {
    if (!rs) return [];
    const m: OpsMarker[] = [];
    if (rs.hub) m.push({ id: 'hub', type: 'hub', lat: rs.hub.lat, lng: rs.hub.lng, title: `${rs.hub.name} · ${rs.hub.code}` });
    for (const s of stops) {
      const lat = s.lat ?? s.zone?.centerLat;
      const lng = s.lng ?? s.zone?.centerLng;
      if (lat == null || lng == null) continue;
      const color = s.status === 'DELIVERED' ? MAP_COLORS.done : ['FAILED_ATTEMPT', 'RETURN_PENDING', 'RESCHEDULED'].includes(s.status) ? MAP_COLORS.failed : MAP_COLORS.order;
      m.push({ id: s.id, type: 'pin', lat, lng, color, label: s.routeSequence ?? '•', selected: s.id === selectedStop, title: `${s.routeSequence ?? ''} · ${s.trackingNumber} · ${s.recipientName}`, onClick: () => setSelectedStop(s.id) });
    }
    if (rs.courier.lastLat != null && rs.courier.lastLng != null && rs.status !== 'DRAFT' && rs.status !== 'CLOSED') {
      m.push({ id: 'hero', type: 'hero', lat: rs.courier.lastLat, lng: rs.courier.lastLng, color: heroColor({ availability: 'BUSY' }), label: initials(rs.courier.name), pulse: true, title: rs.courier.name });
    }
    return m;
  }, [rs, stops, selectedStop]);
  const route = useMemo(() => {
    if (!rs) return [];
    const pts: Array<[number, number]> = [];
    if (rs.hub) pts.push([rs.hub.lat, rs.hub.lng]);
    for (const s of stops) {
      const lat = s.lat ?? s.zone?.centerLat;
      const lng = s.lng ?? s.zone?.centerLng;
      if (lat != null && lng != null) pts.push([lat, lng]);
    }
    return pts.length > 1 ? [{ id: 'route', positions: pts }] : [];
  }, [rs, stops]);

  const flyTarget = useMemo<[number, number] | null>(() => {
    const st = stops.find((x) => x.id === selectedStop);
    const lat = st?.lat ?? st?.zone?.centerLat;
    const lng = st?.lng ?? st?.zone?.centerLng;
    return lat != null && lng != null ? [lat, lng] : null;
  }, [stops, selectedStop]);

  const printManifest = async () => {
    const r = await manifest.refetch();
    if (r.error) toast.error(errorMessage(r.error));
    else setTimeout(() => window.print(), 150);
  };

  if (!can('runsheets.read')) return <NoAccess />;
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>;
  if (q.error || !rs) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const isDraft = rs.status === 'DRAFT';
  const usage = rs.courier.cashLimitCents ? rs.courier.cashOnHandCents / rs.courier.cashLimitCents : 0;

  return (
    <>
      <div className="space-y-6 no-print">
        <Link to="/ops/dispatch?tab=runsheets" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"><Back className="h-4 w-4" /> {t('ops.dispatch.d.back')}</Link>

        <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: heroColor({ availability: rs.status === 'DRAFT' ? 'ONLINE' : 'BUSY' }) }}>{initials(rs.courier.name)}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="ltr font-mono text-xl font-bold">{rs.code}</h1>
                  <StateBadge value={rs.status} label={t(`ops.opsa.rs.${rs.status}`)} />
                </div>
                <p className="truncate text-sm text-ink-500">
                  {rs.courier.name} · <span className="ltr">{rs.courier.code}</span> · {rs.hub?.name ?? '—'} · {dateOnly(rs.date)}
                  {rs.dispatchedAt && <> · {t('ops.dispatch.d.dispatchedAt', { t: timeOnly(rs.dispatchedAt) })}</>}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CallButton value={rs.courier.phone} name={rs.courier.name} size="md" />
              <Button variant="outline" icon={<Printer className="h-4 w-4" />} loading={manifest.isFetching} onClick={printManifest} disabled={!rs.stops.length}>{t('ops.dispatch.d.manifest')}</Button>
              {manage && isDraft && (
                <>
                  <Button variant="outline" icon={<PackagePlus className="h-4 w-4" />} onClick={() => setModal('add')}>{t('ops.dispatch.d.addOrders')}</Button>
                  <Button variant="outline" icon={<Route className="h-4 w-4" />} loading={optimize.isPending} disabled={!rs.stops.length} onClick={() => optimize.mutate()}>{t('ops.dispatch.d.optimize')}</Button>
                  <Button icon={<Send className="h-4 w-4" />} disabled={!rs.stops.length} onClick={() => setModal('dispatch')}>{t('ops.dispatch.d.dispatch')}</Button>
                </>
              )}
              {manage && (rs.status === 'IN_PROGRESS' || rs.status === 'DISPATCHED') && (
                <Button variant="outline" icon={<Route className="h-4 w-4" />} loading={optimize.isPending} onClick={() => optimize.mutate()}>{t('ops.dispatch.d.optimize')}</Button>
              )}
              {manage && rs.status !== 'DRAFT' && rs.status !== 'CLOSED' && (
                <Button variant="secondary" icon={<Lock className="h-4 w-4" />} onClick={() => { setCloseNotes(''); setModal('close'); }}>{t('ops.dispatch.d.close')}</Button>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MiniStat label={t('ops.dispatch.d.m.stops')} value={t('ops.dispatch.rs.stops', { done: num(rs.progress.done), total: num(rs.progress.total) })} />
            <MiniStat label={t('ops.dispatch.d.distance')} value={rs.totalDistanceKm != null ? t('ops.opsa.unit.km', { n: num(rs.totalDistanceKm) }) : '—'} />
            <MiniStat label={t('ops.dispatch.d.duration')} value={rs.totalMinutes != null ? t('ops.opsa.unit.min', { n: num(rs.totalMinutes) }) : '—'} />
            <MiniStat label={t('ops.dispatch.d.expected')} value={money(rs.expectedCodCents || stops.reduce((s, x) => s + x.collectCents, 0))} tone="cash" />
            <MiniStat label={t('ops.dispatch.d.collected')} value={money(rs.collectedCents)} tone="success" />
            <MiniStat label={t('ops.dispatch.d.toCollect')} value={money(rs.codToCollectCents)} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar value={rs.progress.percent / 100} className="flex-1" />
            <span className="ltr text-xs font-semibold text-ink-500">{num(rs.progress.percent)}%</span>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-5">
          <div className="min-w-0 xl:col-span-3">
            <div className="xl:sticky xl:top-24">
              <OpsMap markers={markers} routes={route} height={460} fitKey={`${rs.id}:${stops.length}`} flyTo={flyTarget} />
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-ink-100 bg-white p-3 text-sm dark:border-ink-800 dark:bg-ink-900">
                <Wallet className="h-4 w-4 text-sand-600" />
                <span className="text-ink-500">{t('ops.dispatch.d.cashOnHand')}</span>
                <ProgressBar value={usage} tone={usage >= 1 ? 'red' : usage >= 0.9 ? 'sand' : 'turtle'} className="min-w-[100px] flex-1" />
                <span className="ltr text-xs font-semibold">{money(rs.courier.cashOnHandCents)} / {money(rs.courier.cashLimitCents)}</span>
              </div>
            </div>
          </div>
          <SectionCard title={t('ops.dispatch.d.stops')} className="min-w-0 xl:col-span-2" padded={false}>
            {stops.length === 0 ? (
              <p className="p-5 text-sm text-ink-500">{t('ops.dispatch.d.noStops')}</p>
            ) : (
              <ol className="divide-y divide-ink-100 dark:divide-ink-800">
                {stops.map((s) => (
                  <li key={s.id} className={cn('flex gap-3 px-4 py-3 transition-colors', s.id === selectedStop && 'bg-sand-50 dark:bg-sand-900/20')} onClick={() => setSelectedStop(s.id)}>
                    <span className={cn('ltr grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white', s.status === 'DELIVERED' ? 'bg-turtle-500' : s.isOpen ? 'bg-ink-900 dark:bg-ink-600' : 'bg-amber-500')}>{s.routeSequence ?? '•'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link to={`/ops/orders/${s.id}`} className="hover:underline"><Mono className="text-xs font-semibold">{s.trackingNumber}</Mono></Link>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="mt-0.5 truncate text-sm font-medium">{s.recipientName} <span className="text-xs font-normal text-ink-400">· {s.brand?.code}</span></p>
                      <p className="truncate text-xs text-ink-500">{s.addressLine} · {s.zone ? (locale === 'ar' ? s.zone.nameAr : s.zone.nameEn) : ''}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
                        {s.collectCents ? <span className="ltr font-semibold text-sand-700 dark:text-sand-300">{money(s.collectCents)}</span> : <Badge className="text-[10px]">{t('ops.orders.prepaid')}</Badge>}
                        {s.eta && s.isOpen && <span>{t('ops.dispatch.d.eta', { t: timeOnly(s.eta) })}</span>}
                        {s.legKm != null && <span className="ltr">{t('ops.dispatch.d.leg', { km: t('ops.opsa.unit.km', { n: num(s.legKm) }) })}</span>}
                        {s.deliveredAt && <span>✓ {timeOnly(s.deliveredAt)}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      {s.mapsUrl && <a href={s.mapsUrl} target="_blank" rel="noreferrer" aria-label={t('ops.dispatch.d.openMaps')} title={t('ops.dispatch.d.openMaps')} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><Navigation className="h-4 w-4" /></a>}
                      {manage && isDraft && <IconButton label={t('ops.dispatch.d.remove')} icon={<Trash2 className="h-4 w-4 text-red-500" />} onClick={() => setRemoveStop(s)} />}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>
      </div>

      {/* modals */}
      <ConfirmDialog open={modal === 'dispatch'} onClose={() => setModal(null)} onConfirm={() => dispatch.mutate(false)} loading={dispatch.isPending} title={t('ops.dispatch.d.dispatchTitle', { code: rs.code })} description={t('ops.dispatch.d.dispatchDesc', { n: num(rs.stops.length) })} confirmLabel={t('ops.dispatch.d.dispatch')} />
      <Modal
        open={modal === 'cash'}
        onClose={() => setModal(null)}
        title={t('ops.dispatch.d.cashTitle')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModal(null)}>{t('action.cancel')}</Button>
            {canOverride && <Button variant="danger" loading={dispatch.isPending} onClick={() => dispatch.mutate(true)}>{t('ops.dispatch.d.cashOverride')}</Button>}
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {cashInfo && (
            <p>{t('ops.dispatch.d.cashDesc', { name: rs.courier.name, held: money(cashInfo.cashOnHandCents + cashInfo.outForDeliveryCents), cod: money(cashInfo.runsheetCodCents), limit: money(cashInfo.cashLimitCents) })}</p>
          )}
          {cashInfo && <ProgressBar value={(cashInfo.cashOnHandCents + cashInfo.outForDeliveryCents + cashInfo.runsheetCodCents) / Math.max(1, cashInfo.cashLimitCents)} tone="red" />}
          {!canOverride && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">{t('ops.dispatch.d.cashNoOverride')}</p>}
        </div>
      </Modal>
      <ConfirmDialog open={modal === 'close'} onClose={() => setModal(null)} onConfirm={() => close.mutate()} loading={close.isPending} title={t('ops.dispatch.d.closeTitle', { code: rs.code })} description={t('ops.dispatch.d.closeDesc')} confirmLabel={t('ops.dispatch.d.close')}>
        <Field label={t('ops.dispatch.d.closeNotes')}>{(fid) => <Textarea id={fid} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} maxLength={1000} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={!!removeStop} onClose={() => setRemoveStop(null)} onConfirm={() => removeStop && remove.mutate(removeStop.id)} loading={remove.isPending} danger title={t('ops.dispatch.d.removeTitle', { tn: removeStop?.trackingNumber ?? '' })} description={t('ops.dispatch.d.removeDesc')} confirmLabel={t('ops.dispatch.d.remove')} />
      {modal === 'add' && <AddOrdersModal rs={rs} onClose={() => setModal(null)} onDone={invalidate} />}

      {manifest.data && <ManifestPrint m={manifest.data} />}
    </>
  );
}

function AddOrdersModal({ rs, onClose, onDone }: { rs: RunsheetDetail; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const query = { status: 'RECEIVED_AT_HUB', hubId: rs.hubId ?? undefined, pageSize: 200, sort: 'promisedBy', order: 'asc' };
  const list = useQuery({ queryKey: ['orders', 'list', query], queryFn: () => api<Paginated<OrderRow>>('/orders', { query }) });
  const add = useMutation({
    mutationFn: () => api(`/runsheets/${rs.id}/orders`, { method: 'POST', body: { orderIds: [...selected] } }),
    onSuccess: () => {
      toast.success(t('ops.dispatch.d.added', { n: num(selected.size) }));
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={t('ops.dispatch.d.addTitle', { hub: rs.hub?.name ?? '' })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={!selected.size} loading={add.isPending} onClick={() => add.mutate()}>{t('ops.dispatch.d.add', { n: num(selected.size) })}</Button>
        </>
      }
    >
      <DataTable
        columns={[
          { key: 'tn', header: t('ops.dispatch.col.order'), cell: (r) => <div><Mono className="font-semibold">{r.trackingNumber}</Mono><p className="text-xs text-ink-500">{r.recipientName}</p></div> },
          { key: 'zone', header: t('ops.dispatch.col.zone'), cell: (r) => (r.zone ? (locale === 'ar' ? r.zone.nameAr : r.zone.nameEn) : '—') },
          { key: 'cod', header: t('ops.dispatch.col.collect'), cell: (r) => <span className="ltr">{r.collectCents ? money(r.collectCents) : '—'}</span> },
        ]}
        rows={list.data?.data}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.error}
        selected={selected}
        onSelectChange={setSelected}
        dense
        empty={t('ops.dispatch.empty')}
        mobileCard={(r) => <div className="flex items-center justify-between gap-2"><div><Mono className="font-semibold">{r.trackingNumber}</Mono><p className="text-xs text-ink-500">{r.zone ? (locale === 'ar' ? r.zone.nameAr : r.zone.nameEn) : ''}</p></div><span className="ltr text-sm">{r.collectCents ? money(r.collectCents) : ''}</span></div>}
      />
    </Modal>
  );
}

/** A4 manifest, rendered only for printing. */
function ManifestPrint({ m }: { m: Manifest }) {
  const { t } = useI18n();
  return (
    <div className="manifest-print print-only text-ink-950">
      <style>{'@media print { @page { size: A4; margin: 12mm; } body * { visibility: hidden; } .manifest-print, .manifest-print * { visibility: visible; } .manifest-print { position: absolute; inset: 0; background: #fff; } .manifest-print table { page-break-inside: auto; } .manifest-print tr { page-break-inside: avoid; } }'}</style>
      <div className="flex items-start justify-between border-b-2 border-ink-900 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest">GoTurtle · {t('ops.dispatch.d.manifestTitle')}</p>
          <p className="font-mono text-2xl font-bold"><span className="ltr">{m.code}</span></p>
          <p className="text-sm">{dateOnly(m.date)} · {m.hub?.name} (<span className="ltr">{m.hub?.code}</span>)</p>
        </div>
        <div className="text-end text-sm">
          <p className="font-semibold">{m.hero.name} · <span className="ltr">{m.hero.code}</span></p>
          <p><span className="ltr">{m.hero.phone}</span></p>
          <p>{t(`ops.opsa.vehicle.${m.hero.vehicleType}`)}{m.hero.vehiclePlate ? ` · ${m.hero.vehiclePlate}` : ''}</p>
        </div>
      </div>
      <div className="my-3 grid grid-cols-4 gap-3 text-sm">
        <div><p className="text-xs">{t('ops.dispatch.d.m.stops')}</p><p className="text-lg font-bold"><span className="ltr">{m.totals.stops}</span></p></div>
        <div><p className="text-xs">{t('ops.dispatch.d.m.pcs')}</p><p className="text-lg font-bold"><span className="ltr">{m.totals.pieces}</span></p></div>
        <div><p className="text-xs">{t('ops.dispatch.d.m.cod')}</p><p className="text-lg font-bold"><span className="ltr">{money(m.totals.codCents)}</span></p></div>
        <div><p className="text-xs">{t('ops.dispatch.d.distance')}</p><p className="text-lg font-bold"><span className="ltr">{m.totals.distanceKm != null ? t('ops.opsa.unit.km', { n: num(m.totals.distanceKm) }) : '—'}</span></p></div>
      </div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-y border-ink-900 text-start">
            <th className="p-1 text-start">{t('ops.dispatch.d.m.seq')}</th>
            <th className="p-1 text-start">{t('ops.orders.col.tracking')}</th>
            <th className="p-1 text-start">{t('ops.dispatch.d.m.recipient')}</th>
            <th className="p-1 text-end">{t('ops.dispatch.d.m.collect')}</th>
            <th className="p-1 text-center">{t('ops.dispatch.d.m.pieces')}</th>
            <th className="w-28 p-1 text-start">{t('ops.dispatch.d.m.sign')}</th>
          </tr>
        </thead>
        <tbody>
          {m.stops.map((s) => (
            <tr key={s.trackingNumber} className="border-b border-ink-300 align-top">
              <td className="ltr p-1 font-bold">{s.seq ?? '–'}</td>
              <td className="p-1"><span className="ltr font-mono font-semibold">{s.trackingNumber}</span><br /><span className="ltr">{s.brandCode} · {s.zone}</span></td>
              <td className="p-1"><b>{s.recipientName}</b> · <span className="ltr">{s.phone}</span><br />{s.address}{s.landmark ? ` — ${s.landmark}` : ''}{s.notes ? <><br /><i>{s.notes}</i></> : null}</td>
              <td className="ltr p-1 text-end font-bold">{s.collectCents ? money(s.collectCents) : '—'}</td>
              <td className="ltr p-1 text-center">{s.pieces}</td>
              <td className="p-1" />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
        <div className="border-t border-ink-900 pt-1">{t('ops.dispatch.d.m.heroSign')}</div>
        <div className="border-t border-ink-900 pt-1">{t('ops.dispatch.d.m.hubSign')}</div>
      </div>
      <p className="mt-4 text-[10px] text-ink-500">{t('ops.dispatch.d.m.generated', { t: dateTime(m.generatedAt) })}</p>
    </div>
  );
}
