import { lazy, Suspense, useEffect, useState } from 'react';
import { ArchProgress } from '@/components/brand';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Banknote, Bike, CalendarDays, Check, CheckCircle2, ClipboardList, Home, KeyRound, Lock, LogOut, MapPin, MessageCircle,
  Package, PackageX, Phone, RotateCcw, Share2, ShieldCheck, Star, Truck, Undo2, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { isValidTrackingNumber, normalizeTrackingNumber, type OrderStatus } from '@goturtle/shared';
import { api, ApiError, type CustomerSession } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePollInterval } from '@/lib/hooks';
import { dateTime, money, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui';
import { CustomerShell, Panel, useCustomerSession, usePublicSettings, VerifyPhone } from '../components';
import type { TrackingData } from '../types';
import { TrackingIntegrityCards } from '@/features/integrity/customer/TrackingIntegrityCards';
import '../i18n';
import { PartnerTrackingBlock } from '@/features/intake/partners/PartnerTrackingBlock';

const LiveHeroMap = lazy(() => import('../LiveHeroMap'));
const PinMap = lazy(() => import('@/portals/brand/components/PinMap'));

const STEP_ICONS = [ClipboardList, Package, Truck, Bike, Home];
const cairoDay = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86_400_000));

export default function TrackingPage() {
  const { trackingNumber: raw = '' } = useParams();
  const tn = normalizeTrackingNumber(raw);
  const valid = isValidTrackingNumber(tn);
  const { t } = useI18n();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [session, setSession] = useCustomerSession();
  const [modal, setModal] = useState<'reschedule' | 'address' | 'rate' | 'support' | 'verify' | null>(null);
  const fast = usePollInterval(15_000);
  const slow = usePollInterval(60_000);

  const q = useQuery({
    queryKey: ['track', tn, session?.accessToken ?? null],
    queryFn: () => api<TrackingData>(`/track/${tn}`, { auth: session ? 'customer' : 'none' }),
    enabled: valid,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    refetchInterval: (query) => (query.state.data?.status === 'OUT_FOR_DELIVERY' ? fast : slow),
  });
  const d = q.data;

  // SMS "rate your delivery" link: /t/GT…?rate=1
  useEffect(() => {
    if (params.get('rate') && d) {
      if (d.can?.rate) setModal('rate');
      else if (!d.verified && d.status === 'DELIVERED') setModal('verify');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.verified, d?.can?.rate]);

  const onVerified = (s: CustomerSession) => {
    setSession(s);
    setModal(null);
    qc.invalidateQueries({ queryKey: ['track', tn] });
  };
  const share = async () => {
    const url = `${window.location.origin}/t/${tn}`;
    try {
      if (navigator.share) await navigator.share({ title: t('customer.share.title'), text: t('customer.share.text', { tn }), url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(t('customer.share.copied'));
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  if (!valid || (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400))) return <NotFound tn={raw} />;

  return (
    <CustomerShell wide>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link to="/track" className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('customer.track.another')}
        </Link>
        {session && (
          <div className="flex items-center gap-1">
            <Link to="/track/orders" className="rounded-lg px-2 py-1 text-sm font-medium text-turtle-700 hover:bg-white/60 dark:text-turtle-400 dark:hover:bg-ink-800">{t('customer.track.myOrders')}</Link>
            <button type="button" onClick={() => setSession(null)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-white/60 hover:text-ink-700 dark:hover:bg-ink-800" aria-label={t('customer.orders.signOut')}><LogOut className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      {q.isLoading || !d ? (
        q.isError ? (
          <Panel className="text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
            <p className="mt-2 font-semibold">{t('error.generic')}</p>
            <Button className="mt-4" variant="outline" onClick={() => q.refetch()}>{t('action.retry')}</Button>
          </Panel>
        ) : (
          <div className="space-y-4 lg:max-w-2xl"><Skeleton className="h-64 w-full rounded-3xl" /><Skeleton className="h-40 w-full rounded-3xl" /><Skeleton className="h-56 w-full rounded-3xl" /></div>
        )
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <div className="space-y-4">
          <StatusHero d={d} />
          <TrackingIntegrityCards tn={tn} />

          {d.status === 'OUT_FOR_DELIVERY' && (
            d.heroLocation ? (
              <Panel padded={false} className="overflow-hidden">
                <Suspense fallback={<Skeleton className="h-[260px] w-full rounded-none" />}>
                  <LiveHeroMap
                    hero={d.heroLocation}
                    home={d.details?.address.lat != null && d.details.address.lng != null ? { lat: d.details.address.lat, lng: d.details.address.lng } : null}
                    heroTitle={d.hero?.firstName ?? t('common.hero')}
                    homeTitle={t('customer.track.you')}
                  />
                </Suspense>
                <p className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-turtle-500" />{t('customer.track.live')}</span>
                  {d.heroLocation.lastSeenAt && <span>{t('customer.track.updated', { time: timeOnly(d.heroLocation.lastSeenAt) })}</span>}
                </p>
              </Panel>
            ) : !d.verified ? (
              <button type="button" onClick={() => setModal('verify')} className="flex w-full items-center gap-3 rounded-3xl border border-dashed border-turtle-300 bg-turtle-50/60 p-4 text-start transition hover:bg-turtle-50 dark:border-turtle-800 dark:bg-turtle-950/30">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-turtle-700 shadow-sm dark:bg-ink-900 dark:text-turtle-300"><MapPin className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink-900 dark:text-white">{t('customer.track.mapLocked')}</span>
                  <span className="block text-sm text-ink-500">{t('customer.track.mapLockedHint')}</span>
                </span>
                <Lock className="h-4 w-4 text-ink-400" />
              </button>
            ) : null
          )}

          {d.hero && (
            <Panel className="flex items-center gap-4">
              <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-turtle-500 to-turtle-700 font-display text-xl font-bold text-white">
                {d.hero.firstName.slice(0, 1)}
                <span className="absolute -bottom-1 -end-1 grid h-6 w-6 place-items-center rounded-full bg-white text-turtle-700 shadow ring-2 ring-white dark:bg-ink-900 dark:ring-ink-900"><Bike className="h-3.5 w-3.5" /></span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-500">{t('customer.track.yourHero')}</p>
                <p className="font-display text-lg font-bold text-ink-900 dark:text-white">{d.hero.firstName}</p>
                <p className="flex items-center gap-1.5 text-sm text-ink-500">
                  <Star className="h-4 w-4 fill-sand-400 text-sand-400" /><span className="ltr font-semibold text-ink-700 dark:text-ink-200">{d.hero.rating.toFixed(1)}</span> · {t(`customer.vehicle.${d.hero.vehicleType}`)}
                </p>
              </div>
            </Panel>
          )}

          <PartnerTrackingBlock tracking={d} />
          {d.verified && d.details && <DeliveryInfo d={d} />}

          </div>
          <div className="space-y-4 lg:sticky lg:top-4">
          {/* Actions */}
          {d.verified ? (
            <Actions d={d} onAction={setModal} onShare={share} />
          ) : (
            <Panel>
              <div className="mb-4 flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"><ShieldCheck className="h-5 w-5" /></span>
                <div>
                  <p className="font-semibold text-ink-900 dark:text-white">{t('customer.track.verifyTitle', { name: d.recipient.firstName })}</p>
                  <p className="text-sm text-ink-500">{t('customer.track.verifyHint')}</p>
                </div>
              </div>
              <VerifyPhone trackingNumber={tn} maskedPhone={d.recipient.phone} onVerified={onVerified} />
              <button type="button" onClick={share} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-medium text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800"><Share2 className="h-4 w-4" />{t('customer.share.cta')}</button>
            </Panel>
          )}

          <TimelinePanel d={d} />
          </div>
        </div>
      )}

      {d && (
        <>
          <RescheduleModal open={modal === 'reschedule'} onClose={() => setModal(null)} tn={tn} current={d.scheduledDate} />
          <AddressModal open={modal === 'address'} onClose={() => setModal(null)} tn={tn} d={d} />
          <RateModal open={modal === 'rate'} onClose={() => { setModal(null); if (params.get('rate')) { params.delete('rate'); setParams(params, { replace: true }); } }} tn={tn} hero={d.hero?.firstName} />
          <SupportModal open={modal === 'support'} onClose={() => setModal(null)} tn={tn} />
          <Modal open={modal === 'verify'} onClose={() => setModal(null)} title={t('customer.track.verifyTitle', { name: d.recipient.firstName })} description={t('customer.track.verifyHint')}>
            <VerifyPhone trackingNumber={tn} maskedPhone={d.recipient.phone} onVerified={onVerified} />
          </Modal>
        </>
      )}
    </CustomerShell>
  );
}

// ------------------------------------------------------------------ hero

function StatusHero({ d }: { d: TrackingData }) {
  const { t, locale, dir } = useI18n();
  const ex = d.exception ? d.status : null;
  const warn = d.status === 'FAILED_ATTEMPT' || d.status === 'RESCHEDULED' || d.status === 'ON_HOLD';
  const tone = d.status === 'DELIVERED' ? 'done' : ex === 'CANCELLED' || ex === 'RETURNED' ? 'muted' : ex ? 'danger' : warn ? 'warn' : 'go';
  const bg = {
    go: 'from-turtle-600 via-turtle-700 to-turtle-900',
    done: 'from-turtle-500 via-turtle-600 to-turtle-800',
    warn: 'from-amber-500 via-amber-600 to-orange-700',
    danger: 'from-red-500 via-red-600 to-red-800',
    muted: 'from-ink-600 via-ink-700 to-ink-900',
  }[tone];
  const Icon = d.status === 'DELIVERED' ? CheckCircle2 : ex === 'CANCELLED' ? XCircle : ex === 'RETURNED' || ex === 'RETURN_OUT' || ex === 'RETURN_PENDING' ? Undo2 : ex ? PackageX : warn ? AlertTriangle : d.status === 'OUT_FOR_DELIVERY' ? Bike : Package;

  let when: string | null = null;
  if (d.status === 'DELIVERED' && d.deliveredAt) when = t('customer.when.delivered', { at: dateTime(d.deliveredAt, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) });
  else if (d.status === 'OUT_FOR_DELIVERY' && d.eta) when = t('customer.when.eta', { time: timeOnly(d.eta) });
  else if (d.scheduledDate && !ex) when = t('customer.when.scheduled', { day: dateTime(d.scheduledDate + 'T12:00:00Z', { weekday: 'long', day: 'numeric', month: 'long' }) });
  else if (d.eta && !ex) when = t('customer.when.by', { day: dateTime(d.eta, { weekday: 'long', day: 'numeric', month: 'long' }) });

  return (
    <section className="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-ink-100 dark:bg-ink-900 dark:ring-ink-800">
      <div className={cn('relative bg-gradient-to-br px-5 pb-6 pt-5 text-white', bg)}>
        <div className="pointer-events-none absolute -end-10 -top-10 h-40 w-40 rounded-full bg-lime-300/20 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {d.brand.logoUrl ? <img src={d.brand.logoUrl} alt="" className="h-8 w-8 rounded-lg bg-white object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/20 text-sm font-bold">{d.brand.name.slice(0, 1)}</span>}
            <span className="truncate text-sm font-medium text-white/90">{t('customer.track.from', { brand: d.brand.name })}</span>
          </div>
          <span className="ltr shrink-0 rounded-lg bg-white/15 px-2 py-1 font-mono text-xs font-semibold tracking-wider">{d.trackingNumber}</span>
        </div>
        <div className="relative mt-6 flex items-start gap-4">
          {ex ? (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30"><Icon className="h-7 w-7" /></span>
          ) : (
            <div className="w-24 shrink-0 sm:w-28" title={t('customer.track.progress')}>
              <ArchProgress
                surface="dark"
                mirror={dir === 'rtl'}
                tone={warn ? 'warn' : 'brand'}
                live={d.status === 'OUT_FOR_DELIVERY'}
                progress={d.status === 'DELIVERED' ? 1 : d.steps.length > 1 ? Math.min(d.step / (d.steps.length - 1) + (d.status === 'OUT_FOR_DELIVERY' ? 0.06 : 0), 0.94) : 0}
                steps={d.steps.map((st, i) => ({ at: d.steps.length > 1 ? i / (d.steps.length - 1) : 0, done: st.done }))}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-extrabold leading-tight sm:text-3xl">{t(`customer.status.${d.status}.title`)}</h1>
            <p className="mt-1 text-sm text-white/85">{t(`customer.status.${d.status}.body`, { name: d.recipient.firstName, hero: d.hero?.firstName ?? t('common.hero'), area: locale === 'ar' ? d.destination.zone.ar : d.destination.zone.en })}</p>
            {when && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold"><CalendarDays className="h-4 w-4" />{when}</p>}
          </div>
        </div>
      </div>
      {!ex ? (
        <ol className="flex px-2 py-5 sm:px-4" aria-label={t('customer.track.progress')}>
          {d.steps.map((s, i) => {
            const Ico = STEP_ICONS[i];
            const current = i === d.step;
            const done = s.done && !current;
            const isWarn = current && warn;
            const last = i === d.steps.length - 1;
            return (
              <li key={s.key} className={cn('relative flex min-w-0 flex-1 flex-col items-center text-center', !last && 'after:absolute after:start-1/2 after:top-[18px] after:h-1 after:w-full after:rounded-full after:content-[""]', !last && (i < d.step ? 'after:bg-turtle-600' : 'after:bg-ink-100 dark:after:bg-ink-800'))}>
                <span
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'relative z-10 grid h-10 w-10 place-items-center rounded-full ring-4 ring-white transition dark:ring-ink-900',
                    done && 'bg-turtle-600 text-lime-300',
                    current && !isWarn && 'bg-lime-300 text-turtle-900 shadow-lg shadow-lime-400/40',
                    isWarn && 'bg-amber-500 text-white',
                    !s.done && 'bg-ink-100 text-ink-400 dark:bg-ink-800',
                  )}
                >
                  {done || (current && last) ? <Check className="h-5 w-5" /> : <Ico className="h-[18px] w-[18px]" />}
                </span>
                <span className={cn('mt-2 px-0.5 text-[11px] font-semibold leading-tight', current ? 'text-ink-900 dark:text-white' : s.done ? 'text-ink-600 dark:text-ink-300' : 'text-ink-400')}>{locale === 'ar' ? s.label.ar : s.label.en}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="px-5 py-4 text-sm text-ink-600 dark:text-ink-300">{t(`customer.exception.${d.status}`)}</div>
      )}
      {(d.status === 'FAILED_ATTEMPT' || d.status === 'RESCHEDULED') && (
        <div className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          {t('customer.track.attempts', { n: d.attempts, max: d.maxAttempts })}
          {lastReason(d) && <> · {t(`customer.reason.${lastReason(d)}`)}</>}
        </div>
      )}
    </section>
  );
}

function lastReason(d: TrackingData): string | null {
  const ev = [...d.timeline].reverse().find((e) => e.status === 'FAILED_ATTEMPT' && e.reason);
  return ev?.reason ?? null;
}

// ------------------------------------------------------------------ details

function DeliveryInfo({ d }: { d: TrackingData }) {
  const { t } = useI18n();
  const det = d.details!;
  const addr = [det.address.line, det.address.building && `${t('customer.addr.building')} ${det.address.building}`, det.address.floor && `${t('customer.addr.floor')} ${det.address.floor}`, det.address.apartment && `${t('customer.addr.apartment')} ${det.address.apartment}`].filter(Boolean).join('، ');
  const open = !['DELIVERED', 'RETURNED', 'CANCELLED', 'LOST'].includes(d.status);
  return (
    <Panel className="space-y-4">
      {open && d.paymentMethod === 'COD' && det.amountToPayCents > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl bg-sand-50 p-4 dark:bg-sand-900/20">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sand-400 text-ink-950"><Banknote className="h-5 w-5" /></span>
          <div>
            <p className="text-sm text-ink-600 dark:text-ink-300">{t('customer.info.toPay')}</p>
            <p className="font-display text-2xl font-extrabold text-ink-900 dark:text-white"><span className="ltr">{money(det.amountToPayCents)}</span></p>
            <p className="text-xs text-ink-500">{t('customer.info.cashHint')}</p>
          </div>
        </div>
      ) : open && d.paymentMethod === 'PREPAID' ? (
        <p className="flex items-center gap-2 rounded-2xl bg-turtle-50 p-3 text-sm font-medium text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200"><CheckCircle2 className="h-5 w-5" />{t('customer.info.prepaid')}</p>
      ) : null}
      {open && det.deliveryOtpRequired && (
        <p className="flex items-start gap-3 rounded-2xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-200">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0" />
          <span><span className="block font-semibold">{t('customer.info.otpTitle')}</span>{t('customer.info.otpHint')}</span>
        </p>
      )}
      <dl className="space-y-3 text-sm">
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <div className="min-w-0">
            <dt className="text-xs text-ink-500">{t('customer.info.address')}</dt>
            <dd className="text-ink-800 dark:text-ink-100">{addr}</dd>
            {det.address.landmark && <dd className="text-ink-500">{t('customer.addr.landmark')}: {det.address.landmark}</dd>}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Package className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <div>
            <dt className="text-xs text-ink-500">{t('customer.info.package')}</dt>
            <dd className="text-ink-800 dark:text-ink-100">{t('customer.info.items', { n: det.itemsCount })} · {det.allowOpening ? t('customer.info.canOpen') : t('customer.info.noOpen')}</dd>
          </div>
        </div>
      </dl>
    </Panel>
  );
}

function Actions({ d, onAction, onShare }: { d: TrackingData; onAction: (m: 'reschedule' | 'address' | 'rate' | 'support') => void; onShare: () => void }) {
  const { t } = useI18n();
  const settings = usePublicSettings();
  const wa = settings.data?.company.supportWhatsapp?.replace(/\D/g, '');
  const tel = settings.data?.company.supportPhone;
  const items = [
    d.can?.rate && { key: 'rate', icon: <Star />, label: t('customer.act.rate'), hint: t('customer.act.rateHint'), onClick: () => onAction('rate'), primary: true },
    d.can?.reschedule && { key: 'reschedule', icon: <CalendarDays />, label: t('customer.act.reschedule'), hint: t('customer.act.rescheduleHint'), onClick: () => onAction('reschedule') },
    d.can?.editAddress && { key: 'address', icon: <MapPin />, label: t('customer.act.address'), hint: t('customer.act.addressHint'), onClick: () => onAction('address') },
    { key: 'support', icon: <MessageCircle />, label: t('customer.act.support'), hint: t('customer.act.supportHint'), onClick: () => onAction('support') },
    { key: 'share', icon: <Share2 />, label: t('customer.act.share'), hint: t('customer.act.shareHint'), onClick: onShare },
  ].filter(Boolean) as Array<{ key: string; icon: React.ReactNode; label: string; hint: string; onClick: () => void; primary?: boolean }>;
  return (
    <Panel>
      {d.details?.rating != null && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-sand-50 p-3 text-sm text-ink-700 dark:bg-sand-900/20 dark:text-ink-200">
          <span className="flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={cn('h-4 w-4', i < d.details!.rating! ? 'fill-sand-400 text-sand-400' : 'text-ink-300')} />)}</span>
          {t('customer.act.thanksRated')}
        </p>
      )}
      <p className="mb-3 text-sm font-semibold text-ink-900 dark:text-white">{t('customer.act.title')}</p>
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={it.onClick}
            className={cn('flex min-h-[92px] flex-col items-start gap-2 rounded-2xl border p-3 text-start transition active:scale-[0.98]', it.primary ? 'border-sand-300 bg-sand-50 hover:bg-sand-100 dark:border-sand-700 dark:bg-sand-900/20' : 'border-ink-100 hover:border-turtle-300 hover:bg-turtle-50/50 dark:border-ink-800 dark:hover:bg-ink-800')}
          >
            <span className={cn('grid h-9 w-9 place-items-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]', it.primary ? 'bg-sand-400 text-ink-950' : 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300')}>{it.icon}</span>
            <span>
              <span className="block text-sm font-semibold text-ink-900 dark:text-white">{it.label}</span>
              <span className="block text-xs text-ink-500">{it.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {(wa || tel) && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {wa && <a href={`https://wa.me/${wa}?text=${encodeURIComponent(t('customer.act.waText', { tn: d.trackingNumber }))}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-semibold text-white hover:brightness-95"><MessageCircle className="h-4 w-4" />{t('action.whatsapp')}</a>}
          {tel && <a href={`tel:${tel}`} className={cn('inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ink-200 text-sm font-semibold text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-100 dark:hover:bg-ink-800', !wa && 'col-span-2')}><Phone className="h-4 w-4" />{t('customer.act.call')}</a>}
        </div>
      )}
    </Panel>
  );
}

function TimelinePanel({ d }: { d: TrackingData }) {
  const { t } = useI18n();
  const events = [...d.timeline].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <Panel>
      <p className="mb-4 font-semibold text-ink-900 dark:text-white">{t('customer.track.history')}</p>
      <ol className="relative space-y-5 border-s-2 border-ink-100 ps-6 dark:border-ink-800">
        {events.map((e, i) => (
          <li key={`${e.status}-${e.at}`} className="relative">
            <span className={cn('absolute -start-[33px] top-0.5 grid h-4 w-4 place-items-center rounded-full ring-4 ring-white dark:ring-ink-900', i === 0 ? (isBad(e.status) ? 'bg-amber-500' : 'bg-turtle-500') : 'bg-ink-300 dark:bg-ink-600')} />
            <p className={cn('text-sm font-semibold', i === 0 ? 'text-ink-900 dark:text-white' : 'text-ink-600 dark:text-ink-300')}>{t(`customer.event.${e.status}`)}</p>
            <time className="text-xs text-ink-400">{dateTime(e.at, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</time>
            {e.reason && e.status === 'FAILED_ATTEMPT' && <p className="mt-0.5 text-sm text-ink-500">{t(`customer.reason.${e.reason}`)}</p>}
            {e.note && <p className="mt-0.5 text-sm text-ink-500">“{e.note}”</p>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

const isBad = (s: OrderStatus) => ['FAILED_ATTEMPT', 'RESCHEDULED', 'ON_HOLD', 'RETURN_PENDING', 'RETURN_OUT', 'RETURNED', 'CANCELLED', 'LOST', 'DAMAGED'].includes(s);

function NotFound({ tn }: { tn: string }) {
  const { t } = useI18n();
  return (
    <CustomerShell>
      <div className="pt-10 text-center">
        <span className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-white text-ink-400 shadow-card dark:bg-ink-900"><PackageX className="h-10 w-10" /></span>
        <h1 className="mt-6 font-display text-2xl font-extrabold text-ink-900 dark:text-white">{t('customer.nf.title')}</h1>
        <p className="mx-auto mt-2 max-w-sm text-ink-500">{t('customer.nf.body', { tn: tn.toUpperCase() })}</p>
        <ul className="mx-auto mt-6 max-w-sm space-y-2 text-start text-sm text-ink-600 dark:text-ink-300">
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-turtle-600" />{t('customer.nf.tip1')}</li>
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-turtle-600" />{t('customer.nf.tip2')}</li>
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-turtle-600" />{t('customer.nf.tip3')}</li>
        </ul>
        <Link to="/track" className="mt-8 inline-block"><Button size="lg" icon={<RotateCcw className="h-5 w-5" />}>{t('customer.nf.again')}</Button></Link>
      </div>
    </CustomerShell>
  );
}

// ------------------------------------------------------------------ modals

function RescheduleModal({ open, onClose, tn, current }: { open: boolean; onClose: () => void; tn: string; current: string | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const days = Array.from({ length: 7 }, (_, i) => cairoDay(i + 1));
  const [day, setDay] = useState(days[0]);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setDay(current && days.includes(current) ? current : days[0]);
      setNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () => api(`/track/${tn}/reschedule`, { method: 'POST', auth: 'customer', body: { date: day, note: note.trim() || undefined } }),
    onSuccess: () => { toast.success(t('customer.resched.done', { day: dateTime(day + 'T12:00:00Z', { weekday: 'long', day: 'numeric', month: 'long' }) })); qc.invalidateQueries({ queryKey: ['track', tn] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('customer.resched.title')} description={t('customer.resched.hint')} footer={<Button block size="lg" loading={m.isPending} onClick={() => m.mutate()}>{t('customer.resched.confirm')}</Button>}>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" role="radiogroup" aria-label={t('customer.resched.title')}>
        {days.map((dd, i) => {
          const date = new Date(dd + 'T12:00:00Z');
          const active = dd === day;
          return (
            <button key={dd} type="button" role="radio" aria-checked={active} onClick={() => setDay(dd)} className={cn('flex flex-col items-center rounded-2xl border-2 py-2.5 transition', active ? 'border-turtle-500 bg-turtle-50 text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200' : 'border-ink-100 text-ink-700 hover:border-ink-200 dark:border-ink-800 dark:text-ink-200')}>
              <span className="text-[11px] font-medium opacity-80">{i === 0 ? t('customer.resched.tomorrow') : dateTime(date, { weekday: 'short' })}</span>
              <span className="font-display text-xl font-bold">{dateTime(date, { day: 'numeric' })}</span>
              <span className="text-[11px] opacity-70">{dateTime(date, { month: 'short' })}</span>
            </button>
          );
        })}
      </div>
      <Field label={t('customer.resched.note')} className="mt-4">{(id) => <Textarea id={id} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('customer.resched.notePh')} />}</Field>
    </Modal>
  );
}

function AddressModal({ open, onClose, tn, d }: { open: boolean; onClose: () => void; tn: string; d: TrackingData }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const a = d.details?.address;
  const [f, setF] = useState({ building: '', floor: '', apartment: '', landmark: '', notes: '', pin: null as { lat: number; lng: number } | null });
  useEffect(() => {
    if (open && a) setF({ building: a.building ?? '', floor: a.floor ?? '', apartment: a.apartment ?? '', landmark: a.landmark ?? '', notes: '', pin: a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const k of ['building', 'floor', 'apartment', 'landmark'] as const) if (f[k].trim() && f[k].trim() !== (a?.[k] ?? '')) body[k] = f[k].trim();
      if (f.notes.trim()) body.notes = f.notes.trim();
      if (f.pin && (f.pin.lat !== a?.lat || f.pin.lng !== a?.lng)) Object.assign(body, f.pin);
      if (!Object.keys(body).length) return Promise.resolve(null);
      return api(`/track/${tn}/address`, { method: 'PATCH', auth: 'customer', body });
    },
    onSuccess: (r) => { if (r !== null) toast.success(t('customer.addr.done')); qc.invalidateQueries({ queryKey: ['track', tn] }); onClose(); },
    onError: (e) => toast.error((e as { code?: string }).code === 'PIN_OUT_OF_ZONE' ? t('customer.addr.outOfZone') : (e as { code?: string }).code === 'ADDRESS_LOCKED' ? t('customer.addr.locked') : errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} size="lg" title={t('customer.addr.title')} description={t('customer.addr.hint')} footer={<Button block size="lg" loading={m.isPending} onClick={() => m.mutate()}>{t('customer.addr.save')}</Button>}>
      <div className="space-y-4">
        <p className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-700 dark:bg-ink-800/60 dark:text-ink-200">{a?.line}</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('customer.addr.building')}>{(id) => <Input id={id} maxLength={50} value={f.building} onChange={(e) => setF({ ...f, building: e.target.value })} />}</Field>
          <Field label={t('customer.addr.floor')}>{(id) => <Input id={id} maxLength={20} value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} />}</Field>
          <Field label={t('customer.addr.apartment')}>{(id) => <Input id={id} maxLength={20} value={f.apartment} onChange={(e) => setF({ ...f, apartment: e.target.value })} />}</Field>
        </div>
        <Field label={t('customer.addr.landmark')}>{(id) => <Input id={id} maxLength={200} value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} placeholder={t('customer.addr.landmarkPh')} />}</Field>
        <Field label={t('customer.addr.notes')}>{(id) => <Textarea id={id} rows={2} maxLength={300} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t('customer.addr.notesPh')} />}</Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('customer.addr.pin')}</p>
          <Suspense fallback={<Skeleton className="h-60 w-full" />}>
            <PinMap value={f.pin} onChange={(p) => setF({ ...f, pin: p })} height={240} />
          </Suspense>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-500">
            <span>{t('customer.addr.pinHint')}</span>
            {'geolocation' in navigator && (
              <button type="button" className="font-semibold text-turtle-700 hover:underline dark:text-turtle-400" onClick={() => navigator.geolocation.getCurrentPosition((p) => setF((s) => ({ ...s, pin: { lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 } })), () => toast.error(t('customer.addr.gpsFail')), { enableHighAccuracy: true, timeout: 10_000 })}>
                {t('customer.addr.useGps')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RateModal({ open, onClose, tn, hero }: { open: boolean; onClose: () => void; tn: string; hero?: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/track/${tn}/rate`, { method: 'POST', auth: 'customer', body: { rating, comment: comment.trim() || undefined } }),
    onSuccess: () => { toast.success(t('customer.rate.thanks')); qc.invalidateQueries({ queryKey: ['track', tn] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const shown = hover || rating;
  return (
    <Modal open={open} onClose={onClose} title={t('customer.rate.title')} description={hero ? t('customer.rate.hintHero', { hero }) : t('customer.rate.hint')} footer={<Button block size="lg" disabled={!rating} loading={m.isPending} onClick={() => m.mutate()}>{t('customer.rate.send')}</Button>}>
      <div className="flex justify-center gap-2 py-2" dir="ltr" role="radiogroup" aria-label={t('customer.rate.title')} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t('customer.rate.stars', { n })} onMouseEnter={() => setHover(n)} onClick={() => setRating(n)} className="rounded-xl p-1 transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-turtle-500">
            <Star className={cn('h-11 w-11 transition', n <= shown ? 'fill-sand-400 text-sand-400' : 'text-ink-200 dark:text-ink-700')} />
          </button>
        ))}
      </div>
      <p className="h-5 text-center text-sm font-semibold text-ink-700 dark:text-ink-200">{shown ? t(`customer.rate.l${shown}`) : ''}</p>
      <Field label={t('customer.rate.comment')} className="mt-4">{(id) => <Textarea id={id} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('customer.rate.commentPh')} />}</Field>
    </Modal>
  );
}

function SupportModal({ open, onClose, tn }: { open: boolean; onClose: () => void; tn: string }) {
  const { t } = useI18n();
  const [category, setCategory] = useState('INQUIRY');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setBody(''); setSent(null); setCategory('INQUIRY'); }
  }, [open]);
  const m = useMutation({
    mutationFn: () => api<{ code: string }>('/tickets', { method: 'POST', auth: 'customer', body: { subject: t(`customer.support.cat.${category}`) + ` · ${tn}`, category, body: body.trim(), trackingNumber: tn } }),
    onSuccess: (r) => setSent(r.code),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('customer.support.title')} description={sent ? undefined : t('customer.support.hint')} footer={sent ? <Button block onClick={onClose}>{t('action.close')}</Button> : <Button block size="lg" disabled={body.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>{t('customer.support.send')}</Button>}>
      {sent ? (
        <div className="py-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-turtle-500" />
          <p className="mt-3 font-semibold text-ink-900 dark:text-white">{t('customer.support.sent')}</p>
          <p className="mt-1 text-sm text-ink-500">{t('customer.support.sentHint', { code: sent })}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t('customer.support.about')}>{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)} options={['INQUIRY', 'DELAY', 'RESCHEDULE', 'ADDRESS_CHANGE', 'COD_ISSUE', 'DAMAGED', 'COURIER_BEHAVIOR', 'COMPLAINT', 'OTHER'].map((c) => ({ value: c, label: t(`customer.support.cat.${c}`) }))} />}</Field>
          <Field label={t('customer.support.message')}>{(id) => <Textarea id={id} rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('customer.support.messagePh')} />}</Field>
        </div>
      )}
    </Modal>
  );
}
