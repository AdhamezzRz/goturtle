import { useState } from 'react';
import { CalendarCheck, CalendarClock, Clock3, LocateFixed, LogIn, LogOut, MapPin, TriangleAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { cairoToday, dateTime, money, timeOnly } from '@/lib/format';
import { useOnline } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Badge, Button, ErrorState, Skeleton } from '@/components/ui';
import { Money, OfflineBlock, Panel, RefreshButton, SectionTitle, Sheet, StickyBar, SuccessOverlay, useNow } from '../components/kit';
import { useHeroMutation, useInvalidateHero, useProfile, useShifts } from '../lib/queries';
import { distanceMetres, requestLocation, useGeo } from '../lib/geo';
import { addDays, duration, minutesLabel } from '../lib/util';
import type { Shift } from '../types';

const EARLY_MS = 30 * 60_000;
const GEOFENCE_M = 500;

export default function ShiftsPage() {
  const { t } = useI18n();
  const today = cairoToday();
  const from = addDays(today, -14);
  const to = addDays(today, 14);
  const shifts = useShifts(from, to);
  const profile = useProfile();
  const now = useNow(15_000);
  const [clock, setClock] = useState<{ kind: 'in' | 'out'; shift: Shift } | null>(null);
  const [done, setDone] = useState<{ title: string; subtitle: string; warn: boolean } | null>(null);
  const invalidate = useInvalidateHero();

  const confirm = useHeroMutation((id: string) => api(`/hero/me/shifts/${id}/confirm`, { method: 'POST' }), {
    onSuccess: () => {
      toast.success(t('hero.shifts.confirmed'));
      invalidate(['hero', 'shifts']);
    },
  });

  if (!shifts.data && shifts.isError) return <ErrorState error={shifts.error} onRetry={() => shifts.refetch()} />;
  if (!shifts.data) return <ShiftsSkeleton />;

  const list = [...shifts.data.data].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const current = list.find((s) => s.status === 'IN_PROGRESS') ?? null;
  const upcoming = list.filter((s) => (s.status === 'SCHEDULED' || s.status === 'CONFIRMED') && +new Date(s.endAt) > now);
  const next = current ? null : upcoming[0] ?? null;
  const later = upcoming.filter((s) => s !== next);
  const past = list.filter((s) => s !== current && !upcoming.includes(s)).reverse();
  const isFreelance = profile.data?.employmentType === 'FREELANCE';
  const s = shifts.data.summary;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold text-ink-900 dark:text-white">{t('hero.shifts.title')}</h1>
        <RefreshButton spinning={shifts.isFetching} onClick={() => void shifts.refetch()} />
      </div>

      {current ? (
        <CurrentShift shift={current} now={now} />
      ) : next ? (
        <NextShift shift={next} now={now} onConfirm={() => confirm.mutate(next.id)} confirming={confirm.isPending} />
      ) : (
        <Panel className="py-8 text-center">
          <CalendarClock className="mx-auto h-10 w-10 text-ink-300" />
          <p className="mt-3 font-display text-lg font-bold text-ink-900 dark:text-white">{isFreelance ? t('hero.shifts.freelanceTitle') : t('hero.shifts.noneTitle')}</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">{isFreelance ? t('hero.shifts.freelanceHint') : t('hero.shifts.noneHint')}</p>
        </Panel>
      )}

      {list.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label={t('hero.shifts.worked')} value={minutesLabel(s.workedMinutes)} />
          <Stat label={t('hero.shifts.scheduled')} value={minutesLabel(s.scheduledMinutes)} />
          <Stat label={t('hero.shifts.earned')} value={<Money cents={s.earnedCents} />} />
        </div>
      )}

      {later.length > 0 && (
        <>
          <SectionTitle count={later.length}>{t('hero.shifts.upcoming')}</SectionTitle>
          <ul className="space-y-2">{later.map((sh) => <ShiftRow key={sh.id} s={sh} onConfirm={sh.status === 'SCHEDULED' ? () => confirm.mutate(sh.id) : undefined} />)}</ul>
        </>
      )}
      {past.length > 0 && (
        <>
          <SectionTitle count={past.length}>{t('hero.shifts.past')}</SectionTitle>
          <ul className="space-y-2">{past.map((sh) => <ShiftRow key={sh.id} s={sh} />)}</ul>
        </>
      )}

      {current && (
        <StickyBar>
          <Button size="xl" block variant="secondary" className="shadow-pop" icon={<LogOut className="h-5 w-5" />} onClick={() => setClock({ kind: 'out', shift: current })}>
            {t('hero.shifts.clockOut')}
          </Button>
        </StickyBar>
      )}
      {next && (
        <StickyBar>
          {+new Date(next.startAt) - EARLY_MS <= now ? (
            <Button size="xl" block className="shadow-pop" icon={<LogIn className="h-5 w-5" />} onClick={() => setClock({ kind: 'in', shift: next })}>
              {t('hero.shifts.clockIn')}
            </Button>
          ) : (
            <Button size="xl" block variant="outline" disabled icon={<Clock3 className="h-5 w-5" />}>
              {t('hero.shifts.opensAt', { time: timeOnly(new Date(+new Date(next.startAt) - EARLY_MS)) })}
            </Button>
          )}
        </StickyBar>
      )}

      <ClockSheet
        open={!!clock}
        clock={clock}
        hub={profile.data?.homeHub ?? null}
        onClose={() => setClock(null)}
        onDone={(kind, res) => {
          setClock(null);
          const warn = !!res.warnings?.includes('GEOFENCE_WARNING') || res.geofenceWarning;
          setDone({
            title: kind === 'in' ? t('hero.shifts.inDone') : t('hero.shifts.outDone'),
            subtitle:
              kind === 'in'
                ? warn ? t('hero.shifts.geofenceFlagged') : t('hero.shifts.inDoneHint', { time: timeOnly(res.endAt) })
                : t('hero.shifts.outDoneHint', { worked: minutesLabel(res.workedMinutes), amount: money(res.earnedCents) }),
            warn,
          });
        }}
      />
      <SuccessOverlay
        open={!!done}
        tone={done?.warn ? 'amber' : 'green'}
        icon={done?.warn ? <TriangleAlert className="h-16 w-16" /> : undefined}
        title={done?.title}
        subtitle={done?.subtitle}
        continueLabel={t('action.close')}
        autoMs={done?.warn ? 0 : 2600}
        onContinue={() => setDone(null)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-card dark:bg-ink-900">
      <p className="text-[11px] font-semibold text-ink-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-extrabold text-ink-900 dark:text-white">{value}</p>
    </div>
  );
}

