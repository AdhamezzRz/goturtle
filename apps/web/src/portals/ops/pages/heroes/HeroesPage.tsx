import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bike, CalendarClock, Plus, Search, Star, Users, Wifi } from 'lucide-react';
import { CourierAvailability, CourierStatus, EmploymentType, levelForXp } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, cairoToday, money, num } from '@/lib/format';
import { useDebounced, usePollInterval, useQueryState } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Avatar, Badge, Button, DataTable, EmptyState, Input, PageHeader, Pagination, Select, StateBadge, type Column } from '@/components/ui';
import { AvailabilityDot, CashBar, Code, FilterBar, FilterField, RequirePermission, Stat, StatGrid, enumOptions, useEnumLabel, useHubName, useHubs, useZones } from '@/portals/ops/components/opsb';
import { OnboardHeroWizard } from './OnboardHeroWizard';
import type { HeroRow } from './types';
import './i18n';

const typeTone: Record<string, 'info' | 'progress' | 'success'> = { FREELANCE: 'info', SHIFT: 'progress', FULL_TIME: 'success' };

export function EmploymentBadge({ value }: { value: string }) {
  const en = useEnumLabel();
  return <Badge tone={typeTone[value] ?? 'neutral'}>{en('EmploymentType', value)}</Badge>;
}

export function LevelChip({ xp }: { xp: number }) {
  const { t, pick } = useI18n();
  const l = levelForXp(xp);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <span aria-hidden>{l.emoji}</span>
      <span className="font-semibold text-ink-800 dark:text-ink-100">{pick(l)}</span>
      <span className="ltr text-ink-400">{t('ops.heroes.xp', { n: num(xp) })}</span>
    </span>
  );
}

export function RatingStars({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm">
      <Star className="h-3.5 w-3.5 fill-sand-400 text-sand-400" aria-hidden />
      <span className="ltr font-semibold tabular">{rating ? rating.toFixed(1) : '—'}</span>
      {count !== undefined && <span className="ltr text-xs text-ink-400">({num(count)})</span>}
    </span>
  );
}

const total = (path: string, query: Record<string, string>) => api<{ meta: { total: number } }>(path, { query: { ...query, pageSize: 1 } }).then((r) => r.meta.total);

export default function HeroesPage() {
  return (
    <RequirePermission permission="couriers.read">
      <HeroesInner />
    </RequirePermission>
  );
}

