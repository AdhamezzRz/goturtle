import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Gauge, Settings2, TrendingDown, TrendingUp, Users, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/lib/hooks';
import { cairoToday, dateOnly, num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, KpiCard, Modal, PageHeader, Select, Skeleton, type Column } from '@/components/ui';
import { RequirePermission, useHubs } from '@/portals/ops/components/opsb';
import { Segmented } from '@/portals/ops/components/opsa/ui';
import { ForecastChart } from '@/features/intake/forecast/ForecastChart';
import { EventsEditor, eventErrors } from '@/features/intake/forecast/EventsEditor';
import type { DemandForecast, ForecastAccuracy, ForecastEvent, StaffingRow } from '@/features/intake/types';
import '@/features/intake/i18n';

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const weekStart = (d: string) => addDays(d, -new Date(`${d}T00:00:00Z`).getUTCDay());

/** Demand forecast vs actuals, staffing gaps per hub / shift template, events and backtest accuracy. */
export default function ForecastPage() {
  return (
    <RequirePermission permission="shifts.read">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const today = cairoToday();
  const [s, setS] = useQueryState({ hubId: '', horizon: '14', past: '14', gaps: '' });
  const hubs = useHubs();
  const from = addDays(today, -Number(s.past));
  const to = addDays(today, Number(s.horizon));
  const q = useQuery({
    queryKey: ['forecast', 'demand', s.hubId, from, to],
    queryFn: () => api<DemandForecast>('/forecast/demand', { query: { from, to, hubId: s.hubId } }),
    placeholderData: keepPreviousData,
  });
  const acc = useQuery({ queryKey: ['forecast', 'accuracy', s.hubId], queryFn: () => api<ForecastAccuracy>('/forecast/accuracy', { query: { weeks: 4, hubId: s.hubId } }) });
  const [events, setEvents] = useState(false);
  const d = q.data;
  const next7 = useMemo(() => (d ? d.days.filter((x) => x.date > today && x.date <= addDays(today, 7)).reduce((sum, x) => sum + x.forecast, 0) : 0), [d, today]);
  const staffing = d?.staffing;
  const rows = (staffing?.rows ?? []).filter((r) => !s.gaps || r.gap < 0);

  const columns: Column<StaffingRow>[] = [
    { key: 'date', header: t('common.date'), cell: (r) => <span className="text-sm font-medium">{dateOnly(`${r.date}T12:00:00Z`)}</span> },
    { key: 'hub', header: t('common.hub'), cell: (r) => <span className="text-sm">{r.hubName ?? t('intake.fc.network')}</span> },
    { key: 'tpl', header: t('intake.fc.shift'), cell: (r) => (r.templateId ? <div><p className="text-sm">{r.templateName}</p><p className="ltr text-start text-xs text-ink-500">{r.startTime}–{r.endTime}</p></div> : <Badge tone="warning">{t('intake.fc.noTemplate')}</Badge>) },
    { key: 'orders', header: t('intake.fc.orders'), align: 'end', cell: (r) => <span className="text-sm">{num(r.forecastOrders)}</span> },
    { key: 'rec', header: t('intake.fc.recommended'), align: 'end', cell: (r) => <span className="font-semibold">{num(r.recommended)}</span> },
    { key: 'sch', header: t('intake.fc.scheduled'), align: 'end', cell: (r) => <span>{num(r.scheduled)}</span> },
    { key: 'gap', header: t('intake.fc.gap'), align: 'end', cell: (r) => <GapBadge gap={r.gap} /> },
    {
      key: 'a', header: '', align: 'end', cell: (r) => r.gap < 0 && can('shifts.manage') ? (
        <Link to={`/ops/shifts?week=${weekStart(r.date)}&generate=${r.templateId ?? 'new'}`}><Button size="xs" variant="outline" icon={<Wand2 className="h-3.5 w-3.5" />}>{t('intake.fc.generate')}</Button></Link>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('intake.fc.title')}
        subtitle={t('intake.fc.subtitle')}
        actions={
          <>
            {can('settings.manage') && <Button variant="outline" icon={<CalendarRange className="h-4 w-4" />} onClick={() => setEvents(true)}>{t('intake.fc.events')}</Button>}
            {can('shifts.manage') && <Link to={`/ops/shifts?week=${weekStart(addDays(today, 1))}&generate=new`}><Button icon={<Wand2 className="h-4 w-4" />}>{t('intake.fc.generateShifts')}</Button></Link>}
          </>
        }
      />
      <Card className="mb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select className="sm:w-56" aria-label={t('common.hub')} value={s.hubId} onChange={(e) => setS({ hubId: e.target.value })} placeholder={t('intake.fc.allHubs')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} />
            <Segmented size="sm" value={s.horizon} onChange={(v) => setS({ horizon: v })} options={[{ value: '7', label: t('intake.fc.next', { n: 7 }) }, { value: '14', label: t('intake.fc.next', { n: 14 }) }, { value: '28', label: t('intake.fc.next', { n: 28 }) }]} />
            <Segmented size="sm" value={s.past} onChange={(v) => setS({ past: v })} options={[{ value: '14', label: t('intake.fc.past', { n: 14 }) }, { value: '28', label: t('intake.fc.past', { n: 28 }) }, { value: '56', label: t('intake.fc.past', { n: 56 }) }]} />
          </div>
          {d && <p className="text-xs text-ink-500">{t('intake.fc.model', { weeks: num(d.history.weeksUsed), from: dateOnly(`${d.history.from}T12:00:00Z`) })}</p>}
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('intake.fc.k.next7')} value={d ? num(Math.round(next7)) : '—'} hint={t('intake.fc.k.next7Hint')} icon={<TrendingUp className="h-5 w-5" />} />
        <KpiCard label={t('intake.fc.k.trend')} value={d ? `${d.model.slopePerWeek >= 0 ? '+' : ''}${num(d.model.slopePerWeek)}` : '—'} hint={t('intake.fc.k.trendHint')} icon={d && d.model.slopePerWeek < 0 ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />} tone="sky" />
        <KpiCard label={t('intake.fc.k.accuracy')} value={acc.data?.accuracy == null ? '—' : `${num(acc.data.accuracy)}%`} hint={acc.data?.mape == null ? t('intake.fc.k.noBacktest') : t('intake.fc.k.mape', { mape: num(acc.data.mape), cov: num(acc.data.intervalCoverage ?? 0) })} icon={<Gauge className="h-5 w-5" />} tone="violet" />
        <KpiCard label={t('intake.fc.k.gaps')} value={staffing ? num(staffing.summary.understaffedDays) : '—'} hint={staffing ? t('intake.fc.k.gapsHint', { n: num(Math.max(0, -staffing.summary.gap)) }) : undefined} icon={<Users className="h-5 w-5" />} tone={staffing && staffing.summary.understaffedDays > 0 ? 'red' : 'turtle'} />
      </div>

      <Card className="mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-ink-900 dark:text-white">{t('intake.fc.chartTitle')}</h2>
          {d?.events.length ? <div className="flex flex-wrap gap-1">{d.events.map((e) => <Badge key={`${e.name}${e.from}`} tone="info">{e.name} ×{num(e.multiplier)}</Badge>)}</div> : null}
        </div>
        {q.isLoading ? <Skeleton className="h-80" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && d.history.weeksUsed === 0 && d.totals.actual === 0 ? (
          <EmptyState icon={<TrendingUp className="h-7 w-7" />} title={t('intake.fc.noHistory')} description={t('intake.fc.noHistoryHint')} />
        ) : d ? (
          <ForecastChart days={d.days} today={today} events={d.events} />
        ) : null}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-ink-900 dark:text-white">{t('intake.fc.staffing')}</h2>
              <p className="text-sm text-ink-500">{t('intake.fc.staffingHint', { n: num(staffing?.ordersPerHeroPerShift ?? 25) })}</p>
            </div>
            <Segmented size="sm" value={s.gaps ? 'gaps' : 'all'} onChange={(v) => setS({ gaps: v === 'gaps' ? '1' : '' })} options={[{ value: 'all', label: t('common.all') }, { value: 'gaps', label: t('intake.fc.onlyGaps') }]} />
          </div>
          <DataTable
            columns={columns}
            rows={q.isLoading ? undefined : rows}
            rowKey={(r) => `${r.date}-${r.hubId}-${r.templateId}`}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            dense
            empty={<EmptyState icon={<Users className="h-7 w-7" />} title={s.gaps ? t('intake.fc.noGaps') : t('intake.fc.noStaffing')} description={s.gaps ? undefined : t('intake.fc.noStaffingHint')} />}
            mobileCard={(r) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{dateOnly(`${r.date}T12:00:00Z`)} · {r.hubName ?? t('intake.fc.network')}</p>
                  <p className="text-xs text-ink-500">{r.templateName ?? t('intake.fc.noTemplate')}{r.startTime ? <span className="ltr"> · {r.startTime}–{r.endTime}</span> : null} · {t('intake.fc.ordersN', { n: num(r.forecastOrders) })}</p>
                  <p className="text-xs">{t('intake.fc.recommended')}: <b>{num(r.recommended)}</b> · {t('intake.fc.scheduled')}: <b>{num(r.scheduled)}</b></p>
                </div>
                <div className="flex flex-col items-end gap-1"><GapBadge gap={r.gap} />{columns[7].cell(r)}</div>
              </div>
            )}
          />
        </div>
        <AccuracyCard acc={acc.data} loading={acc.isLoading} />
      </div>
      {events && <EventsModal current={d?.events} onClose={() => setEvents(false)} />}
    </div>
  );
}

