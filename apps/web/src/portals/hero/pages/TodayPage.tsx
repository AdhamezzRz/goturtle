import { useState } from 'react';
import { ArchTile } from '@/components/brand';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Clock, KeyRound, MapPin, Navigation, Phone, Play, Route, Sparkles, Store, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ago, num, timeOnly } from '@/lib/format';
import { useOnline } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Badge, Button, ErrorState, Skeleton } from '@/components/ui';
import { Money, Panel, ProgressRing, RefreshButton, SectionTitle, StickyBar } from '../components/kit';
import { PickupRow, ReturnRow, StopRow } from '../components/rows';
import { useDashboard, useHeroMutation, useInvalidateHero, useStop, useToday } from '../lib/queries';
import { dayProgress, nextStop } from '../lib/agenda';
import { directionsLink, telLink } from '../lib/util';
import type { Dashboard, Today, TodayRunsheet } from '../types';

export default function TodayPage() {
  const { t } = useI18n();
  const today = useToday();
  const dash = useDashboard();
  const online = useOnline();
  const data = today.data;

  if (!data && today.isError) return <ErrorState error={today.error} onRetry={() => today.refetch()} />;
  if (!data) return <TodaySkeleton />;

  const next = nextStop(data);
  const startable = data.runsheets.find((r) => r.canStart);
  const hasWork = data.runsheets.some((r) => r.stops.length) || data.pickups.length > 0 || data.returns.length > 0;
  const activePickups = data.pickups.filter((p) => p.status === 'ASSIGNED' || p.status === 'IN_PROGRESS');
  const otherPickups = data.pickups.filter((p) => !activePickups.includes(p));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-ink-900 dark:text-white">{t('hero.today.title')}</h1>
          <p className="text-xs text-ink-500">
            {!online ? t('hero.today.cached', { ago: ago(new Date(today.dataUpdatedAt)) }) : t('hero.today.updated', { ago: ago(new Date(today.dataUpdatedAt)) })}
          </p>
        </div>
        <RefreshButton
          spinning={today.isFetching}
          onClick={() => {
            void today.refetch();
            void dash.refetch();
          }}
        />
      </div>

      {!hasWork ? (
        <NoTasks dash={dash.data} />
      ) : (
        <>
          <SummaryCard data={data} />
          {startable && <StartRunsheetCard rs={startable} />}
          {next && !startable && <NextStopCard orderId={next.orderId} seq={next.seq} />}
          {!next && !startable && data.summary.stops > 0 && <AllDoneCard data={data} />}

          {activePickups.length > 0 && (
            <>
              <SectionTitle count={activePickups.length}>{t('hero.today.pickups')}</SectionTitle>
              <div className="space-y-2">{activePickups.map((p) => <PickupRow key={p.id} pickup={p} />)}</div>
            </>
          )}

          {data.runsheets.map((rs) => (
            <section key={rs.id}>
              <SectionTitle
                count={rs.stops.length}
                action={
                  <Link to="/hero/map" className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-bold text-turtle-700 hover:bg-turtle-50 dark:text-turtle-400 dark:hover:bg-turtle-950">
                    <Route className="h-4 w-4" /> {t('hero.today.viewMap')}
                  </Link>
                }
              >
                {t('hero.today.route')} <span className="ltr font-mono text-[11px] normal-case">{rs.code}</span>
              </SectionTitle>
              <div className="space-y-2">
                {[...rs.stops].sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999)).map((s) => <StopRow key={s.orderId} stop={s} highlight={s.orderId === next?.orderId} />)}
              </div>
            </section>
          ))}

          {data.returns.length > 0 && (
            <>
              <SectionTitle count={data.returns.length}>{t('hero.today.returns')}</SectionTitle>
              <p className="-mt-1 mb-2 px-1 text-xs text-ink-500">{t('hero.today.returnsHint')}</p>
              <div className="space-y-2">{data.returns.map((r) => <ReturnRow key={r.orderId} parcel={r} />)}</div>
            </>
          )}

          {otherPickups.length > 0 && (
            <>
              <SectionTitle count={otherPickups.length}>{t('hero.today.pickupsDone')}</SectionTitle>
              <div className="space-y-2">{otherPickups.map((p) => <PickupRow key={p.id} pickup={p} />)}</div>
            </>
          )}

          {startable ? (
            <StartRunsheetBar rs={startable} />
          ) : next ? (
            <StickyBar>
              <Link
                to={`/hero/stops/${next.orderId}`}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-turtle-600 text-lg font-bold text-white shadow-pop active:bg-turtle-700"
              >
                <ArrowUpRight className="h-5 w-5 rtl:-scale-x-100" /> {t('hero.today.goNext', { n: next.seq ?? '' })}
              </Link>
            </StickyBar>
          ) : activePickups[0] ? (
            <StickyBar>
              <Link to={`/hero/pickups/${activePickups[0].id}`} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 text-lg font-bold text-white shadow-pop">
                <Store className="h-5 w-5" /> {t('hero.today.goPickup')}
              </Link>
            </StickyBar>
          ) : null}
        </>
      )}
    </div>
  );
}

