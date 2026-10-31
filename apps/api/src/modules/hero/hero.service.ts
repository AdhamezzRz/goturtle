import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { couriers } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { DomainEvents } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { CouriersService, type CourierAvailabilityEvent } from '../couriers/couriers.service';
import { CashService } from '../cash/cash.service';
import { ShiftsService } from '../shifts/shifts.service';
import { GamificationService } from '../gamification/gamification.service';
import { HeroLedgerService } from '../finance/hero-ledger.service';
import { resolveDayRange } from '../couriers/workforce.util';

/** Courier self-service read models and the availability rule. */
@Injectable()
export class HeroService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventEmitter2,
    private readonly couriers: CouriersService,
    private readonly cash: CashService,
    private readonly shifts: ShiftsService,
    private readonly gamification: GamificationService,
    private readonly heroLedger: HeroLedgerService,
  ) {}

  /**
   * Availability: only ACTIVE heroes; SHIFT heroes may go ONLINE only during a
   * shift that is IN_PROGRESS or booked to start within 15 minutes.
   */
  async setAvailability(courierId: string, availability: 'ONLINE' | 'OFFLINE' | 'ON_BREAK') {
    const [c] = await this.db.select().from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!c) throw notFound('Hero', courierId);
    if (c.status !== 'ACTIVE') throw new DomainError('COURIER_NOT_ACTIVE', 'Your account is not active yet. Contact your hub.', HttpStatus.FORBIDDEN);
    let shift = null;
    if (availability === 'ONLINE' && c.employmentType === 'SHIFT') {
      shift = await this.shifts.activeShiftFor(courierId);
      if (!shift) throw new DomainError('NO_ACTIVE_SHIFT', 'You can go online only during your booked shift (or 15 minutes before it starts)', HttpStatus.CONFLICT);
    }
    const now = new Date();
    if (c.availability !== availability) {
      await this.db.update(couriers).set({ availability, lastSeenAt: now }).where(eq(couriers.id, courierId));
      this.events.emit(DomainEvents.CourierAvailability, { courierId, availability, at: now } satisfies CourierAvailabilityEvent);
    }
    return { courierId, availability, previous: c.availability, shiftId: shift?.id ?? null, at: now };
  }

  async dashboard(courierId: string) {
    const [profile, wallet, shifts, achievements, payable] = await Promise.all([
      this.couriers.detail(courierId),
      this.cash.wallet(courierId),
      this.shifts.currentAndNext(courierId),
      this.gamification.achievements(courierId),
      this.heroLedger.balance(courierId),
    ]);
    const today = profile.kpis.today;
    return {
      hero: { id: profile.id, code: profile.code, name: profile.name, avatarUrl: profile.avatarUrl, employmentType: profile.employmentType, status: profile.status, availability: profile.availability, rating: profile.rating },
      today: {
        deliveries: today.deliveries,
        failedAttempts: today.failedAttempts,
        successRate: today.successRate,
        earningsCents: today.earningsCents,
        codCollectedCents: today.codCollectedCents,
        activeOrders: profile.activeOrders,
      },
      cash: {
        onHandCents: wallet.cashOnHandCents,
        limitCents: wallet.cashLimitCents,
        usedPct: wallet.usedPct,
        warning: wallet.warning,
        pendingDeclaredCents: wallet.pendingDeclaredCents,
        unhandedOrders: wallet.unhandedOrders,
        oldestUnhandedHours: wallet.oldestUnhandedHours,
      },
      payableCents: payable,
      gamification: {
        xp: achievements?.xp ?? profile.xp,
        level: achievements?.level ?? null,
        streakDays: achievements?.streakDays ?? 0,
        badgesEarned: achievements?.badgesEarned ?? 0,
        badges: (achievements?.badges ?? []).filter((b) => b.earned).map((b) => ({ key: b.key, en: b.en, ar: b.ar })),
      },
      shifts,
    };
  }

  async earnings(courierId: string, q: { from?: string; to?: string; page: number; pageSize: number }) {
    const range = resolveDayRange(q.from, q.to, 30, 366);
    const [totals, page, balance] = await Promise.all([
      this.heroLedger.totals(courierId, range.start, range.end),
      this.heroLedger.lines(courierId, range.start, range.end, { limit: q.pageSize, offset: (q.page - 1) * q.pageSize }),
      this.heroLedger.balance(courierId),
    ]);
    const earned = Object.entries(totals)
      .filter(([k]) => k !== 'payout')
      .reduce((s, [, v]) => s + v.netCents, 0);
    return {
      from: range.from,
      to: range.to,
      payableCents: balance,
      totals: { byCategory: totals, earnedCents: earned, paidOutCents: -totals.payout.netCents },
      data: page.lines,
      meta: { page: q.page, pageSize: q.pageSize, total: page.total, totalPages: Math.max(1, Math.ceil(page.total / q.pageSize)) },
    };
  }
}
