import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, CheckCircle2, Clock, Coins, Flame, MapPin, PackageCheck, Phone, Trophy, UserX, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { haversineKm } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, cairoToday, dateOnly, money, num, pct } from '@/lib/format';
import { usePollInterval, useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Button, Card, ErrorState, Input, ProgressBar, Skeleton, StateBadge, Tabs } from '@/components/ui';
import { AvailabilityDot, CashBar, Code, InfoRow, Money, Notice, ReasonDialog, RecordHandoverModal, RequirePermission, Section, Stat, StatGrid, useEnumLabel } from '@/portals/ops/components/opsb';
import { EmploymentBadge, RatingStars } from './HeroesPage';
import { HeroCashTab, HeroDocumentsTab, HeroPayTab, HeroProfileTab, HeroShiftsTab, HeroZonesTab } from './HeroTabs';
import type { HeroDetail, Leaderboard, TrackResponse } from './types';
import './i18n';

const HeroTrackMap = lazy(() => import('./HeroTrackMap'));

type Action = 'activate' | 'suspend' | 'offboard';

export default function HeroDetailPage() {
  return (
    <RequirePermission permission="couriers.read">
      <HeroDetailInner />
    </RequirePermission>
  );
}

function HeroDetailInner() {
  const { id = '' } = useParams();
  const { t, dir } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const poll = usePollInterval(30_000);
  const [tabState, setTab] = useQueryState({ tab: 'overview' });
  const [action, setAction] = useState<Action | null>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const [cashBlocked, setCashBlocked] = useState(false);

  const q = useQuery({ queryKey: ['heroes', 'detail', id], queryFn: () => api<HeroDetail>(`/couriers/${id}`), refetchInterval: poll });
  const hero = q.data;

  const status = useMutation({
    mutationFn: ({ a, reason }: { a: Action; reason: string }) => api(`/couriers/${id}/${a}`, { method: 'POST', body: reason ? { reason } : {} }),
    onSuccess: () => {
      toast.success(t('ops.heroes.d.statusChanged'));
      setAction(null);
      qc.invalidateQueries({ queryKey: ['heroes'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'CASH_OUTSTANDING') {
        setCashBlocked(true);
        q.refetch();
      }
      toast.error(errorMessage(err));
    },
  });

  if (q.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (q.error || !hero) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const manage = can('couriers.manage');
  const tabs = [
    { value: 'overview', label: t('ops.heroes.d.tab.overview') },
    { value: 'profile', label: t('ops.heroes.d.tab.profile') },
    { value: 'zones', label: t('ops.heroes.d.tab.zones'), count: hero.zones.length },
    { value: 'documents', label: t('ops.heroes.d.tab.documents'), count: hero.documents.pending || undefined },
    ...(can('shifts.read') ? [{ value: 'shifts', label: t('ops.heroes.d.tab.shifts') }] : []),
    ...(can('finance.read') ? [{ value: 'pay', label: t('ops.heroes.d.tab.pay') }] : []),
    ...(can('cash.read') ? [{ value: 'cash', label: t('ops.heroes.d.tab.cash') }] : []),
  ];
  const tab = tabs.some((x) => x.value === tabState.tab) ? tabState.tab : 'overview';
  const holdsCash = hero.cash.onHandCents > 0;

  return (
    <div>
      <Link to="/ops/heroes" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
        <Back className="h-4 w-4" /> {t('ops.heroes.d.back')}
      </Link>

      <Card className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative shrink-0">
              <Avatar name={hero.name} src={hero.avatarUrl} size={64} />
              <span className="absolute bottom-0 end-0 rounded-full bg-white p-1 dark:bg-ink-900"><AvailabilityDot value={hero.availability} /></span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{hero.name}</h1>
                <StateBadge value={hero.status} />
                <EmploymentBadge value={hero.employmentType} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
                <Code>{hero.code}</Code>
                <a href={`tel:${hero.phone}`} className="ltr inline-flex items-center gap-1 hover:text-turtle-700"><Phone className="h-3.5 w-3.5" />{hero.phone}</a>
                <AvailabilityDot value={hero.availability} withLabel />
                <RatingStars rating={hero.rating} count={hero.ratingCount} />
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{hero.homeHub?.name ?? '—'}</span>
                <span>{hero.lastSeenAt ? t('ops.heroes.d.lastSeen', { ago: ago(hero.lastSeenAt) }) : t('ops.heroes.d.never')}</span>
              </div>
            </div>
          </div>
          {manage && hero.status !== 'OFFBOARDED' && (
            <div className="flex flex-wrap gap-2">
              {hero.status !== 'ACTIVE' && <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setAction('activate')}>{hero.status === 'SUSPENDED' ? t('ops.heroes.d.reactivate') : t('ops.heroes.d.activate')}</Button>}
              {hero.status === 'ACTIVE' && <Button variant="outline" icon={<Ban className="h-4 w-4" />} onClick={() => setAction('suspend')}>{t('ops.heroes.d.suspend')}</Button>}
              <Button variant="danger" icon={<UserX className="h-4 w-4" />} onClick={() => { setCashBlocked(false); setAction('offboard'); }}>{t('ops.heroes.d.offboard')}</Button>
            </div>
          )}
        </div>
        {(hero.documents.missingRequired.length > 0 || hero.documents.expiringSoon > 0 || hero.cash.warning === 'OVER_LIMIT') && (
          <div className="mt-4 flex flex-col gap-2">
            {hero.cash.warning === 'OVER_LIMIT' && <Notice tone="danger" icon={<Wallet />}>{t('error.CASH_LIMIT_EXCEEDED')} · <Money cents={hero.cash.onHandCents} className="font-semibold" /></Notice>}
            {hero.documents.missingRequired.length > 0 && <MissingDocs list={hero.documents.missingRequired} onOpen={() => setTab({ tab: 'documents' })} />}
            {hero.documents.expiringSoon > 0 && <Notice tone="warning" icon={<AlertTriangle />}>{t('ops.heroes.d.docsExpiring', { n: num(hero.documents.expiringSoon) })}</Notice>}
          </div>
        )}
      </Card>

      <Tabs value={tab} onChange={(v) => setTab({ tab: v })} tabs={tabs} className="mb-5" />

      {tab === 'overview' && <Overview hero={hero} />}
      {tab === 'profile' && <HeroProfileTab hero={hero} />}
      {tab === 'zones' && <HeroZonesTab hero={hero} />}
      {tab === 'documents' && <HeroDocumentsTab hero={hero} />}
      {tab === 'shifts' && <HeroShiftsTab hero={hero} />}
      {tab === 'pay' && <HeroPayTab hero={hero} />}
      {tab === 'cash' && <HeroCashTab hero={hero} />}

      <ReasonDialog
        open={action === 'activate'}
        onClose={() => setAction(null)}
        title={t('ops.heroes.d.activateTitle', { name: hero.name })}
        description={t('ops.heroes.d.activateDesc')}
        optional
        confirmLabel={t('ops.heroes.d.activate')}
        loading={status.isPending}
        onConfirm={(reason) => status.mutate({ a: 'activate', reason })}
      />
      <ReasonDialog
        open={action === 'suspend'}
        onClose={() => setAction(null)}
        title={t('ops.heroes.d.suspendTitle', { name: hero.name })}
        description={t('ops.heroes.d.suspendDesc')}
        danger
        confirmLabel={t('ops.heroes.d.suspend')}
        loading={status.isPending}
        onConfirm={(reason) => status.mutate({ a: 'suspend', reason })}
      />
      <ReasonDialog
        open={action === 'offboard'}
        onClose={() => setAction(null)}
        title={t('ops.heroes.d.offboardTitle', { name: hero.name })}
        description={t('ops.heroes.d.offboardDesc')}
        danger
        confirmLabel={t('ops.heroes.d.offboard')}
        loading={status.isPending}
        onConfirm={(reason) => status.mutate({ a: 'offboard', reason })}
      >
        {(holdsCash || cashBlocked) && (
          <Notice tone="danger" icon={<Coins />}>
            <p>{t('ops.heroes.d.cashOutstanding', { amount: money(hero.cash.onHandCents) })}</p>
            {can('cash.manage') && <Button size="sm" variant="cash" className="mt-2" onClick={() => setDropOpen(true)}>{t('ops.heroes.d.recordDrop')}</Button>}
          </Notice>
        )}
      </ReasonDialog>
      <RecordHandoverModal
        open={dropOpen}
        onClose={() => setDropOpen(false)}
        courier={{ id: hero.id, name: hero.name, code: hero.code, cashOnHandCents: hero.cash.onHandCents, homeHubId: hero.homeHub?.id }}
        onDone={() => { setCashBlocked(false); q.refetch(); }}
      />
    </div>
  );
}

function MissingDocs({ list, onOpen }: { list: string[]; onOpen: () => void }) {
  const { t } = useI18n();
  const en = useEnumLabel();
  return (
    <Notice tone="warning" icon={<AlertTriangle />}>
      <span>{t('ops.heroes.d.docsMissing', { list: list.map((d) => en('DocumentType', d)).join('، ') })}</span>{' '}
      <button type="button" className="font-semibold underline" onClick={onOpen}>{t('ops.heroes.d.tab.documents')}</button>
    </Notice>
  );
}

function Overview({ hero }: { hero: HeroDetail }) {
  const { t, pick } = useI18n();
  const { can } = useAuth();
  const [win, setWin] = useState<'today' | 'last7d' | 'last30d'>('today');
  const [date, setDate] = useState(cairoToday());
  const k = hero.kpis[win];
  const track = useQuery({ queryKey: ['heroes', 'track', hero.id, date], queryFn: () => api<TrackResponse>(`/couriers/${hero.id}/track`, { query: { date } }), enabled: can('couriers.track') });
  const week = useQuery({ queryKey: ['heroes', 'leaderboard', 'week'], queryFn: () => api<Leaderboard>('/couriers/leaderboard', { query: { period: 'week', limit: 100 } }), staleTime: 60_000 });
  const month = useQuery({ queryKey: ['heroes', 'leaderboard', 'month'], queryFn: () => api<Leaderboard>('/couriers/leaderboard', { query: { period: 'month', limit: 100 } }), staleTime: 60_000 });
  const rankW = week.data?.data.find((r) => r.courierId === hero.id);
  const rankM = month.data?.data.find((r) => r.courierId === hero.id);
  const km = useMemo(() => {
    const p = track.data?.points ?? [];
    let d = 0;
    for (let i = 1; i < p.length; i++) d += haversineKm(p[i - 1], p[i]);
    return d;
  }, [track.data]);
  const lvl = hero.level;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('ops.opsb.period')}>
        {(['today', 'last7d', 'last30d'] as const).map((w) => (
          <Button key={w} size="sm" variant={win === w ? 'secondary' : 'outline'} aria-pressed={win === w} onClick={() => setWin(w)}>{t(`ops.heroes.d.window.${w}`)}</Button>
        ))}
      </div>
      <StatGrid cols={5}>
        <Stat icon={<PackageCheck />} label={t('ops.heroes.d.k.deliveries')} value={num(k.deliveries)} hint={t('ops.heroes.d.k.failed', { n: num(k.failedAttempts) })} />
        <Stat icon={<CheckCircle2 />} tone="sky" label={t('ops.heroes.d.k.success')} value={pct(k.successRate / 100)} />
        <Stat icon={<Clock />} tone="violet" label={t('ops.heroes.d.k.avgTime')} value={k.avgDeliveryMinutes === null ? '—' : t('ops.opsb.minutes', { n: num(k.avgDeliveryMinutes) })} />
        <Stat icon={<Coins />} tone="sand" label={t('ops.heroes.d.k.cod')} value={<Money cents={k.codCollectedCents} compact />} />
        <Stat icon={<Wallet />} tone="turtle" label={t('ops.heroes.d.k.earnings')} value={<Money cents={k.earningsCents} compact />} />
      </StatGrid>

      <div className="grid gap-5 xl:grid-cols-3">
        {can('couriers.track') && (
          <Section
            className="xl:col-span-2"
            title={t('ops.heroes.d.track')}
            subtitle={track.data ? t('ops.heroes.d.trackPoints', { n: num(track.data.points.length), km: num(Math.round(km * 10) / 10) }) : undefined}
            actions={<Input type="date" value={date} max={cairoToday()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={t('common.date')} className="!w-44" />}
          >
            {track.isLoading ? (
              <Skeleton className="h-[340px] w-full" />
            ) : track.error ? (
              <ErrorState error={track.error} onRetry={() => track.refetch()} />
            ) : track.data && track.data.points.length ? (
              <Suspense fallback={<Skeleton className="h-[340px] w-full" />}>
                <HeroTrackMap points={track.data.points} hub={hero.homeHub ? { lat: hero.homeHub.lat, lng: hero.homeHub.lng, name: hero.homeHub.name } : null} />
              </Suspense>
            ) : (
              <div className="grid h-[200px] place-items-center rounded-xl bg-ink-50 text-sm text-ink-500 dark:bg-ink-800/40">{t('ops.heroes.d.noTrack')}</div>
            )}
          </Section>
        )}

        <div className="space-y-5">
          <Section title={t('ops.heroes.d.gamification')}>
            <div className="mb-3 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-sand-50 text-2xl dark:bg-sand-900/30" aria-hidden>{lvl.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-900 dark:text-white">{pick(lvl)} <span className="ltr text-sm font-normal text-ink-400">· L{lvl.level}</span></p>
                <p className="ltr text-xs text-ink-500">{t('ops.heroes.xp', { n: num(hero.xp) })}</p>
              </div>
            </div>
            <ProgressBar value={lvl.progress} tone="sand" />
            <p className="mt-1.5 text-xs text-ink-500">{lvl.next ? t('ops.heroes.d.toNext', { n: num(lvl.next.minXp - hero.xp), level: pick(lvl.next) }) : t('ops.heroes.d.maxLevel')}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-ink-50 p-2 dark:bg-ink-800/50"><Trophy className="mx-auto h-4 w-4 text-sand-500" /><p className="mt-1 font-display text-lg font-bold"><span className="ltr">{rankW ? `#${num(rankW.rank)}` : '—'}</span></p><p className="text-[11px] text-ink-500">{t('ops.heroes.d.rankWeek')}</p></div>
              <div className="rounded-xl bg-ink-50 p-2 dark:bg-ink-800/50"><Trophy className="mx-auto h-4 w-4 text-ink-400" /><p className="mt-1 font-display text-lg font-bold"><span className="ltr">{rankM ? `#${num(rankM.rank)}` : '—'}</span></p><p className="text-[11px] text-ink-500">{t('ops.heroes.d.rankMonth')}</p></div>
              <div className="rounded-xl bg-ink-50 p-2 dark:bg-ink-800/50"><Flame className="mx-auto h-4 w-4 text-red-500" /><p className="mt-1 font-display text-lg font-bold">{num(hero.streakDays)}</p><p className="text-[11px] text-ink-500">{t('ops.heroes.d.streak')}</p></div>
            </div>
          </Section>
          <Section title={t('ops.heroes.d.custody')}>
            <CashBar onHandCents={hero.cash.onHandCents} limitCents={hero.cash.limitCents} />
            <p className="mt-2 text-xs text-ink-500">{t('ops.heroes.d.available', { amount: money(hero.cash.availableCents) })}</p>
            <div className="mt-3 border-t border-ink-100 pt-2 dark:border-ink-800">
              <InfoRow label={t('ops.heroes.d.payable')} value={<Money cents={hero.payableCents} className="font-semibold" />} />
              <InfoRow label={t('ops.heroes.col.active')} value={<span className="ltr">{num(hero.activeOrders)} / {num(hero.maxActiveOrders)}</span>} />
              <InfoRow label={t('ops.opsb.created')} value={dateOnly(hero.joinedAt)} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