function SummaryCard({ data }: { data: Today }) {
  const { t } = useI18n();
  const { done, total } = dayProgress(data);
  const s = data.summary;
  return (
    <Panel className="flex items-center gap-4">
      <ProgressRing value={total ? done / total : 0} size={104} stroke={11}>
        <div>
          <p className="font-display text-2xl font-extrabold leading-none text-ink-900 dark:text-white">
            <span className="ltr tabular">{done}/{total}</span>
          </p>
          <p className="mt-1 text-[11px] font-semibold text-ink-500">{t('hero.today.done')}</p>
        </div>
      </ProgressRing>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-xs font-semibold text-ink-500">{t('hero.today.codToCollect')}</p>
          <Money cents={s.codToCollectCents} className="font-display text-2xl font-extrabold text-sand-700 dark:text-sand-300" />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-ink-100 pt-2 dark:border-ink-800">
          <div>
            <p className="text-[11px] font-semibold text-ink-500">{t('hero.today.collected')}</p>
            <Money cents={s.collectedTodayCents} className="text-sm font-bold text-ink-900 dark:text-ink-100" />
          </div>
          <div className="flex gap-1.5">
            <Badge tone="success">✓ {num(s.deliveredToday)}</Badge>
            {s.failed > 0 && <Badge tone="danger">✕ {num(s.failed)}</Badge>}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function NextStopCard({ orderId, seq }: { orderId: string; seq: number | null }) {
  const { t, pick } = useI18n();
  const stop = useStop(orderId);
  const s = stop.data;
  if (!s) return <Skeleton className="mt-4 h-56 rounded-3xl" />;
  const nav = s.mapsUrl ?? s.approximateMapsUrl ?? directionsLink(s.address.lat, s.address.lng, s.address.line);
  return (
    <div className="mt-4 overflow-hidden relative rounded-3xl bg-gradient-to-br from-ink-900 to-ink-950 text-white shadow-pop ring-1 ring-lime-300/25">
      <Link to={`/hero/stops/${s.id}`} className="block p-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-lime-300 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-turtle-950">{t('hero.today.nextStop')}</span>
          {s.eta && (
            <span className="flex items-center gap-1 text-xs font-semibold text-white/85">
              <Clock className="h-3.5 w-3.5" /> {t('hero.eta')} <span className="ltr">{timeOnly(s.eta)}</span>
            </span>
          )}
        </div>
        <div className="mt-3 flex items-start gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-lime-300 font-display text-2xl font-extrabold text-turtle-900">{seq ?? '·'}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-xl font-bold">{s.recipient.name}</p>
            <p className="line-clamp-2 text-sm text-white/85">{s.address.line}</p>
            {s.address.landmark && <p className="mt-0.5 truncate text-xs text-white/70">📍 {s.address.landmark}</p>}
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold"><MapPin className="h-3 w-3" /> {pick(s.zone, 'name')}</span>
            {s.otpRequired && <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold"><KeyRound className="h-3 w-3" /> {t('hero.stop.otp')}</span>}
          </div>
          <div className="text-end">
            <p className="text-[11px] font-semibold text-white/70">{s.collectCents > 0 ? t('hero.collect') : t('hero.prepaid')}</p>
            {s.collectCents > 0 && <Money cents={s.collectCents} className="font-display text-3xl font-extrabold text-sand-200" />}
          </div>
        </div>
      </Link>
      <div className="grid grid-cols-2 gap-px bg-white/10">
        <a href={telLink(s.recipient.phone)} className="flex h-14 items-center justify-center gap-2 bg-white/[.06] font-bold active:bg-white/10">
          <Phone className="h-5 w-5" /> {t('action.call')}
        </a>
        <a href={nav} target="_blank" rel="noopener noreferrer" className={cn('flex h-14 items-center justify-center gap-2 bg-turtle-600 font-bold active:bg-turtle-700', !nav && 'pointer-events-none opacity-50')}>
          <Navigation className="h-5 w-5" /> {t('action.navigate')}
        </a>
      </div>
    </div>
  );
}

function StartRunsheetCard({ rs }: { rs: TodayRunsheet }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-3xl bg-gradient-to-br from-turtle-600 to-turtle-800 p-4 text-white shadow-pop">
      <p className="flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4" /> {t('hero.today.runsheetReady')}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{t('hero.today.stopsCount', { n: rs.stops.length })}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-white/85">
        <span className="ltr rounded-full bg-white/15 px-2 py-0.5">{rs.code}</span>
        {rs.totalDistanceKm != null && <span className="rounded-full bg-white/15 px-2 py-0.5">{t('hero.km', { n: num(Math.round(rs.totalDistanceKm * 10) / 10) })}</span>}
        {rs.totalMinutes != null && <span className="rounded-full bg-white/15 px-2 py-0.5">≈ {t('hero.dur.m', { m: num(rs.totalMinutes) })}</span>}
        <span className="rounded-full bg-white/15 px-2 py-0.5">{t('hero.cod')}: <Money cents={rs.expectedCodCents} /></span>
      </div>
      <p className="mt-3 text-sm text-white/85">{t('hero.today.startHint')}</p>
    </div>
  );
}

function StartRunsheetBar({ rs }: { rs: TodayRunsheet }) {
  const { t } = useI18n();
  const invalidate = useInvalidateHero();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const start = useHeroMutation(() => api(`/hero/tasks/runsheets/${rs.id}/start`, { method: 'POST' }), {
    onSuccess: async () => {
      toast.success(t('hero.today.started'));
      invalidate();
      const fresh = await qc.fetchQuery({ queryKey: ['hero', 'today'], queryFn: () => api<Today>('/hero/tasks/today') });
      const n = nextStop(fresh);
      if (n) navigate(`/hero/stops/${n.orderId}`);
    },
  });
  return (
    <StickyBar>
      <Button size="xl" block loading={start.isPending} icon={<Play className="h-5 w-5" />} onClick={() => start.mutate(undefined)} className="shadow-pop">
        {t('hero.today.start')}
      </Button>
    </StickyBar>
  );
}

function AllDoneCard({ data }: { data: Today }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-3xl bg-turtle-50 p-5 text-center ring-1 ring-turtle-200 dark:bg-turtle-950 dark:ring-turtle-900">
      <p className="text-4xl">🎉</p>
      <p className="mt-2 font-display text-xl font-bold text-turtle-800 dark:text-turtle-200">{t('hero.today.allDone')}</p>
      <p className="mt-1 text-sm text-turtle-800/80 dark:text-turtle-200/80">
        {data.returns.length > 0 ? t('hero.today.allDoneReturns', { n: data.returns.length }) : t('hero.today.allDoneHint')}
      </p>
      <Link to="/hero/wallet" className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-sand-400 px-4 text-sm font-bold text-ink-950">
        {t('hero.today.handCash')}
      </Link>
    </div>
  );
}

function NoTasks({ dash }: { dash: Dashboard | undefined }) {
  const { t, pick } = useI18n();
  const invalidate = useInvalidateHero();
  const [asked, setAsked] = useState(false);
  const availability = dash?.hero.availability;
  const offline = availability === 'OFFLINE' || availability === 'ON_BREAK';
  const goOnline = useHeroMutation(() => api('/hero/me/availability', { method: 'PATCH', body: { availability: 'ONLINE' } }), {
    onSuccess: () => {
      setAsked(true);
      toast.success(t('hero.availability.done.ONLINE'));
      invalidate();
    },
  });
  return (
    <div className="mt-6 flex flex-col items-center rounded-3xl bg-white px-6 py-10 text-center shadow-card dark:bg-ink-900">
      <ArchTile className="h-20 w-20 rounded-[30%] shadow-lg shadow-turtle-600/25" />
      <p className="mt-4 font-display text-xl font-bold text-ink-900 dark:text-white">{t('hero.today.emptyTitle')}</p>
      <p className="mt-1 max-w-xs text-sm text-ink-500">{offline ? t('hero.today.emptyOffline') : t('hero.today.emptyOnline')}</p>
      {offline && !asked && (
        <Button size="xl" className="mt-6 w-full max-w-xs" loading={goOnline.isPending} icon={<Zap className="h-5 w-5" />} onClick={() => goOnline.mutate(undefined)}>
          {t('hero.availability.set.ONLINE')}
        </Button>
      )}
      {dash && (
        <div className="mt-6 grid w-full max-w-xs grid-cols-2 gap-2 text-start">
          <Link to="/hero/achievements" className="rounded-2xl bg-ink-50 p-3 dark:bg-ink-800">
            <p className="text-2xl">{dash.gamification.level?.emoji ?? '🐢'}</p>
            <p className="mt-1 text-xs font-semibold text-ink-500">{t('hero.me.level')}</p>
            <p className="truncate text-sm font-bold text-ink-900 dark:text-white">{dash.gamification.level ? pick(dash.gamification.level) : '—'}</p>
          </Link>
          <Link to="/hero/earnings" className="rounded-2xl bg-ink-50 p-3 dark:bg-ink-800">
            <p className="text-2xl">💰</p>
            <p className="mt-1 text-xs font-semibold text-ink-500">{t('hero.earnings.payable')}</p>
            <Money cents={dash.payableCents} className="text-sm font-bold text-ink-900 dark:text-white" />
          </Link>
        </div>
      )}
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-56 rounded-3xl" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
    </div>
  );
}
