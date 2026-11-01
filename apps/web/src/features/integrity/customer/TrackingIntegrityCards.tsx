import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CheckCircle2, Crosshair, MapPin, MessageCircleWarning, PackageCheck, PackageX, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Modal, Skeleton, Textarea } from '@/components/ui';
import { Panel, useCustomerSession } from '@/portals/customer/components';
import type { TrackIntegrity } from '../types';
import '../i18n';

const PinMap = lazy(() => import('@/portals/brand/components/PinMap'));

const REASON_KEYS: Record<string, { en: string; ar: string }> = {
  CUSTOMER_UNREACHABLE: { en: 'could not reach you', ar: 'معرفش يوصلك' },
  CUSTOMER_NOT_PRESENT: { en: 'nobody was available', ar: 'محدش كان موجود' },
  CUSTOMER_REFUSED: { en: 'delivery refused', ar: 'تم رفض الاستلام' },
  CUSTOMER_RESCHEDULED: { en: 'you asked for another day', ar: 'طلبت يوم تاني' },
  WRONG_ADDRESS: { en: 'wrong address', ar: 'العنوان غلط' },
  INCOMPLETE_ADDRESS: { en: 'incomplete address', ar: 'العنوان ناقص' },
  NO_CASH: { en: 'cash was not ready', ar: 'المبلغ مكانش جاهز' },
  OUT_OF_ZONE: { en: 'outside our area', ar: 'خارج منطقة التغطية' },
  SECURITY_ACCESS: { en: 'no building access', ar: 'مقدرش يدخل المبنى' },
  OTHER: { en: 'another reason', ar: 'سبب تاني' },
};

/**
 * Customer tracking page: confirm / change day / cancel (RTO shield), answer a
 * failed attempt ("I was available"), drop the delivery pin. Works from the
 * signed message link (?c= / ?a= / ?p=) without OTP, or with a verified session.
 */
export function TrackingIntegrityCards({ tn }: { tn: string }) {
  const [params] = useSearchParams();
  const [session] = useCustomerSession();
  const tokens = { c: params.get('c') ?? undefined, a: params.get('a') ?? undefined, p: params.get('p') ?? undefined };
  const wantPin = params.get('pin') === '1';
  const q = useQuery({
    queryKey: ['track-integrity', tn, tokens, session?.accessToken ?? null],
    queryFn: () => api<TrackIntegrity>(`/track/${tn}/integrity`, { query: tokens, auth: session ? 'customer' : 'none' }),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const d = q.data;
  if (q.isLoading) return null;
  if (!d) return null;
  const showConfirm = d.confirmation.canRespond;
  const showAttempt = !!d.attempt && (d.attempt.canRespond || d.attempt.disputeStatus === 'DISPUTED');
  const showPin = d.pin.canDrop && d.pin.authorized && (wantPin || !d.pin.hasPin);
  if (!showConfirm && !showAttempt && !showPin) return null;
  return (
    <div className="space-y-4">
      {showConfirm && <ConfirmationCard d={d} tn={tn} token={tokens.c} auth={session ? 'customer' : 'none'} />}
      {showAttempt && <AttemptCard d={d} tn={tn} token={tokens.a} auth={session ? 'customer' : 'none'} />}
      {showPin && <PinCard d={d} tn={tn} token={tokens.p ?? tokens.c} auth={session ? 'customer' : 'none'} />}
    </div>
  );
}

type Auth = 'customer' | 'none';

function useRefresh(tn: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['track-integrity', tn] });
    void qc.invalidateQueries({ queryKey: ['track', tn] });
  };
}

function NotAuthorized({ link }: { link: string | null }) {
  const { t } = useI18n();
  return <p className="rounded-2xl bg-ink-50 px-3 py-2 text-sm text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">{link === 'EXPIRED' ? t('integrity.track.linkExpired') : t('integrity.track.needVerify')}</p>;
}

