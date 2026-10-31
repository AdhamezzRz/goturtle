import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Clock, Coins, LogIn, LogOut, Pencil, Plus, Power, Timer, Users, Wand2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ShiftStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cairoToday, dateOnly, dateTime, num, pct, timeOnly } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePollInterval, useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Field, Input, Modal, PageHeader, ProgressBar, Select, Skeleton, StateBadge, Switch, Tabs, type Column } from '@/components/ui';
import {
  AttendanceFlags, InfoRow, Money, ReasonDialog, RequirePermission, SHIFT_COLORS, SHIFT_DOT, Section, Stat, StatGrid, addDaysStr, cairoHm, cairoToIso, minutesLabel, useHubName, useHubs, weekStart,
  type ShiftList, type ShiftRow,
} from '@/portals/ops/components/opsb';
import { GenerateModal, NewShiftModal, TemplateModal, useTemplates, useWeekdays } from './ShiftModals';
import type { Coverage, ShiftTemplate } from './types';
import './i18n';

export default function ShiftsPage() {
  return (
    <RequirePermission permission="shifts.read">
      <ShiftsInner />
    </RequirePermission>
  );
}

function ShiftsInner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [s, setS] = useQueryState({ tab: 'calendar', week: weekStart(cairoToday()), hubId: '', status: '', courierId: '' });
  const [gen, setGen] = useState<{ templateId?: string } | null>(null);
  const [create, setCreate] = useState<string | null>(null);
  const manage = can('shifts.manage');
  return (
    <div>
      <PageHeader
        title={t('ops.shifts.title')}
        subtitle={t('ops.shifts.subtitle')}
        actions={manage && (
          <>
            <Button variant="outline" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setCreate(cairoToday())}>{t('ops.shifts.new')}</Button>
            <Button icon={<Wand2 className="h-4 w-4" />} onClick={() => setGen({})}>{t('ops.shifts.generate')}</Button>
          </>
        )}
      />
      <Tabs
        className="mb-5"
        value={s.tab}
        onChange={(v) => setS({ tab: v })}
        tabs={[{ value: 'calendar', label: t('ops.shifts.tab.calendar') }, { value: 'templates', label: t('ops.shifts.tab.templates') }, { value: 'coverage', label: t('ops.shifts.tab.coverage') }]}
      />
      {s.tab === 'calendar' && <WeekCalendar week={s.week} hubId={s.hubId} status={s.status} courierId={s.courierId} onChange={setS} onCreate={manage ? (d) => setCreate(d) : undefined} />}
      {s.tab === 'templates' && <Templates onGenerate={(id) => setGen({ templateId: id })} />}
      {s.tab === 'coverage' && <CoverageView week={s.week} hubId={s.hubId} onChange={setS} />}
      <GenerateModal open={!!gen} onClose={() => setGen(null)} templateId={gen?.templateId} from={s.week} />
      <NewShiftModal open={!!create} onClose={() => setCreate(null)} date={create ?? undefined} />
    </div>
  );
}

/* ───────────────────────────── Week navigation ───────────────────────────── */

function WeekNav({ week, onWeek }: { week: string; onWeek: (w: string) => void }) {
  const { t, dir } = useI18n();
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const thisWeek = weekStart(cairoToday());
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="sm" icon={<Prev className="h-4 w-4" />} aria-label={t('ops.shifts.prevWeek')} onClick={() => onWeek(addDaysStr(week, -7))} />
      <span className="min-w-0 px-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{dateOnly(`${week}T12:00:00Z`)} – {dateOnly(`${addDaysStr(week, 6)}T12:00:00Z`)}</span>
      <Button variant="outline" size="sm" icon={<Next className="h-4 w-4" />} aria-label={t('ops.shifts.nextWeek')} onClick={() => onWeek(addDaysStr(week, 7))} />
      {week !== thisWeek && <Button variant="ghost" size="sm" onClick={() => onWeek(thisWeek)}>{t('ops.shifts.thisWeek')}</Button>}
    </div>
  );
}

