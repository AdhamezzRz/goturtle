import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Ban, Camera, ExternalLink, FileText, Headphones, MoreHorizontal, Pencil, Printer, RefreshCcw, ShieldAlert, UserPlus, Wallet,
} from 'lucide-react';
import { FailureReason, TERMINAL_STATUSES } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateOnly, dateTime, money, num } from '@/lib/format';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, EmptyState, ErrorState, Menu, RiskBadge, Skeleton, StateBadge, StatusBadge, Timeline } from '@/components/ui';
import { CallButton, CopyButton, Gauge, InfoRow, LinkButton, Mono, NoAccess, PhoneLink, SectionCard, SlaChip } from '../../components/opsa/ui';
import { MAP_COLORS, OpsMap, type OpsMarker } from '../../components/opsa/OpsMap';
import type { OrderDetail, TicketRow } from '../../components/opsa/types';
import { AssignHeroModal, CancelOrderDialog, ChangeStatusModal, EditOrderModal, Stars } from './OrderActions';
import './i18n';
import { OpsOrderMoneyPanel } from '@/features/money/orders/OrderMoneyPanels';

type ModalKey = 'status' | 'assign' | 'cancel' | 'edit' | null;

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const { t, dir } = useI18n();
  const { can } = useAuth();
  const [modal, setModal] = useState<ModalKey>(null);
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<OrderDetail>(`/orders/${id}`), enabled: can('orders.read') });
  const tickets = useQuery({
    queryKey: ['tickets', { orderId: id }],
    queryFn: () => api<Paginated<TicketRow>>('/tickets', { query: { orderId: id, pageSize: 20 } }),
    enabled: can('tickets.read'),
  });
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;

  if (!can('orders.read')) return <NoAccess />;
  if (q.isLoading) return <DetailSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error(t('ops.orders.detail.notFound'))} onRetry={() => q.refetch()} />;
  const o = q.data;
  const canAssign = can('orders.status') && (o.allowedTransitions.includes('ASSIGNED') || o.allowedTransitions.includes('PICKUP_ASSIGNED'));
  const final = TERMINAL_STATUSES.includes(o.status);

  return (
    <div className="space-y-6">
      <Link to="/ops/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
        <Back className="h-4 w-4" /> {t('ops.orders.detail.back')}
      </Link>

      {/* header */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="ltr font-mono text-xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-2xl">{o.trackingNumber}</h1>
              <CopyButton value={o.trackingNumber} />
              <StatusBadge status={o.status} />
              {o.slaBreached && <Badge tone="danger">{t('ops.orders.detail.slaBreached')}</Badge>}
            </div>
            <p className="text-sm text-ink-500">
              <span className="font-medium text-ink-700 dark:text-ink-200">{o.brand.name}</span>
              {o.brandReference && <> · <span className="ltr">{o.brandReference}</span></>}
              {' · '}
              {t('ops.orders.detail.created', { t: dateTime(o.createdAt), s: t(`ops.opsa.source.${o.source}`) })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{t(`ops.opsa.service.${o.serviceLevel}`)}</Badge>
              {o.type !== 'DELIVERY' && <Badge tone="progress">{t(`ops.opsa.type.${o.type}`)}</Badge>}
              {o.paymentMethod === 'COD' && <RiskBadge score={o.riskScore} />}
              <SlaChip due={o.promisedBy} done={final} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can('orders.status') && o.allowedTransitions.length > 0 && <Button icon={<RefreshCcw className="h-4 w-4" />} onClick={() => setModal('status')}>{t('ops.orders.detail.changeStatus')}</Button>}
            {canAssign && <Button variant="outline" icon={<UserPlus className="h-4 w-4" />} onClick={() => setModal('assign')}>{t('ops.orders.detail.reassign')}</Button>}
            <LinkButton to={`/ops/orders/labels?ids=${o.id}`} size="md" icon={<Printer />}>{t('ops.orders.detail.label')}</LinkButton>
            <Menu
              trigger={<Button variant="outline" icon={<MoreHorizontal className="h-4 w-4" />} aria-label={t('ops.orders.detail.more')} />}
              items={[
                { label: t('ops.orders.detail.edit'), icon: <Pencil className="h-4 w-4" />, onClick: () => setModal('edit'), hidden: !(can('orders.update') && o.canEdit) },
                { label: t('ops.orders.detail.track'), icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(`/t/${o.trackingNumber}`, '_blank', 'noopener') },
                { label: t('ops.orders.detail.cancel'), icon: <Ban className="h-4 w-4" />, onClick: () => setModal('cancel'), danger: true, hidden: !(can('orders.cancel') && o.canCancel) },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* side column (first on phones) */}
        <div className="space-y-6 lg:order-2">
          <RecipientCard o={o} />
          <MoneyCard o={o} />
          <OpsOrderMoneyPanel orderId={o.id} />
          <LogisticsCard o={o} />
          <PackageCard o={o} />
        </div>

        {/* main column */}
        <div className="space-y-6 lg:order-1 lg:col-span-2">
          <OrderMap o={o} />
          <SectionCard title={t('ops.orders.detail.timeline')}>
            <Timeline
              items={[...o.timeline].reverse().map((e) => ({
                id: e.id,
                title: (
                  <span className="flex flex-wrap items-center gap-2">
                    {e.label ? (dir === 'rtl' ? e.label.ar : e.label.en) : e.reason ?? '—'}
                    {!e.isPublic && <Badge className="text-[10px]">{t('ops.orders.detail.internal')}</Badge>}
                  </span>
                ),
                time: dateTime(e.createdAt),
                tone: e.status === 'DELIVERED' ? 'success' : e.status && ['FAILED_ATTEMPT', 'RETURN_PENDING', 'LOST', 'DAMAGED', 'CANCELLED'].includes(e.status) ? 'danger' : e.isStatusChange ? 'default' : 'muted',
                body: (
                  <div className="space-y-0.5">
                    {e.reason && e.label && <p className="text-xs font-medium text-ink-500">{e.reason in FailureReason ? t(`ops.opsa.reason.${e.reason}`) : e.reason.replace(/_/g, ' ').toLowerCase()}</p>}
                    {e.note && <p>{e.note}</p>}
                    <p className="text-xs text-ink-400">{t(`ops.opsa.actor.${e.actorType}`)}{e.actorName ? ` · ${e.actorName}` : ''}</p>
                  </div>
                ),
              }))}
            />
          </SectionCard>
          <AttemptsCard o={o} />
          {o.ledger && <LedgerCard o={o} />}
          {can('tickets.read') && (
            <SectionCard title={t('ops.orders.detail.tickets')} padded={false}>
              {tickets.isLoading ? (
                <div className="p-5"><Skeleton className="h-12 w-full" /></div>
              ) : !tickets.data?.data.length ? (
                <EmptyState icon={<Headphones className="h-6 w-6" />} title={t('ops.orders.detail.noTickets')} className="py-8" />
              ) : (
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {tickets.data.data.map((tk) => (
                    <li key={tk.id}>
                      <Link to={`/ops/tickets/${tk.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50 dark:hover:bg-ink-800/50">
                        <Mono className="text-xs text-ink-500">{tk.code}</Mono>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{tk.subject}</span>
                        <StateBadge value={tk.priority} />
                        <StateBadge value={tk.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
        </div>
      </div>

      <ChangeStatusModal order={o} open={modal === 'status'} onClose={() => setModal(null)} />
      <AssignHeroModal order={o} open={modal === 'assign'} onClose={() => setModal(null)} />
      <CancelOrderDialog order={o} open={modal === 'cancel'} onClose={() => setModal(null)} />
      <EditOrderModal order={o} open={modal === 'edit'} onClose={() => setModal(null)} />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2"><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
        <div className="space-y-6"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
      </div>
    </div>
  );
}

function OrderMap({ o }: { o: OrderDetail }) {
  const { t, locale } = useI18n();
  const approx = o.lat == null || o.lng == null;
  const lat = o.lat ?? o.zone.centerLat;
  const lng = o.lng ?? o.zone.centerLng;
  const markers = useMemo<OpsMarker[]>(() => {
    const m: OpsMarker[] = [{ id: 'dest', type: 'pin', lat, lng, color: approx ? MAP_COLORS.offline : MAP_COLORS.order, title: o.addressLine }];
    if (o.pickupLocation?.lat != null && o.pickupLocation.lng != null) m.push({ id: 'pickup', type: 'pin', lat: o.pickupLocation.lat, lng: o.pickupLocation.lng, color: MAP_COLORS.pickup, title: `${t('ops.orders.detail.pickupFrom')}: ${o.pickupLocation.name}` });
    return m;
  }, [lat, lng, approx, o, t]);
  return (
    <SectionCard title={t('ops.orders.detail.map')} subtitle={approx ? t('ops.orders.detail.approx') : `${locale === 'ar' ? o.zone.nameAr : o.zone.nameEn} · ${o.zone.code}`} padded={false}>
      <OpsMap markers={markers} height={260} rounded={false} className="rounded-b-2xl border-0" />
    </SectionCard>
  );
}

function RecipientCard({ o }: { o: OrderDetail }) {
  const { t } = useI18n();
  const parts = [o.building, o.floor, o.apartment].some(Boolean) ? t('ops.orders.detail.addressParts', { b: o.building ?? '—', f: o.floor ?? '—', a: o.apartment ?? '—' }) : null;
  const c = o.customer;
  return (
    <SectionCard title={t('ops.orders.detail.recipient')} actions={<CallButton value={o.recipientPhone} name={o.recipientName} />}>
      <div className="space-y-3">
        <div>
          <p className="font-semibold text-ink-900 dark:text-white">{o.recipientName}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm">
            <PhoneLink value={o.recipientPhone} />
            {o.recipientAltPhone && <PhoneLink value={o.recipientAltPhone} />}
          </div>
        </div>
        <div className="text-sm">
          <p className="text-ink-800 dark:text-ink-100">{o.addressLine}</p>
          {parts && <p className="text-ink-500">{parts}</p>}
          {o.landmark && <p className="text-ink-500">{t('ops.orders.detail.landmark')}: {o.landmark}</p>}
        </div>
        {c && (
          <div className="flex items-center gap-4 rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60">
            <Gauge value={c.reliabilityScore} size={96} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">{t('ops.orders.detail.reliability')}</p>
              <p className="text-xs text-ink-500">{t('ops.orders.detail.custOrders', { t: num(c.totalOrders), d: num(c.deliveredOrders), r: num(c.refusedOrders) })}</p>
              {c.isBlocked && <Badge tone="danger" className="mt-1">{t('ops.orders.detail.blocked')}</Badge>}
              <Link to={`/ops/customers/${c.id}`} className="mt-1 block text-xs font-semibold text-turtle-700 hover:underline dark:text-turtle-400">{t('ops.orders.detail.openCustomer')}</Link>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function MoneyCard({ o }: { o: OrderDetail }) {
  const { t } = useI18n();
  const feeKey = (k: string) => ({ shipping: 'shipping', cod: 'cod', weight: 'weight', insurance: 'insurance', exchange: 'exchange', vat: 'vat' }[k] ?? 'extra');
  const net = (o as unknown as { metadata?: { pricing?: { netToBrandCents?: number } } }).metadata?.pricing?.netToBrandCents;
  return (
    <SectionCard title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-sand-600" />{t('ops.orders.detail.money')}</span>}>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-sand-50 p-3 dark:bg-sand-900/30">
          <p className="text-xs text-sand-800 dark:text-sand-200">{t('ops.orders.detail.collect')}</p>
          <p className="font-display text-xl font-bold text-sand-800 dark:text-sand-200"><span className="ltr">{money(o.collectCents)}</span></p>
        </div>
        <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60">
          <p className="text-xs text-ink-500">{t('ops.orders.detail.collected')}</p>
          <p className={cn('font-display text-xl font-bold', o.collectedCents ? 'text-turtle-700 dark:text-turtle-400' : 'text-ink-400')}><span className="ltr">{money(o.collectedCents)}</span></p>
        </div>
      </div>
      <div className="mt-3 divide-y divide-ink-100 dark:divide-ink-800">
        <InfoRow label={t('ops.orders.detail.codAmount')}><span className="ltr">{money(o.codAmountCents)}</span></InfoRow>
        {(o.fees.breakdown ?? []).map((b) => (
          <InfoRow key={b.key} label={t(`ops.orders.detail.fee.${feeKey(b.key)}`)}><span className="ltr">{money(b.cents)}</span></InfoRow>
        ))}
        <InfoRow label={<b className="text-ink-800 dark:text-ink-100">{t('ops.orders.detail.fee.total')}</b>}><b className="ltr">{money(o.fees.totalFeesCents)}</b></InfoRow>
        <InfoRow label={t('ops.orders.create.payer')}>{t(`ops.opsa.payer.${o.feesPaidBy}`)}</InfoRow>
        {net != null && <InfoRow label={t('ops.orders.detail.netToBrand')}><span className="ltr">{money(net)}</span></InfoRow>}
        {o.fees.returnFee && <InfoRow label={t('ops.orders.detail.returnFee')}><span className="ltr">{money(o.fees.returnFee.totalCents)}</span></InfoRow>}
      </div>
      {o.risk && o.risk.factors.length > 0 && (
        <div className="mt-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-700 dark:text-ink-200"><ShieldAlert className="h-3.5 w-3.5" />{t('ops.orders.detail.risk')}</p>
          <ul className="space-y-1">
            {o.risk.factors.map((f) => (
              <li key={f.key} className="flex justify-between text-xs">
                <span className="text-ink-600 dark:text-ink-300">{t(`ops.orders.detail.riskFactor.${f.key}`)}</span>
                <span className={cn('ltr font-semibold', f.points > 0 ? 'text-red-600' : 'text-turtle-600')}>{f.points > 0 ? `+${f.points}` : f.points}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function LogisticsCard({ o }: { o: OrderDetail }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const rows: Array<[string, ReactNode]> = [
    [t('ops.orders.detail.zone'), <span key="z">{locale === 'ar' ? o.zone.nameAr : o.zone.nameEn} <Badge className="ms-1">{t('ops.opsa.tier', { t: o.zone.tier })}</Badge></span>],
    [t('ops.orders.detail.hub'), o.hub ? `${locale === 'ar' ? o.hub.nameAr ?? o.hub.name : o.hub.name}` : '—'],
    [t('ops.orders.detail.hero'), o.courier ? (can('couriers.read') ? <Link key="h" to={`/ops/heroes/${o.courier.id}`} className="text-turtle-700 hover:underline dark:text-turtle-400">{o.courier.name}</Link> : o.courier.name) : '—'],
    [t('ops.orders.detail.runsheet'), o.runsheet ? (can('runsheets.read') ? <Link key="r" to={`/ops/dispatch/runsheets/${o.runsheet.id}`} className="ltr text-turtle-700 hover:underline dark:text-turtle-400">{o.runsheet.code}</Link> : <span className="ltr">{o.runsheet.code}</span>) : '—'],
    [t('ops.orders.detail.pickup'), o.pickup ? <span key="p" className="ltr">{o.pickup.code}</span> : '—'],
    [t('ops.orders.detail.pickupFrom'), o.pickupLocation?.name ?? '—'],
    [t('ops.orders.detail.promised'), o.promisedBy ? dateTime(o.promisedBy) : '—'],
  ];
  if (o.scheduledDate) rows.push([t('ops.orders.create.scheduled'), dateOnly(o.scheduledDate)]);
  if (o.parentOrder) rows.push([t('ops.orders.detail.parent'), <Link key="po" to={`/ops/orders/${o.parentOrder.id}`} className="ltr text-turtle-700 hover:underline">{o.parentOrder.trackingNumber}</Link>]);
  return (
    <SectionCard title={t('ops.orders.detail.logistics')}>
      <div className="divide-y divide-ink-100 dark:divide-ink-800">
        {rows.map(([l, v]) => <InfoRow key={l} label={l}>{v}</InfoRow>)}
      </div>
      {o.childOrders.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-ink-500">{t('ops.orders.detail.children')}</p>
          <ul className="space-y-1">
            {o.childOrders.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <Link to={`/ops/orders/${c.id}`} className="ltr font-mono text-xs text-turtle-700 hover:underline">{c.trackingNumber}</Link>
                <StatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function PackageCard({ o }: { o: OrderDetail }) {
  const { t } = useI18n();
  return (
    <SectionCard title={t('ops.orders.detail.package')}>
      <div className="divide-y divide-ink-100 dark:divide-ink-800">
        <InfoRow label={t('ops.orders.detail.desc')}>{o.packageDescription ?? '—'}</InfoRow>
        <InfoRow label={t('ops.orders.detail.items')}><span className="ltr">{num(o.itemsCount)}</span></InfoRow>
        <InfoRow label={t('ops.orders.detail.weight')}>{t('ops.opsa.unit.kg', { n: num(o.weightGrams / 1000) })}</InfoRow>
        <InfoRow label={t('ops.orders.detail.type')}>{t(`ops.opsa.type.${o.type}`)}</InfoRow>
        {o.declaredValueCents > 0 && <InfoRow label={t('ops.orders.create.declared')}><span className="ltr">{money(o.declaredValueCents)}</span></InfoRow>}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {o.isFragile && <Badge tone="warning">{t('ops.orders.detail.fragile')}</Badge>}
        <Badge tone={o.allowOpening ? 'success' : 'neutral'}>{o.allowOpening ? t('ops.orders.detail.openAllowed') : t('ops.orders.detail.noOpen')}</Badge>
        {o.deliveryOtpRequired && <Badge tone="info">{t('ops.orders.detail.otp')}</Badge>}
      </div>
      {o.notes && (
        <div className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
          <p className="text-xs font-semibold">{t('ops.orders.detail.notes')}</p>
          <p className="mt-0.5">{o.notes}</p>
        </div>
      )}
      {o.internalNotes && (
        <div className="mt-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="text-xs font-semibold">{t('ops.orders.detail.internalNotes')}</p>
          <p className="mt-0.5">{o.internalNotes}</p>
        </div>
      )}
    </SectionCard>
  );
}

function AttemptsCard({ o }: { o: OrderDetail }) {
  const { t } = useI18n();
  const hasPod = o.podPhotoUrl || o.podSignatureUrl || o.podReceivedBy || o.rating;
  return (
    <SectionCard title={t('ops.orders.detail.attemptsTitle')} subtitle={o.attempts.length ? t('ops.orders.attempts', { n: num(o.attempts.length), max: num(o.maxAttempts) }) : undefined}>
      {o.attempts.length === 0 ? (
        <p className="text-sm text-ink-500">{t('ops.orders.detail.noAttempts')}</p>
      ) : (
        <ul className="space-y-3">
          {o.attempts.map((a) => (
            <li key={a.id} className="flex gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold', a.success ? 'bg-turtle-100 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300')}>{num(a.attemptNo)}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{a.success ? t('ops.orders.detail.success') : a.failureReason ? t(`ops.opsa.reason.${a.failureReason}`) : t('ops.orders.detail.attemptN', { n: num(a.attemptNo) })}</p>
                  <span className="text-xs text-ink-400">{dateTime(a.createdAt)}</span>
                </div>
                {a.note && <p className="mt-0.5 text-ink-600 dark:text-ink-300">{a.note}</p>}
                {a.courier && <p className="mt-0.5 text-xs text-ink-500">{t('ops.orders.detail.by', { name: a.courier.name })}</p>}
              </div>
              {a.photoUrl && (
                <a href={a.photoUrl} target="_blank" rel="noreferrer" className="shrink-0" aria-label={t('ops.orders.detail.photo')}>
                  <img src={a.photoUrl} alt={t('ops.orders.detail.photo')} className="h-14 w-14 rounded-lg object-cover" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasPod && (
        <div className="mt-4 rounded-xl bg-turtle-50 p-3 text-sm dark:bg-turtle-950/50">
          <p className="mb-2 flex items-center gap-1.5 font-semibold text-turtle-800 dark:text-turtle-200"><Camera className="h-4 w-4" />{t('ops.orders.detail.pod')}</p>
          <div className="flex flex-wrap items-center gap-3">
            {o.podPhotoUrl && <a href={o.podPhotoUrl} target="_blank" rel="noreferrer"><img src={o.podPhotoUrl} alt={t('ops.orders.detail.pod')} className="h-20 w-20 rounded-lg object-cover" /></a>}
            {o.podSignatureUrl && <a href={o.podSignatureUrl} target="_blank" rel="noreferrer"><img src={o.podSignatureUrl} alt={t('ops.orders.detail.signature')} className="h-20 rounded-lg bg-white object-contain p-1" /></a>}
            <div className="space-y-1">
              {o.podReceivedBy && <p>{t('ops.orders.detail.receivedBy', { n: o.podReceivedBy })}</p>}
              {o.rating != null && <p className="flex items-center gap-2">{t('ops.orders.detail.rating')} <Stars value={o.rating} /></p>}
              {o.ratingComment && <p className="text-ink-600">“{o.ratingComment}”</p>}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function LedgerCard({ o }: { o: OrderDetail }) {
  const { t } = useI18n();
  const ledger = o.ledger ?? [];
  return (
    <SectionCard title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-ink-400" />{t('ops.orders.detail.ledger')}</span>} padded={false}>
      {ledger.length === 0 ? (
        <p className="p-5 text-sm text-ink-500">{t('ops.orders.detail.noLedger')}</p>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {ledger.map((tx) => (
            <li key={tx.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-900 dark:text-ink-100">{tx.description ?? tx.kind}</p>
                <span className="text-xs text-ink-400">{dateTime(tx.createdAt)}</span>
              </div>
              <Badge className="mt-1 text-[10px]">{tx.kind}</Badge>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-ink-400">
                    <th className="py-1 text-start font-medium" />
                    <th className="w-24 py-1 text-end font-medium">{t('ops.orders.detail.debit')}</th>
                    <th className="w-24 py-1 text-end font-medium">{t('ops.orders.detail.credit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.entries.map((e, i) => (
                    <tr key={i} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-1 text-ink-600 dark:text-ink-300">{e.name} <Mono className="ms-1 text-[11px] text-ink-400">{e.code.split(':')[0]}</Mono></td>
                      <td className="py-1 text-end"><span className="ltr">{e.debitCents ? money(e.debitCents) : ''}</span></td>
                      <td className="py-1 text-end"><span className="ltr">{e.creditCents ? money(e.creditCents) : ''}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