function ConfirmationCard({ d, tn, token, auth }: { d: TrackIntegrity; tn: string; token?: string; auth: Auth }) {
  const { t } = useI18n();
  const refresh = useRefresh(tn);
  const [mode, setMode] = useState<'idle' | 'day' | 'decline'>('idle');
  const [day, setDay] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const days: string[] = [];
  for (let cur = d.confirmation.rescheduleRange.min; cur <= d.confirmation.rescheduleRange.max && days.length < 7;) {
    days.push(cur);
    const n = new Date(`${cur}T12:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    cur = n.toISOString().slice(0, 10);
  }
  const m = useMutation({
    mutationFn: (body: { action: 'CONFIRM' | 'RESCHEDULE' | 'DECLINE'; date?: string; note?: string }) =>
      api<{ confirmationStatus: string; scheduledDate: string | null }>(`/track/${tn}/confirmation`, { method: 'POST', auth, body: { ...body, token } }),
    onSuccess: (r, body) => {
      setMode('idle');
      setDone(body.action === 'CONFIRM' ? t('integrity.track.confirmed') : body.action === 'RESCHEDULE' ? t('integrity.track.rescheduled', { d: dateTime(`${r.scheduledDate}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' }) }) : t('integrity.track.declined'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (done) {
    return (
      <Panel className="flex items-center gap-3">
        <CheckCircle2 className="h-8 w-8 shrink-0 text-turtle-600" />
        <p className="font-semibold text-ink-900 dark:text-white">{done}</p>
      </Panel>
    );
  }
  return (
    <Panel className="border-amber-200 ring-1 ring-amber-200 dark:border-amber-900 dark:ring-amber-900">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><PackageCheck className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-ink-900 dark:text-white">{t('integrity.track.confirmTitle')}</h2>
          <p className="text-sm text-ink-500">{t('integrity.track.confirmHint')}</p>
        </div>
      </div>
      {!d.confirmation.authorized ? (
        <div className="mt-4"><NotAuthorized link={d.confirmation.link} /></div>
      ) : mode === 'day' ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">{t('integrity.track.pickDay')}</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
            {days.map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={day === x}
                onClick={() => setDay(x)}
                className={cn('flex min-h-[56px] min-w-[72px] shrink-0 flex-col items-center justify-center rounded-2xl px-3 text-sm font-bold ring-2', day === x ? 'bg-turtle-600 text-white ring-turtle-600' : 'bg-white text-ink-800 ring-ink-100 dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-700')}
              >
                <span className="text-[11px] font-semibold opacity-80">{dateTime(`${x}T12:00:00Z`, { weekday: 'short' })}</span>
                <span>{dateTime(`${x}T12:00:00Z`, { day: 'numeric', month: 'short' })}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button block size="lg" disabled={!day} loading={m.isPending} onClick={() => day && m.mutate({ action: 'RESCHEDULE', date: day })}>{t('integrity.track.saveDay')}</Button>
            <Button size="lg" variant="outline" onClick={() => setMode('idle')}>{t('action.back')}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Button size="lg" icon={<PackageCheck className="h-5 w-5" />} loading={m.isPending && m.variables?.action === 'CONFIRM'} onClick={() => m.mutate({ action: 'CONFIRM' })}>{t('integrity.track.confirm')}</Button>
          <Button size="lg" variant="outline" icon={<CalendarDays className="h-5 w-5" />} onClick={() => setMode('day')}>{t('integrity.track.change')}</Button>
          <Button size="lg" variant="ghost" className="text-red-600 dark:text-red-400" icon={<PackageX className="h-5 w-5" />} onClick={() => setMode('decline')}>{t('integrity.track.decline')}</Button>
        </div>
      )}
      <Modal
        open={mode === 'decline'}
        onClose={() => setMode('idle')}
        title={t('integrity.track.declineTitle')}
        description={t('integrity.track.declineHint')}
        footer={<><Button variant="outline" onClick={() => setMode('idle')}>{t('action.back')}</Button><Button variant="danger" loading={m.isPending} onClick={() => m.mutate({ action: 'DECLINE', note: note.trim() || undefined })}>{t('integrity.track.decline')}</Button></>}
      >
        <Field label={t('integrity.track.declineReason')}>{(id) => <Textarea id={id} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </Modal>
    </Panel>
  );
}

function AttemptCard({ d, tn, token, auth }: { d: TrackIntegrity; tn: string; token?: string; auth: Auth }) {
  const { t, locale } = useI18n();
  const refresh = useRefresh(tn);
  const a = d.attempt!;
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (answer: 'CONFIRM' | 'DISPUTE') => api<{ ticketCode: string | null; disputeStatus: string }>(`/track/${tn}/attempt-feedback`, { method: 'POST', auth, body: { answer, attemptId: a.id, token, note: answer === 'DISPUTE' ? note.trim() || undefined : undefined } }),
    onSuccess: (r, answer) => { setDone(answer === 'DISPUTE' ? t('integrity.track.disputed', { code: r.ticketCode ?? '' }) : t('integrity.track.attemptConfirmed')); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reason = a.failureReason ? (REASON_KEYS[a.failureReason] ?? REASON_KEYS.OTHER)[locale] : '';
  if (done || a.disputeStatus === 'DISPUTED') {
    return (
      <Panel className="flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 shrink-0 text-turtle-600" />
        <p className="font-semibold text-ink-900 dark:text-white">{done ?? t('integrity.track.disputeOpen')}</p>
      </Panel>
    );
  }
  return (
    <Panel>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"><MessageCircleWarning className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-ink-900 dark:text-white">{t('integrity.track.attemptTitle', { t: timeOnly(a.at) })}</h2>
          <p className="text-sm text-ink-500">{t('integrity.track.attemptHint', { hero: a.heroFirstName ?? t('common.hero'), reason })}</p>
          <p className="mt-1 text-xs text-ink-400">{t('integrity.track.windowEnds', { t: dateTime(a.windowEndsAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) })}</p>
        </div>
      </div>
      {!a.authorized ? (
        <div className="mt-4"><NotAuthorized link={a.link} /></div>
      ) : disputing ? (
        <div className="mt-4 space-y-3">
          <Field label={t('integrity.track.disputeNote')}>{(id) => <Textarea id={id} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button block size="lg" variant="danger" loading={m.isPending} onClick={() => m.mutate('DISPUTE')}>{t('integrity.track.disputeSend')}</Button>
            <Button size="lg" variant="outline" onClick={() => setDisputing(false)}>{t('action.back')}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button size="lg" variant="outline" loading={m.isPending} onClick={() => m.mutate('CONFIRM')}>{t('integrity.track.attemptOk')}</Button>
          <Button size="lg" variant="danger" onClick={() => setDisputing(true)}>{t('integrity.track.attemptDispute')}</Button>
        </div>
      )}
    </Panel>
  );
}

function PinCard({ d, tn, token, auth }: { d: TrackIntegrity; tn: string; token?: string; auth: Auth }) {
  const { t } = useI18n();
  const refresh = useRefresh(tn);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);
  useEffect(() => setSaved(false), [tn]);
  const m = useMutation({
    mutationFn: () => api(`/track/${tn}/pin`, { method: 'POST', auth, body: { ...pin!, token } }),
    onSuccess: () => { setSaved(true); toast.success(t('integrity.track.pinSaved')); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const gps = () => {
    if (!('geolocation' in navigator)) return toast.error(t('integrity.track.gpsFail'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setPin({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }); },
      () => { setLocating(false); toast.error(t('integrity.track.gpsFail')); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  if (saved) {
    return (
      <Panel className="flex items-center gap-3">
        <MapPin className="h-8 w-8 shrink-0 text-turtle-600" />
        <p className="font-semibold text-ink-900 dark:text-white">{t('integrity.track.pinDone')}</p>
      </Panel>
    );
  }
  return (
    <Panel>
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><MapPin className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-ink-900 dark:text-white">{t('integrity.track.pinTitle')}</h2>
          <p className="text-sm text-ink-500">{t('integrity.track.pinHint')}</p>
        </div>
      </div>
      <Suspense fallback={<Skeleton className="h-60 w-full rounded-2xl" />}>
        <PinMap value={pin} onChange={setPin} center={d.pin.center} height={240} />
      </Suspense>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button size="lg" variant="outline" icon={<Crosshair className="h-5 w-5" />} loading={locating} onClick={gps}>{t('integrity.track.pinGps')}</Button>
        <Button size="lg" disabled={!pin} loading={m.isPending} onClick={() => m.mutate()}>{t('integrity.track.pinSave')}</Button>
      </div>
    </Panel>
  );
}
