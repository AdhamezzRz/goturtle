import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Categorical chart palette (validated for CVD separation, lightness band and
 * contrast on both the light card and the ink-900 dark card). Fixed order:
 * created → delivered → returned → failed. Never cycled.
 */
export const SERIES = {
  created: '#0284c7',
  delivered: '#00804C',
  returned: '#7c3aed',
  failed: '#d97706',
} as const;

/** Sequential (magnitude) single hue: GoTurtle green. */
export const SEQ = ['#d0efdc', '#a3dfbd', '#6bc897', '#33ab71', '#74C465', '#00804C', '#006a3f'];

export const axisProps = {
  tick: { fill: '#8592ab', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = { stroke: 'currentColor', strokeOpacity: 0.08, vertical: false } as const;

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

/** Recharts tooltip content that respects dark mode and keeps numbers LTR. */
export function ChartTooltip({
  active, payload, label, format, labelFormat,
}: {
  active?: boolean; payload?: TooltipEntry[]; label?: string | number; format?: (v: number, key: string) => ReactNode; labelFormat?: (l: string) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[150px] rounded-xl border border-ink-100 bg-white/95 px-3 py-2 text-xs shadow-pop backdrop-blur dark:border-ink-700 dark:bg-ink-900/95">
      {label !== undefined && <p className="mb-1.5 font-semibold text-ink-900 dark:text-white">{labelFormat ? labelFormat(String(label)) : label}</p>}
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-500">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="ltr tabular font-semibold text-ink-900 dark:text-white">{format ? format(Number(p.value), String(p.dataKey)) : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend row (identity is never color-alone: swatch + text). */
export function Legend({ items, className }: { items: Array<{ color: string; label: ReactNode; value?: ReactNode }>; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500', className)}>
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          <span>{it.label}</span>
          {it.value !== undefined && <span className="font-semibold text-ink-800 dark:text-ink-100">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal share bar list (failure reasons, status breakdown). */
export function BarList({ items, format }: { items: Array<{ key: string; label: ReactNode; value: number; color?: string }>; format?: (v: number) => ReactNode }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.key}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink-700 dark:text-ink-200">{it.label}</span>
            <span className="ltr tabular shrink-0 font-semibold text-ink-900 dark:text-white">{format ? format(it.value) : it.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
            <div className="h-full rounded-full transition-all" style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? SERIES.delivered }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
