import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomInt } from 'node:crypto';
import { and, asc, count, desc, eq, gte, inArray, isNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { levelForXp, normalizeEgyptPhone, type CourierStatus, type EmploymentType } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import {
  courierDocuments, courierZones, couriers, deliveryAttempts, hubs, ledgerAccounts, ledgerEntries, ledgerTransactions,
  orders, refreshTokens, shifts, users, zones,
} from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { SequenceService } from '../../core/sequence.service';
import { CoreEvents, DomainEvents, type UserInvitedEvent } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { paginate, offsetOf } from '../../common/pagination';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday, groupBy, likeEscape, loadByIds } from '../../db/helpers';
import { hashPassword } from '../auth/auth.service';
import { AuthGuard } from '../auth/auth.guard';
import { describeRef } from '../../core/ledger/accounts';
import { cairoDayStart, cashWarning, DAY_MS, HERO_ACTIVE_ORDER_STATUSES, percent, toNumber } from './workforce.util';
import { ageOn, MIN_HERO_AGE, parseEgyptNationalId } from './national-id';
import type { CreateCourierDto, ListCouriersQuery, UpdateCourierDto, ZoneAssignmentDto } from './dto/couriers.dto';

type CourierRow = typeof couriers.$inferSelect;

/** Default pay & limits by employment type (piasters). */
export const EMPLOYMENT_DEFAULTS: Record<EmploymentType, { perDelivery: number; perPickup: number; failedAttempt: number; hourly: number; salary: number; cashLimit: number }> = {
  FREELANCE: { perDelivery: 2200, perPickup: 500, failedAttempt: 700, hourly: 0, salary: 0, cashLimit: 600_000 },
  SHIFT: { perDelivery: 500, perPickup: 0, failedAttempt: 0, hourly: 4500, salary: 0, cashLimit: 600_000 },
  FULL_TIME: { perDelivery: 300, perPickup: 0, failedAttempt: 0, hourly: 0, salary: 900_000, cashLimit: 1_500_000 },
};

/** Documents a hero normally needs before going on the road. */
export const REQUIRED_DOCUMENTS = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'PERSONAL_PHOTO'] as const;
const MOTORISED = new Set(['MOTORCYCLE', 'SCOOTER', 'CAR', 'VAN']);

export interface CourierStatusChangedEvent {
  courierId: string;
  from: CourierStatus;
  to: CourierStatus;
  reason: string | null;
}

