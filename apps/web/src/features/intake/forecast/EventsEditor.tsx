import { CalendarRange, Plus, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button, Input } from '@/components/ui';
import type { ForecastEvent } from '../types';
import '../i18n';

export function eventErrors(events: ForecastEvent[]): string | null {
  for (const e of events) {
    if (!e.name.trim()) return 'name';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.from) || !/^\d{4}-\d{2}-\d{2}$/.test(e.to) || e.to < e.from) return 'dates';
    if (!Number.isFinite(e.multiplier) || e.multiplier < 0 || e.multiplier > 10) return 'multiplier';
  }
  return null;
}

/** Editable list of demand events (Ramadan, White Friday, Eid …) with a multiplier each. */
export function EventsEditor({ value, onChange, disabled }: { value: ForecastEvent[]; onChange: (v: ForecastEvent[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<ForecastEvent>) => onChange(value.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  return (
    <div className="space-y-2">
      {!value.length && <p className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-500 dark:bg-ink-800/60"><CalendarRange className="h-4 w-4" />{t('intake.fc.noEvents')}</p>}
      {value.map((e, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-ink-100 p-2 dark:border-ink-800 sm:grid-cols-[1fr_9.5rem_9.5rem_6rem_auto] sm:items-center">
          <Input className="col-span-2 sm:col-span-1" aria-label={t('intake.fc.eventName')} placeholder={t('intake.fc.eventName')} value={e.name} disabled={disabled} maxLength={80} onChange={(ev) => set(i, { name: ev.target.value })} />
          <Input type="date" dir="ltr" aria-label={t('common.from')} value={e.from} disabled={disabled} onChange={(ev) => set(i, { from: ev.target.value })} />
          <Input type="date" dir="ltr" aria-label={t('common.to')} value={e.to} min={e.from} disabled={disabled} onChange={(ev) => set(i, { to: ev.target.value })} />
          <Input type="number" dir="ltr" step={0.05} min={0} max={10} aria-label={t('intake.fc.multiplier')} value={e.multiplier} disabled={disabled} onChange={(ev) => set(i, { multiplier: Number(ev.target.value) })} trailing={<span className="text-xs">×</span>} />
          <Button variant="ghost" className="!px-2" aria-label={t('action.delete')} disabled={disabled} onClick={() => onChange(value.filter((_, k) => k !== i))}><X className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} disabled={disabled || value.length >= 50} onClick={() => onChange([...value, { name: '', from: '', to: '', multiplier: 1.5 }])}>{t('intake.fc.addEvent')}</Button>
    </div>
  );
}
