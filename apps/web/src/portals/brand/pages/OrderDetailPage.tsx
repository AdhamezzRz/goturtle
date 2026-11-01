import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Ban, Bike, CalendarClock, Headphones, Link2, MapPin, Package, Pencil, Phone, Printer, ShieldCheck, Star, Truck, User, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { FailureReason, normalizeEgyptPhone, type OrderStatus } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { usePollInterval } from '@/lib/hooks';
import { dateOnly, dateTime, num, parseEgp, phone } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import {
  Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, StatusBadge, Switch, Textarea, Timeline,
} from '@/components/ui';
import { copyText, CopyButton, Ltr, Money, nameOf, Row, SectionTitle } from '../components/common';
import { ProgressSteps } from '../components/orders';
import { CreateTicketModal } from '../components/tickets';
import type { OrderDetail } from '../components/types';
import { BrandOrderIntegrity } from '@/features/integrity/brand/BrandIntegrity';
import './i18n';

const PinMap = lazy(() => import('../components/PinMap'));

const KNOWN_REASONS = new Set<string>([...Object.keys(FailureReason), 'UPDATED', 'RETURN_RECEIVED_AT_HUB', 'RETURN_BACK_AT_HUB', 'REMOVED_FROM_RUNSHEET', 'PICKUP_RELEASED', 'LOADED', 'HUB_TRANSFER', 'HANDOVER_TO_HUB_DECLARED', 'CUSTOMER_ADDRESS_UPDATE', 'COURIER_REASSIGNED', 'COURIER_NOT_ACTIVE', 'CANCELLED_BY_INTEGRATION']);