function HeroesInner() {
  const { t, pick } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const nav = useNavigate();
  const poll = usePollInterval(30_000);
  const [f, setF] = useQueryState({ q: '', status: '', availability: '', employmentType: '', hubId: '', zoneId: '', sort: 'code', page: '1', onboard: '' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q, 350);
  useEffect(() => {
    if (dq !== f.q) setF({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const hubs = useHubs();
  const hubName = useHubName();
  const zones = useZones();

  const list = useQuery({
    queryKey: ['heroes', 'list', f],
    queryFn: () =>
      api<Paginated<HeroRow>>('/couriers', {
        query: { q: f.q, status: f.status, availability: f.availability, employmentType: f.employmentType, hubId: f.hubId, zoneId: f.zoneId, sort: f.sort, order: f.sort === 'code' || f.sort === 'name' ? 'asc' : 'desc', page: f.page, pageSize: 20 },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: poll,
  });

  const kpi = useQuery({
    queryKey: ['heroes', 'kpis'],
    refetchInterval: poll,
    queryFn: async () => {
      const today = cairoToday();
      const [active, online, onShift, cash] = await Promise.all([
        total('/couriers', { status: 'ACTIVE' }),
        total('/couriers', { availability: 'ONLINE' }),
        can('shifts.read') ? api<{ total: number }>('/shifts', { query: { from: today, to: today, status: 'IN_PROGRESS' } }).then((r) => r.total) : Promise.resolve(null),
        can('cash.read') ? api<{ totals: { overLimit: number; custodyCents: number } }>('/cash/custody', { query: { pageSize: 1 } }).then((r) => r.totals) : Promise.resolve(null),
      ]);
      return { active, online, onShift, cash };
    },
  });

  const activeFilters = [f.status, f.availability, f.employmentType, f.hubId, f.zoneId].filter(Boolean).length;

  const columns: Column<HeroRow>[] = [
    {
      key: 'hero',
      header: t('ops.heroes.col.hero'),
      cell: (r) => (
        <div className="flex min-w-[200px] items-center gap-3">
          <div className="relative">
            <Avatar name={r.name} src={r.avatarUrl} size={38} />
            <span className="absolute -bottom-0.5 -end-0.5 rounded-full bg-white p-0.5 dark:bg-ink-900"><AvailabilityDot value={r.availability} /></span>
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink-900 dark:text-ink-50">{r.name}</p>
            <p className="flex items-center gap-2 text-xs text-ink-500"><Code>{r.code}</Code><span className="ltr">{r.phone}</span></p>
          </div>
        </div>
      ),
    },
    { key: 'status', header: t('common.status'), cell: (r) => <StateBadge value={r.status} /> },
    {
      key: 'type', header: t('ops.heroes.col.type'), hideBelow: 'lg',
      cell: (r) => <div className="space-y-1"><EmploymentBadge value={r.employmentType} /><p className="whitespace-nowrap text-xs text-ink-500">{en('VehicleType', r.vehicleType)}</p></div>,
    },
    { key: 'rating', header: t('ops.heroes.col.rating'), cell: (r) => <RatingStars rating={r.rating} count={r.ratingCount} /> },
    { key: 'level', header: t('ops.heroes.col.level'), cell: (r) => <LevelChip xp={r.xp} />, hideBelow: 'xl' },
    { key: 'cash', header: t('ops.heroes.col.cash'), cell: (r) => <CashBar onHandCents={r.cashOnHandCents} limitCents={r.cashLimitCents} compact /> },
    { key: 'hub', header: t('common.hub'), cell: (r) => <div className="whitespace-nowrap text-sm">{hubName(r.homeHubId, r.hub?.name)}<p className="text-xs text-ink-400">{ago(r.lastSeenAt)}</p></div>, hideBelow: 'xl' },
    { key: 'active', header: t('ops.heroes.col.active'), align: 'center', cell: (r) => <span className="ltr font-semibold tabular">{num(r.activeOrders)}</span>, hideBelow: 'md' },
  ];

  const statusOptions = Object.values(CourierStatus).map((s) => ({ value: s, label: t(`state.${s}`) }));
  const filters = (
    <>
      <FilterField label={t('ops.heroes.f.status')}>
        <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('ops.opsb.allStatuses')} options={statusOptions} aria-label={t('ops.heroes.f.status')} />
      </FilterField>
      <FilterField label={t('ops.heroes.f.availability')}>
        <Select value={f.availability} onChange={(e) => setF({ availability: e.target.value })} placeholder={t('ops.heroes.f.anyAvailability')} options={Object.values(CourierAvailability).map((a) => ({ value: a, label: t(`state.${a}`) }))} aria-label={t('ops.heroes.f.availability')} />
      </FilterField>
      <FilterField label={t('ops.heroes.f.type')}>
        <Select value={f.employmentType} onChange={(e) => setF({ employmentType: e.target.value })} placeholder={t('ops.opsb.allTypes')} options={enumOptions('EmploymentType', Object.values(EmploymentType))} aria-label={t('ops.heroes.f.type')} />
      </FilterField>
      <FilterField label={t('common.hub')}>
        <Select value={f.hubId} onChange={(e) => setF({ hubId: e.target.value })} placeholder={t('ops.opsb.allHubs')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} aria-label={t('common.hub')} />
      </FilterField>
      <FilterField label={t('common.zone')}>
        <Select value={f.zoneId} onChange={(e) => setF({ zoneId: e.target.value })} placeholder={t('ops.opsb.allZones')} options={(zones.data ?? []).map((z) => ({ value: z.id, label: pick(z, 'name') }))} aria-label={t('common.zone')} />
      </FilterField>
      <FilterField label={t('ops.heroes.f.sort')}>
        <Select value={f.sort} onChange={(e) => setF({ sort: e.target.value })} options={['code', 'name', 'xp', 'rating', 'cashOnHand', 'lastSeenAt', 'joinedAt'].map((s) => ({ value: s, label: t(`ops.heroes.sort.${s}`) }))} aria-label={t('ops.heroes.f.sort')} />
      </FilterField>
    </>
  );

  return (
    <div>
      <PageHeader
        title={t('ops.heroes.title')}
        subtitle={t('ops.heroes.subtitle')}
        actions={can('couriers.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setF({ onboard: '1' })}>{t('ops.heroes.onboard')}</Button>}
      />

      <StatGrid className="mb-5">
        <Stat icon={<Users />} label={t('ops.heroes.kpi.active')} value={num(kpi.data?.active)} loading={kpi.isLoading} onClick={() => setF({ status: f.status === 'ACTIVE' ? '' : 'ACTIVE' })} active={f.status === 'ACTIVE'} />
        <Stat icon={<Wifi />} tone="sky" label={t('ops.heroes.kpi.online')} value={num(kpi.data?.online)} loading={kpi.isLoading} onClick={() => setF({ availability: f.availability === 'ONLINE' ? '' : 'ONLINE' })} active={f.availability === 'ONLINE'} />
        <Stat icon={<CalendarClock />} tone="violet" label={t('ops.heroes.kpi.onShift')} value={kpi.data?.onShift === null ? '—' : num(kpi.data?.onShift)} loading={kpi.isLoading} onClick={can('shifts.read') ? () => nav('/ops/shifts') : undefined} />
        <Stat
          icon={<AlertTriangle />}
          tone="red"
          label={t('ops.heroes.kpi.overLimit')}
          value={kpi.data?.cash ? num(kpi.data.cash.overLimit) : '—'}
          hint={kpi.data?.cash ? <span className="ltr">{t('ops.heroes.kpi.custody', { amount: money(kpi.data.cash.custodyCents, { compact: true }) })}</span> : undefined}
          loading={kpi.isLoading}
          onClick={can('cash.read') ? () => nav('/ops/cash') : undefined}
        />
      </StatGrid>

      <FilterBar
        search={<Input leading={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ops.heroes.search')} aria-label={t('action.search')} type="search" />}
        activeCount={activeFilters}
        onClear={() => setF({ status: '', availability: '', employmentType: '', hubId: '', zoneId: '' })}
      >
        {filters}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(r) => nav(`/ops/heroes/${r.id}`)}
        empty={
          <EmptyState
            icon={<Bike className="h-7 w-7" />}
            title={t('ops.heroes.empty')}
            description={activeFilters || f.q ? undefined : t('ops.heroes.emptyHint')}
            action={can('couriers.manage') && !activeFilters && !f.q ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setF({ onboard: '1' })}>{t('ops.heroes.onboard')}</Button> : undefined}
          />
        }
        mobileCard={(r) => (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="relative">
                <Avatar name={r.name} src={r.avatarUrl} size={42} />
                <span className="absolute -bottom-0.5 -end-0.5 rounded-full bg-white p-0.5 dark:bg-ink-900"><AvailabilityDot value={r.availability} /></span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-semibold text-ink-900 dark:text-ink-50">{r.name}</p>
                  <StateBadge value={r.status} />
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500"><Code>{r.code}</Code><span>{en('VehicleType', r.vehicleType)}</span><span>· {hubName(r.homeHubId, r.hub?.name)}</span></p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2"><EmploymentBadge value={r.employmentType} /><RatingStars rating={r.rating} /><LevelChip xp={r.xp} /></div>
              </div>
            </div>
            <CashBar onHandCents={r.cashOnHandCents} limitCents={r.cashLimitCents} />
            <p className="text-xs text-ink-400">{t('ops.heroes.col.lastSeen')}: {ago(r.lastSeenAt)} · {t('ops.heroes.orders', { n: num(r.activeOrders) })}</p>
          </div>
        )}
        footer={list.data && list.data.meta.total > 0 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />

      {can('couriers.manage') && <OnboardHeroWizard open={f.onboard === '1'} onClose={() => setF({ onboard: '' })} />}
    </div>
  );
}
