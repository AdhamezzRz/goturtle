import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Building2, CircleAlert, Clock, Copy, Hand, KeyRound, MapPin, MessageCircle, Navigation, Package, PackageCheck, PenLine, Play, Send, ShieldCheck, Store,
  TriangleAlert, Undo2, Warehouse, X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { FailureReason } from '@goturtle/shared';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { cairoToday, dateOnly, dateTime, money, parseEgp, timeOnly } from '@/lib/format';
import { useOnline } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, ConfirmDialog, ErrorState, Field, Input, Skeleton, StatusBadge, Textarea } from '@/components/ui';
import { BigAction, Chips, Ltr, Money, OfflineBlock, PageTop, Panel, PhotoInput, Sheet, SignaturePad, StickyBar, SuccessOverlay, type SignatureHandle } from '../components/kit';
import { FAILURE_REASONS } from '../components/reasons';
import { fetchToday, useHeroMutation, useInvalidateHero, useStop } from '../lib/queries';
import { currentPosition } from '../lib/geo';
import { uploadPhoto } from '../lib/media';
import { nextStop } from '../lib/agenda';
import { addDays, directionsLink, minutesLabel, telLink, whatsappLink } from '../lib/util';
import type { DeliverBody, FailBody, StopDetail } from '../types';
import { FailIntegrityPanel, HeroCallAction } from '@/features/integrity/hero/HeroCalls';

const StopMiniMap = lazy(() => import('../components/StopMiniMap'));

type Done = { kind: 'delivered' | 'failed' | 'returned'; title: string; subtitle: string; next: { id: string; name: string } | null };