const EXCEPTION: Partial<Record<OrderStatus, 'danger' | 'neutral' | 'warning'>> = {
  RETURN_PENDING: 'danger', RETURN_OUT: 'danger', RETURNED: 'neutral', CANCELLED: 'neutral', LOST: 'danger', DAMAGED: 'danger',
  FAILED_ATTEMPT: 'warning', RESCHEDULED: 'warning', ON_HOLD: 'warning',
};

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const { t, locale, dir } = useI18n();
  const { can } = useAuth();
  const poll = usePollInterval(30_000);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['orders', 'detail', id], queryFn: () => api<OrderDetail>(`/orders/${id}`), refetchInterval: poll });
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [reason, setReason] = useState('');

  const cancel = useMutation({
    mutationFn: () => api(`/orders/${id}/cancel`, { method: 'POST', body: { reason: reason.trim() || undefined } }),
    onSuccess: () => {
      toast.success(t('brand.order.cancelled'));
      setCancelOpen(false);
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const Back = <Link to="/brand/orders" className="inline-flex items-center gap-1 hover:text-ink-800 dark:hover:text-ink-200"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('brand.orders.title')}</Link>;

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-6 lg:grid-cols-3"><Skeleton className="h-80 lg:col-span-2" /><Skeleton className="h-80" /></div>
      </div>
    );
  }
  if (q.isError || !q.data) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Card>
        <div className="mb-2 text-sm text-ink-500">{Back}</div>
        {nf ? <EmptyState icon={<Package className="h-7 w-7" />} title={t('brand.order.notFound')} description={t('brand.order.notFoundHint')} /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      </Card>
    );
  }

  const o = q.data;
  const exception = EXCEPTION[o.status];
  const trackUrl = `${window.location.origin}/t/${o.trackingNumber}`;
  const lastFail = [...o.attempts].reverse().find((a) => !a.success);
  const isCod = o.paymentMethod === 'COD';
  const brandPays = o.fees.feesPaidBy === 'BRAND';
  const netToBrand = (isCod ? o.codAmountCents : 0) - (brandPays ? o.fees.totalFeesCents : 0);
  const fullAddress = [o.addressLine, o.building && `${t('brand.new.building')} ${o.building}`, o.floor && `${t('brand.new.floor')} ${o.floor}`, o.apartment && `${t('brand.new.apartment')} ${o.apartment}`].filter(Boolean).join('، ');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 text-sm text-ink-500">{Back}</div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="ltr font-mono text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{o.trackingNumber}</h1>
            <CopyButton value={o.trackingNumber} />
            <StatusBadge status={o.status} />
            {o.slaBreached && <Badge tone="danger">{t('brand.order.late')}</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {o.brandReference && <><span className="ltr">#{o.brandReference}</span> · </>}
            {t(`brand.type.${o.type}`)} · {t(`brand.service.${o.serviceLevel}`)} · {t(`brand.source.${o.source}`)} · {dateTime(o.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/brand/orders/labels?ids=${o.id}`}><Button variant="outline" icon={<Printer className="h-4 w-4" />}>{t('brand.order.printLabel')}</Button></Link>
          <Button variant="outline" icon={<Link2 className="h-4 w-4" />} onClick={() => copyText(trackUrl, t('brand.order.linkCopied'))}>{t('brand.order.copyLink')}</Button>
          {o.canEdit && can('orders.update') && <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>{t('action.edit')}</Button>}
          {can('tickets.manage') && <Button variant="outline" icon={<Headphones className="h-4 w-4" />} onClick={() => setTicketOpen(true)}>{t('brand.order.support')}</Button>}
          {o.canCancel && can('orders.cancel') && <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelOpen(true)}>{t('brand.order.cancel')}</Button>}
        </div>
      </div>

      <BrandOrderIntegrity orderId={o.id} />

      {/* Status hero */}
      <Card className="overflow-hidden" padded={false}>
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-medium text-ink-500">{t('brand.order.currentStatus')}</p>
            <p className="mt-1 font-display text-2xl font-bold text-ink-900 dark:text-white sm:text-3xl">{o.statusLabel ? (locale === 'ar' ? o.statusLabel.ar : o.statusLabel.en) : o.status}</p>
            <p className="mt-1 text-sm text-ink-500">{statusSentence(o, t)}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {o.promisedBy && !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(o.status) && (
              <div className="rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-800/60">
                <p className="text-xs text-ink-500">{t('brand.order.promised')}</p>
                <p className="font-semibold text-ink-900 dark:text-white">{dateTime(o.promisedBy, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
              </div>
            )}
            {o.scheduledDate && (
              <div className="rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-800/60">
                <p className="text-xs text-ink-500">{t('brand.order.scheduled')}</p>
                <p className="font-semibold text-ink-900 dark:text-white">{dateOnly(o.scheduledDate + 'T12:00:00Z')}</p>
              </div>
            )}
            <div className="rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-800/60">
              <p className="text-xs text-ink-500">{t('brand.order.attempts')}</p>
              <p className="font-semibold text-ink-900 dark:text-white">{num(o.attempts.length)} / {num(o.maxAttempts)}</p>
            </div>
          </div>
        </div>
        <div className="border-t border-ink-100 px-3 py-5 dark:border-ink-800 sm:px-6">
          <ProgressSteps status={o.status} />
        </div>
        {exception && (
          <div
            className={cn(
              'flex items-start gap-3 border-t px-5 py-4 text-sm sm:px-6',
              exception === 'danger' && 'border-red-100 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200',
              exception === 'warning' && 'border-amber-100 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
              exception === 'neutral' && 'border-ink-100 bg-ink-50 text-ink-700 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-200',
            )}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{t(`brand.order.ex.${o.status}`)}</p>
              {lastFail?.failureReason && ['FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_PENDING', 'RETURN_OUT', 'RETURNED'].includes(o.status) && (
                <p className="mt-0.5">{t('brand.order.lastReason')}: {t(`brand.reason.${lastFail.failureReason}`)}{lastFail.note ? ` — ${lastFail.note}` : ''}</p>
              )}
              <p className="mt-0.5 opacity-90">{t(`brand.order.exHint.${o.status}`)}</p>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Recipient & address */}
          <Card>
            <SectionTitle icon={<User />} title={t('brand.order.recipient')} />
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-semibold text-ink-900 dark:text-white">{o.recipientName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <a href={`tel:${o.recipientPhone}`} className="inline-flex items-center gap-1 text-turtle-700 hover:underline dark:text-turtle-400"><Phone className="h-3.5 w-3.5" /><Ltr>{phone(o.recipientPhone)}</Ltr></a>
                    {o.recipientAltPhone && <a href={`tel:${o.recipientAltPhone}`} className="text-ink-500 hover:underline"><Ltr>{phone(o.recipientAltPhone)}</Ltr></a>}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <div>
                    <p className="text-ink-800 dark:text-ink-100">{fullAddress}</p>
                    {o.landmark && <p className="text-ink-500">{t('brand.new.landmark')}: {o.landmark}</p>}
                    <p className="mt-1 text-ink-500">{nameOf(o.zone, locale)}{o.zone?.city ? ` · ${nameOf(o.zone.city, locale)}` : ''}</p>
                  </div>
                </div>
                {o.notes && <p className="rounded-xl bg-ink-50 px-3 py-2 text-ink-600 dark:bg-ink-800/60 dark:text-ink-300"><span className="font-medium">{t('common.notes')}:</span> {o.notes}</p>}
              </div>
              <Suspense fallback={<Skeleton className="h-52 w-full" />}>
                {o.lat != null && o.lng != null ? (
                  <PinMap value={{ lat: o.lat, lng: o.lng }} height={210} />
                ) : o.zone ? (
                  <div className="relative">
                    <PinMap value={null} center={{ lat: o.zone.centerLat, lng: o.zone.centerLng }} zoom={13} height={210} />
                    <span className="absolute inset-x-3 bottom-3 z-[500] rounded-lg bg-white/90 px-2 py-1 text-center text-xs text-ink-600 shadow dark:bg-ink-900/90 dark:text-ink-300">{t('brand.order.noPin')}</span>
                  </div>
                ) : null}
              </Suspense>
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <SectionTitle icon={<CalendarClock />} title={t('brand.order.timeline')} />
            <Timeline
              items={[...o.timeline].reverse().map((e) => ({
                id: e.id,
                title: locale === 'ar' ? e.label.ar : e.label.en,
                time: dateTime(e.createdAt),
                tone: EXCEPTION[e.status] === 'danger' ? 'danger' : EXCEPTION[e.status] === 'warning' ? 'warning' : e.status === 'DELIVERED' ? 'success' : 'default',
                body: (
                  <>
                    {e.reason && KNOWN_REASONS.has(e.reason) && <span className="me-2">{t(`brand.reason.${e.reason}`)}</span>}
                    {e.note && <span className="me-2">“{e.note}”</span>}
                    <span className="text-xs text-ink-400">{e.actorName ?? t(`brand.actor.${e.actorType}`)}</span>
                  </>
                ),
              }))}
            />
          </Card>

          {/* Attempts */}
          {o.attempts.length > 0 && (
            <Card>
              <SectionTitle icon={<Truck />} title={t('brand.order.attemptsTitle')} />
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {o.attempts.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold', a.success ? 'bg-turtle-100 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300')}>{num(a.attemptNo)}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-ink-900 dark:text-white">{a.success ? t('brand.order.attemptOk') : a.failureReason ? t(`brand.reason.${a.failureReason}`) : t('brand.order.attemptFail')}</p>
                      <p className="text-xs text-ink-500">{dateTime(a.createdAt)}{a.courier ? ` · ${a.courier.name}` : ''}</p>
                      {a.note && <p className="mt-1 text-ink-600 dark:text-ink-300">“{a.note}”</p>}
                    </div>
                    {a.photoUrl && <a href={a.photoUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-turtle-700 hover:underline dark:text-turtle-400">{t('brand.order.photo')}</a>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Money */}
          <Card>
            <SectionTitle icon={<Wallet />} title={t('brand.order.money')} subtitle={t(`brand.payer.${o.fees.feesPaidBy}`)} />
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              <div className="pb-2">
                <Row label={isCod ? t('brand.order.codAmount') : t('brand.pay.PREPAID')} value={<Money cents={o.codAmountCents} />} />
              </div>
              <div className="py-2">
                {(o.fees.breakdown ?? []).map((b) => <Row key={b.key} muted label={t(`brand.fee.${b.key}`)} value={<Money cents={b.cents} />} />)}
                <Row label={t('brand.order.totalFees')} value={<Money cents={o.fees.totalFeesCents} />} className="font-medium" />
                {o.fees.returnFee ? <Row muted label={t('brand.fee.return')} value={<Money cents={o.fees.returnFee} />} /> : null}
              </div>
              <div className="pt-2">
                <Row label={t('brand.order.customerPays')} value={<Money cents={o.collectCents} />} />
                {o.status === 'DELIVERED' && <Row muted label={t('brand.order.collected')} value={<Money cents={o.collectedCents} />} />}
                <Row strong label={t('brand.order.netToBrand')} value={<Money cents={netToBrand} className={netToBrand < 0 ? 'text-red-600' : 'text-turtle-700 dark:text-turtle-400'} />} />
              </div>
            </div>
            {o.settlementId && <p className="mt-3 rounded-lg bg-turtle-50 px-3 py-2 text-xs text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200">{t('brand.order.inSettlement')} · <Link className="font-semibold underline" to={`/brand/wallet/settlements/${o.settlementId}`}>{t('action.view')}</Link></p>}
          </Card>

          {/* Package */}
          <Card>
            <SectionTitle icon={<Package />} title={t('brand.order.package')} />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info label={t('brand.new.description')} value={o.packageDescription || '—'} full />
              <Info label={t('brand.new.items')} value={num(o.itemsCount)} />
              <Info label={t('brand.new.weight')} value={t('brand.common.kg', { n: num(o.weightGrams / 1000) })} />
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {o.isFragile && <Badge tone="warning">{t('brand.new.fragile')}</Badge>}
              <Badge tone={o.allowOpening ? 'success' : 'neutral'}>{o.allowOpening ? t('brand.order.openYes') : t('brand.order.openNo')}</Badge>
              {o.deliveryOtpRequired && <Badge tone="info"><ShieldCheck className="h-3 w-3" />{t('brand.new.otp')}</Badge>}
            </div>
          </Card>

          {/* Hero & logistics */}
          <Card>
            <SectionTitle icon={<Bike />} title={t('brand.order.logistics')} />
            {o.courier ? (
              <div className="mb-4 flex items-center gap-3">
                <Avatar name={o.courier.name} src={o.courier.avatarUrl} size={42} />
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900 dark:text-white">{o.courier.name}</p>
                  <p className="flex items-center gap-1 text-xs text-ink-500">
                    {t(`brand.vehicle.${o.courier.vehicleType}`)} · <Star className="h-3 w-3 fill-sand-400 text-sand-400" /> <span className="ltr">{o.courier.rating.toFixed(1)}</span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="mb-4 text-sm text-ink-500">{t('brand.order.noHero')}</p>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info label={t('common.hub')} value={o.hub ? (locale === 'ar' && o.hub.nameAr ? o.hub.nameAr : o.hub.name) : '—'} />
              <Info label={t('brand.pickups.location')} value={o.pickupLocation?.name ?? '—'} />
              {o.pickup && <Info label={t('brand.order.pickup')} value={<Link to="/brand/pickups" className="ltr text-turtle-700 hover:underline dark:text-turtle-400">{o.pickup.code}</Link>} />}
              {o.pickedUpAt && <Info label={t('brand.order.pickedUpAt')} value={dateTime(o.pickedUpAt)} />}
              {o.deliveredAt && <Info label={t('brand.order.deliveredAt')} value={dateTime(o.deliveredAt)} />}
              {o.podReceivedBy && <Info label={t('brand.order.receivedBy')} value={o.podReceivedBy} />}
            </dl>
            {(o.parentOrder || o.childOrders.length > 0) && (
              <div className="mt-4 space-y-1 border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
                {o.parentOrder && <p>{t('brand.order.parent')}: <Link className="ltr font-mono text-turtle-700 hover:underline dark:text-turtle-400" to={`/brand/orders/${o.parentOrder.id}`}>{o.parentOrder.trackingNumber}</Link></p>}
                {o.childOrders.map((c) => <p key={c.id}>{t(`brand.type.${c.type}`)}: <Link className="ltr font-mono text-turtle-700 hover:underline dark:text-turtle-400" to={`/brand/orders/${c.id}`}>{c.trackingNumber}</Link></p>)}
              </div>
            )}
            {o.rating != null && (
              <div className="mt-4 rounded-xl bg-sand-50 px-3 py-2 text-sm dark:bg-sand-900/20">
                <p className="flex items-center gap-1 font-medium text-ink-900 dark:text-white">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={cn('h-4 w-4', i < o.rating! ? 'fill-sand-400 text-sand-400' : 'text-ink-300')} />)}</p>
                {o.ratingComment && <p className="mt-1 text-ink-600 dark:text-ink-300">“{o.ratingComment}”</p>}
              </div>
            )}
          </Card>
        </div>
      </div>

      {o.canEdit && <EditOrderModal open={editOpen} onClose={() => setEditOpen(false)} order={o} />}
      <CreateTicketModal open={ticketOpen} onClose={() => setTicketOpen(false)} trackingNumber={o.trackingNumber} defaultCategory={o.status === 'FAILED_ATTEMPT' ? 'RESCHEDULE' : 'INQUIRY'} />
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate()}
        loading={cancel.isPending}
        danger
        title={t('brand.order.cancelTitle', { tn: o.trackingNumber })}
        description={t('brand.order.cancelBody')}
        confirmLabel={t('brand.order.cancel')}
      >
        <Field label={t('brand.order.cancelReason')} hint={t('brand.common.optional')}>
          {(fid) => <Textarea id={fid} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} dir={dir} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function Info({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn('min-w-0', full && 'col-span-2')}>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-ink-800 dark:text-ink-100">{value}</dd>
    </div>
  );
}

function statusSentence(o: OrderDetail, t: (k: string, v?: Record<string, string | number>) => string) {
  switch (o.status) {
    case 'DELIVERED':
      return o.deliveredAt ? t('brand.order.s.delivered', { at: dateTime(o.deliveredAt) }) : '';
    case 'OUT_FOR_DELIVERY':
      return o.courier ? t('brand.order.s.out', { hero: o.courier.name.split(' ')[0] }) : '';
    case 'CREATED':
      return t('brand.order.s.created');
    case 'PICKUP_ASSIGNED':
      return t('brand.order.s.pickupAssigned');
    default:
      return o.updatedAt ? t('brand.order.s.updated', { at: dateTime(o.updatedAt) }) : '';
  }
}

function EditOrderModal({ open, onClose, order }: { open: boolean; onClose: () => void; order: OrderDetail }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const init = () => ({
    name: order.recipientName, phone: order.recipientPhone.replace(/^\+20/, '0'), altPhone: order.recipientAltPhone?.replace(/^\+20/, '0') ?? '',
    line: order.addressLine, building: order.building ?? '', floor: order.floor ?? '', apartment: order.apartment ?? '', landmark: order.landmark ?? '',
    cod: order.paymentMethod === 'COD' ? String(order.codAmountCents / 100) : '0', serviceLevel: order.serviceLevel, notes: order.notes ?? '', otp: order.deliveryOtpRequired,
  });
  const [f, setF] = useState(init);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setF(init());
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const cod = parseEgp(f.cod);
  const errors = {
    name: f.name.trim().length < 2 ? t('brand.new.errName') : undefined,
    phone: !normalizeEgyptPhone(f.phone) ? t('error.INVALID_PHONE') : undefined,
    altPhone: f.altPhone && !normalizeEgyptPhone(f.altPhone) ? t('error.INVALID_PHONE') : undefined,
    line: f.line.trim().length < 5 ? t('brand.new.errAddress') : undefined,
    cod: order.paymentMethod === 'COD' && (cod === null || cod <= 0) ? t('brand.new.errCod') : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const m = useMutation({
    mutationFn: () =>
      api(`/orders/${order.id}`, {
        method: 'PATCH',
        body: {
          recipient: { name: f.name.trim(), phone: f.phone, altPhone: f.altPhone || null },
          address: { line: f.line.trim(), building: f.building || null, floor: f.floor || null, apartment: f.apartment || null, landmark: f.landmark || null },
          ...(order.paymentMethod === 'COD' ? { codAmountCents: cod ?? 0 } : {}),
          serviceLevel: f.serviceLevel,
          notes: f.notes.trim() || null,
          deliveryOtpRequired: f.otp,
        },
      }),
    onSuccess: () => {
      toast.success(t('brand.order.updated'));
      qc.invalidateQueries({ queryKey: ['orders'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    setTouched(true);
    if (valid) m.mutate();
  };
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={t('brand.order.editTitle')} description={t('brand.order.editHint')} size="lg" footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={submit}>{t('action.save')}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('brand.new.name')} required error={touched ? errors.name : undefined} className="sm:col-span-1">{(id) => <Input id={id} value={f.name} onChange={set('name')} />}</Field>
          <Field label={t('common.phone')} required error={touched ? errors.phone : undefined}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={f.phone} onChange={set('phone')} />}</Field>
          <Field label={t('brand.new.altPhone')} error={touched ? errors.altPhone : undefined}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={f.altPhone} onChange={set('altPhone')} />}</Field>
        </div>
        <Field label={t('common.address')} required error={touched ? errors.line : undefined}>{(id) => <Input id={id} value={f.line} onChange={set('line')} />}</Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('brand.new.building')}>{(id) => <Input id={id} value={f.building} onChange={set('building')} />}</Field>
          <Field label={t('brand.new.floor')}>{(id) => <Input id={id} value={f.floor} onChange={set('floor')} />}</Field>
          <Field label={t('brand.new.apartment')}>{(id) => <Input id={id} value={f.apartment} onChange={set('apartment')} />}</Field>
        </div>
        <Field label={t('brand.new.landmark')}>{(id) => <Input id={id} value={f.landmark} onChange={set('landmark')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {order.paymentMethod === 'COD' && (
            <Field label={t('brand.new.codAmount')} required error={touched ? errors.cod : undefined}>{(id) => <div dir="ltr"><Input id={id} inputMode="decimal" value={f.cod} onChange={set('cod')} trailing={<span className="text-xs">{t('common.egp')}</span>} /></div>}</Field>
          )}
          <Field label={t('brand.new.service')}>
            {(id) => <Select id={id} value={f.serviceLevel} onChange={set('serviceLevel')} options={['STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'].map((s) => ({ value: s, label: t(`brand.service.${s}`) }))} />}
          </Field>
        </div>
        <Field label={t('brand.new.notes')}>{(id) => <Textarea id={id} rows={2} value={f.notes} onChange={set('notes')} maxLength={1000} />}</Field>
        <Switch checked={f.otp} onChange={(v) => setF({ ...f, otp: v })} label={t('brand.new.otp')} />
      </form>
    </Modal>
  );
}