function shiftTime(s: Shift) {
  return `${timeOnly(s.startAt)} – ${timeOnly(s.endAt)}`;
}

function CurrentShift({ shift, now }: { shift: Shift; now: number }) {
  const { t } = useI18n();
  const end = +new Date(shift.endAt);
  const worked = shift.clockInAt ? now - +new Date(shift.clockInAt) : 0;
  const total = end - +new Date(shift.startAt);
  const progress = Math.max(0, Math.min(1, (now - +new Date(shift.startAt)) / total));
  return (
    <div className="rounded-3xl bg-gradient-to-br from-turtle-600 to-turtle-800 p-5 text-white shadow-pop">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
          <span className="h-2 w-2 animate-pulse rounded-full bg-turtle-300" /> {t('hero.shifts.onShift')}
        </span>
        {shift.lateMinutes > 0 && <span className="rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-ink-950">{t('hero.shifts.lateBy', { d: minutesLabel(shift.lateMinutes) })}</span>}
      </div>
      <p className="mt-3 text-sm text-white/80">{t('hero.shifts.endsIn')}</p>
      <p className="font-display text-4xl font-extrabold">{end > now ? duration(end - now) : t('hero.shifts.overtime')}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
        <div className="h-full rounded-full bg-white" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-white/85">
        <span className="ltr rounded-full bg-white/15 px-2 py-0.5">{shiftTime(shift)}</span>
        {shift.clockInAt && <span className="rounded-full bg-white/15 px-2 py-0.5">{t('hero.shifts.clockedInAt', { time: timeOnly(shift.clockInAt) })}</span>}
        <span className="rounded-full bg-white/15 px-2 py-0.5">{t('hero.shifts.workedSoFar', { d: duration(worked) })}</span>
        {shift.hub && <span className="rounded-full bg-white/15 px-2 py-0.5">{shift.hub.name}</span>}
      </div>
      {shift.geofenceWarning && <p className="mt-3 rounded-xl bg-amber-400 px-3 py-2 text-xs font-bold text-ink-950">{t('hero.shifts.geofenceFlagged')}</p>}
    </div>
  );
}

