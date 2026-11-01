import type { ForecastEvent } from '../settings/settings.registry';
import { addDays, dayDiff, weekdayOf } from '../couriers/workforce.util';

/**
 * Demand model: weekday-weighted moving average over the last N weeks with a
 * linear trend and event multipliers. Pure and deterministic.
 *
 *  1. Event days in the history are de-seasonalised (count ÷ multiplier).
 *  2. Weekday level  L_w = Σ k·c(k,w) / Σ k   (week k = 1 oldest … N newest;
 *     recent weeks weigh more). Weekly level S = Σ_w L_w, weekday share s_w = L_w / S.
 *  3. Trend b = OLS slope of the weekly totals over k. The weighted average sits
 *     at k̄ = Σ k² / Σ k, so week k is expected to total S + b·(k − k̄).
 *  4. Forecast(day) = s_w · max(0, S + b·(k(day) − k̄)) × event multiplier.
 *  5. 80 % interval = ± 1.2816 · σ · √(1 + h/N), σ = in-sample residual std,
 *     h = weeks ahead of the history.
 */
export const Z80 = 1.2816;

export interface DemandModelInput {
  /** Cairo day → orders. Missing days count as 0 (inside the usable window). */
  counts: Map<string, number>;
  /** Last day of the history (inclusive). */
  end: string;
  weeks?: number;
  events?: ForecastEvent[];
  /** First day with any data; weeks before it are not used (a new network has no history). */
  firstDay?: string | null;
}

export interface DayForecast {
  value: number;
  lower: number;
  upper: number;
  multiplier: number;
  events: string[];
}

export interface DemandModel {
  end: string;
  weeksUsed: number;
  weekdayLevels: number[];
  weeklyLevel: number;
  slopePerWeek: number;
  sigma: number;
  forecast(day: string): DayForecast;
}

export function eventMultiplier(events: ForecastEvent[], day: string): { multiplier: number; names: string[] } {
  let multiplier = 1;
  const names: string[] = [];
  for (const e of events) {
    if (day >= e.from && day <= e.to) {
      multiplier *= e.multiplier;
      names.push(e.name);
    }
  }
  return { multiplier, names };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function fitDemandModel(input: DemandModelInput): DemandModel {
  const weeks = input.weeks ?? 8;
  const events = input.events ?? [];
  const start = addDays(input.end, -(weeks * 7 - 1));
  /** Week index of a day: N for the last 7 days of the history, N+1 for the 7 days after it … */
  const weekIndex = (day: string) => {
    const diff = dayDiff(input.end, day); // day − end
    return diff <= 0 ? weeks - Math.floor(-diff / 7) : weeks + Math.ceil(diff / 7);
  };
  const deseason = (day: string) => {
    const raw = input.counts.get(day) ?? 0;
    const m = eventMultiplier(events, day).multiplier;
    return m > 0 ? raw / m : raw;
  };

  // Weeks fully inside the data (a week that starts before the first order is left out).
  const usable: number[] = [];
  for (let k = 1; k <= weeks; k++) {
    const weekStart = addDays(start, (k - 1) * 7);
    if (!input.firstDay || weekStart >= input.firstDay) usable.push(k);
  }

  const days = (k: number) => Array.from({ length: 7 }, (_, i) => addDays(start, (k - 1) * 7 + i));
  let levels = new Array<number>(7).fill(0);
  let slope = 0;
  let kBar = weeks;
  if (usable.length) {
    const wsum = usable.reduce((s, k) => s + k, 0);
    for (const k of usable) for (const d of days(k)) levels[weekdayOf(d)] += (k * deseason(d)) / wsum;
    kBar = usable.reduce((s, k) => s + k * k, 0) / wsum;
    if (usable.length >= 2) {
      const totals = usable.map((k) => days(k).reduce((s, d) => s + deseason(d), 0));
      const mk = usable.reduce((s, k) => s + k, 0) / usable.length;
      const mt = totals.reduce((s, t) => s + t, 0) / totals.length;
      const sxx = usable.reduce((s, k) => s + (k - mk) ** 2, 0);
      slope = sxx > 0 ? usable.reduce((s, k, i) => s + (k - mk) * (totals[i] - mt), 0) / sxx : 0;
    }
  } else {
    // Less than a week of data: per-weekday mean of the days we have since the first order.
    const seen = new Array<number>(7).fill(0);
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i);
      if (input.firstDay && d < input.firstDay) continue;
      levels[weekdayOf(d)] += deseason(d);
      seen[weekdayOf(d)]++;
    }
    const total = levels.reduce((s, v) => s + v, 0);
    const n = seen.reduce((s, v) => s + v, 0);
    levels = levels.map((v, w) => (seen[w] ? v / seen[w] : n ? total / n : 0));
  }
  const weekly = levels.reduce((s, v) => s + v, 0);
  const share = (w: number) => (weekly > 0 ? levels[w] / weekly : 1 / 7);
  const base = (day: string) => share(weekdayOf(day)) * Math.max(0, weekly + slope * (weekIndex(day) - kBar));

  // In-sample residuals → σ.
  let sq = 0;
  let n = 0;
  for (const k of usable) {
    for (const d of days(k)) {
      sq += (deseason(d) - base(d)) ** 2;
      n++;
    }
  }
  const sigma = n > 2 ? Math.sqrt(sq / (n - 2)) : 0;
  const usedWeeks = Math.max(1, usable.length);

  return {
    end: input.end,
    weeksUsed: usable.length,
    weekdayLevels: levels.map(round1),
    weeklyLevel: round1(weekly),
    slopePerWeek: round1(slope),
    sigma: round1(sigma),
    forecast(day: string): DayForecast {
      const { multiplier, names } = eventMultiplier(events, day);
      const b = base(day);
      const ahead = Math.max(0, weekIndex(day) - weeks);
      const spread = Z80 * sigma * Math.sqrt(1 + ahead / usedWeeks);
      return {
        value: round1(b * multiplier),
        lower: Math.max(0, Math.floor((b - spread) * multiplier)),
        upper: Math.ceil((b + spread) * multiplier),
        multiplier,
        events: names,
      };
    },
  };
}

/** Mean absolute percentage error (days with actual 0 are skipped) and weighted APE. */
export function forecastErrors(pairs: Array<{ actual: number; forecast: number }>) {
  const nonZero = pairs.filter((p) => p.actual > 0);
  const mape = nonZero.length ? (nonZero.reduce((s, p) => s + Math.abs(p.actual - p.forecast) / p.actual, 0) / nonZero.length) * 100 : null;
  const totalActual = pairs.reduce((s, p) => s + p.actual, 0);
  const wape = totalActual > 0 ? (pairs.reduce((s, p) => s + Math.abs(p.actual - p.forecast), 0) / totalActual) * 100 : null;
  return { mape: mape === null ? null : round1(mape), wape: wape === null ? null : round1(wape), days: pairs.length };
}