export default function StopPage() {
  const { orderId } = useParams();
  const { t, pick } = useI18n();
  const { me } = useAuth();
  const stop = useStop(orderId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateHero();
  const [sheet, setSheet] = useState<'deliver' | 'fail' | 'returned' | null>(null);
  const [confirm, setConfirm] = useState<'hub' | 'returnOut' | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const refreshAll = () => {
    invalidate(['hero', 'stop', orderId]);
  };

  const finish = async (kind: Done['kind'], title: string, subtitle: string) => {
    setSheet(null);
    refreshAll();
    const fresh = await fetchToday(qc);
    const n = nextStop(fresh, orderId);
    setDone({ kind, title, subtitle, next: n ? { id: n.orderId, name: n.recipientName } : null });
  };

  const outForDelivery = useHeroMutation(async () => api<StopDetail>(`/hero/tasks/orders/${orderId}/out-for-delivery`, { method: 'POST', body: { ...(await currentPosition()) } }), {
    onSuccess: (res) => {
      qc.setQueryData(['hero', 'stop', orderId], res);
      refreshAll();
      toast.success(t('hero.stop.ofdDone'));
    },
  });
  const returnToHub = useHeroMutation(async (note: string) => api<{ nextStep: string }>(`/hero/tasks/orders/${orderId}/return-to-hub`, { method: 'POST', body: { note: note || undefined, ...(await currentPosition()) } }), {
    onSuccess: () => {
      setConfirm(null);
      refreshAll();
      toast.success(t('hero.stop.hubDeclared'), { description: t('hero.stop.hubNext'), duration: 6000 });
    },
  });
  const returnOut = useHeroMutation(async () => api<StopDetail>(`/hero/tasks/orders/${orderId}/return-out`, { method: 'POST', body: { ...(await currentPosition()) } }), {
    onSuccess: (res) => {
      setConfirm(null);
      qc.setQueryData(['hero', 'stop', orderId], res);
      refreshAll();
      toast.success(t('hero.stop.returnStarted'));
    },
  });

  if (!stop.data && stop.isError) {
    return (
      <div>
        <PageTop title={t('hero.stop.title')} />
        <ErrorState error={stop.error} onRetry={() => stop.refetch()} />
      </div>
    );
  }
  if (!stop.data) return <StopSkeleton />;
  const s = stop.data;
  const nav = s.mapsUrl ?? s.approximateMapsUrl ?? directionsLink(s.address.lat, s.address.lng, s.address.line);
  const brandName = s.brand.name;

  return (
    <div>
      <PageTop
        title={s.recipient.name}
        subtitle={
          <span className="inline-flex items-center gap-1">
            <Ltr className="font-mono">{s.trackingNumber}</Ltr>
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-full hover:bg-ink-100 dark:hover:bg-ink-800"
              aria-label={t('action.copy')}
              onClick={() => navigator.clipboard?.writeText(s.trackingNumber).then(() => toast.success(t('action.copied')), () => undefined)}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </span>
        }
        end={<StatusBadge status={s.status} />}
      />

      {/* What to collect */}
      {s.collectCents > 0 ? (
        <div className="rounded-3xl bg-gradient-to-br from-sand-300 to-sand-500 p-5 text-ink-950 shadow-card">
          <p className="text-sm font-bold opacity-80">{t('hero.stop.collectFrom')}</p>
          <Money cents={s.collectCents} className="mt-1 font-display text-5xl font-extrabold tracking-tight" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {s.otpRequired && <span className="inline-flex items-center gap-1 rounded-full bg-ink-950/10 px-2.5 py-1 text-xs font-bold"><KeyRound className="h-3.5 w-3.5" /> {t('hero.stop.otpNeeded')}</span>}
            <span className="inline-flex items-center gap-1 rounded-full bg-ink-950/10 px-2.5 py-1 text-xs font-bold">{t('hero.stop.cashOnly')}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-3xl bg-turtle-50 p-4 ring-1 ring-turtle-200 dark:bg-turtle-950 dark:ring-turtle-900">
          <ShieldCheck className="h-8 w-8 shrink-0 text-turtle-600" />
          <div>
            <p className="font-display text-lg font-bold text-turtle-800 dark:text-turtle-200">{t('hero.stop.prepaidTitle')}</p>
            <p className="text-sm text-turtle-800/80 dark:text-turtle-200/80">{t('hero.stop.prepaidHint')}</p>
          </div>
          {s.otpRequired && <Badge tone="progress" className="ms-auto"><KeyRound className="h-3 w-3" /> OTP</Badge>}
        </div>
      )}

      {/* Contact */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <HeroCallAction stop={s} />
        <BigAction
          href={whatsappLink(s.recipient.phone, { recipient: s.recipient.name, hero: me?.name.split(' ')[0] ?? '', brand: brandName, trackingNumber: s.trackingNumber })}
          icon={<MessageCircle />}
          label={t('action.whatsapp')}
          tone="whatsapp"
          external
        />
        <BigAction href={nav} icon={<Navigation />} label={t('action.navigate')} tone="sky" external disabled={!nav} />
      </div>
      <p className="mt-2 text-center text-sm text-ink-500">
        <Ltr className="font-semibold text-ink-700 dark:text-ink-200">{s.recipient.phoneDisplay}</Ltr>
        {s.recipient.altPhone && (
          <>
            {' · '}
            <a href={telLink(s.recipient.altPhone)} className="font-semibold text-turtle-700 underline-offset-2 hover:underline dark:text-turtle-400">
              {t('hero.stop.altPhone')} <Ltr>{s.recipient.altPhone}</Ltr>
            </a>
          </>
        )}
      </p>

      {/* Address */}
      <Panel className="mt-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><MapPin className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug text-ink-900 dark:text-white">{s.address.line}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.address.building && <Badge tone="neutral"><Building2 className="h-3 w-3" /> {t('hero.stop.building')} {s.address.building}</Badge>}
              {s.address.floor && <Badge tone="neutral">{t('hero.stop.floor')} {s.address.floor}</Badge>}
              {s.address.apartment && <Badge tone="neutral">{t('hero.stop.apartment')} {s.address.apartment}</Badge>}
              <Badge tone="info">{pick(s.zone, 'name')}</Badge>
            </div>
            {s.address.landmark && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">📍 {t('hero.stop.landmark')}: {s.address.landmark}</p>
            )}
            {s.address.lat == null && <p className="mt-2 text-xs text-ink-500">{t('hero.stop.noPin')}</p>}
          </div>
        </div>
        {s.address.lat != null && s.address.lng != null && (
          <div className="mt-3">
            <Suspense fallback={<Skeleton className="h-[170px] rounded-2xl" />}>
              <StopMiniMap lat={s.address.lat} lng={s.address.lng} />
            </Suspense>
          </div>
        )}
      </Panel>

      {s.notes && (
        <div className="mt-3 flex gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-amber-950 dark:ring-amber-900">
          <CircleAlert className="h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">{t('common.notes')}</p>
            <p className="mt-0.5 text-sm font-medium text-amber-950 dark:text-amber-100">{s.notes}</p>
          </div>
        </div>
      )}

      {/* Package */}
      <Panel className="mt-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200"><Package className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-900 dark:text-white">{s.packageDescription || t('hero.stop.parcel')}</p>
            <p className="text-sm text-ink-500">{t('hero.stop.items', { n: s.itemsCount })} · {brandName}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.isFragile && <Badge tone="danger"><TriangleAlert className="h-3 w-3" /> {t('hero.stop.fragile')}</Badge>}
              <Badge tone={s.allowOpening ? 'success' : 'warning'}>{s.allowOpening ? t('hero.stop.canOpen') : t('hero.stop.noOpen')}</Badge>
              {s.attempts > 0 && <Badge tone="warning">{t('hero.stop.attempts', { n: s.attempts, max: s.maxAttempts })}</Badge>}
            </div>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-ink-100 pt-3 text-sm dark:border-ink-800">
          {s.eta && (
            <div>
              <dt className="text-xs text-ink-500">{t('hero.eta')}</dt>
              <dd className="font-semibold"><Clock className="me-1 inline h-3.5 w-3.5" /><Ltr>{timeOnly(s.eta)}</Ltr></dd>
            </div>
          )}
          {s.promisedBy && (
            <div>
              <dt className="text-xs text-ink-500">{t('hero.stop.promisedBy')}</dt>
              <dd className="font-semibold"><Ltr>{dateTime(s.promisedBy, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</Ltr></dd>
            </div>
          )}
          {s.scheduledDate && (
            <div>
              <dt className="text-xs text-ink-500">{t('hero.stop.scheduled')}</dt>
              <dd className="font-semibold">{dateOnly(s.scheduledDate)}</dd>
            </div>
          )}
          {s.brand.phone && (
            <div>
              <dt className="text-xs text-ink-500">{t('common.brand')}</dt>
              <dd>
                <a href={telLink(s.brand.phone)} className="inline-flex min-h-[32px] items-center gap-1 font-semibold text-turtle-700 dark:text-turtle-400">
                  <Store className="h-3.5 w-3.5" /> {t('hero.stop.callBrand')}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </Panel>

      <StatusFooter s={s} />

      {/* Actions by status */}
      {(s.actions.deliver || s.actions.outForDelivery || s.actions.returnToHub || s.actions.startReturn || s.actions.returned) && (
        <StickyBar>
          {s.actions.deliver ? (
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <Button variant="outline" size="xl" className="border-red-200 px-2 text-red-600 dark:border-red-900 dark:text-red-400" icon={<X className="h-5 w-5" />} onClick={() => setSheet('fail')}>
                {t('hero.stop.failed')}
              </Button>
              <Button size="xl" className="px-2 shadow-pop" icon={<PackageCheck className="h-6 w-6" />} onClick={() => setSheet('deliver')}>
                {t('hero.stop.deliver')}
              </Button>
            </div>
          ) : s.actions.outForDelivery ? (
            <Button size="xl" block className="shadow-pop" loading={outForDelivery.isPending} icon={<Play className="h-5 w-5" />} onClick={() => outForDelivery.mutate(undefined)}>
              {t('hero.stop.startDelivery')}
            </Button>
          ) : s.actions.returned ? (
            <Button size="xl" block variant="cash" className="shadow-pop" icon={<Hand className="h-5 w-5" />} onClick={() => setSheet('returned')}>
              {t('hero.stop.markReturned')}
            </Button>
          ) : (
            <div className={cn('grid gap-2', s.actions.startReturn && s.actions.returnToHub ? 'grid-cols-2' : 'grid-cols-1')}>
              {s.actions.returnToHub && (
                <Button size="xl" variant="secondary" className="px-2" icon={<Warehouse className="h-5 w-5" />} onClick={() => setConfirm('hub')}>
                  {t('hero.stop.toHub')}
                </Button>
              )}
              {s.actions.startReturn && (
                <Button size="xl" variant="cash" className="px-2" icon={<Undo2 className="h-5 w-5" />} onClick={() => setConfirm('returnOut')}>
                  {t('hero.stop.startReturn')}
                </Button>
              )}
            </div>
          )}
        </StickyBar>
      )}

      <DeliverSheet
        open={sheet === 'deliver'}
        onClose={() => setSheet(null)}
        stop={s}
        onDone={(collected) =>
          void finish('delivered', t('hero.done.delivered'), collected > 0 ? t('hero.done.collected', { amount: money(collected) }) : t('hero.done.deliveredPrepaid'))
        }
      />
      <FailSheet
        open={sheet === 'fail'}
        onClose={() => setSheet(null)}
        stop={s}
        onDone={(res, reason) =>
          void finish('failed', t('hero.done.failed'), res.status === 'RETURN_PENDING' ? t('hero.done.failedReturn') : t(`hero.reason.${reason}`))
        }
      />
      <ReturnedSheet open={sheet === 'returned'} onClose={() => setSheet(null)} stop={s} onDone={() => void finish('returned', t('hero.done.returned'), brandName)} />

      <HubConfirm open={confirm === 'hub'} onClose={() => setConfirm(null)} loading={returnToHub.isPending} onConfirm={(note) => returnToHub.mutate(note)} />
      <ConfirmDialog
        open={confirm === 'returnOut'}
        onClose={() => setConfirm(null)}
        onConfirm={() => returnOut.mutate(undefined)}
        loading={returnOut.isPending}
        title={t('hero.stop.startReturn')}
        description={t('hero.stop.startReturnHint', { brand: brandName })}
      />

      <SuccessOverlay
        open={!!done}
        tone={done?.kind === 'failed' ? 'amber' : 'green'}
        icon={done?.kind === 'failed' ? <CircleAlert className="h-16 w-16" /> : undefined}
        title={done?.title}
        subtitle={
          <>
            <p>{done?.subtitle}</p>
            {done?.next && <p className="mt-3 text-sm font-semibold text-white">{t('hero.done.nextIs', { name: done.next.name })}</p>}
          </>
        }
        continueLabel={done?.next ? t('hero.done.goNext') : t('hero.done.backToday')}
        onContinue={() => {
          const n = done?.next;
          setDone(null);
          navigate(n ? `/hero/stops/${n.id}` : '/hero', { replace: true });
        }}
      />
    </div>
  );
}

function StatusFooter({ s }: { s: StopDetail }) {
  const { t, pick } = useI18n();
  if (s.status === 'DELIVERED')
    return (
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-turtle-600 p-4 text-white">
        <PackageCheck className="h-7 w-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{t('hero.stop.isDelivered')}</p>
          <Link to="/hero" className="text-sm font-semibold underline underline-offset-2">{t('hero.done.backToday')}</Link>
        </div>
      </div>
    );
  if (['FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_PENDING', 'RETURN_OUT', 'PICKED_UP'].includes(s.status))
    return (
      <div className="mt-4 rounded-2xl bg-ink-100 p-4 text-sm text-ink-700 dark:bg-ink-800 dark:text-ink-200">
        <p className="font-bold">{pick(s.statusLabel)}</p>
        <p className="mt-1">{t(`hero.stop.next.${s.status}`)}</p>
      </div>
    );
  return null;
}

// ---------------------------------------------------------------- deliver

function DeliverSheet({ open, onClose, stop, onDone }: { open: boolean; onClose: () => void; stop: StopDetail; onDone: (collectedCents: number) => void }) {
  const { t } = useI18n();
  const online = useOnline();
  const due = stop.collectCents;
  const [amount, setAmount] = useState('');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [receivedBy, setReceivedBy] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [withSignature, setWithSignature] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [note, setNote] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const sig = useRef<SignatureHandle>(null);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setOtp('');
    setOtpError(null);
    setReceivedBy('');
    setPhoto(null);
    setWithSignature(false);
    setHasInk(false);
    setNote('');
  }, [open, stop.id]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const entered = due > 0 ? parseEgp(amount) : 0;
  const amountOk = due === 0 || entered === due;
  const otpOk = !stop.otpRequired || /^\d{4,8}$/.test(otp.trim());

  const resend = useHeroMutation(() => api<{ sent: boolean; expiresInMinutes: number; devCode?: string }>(`/hero/tasks/orders/${stop.id}/resend-otp`, { method: 'POST' }), {
    onSuccess: (r) => {
      setCooldown(60);
      toast.success(t('hero.otp.sent', { n: minutesLabel(r.expiresInMinutes) }), r.devCode ? { description: t('hero.otp.dev', { code: r.devCode }), duration: 10_000 } : undefined);
    },
  });

  const deliver = useHeroMutation(
    async () => {
      let signatureUrl: string | undefined;
      if (withSignature && sig.current && !sig.current.isEmpty()) signatureUrl = await uploadPhoto(await sig.current.toFile(), 'signature');
      const body: DeliverBody = {
        collectedCents: due,
        otp: stop.otpRequired ? otp.trim() : undefined,
        podPhotoUrl: photo ?? undefined,
        signatureUrl,
        receivedBy: receivedBy.trim() || undefined,
        note: note.trim() || undefined,
        ...(await currentPosition()),
      };
      return api<StopDetail>(`/hero/tasks/orders/${stop.id}/deliver`, { method: 'POST', body });
    },
    {
      silentError: true,
      onSuccess: () => onDone(due),
    },
  );

  const submit = () =>
    deliver.mutate(undefined, {
      onError: (err) => {
        if (err instanceof ApiError && ['OTP_INVALID', 'OTP_EXPIRED', 'OTP_LOCKED', 'OTP_REQUIRED'].includes(err.code)) setOtpError(errorMessage(err));
        else toast.error(errorMessage(err));
      },
    });

  const canSubmit = online && amountOk && otpOk && !photoBusy;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('hero.deliver.title')}
      subtitle={<span>{stop.recipient.name} · <Ltr>{stop.trackingNumber}</Ltr></span>}
      footer={
        <div className="space-y-2 pb-1">
          {!online && <OfflineBlock />}
          <Button size="xl" block disabled={!canSubmit} loading={deliver.isPending} icon={<PackageCheck className="h-6 w-6" />} onClick={submit}>
            {due > 0 ? t('hero.deliver.confirmCollect', { amount: money(due) }) : t('hero.deliver.confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {due > 0 ? (
          <div className="rounded-2xl bg-sand-50 p-4 ring-1 ring-sand-200 dark:bg-ink-800 dark:ring-ink-700">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">{t('hero.deliver.due')}</p>
              <Money cents={due} className="font-display text-2xl font-extrabold text-sand-800 dark:text-sand-300" />
            </div>
            <Field label={t('hero.deliver.collected')} className="mt-3" error={amount && !amountOk ? t('hero.deliver.mismatch', { amount: money(due) }) : undefined}>
              {(id) => (
                <div className="flex gap-2">
                  <Input
                    id={id}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    invalid={!!amount && !amountOk}
                    className="ltr h-14 flex-1 text-center font-display text-2xl font-bold"
                  />
                  <Button variant={amountOk ? 'primary' : 'cash'} className="h-14 shrink-0 px-4" onClick={() => setAmount(String(due / 100))}>
                    {amountOk ? '✓' : t('hero.deliver.exact')}
                  </Button>
                </div>
              )}
            </Field>
            <p className="mt-2 text-xs text-ink-500">{t('hero.deliver.countHint')}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-2xl bg-turtle-50 p-3 text-sm font-semibold text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200">
            <ShieldCheck className="h-5 w-5" /> {t('hero.stop.prepaidHint')}
          </div>
        )}

        {stop.otpRequired && (
          <Field label={t('hero.otp.label')} hint={!otpError ? t('hero.otp.hint') : undefined} error={otpError ?? undefined} required>
            {(id) => (
              <div>
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, ''));
                    setOtpError(null);
                  }}
                  invalid={!!otpError}
                  className="ltr h-14 text-center font-mono text-3xl font-bold tracking-[0.5em]"
                  placeholder="••••"
                />
                <Button variant="ghost" className="mt-1 h-11" icon={<Send className="h-4 w-4" />} disabled={cooldown > 0 || !online} loading={resend.isPending} onClick={() => resend.mutate(undefined)}>
                  {cooldown > 0 ? t('hero.otp.wait', { s: cooldown }) : t('hero.otp.resend')}
                </Button>
              </div>
            )}
          </Field>
        )}

        <Field label={<>{t('hero.deliver.receivedBy')} <span className="text-xs font-normal text-ink-400">({t('hero.optional')})</span></>}>
          {(id) => (
            <div className="space-y-2">
              <Input id={id} className="h-12" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder={stop.recipient.name} maxLength={150} />
              <Chips
                value={null}
                onChange={(v) => setReceivedBy(v === 'self' ? stop.recipient.name : t(`hero.deliver.rb.${v}`))}
                options={[
                  { value: 'self', label: t('hero.deliver.rb.self') },
                  { value: 'family', label: t('hero.deliver.rb.family') },
                  { value: 'doorman', label: t('hero.deliver.rb.doorman') },
                  { value: 'colleague', label: t('hero.deliver.rb.colleague') },
                ]}
              />
            </div>
          )}
        </Field>

        <PhotoInput purpose="pod_photo" label={t('hero.deliver.photo')} value={photo} onChange={setPhoto} onBusy={setPhotoBusy} />

        {withSignature ? (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('hero.signature.title')}</p>
            <SignaturePad ref={sig} onInk={setHasInk} />
            {!hasInk && <p className="text-xs text-ink-500">{t('hero.signature.hint')}</p>}
          </div>
        ) : (
          <Button variant="outline" block className="h-12" icon={<PenLine className="h-4 w-4" />} onClick={() => setWithSignature(true)}>
            {t('hero.signature.add')}
          </Button>
        )}

        <Field label={<>{t('common.notes')} <span className="text-xs font-normal text-ink-400">({t('hero.optional')})</span></>}>
          {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
        </Field>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- failed attempt

function FailSheet({ open, onClose, stop, onDone }: { open: boolean; onClose: () => void; stop: StopDetail; onDone: (res: StopDetail, reason: FailureReason) => void }) {
  const { t } = useI18n();
  const online = useOnline();
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote('');
    setPhoto(null);
    setDay(null);
  }, [open, stop.id]);

  const today = cairoToday();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  const lastAttempt = stop.attempts + 1 >= stop.maxAttempts;
  const willReturn = reason === 'CUSTOMER_REFUSED' || lastAttempt;
  const noteRequired = reason === 'OTHER';

  const fail = useHeroMutation(
    async () => {
      const body: FailBody = { reason: reason!, note: note.trim() || undefined, photoUrl: photo ?? undefined, rescheduleDate: willReturn ? undefined : day ?? undefined, ...(await currentPosition()) };
      return api<StopDetail>(`/hero/tasks/orders/${stop.id}/fail`, { method: 'POST', body });
    },
    { onSuccess: (res) => onDone(res, reason!) },
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title={t('hero.fail.title')}
      subtitle={<span>{stop.recipient.name} · {t('hero.stop.attempts', { n: stop.attempts + 1, max: stop.maxAttempts })}</span>}
      footer={
        <div className="space-y-2 pb-1">
          {!online && <OfflineBlock />}
          <Button variant="danger" size="xl" block disabled={!reason || (noteRequired && !note.trim()) || photoBusy || !online} loading={fail.isPending} onClick={() => fail.mutate(undefined)}>
            {t('hero.fail.confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('hero.fail.why')}</p>
          <div className="grid grid-cols-2 gap-2">
            {FAILURE_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={reason === r.value}
                onClick={() => {
                  setReason(r.value);
                  if (r.value === 'CUSTOMER_REFUSED') setDay(null);
                }}
                className={cn(
                  'flex min-h-[76px] flex-col items-start justify-between gap-1.5 rounded-2xl p-3 text-start text-sm font-bold ring-2 transition active:scale-[.98] [&_svg]:h-6 [&_svg]:w-6',
                  reason === r.value ? 'bg-red-50 text-red-800 ring-red-500 dark:bg-red-950 dark:text-red-200' : 'bg-white text-ink-800 ring-ink-100 dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-700',
                )}
              >
                <span className={reason === r.value ? 'text-red-600' : 'text-ink-400'}>{r.icon}</span>
                {t(`hero.reason.${r.value}`)}
              </button>
            ))}
          </div>
        </div>

        <FailIntegrityPanel stop={stop} reason={reason} error={fail.error} />

        {willReturn && reason && (
          <div className="flex gap-2 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-800 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900">
            <TriangleAlert className="h-5 w-5 shrink-0" />
            {reason === 'CUSTOMER_REFUSED' ? t('hero.fail.refusedWarn') : t('hero.fail.lastWarn')}
          </div>
        )}

        {reason && reason !== 'CUSTOMER_REFUSED' && !lastAttempt && (
          <div>
            <p className="mb-2 text-sm font-semibold text-ink-700 dark:text-ink-200">
              {t('hero.fail.reschedule')} {reason !== 'CUSTOMER_RESCHEDULED' && <span className="text-xs font-normal text-ink-400">({t('hero.optional')})</span>}
            </p>
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-none">
              {days.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={day === d}
                  onClick={() => setDay(day === d ? null : d)}
                  className={cn(
                    'flex min-h-[56px] min-w-[72px] shrink-0 flex-col items-center justify-center rounded-2xl px-3 text-sm font-bold ring-2',
                    day === d ? 'bg-turtle-600 text-white ring-turtle-600' : 'bg-white text-ink-800 ring-ink-100 dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-700',
                  )}
                >
                  <span className="text-[11px] font-semibold opacity-80">{i === 0 ? t('hero.tomorrow') : dateTime(`${d}T12:00:00Z`, { weekday: 'short' })}</span>
                  <span>{dateTime(`${d}T12:00:00Z`, { day: 'numeric', month: 'short' })}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <Field label={t('common.notes')} required={noteRequired} hint={noteRequired ? t('hero.fail.noteRequired') : undefined}>
          {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t('hero.fail.notePh')} />}
        </Field>

        <PhotoInput purpose="attempt_photo" label={t('hero.fail.photo')} value={photo} onChange={setPhoto} onBusy={setPhotoBusy} />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- returns

function ReturnedSheet({ open, onClose, stop, onDone }: { open: boolean; onClose: () => void; stop: StopDetail; onDone: () => void }) {
  const { t } = useI18n();
  const online = useOnline();
  const [receivedBy, setReceivedBy] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [note, setNote] = useState('');
  const returned = useHeroMutation(
    async () =>
      api<StopDetail>(`/hero/tasks/orders/${stop.id}/returned`, {
        method: 'POST',
        body: { receivedBy: receivedBy.trim() || undefined, photoUrl: photo ?? undefined, note: note.trim() || undefined, ...(await currentPosition()) },
      }),
    { onSuccess: onDone },
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('hero.stop.markReturned')}
      subtitle={stop.brand.name}
      footer={
        <div className="space-y-2 pb-1">
          {!online && <OfflineBlock />}
          <Button size="xl" block variant="cash" disabled={photoBusy || !online} loading={returned.isPending} onClick={() => returned.mutate(undefined)}>
            {t('hero.returned.confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t('hero.returned.receivedBy')}>{(id) => <Input id={id} className="h-12" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} maxLength={150} />}</Field>
        <PhotoInput purpose="pod_photo" label={t('hero.returned.photo')} value={photo} onChange={setPhoto} onBusy={setPhotoBusy} />
        <Field label={t('common.notes')}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}</Field>
      </div>
    </Sheet>
  );
}

function HubConfirm({ open, onClose, onConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: (note: string) => void; loading: boolean }) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  return (
    <ConfirmDialog open={open} onClose={onClose} onConfirm={() => onConfirm(note)} loading={loading} title={t('hero.stop.toHub')} description={t('hero.stop.toHubHint')}>
      <Field label={<>{t('common.notes')} <span className="text-xs font-normal text-ink-400">({t('hero.optional')})</span></>}>
        {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
      </Field>
    </ConfirmDialog>
  );
}

function StopSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-36 rounded-3xl" />
      <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[68px] rounded-2xl" />)}</div>
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
    </div>
  );
}
