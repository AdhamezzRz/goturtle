import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { hubs, orders, shiftTemplates, shifts, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { DomainError } from '../../common/errors';
import { cairoToday } from '../../db/helpers';
import { SettingsService } from '../settings/settings.service';
import { addDays, cairoDayStart, dayDiff, daysBetween, weekdayOf } from '../couriers/workforce.util';
import { fitDemandModel, forecastErrors, type DemandModel } from './demand-model';
import type { AccuracyQueryDto, DemandQueryDto } from './forecasting.dto';

const HISTORY_WEEKS = 8;
const MAX_RANGE_DAYS = 92;
const UNKNOWN = '_none';

type Series = Map<string, Map<string, number>>; // group → day → count

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
/** Shift length in hours (overnight shifts wrap). */
const templateHours = (start: string, end: string) => {
  const d = minutesOf(end) - minutesOf(start);
  return (d > 0 ? d : d + 1440) / 60;
};

/**
 * Demand forecasting & staffing. Everything is computed on request from one
 * aggregated query (orders per hub per UTC hour, bucketed into Cairo days in
 * memory so DST is exact) — no precomputation, well under a second on 100k orders.
 */
@Injectable()
export class ForecastingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async demand(q: DemandQueryDto) {
    const today = cairoToday();
    const from = q.from ?? addDays(today, -14);
    const to = q.to ?? addDays(today, 14);
    if (to < from) throw new DomainError('INVALID_RANGE', '`to` must not be before `from`', HttpStatus.BAD_REQUEST);
    if (dayDiff(from, to) + 1 > MAX_RANGE_DAYS) throw new DomainError('INVALID_RANGE', `At most ${MAX_RANGE_DAYS} days per request`, HttpStatus.BAD_REQUEST);
    const by = q.by ?? 'hub';
    const end = addDays(today, -1); // last complete day
    const historyStart = addDays(end, -(HISTORY_WEEKS * 7 - 1));
    const loadFrom = from < historyStart ? from : historyStart;
    const loadTo = to > today ? today : to;
    const platform = await this.settings.get('platform');
    const [series, firstDay] = await Promise.all([this.series(loadFrom, loadTo > end ? loadTo : end, by, q.hubId), this.firstDay(q.hubId)]);

    const total = sumSeries(series);
    const model = fitDemandModel({ counts: total, end, weeks: HISTORY_WEEKS, events: platform.forecastEvents, firstDay });
    const range = daysBetween(from, to);
    const days = range.map((d) => {
      const f = model.forecast(d);
      return { date: d, weekday: weekdayOf(d), actual: d <= today ? total.get(d) ?? 0 : null, partial: d === today, forecast: f.value, lower: f.lower, upper: f.upper, multiplier: f.multiplier, events: f.events };
    });

    const labels = await this.groupLabels(by, [...series.keys()]);
    const groupModels = new Map<string, DemandModel>();
    const groups = [...series.entries()]
      .map(([id, counts]) => {
        const m = fitDemandModel({ counts, end, weeks: HISTORY_WEEKS, events: platform.forecastEvents, firstDay });
        groupModels.set(id, m);
        const label = labels.get(id);
        return {
          id: id === UNKNOWN ? null : id,
          code: label?.code ?? null,
          name: label?.name ?? null,
          nameAr: label?.nameAr ?? null,
          historyTotal: [...counts.entries()].filter(([d]) => d >= historyStart && d <= end).reduce((s, [, n]) => s + n, 0),
          days: range.map((d) => {
            const f = m.forecast(d);
            return { date: d, actual: d <= today ? counts.get(d) ?? 0 : null, forecast: f.value, lower: f.lower, upper: f.upper };
          }),
        };
      })
      .sort((a, b) => b.historyTotal - a.historyTotal);

    return {
      from,
      to,
      asOf: today,
      by,
      history: { from: historyStart, to: end, weeks: HISTORY_WEEKS, weeksUsed: model.weeksUsed, firstDay },
      model: { weeklyLevel: model.weeklyLevel, slopePerWeek: model.slopePerWeek, sigma: model.sigma, weekdayLevels: model.weekdayLevels },
      events: platform.forecastEvents.filter((e) => e.to >= from && e.from <= to),
      days,
      totals: {
        forecast: Math.round(days.filter((d) => d.date >= today).reduce((s, d) => s + d.forecast, 0)),
        actual: days.reduce((s, d) => s + (d.actual ?? 0), 0),
      },
      groups,
      staffing: by === 'hub' ? await this.staffing(range.filter((d) => d >= today), groupModels, model, labels, platform.ordersPerHeroPerShift, q.hubId) : null,
    };
  }

  /** Backtest: each of the last `weeks` weeks forecast from the 8 weeks before it, against what happened. */
  async accuracy(q: AccuracyQueryDto) {
    const weeks = q.weeks ?? 4;
    const today = cairoToday();
    const firstWeekStart = addDays(today, -7 * weeks);
    const loadFrom = addDays(firstWeekStart, -HISTORY_WEEKS * 7);
    const platform = await this.settings.get('platform');
    const [series, firstDay] = await Promise.all([this.series(loadFrom, addDays(today, -1), 'hub', q.hubId), this.firstDay(q.hubId)]);
    const total = sumSeries(series);
    const pairs: Array<{ date: string; actual: number; forecast: number; lower: number; upper: number }> = [];
    const perWeek: Array<{ weekStart: string; mape: number | null; wape: number | null }> = [];
    for (let j = 0; j < weeks; j++) {
      const weekStart = addDays(firstWeekStart, 7 * j);
      const model = fitDemandModel({ counts: total, end: addDays(weekStart, -1), weeks: HISTORY_WEEKS, events: platform.forecastEvents, firstDay });
      const week: typeof pairs = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        if (d >= today) break;
        const f = model.forecast(d);
        week.push({ date: d, actual: total.get(d) ?? 0, forecast: f.value, lower: f.lower, upper: f.upper });
      }
      const e = forecastErrors(week);
      perWeek.push({ weekStart, mape: e.mape, wape: e.wape });
      pairs.push(...week);
    }
    const overall = forecastErrors(pairs);
    const inside = pairs.filter((p) => p.actual >= p.lower && p.actual <= p.upper).length;
    return {
      weeks,
      from: firstWeekStart,
      to: addDays(today, -1),
      mape: overall.mape,
      wape: overall.wape,
      accuracy: overall.mape === null ? null : Math.max(0, Math.round((100 - overall.mape) * 10) / 10),
      intervalCoverage: pairs.length ? Math.round((inside / pairs.length) * 1000) / 10 : null,
      perWeek,
      days: pairs,
    };
  }

  // ------------------------------------------------------------------ staffing

  /**
   * Recommended heroes per hub / shift template / day = ceil(forecast share ÷
   * orders per hero per shift); a hub's daily forecast is split across the
   * templates running that weekday by shift length. Compared with the shifts
   * already scheduled (gap < 0 = understaffed).
   */
  private async staffing(days: string[], models: Map<string, DemandModel>, totalModel: DemandModel, labels: Map<string, { code: string; name: string; nameAr: string | null }>, perHero: number, hubId?: string) {
    if (!days.length) return { ordersPerHeroPerShift: perHero, rows: [], summary: { recommended: 0, scheduled: 0, gap: 0, understaffedDays: 0 } };
    const templates = await this.db
      .select()
      .from(shiftTemplates)
      .where(and(eq(shiftTemplates.isActive, true), hubId ? eq(shiftTemplates.hubId, hubId) : undefined))
      .orderBy(asc(shiftTemplates.startTime));
    const start = cairoDayStart(days[0]);
    const end = cairoDayStart(addDays(days[days.length - 1], 1));
    const booked = await this.db
      .select({ templateId: shifts.templateId, hubId: shifts.hubId, startAt: shifts.startAt })
      .from(shifts)
      .where(and(gte(shifts.startAt, start), lt(shifts.startAt, end), notInArray(shifts.status, ['CANCELLED', 'MISSED']), hubId ? eq(shifts.hubId, hubId) : undefined));
    const scheduled = new Map<string, number>();
    const bump = (key: string) => scheduled.set(key, (scheduled.get(key) ?? 0) + 1);
    for (const s of booked) {
      const day = cairoToday(s.startAt);
      bump(`${day}|${s.templateId ?? '-'}`);
      bump(`${day}|hub:${s.hubId ?? '-'}`);
    }
    const hubIds = [...new Set([...models.keys()].filter((k) => k !== UNKNOWN))];
    for (const t of templates) if (t.hubId && !hubIds.includes(t.hubId)) hubIds.push(t.hubId);
    const missing = hubIds.filter((h) => !labels.has(h));
    if (missing.length) for (const [k, v] of await this.groupLabels('hub', missing)) labels.set(k, v);

    const rows: Array<{
      date: string; hubId: string | null; hubCode: string | null; hubName: string | null; templateId: string | null; templateName: string | null;
      startTime: string | null; endTime: string | null; forecastOrders: number; recommended: number; scheduled: number; gap: number;
    }> = [];
    for (const day of days) {
      const w = weekdayOf(day);
      const running = templates.filter((t) => t.daysOfWeek.includes(w));
      const scopes: Array<{ hubId: string | null; forecast: number }> = hubIds.map((h) => ({ hubId: h, forecast: models.get(h)?.forecast(day).value ?? 0 }));
      // Network-wide templates (no hub) cover the whole forecast.
      if (running.some((t) => !t.hubId)) scopes.push({ hubId: null, forecast: totalModel.forecast(day).value });
      for (const scope of scopes) {
        const label = scope.hubId ? labels.get(scope.hubId) : undefined;
        const own = running.filter((t) => t.hubId === scope.hubId);
        if (!own.length) {
          if (!scope.hubId || scope.forecast <= 0) continue;
          const recommended = Math.ceil(scope.forecast / perHero);
          const have = scheduled.get(`${day}|hub:${scope.hubId}`) ?? 0;
          rows.push({ date: day, hubId: scope.hubId, hubCode: label?.code ?? null, hubName: label?.name ?? null, templateId: null, templateName: null, startTime: null, endTime: null, forecastOrders: scope.forecast, recommended, scheduled: have, gap: have - recommended });
          continue;
        }
        const hours = own.reduce((s, t) => s + templateHours(t.startTime, t.endTime), 0);
        for (const t of own) {
          const part = hours > 0 ? (scope.forecast * templateHours(t.startTime, t.endTime)) / hours : scope.forecast / own.length;
          const recommended = part > 0 ? Math.ceil(part / perHero) : 0;
          const have = scheduled.get(`${day}|${t.id}`) ?? 0;
          rows.push({
            date: day, hubId: scope.hubId, hubCode: label?.code ?? null, hubName: label?.name ?? null, templateId: t.id, templateName: t.name,
            startTime: t.startTime, endTime: t.endTime, forecastOrders: Math.round(part * 10) / 10, recommended, scheduled: have, gap: have - recommended,
          });
        }
      }
    }
    const recommended = rows.reduce((s, r) => s + r.recommended, 0);
    const have = rows.reduce((s, r) => s + r.scheduled, 0);
    return {
      ordersPerHeroPerShift: perHero,
      rows,
      summary: { recommended, scheduled: have, gap: have - recommended, understaffedDays: new Set(rows.filter((r) => r.gap < 0).map((r) => r.date)).size },
    };
  }

  // ------------------------------------------------------------------ data

  /** Orders per group (hub or zone) per Cairo day for [from, to]. */
  private async series(from: string, to: string, by: 'hub' | 'zone', hubId?: string): Promise<Series> {
    const groupCol = by === 'zone' ? orders.zoneId : orders.hubId;
    const hour = sql<string>`date_format(${orders.createdAt}, '%Y-%m-%d %H')`;
    const conds: SQL[] = [gte(orders.createdAt, cairoDayStart(from)), lt(orders.createdAt, cairoDayStart(addDays(to, 1))), ne(orders.status, 'CANCELLED'), isNull(orders.parentOrderId)];
    if (hubId) conds.push(eq(orders.hubId, hubId));
    const rows = await this.db
      .select({ g: groupCol, h: hour, n: sql<number>`count(*)`.mapWith(Number) })
      .from(orders)
      .where(and(...conds))
      .groupBy(groupCol, hour);
    const dayOfHour = new Map<string, string>();
    const out: Series = new Map();
    for (const r of rows) {
      let day = dayOfHour.get(r.h);
      if (!day) {
        day = cairoToday(new Date(`${r.h.replace(' ', 'T')}:00:00Z`));
        dayOfHour.set(r.h, day);
      }
      const key = r.g ?? UNKNOWN;
      let m = out.get(key);
      if (!m) out.set(key, (m = new Map()));
      m.set(day, (m.get(day) ?? 0) + r.n);
    }
    return out;
  }

  private async firstDay(hubId?: string): Promise<string | null> {
    const [row] = await this.db
      .select({ at: sql<Date | string | null>`min(${orders.createdAt})` })
      .from(orders)
      .where(hubId ? eq(orders.hubId, hubId) : undefined);
    if (!row?.at) return null;
    const at = row.at instanceof Date ? row.at : new Date(`${String(row.at).replace(' ', 'T')}Z`);
    return Number.isNaN(at.getTime()) ? null : cairoToday(at);
  }

  private async groupLabels(by: 'hub' | 'zone', ids: string[]) {
    const real = ids.filter((i) => i !== UNKNOWN);
    const out = new Map<string, { code: string; name: string; nameAr: string | null }>();
    if (!real.length) return out;
    if (by === 'hub') {
      const rows = await this.db.select({ id: hubs.id, code: hubs.code, name: hubs.name, nameAr: hubs.nameAr }).from(hubs).where(inArray(hubs.id, real));
      for (const r of rows) out.set(r.id, { code: r.code, name: r.name, nameAr: r.nameAr });
    } else {
      const rows = await this.db.select({ id: zones.id, code: zones.code, name: zones.nameEn, nameAr: zones.nameAr }).from(zones).where(inArray(zones.id, real));
      for (const r of rows) out.set(r.id, { code: r.code, name: r.name, nameAr: r.nameAr });
    }
    return out;
  }
}

function sumSeries(series: Series): Map<string, number> {
  const total = new Map<string, number>();
  for (const m of series.values()) for (const [d, n] of m) total.set(d, (total.get(d) ?? 0) + n);
  return total;
}
