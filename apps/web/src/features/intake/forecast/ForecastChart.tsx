import { useMemo } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dateOnly, num } from '@/lib/format';
import { useI18n } from '@/i18n';
import { ChartTooltip, Legend, useChartTheme } from '@/portals/ops/components/opsa/charts';
import type { ForecastDay, ForecastEvent } from '../types';
import '../i18n';

/**
 * Actual (bars) vs forecast (line) with the 80% interval as a band. One y-axis
 * (orders/day); the band is stacked as lower + (upper − lower) so only the
 * interval itself is filled.
 */
export function ForecastChart({ days, today, events, height = 320 }: { days: ForecastDay[]; today: string; events: ForecastEvent[]; height?: number }) {
  const { t, dir } = useI18n();
  const theme = useChartTheme();
  const actualColor = theme.categorical[0];
  const forecastColor = theme.categorical[1];
  const data = useMemo(() => days.map((d) => ({ date: d.date, actual: d.actual, forecast: d.forecast, base: d.lower, band: Math.max(0, d.upper - d.lower) })), [days]);
  const short = (d: string) => new Intl.DateTimeFormat(dir === 'rtl' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  return (
    <div>
      <Legend
        className="mb-3"
        items={[
          { label: t('intake.fc.actual'), color: actualColor },
          { label: t('intake.fc.forecast'), color: forecastColor, shape: 'line' },
          { label: t('intake.fc.interval'), color: `${forecastColor}40` },
        ]}
      />
      <div style={{ height }} dir="ltr" role="img" aria-label={t('intake.fc.chartLabel')}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="date" tickFormatter={short} tick={theme.tick} axisLine={{ stroke: theme.axis }} tickLine={false} minTickGap={16} reversed={dir === 'rtl'} />
            <YAxis tick={theme.tick} axisLine={false} tickLine={false} allowDecimals={false} width={44} orientation={dir === 'rtl' ? 'right' : 'left'} />
            {events.map((e) => (
              <ReferenceArea key={`${e.name}-${e.from}`} x1={e.from < days[0]?.date ? days[0].date : e.from} x2={e.to > days[days.length - 1]?.date ? days[days.length - 1].date : e.to} fill={theme.muted} fillOpacity={0.08} ifOverflow="hidden" />
            ))}
            <Area dataKey="base" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} activeDot={false} />
            <Area dataKey="band" stackId="band" stroke="none" fill={forecastColor} fillOpacity={0.18} isAnimationActive={false} activeDot={false} />
            <Bar dataKey="actual" fill={actualColor} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Line dataKey="forecast" stroke={forecastColor} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }} isAnimationActive={false} />
            <ReferenceLine x={today} stroke={theme.muted} strokeDasharray="2 3" label={{ value: t('common.today'), position: 'top', fill: theme.muted, fontSize: 11 }} />
            <Tooltip
              cursor={{ stroke: theme.axis }}
              content={({ active, payload, label }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                const items = [
                  ...(row.actual !== null ? [{ name: t('intake.fc.actual'), value: row.actual, color: actualColor, dataKey: 'actual' }] : []),
                  { name: t('intake.fc.forecast'), value: row.forecast, color: forecastColor, dataKey: 'forecast' },
                ];
                return (
                  <div>
                    <ChartTooltip active payload={items} label={label as string} labelFormat={(l) => dateOnly(`${l}T12:00:00Z`)} format={(v) => num(Math.round(v * 10) / 10)} />
                    <p className="-mt-1 rounded-b-xl border border-t-0 border-ink-100 bg-white px-3 pb-2 text-[11px] text-ink-500 dark:border-ink-700 dark:bg-ink-900">{t('intake.fc.range', { lo: num(row.base), hi: num(row.base + row.band) })}</p>
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
