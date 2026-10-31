import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cairoToday, dateOnly, num, parseEgp } from '@/lib/format';
import { cn } from '@/lib/cn';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Checkbox, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import {
  ChipGroup, CourierSelect, InfoRow, MoneyInput, Notice, addDaysStr, apiFieldErrors, cairoToIso, centsToInput, minutesLabel, useCourierOptions, useForm, useHubs, useZones, weekdayOfStr, type Errors,
} from '@/portals/ops/components/opsb';
import type { GenerateResult, ShiftTemplate } from './types';

export const useTemplates = (includeInactive = false) =>
  useQuery({ queryKey: ['shifts', 'templates', includeInactive], queryFn: () => api<ShiftTemplate[]>('/shifts/templates', { query: { includeInactive: includeInactive ? 'true' : undefined } }) });

const hmToMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

export function lengthOf(start: string, end: string) {
  if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end)) return 0;
  const d = hmToMin(end) - hmToMin(start);
  return d <= 0 ? d + 1440 : d;
}

export function useWeekdays() {
  const { t } = useI18n();
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: t(`ops.opsb.enum.Weekday.${d}`) }));
}

/* ───────────────────────────── Template form ───────────────────────────── */

export function TemplateModal({ open, onClose, template }: { open: boolean; onClose: () => void; template?: ShiftTemplate | null }) {
  const { t, pick } = useI18n();
  const qc = useQueryClient();
  const hubs = useHubs();
  const zones = useZones();
  const days = useWeekdays();
  const blank = { name: '', startTime: '09:00', endTime: '17:00', daysOfWeek: [0, 1, 2, 3, 4, 6] as number[], hubId: '', zoneId: '', requiredCouriers: '2', hourly: '', breakMinutes: '30', isActive: true };
  const { values: f, set, errors, setErrors, reset } = useForm(blank);
  useEffect(() => {
    if (!open) return;
    reset(template ? {
      name: template.name, startTime: template.startTime, endTime: template.endTime, daysOfWeek: template.daysOfWeek, hubId: template.hubId ?? '', zoneId: template.zoneId ?? '',
      requiredCouriers: String(template.requiredCouriers), hourly: template.hourlyRateCents === null ? '' : centsToInput(template.hourlyRateCents), breakMinutes: String(template.breakMinutes), isActive: template.isActive,
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);
  const len = lengthOf(f.startTime, f.endTime);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(), startTime: f.startTime, endTime: f.endTime, daysOfWeek: [...f.daysOfWeek].sort(), hubId: f.hubId || undefined, zoneId: f.zoneId || undefined,
        requiredCouriers: Number(f.requiredCouriers), hourlyRateCents: f.hourly === '' ? null : parseEgp(f.hourly), breakMinutes: Number(f.breakMinutes), isActive: f.isActive,
      };
      return template ? api(`/shifts/templates/${template.id}`, { method: 'PATCH', body }) : api('/shifts/templates', { method: 'POST', body });
    },
    onSuccess: () => { toast.success(t('ops.shifts.t.saved')); qc.invalidateQueries({ queryKey: ['shifts'] }); onClose(); },
    onError: (err) => {
      setErrors(apiFieldErrors(err, ['name', 'startTime', 'endTime', 'daysOfWeek', 'hubId', 'zoneId', 'requiredCouriers', 'hourlyRateCents', 'breakMinutes'], { INVALID_HUB: 'hubId', INVALID_ZONE: 'zoneId', INVALID_BREAK: 'breakMinutes', SHIFT_TOO_LONG: 'endTime' }));
      toast.error(errorMessage(err));
    },
  });
  const submit = () => {
    const e: Errors = {};
    if (f.name.trim().length < 2) e.name = t('ops.opsb.minChars', { n: 2 });
    if (!f.daysOfWeek.length) e.daysOfWeek = t('ops.shifts.t.daysRequired');
    const req = Number(f.requiredCouriers);
    if (!Number.isInteger(req) || req < 1 || req > 500) e.requiredCouriers = '1 – 500';
    const br = Number(f.breakMinutes);
    if (!Number.isInteger(br) || br < 0 || br > 240) e.breakMinutes = '0 – 240';
    else if (br >= len) e.breakMinutes = t('error.INVALID_BREAK');
    if (f.hourly !== '' && parseEgp(f.hourly) === null) e.hourly = t('ops.opsb.invalidAmount');
    setErrors(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template ? t('ops.shifts.t.edit') : t('ops.shifts.t.new')}
      size="lg"
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={submit}>{t('action.save')}</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ops.shifts.t.name')} required error={errors.name} className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} maxLength={120} />}</Field>
        <Field label={t('ops.shifts.t.start')} required error={errors.startTime}>{(id) => <Input id={id} type="time" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} />}</Field>
        <Field label={t('ops.shifts.t.end')} required error={errors.endTime} hint={len ? `${t('ops.shifts.m.length', { len: minutesLabel(len) })}${hmToMin(f.endTime) <= hmToMin(f.startTime) ? ` · ${t('ops.shifts.t.overnight')}` : ''}` : undefined}>
          {(id) => <Input id={id} type="time" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('ops.shifts.t.days')} <span className="text-red-500">*</span></p>
          <ChipGroup ariaLabel={t('ops.shifts.t.days')} options={days} value={f.daysOfWeek} onChange={(v) => set('daysOfWeek', v)} />
          {errors.daysOfWeek && <p className="mt-1 text-xs font-medium text-red-600">{errors.daysOfWeek}</p>}
        </div>
        <Field label={t('common.hub')} error={errors.hubId}>{(id) => <Select id={id} value={f.hubId} onChange={(e) => set('hubId', e.target.value)} placeholder={t('ops.shifts.t.anyHub')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} />}</Field>
        <Field label={t('common.zone')} error={errors.zoneId}>{(id) => <Select id={id} value={f.zoneId} onChange={(e) => set('zoneId', e.target.value)} placeholder={t('ops.shifts.t.anyZone')} options={(zones.data ?? []).map((z) => ({ value: z.id, label: pick(z, 'name') }))} />}</Field>
        <Field label={t('ops.shifts.t.required')} error={errors.requiredCouriers}>{(id) => <Input id={id} dir="ltr" inputMode="numeric" value={f.requiredCouriers} onChange={(e) => set('requiredCouriers', e.target.value.replace(/\D/g, ''))} invalid={!!errors.requiredCouriers} />}</Field>
        <Field label={t('ops.shifts.t.break')} error={errors.breakMinutes}>{(id) => <Input id={id} dir="ltr" inputMode="numeric" value={f.breakMinutes} onChange={(e) => set('breakMinutes', e.target.value.replace(/\D/g, ''))} invalid={!!errors.breakMinutes} />}</Field>
        <Field label={t('ops.shifts.t.hourly')} hint={t('ops.shifts.t.hourlyHint')} error={errors.hourly ?? errors.hourlyRateCents}>{(id) => <MoneyInput id={id} value={f.hourly} onChange={(v) => set('hourly', v)} invalid={!!errors.hourly} placeholder="—" />}</Field>
        <div className="flex items-end pb-2"><Checkbox label={t('ops.shifts.t.active')} checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /></div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Generate ───────────────────────────── */

