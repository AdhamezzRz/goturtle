import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useIsDark } from './ui';

/**
 * Chart tokens (validated reference palette; status colours are reserved for
 * delivery outcomes and never reused as a plain series colour).
 */
export const STATUS_COLORS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const;
const CATEGORICAL_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const CATEGORICAL_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const SEQ_BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export function useChartTheme() {
  const dark = useIsDark();
  return {
    dark,
    categorical: dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT,
    series1: dark ? '#3987e5' : '#2a78d6',
    grid: dark ? '#2c2c2a' : '#e1e0d9',
    axis: dark ? '#383835' : '#c3c2b7',
    muted: '#898781',
    surface: dark ? '#1f2430' : '#ffffff',
    ink: dark ? '#f0efec' : '#0b0b0b',
    tick: { fill: '#898781', fontSize: 11 },
  };
}

/** Recharts tooltip body styled like the app's popovers. */
export function ChartTooltip({ active, payload, label, format, labelFormat }: {
  active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }>; label?: string | number;
  format?: (v: number, key: string) => ReactNode; labelFormat?: (l: string | number) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[150px] rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs shadow-pop dark:border-ink-700 dark:bg-ink-900">
      {label !== undefined && <p className="mb-1 font-semibold text-ink-900 dark:text-white">{labelFormat ? labelFormat(label) : label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-600 dark:text-ink-300">
              <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="ltr font-semibold text-ink-900 dark:text-white">{format ? format(Number(p.value ?? 0), String(p.dataKey ?? '')) : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Legend({ items, className }: { items: Array<{ label: ReactNode; color: string; shape?: 'square' | 'line' }>; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600 dark:text-ink-300', className)}>
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span className={it.shape === 'line' ? 'h-0.5 w-3.5 rounded' : 'h-2.5 w-2.5 rounded-sm'} style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