function NextShift({ shift, now, onConfirm, confirming }: { shift: Shift; now: number; onConfirm: () => void; confirming: boolean }) {
  const { t } = useI18n();
  const start = +new Date(shift.startAt);
  const open = start - EARLY_MS <= now;
  return (
    <div className={cn('rounded-3xl p-5 shadow-card', open ? 'bg-gradient-to-br from-sky-600 to-sky-800 text-white' : 'bg-white dark:bg-ink-900')}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('rounded-full px-3 py-1 text-xs font-bold', open ? 'bg-white/15' : 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300')}>{t('hero.shifts.next')}</span>
        <ShiftBadge s={shift} />
      </div>
      <p className={cn('mt-3 text-sm', open ? 'text-white/80' : 'text-ink-500')}>{start > now ? t('hero.shifts.startsIn') : t('hero.shifts.startedAgo')}</p>
      <p className={cn('font-display text-4xl font-extrabold', !open && 'text-ink-900 dark:text-white')}>{duration(Math.abs(start - now))}</p>
      <p className={cn('mt-2 text-sm font-semibold', open ? 'text-white/90' : 'text-ink-700 dark:text-ink-200')}>
        {dateTime(shift.startAt, { weekday: 'long', day: 'numeric', month: 'short' })} · <span className="ltr">{shiftTime(shift)}</span>
      </p>
      <p className={cn('mt-0.5 text-xs', open ? 'text-white/75' : 'text-ink-500')}>
        {shift.template?.name ? `${shift.template.name} · ` : ''}{shift.hub?.name}
        {shift.expectedEarningsCents > 0 && <> · {t('hero.shifts.expected')} <Money cents={shift.expectedEarningsCents} /></>}
      </p>
      {shift.status === 'SCHEDULED' && (
        <Button variant={open ? 'secondary' : 'outline'} className="mt-4 h-12 w-full" loading={confirming} icon={<CalendarCheck className="h-4 w-4" />} onClick={onConfirm}>
          {t('hero.shifts.confirm')}
        </Button>
      )}
    </div>
  );
}

function ShiftBadge({ s }: { s: Shift }) {
  const { t } = useI18n();
  const tone = { SCHEDULED: 'info', CONFIRMED: 'success', IN_PROGRESS: 'progress', COMPLETED: 'success', MISSED: 'danger', CANCELLED: 'neutral' } as const;
  return <Badge tone={tone[s.status]} dot>{t(`hero.shift.status.${s.status}`)}</Badge>;
}

function ShiftRow({ s, onConfirm }: { s: Shift; onConfirm?: () => void }) {
  const { t } = useI18n();
  return (
    <li className="rounded-2xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink-900 dark:text-white">{dateTime(s.startAt, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
          <p className="ltr text-start text-xs text-ink-500">{shiftTime(s)}</p>
        </div>
        <ShiftBadge s={s} />
      </div>
      {s.status === 'COMPLETED' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone="neutral">{t('hero.shifts.workedN', { d: minutesLabel(s.workedMinutes) })}</Badge>
          {s.lateMinutes > 0 && <Badge tone="warning">{t('hero.shifts.lateBy', { d: minutesLabel(s.lateMinutes) })}</Badge>}
          {s.overtimeMinutes > 0 && <Badge tone="success">{t('hero.shifts.overtimeN', { d: minutesLabel(s.overtimeMinutes) })}</Badge>}
          {s.earnedCents > 0 && <Badge tone="cash"><Money cents={s.earnedCents} /></Badge>}
          {s.geofenceWarning && <Badge tone="warning"><MapPin className="h-3 w-3" /> {t('hero.shifts.geofence')}</Badge>}
          {s.autoClockOut && <Badge tone="neutral">{t('hero.shifts.autoOut')}</Badge>}
        </div>
      )}
      {onConfirm && (
        <Button variant="outline" size="sm" className="mt-2 h-10" icon={<CalendarCheck className="h-4 w-4" />} onClick={onConfirm}>
          {t('hero.shifts.confirm')}
        </Button>
      )}
    </li>
  );
}

function ClockSheet({
  open, clock, hub, onClose, onDone,
}: {
  open: boolean; clock: { kind: 'in' | 'out'; shift: Shift } | null; hub: { id: string; name: string; lat: number | null; lng: number | null } | null; onClose: () => void; onDone: (kind: 'in' | 'out', res: Shift) => void;
}) {
  const { t } = useI18n();
  const online = useOnline();
  const geo = useGeo();
  const qc = useQueryClient();
  const invalidate = useInvalidateHero();
  const [locating, setLocating] = useState(false);
  const fix = geo.last && Date.now() - geo.last.at < 120_000 ? geo.last : null;
  const hubForShift = clock && hub && (!clock.shift.hub || clock.shift.hub.id === hub.id) ? hub : null;
  const distance = fix && hubForShift?.lat != null && hubForShift.lng != null ? distanceMetres(fix, { lat: hubForShift.lat, lng: hubForShift.lng }) : null;

  const mutation = useHeroMutation(
    async () => {
      let pos = fix;
      if (!pos) pos = await requestLocation();
      if (!pos) throw Object.assign(new Error(t('hero.shifts.needGps')), { code: 'GPS' });
      return api<Shift>(`/hero/me/shifts/${clock!.shift.id}/clock-${clock!.kind}`, { method: 'POST', body: { lat: pos.lat, lng: pos.lng } });
    },
    {
      onSuccess: (res) => {
        invalidate(['hero', 'shifts']);
        void qc.invalidateQueries({ queryKey: ['hero', 'earnings'] });
        onDone(clock!.kind, res);
      },
    },
  );

  if (!clock) return null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={clock.kind === 'in' ? t('hero.shifts.clockIn') : t('hero.shifts.clockOut')}
      subtitle={<span className="ltr">{shiftTime(clock.shift)}</span>}
      footer={
        <div className="space-y-2 pb-1">
          {!online && <OfflineBlock />}
          <Button size="xl" block variant={clock.kind === 'in' ? 'primary' : 'secondary'} loading={mutation.isPending} disabled={!online} icon={clock.kind === 'in' ? <LogIn className="h-5 w-5" /> : <LogOut className="h-5 w-5" />} onClick={() => mutation.mutate(undefined)}>
            {clock.kind === 'in' ? t('hero.shifts.clockInNow') : t('hero.shifts.clockOutNow')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="flex items-center gap-3 rounded-2xl bg-ink-50 p-4 dark:bg-ink-800">
          <LocateFixed className={cn('h-6 w-6 shrink-0', fix ? 'text-turtle-600' : 'text-ink-400')} />
          <div className="min-w-0 flex-1 text-sm">
            {fix ? (
              <>
                <p className="font-semibold text-ink-900 dark:text-white">{t('hero.shifts.gpsOk')}</p>
                <p className="text-xs text-ink-500">{fix.accuracy != null ? t('hero.shifts.accuracy', { m: Math.round(fix.accuracy) }) : ''}</p>
              </>
            ) : (
              <p className="font-semibold text-ink-700 dark:text-ink-200">{geo.permission === 'denied' ? t('hero.geo.denied') : t('hero.shifts.gpsNeeded')}</p>
            )}
          </div>
          {!fix && geo.permission !== 'denied' && (
            <Button
              size="sm"
              variant="outline"
              className="h-10"
              loading={locating}
              onClick={async () => {
                setLocating(true);
                await requestLocation();
                setLocating(false);
              }}
            >
              {t('hero.geo.locate')}
            </Button>
          )}
        </div>
        {distance != null && hubForShift && (
          <div className={cn('flex gap-3 rounded-2xl p-4 text-sm ring-1', distance > GEOFENCE_M ? 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900' : 'bg-turtle-50 text-turtle-900 ring-turtle-200 dark:bg-turtle-950 dark:text-turtle-100 dark:ring-turtle-900')}>
            {distance > GEOFENCE_M ? <TriangleAlert className="h-5 w-5 shrink-0" /> : <MapPin className="h-5 w-5 shrink-0" />}
            <p className="font-semibold">
              {distance > GEOFENCE_M
                ? t('hero.shifts.farFromHub', { d: distance >= 1000 ? t('hero.km', { n: (distance / 1000).toFixed(1) }) : t('hero.m', { n: Math.round(distance) }), hub: hubForShift.name })
                : t('hero.shifts.atHub', { hub: hubForShift.name })}
            </p>
          </div>
        )}
        {clock.kind === 'out' && <p className="text-sm text-ink-500">{t('hero.shifts.outHint')}</p>}
      </div>
    </Sheet>
  );
}

function ShiftsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-52 rounded-3xl" />
      <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
    </div>
  );
}