function GapBadge({ gap }: { gap: number }) {
  const { t } = useI18n();
  if (gap < 0) return <Badge tone="danger"><AlertTriangle className="h-3 w-3" />{t('intake.fc.short', { n: num(-gap) })}</Badge>;
  if (gap > 0) return <Badge tone="info">+{num(gap)}</Badge>;
  return <Badge tone="success">{t('intake.fc.ok')}</Badge>;
}

function AccuracyCard({ acc, loading }: { acc?: ForecastAccuracy; loading: boolean }) {
  const { t } = useI18n();
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-ink-900 dark:text-white"><Gauge className="h-4 w-4 text-violet-600" />{t('intake.fc.accuracy')}</h2>
      <p className="mb-4 text-sm text-ink-500">{t('intake.fc.accuracyHint')}</p>
      {loading ? <Skeleton className="h-40" /> : !acc || acc.mape === null ? <p className="text-sm text-ink-500">{t('intake.fc.k.noBacktest')}</p> : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-ink-50 p-2 dark:bg-ink-800/60"><dt className="text-[11px] text-ink-500">MAPE</dt><dd className="font-display text-lg font-bold">{num(acc.mape)}%</dd></div>
            <div className="rounded-xl bg-ink-50 p-2 dark:bg-ink-800/60"><dt className="text-[11px] text-ink-500">WAPE</dt><dd className="font-display text-lg font-bold">{acc.wape === null ? '—' : `${num(acc.wape)}%`}</dd></div>
            <div className="rounded-xl bg-ink-50 p-2 dark:bg-ink-800/60"><dt className="text-[11px] text-ink-500">{t('intake.fc.coverage')}</dt><dd className="font-display text-lg font-bold">{acc.intervalCoverage === null ? '—' : `${num(acc.intervalCoverage)}%`}</dd></div>
          </dl>
          <ul className="mt-4 space-y-2">
            {acc.perWeek.map((w) => (
              <li key={w.weekStart} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink-600 dark:text-ink-300">{t('intake.fc.weekOf', { date: dateOnly(`${w.weekStart}T12:00:00Z`) })}</span>
                <span className={cn('font-semibold', w.mape !== null && w.mape > 25 ? 'text-red-600' : 'text-ink-900 dark:text-white')}>{w.mape === null ? '—' : `${num(w.mape)}%`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function EventsModal({ current, onClose }: { current?: ForecastEvent[]; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const setting = useQuery({ queryKey: ['settings', 'platform'], queryFn: () => api<{ value: { forecastEvents: ForecastEvent[] } }>('/settings/platform') });
  const [list, setList] = useState<ForecastEvent[]>(current ?? []);
  useEffect(() => {
    if (setting.data) setList(setting.data.value.forecastEvents);
  }, [setting.data]);
  const problem = eventErrors(list);
  const m = useMutation({
    mutationFn: () => api('/settings/platform', { method: 'PUT', body: { value: { forecastEvents: list.map((e) => ({ ...e, name: e.name.trim() })) } } }),
    onSuccess: () => {
      toast.success(t('intake.fc.eventsSaved'));
      qc.invalidateQueries({ queryKey: ['forecast'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={t('intake.fc.events')}
      description={t('intake.fc.eventsHint')}
      footer={<>
        <Link to="/ops/settings?tab=platform" className="me-auto"><Button variant="ghost" icon={<Settings2 className="h-4 w-4" />}>{t('intake.fc.allSettings')}</Button></Link>
        <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
        <Button loading={m.isPending} disabled={!!problem || setting.isLoading} onClick={() => m.mutate()}>{t('action.save')}</Button>
      </>}
    >
      {setting.isLoading ? <Skeleton className="h-32" /> : <EventsEditor value={list} onChange={setList} />}
      {problem && list.length > 0 && <p className="mt-2 text-xs font-medium text-red-600">{t(`intake.fc.err.${problem}`)}</p>}
    </Modal>
  );
}
