import { useEffect, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '@/lib/format';
import { useI18n } from '@/i18n';

/** Chart palette (validated against light & dark surfaces): brand green for revenue, sand for cost. */
export const CHART = { revenue: '#00804C', cost: '#d96d06', neutral: '#8592ab' };

export function useDarkMode() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: ReactNode }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs shadow-pop dark:border-ink-700 dark:bg-ink-900">
      <p className="mb-1 font-semibold text-ink-800 dark:text-ink-100">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-ink-600 dark:text-ink-300">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="ltr font-semibold text-ink-900 dark:text-white">{money(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Column chart of money values (piasters). One or two series; categories on the
 * x axis (reversed in RTL so time/order reads naturally).
 */
export function MoneyBars({ data, series, height = 260, colorBy }: {
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; name: string; color: string }>;
  height?: number;
  /** Per-bar colour override for single-series charts. */
  colorBy?: (row: Record<string, string | number>) => string;
}) {
  const { dir } = useI18n();
  const dark = useDarkMode();
  const axis = dark ? '#8592ab' : '#667491';
  const grid = dark ? '#2a3140' : '#eceef2';
  return (
    <div style={{ height }} className="w-full" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={grid} />
          <XAxis dataKey="label" reversed={dir === 'rtl'} tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: grid }} interval={0} />
          <YAxis orientation={dir === 'rtl' ? 'right' : 'left'} tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => money(v, { compact: true })} />
          <Tooltip content={<MoneyTooltip />} cursor={{ fill: dark ? 'rgba(255,255,255,.04)' : 'rgba(16,24,40,.04)' }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: axis }} iconType="circle" iconSize={8} />}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={44}>
              {colorBy && series.length === 1 && data.map((row, i) => <Cell key={i} fill={colorBy(row)} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
