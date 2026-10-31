import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronDown, Coffee, Coins, LocateFixed, LocateOff, Power, Wallet, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, money, num, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Button } from '@/components/ui';
import { Money, Sheet } from './components/kit';
import { useDashboard, useEarningsTotals, useHeroMutation, useInvalidateHero } from './lib/queries';
import { periodRange } from './lib/util';
import { requestLocation, useGeo, useLocationTracker } from './lib/geo';
import type { Availability, Dashboard } from './types';
import { prefetchHeroScreens } from './lib/prefetch';
import './lib/pwa';

type Settable = 'ONLINE' | 'ON_BREAK' | 'OFFLINE';

const DOT: Record<Availability, string> = {
  ONLINE: 'bg-turtle-300 shadow-[0_0_0_4px_rgba(65,206,138,.35)]',
  BUSY: 'bg-violet-300 shadow-[0_0_0_4px_rgba(167,139,250,.35)]',
  ON_BREAK: 'bg-amber-300 shadow-[0_0_0_4px_rgba(252,201,77,.35)]',
  OFFLINE: 'bg-ink-300',
};

/** Top bar of the hero app: who I am, availability switch, cash in hand and today's earnings. Also runs GPS tracking. */
export function HeroHeader() {
  const { me } = useAuth();
  const { t } = useI18n();
  const dash = useDashboard();
  // Today's earnings from the ledger (same number as the Earnings screen, bonuses included).
  const range = periodRange('today');
  const earned = useEarningsTotals(range.from, range.to, 60_000);
  const [open, setOpen] = useState(false);
  const d = dash.data;
  const availability: Availability = (d?.hero.availability ?? (me?.courier?.availability as Availability | undefined)) ?? 'OFFLINE';
  const working = availability === 'ONLINE' || availability === 'BUSY';
  useLocationTracker(!!me && working);
  const geo = useGeo();
  useEffect(() => prefetchHeroScreens(), []);
  if (!me) return null;

  const cash = d?.cash ?? { onHandCents: me.courier?.cashOnHandCents ?? 0, limitCents: me.courier?.cashLimitCents ?? 0, warning: 'OK' };
  const ratio = cash.limitCents > 0 ? cash.onHandCents / cash.limitCents : 0;
  const cashTone = cash.warning === 'OVER_LIMIT' || ratio >= 1 ? 'red' : cash.warning === 'NEAR_LIMIT' || ratio >= 0.8 ? 'amber' : 'ok';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Link to="/hero/me" aria-label={t('hero.tab.me')} className="shrink-0">
          <Avatar name={me.name} src={me.avatarUrl} size={44} className="ring-2 ring-white/40" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold leading-tight">{me.name}</p>
          <p className="text-xs text-turtle-100/80"><span className="ltr">{d?.hero.code ?? me.courier?.code}</span></p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={t('hero.availability.change')}
          className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-white/15 pe-3 ps-3.5 text-sm font-bold ring-1 ring-inset ring-white/25 active:bg-white/25"
        >
          <span className={cn('h-2.5 w-2.5 rounded-full', DOT[availability])} />
          {t(`hero.availability.${availability}`)}
          <ChevronDown className="h-4 w-4 opacity-80" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/hero/wallet"
          className={cn(
            'flex min-h-[48px] items-center gap-2 rounded-2xl px-3 py-1.5 ring-1 ring-inset transition active:scale-[.98]',
            cashTone === 'red' ? 'bg-red-500 text-white ring-red-300/60' : cashTone === 'amber' ? 'bg-sand-300 text-ink-950 ring-sand-200' : 'bg-white/10 ring-white/20',
          )}
        >
          <Wallet className="h-5 w-5 shrink-0" />
          <span className="min-w-0 leading-tight">
            <span className={cn('block text-[11px] font-semibold', cashTone === 'ok' ? 'text-turtle-100/80' : 'opacity-80')}>
              {cashTone === 'red' ? t('hero.header.cashOver') : t('hero.header.cash')}
            </span>
            <span className="block truncate text-sm font-extrabold">
              {/* Whole pounds, compact above 10k so it never truncates on a 360px phone. */}
              <span className="ltr tabular inline-block">{money(Math.round(cash.onHandCents / 100) * 100, { compact: cash.onHandCents >= 1_000_000 })}</span>
              {cash.limitCents > 0 && <span className="text-[11px] font-semibold opacity-75"> / {num(Math.round(cash.limitCents / 100))}</span>}
            </span>
          </span>
        </Link>
        <Link to="/hero/earnings" className="flex min-h-[48px] items-center gap-2 rounded-2xl bg-white/10 px-3 py-1.5 ring-1 ring-inset ring-white/20 active:scale-[.98]">
          <Coins className="h-5 w-5 shrink-0 text-sand-300" />
          <span className="min-w-0 leading-tight">
            <span className="block text-[11px] font-semibold text-turtle-100/80">{t('hero.header.earnedToday')}</span>
            <span className="block truncate text-sm font-extrabold">{earned.data ? <Money cents={earned.data.totals.earnedCents} /> : d ? <Money cents={d.today.earningsCents} /> : '—'}</span>
          </span>
        </Link>
      </div>

      {working && (geo.permission === 'denied' || geo.permission === 'prompt' || geo.permission === 'unsupported') && <LocationPrompt denied={geo.permission === 'denied'} unsupported={geo.permission === 'unsupported'} />}

      <AvailabilitySheet open={open} onClose={() => setOpen(false)} current={availability} dash={d} />
    </div>
  );
}

