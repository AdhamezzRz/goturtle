import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, sql } from 'drizzle-orm';
import { HERO_BADGES, levelForXp, XP_RULES } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { cashHandovers, couriers, deliveryAttempts, orders, pickups, sequences, shifts, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { JobsService } from '../../core/jobs.service';
import { cairoToday } from '../../db/helpers';
import { addDays, cairoDayRange, cairoDayStart, monthStartOf, percent, toNumber, weekStartOf } from '../couriers/workforce.util';

/**
 * XP kinds. Each award is recorded as an idempotency marker row in the
 * `sequences` table with key `xp:<courierId>:<kind>:<entityId>` and value =
 * XP granted. INSERT IGNORE on the primary key makes every award exactly-once
 * even when events are replayed or delivered twice, and the marker rows double
 * as an auditable XP history (see `xpBreakdown`).
 */
export const XP_KINDS = {
  od: 'delivered',
  fa: 'failedAttempt',
  pk: 'pickup',
  ho: 'cashHandoverSameDay',
  st: 'dailyStreak',
} as const;
export type XpKind = keyof typeof XP_KINDS;

export type LeaderboardPeriod = 'day' | 'week' | 'month';

export const PERFECT_WEEK_MIN_DELIVERIES = 20;
export const CASH_ANGEL_MIN_ORDERS = 10;
export const EARLY_BIRD_TARGET = 20;
export const FIVE_STAR_TARGET = 50;

export const xpMarkerKey = (courierId: string, kind: XpKind, entityId: string) => `xp:${courierId}:${kind}:${entityId}`;

@Injectable()
export class GamificationService implements OnModuleInit {
  private readonly log = new Logger(GamificationService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register({ name: 'gamification.streaks', everySeconds: 3600, timeoutSeconds: 90, run: () => this.runStreaks() });
  }

  // ------------------------------------------------------------------ awards

  /** Grants XP exactly once per (courier, kind, entity). Returns true when XP was newly awarded. */
  async award(courierId: string, kind: XpKind, entityId: string, amount: number, tx?: DbOrTx): Promise<boolean> {
    const key = xpMarkerKey(courierId, kind, entityId);
    if (key.length > 80) throw new Error(`XP marker key too long: ${key}`);
    const run = async (t: DbOrTx) => {
      const [res] = (await t.insert(sequences).ignore().values({ key, value: Math.max(0, amount) })) as unknown as [{ affectedRows: number }];
      if (res.affectedRows !== 1) return false;
      if (amount > 0) await t.update(couriers).set({ xp: sql`${couriers.xp} + ${amount}` }).where(eq(couriers.id, courierId));
      return true;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** Delivered order → delivery XP (+ on-time bonus when delivered before promisedBy). Verified against the order row. */
  async onOrderDelivered(orderId: string): Promise<number> {
    const [o] = await this.db
      .select({ id: orders.id, status: orders.status, courierId: orders.courierId, deliveredAt: orders.deliveredAt, promisedBy: orders.promisedBy })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!o || o.status !== 'DELIVERED' || !o.courierId) return 0;
    const onTime = !!(o.promisedBy && o.deliveredAt && o.deliveredAt.getTime() <= o.promisedBy.getTime());
    const amount = XP_RULES.delivered + (onTime ? XP_RULES.deliveredOnTime : 0);
    return (await this.award(o.courierId, 'od', o.id, amount)) ? amount : 0;
  }

  /** Failed attempt → small effort XP per recorded attempt (falls back to the order's attempt counter). */
  async onFailedAttempt(orderId: string, courierIdHint: string | null): Promise<number> {
    const attempts = await this.db
      .select({ id: deliveryAttempts.id, courierId: deliveryAttempts.courierId })
      .from(deliveryAttempts)
      .where(and(eq(deliveryAttempts.orderId, orderId), eq(deliveryAttempts.success, false)));
    let total = 0;
    if (attempts.length) {
      for (const a of attempts) {
        if (await this.award(a.courierId, 'fa', a.id, XP_RULES.failedAttempt)) total += XP_RULES.failedAttempt;
      }
      return total;
    }
    const [o] = await this.db.select({ courierId: orders.courierId, attempts: orders.attempts }).from(orders).where(eq(orders.id, orderId)).limit(1);
    const courierId = o?.courierId ?? courierIdHint;
    if (!o || !courierId) return 0;
    const entity = `${orderId}-${Math.max(1, o.attempts)}`;
    return (await this.award(courierId, 'fa', entity, XP_RULES.failedAttempt)) ? XP_RULES.failedAttempt : 0;
  }

  async onPickupCompleted(pickupId: string): Promise<number> {
    const [p] = await this.db.select({ status: pickups.status, courierId: pickups.courierId }).from(pickups).where(eq(pickups.id, pickupId)).limit(1);
    if (!p || p.status !== 'COMPLETED' || !p.courierId) return 0;
    return (await this.award(p.courierId, 'pk', pickupId, XP_RULES.pickupCompleted)) ? XP_RULES.pickupCompleted : 0;
  }

  /**
   * Same-day cash bonus: every order settled by the handover was delivered on
   * the same Cairo day the hero handed the cash over.
   */
  async onHandoverConfirmed(handoverId: string): Promise<number> {
    const [h] = await this.db.select().from(cashHandovers).where(eq(cashHandovers.id, handoverId)).limit(1);
    if (!h || h.status !== 'CONFIRMED') return 0;
    const linked = await this.db.select({ deliveredAt: orders.deliveredAt }).from(orders).where(eq(orders.cashHandoverId, h.id));
    if (!linked.length) return 0;
    const day = cairoToday(h.createdAt);
    const sameDay = linked.every((o) => o.deliveredAt && cairoToday(o.deliveredAt) === day);
    if (!sameDay) return 0;
    return (await this.award(h.courierId, 'ho', h.id, XP_RULES.cashHandoverSameDay)) ? XP_RULES.cashHandoverSameDay : 0;
  }

  /**
   * Daily streak job. For each active hero not yet processed for yesterday
   * (Cairo): delivered at least once → streak + 1 (and streak XP from the 2nd
   * consecutive day), otherwise the streak resets. Batches of 100; the marker
   * row makes each (hero, day) exactly-once across overlapping runs.
   */
  async runStreaks(now = new Date()): Promise<string> {
    const day = addDays(cairoToday(now), -1);
    const { start, end } = cairoDayRange(day);
    let processed = 0;
    for (let batch = 0; batch < 10; batch++) {
      const candidates = await this.db
        .select({ id: couriers.id, streakDays: couriers.streakDays })
        .from(couriers)
        .leftJoin(sequences, eq(sequences.key, sql`concat('xp:', ${couriers.id}, ':st:', ${day})`))
        .where(and(eq(couriers.status, 'ACTIVE'), isNull(sequences.key)))
        .limit(100);
      if (!candidates.length) break;
      const delivered = await this.db
        .select({ courierId: orders.courierId, n: count() })
        .from(orders)
        .where(
          and(
            inArray(orders.courierId, candidates.map((c) => c.id)),
            eq(orders.status, 'DELIVERED'),
            gte(orders.deliveredAt, start),
            lt(orders.deliveredAt, end),
          ),
        )
        .groupBy(orders.courierId);
      const active = new Set(delivered.filter((d) => Number(d.n) > 0).map((d) => d.courierId));
      for (const c of candidates) {
        const worked = active.has(c.id);
        const streak = worked ? c.streakDays + 1 : 0;
        const xp = worked && streak >= 2 ? XP_RULES.dailyStreak : 0;
        await this.db.transaction(async (tx) => {
          const awarded = await this.award(c.id, 'st', day, xp, tx);
          if (awarded) await tx.update(couriers).set({ streakDays: streak }).where(eq(couriers.id, c.id));
        });
        processed++;
      }
    }
    return `streaks for ${day}: ${processed} heroes`;
  }

  // ---------------------------------------------------------------- reading

  /** XP earned per kind, from the award markers. */
  async xpBreakdown(courierId: string): Promise<Record<(typeof XP_KINDS)[XpKind], { count: number; xp: number }>> {
    const rows = await this.db
      .select({ key: sequences.key, value: sequences.value })
      .from(sequences)
      .where(like(sequences.key, `xp:${courierId}:%`));
    const out = Object.fromEntries(Object.values(XP_KINDS).map((k) => [k, { count: 0, xp: 0 }])) as Record<(typeof XP_KINDS)[XpKind], { count: number; xp: number }>;
    for (const r of rows) {
      const kind = r.key.split(':')[2] as XpKind;
      const name = XP_KINDS[kind];
      if (!name) continue;
      if (kind === 'st' && r.value === 0) continue; // a processed day without streak XP
      out[name].count++;
      out[name].xp += r.value;
    }
    return out;
  }

  /** Level, progress, badges computed from real stats, and streak. */
  async achievements(courierId: string) {
    const [c] = await this.db.select({ xp: couriers.xp, streakDays: couriers.streakDays, rating: couriers.rating, ratingCount: couriers.ratingCount }).from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!c) return null;
    const today = cairoToday();
    const [[delivered], [fiveStar], [early]] = await Promise.all([
      this.db.select({ n: count() }).from(orders).where(and(eq(orders.courierId, courierId), eq(orders.status, 'DELIVERED'))),
      this.db.select({ n: count() }).from(orders).where(and(eq(orders.courierId, courierId), eq(orders.rating, 5))),
      this.db
        .select({ n: count() })
        .from(shifts)
        .where(and(eq(shifts.courierId, courierId), isNotNull(shifts.clockInAt), sql`${shifts.clockInAt} < ${shifts.startAt}`)),
    ]);
    const totalDelivered = Number(delivered?.n ?? 0);
    const perfectWeek = await this.perfectWeekStats(courierId, today);
    const cashAngel = await this.cashAngelStats(courierId, today);
    const fiveStarN = Number(fiveStar?.n ?? 0);
    const earlyN = Number(early?.n ?? 0);

    const progress: Record<string, { current: number; target: number; earned: boolean }> = {
      first_delivery: { current: Math.min(totalDelivered, 1), target: 1, earned: totalDelivered >= 1 },
      century: { current: Math.min(totalDelivered, 100), target: 100, earned: totalDelivered >= 100 },
      thousand: { current: Math.min(totalDelivered, 1000), target: 1000, earned: totalDelivered >= 1000 },
      perfect_week: { current: Math.min(perfectWeek.bestCurrent, PERFECT_WEEK_MIN_DELIVERIES), target: PERFECT_WEEK_MIN_DELIVERIES, earned: perfectWeek.earned },
      five_star: { current: Math.min(fiveStarN, FIVE_STAR_TARGET), target: FIVE_STAR_TARGET, earned: fiveStarN >= FIVE_STAR_TARGET },
      cash_angel: { current: cashAngel.sameDay, target: Math.max(CASH_ANGEL_MIN_ORDERS, cashAngel.total), earned: cashAngel.earned },
      early_bird: { current: Math.min(earlyN, EARLY_BIRD_TARGET), target: EARLY_BIRD_TARGET, earned: earlyN >= EARLY_BIRD_TARGET },
    };
    const badges = HERO_BADGES.map((b) => ({ ...b, ...progress[b.key] }));
    const level = levelForXp(c.xp);
    return {
      xp: c.xp,
      level: { level: level.level, en: level.en, ar: level.ar, emoji: level.emoji, minXp: level.minXp, progress: level.progress, next: level.next, xpToNext: level.next ? level.next.minXp - c.xp : 0 },
      streakDays: c.streakDays,
      rating: c.rating,
      ratingCount: c.ratingCount,
      stats: { totalDelivered, fiveStarRatings: fiveStarN, earlyClockIns: earlyN },
      badges,
      badgesEarned: badges.filter((b) => b.earned).length,
      xpBreakdown: await this.xpBreakdown(courierId),
      rules: XP_RULES,
    };
  }

  /** Best Sunday–Saturday week (last 8 weeks) with ≥ 20 deliveries and zero failed attempts. */
  private async perfectWeekStats(courierId: string, today: string) {
    const firstWeek = addDays(weekStartOf(today), -7 * 7);
    const since = cairoDayStart(firstWeek);
    const [deliveredRows, failedRows] = await Promise.all([
      this.db
        .select({ at: orders.deliveredAt })
        .from(orders)
        .where(and(eq(orders.courierId, courierId), eq(orders.status, 'DELIVERED'), gte(orders.deliveredAt, since))),
      this.db
        .select({ at: deliveryAttempts.createdAt })
        .from(deliveryAttempts)
        .where(and(eq(deliveryAttempts.courierId, courierId), eq(deliveryAttempts.success, false), gte(deliveryAttempts.createdAt, since))),
    ]);
    const weeks = new Map<string, { delivered: number; failed: number }>();
    const bucket = (at: Date) => {
      const w = weekStartOf(cairoToday(at));
      let b = weeks.get(w);
      if (!b) weeks.set(w, (b = { delivered: 0, failed: 0 }));
      return b;
    };
    for (const r of deliveredRows) if (r.at) bucket(r.at).delivered++;
    for (const r of failedRows) bucket(r.at).failed++;
    let earned = false;
    let bestCurrent = 0;
    for (const w of weeks.values()) {
      if (w.failed === 0) {
        bestCurrent = Math.max(bestCurrent, w.delivered);
        if (w.delivered >= PERFECT_WEEK_MIN_DELIVERIES) earned = true;
      }
    }
    return { earned, bestCurrent };
  }

  /** Every COD order of the last 30 days (before today) handed over on its delivery day, with at least 10 such orders. */
  private async cashAngelStats(courierId: string, today: string) {
    const since = cairoDayStart(addDays(today, -30));
    const until = cairoDayStart(today);
    const rows = await this.db
      .select({ deliveredAt: orders.deliveredAt, handedAt: cashHandovers.createdAt, handoverStatus: cashHandovers.status })
      .from(orders)
      .leftJoin(cashHandovers, eq(cashHandovers.id, orders.cashHandoverId))
      .where(
        and(
          eq(orders.courierId, courierId),
          eq(orders.status, 'DELIVERED'),
          sql`${orders.collectedCents} > 0`,
          gte(orders.deliveredAt, since),
          lt(orders.deliveredAt, until),
        ),
      );
    const sameDay = rows.filter((r) => r.deliveredAt && r.handedAt && r.handoverStatus === 'CONFIRMED' && cairoToday(r.deliveredAt) === cairoToday(r.handedAt)).length;
    return { total: rows.length, sameDay, earned: rows.length >= CASH_ANGEL_MIN_ORDERS && sameDay === rows.length };
  }

  /** Start of a leaderboard period (Cairo calendar: today, week from Sunday, month from the 1st). */
  periodStart(period: LeaderboardPeriod, now = new Date()): Date {
    const today = cairoToday(now);
    if (period === 'day') return cairoDayStart(today);
    if (period === 'week') return cairoDayStart(weekStartOf(today));
    return cairoDayStart(monthStartOf(today));
  }

  /**
   * Ranking of active heroes for a period by period XP (computed from facts:
   * deliveries, on-time, pickups, failed attempts), then success rate and rating.
   */
  async leaderboard(period: LeaderboardPeriod, opts: { limit?: number; hubId?: string | null; meCourierId?: string | null } = {}) {
    const since = this.periodStart(period);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const heroes = await this.db
      .select({
        courierId: couriers.id, code: couriers.code, name: users.name, avatarUrl: users.avatarUrl, hubId: couriers.homeHubId,
        employmentType: couriers.employmentType, vehicleType: couriers.vehicleType, rating: couriers.rating, ratingCount: couriers.ratingCount,
        xp: couriers.xp, streakDays: couriers.streakDays,
      })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(and(eq(couriers.status, 'ACTIVE'), opts.hubId ? eq(couriers.homeHubId, opts.hubId) : undefined))
      .orderBy(asc(couriers.code));
    const ids = heroes.map((h) => h.courierId);
    if (!ids.length) return { period, since, data: [], me: null };

    const [deliveredRows, failedRows, pickupRows] = await Promise.all([
      this.db
        .select({
          courierId: orders.courierId,
          n: count(),
          onTime: sql<number>`coalesce(sum(case when ${orders.promisedBy} is not null and ${orders.deliveredAt} <= ${orders.promisedBy} then 1 else 0 end), 0)`.mapWith(Number),
        })
        .from(orders)
        .where(and(inArray(orders.courierId, ids), eq(orders.status, 'DELIVERED'), gte(orders.deliveredAt, since)))
        .groupBy(orders.courierId),
      this.db
        .select({ courierId: deliveryAttempts.courierId, n: count() })
        .from(deliveryAttempts)
        .where(and(inArray(deliveryAttempts.courierId, ids), eq(deliveryAttempts.success, false), gte(deliveryAttempts.createdAt, since)))
        .groupBy(deliveryAttempts.courierId),
      this.db
        .select({ courierId: pickups.courierId, n: count() })
        .from(pickups)
        .where(and(inArray(pickups.courierId, ids), eq(pickups.status, 'COMPLETED'), gte(pickups.completedAt, since)))
        .groupBy(pickups.courierId),
    ]);
    const dMap = new Map(deliveredRows.map((r) => [r.courierId!, { n: Number(r.n), onTime: toNumber(r.onTime) }]));
    const fMap = new Map(failedRows.map((r) => [r.courierId, Number(r.n)]));
    const pMap = new Map(pickupRows.map((r) => [r.courierId!, Number(r.n)]));

    const ranked = heroes
      .map((h) => {
        const d = dMap.get(h.courierId) ?? { n: 0, onTime: 0 };
        const failed = fMap.get(h.courierId) ?? 0;
        const pickupsDone = pMap.get(h.courierId) ?? 0;
        const periodXp = d.n * XP_RULES.delivered + d.onTime * XP_RULES.deliveredOnTime + pickupsDone * XP_RULES.pickupCompleted + failed * XP_RULES.failedAttempt;
        const lvl = levelForXp(h.xp);
        return {
          ...h,
          deliveries: d.n,
          onTime: d.onTime,
          failedAttempts: failed,
          pickups: pickupsDone,
          successRate: percent(d.n, d.n + failed),
          periodXp,
          level: lvl.level,
          levelName: { en: lvl.en, ar: lvl.ar },
        };
      })
      .sort((a, b) => b.periodXp - a.periodXp || b.successRate - a.successRate || b.rating - a.rating || a.code.localeCompare(b.code))
      .map((r, i) => ({ rank: i + 1, ...r }));

    const me = opts.meCourierId ? ranked.find((r) => r.courierId === opts.meCourierId) ?? null : null;
    return { period, since, data: ranked.slice(0, limit), me };
  }

  /** Recent XP-relevant facts for one hero, newest first (used by the hero app feed). */
  async recentDeliveries(courierId: string, limit = 10) {
    return this.db
      .select({ id: orders.id, trackingNumber: orders.trackingNumber, deliveredAt: orders.deliveredAt, promisedBy: orders.promisedBy })
      .from(orders)
      .where(and(eq(orders.courierId, courierId), eq(orders.status, 'DELIVERED')))
      .orderBy(desc(orders.deliveredAt))
      .limit(limit);
  }

  logError(context: string, err: unknown) {
    this.log.error(`${context}: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
  }
}