export interface CourierAvailabilityEvent {
  courierId: string;
  availability: string;
  at: Date;
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';

/** Random temporary password that satisfies PASSWORD_RULE (letters + digits, ≥ 8). */
export function temporaryPassword(): string {
  let out = '';
  for (let i = 0; i < 5; i++) out += LETTERS[randomInt(LETTERS.length)];
  for (let i = 0; i < 4; i++) out += DIGITS[randomInt(DIGITS.length)];
  return out;
}

@Injectable()
export class CouriersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly events: EventEmitter2,
    private readonly authGuard: AuthGuard,
  ) {}

  // ------------------------------------------------------------- onboarding

  async onboard(dto: CreateCourierDto, principal: Principal, meta: RequestMetaInfo) {
    const phone = this.phoneOrThrow(dto.phone);
    const email = dto.email?.trim().toLowerCase() || null;
    const type = dto.employmentType;
    const defaults = EMPLOYMENT_DEFAULTS[type];
    const nid = dto.nationalId ? this.validateNationalId(dto.nationalId, dto.dateOfBirth) : null;
    const hourly = dto.hourlyRateCents ?? defaults.hourly;
    if (type === 'SHIFT' && hourly <= 0) throw new DomainError('HOURLY_RATE_REQUIRED', 'SHIFT heroes need an hourly rate', HttpStatus.BAD_REQUEST);
    if (dto.homeHubId) await this.assertHub(dto.homeHubId);
    const zoneRows = await this.normaliseZones(dto.zones);
    await this.assertUnique({ phone, email, nationalId: dto.nationalId ?? null });

    const tempPassword = temporaryPassword();
    const passwordHash = await hashPassword(tempPassword);
    const status: CourierStatus = dto.activate ? 'ACTIVE' : 'PENDING_ONBOARDING';

    const { courierId, userId, code } = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ name: dto.name.trim(), phone, email, role: 'COURIER', status: 'ACTIVE', locale: dto.locale ?? 'ar', passwordHash })
        .$returningId();
      const code = await this.nextCourierCode(tx);
      const [c] = await tx
        .insert(couriers)
        .values({
          userId: u.id,
          code,
          employmentType: type,
          status,
          availability: 'OFFLINE',
          nationalId: dto.nationalId ?? null,
          dateOfBirth: nid?.dateOfBirth ?? dto.dateOfBirth ?? null,
          vehicleType: dto.vehicleType ?? 'MOTORCYCLE',
          vehiclePlate: dto.vehiclePlate ?? null,
          licenseNumber: dto.licenseNumber ?? null,
          licenseExpiry: dto.licenseExpiry ?? null,
          homeHubId: dto.homeHubId ?? null,
          perDeliveryRateCents: dto.perDeliveryRateCents ?? defaults.perDelivery,
          perPickupRateCents: dto.perPickupRateCents ?? defaults.perPickup,
          failedAttemptRateCents: dto.failedAttemptRateCents ?? defaults.failedAttempt,
          hourlyRateCents: hourly,
          monthlySalaryCents: dto.monthlySalaryCents ?? defaults.salary,
          cashLimitCents: dto.cashLimitCents ?? defaults.cashLimit,
          maxActiveOrders: dto.maxActiveOrders ?? 30,
          walletPhone: dto.walletPhone ? this.phoneOrThrow(dto.walletPhone, 'walletPhone') : phone,
          bankDetails: dto.bankDetails ?? null,
          emergencyContact: dto.emergencyContact ? this.emergencyContact(dto.emergencyContact) : null,
        })
        .$returningId();
      if (zoneRows.length) await tx.insert(courierZones).values(zoneRows.map((z) => ({ courierId: c.id, zoneId: z.zoneId, isPrimary: z.isPrimary })));
      await this.audit.record(principal, { action: 'courier.onboard', entity: 'Courier', entityId: c.id, after: { code, name: dto.name, phone, employmentType: type, status } }, meta, tx);
      return { courierId: c.id, userId: u.id, code };
    });

    this.events.emit(CoreEvents.UserInvited, {
      userId, phone, email, name: dto.name.trim(), temporaryPassword: tempPassword,
    } satisfies UserInvitedEvent);
    return { ...(await this.detail(courierId)), code, temporaryPassword: tempPassword };
  }

  /** HR-00011…: the sequence is lifted above any code already present (seeded heroes). */
  private async nextCourierCode(tx: DbOrTx): Promise<string> {
    const [row] = await tx
      .select({ maxN: sql<number>`coalesce(max(cast(substring(${couriers.code}, 4) as unsigned)), 0)`.mapWith(Number) })
      .from(couriers)
      .where(like(couriers.code, 'HR-%'));
    const maxN = row?.maxN ?? 0;
    await tx.execute(sql`insert into sequences (\`key\`, \`value\`) values ('courier', ${maxN}) on duplicate key update \`value\` = greatest(\`value\`, ${maxN})`);
    return this.sequences.code('HR', 'courier', 5, tx);
  }

  private validateNationalId(nationalId: string, dateOfBirth?: string) {
    const info = parseEgyptNationalId(nationalId);
    if (!info) throw new DomainError('INVALID_NATIONAL_ID', 'National ID must be a valid 14-digit Egyptian ID', HttpStatus.BAD_REQUEST);
    if (dateOfBirth && dateOfBirth !== info.dateOfBirth) {
      throw new DomainError('NATIONAL_ID_MISMATCH', 'Date of birth does not match the national ID', HttpStatus.BAD_REQUEST);
    }
    if (ageOn(info.dateOfBirth) < MIN_HERO_AGE) throw new DomainError('HERO_UNDERAGE', `Heroes must be at least ${MIN_HERO_AGE} years old`, HttpStatus.BAD_REQUEST);
    return info;
  }

  private phoneOrThrow(raw: string, field = 'phone'): string {
    const phone = normalizeEgyptPhone(raw);
    if (!phone) throw new DomainError('INVALID_PHONE', `${field}: enter a valid Egyptian mobile number`, HttpStatus.BAD_REQUEST);
    return phone;
  }

  private emergencyContact(c: { name: string; phone: string; relation?: string }) {
    return { name: c.name.trim(), phone: this.phoneOrThrow(c.phone, 'emergencyContact.phone'), ...(c.relation ? { relation: c.relation } : {}) };
  }

  private async assertHub(hubId: string) {
    const [h] = await this.db.select({ id: hubs.id }).from(hubs).where(eq(hubs.id, hubId)).limit(1);
    if (!h) throw new DomainError('INVALID_HUB', 'Hub not found', HttpStatus.BAD_REQUEST);
  }

  private async normaliseZones(list?: ZoneAssignmentDto[]) {
    if (!list?.length) return [];
    const ids = [...new Set(list.map((z) => z.zoneId))];
    if (ids.length !== list.length) throw new DomainError('DUPLICATE_ZONE', 'A zone is listed twice', HttpStatus.BAD_REQUEST);
    const found = await this.db.select({ id: zones.id }).from(zones).where(inArray(zones.id, ids));
    if (found.length !== ids.length) throw new DomainError('INVALID_ZONE', 'One or more zones do not exist', HttpStatus.BAD_REQUEST);
    const primaries = list.filter((z) => z.isPrimary).length;
    if (primaries > 1) throw new DomainError('MULTIPLE_PRIMARY_ZONES', 'Only one zone can be primary', HttpStatus.BAD_REQUEST);
    return list.map((z, i) => ({ zoneId: z.zoneId, isPrimary: primaries ? !!z.isPrimary : i === 0 }));
  }

  private async assertUnique(v: { phone?: string | null; email?: string | null; nationalId?: string | null }, exceptUserId?: string, exceptCourierId?: string) {
    if (v.phone) {
      const [u] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.phone, v.phone), exceptUserId ? ne(users.id, exceptUserId) : undefined)).limit(1);
      if (u) throw new DomainError('PHONE_TAKEN', 'This phone number is already registered', HttpStatus.CONFLICT);
    }
    if (v.email) {
      const [u] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.email, v.email), exceptUserId ? ne(users.id, exceptUserId) : undefined)).limit(1);
      if (u) throw new DomainError('EMAIL_TAKEN', 'This email is already registered', HttpStatus.CONFLICT);
    }
    if (v.nationalId) {
      const [c] = await this.db
        .select({ id: couriers.id })
        .from(couriers)
        .where(and(eq(couriers.nationalId, v.nationalId), exceptCourierId ? ne(couriers.id, exceptCourierId) : undefined))
        .limit(1);
      if (c) throw new DomainError('NATIONAL_ID_TAKEN', 'A hero with this national ID already exists', HttpStatus.CONFLICT);
    }
  }

  // ------------------------------------------------------------------ list

  async list(q: ListCouriersQuery) {
    const conds: Array<SQL | undefined> = [
      q.status ? eq(couriers.status, q.status) : undefined,
      q.availability ? eq(couriers.availability, q.availability) : undefined,
      q.employmentType ? eq(couriers.employmentType, q.employmentType) : undefined,
      q.hubId ? eq(couriers.homeHubId, q.hubId) : undefined,
      q.zoneId ? sql`exists (select 1 from ${courierZones} where ${courierZones.courierId} = ${couriers.id} and ${courierZones.zoneId} = ${q.zoneId})` : undefined,
    ];
    if (q.q?.trim()) {
      const term = `%${likeEscape(q.q.trim())}%`;
      const phone = normalizeEgyptPhone(q.q);
      conds.push(or(like(users.name, term), like(couriers.code, term), like(users.phone, phone ? `%${likeEscape(phone)}%` : term)));
    }
    const where = and(...conds.filter(Boolean));
    const dir = q.order === 'asc' ? asc : desc;
    const sortCol = {
      code: couriers.code, name: users.name, xp: couriers.xp, rating: couriers.rating, cashOnHand: couriers.cashOnHandCents,
      lastSeenAt: couriers.lastSeenAt, joinedAt: couriers.joinedAt,
    }[q.sort ?? 'code'];
    const orderBy = q.sort ? dir(sortCol) : asc(couriers.code);

    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({
          id: couriers.id, code: couriers.code, name: users.name, phone: users.phone, avatarUrl: users.avatarUrl,
          employmentType: couriers.employmentType, status: couriers.status, availability: couriers.availability,
          vehicleType: couriers.vehicleType, homeHubId: couriers.homeHubId, rating: couriers.rating, ratingCount: couriers.ratingCount,
          xp: couriers.xp, streakDays: couriers.streakDays, cashOnHandCents: couriers.cashOnHandCents, cashLimitCents: couriers.cashLimitCents,
          lastSeenAt: couriers.lastSeenAt, lastLat: couriers.lastLat, lastLng: couriers.lastLng, joinedAt: couriers.joinedAt,
        })
        .from(couriers)
        .innerJoin(users, eq(users.id, couriers.userId))
        .where(where)
        .orderBy(orderBy, asc(couriers.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(where),
    ]);
    const ids = rows.map((r) => r.id);
    const [zoneMap, activeMap, hubMap] = await Promise.all([this.zonesFor(ids), this.activeOrderCounts(ids), loadByIds(this.db, hubs, hubs.id, rows.map((r) => r.homeHubId))]);
    const data = rows.map((r) => {
      const hub = r.homeHubId ? hubMap.get(r.homeHubId) : null;
      return {
        ...r,
        hub: hub ? { id: hub.id, code: hub.code, name: hub.name } : null,
        level: levelForXp(r.xp).level,
        cashUsedPct: percent(r.cashOnHandCents, r.cashLimitCents),
        cashWarning: cashWarning(r.cashOnHandCents, r.cashLimitCents),
        activeOrders: activeMap.get(r.id) ?? 0,
        zones: zoneMap.get(r.id) ?? [],
      };
    });
    return paginate(data, Number(n), q);
  }

  async zonesFor(courierIds: string[]) {
    if (!courierIds.length) return new Map<string, Array<{ zoneId: string; code: string; nameEn: string; nameAr: string; isPrimary: boolean }>>();
    const rows = await this.db
      .select({ courierId: courierZones.courierId, zoneId: zones.id, code: zones.code, nameEn: zones.nameEn, nameAr: zones.nameAr, isPrimary: courierZones.isPrimary })
      .from(courierZones)
      .innerJoin(zones, eq(zones.id, courierZones.zoneId))
      .where(inArray(courierZones.courierId, courierIds))
      .orderBy(desc(courierZones.isPrimary), asc(zones.code));
    const grouped = groupBy(rows, (r) => r.courierId);
    return new Map([...grouped].map(([k, v]) => [k, v.map(({ courierId: _c, ...z }) => z)]));
  }

  async activeOrderCounts(courierIds: string[]): Promise<Map<string, number>> {
    if (!courierIds.length) return new Map();
    const rows = await this.db
      .select({ courierId: orders.courierId, n: count() })
      .from(orders)
      .where(and(inArray(orders.courierId, courierIds), inArray(orders.status, HERO_ACTIVE_ORDER_STATUSES)))
      .groupBy(orders.courierId);
    return new Map(rows.map((r) => [r.courierId!, Number(r.n)]));
  }

  // ---------------------------------------------------------------- detail

  async getRow(id: string, tx: DbOrTx = this.db): Promise<CourierRow> {
    const [c] = await tx.select().from(couriers).where(eq(couriers.id, id)).limit(1);
    if (!c) throw notFound('Hero', id);
    return c;
  }

  async detail(id: string) {
    const [row] = await this.db
      .select({ courier: couriers, user: { name: users.name, phone: users.phone, email: users.email, locale: users.locale, avatarUrl: users.avatarUrl, status: users.status, lastLoginAt: users.lastLoginAt } })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(eq(couriers.id, id))
      .limit(1);
    if (!row) throw notFound('Hero', id);
    const c = row.courier;
    const [zoneMap, activeMap, hub, docs, payable, kpis] = await Promise.all([
      this.zonesFor([id]),
      this.activeOrderCounts([id]),
      c.homeHubId ? this.db.select({ id: hubs.id, code: hubs.code, name: hubs.name, lat: hubs.lat, lng: hubs.lng }).from(hubs).where(eq(hubs.id, c.homeHubId)).limit(1) : Promise.resolve([]),
      this.db.select({ status: courierDocuments.status, type: courierDocuments.type, expiresAt: courierDocuments.expiresAt }).from(courierDocuments).where(eq(courierDocuments.courierId, id)),
      this.accountBalance(describeRef({ courierPayable: id }).code),
      this.kpis(id),
    ]);
    const soon = Date.now() + 30 * DAY_MS;
    const lvl = levelForXp(c.xp);
    return {
      id: c.id,
      code: c.code,
      userId: c.userId,
      name: row.user.name,
      phone: row.user.phone,
      email: row.user.email,
      locale: row.user.locale,
      avatarUrl: row.user.avatarUrl,
      userStatus: row.user.status,
      lastLoginAt: row.user.lastLoginAt,
      employmentType: c.employmentType,
      status: c.status,
      availability: c.availability,
      nationalId: c.nationalId,
      dateOfBirth: c.dateOfBirth,
      vehicleType: c.vehicleType,
      vehiclePlate: c.vehiclePlate,
      licenseNumber: c.licenseNumber,
      licenseExpiry: c.licenseExpiry,
      homeHub: hub[0] ?? null,
      zones: zoneMap.get(id) ?? [],
      rates: {
        perDeliveryRateCents: c.perDeliveryRateCents, perPickupRateCents: c.perPickupRateCents, failedAttemptRateCents: c.failedAttemptRateCents,
        hourlyRateCents: c.hourlyRateCents, monthlySalaryCents: c.monthlySalaryCents,
      },
      cash: {
        onHandCents: c.cashOnHandCents, limitCents: c.cashLimitCents, availableCents: Math.max(0, c.cashLimitCents - c.cashOnHandCents),
        usedPct: percent(c.cashOnHandCents, c.cashLimitCents), warning: cashWarning(c.cashOnHandCents, c.cashLimitCents),
      },
      payableCents: payable,
      maxActiveOrders: c.maxActiveOrders,
      activeOrders: activeMap.get(id) ?? 0,
      rating: c.rating,
      ratingCount: c.ratingCount,
      xp: c.xp,
      level: { level: lvl.level, en: lvl.en, ar: lvl.ar, emoji: lvl.emoji, progress: lvl.progress, next: lvl.next },
      streakDays: c.streakDays,
      lastLat: c.lastLat,
      lastLng: c.lastLng,
      lastSeenAt: c.lastSeenAt,
      walletPhone: c.walletPhone,
      bankDetails: c.bankDetails,
      emergencyContact: c.emergencyContact,
      documents: {
        total: docs.length,
        pending: docs.filter((d) => d.status === 'PENDING').length,
        approved: docs.filter((d) => d.status === 'APPROVED').length,
        rejected: docs.filter((d) => d.status === 'REJECTED').length,
        expiringSoon: docs.filter((d) => d.status !== 'REJECTED' && d.expiresAt && d.expiresAt.getTime() <= soon).length,
        missingRequired: this.missingDocuments(c, docs),
      },
      kpis,
      joinedAt: c.joinedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private missingDocuments(c: CourierRow, docs: Array<{ status: string; type: string }>) {
    const required: string[] = [...REQUIRED_DOCUMENTS];
    if (MOTORISED.has(c.vehicleType)) required.push('DRIVING_LICENSE');
    const approved = new Set(docs.filter((d) => d.status === 'APPROVED').map((d) => d.type));
    return required.filter((t) => !approved.has(t));
  }

  async accountBalance(code: string): Promise<number> {
    const [row] = await this.db.select({ b: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, code)).limit(1);
    return row?.b ?? 0;
  }

  /** Delivery KPIs for today (Cairo), the last 7 days and the last 30 days. */
  async kpis(courierId: string, now = new Date()) {
    const windows = { today: cairoDayStart(cairoToday(now)), last7d: new Date(now.getTime() - 7 * DAY_MS), last30d: new Date(now.getTime() - 30 * DAY_MS) };
    const since = windows.last30d < windows.today ? windows.last30d : windows.today;
    const del = (from: Date) => sql<number>`coalesce(sum(case when ${orders.deliveredAt} >= ${from} then 1 else 0 end), 0)`.mapWith(Number);
    const cod = (from: Date) => sql<number>`coalesce(sum(case when ${orders.deliveredAt} >= ${from} then ${orders.collectedCents} else 0 end), 0)`.mapWith(Number);
    const avg = (from: Date) =>
      sql<number | null>`avg(case when ${orders.deliveredAt} >= ${from} and ${orders.outForDeliveryAt} is not null then timestampdiff(SECOND, ${orders.outForDeliveryAt}, ${orders.deliveredAt}) / 60 end)`;
    const fail = (from: Date) => sql<number>`coalesce(sum(case when ${deliveryAttempts.createdAt} >= ${from} then 1 else 0 end), 0)`.mapWith(Number);
    const earn = (from: Date) => sql<number>`coalesce(sum(case when ${ledgerEntries.createdAt} >= ${from} then ${ledgerEntries.creditCents} - ${ledgerEntries.debitCents} else 0 end), 0)`.mapWith(Number);

    const payableCode = describeRef({ courierPayable: courierId }).code;
    const [[d], [f], [e]] = await Promise.all([
      this.db
        .select({
          t: del(windows.today), w: del(windows.last7d), m: del(windows.last30d),
          ct: cod(windows.today), cw: cod(windows.last7d), cm: cod(windows.last30d),
          at: avg(windows.today), aw: avg(windows.last7d), am: avg(windows.last30d),
        })
        .from(orders)
        .where(and(eq(orders.courierId, courierId), eq(orders.status, 'DELIVERED'), gte(orders.deliveredAt, since))),
      this.db
        .select({ t: fail(windows.today), w: fail(windows.last7d), m: fail(windows.last30d) })
        .from(deliveryAttempts)
        .where(and(eq(deliveryAttempts.courierId, courierId), eq(deliveryAttempts.success, false), gte(deliveryAttempts.createdAt, since))),
      this.db
        .select({ t: earn(windows.today), w: earn(windows.last7d), m: earn(windows.last30d) })
        .from(ledgerEntries)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
        .where(and(eq(ledgerAccounts.code, payableCode), eq(ledgerTransactions.kind, 'COURIER_EARNING'), gte(ledgerEntries.createdAt, since))),
    ]);
    const block = (deliveries: number, failed: number, avgMin: unknown, codCents: number, earnings: number) => ({
      deliveries,
      failedAttempts: failed,
      successRate: percent(deliveries, deliveries + failed),
      avgDeliveryMinutes: avgMin === null || avgMin === undefined ? null : Math.round(Number(avgMin)),
      codCollectedCents: codCents,
      earningsCents: earnings,
    });
    return {
      today: block(toNumber(d?.t), toNumber(f?.t), d?.at, toNumber(d?.ct), toNumber(e?.t)),
      last7d: block(toNumber(d?.w), toNumber(f?.w), d?.aw, toNumber(d?.cw), toNumber(e?.w)),
      last30d: block(toNumber(d?.m), toNumber(f?.m), d?.am, toNumber(d?.cm), toNumber(e?.m)),
    };
  }

  // ---------------------------------------------------------------- update

  async update(id: string, dto: UpdateCourierDto, principal: Principal, meta: RequestMetaInfo) {
    const before = await this.getRow(id);
    if (before.status === 'OFFBOARDED') throw new DomainError('COURIER_OFFBOARDED', 'An offboarded hero cannot be edited', HttpStatus.CONFLICT);
    const [user] = await this.db.select().from(users).where(eq(users.id, before.userId)).limit(1);
    const phone = dto.phone !== undefined ? this.phoneOrThrow(dto.phone) : undefined;
    const email = dto.email !== undefined ? dto.email.trim().toLowerCase() || null : undefined;
    const type = dto.employmentType ?? before.employmentType;
    const hourly = dto.hourlyRateCents ?? before.hourlyRateCents;
    if (type === 'SHIFT' && hourly <= 0) throw new DomainError('HOURLY_RATE_REQUIRED', 'SHIFT heroes need an hourly rate', HttpStatus.BAD_REQUEST);
    let dob = dto.dateOfBirth;
    if (dto.nationalId !== undefined && dto.nationalId !== before.nationalId) dob = this.validateNationalId(dto.nationalId, dto.dateOfBirth).dateOfBirth;
    if (dto.homeHubId) await this.assertHub(dto.homeHubId);
    const zoneRows = dto.zones ? await this.normaliseZones(dto.zones) : null;
    await this.assertUnique({ phone: phone !== user.phone ? phone : null, email: email !== user.email ? email : null, nationalId: dto.nationalId ?? null }, user.id, id);

    const courierPatch: Partial<typeof couriers.$inferInsert> = {
      employmentType: dto.employmentType,
      nationalId: dto.nationalId,
      dateOfBirth: dob,
      vehicleType: dto.vehicleType,
      vehiclePlate: dto.vehiclePlate,
      licenseNumber: dto.licenseNumber,
      licenseExpiry: dto.licenseExpiry,
      homeHubId: dto.homeHubId,
      perDeliveryRateCents: dto.perDeliveryRateCents,
      perPickupRateCents: dto.perPickupRateCents,
      failedAttemptRateCents: dto.failedAttemptRateCents,
      hourlyRateCents: dto.hourlyRateCents,
      monthlySalaryCents: dto.monthlySalaryCents,
      cashLimitCents: dto.cashLimitCents,
      maxActiveOrders: dto.maxActiveOrders,
      walletPhone: dto.walletPhone !== undefined ? this.phoneOrThrow(dto.walletPhone, 'walletPhone') : undefined,
      bankDetails: dto.bankDetails,
      emergencyContact: dto.emergencyContact ? this.emergencyContact(dto.emergencyContact) : undefined,
    };
    const cleanCourier = Object.fromEntries(Object.entries(courierPatch).filter(([, v]) => v !== undefined));
    const userPatch = Object.fromEntries(Object.entries({ name: dto.name?.trim(), phone, email, locale: dto.locale }).filter(([, v]) => v !== undefined));

    await this.db.transaction(async (tx) => {
      if (Object.keys(cleanCourier).length) await tx.update(couriers).set(cleanCourier).where(eq(couriers.id, id));
      if (Object.keys(userPatch).length) await tx.update(users).set(userPatch).where(eq(users.id, before.userId));
      if (zoneRows) {
        await tx.delete(courierZones).where(eq(courierZones.courierId, id));
        if (zoneRows.length) await tx.insert(courierZones).values(zoneRows.map((z) => ({ courierId: id, zoneId: z.zoneId, isPrimary: z.isPrimary })));
      }
      await this.audit.record(
        principal,
        { action: 'courier.update', entity: 'Courier', entityId: id, before: { ...pick(before, Object.keys(cleanCourier)), ...pick(user, Object.keys(userPatch)) }, after: { ...cleanCourier, ...userPatch, ...(zoneRows ? { zones: zoneRows } : {}) } },
        meta,
        tx,
      );
    });
    this.authGuard.invalidate(before.userId);
    return this.detail(id);
  }

  // --------------------------------------------------------- status actions

  async changeStatus(id: string, action: 'activate' | 'suspend' | 'offboard', reason: string | null, principal: Principal, meta: RequestMetaInfo) {
    const to: CourierStatus = action === 'activate' ? 'ACTIVE' : action === 'suspend' ? 'SUSPENDED' : 'OFFBOARDED';
    const allowed: Record<typeof action, CourierStatus[]> = {
      activate: ['PENDING_ONBOARDING', 'SUSPENDED'],
      suspend: ['ACTIVE', 'PENDING_ONBOARDING'],
      offboard: ['ACTIVE', 'PENDING_ONBOARDING', 'SUSPENDED'],
    };
    const result = await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(couriers).where(eq(couriers.id, id)).for('update');
      if (!c) throw notFound('Hero', id);
      if (!allowed[action].includes(c.status)) {
        throw new DomainError('INVALID_TRANSITION', `Cannot ${action} a hero who is ${c.status}`, HttpStatus.CONFLICT, { from: c.status, to });
      }
      let cancelledShifts = 0;
      if (action === 'offboard') {
        if (c.cashOnHandCents > 0) {
          throw new DomainError('CASH_OUTSTANDING', 'The hero still holds cash. Confirm a handover or record a shortage before offboarding.', HttpStatus.CONFLICT, { cashOnHandCents: c.cashOnHandCents });
        }
        const [active] = await tx.select({ n: count() }).from(orders).where(and(eq(orders.courierId, id), inArray(orders.status, HERO_ACTIVE_ORDER_STATUSES)));
        if (Number(active?.n ?? 0) > 0) throw new DomainError('ORDERS_OUTSTANDING', 'Reassign the hero’s active orders before offboarding', HttpStatus.CONFLICT);
      }
      await tx.update(couriers).set({ status: to, ...(to === 'ACTIVE' ? {} : { availability: 'OFFLINE' as const }) }).where(eq(couriers.id, id));
      if (to !== 'ACTIVE') {
        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, c.userId), isNull(refreshTokens.revokedAt)));
        const [res] = (await tx
          .update(shifts)
          .set({ status: 'CANCELLED', notes: sql`concat(coalesce(${shifts.notes}, ''), ${` [hero ${to.toLowerCase()}]`})` })
          .where(and(eq(shifts.courierId, id), inArray(shifts.status, ['SCHEDULED', 'CONFIRMED']), gte(shifts.startAt, new Date())))) as unknown as [{ affectedRows: number }];
        cancelledShifts = res.affectedRows;
      }
      await this.audit.record(principal, { action: `courier.${action}`, entity: 'Courier', entityId: id, before: { status: c.status }, after: { status: to, reason, cancelledShifts } }, meta, tx);
      return { from: c.status, userId: c.userId, cancelledShifts, courier: c };
    });
    this.authGuard.invalidate(result.userId);
    this.events.emit('courier.status_changed', { courierId: id, from: result.from, to, reason } satisfies CourierStatusChangedEvent);
    if (to !== 'ACTIVE') this.events.emit(DomainEvents.CourierAvailability, { courierId: id, availability: 'OFFLINE', at: new Date() } satisfies CourierAvailabilityEvent);
    const detail = await this.detail(id);
    return { ...detail, cancelledShifts: result.cancelledShifts, warnings: to === 'ACTIVE' ? detail.documents.missingRequired.map((t) => `MISSING_DOCUMENT:${t}`) : [] };
  }
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, (obj as Record<string, unknown>)[k]])) as Partial<T>;
}
