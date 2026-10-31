import type { ReactNode } from 'react';
import { AlarmClock, LogOut, MapPinOff, Timer } from 'lucide-react';
import { registerDictionary, useI18n } from '@/i18n';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import type { ShiftRow } from './types';

registerDictionary({
  'ops.opsb.shift.late': { en: 'Late {n} min', ar: 'تأخير {n} د' },
  'ops.opsb.shift.overtime': { en: 'Overtime {n} min', ar: 'إضافي {n} د' },
  'ops.opsb.shift.geofence': { en: 'Outside hub geofence', ar: 'خارج نطاق المخزن' },
  'ops.opsb.shift.autoOut': { en: 'Auto clock-out', ar: 'انصراف تلقائي' },
});

/** Colour classes per shift status (calendar blocks). */
export const SHIFT_COLORS: Record<string, string> = {
  SCHEDULED: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
  CONFIRMED: 'border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-100',
  IN_PROGRESS: 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200',
  COMPLETED: 'border-turtle-200 bg-turtle-50 text-turtle-900 dark:border-turtle-900 dark:bg-turtle-950/50 dark:text-turtle-200',
  MISSED: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
  CANCELLED: 'border-ink-200 bg-ink-50 text-ink-500 line-through dark:border-ink-700 dark:bg-ink-800/50 dark:text-ink-400',
};

export const SHIFT_DOT: Record<string, string> = {
  SCHEDULED: 'bg-sky-400', CONFIRMED: 'bg-sky-600', IN_PROGRESS: 'bg-violet-500', COMPLETED: 'bg-turtle-500', MISSED: 'bg-red-500', CANCELLED: 'bg-ink-300',
};

export function AttendanceFlags({ s, compact, className }: { s: Pick<ShiftRow, 'lateMinutes' | 'overtimeMinutes' | 'geofenceWarning' | 'autoClockOut'>; compact?: boolean; className?: string }) {
  const { t } = useI18n();
  const flags = [
    s.lateMinutes > 0 && { key: 'late', tone: 'warning' as const, icon: <AlarmClock className="h-3 w-3" />, label: t('ops.opsb.shift.late', { n: num(s.lateMinutes) }) },
    s.overtimeMinutes > 0 && { key: 'ot', tone: 'info' as const, icon: <Timer className="h-3 w-3" />, label: t('ops.opsb.shift.overtime', { n: num(s.overtimeMinutes) }) },
    s.geofenceWarning && { key: 'geo', tone: 'danger' as const, icon: <MapPinOff className="h-3 w-3" />, label: t('ops.opsb.shift.geofence') },
    s.autoClockOut && { key: 'auto', tone: 'warning' as const, icon: <LogOut className="h-3 w-3" />, label: t('ops.opsb.shift.autoOut') },
  ].filter(Boolean) as Array<{ key: string; tone: 'warning' | 'info' | 'danger'; icon: ReactNode; label: string }>;
  if (!flags.length) return null;
  if (compact)
    return (
      <span className={cn('inline-flex items-center gap-0.5', className)}>
        {flags.map((f) => (
          <span key={f.key} title={f.label} aria-label={f.label} className={cn('grid h-4 w-4 place-items-center rounded-full', f.tone === 'danger' ? 'bg-red-500 text-white' : f.tone === 'warning' ? 'bg-amber-400 text-ink-950' : 'bg-sky-500 text-white')}>{f.icon}</span>
        ))}
      </span>
    );
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {flags.map((f) => <Badge key={f.key} tone={f.tone}>{f.icon}{f.label}</Badge>)}
    </span>
  );
}