function LocationPrompt({ denied, unsupported }: { denied: boolean; unsupported: boolean }) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-amber-300 px-3 py-2 text-ink-950">
      <LocateOff className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1 text-xs font-semibold leading-snug">{unsupported ? t('hero.geo.unsupported') : denied ? t('hero.geo.denied') : t('hero.geo.prompt')}</p>
      {!unsupported && !denied && (
        <Button
          size="sm"
          variant="secondary"
          className="h-10 shrink-0"
          loading={asking}
          icon={<LocateFixed className="h-4 w-4" />}
          onClick={async () => {
            setAsking(true);
            const fix = await requestLocation();
            setAsking(false);
            if (fix) toast.success(t('hero.geo.on'));
          }}
        >
          {t('hero.geo.enable')}
        </Button>
      )}
    </div>
  );
}

function AvailabilitySheet({ open, onClose, current, dash }: { open: boolean; onClose: () => void; current: Availability; dash: Dashboard | undefined }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const invalidate = useInvalidateHero();
  const { refreshMe } = useAuth();
  const [noShift, setNoShift] = useState(false);
  const isShiftHero = dash?.hero.employmentType === 'SHIFT';
  const nextShift = dash?.shifts.next ?? null;
  const currentShift = dash?.shifts.current ?? null;

  const mutation = useHeroMutation(
    (availability: Settable) => api<{ availability: Availability }>('/hero/me/availability', { method: 'PATCH', body: { availability } }),
    {
      silentError: true,
      onSuccess: (res, v) => {
        qc.setQueryData<Dashboard>(['hero', 'dashboard'], (old) => (old ? { ...old, hero: { ...old.hero, availability: res.availability } } : old));
        invalidate();
        refreshMe();
        setNoShift(false);
        toast.success(t(`hero.availability.done.${v}`));
        onClose();
      },
    },
  );

  const choose = (v: Settable) => {
    setNoShift(false);
    mutation.mutate(v, {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'NO_ACTIVE_SHIFT') setNoShift(true);
        else toast.error(errorMessage(err));
      },
    });
  };

  const options: Array<{ value: Settable; icon: React.ReactNode; tone: string }> = [
    { value: 'ONLINE', icon: <Zap className="h-6 w-6" />, tone: 'bg-turtle-600 text-white' },
    { value: 'ON_BREAK', icon: <Coffee className="h-6 w-6" />, tone: 'bg-amber-400 text-ink-950' },
    { value: 'OFFLINE', icon: <Power className="h-6 w-6" />, tone: 'bg-ink-700 text-white' },
  ];
  const selected: Settable = current === 'BUSY' ? 'ONLINE' : (current as Settable);

  return (
    <Sheet open={open} onClose={onClose} title={t('hero.availability.title')} subtitle={current === 'BUSY' ? t('hero.availability.busyHint') : undefined}>
      <div className="space-y-3 pb-2">
        {options.map((o) => {
          const active = selected === o.value;
          const blocked = o.value === 'ONLINE' && isShiftHero && !currentShift && !active;
          return (
            <button
              key={o.value}
              type="button"
              disabled={mutation.isPending}
              onClick={() => (active ? onClose() : choose(o.value))}
              className={cn(
                'flex w-full items-center gap-4 rounded-2xl p-4 text-start ring-2 transition active:scale-[.99] disabled:opacity-60',
                active ? 'bg-turtle-50 ring-turtle-500 dark:bg-turtle-950' : 'bg-white ring-ink-100 dark:bg-ink-900 dark:ring-ink-800',
              )}
            >
              <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', o.tone)}>{o.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-ink-900 dark:text-white">{t(`hero.availability.set.${o.value}`)}</span>
                <span className="block text-sm text-ink-500">
                  {blocked ? t('hero.availability.shiftOnly') : t(`hero.availability.hint.${o.value}`)}
                </span>
              </span>
              {mutation.isPending && mutation.variables === o.value ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-turtle-600 border-t-transparent" />
              ) : (
                active && <span className="rounded-full bg-turtle-600 px-2.5 py-1 text-xs font-bold text-white">{t('hero.availability.current')}</span>
              )}
            </button>
          );
        })}

        {noShift && (
          <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-amber-950 dark:ring-amber-900">
            <p className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
              <CalendarClock className="h-5 w-5" /> {t('hero.availability.noShiftTitle')}
            </p>
            <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
              {nextShift ? t('hero.availability.noShiftNext', { time: timeOnly(nextShift.startAt), day: shiftDayLabel(nextShift.startAt, t) }) : t('hero.availability.noShiftNone')}
            </p>
            <Link to="/hero/shifts" onClick={onClose} className="mt-3 inline-flex h-11 items-center rounded-xl bg-amber-500 px-4 text-sm font-bold text-ink-950">
              {t('hero.availability.openShifts')}
            </Link>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function shiftDayLabel(iso: string, t: (k: string) => string) {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
  const day = fmt(new Date(iso));
  if (day === fmt(new Date())) return t('common.today');
  if (day === fmt(new Date(Date.now() + 86_400_000))) return t('hero.tomorrow');
  return dateTime(iso, { weekday: 'long' });
}