/* ───────────────────────────── Calendar ───────────────────────────── */

type Patch = Partial<{ tab: string; week: string; hubId: string; status: string; courierId: string }>;

function WeekCalendar({ week, hubId, status, courierId, onChange, onCreate }: { week: string; hubId: string; status: string; courierId: string; onChange: (p: Patch) => void; onCreate?: (day: string) => void }) {
  const { t } = useI18n();
  const hubs = useHubs();
  const hubName = useHubName();
  const poll = usePollInterval(60_000);
  const [open, setOpen] = useState<ShiftRow | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(week, i)), [week]);
  const today = cairoToday();
  const q = useQuery({
    queryKey: ['shifts', 'week', week, hubId, status, courierId],
    queryFn: () => api<ShiftList>('/shifts', { query: { from: week, to: addDaysStr(week, 6), hubId, status, courierId } }),
    refetchInterval: poll,
  });
  const rows = useMemo(() => {
    const by = new Map<string, { hero: ShiftRow['courier']; shifts: ShiftRow[] }>();
    for (const sh of q.data?.data ?? []) {
      const r = by.get(sh.courierId) ?? { hero: sh.courier, shifts: [] };
      r.shifts.push(sh);
      by.set(sh.courierId, r);
    }
    return [...by.values()].sort((a, b) => a.hero.code.localeCompare(b.hero.code));
  }, [q.data]);
  const sum = q.data?.summary;
  const weekday = (d: string) => t(`ops.opsb.enum.Weekday.${new Date(`${d}T12:00:00Z`).getUTCDay()}`);
  const dayNum = (d: string) => new Intl.NumberFormat(undefined).format(Number(d.slice(8)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WeekNav week={week} onWeek={(w) => onChange({ week: w })} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={hubId} onChange={(e) => onChange({ hubId: e.target.value })} placeholder={t('ops.opsb.allHubs')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} aria-label={t('common.hub')} className="!w-40" />
          <Select value={status} onChange={(e) => onChange({ status: e.target.value })} placeholder={t('ops.opsb.allStatuses')} options={Object.values(ShiftStatus).map((v) => ({ value: v, label: t(`state.${v}`) }))} aria-label={t('common.status')} className="!w-40" />
          {courierId && <Button size="sm" variant="ghost" icon={<XCircle className="h-4 w-4" />} onClick={() => onChange({ courierId: '' })}>{rows[0]?.hero.name ?? t('ops.shifts.hero')}</Button>}
        </div>
      </div>

      <StatGrid>
        <Stat icon={<CalendarClock />} label={t('ops.shifts.sum.shifts')} value={num(q.data?.total)} hint={sum?.byStatus.MISSED ? t('ops.shifts.sum.missed', { n: num(sum.byStatus.MISSED) }) : undefined} loading={q.isLoading} />
        <Stat icon={<Clock />} tone="sky" label={t('ops.shifts.sum.scheduled')} value={<span className="ltr">{minutesLabel(sum?.scheduledMinutes)}</span>} loading={q.isLoading} />
        <Stat icon={<Timer />} tone="violet" label={t('ops.shifts.sum.worked')} value={<span className="ltr">{minutesLabel(sum?.workedMinutes)}</span>} loading={q.isLoading} />
        <Stat icon={<Coins />} tone="sand" label={t('ops.shifts.sum.earned')} value={<Money cents={sum?.earnedCents} compact />} loading={q.isLoading} />
      </StatGrid>

      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500" aria-label={t('ops.shifts.legend')}>
        {['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'CANCELLED'].map((st) => (
          <span key={st} className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-full', SHIFT_DOT[st])} />{t(`state.${st}`)}</span>
        ))}
      </div>

      {q.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : q.error ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<CalendarClock className="h-7 w-7" />} title={t('ops.shifts.empty')} description={t('ops.shifts.emptyHint')} /></Card>
      ) : (
        <>
          {/* Desktop/tablet grid: heroes × days */}
          <div className="hidden overflow-x-auto rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900 md:block">
            <div className="grid min-w-[720px]" style={{ gridTemplateColumns: 'minmax(130px,1.2fr) repeat(7, minmax(78px,1fr))' }}>
              <div className="sticky start-0 z-10 border-b border-ink-100 bg-ink-50 px-3 py-2 text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-950">{t('ops.shifts.hero')}</div>
              {days.map((d) => (
                <div key={d} className={cn('border-b border-s border-ink-100 px-2 py-2 text-center dark:border-ink-800', d === today ? 'bg-turtle-50 dark:bg-turtle-950/40' : 'bg-ink-50 dark:bg-ink-950')}>
                  <p className="text-xs font-semibold text-ink-500">{weekday(d)}</p>
                  <p className={cn('font-display text-lg font-bold', d === today ? 'text-turtle-700 dark:text-turtle-300' : 'text-ink-800 dark:text-ink-100')}>{dayNum(d)}</p>
                  {onCreate && d >= today && (
                    <button type="button" onClick={() => onCreate(d)} aria-label={`${t('ops.shifts.new')} · ${d}`} className="mx-auto mt-0.5 grid h-5 w-5 place-items-center rounded-full text-ink-400 hover:bg-turtle-100 hover:text-turtle-700"><Plus className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
              {rows.map((r) => (
                <div key={r.hero.id} className="contents">
                  <div className="sticky start-0 z-10 border-b border-ink-100 bg-white px-3 py-2 dark:border-ink-800 dark:bg-ink-900">
                    <Link to={`/ops/heroes/${r.hero.id}?tab=shifts`} className="block truncate text-sm font-semibold text-ink-900 hover:underline dark:text-ink-50">{r.hero.name}</Link>
                    <p className="ltr text-xs text-ink-400">{r.hero.code}</p>
                  </div>
                  {days.map((d) => {
                    const list = r.shifts.filter((x) => x.day === d);
                    return (
                      <div key={d} className={cn('space-y-1 border-b border-s border-ink-100 p-1 dark:border-ink-800', d === today && 'bg-turtle-50/40 dark:bg-turtle-950/20')}>
                        {list.map((sh) => (
                          <button
                            key={sh.id}
                            type="button"
                            onClick={() => setOpen(sh)}
                            className={cn('block w-full rounded-lg border px-1.5 py-1 text-start text-[11px] leading-tight transition hover:shadow-sm focus-visible:ring-2 focus-visible:ring-turtle-500', SHIFT_COLORS[sh.status])}
                          >
                            <span className="ltr block font-semibold tabular">{cairoHm(sh.startAt)}–{cairoHm(sh.endAt)}</span>
                            <span className="flex items-center justify-between gap-1">
                              <span className="truncate opacity-80">{sh.template?.name ?? t(`state.${sh.status}`)}</span>
                              <AttendanceFlags s={sh} compact />
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Phone agenda */}
          <div className="space-y-4 md:hidden">
            {days.map((d) => {
              const list = (q.data?.data ?? []).filter((x) => x.day === d).sort((a, b) => a.startAt.localeCompare(b.startAt));
              if (!list.length) return null;
              return (
                <section key={d}>
                  <h3 className={cn('mb-2 flex items-center gap-2 text-sm font-semibold', d === today ? 'text-turtle-700 dark:text-turtle-300' : 'text-ink-700 dark:text-ink-200')}>
                    {weekday(d)} · {dateOnly(`${d}T12:00:00Z`)}
                    <Badge tone="neutral">{num(list.length)}</Badge>
                  </h3>
                  <ul className="space-y-2">
                    {list.map((sh) => (
                      <li key={sh.id}>
                        <button type="button" onClick={() => setOpen(sh)} className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-start', SHIFT_COLORS[sh.status])}>
                          <span className="ltr shrink-0 text-sm font-bold tabular">{cairoHm(sh.startAt)}<br /><span className="font-normal opacity-70">{cairoHm(sh.endAt)}</span></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{sh.courier.name}</span>
                            <span className="block truncate text-xs opacity-80">{sh.template?.name ?? '—'} · {hubName(sh.hubId, sh.hub?.name)}</span>
                            <AttendanceFlags s={sh} className="mt-1" />
                          </span>
                          <StateBadge value={sh.status} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
      <ShiftDrawer shift={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/* ───────────────────────────── Shift drawer ───────────────────────────── */

const EDITABLE = new Set(['SCHEDULED', 'CONFIRMED']);

function ShiftDrawer({ shift, onClose }: { shift: ShiftRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const hubName = useHubName();
  const [cancel, setCancel] = useState(false);
  const [clock, setClock] = useState<'in' | 'out' | null>(null);
  const detail = useQuery({ queryKey: ['shifts', 'detail', shift?.id], queryFn: () => api<ShiftRow>(`/shifts/${shift!.id}`), enabled: !!shift, initialData: shift ?? undefined });
  const s = detail.data ?? shift;
  const cancelM = useMutation({
    mutationFn: (reason: string) => api(`/shifts/${s!.id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success(t('ops.shifts.d.cancelled')); setCancel(false); qc.invalidateQueries({ queryKey: ['shifts'] }); onClose(); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!s) return null;
  const manage = can('shifts.manage');
  const loc = (lat: number | null, lng: number | null) => (lat !== null && lng !== null ? <a className="ltr text-turtle-700 hover:underline dark:text-turtle-400" href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noreferrer">{lat.toFixed(4)}, {lng.toFixed(4)}</a> : '—');
  const notes = (s.notes ?? '').split('\n').filter(Boolean);
  return (
    <>
      <Drawer
        open={!!shift}
        onClose={onClose}
        title={t('ops.shifts.d.title')}
        width="max-w-md"
        footer={manage && (
          <div className="flex w-full flex-wrap justify-end gap-2">
            {EDITABLE.has(s.status) && <Button variant="ghost" icon={<XCircle className="h-4 w-4 text-red-500" />} onClick={() => setCancel(true)}>{t('ops.shifts.d.cancel')}</Button>}
            {(EDITABLE.has(s.status) || s.status === 'MISSED') && !s.clockInAt && <Button icon={<LogIn className="h-4 w-4" />} onClick={() => setClock('in')}>{t('ops.shifts.d.clockInNow')}</Button>}
            {s.status === 'IN_PROGRESS' && <Button icon={<LogOut className="h-4 w-4" />} onClick={() => setClock('out')}>{t('ops.shifts.d.clockOutNow')}</Button>}
          </div>
        )}
      >
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link to={`/ops/heroes/${s.courierId}?tab=shifts`} className="text-lg font-semibold text-ink-900 hover:underline dark:text-white">{s.courier.name}</Link>
              <p className="ltr text-sm text-ink-500">{s.courier.code}</p>
            </div>
            <StateBadge value={s.status} />
          </div>
          <AttendanceFlags s={s} />
          <div>
            <InfoRow label={t('common.date')} value={dateOnly(s.startAt)} />
            <InfoRow label={t('ops.shifts.d.scheduled')} value={<span className="ltr">{timeOnly(s.startAt)} – {timeOnly(s.endAt)}</span>} />
            <InfoRow label={t('ops.shifts.g.template')} value={s.template?.name ?? '—'} />
            <InfoRow label={t('common.hub')} value={hubName(s.hubId, s.hub?.name)} />
            <InfoRow label={t('ops.shifts.d.break')} value={t('ops.opsb.minutes', { n: num(s.breakMinutes) })} />
          </div>
          <Section title={t('ops.shifts.d.attendance')} className="!p-4">
            <InfoRow label={t('ops.shifts.d.clockIn')} value={s.clockInAt ? dateTime(s.clockInAt) : t('ops.shifts.d.notRecorded')} />
            <InfoRow label={t('ops.shifts.d.location')} value={loc(s.clockInLat, s.clockInLng)} />
            <InfoRow label={t('ops.shifts.d.clockOut')} value={s.clockOutAt ? dateTime(s.clockOutAt) : t('ops.shifts.d.notRecorded')} />
            <InfoRow label={t('ops.shifts.d.location')} value={loc(s.clockOutLat, s.clockOutLng)} />
            <InfoRow label={t('ops.shifts.d.worked')} value={<span className="ltr">{minutesLabel(s.workedMinutes)} / {minutesLabel(s.scheduledMinutes)}</span>} />
          </Section>
          <Section title={t('ops.shifts.d.pay')} className="!p-4">
            <InfoRow label={t('ops.shifts.d.rate')} value={<Money cents={s.hourlyRateCents} />} />
            <InfoRow label={t('ops.shifts.d.expected')} value={<Money cents={s.expectedEarningsCents} />} />
            <InfoRow label={t('ops.shifts.d.earned')} value={<Money cents={s.earnedCents} className="font-semibold" />} strong />
            {s.payoutId && <Badge tone="success" className="mt-2">{t('ops.shifts.d.inPayout')}</Badge>}
          </Section>
          {notes.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-ink-400">{t('common.notes')}</p>
              <ul className="space-y-1 text-sm text-ink-600 dark:text-ink-300">{notes.map((n, i) => <li key={i} className="rounded-lg bg-ink-50 px-3 py-1.5 dark:bg-ink-800/50">{n}</li>)}</ul>
            </div>
          )}
        </div>
      </Drawer>
      <ReasonDialog open={cancel} onClose={() => setCancel(false)} title={t('ops.shifts.d.cancelTitle')} description={`${s.courier.name} · ${dateTime(s.startAt)}`} danger loading={cancelM.isPending} confirmLabel={t('ops.shifts.d.cancel')} onConfirm={(r) => cancelM.mutate(r)} />
      <ClockModal shift={clock ? s : null} kind={clock} onClose={() => setClock(null)} />
    </>
  );
}

function ClockModal({ shift, kind, onClose }: { shift: ShiftRow | null; kind: 'in' | 'out' | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [day, setDay] = useState(cairoToday());
  const [time, setTime] = useState(cairoHm(new Date()));
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/shifts/${shift!.id}/clock-${kind}`, { method: 'POST', body: { at: cairoToIso(day, time), note: note.trim() || undefined } }),
    onSuccess: () => { toast.success(t('ops.shifts.d.clocked')); qc.invalidateQueries({ queryKey: ['shifts'] }); onClose(); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal
      open={!!shift}
      onClose={onClose}
      title={kind === 'in' ? t('ops.shifts.d.clockInNow') : t('ops.shifts.d.clockOutNow')}
      description={shift ? `${shift.courier.name} · ${timeOnly(shift.startAt)} – ${timeOnly(shift.endAt)}` : undefined}
      size="sm"
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => m.mutate()}>{t('action.confirm')}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.date')}>{(id) => <Input id={id} type="date" value={day} max={cairoToday()} onChange={(e) => setDay(e.target.value)} />}</Field>
          <Field label={t('ops.shifts.d.clockAt')}>{(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
        <Field label={t('ops.shifts.d.clockNote')}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />}</Field>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Templates ───────────────────────────── */

function Templates({ onGenerate }: { onGenerate: (templateId: string) => void }) {
  const { t, pick } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const days = useWeekdays();
  const hubName = useHubName();
  const [inactive, setInactive] = useState(false);
  const [edit, setEdit] = useState<ShiftTemplate | 'new' | null>(null);
  const [deact, setDeact] = useState<ShiftTemplate | null>(null);
  const q = useTemplates(inactive);
  const manage = can('shifts.manage');
  const toggle = useMutation({
    mutationFn: (tpl: ShiftTemplate) => (tpl.isActive ? api(`/shifts/templates/${tpl.id}`, { method: 'DELETE' }) : api(`/shifts/templates/${tpl.id}`, { method: 'PATCH', body: { isActive: true } })),
    onSuccess: () => { toast.success(t('ops.shifts.t.saved')); setDeact(null); qc.invalidateQueries({ queryKey: ['shifts'] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch checked={inactive} onChange={setInactive} label={t('ops.shifts.t.showInactive')} />
        {manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('ops.shifts.t.new')}</Button>}
      </div>
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : q.error ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : !q.data?.length ? (
        <Card><EmptyState icon={<CalendarClock className="h-7 w-7" />} title={t('ops.shifts.t.empty')} action={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('ops.shifts.t.new')}</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((tpl) => (
            <Card key={tpl.id} className={cn('flex flex-col', !tpl.isActive && 'opacity-60')}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink-900 dark:text-white">{tpl.name}</h3>
                  <p className="ltr text-start font-display text-xl font-bold text-ink-800 dark:text-ink-100">{tpl.startTime} – {tpl.endTime}{tpl.overnight && <span className="ms-1 text-xs text-ink-400">+1</span>}</p>
                </div>
                <Badge tone={tpl.isActive ? 'success' : 'neutral'} dot>{tpl.isActive ? t('ops.shifts.t.active') : t('ops.shifts.t.inactive')}</Badge>
              </div>
              <div className="mb-3 flex flex-wrap gap-1" aria-label={t('ops.shifts.t.days')}>
                {days.map((d) => (
                  <span key={d.value} className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', tpl.daysOfWeek.includes(d.value) ? 'bg-turtle-100 text-turtle-800 dark:bg-turtle-900/60 dark:text-turtle-200' : 'bg-ink-100 text-ink-400 line-through dark:bg-ink-800')}>{d.label}</span>
                ))}
              </div>
              <div className="flex-1 text-sm">
                <InfoRow label={t('common.hub')} value={tpl.hubId ? hubName(tpl.hubId, tpl.hub?.name) : t('ops.shifts.t.anyHub')} />
                <InfoRow label={t('common.zone')} value={tpl.zone ? pick(tpl.zone, 'name') : t('ops.shifts.t.anyZone')} />
                <InfoRow label={t('ops.shifts.t.required')} value={<span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{num(tpl.requiredCouriers)}</span>} />
                <InfoRow label={t('ops.shifts.t.break')} value={t('ops.opsb.minutes', { n: num(tpl.breakMinutes) })} />
                <InfoRow label={t('ops.shifts.t.hourly')} value={tpl.hourlyRateCents === null ? <span className="text-ink-400">{t('ops.shifts.t.hourlyHint')}</span> : <Money cents={tpl.hourlyRateCents} />} />
                <p className="mt-1 text-xs text-ink-400">{t('ops.shifts.t.paid', { h: minutesLabel(tpl.paidMinutes) })}</p>
              </div>
              {manage && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
                  {tpl.isActive && <Button size="sm" icon={<Wand2 className="h-4 w-4" />} onClick={() => onGenerate(tpl.id)}>{t('ops.shifts.t.useTemplate')}</Button>}
                  <Button size="sm" variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(tpl)}>{t('action.edit')}</Button>
                  <Button size="sm" variant="ghost" icon={<Power className="h-4 w-4" />} loading={toggle.isPending && toggle.variables?.id === tpl.id} onClick={() => (tpl.isActive ? setDeact(tpl) : toggle.mutate(tpl))}>{tpl.isActive ? t('ops.shifts.t.deactivate') : t('ops.shifts.t.activate')}</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <TemplateModal open={!!edit} onClose={() => setEdit(null)} template={edit === 'new' ? null : edit} />
      <ConfirmDialog open={!!deact} onClose={() => setDeact(null)} title={deact ? t('ops.shifts.t.deactivateTitle', { name: deact.name }) : ''} description={t('ops.shifts.t.deactivateDesc')} danger loading={toggle.isPending} onConfirm={() => deact && toggle.mutate(deact)} />
    </div>
  );
}

/* ───────────────────────────── Coverage ───────────────────────────── */

function CoverageView({ week, hubId, onChange }: { week: string; hubId: string; onChange: (p: Patch) => void }) {
  const { t } = useI18n();
  const hubs = useHubs();
  const hubName = useHubName();
  const [onlyGaps, setOnlyGaps] = useState(false);
  const q = useQuery({ queryKey: ['shifts', 'coverage', week, hubId], queryFn: () => api<Coverage>('/shifts/coverage', { query: { from: week, to: addDaysStr(week, 6), hubId } }) });
  const lines = (q.data?.lines ?? []).filter((l) => !onlyGaps || l.gap > 0).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const tot = q.data?.totals;
  const weekday = (d: string) => t(`ops.opsb.enum.Weekday.${new Date(`${d}T12:00:00Z`).getUTCDay()}`);
  const columns: Column<(typeof lines)[number]>[] = [
    { key: 'date', header: t('common.date'), cell: (l) => <span className="whitespace-nowrap font-medium">{weekday(l.date)} · {dateOnly(`${l.date}T12:00:00Z`)}</span> },
    { key: 'slot', header: t('ops.shifts.c.slot'), cell: (l) => <span><span className="font-medium">{l.templateName}</span> <span className="ltr text-xs text-ink-400">{l.startTime}–{l.endTime}</span></span> },
    { key: 'hub', header: t('common.hub'), cell: (l) => hubName(l.hubId), hideBelow: 'lg' },
    { key: 'req', header: t('ops.shifts.c.required'), align: 'center', cell: (l) => <span className="ltr tabular">{num(l.required)}</span> },
    { key: 'sch', header: t('ops.shifts.c.scheduled'), align: 'center', cell: (l) => <span className="ltr tabular">{num(l.scheduled)}</span> },
    { key: 'bar', header: t('ops.shifts.c.coverage'), cell: (l) => <div className="w-28"><ProgressBar value={l.required ? l.scheduled / l.required : 1} tone={l.gap > 0 ? (l.scheduled === 0 ? 'red' : 'sand') : 'turtle'} /></div>, hideBelow: 'md' },
    { key: 'gap', header: t('ops.shifts.c.gap'), align: 'end', cell: (l) => (l.gap > 0 ? <Badge tone={l.scheduled === 0 ? 'danger' : 'warning'}><span className="ltr">−{num(l.gap)}</span></Badge> : <Badge tone="success">{t('ops.shifts.c.full')}</Badge>) },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WeekNav week={week} onWeek={(w) => onChange({ week: w })} />
        <div className="flex flex-wrap items-center gap-3">
          <Select value={hubId} onChange={(e) => onChange({ hubId: e.target.value })} placeholder={t('ops.opsb.allHubs')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} aria-label={t('common.hub')} className="!w-40" />
          <Switch checked={onlyGaps} onChange={setOnlyGaps} label={t('ops.shifts.c.onlyGaps')} />
        </div>
      </div>
      <StatGrid>
        <Stat icon={<Users />} label={t('ops.shifts.c.required')} value={num(tot?.required)} loading={q.isLoading} />
        <Stat icon={<CalendarClock />} tone="sky" label={t('ops.shifts.c.scheduled')} value={num(tot?.scheduled)} loading={q.isLoading} />
        <Stat icon={<XCircle />} tone="red" label={t('ops.shifts.c.gap')} value={num(tot?.gap)} loading={q.isLoading} />
        <Stat icon={<Timer />} tone="violet" label={t('ops.shifts.c.coverage')} value={pct((tot?.coveragePct ?? 0) / 100)} loading={q.isLoading} />
      </StatGrid>
      <DataTable
        columns={columns}
        rows={lines}
        rowKey={(l) => `${l.templateId}-${l.date}`}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={t('ops.shifts.c.empty')}
        dense
        mobileCard={(l) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{weekday(l.date)} · {l.templateName}</span>{columns[6].cell(l)}</div>
            <div className="flex items-center gap-3 text-xs text-ink-500"><span className="ltr">{l.startTime}–{l.endTime}</span><span>{hubName(l.hubId)}</span><span className="ltr ms-auto font-semibold">{num(l.scheduled)} / {num(l.required)}</span></div>
            <ProgressBar value={l.required ? l.scheduled / l.required : 1} tone={l.gap > 0 ? (l.scheduled === 0 ? 'red' : 'sand') : 'turtle'} />
          </div>
        )}
      />
    </div>
  );
}