export function GenerateModal({ open, onClose, templateId, from: fromDefault }: { open: boolean; onClose: () => void; templateId?: string; from?: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const templates = useTemplates();
  const heroes = useCourierOptions(open);
  const [tpl, setTpl] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyShift, setOnlyShift] = useState(true);
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState<Errors>({});
  const [result, setResult] = useState<GenerateResult | null>(null);
  useEffect(() => {
    if (!open) return;
    const start = fromDefault && fromDefault > cairoToday() ? fromDefault : cairoToday();
    setTpl(templateId ?? '');
    setFrom(start);
    setTo(addDaysStr(start, 6));
    setSel([]);
    setErr({});
    setResult(null);
  }, [open, templateId, fromDefault]);
  const template = templates.data?.find((x) => x.id === tpl);
  const list = useMemo(() => (heroes.data ?? []).filter((h) => h.status === 'ACTIVE' && (!onlyShift || h.employmentType === 'SHIFT')), [heroes.data, onlyShift]);
  const matchingDays = useMemo(() => {
    if (!template || !from || !to || to < from) return 0;
    let n = 0;
    for (let d = from; d <= to && n < 400; d = addDaysStr(d, 1)) if (template.daysOfWeek.includes(weekdayOfStr(d))) n++;
    return n;
  }, [template, from, to]);
  const name = (id: string) => heroes.data?.find((h) => h.id === id);
  const m = useMutation({
    mutationFn: () => api<GenerateResult>('/shifts/generate', { method: 'POST', body: { templateId: tpl, from, to, courierIds: sel } }),
    onSuccess: (r) => { setResult(r); toast.success(t('ops.shifts.g.done', { n: num(r.created) })); qc.invalidateQueries({ queryKey: ['shifts'] }); },
    onError: (e) => { setErr(apiFieldErrors(e, ['templateId', 'from', 'to', 'courierIds'], { TEMPLATE_INACTIVE: 'templateId', RANGE_TOO_LARGE: 'to', INVALID_RANGE: 'to' })); toast.error(errorMessage(e)); },
  });
  const submit = () => {
    const e: Errors = {};
    if (!tpl) e.templateId = t('ops.opsb.required');
    if (!from || !to || to < from) e.to = t('ops.shifts.g.rangeInvalid');
    if (!sel.length) e.courierIds = t('ops.shifts.g.heroesRequired');
    setErr(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };

  if (result) {
    return (
      <Modal open={open} onClose={onClose} title={t('ops.shifts.g.title')} footer={<Button onClick={onClose}>{t('action.close')}</Button>}>
        <div className="space-y-4">
          <Notice tone="success">{t('ops.shifts.g.done', { n: num(result.created) })}</Notice>
          {result.skipped.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">{t('ops.shifts.g.skipped', { n: num(result.skipped.length) })}</p>
              <ul className="max-h-64 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-100 text-sm dark:divide-ink-800 dark:border-ink-800">
                {result.skipped.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>{name(s.courierId)?.name ?? s.courierId} · {dateOnly(`${s.date}T12:00:00Z`)}</span>
                    <Badge tone="warning">{t(`ops.shifts.g.reason.${s.reason}`)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ops.shifts.g.title')}
      size="lg"
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={submit}>{t('ops.shifts.g.submit')}</Button></>}
    >
      <div className="space-y-4">
        <Field label={t('ops.shifts.g.template')} required error={err.templateId}>
          {(id) => <Select id={id} value={tpl} onChange={(e) => setTpl(e.target.value)} placeholder={t('ops.opsb.select')} options={(templates.data ?? []).map((x) => ({ value: x.id, label: `${x.name} · ${x.startTime}–${x.endTime}${x.hub ? ` · ${x.hub.name}` : ''}` }))} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ops.shifts.g.from')} required>{(id) => <Input id={id} type="date" min={cairoToday()} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label={t('ops.shifts.g.to')} required error={err.to}>{(id) => <Input id={id} type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{t('ops.shifts.g.heroes')} <span className="text-red-500">*</span> <span className="text-xs font-normal text-ink-400">· {t('ops.shifts.g.selected', { n: num(sel.length) })}</span></p>
            <div className="flex items-center gap-3">
              <Checkbox label={t('ops.shifts.g.onlyShift')} checked={onlyShift} onChange={(e) => setOnlyShift(e.target.checked)} />
              <Button size="xs" variant="ghost" onClick={() => setSel(sel.length === list.length ? [] : list.map((h) => h.id))}>{t('ops.shifts.g.selectAll')}</Button>
            </div>
          </div>
          <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-ink-100 p-2 dark:border-ink-800 sm:grid-cols-2">
            {list.map((h) => (
              <li key={h.id}>
                <label className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50 dark:hover:bg-ink-800', sel.includes(h.id) && 'bg-turtle-50 dark:bg-turtle-950/40')}>
                  <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-turtle-600" checked={sel.includes(h.id)} onChange={() => setSel(sel.includes(h.id) ? sel.filter((x) => x !== h.id) : [...sel, h.id])} />
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                  <span className="ltr text-xs text-ink-400">{h.code}</span>
                </label>
              </li>
            ))}
          </ul>
          {err.courierIds ? <p className="mt-1 text-xs font-medium text-red-600">{err.courierIds}</p> : <p className="mt-1 text-xs text-ink-500">{t('ops.shifts.g.heroesHint')}</p>}
        </div>
        {template && sel.length > 0 && matchingDays > 0 && <Notice tone="info">{t('ops.shifts.g.preview', { n: num(matchingDays * sel.length), days: num(matchingDays), heroes: num(sel.length) })}</Notice>}
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Manual shift ───────────────────────────── */

export function NewShiftModal({ open, onClose, date }: { open: boolean; onClose: () => void; date?: string }) {
  const { t, pick } = useI18n();
  const qc = useQueryClient();
  const hubs = useHubs();
  const zones = useZones();
  const heroes = useCourierOptions(open);
  const blank = { courierId: '', date: date ?? cairoToday(), start: '09:00', end: '17:00', hubId: '', zoneId: '', breakMinutes: '30', hourly: '', notes: '' };
  const { values: f, set, errors, setErrors, reset } = useForm(blank);
  useEffect(() => {
    if (open) reset({ ...blank, date: date && date >= cairoToday() ? date : cairoToday() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date]);
  const len = lengthOf(f.start, f.end);
  const hero = heroes.data?.find((h) => h.id === f.courierId);
  useEffect(() => {
    if (hero?.homeHubId && !f.hubId) set('hubId', hero.homeHubId);
  }, [hero, f.hubId, set]);
  const m = useMutation({
    mutationFn: () => {
      const startAt = cairoToIso(f.date, f.start);
      const endAt = cairoToIso(hmToMin(f.end) <= hmToMin(f.start) ? addDaysStr(f.date, 1) : f.date, f.end);
      return api('/shifts', {
        method: 'POST',
        body: { courierId: f.courierId, startAt, endAt, hubId: f.hubId || undefined, zoneId: f.zoneId || undefined, breakMinutes: Number(f.breakMinutes), hourlyRateCents: f.hourly ? parseEgp(f.hourly) ?? undefined : undefined, notes: f.notes.trim() || undefined },
      });
    },
    onSuccess: () => { toast.success(t('ops.shifts.m.created')); qc.invalidateQueries({ queryKey: ['shifts'] }); onClose(); },
    onError: (err) => {
      setErrors(apiFieldErrors(err, ['courierId', 'startAt', 'endAt', 'hubId', 'zoneId', 'breakMinutes'], { SHIFT_OVERLAP: 'courierId', COURIER_NOT_ACTIVE: 'courierId', INVALID_COURIER: 'courierId', SHIFT_TOO_LONG: 'end', INVALID_SHIFT_TIMES: 'end', INVALID_BREAK: 'breakMinutes', INVALID_HUB: 'hubId' }));
      toast.error(errorMessage(err));
    },
  });
  const submit = () => {
    const e: Errors = {};
    if (!f.courierId) e.courierId = t('ops.opsb.required');
    if (!f.date) e.date = t('ops.opsb.required');
    const br = Number(f.breakMinutes);
    if (!Number.isInteger(br) || br < 0 || br > 240) e.breakMinutes = '0 – 240';
    else if (br >= len) e.breakMinutes = t('error.INVALID_BREAK');
    if (f.hourly && parseEgp(f.hourly) === null) e.hourly = t('ops.opsb.invalidAmount');
    setErrors(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title={t('ops.shifts.m.title')} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={submit}>{t('action.create')}</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ops.shifts.hero')} required error={errors.courierId} className="sm:col-span-2">{(id) => <CourierSelect id={id} value={f.courierId} onChange={(v) => set('courierId', v)} invalid={!!errors.courierId} filter={(c) => c.status === 'ACTIVE'} />}</Field>
        <Field label={t('ops.shifts.m.date')} required error={errors.date}>{(id) => <Input id={id} type="date" min={cairoToday()} value={f.date} onChange={(e) => set('date', e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('ops.shifts.t.start')}>{(id) => <Input id={id} type="time" value={f.start} onChange={(e) => set('start', e.target.value)} />}</Field>
          <Field label={t('ops.shifts.t.end')} error={errors.end}>{(id) => <Input id={id} type="time" value={f.end} onChange={(e) => set('end', e.target.value)} />}</Field>
        </div>
        <Field label={t('common.hub')} error={errors.hubId}>{(id) => <Select id={id} value={f.hubId} onChange={(e) => set('hubId', e.target.value)} placeholder={t('ops.shifts.t.anyHub')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: h.name }))} />}</Field>
        <Field label={t('common.zone')}>{(id) => <Select id={id} value={f.zoneId} onChange={(e) => set('zoneId', e.target.value)} placeholder={t('ops.shifts.t.anyZone')} options={(zones.data ?? []).map((z) => ({ value: z.id, label: pick(z, 'name') }))} />}</Field>
        <Field label={t('ops.shifts.t.break')} error={errors.breakMinutes}>{(id) => <Input id={id} dir="ltr" inputMode="numeric" value={f.breakMinutes} onChange={(e) => set('breakMinutes', e.target.value.replace(/\D/g, ''))} invalid={!!errors.breakMinutes} />}</Field>
        <Field label={t('ops.shifts.t.hourly')} hint={t('ops.shifts.t.hourlyHint')} error={errors.hourly}>{(id) => <MoneyInput id={id} value={f.hourly} onChange={(v) => set('hourly', v)} placeholder="—" />}</Field>
        <Field label={t('common.notes')} className="sm:col-span-2">{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />}</Field>
        {len > 0 && <div className="sm:col-span-2"><InfoRow label={t('ops.shifts.m.len')} value={<span className="ltr">{minutesLabel(len)}{hmToMin(f.end) <= hmToMin(f.start) ? ' (+1)' : ''}</span>} /></div>}
      </div>
    </Modal>
  );
}
