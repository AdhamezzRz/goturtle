import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, type SQL } from 'drizzle-orm';
import { haversineKm, type ShiftStatus } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { couriers, hubs, shiftTemplates, shifts, users, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { JobsService } from '../../core/jobs.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { DomainEvents } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday, loadByIds } from '../../db/helpers';
import { addDays, assertDay, dayDiff, daysBetween, MINUTE_MS, resolveDayRange, weekdayOf, weekStartOf } from '../couriers/workforce.util';
import type { CourierAvailabilityEvent } from '../couriers/couriers.service';
import {
  AUTO_CLOCK_OUT_AFTER_MINUTES, computeAttendance, EARLY_CLOCK_IN_MINUTES, GEOFENCE_RADIUS_KM, lateMinutes, MAX_SHIFT_MINUTES,
  MISSED_AFTER_MINUTES, ONLINE_BEFORE_SHIFT_MINUTES, scheduledMinutes, shiftBounds,
} from './attendance';
import type {
  CoverageQuery, CreateShiftDto, CreateShiftTemplateDto, GenerateShiftsDto, ListShiftsQuery, UpdateShiftDto, UpdateShiftTemplateDto,
} from './dto/shifts.dto';

type ShiftRow = typeof shifts.$inferSelect;
type TemplateRow = typeof shiftTemplates.$inferSelect;
type CourierRow = typeof couriers.$inferSelect;

/** Statuses that occupy the hero's calendar (used for overlap checks). */
const BLOCKING: ShiftStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];
const EDITABLE: ShiftStatus[] = ['SCHEDULED', 'CONFIRMED'];
export const MAX_GENERATE_DAYS = 62;

export interface ClockInput {
  at?: Date;
  lat?: number | null;
  lng?: number | null;
  note?: string | null;
}

@Injectable()
export class ShiftsService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly postings: PostingsService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.jobs.register({ name: 'shifts.attendance', everySeconds: 300, timeoutSeconds: 90, run: () => this.runAttendance() });
  }

  // -------------------------------------------------------------- templates

  async listTemplates(includeInactive = false) {
    const rows = await this.db
      .select({ t: shiftTemplates, hubName: hubs.name, hubCode: hubs.code, zoneName: zones.nameEn })
      .from(shiftTemplates)
      .leftJoin(hubs, eq(hubs.id, shiftTemplates.hubId))
      .leftJoin(zones, eq(zones.id, shiftTemplates.zoneId))
      .where(includeInactive ? undefined : eq(shiftTemplates.isActive, true))
      .orderBy(asc(shiftTemplates.startTime), asc(shiftTemplates.name));
    return rows.map((r) => this.presentTemplate(r.t, r.hubName, r.hubCode, r.zoneName));
  }

  private presentTemplate(t: TemplateRow, hubName?: string | null, hubCode?: string | null, zoneName?: string | null) {
    const overnight = t.endTime <= t.startTime;
    const [sh, sm] = t.startTime.split(':').map(Number);
    const [eh, em] = t.endTime.split(':').map(Number);
    const lengthMinutes = (eh * 60 + em - (sh * 60 + sm) + (overnight ? 1440 : 0)) % 1440 || 1440;
    return {
      ...t,
      daysOfWeek: [...t.daysOfWeek].sort((a, b) => a - b),
      overnight,
      lengthMinutes,
      paidMinutes: Math.max(0, lengthMinutes - t.breakMinutes),
      hub: t.hubId ? { id: t.hubId, name: hubName ?? null, code: hubCode ?? null } : null,
      zone: t.zoneId ? { id: t.zoneId, name: zoneName ?? null } : null,
    };
  }

  async getTemplate(id: string, tx: DbOrTx = this.db): Promise<TemplateRow> {
    const [t] = await tx.select().from(shiftTemplates).where(eq(shiftTemplates.id, id)).limit(1);
    if (!t) throw notFound('Shift template', id);
    return t;
  }

  async createTemplate(dto: CreateShiftTemplateDto, principal: Principal, meta: RequestMetaInfo) {
    this.assertTemplateTimes(dto.startTime, dto.endTime, dto.breakMinutes ?? 30);
    await this.assertPlace(dto.hubId, dto.zoneId);
    const [row] = await this.db
      .insert(shiftTemplates)
      .values({
        name: dto.name.trim(), startTime: dto.startTime, endTime: dto.endTime, daysOfWeek: [...new Set(dto.daysOfWeek)].sort(),
        hubId: dto.hubId ?? null, zoneId: dto.zoneId ?? null, requiredCouriers: dto.requiredCouriers ?? 1,
        hourlyRateCents: dto.hourlyRateCents ?? null, breakMinutes: dto.breakMinutes ?? 30, isActive: dto.isActive ?? true,
      })
      .$returningId();
    await this.audit.record(principal, { action: 'shift_template.create', entity: 'ShiftTemplate', entityId: row.id, after: dto }, meta);
    return this.presentTemplate(await this.getTemplate(row.id));
  }

  async updateTemplate(id: string, dto: UpdateShiftTemplateDto, principal: Principal, meta: RequestMetaInfo) {
    const before = await this.getTemplate(id);
    this.assertTemplateTimes(dto.startTime ?? before.startTime, dto.endTime ?? before.endTime, dto.breakMinutes ?? before.breakMinutes);
    await this.assertPlace(dto.hubId, dto.zoneId);
    const patch = Object.fromEntries(
      Object.entries({
        name: dto.name?.trim(), startTime: dto.startTime, endTime: dto.endTime,
        daysOfWeek: dto.daysOfWeek ? [...new Set(dto.daysOfWeek)].sort() : undefined, hubId: dto.hubId, zoneId: dto.zoneId,
        requiredCouriers: dto.requiredCouriers, hourlyRateCents: dto.hourlyRateCents, breakMinutes: dto.breakMinutes, isActive: dto.isActive,
      }).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(patch).length) await this.db.update(shiftTemplates).set(patch).where(eq(shiftTemplates.id, id));
    await this.audit.record(principal, { action: 'shift_template.update', entity: 'ShiftTemplate', entityId: id, before, after: patch }, meta);
    return this.presentTemplate(await this.getTemplate(id));
  }

  /** Templates are deactivated, never deleted (generated shifts keep pointing at them). */
  async deactivateTemplate(id: string, principal: Principal, meta: RequestMetaInfo) {
    await this.getTemplate(id);
    await this.db.update(shiftTemplates).set({ isActive: false }).where(eq(shiftTemplates.id, id));
    await this.audit.record(principal, { action: 'shift_template.deactivate', entity: 'ShiftTemplate', entityId: id }, meta);
    return this.presentTemplate(await this.getTemplate(id));
  }

  private assertTemplateTimes(start: string, end: string, breakMinutes: number) {
    if (start === end) throw new DomainError('INVALID_SHIFT_TIMES', 'Start and end time must differ', HttpStatus.BAD_REQUEST);
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const length = (eh * 60 + em - (sh * 60 + sm) + 1440) % 1440;
    if (length > MAX_SHIFT_MINUTES) throw new DomainError('SHIFT_TOO_LONG', 'A shift cannot be longer than 16 hours', HttpStatus.BAD_REQUEST);
    if (breakMinutes >= length) throw new DomainError('INVALID_BREAK', 'The break must be shorter than the shift', HttpStatus.BAD_REQUEST);
  }

  private async assertPlace(hubId?: string | null, zoneId?: string | null) {
    if (hubId) {
      const [h] = await this.db.select({ id: hubs.id }).from(hubs).where(eq(hubs.id, hubId)).limit(1);
      if (!h) throw new DomainError('INVALID_HUB', 'Hub not found', HttpStatus.BAD_REQUEST);
    }
    if (zoneId) {
      const [z] = await this.db.select({ id: zones.id }).from(zones).where(eq(zones.id, zoneId)).limit(1);
      if (!z) throw new DomainError('INVALID_ZONE', 'Zone not found', HttpStatus.BAD_REQUEST);
    }
  }

  // ------------------------------------------------------------- generation

  /** The hourly rate frozen on a booked shift: salaried heroes 0, else template override or hero rate. */
  frozenRate(courier: Pick<CourierRow, 'employmentType' | 'hourlyRateCents'>, override: number | null | undefined): number {
    if (courier.employmentType === 'FULL_TIME') return 0;
    return override ?? courier.hourlyRateCents;
  }

  /**
   * Creates concrete shifts for each selected hero on every template day in
   * the range (Cairo wall clock → UTC, DST-safe; overnight shifts end the next
   * day). Duplicates and overlaps are skipped and reported.
   */
  async generate(dto: GenerateShiftsDto, principal: Principal | null, meta: RequestMetaInfo | null) {
    const from = assertDay(dto.from, 'from');
    const to = assertDay(dto.to, 'to');
    if (from > to) throw new DomainError('INVALID_RANGE', '`from` must be on or before `to`', HttpStatus.BAD_REQUEST);
    if (dayDiff(from, to) + 1 > MAX_GENERATE_DAYS) throw new DomainError('RANGE_TOO_LARGE', `Generate at most ${MAX_GENERATE_DAYS} days at once`, HttpStatus.BAD_REQUEST);
    const template = await this.getTemplate(dto.templateId);
    if (!template.isActive) throw new DomainError('TEMPLATE_INACTIVE', 'This shift template is inactive', HttpStatus.CONFLICT);

    const occurrences = daysBetween(from, to)
      .filter((d) => template.daysOfWeek.includes(weekdayOf(d)))
      .map((day) => ({ day, ...shiftBounds(day, template.startTime, template.endTime) }));

    const created: string[] = [];
    const skipped: Array<{ courierId: string; date: string; reason: string }> = [];
    await this.db.transaction(async (tx) => {
      const heroes = await tx.select().from(couriers).where(inArray(couriers.id, dto.courierIds)).for('update');
      const missing = dto.courierIds.filter((id) => !heroes.some((h) => h.id === id));
      if (missing.length) throw new DomainError('INVALID_COURIER', 'Some heroes do not exist', HttpStatus.BAD_REQUEST, { courierIds: missing });
      if (!occurrences.length) return;
      const windowStart = occurrences[0].startAt;
      const windowEnd = occurrences.at(-1)!.endAt;
      const existing = await tx
        .select({ id: shifts.id, courierId: shifts.courierId, templateId: shifts.templateId, startAt: shifts.startAt, endAt: shifts.endAt })
        .from(shifts)
        .where(and(inArray(shifts.courierId, dto.courierIds), inArray(shifts.status, BLOCKING), lt(shifts.startAt, windowEnd), gt(shifts.endAt, windowStart)));
      const values: Array<typeof shifts.$inferInsert> = [];
      for (const hero of heroes) {
        if (hero.status !== 'ACTIVE' && hero.status !== 'PENDING_ONBOARDING') {
          for (const o of occurrences) skipped.push({ courierId: hero.id, date: o.day, reason: 'COURIER_NOT_ACTIVE' });
          continue;
        }
        const mine = existing.filter((e) => e.courierId === hero.id);
        for (const o of occurrences) {
          const clash = mine.find((e) => e.startAt.getTime() < o.endAt.getTime() && e.endAt.getTime() > o.startAt.getTime());
          if (clash) {
            skipped.push({ courierId: hero.id, date: o.day, reason: clash.templateId === template.id && clash.startAt.getTime() === o.startAt.getTime() ? 'DUPLICATE' : 'SHIFT_OVERLAP' });
            continue;
          }
          const row = {
            courierId: hero.id, templateId: template.id, hubId: template.hubId ?? hero.homeHubId, zoneId: template.zoneId,
            startAt: o.startAt, endAt: o.endAt, status: 'SCHEDULED' as const, breakMinutes: template.breakMinutes,
            hourlyRateCents: this.frozenRate(hero, template.hourlyRateCents),
          };
          values.push(row);
          mine.push({ id: '', courierId: hero.id, templateId: template.id, startAt: o.startAt, endAt: o.endAt });
        }
      }
      for (let i = 0; i < values.length; i += 200) {
        const ids = await tx.insert(shifts).values(values.slice(i, i + 200)).$returningId();
        created.push(...ids.map((r) => r.id));
      }
      await this.audit.record(principal, { action: 'shift.generate', entity: 'ShiftTemplate', entityId: template.id, after: { from, to, courierIds: dto.courierIds, created: created.length, skipped: skipped.length } }, meta, tx);
    });
    const rows = created.length ? await this.presentMany(await this.db.select().from(shifts).where(inArray(shifts.id, created)).orderBy(asc(shifts.startAt))) : [];
    return { created: created.length, skipped, shifts: rows };
  }

  // ------------------------------------------------------- manual booking

  private async findOverlap(tx: DbOrTx, courierId: string, startAt: Date, endAt: Date, excludeId?: string) {
    const [clash] = await tx
      .select({ id: shifts.id, startAt: shifts.startAt, endAt: shifts.endAt })
      .from(shifts)
      .where(and(eq(shifts.courierId, courierId), inArray(shifts.status, BLOCKING), lt(shifts.startAt, endAt), gt(shifts.endAt, startAt), excludeId ? ne(shifts.id, excludeId) : undefined))
      .limit(1);
    return clash ?? null;
  }

  private assertTimes(startAt: Date, endAt: Date, breakMinutes: number) {
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new DomainError('INVALID_SHIFT_TIMES', 'endAt must be after startAt', HttpStatus.BAD_REQUEST);
    }
    const length = (endAt.getTime() - startAt.getTime()) / MINUTE_MS;
    if (length > MAX_SHIFT_MINUTES) throw new DomainError('SHIFT_TOO_LONG', 'A shift cannot be longer than 16 hours', HttpStatus.BAD_REQUEST);
    if (breakMinutes >= length) throw new DomainError('INVALID_BREAK', 'The break must be shorter than the shift', HttpStatus.BAD_REQUEST);
  }

  async create(dto: CreateShiftDto, principal: Principal, meta: RequestMetaInfo) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    const template = dto.templateId ? await this.getTemplate(dto.templateId) : null;
    const breakMinutes = dto.breakMinutes ?? template?.breakMinutes ?? 30;
    this.assertTimes(startAt, endAt, breakMinutes);
    await this.assertPlace(dto.hubId, dto.zoneId);
    const id = await this.db.transaction(async (tx) => {
      const [hero] = await tx.select().from(couriers).where(eq(couriers.id, dto.courierId)).for('update');
      if (!hero) throw new DomainError('INVALID_COURIER', 'Hero not found', HttpStatus.BAD_REQUEST);
      if (hero.status === 'SUSPENDED' || hero.status === 'OFFBOARDED') throw new DomainError('COURIER_NOT_ACTIVE', `Hero is ${hero.status}`, HttpStatus.CONFLICT);
      const clash = await this.findOverlap(tx, hero.id, startAt, endAt);
      if (clash) throw new DomainError('SHIFT_OVERLAP', 'The hero already has a shift at this time', HttpStatus.CONFLICT, { shiftId: clash.id });
      const [row] = await tx
        .insert(shifts)
        .values({
          courierId: hero.id, templateId: template?.id ?? null, hubId: dto.hubId ?? template?.hubId ?? hero.homeHubId, zoneId: dto.zoneId ?? template?.zoneId ?? null,
          startAt, endAt, status: 'SCHEDULED', breakMinutes, hourlyRateCents: dto.hourlyRateCents ?? this.frozenRate(hero, template?.hourlyRateCents), notes: dto.notes ?? null,
        })
        .$returningId();
      await this.audit.record(principal, { action: 'shift.create', entity: 'Shift', entityId: row.id, after: dto }, meta, tx);
      return row.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateShiftDto, principal: Principal, meta: RequestMetaInfo) {
    await this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(shifts).where(eq(shifts.id, id)).for('update');
      if (!s) throw notFound('Shift', id);
      if (!EDITABLE.includes(s.status)) throw new DomainError('INVALID_STATE', `A ${s.status} shift cannot be edited`, HttpStatus.CONFLICT);
      const courierId = dto.courierId ?? s.courierId;
      const startAt = dto.startAt ? new Date(dto.startAt) : s.startAt;
      const endAt = dto.endAt ? new Date(dto.endAt) : s.endAt;
      const breakMinutes = dto.breakMinutes ?? s.breakMinutes;
      this.assertTimes(startAt, endAt, breakMinutes);
      await this.assertPlace(dto.hubId, dto.zoneId);
      let rate = dto.hourlyRateCents ?? s.hourlyRateCents;
      if (courierId !== s.courierId) {
        const [hero] = await tx.select().from(couriers).where(eq(couriers.id, courierId)).for('update');
        if (!hero) throw new DomainError('INVALID_COURIER', 'Hero not found', HttpStatus.BAD_REQUEST);
        if (hero.status === 'SUSPENDED' || hero.status === 'OFFBOARDED') throw new DomainError('COURIER_NOT_ACTIVE', `Hero is ${hero.status}`, HttpStatus.CONFLICT);
        if (dto.hourlyRateCents === undefined) {
          const template = s.templateId ? await this.getTemplate(s.templateId, tx) : null;
          rate = this.frozenRate(hero, template?.hourlyRateCents);
        }
      }
      const clash = await this.findOverlap(tx, courierId, startAt, endAt, id);
      if (clash) throw new DomainError('SHIFT_OVERLAP', 'The hero already has a shift at this time', HttpStatus.CONFLICT, { shiftId: clash.id });
      const patch = { courierId, startAt, endAt, breakMinutes, hourlyRateCents: rate, hubId: dto.hubId ?? s.hubId, zoneId: dto.zoneId ?? s.zoneId, notes: dto.notes ?? s.notes };
      await tx.update(shifts).set(patch).where(eq(shifts.id, id));
      await this.audit.record(principal, { action: 'shift.update', entity: 'Shift', entityId: id, before: s, after: patch }, meta, tx);
    });
    return this.get(id);
  }

  async cancel(id: string, reason: string, principal: Principal, meta: RequestMetaInfo) {
    const s = await this.getRow(id);
    if (!EDITABLE.includes(s.status)) throw new DomainError('INVALID_STATE', `A ${s.status} shift cannot be cancelled`, HttpStatus.CONFLICT);
    const [res] = (await this.db
      .update(shifts)
      .set({ status: 'CANCELLED', notes: appendNote(s.notes, `CANCELLED: ${reason}`) })
      .where(and(eq(shifts.id, id), inArray(shifts.status, EDITABLE)))) as unknown as [{ affectedRows: number }];
    if (res.affectedRows !== 1) throw new DomainError('INVALID_STATE', 'The shift changed meanwhile, reload and retry', HttpStatus.CONFLICT);
    await this.audit.record(principal, { action: 'shift.cancel', entity: 'Shift', entityId: id, before: { status: s.status }, after: { status: 'CANCELLED', reason } }, meta);
    return this.get(id);
  }

  /** The hero acknowledges a booked shift (SCHEDULED → CONFIRMED). */
  async confirm(id: string, courierId: string) {
    const s = await this.getRow(id);
    if (s.courierId !== courierId) throw notFound('Shift', id);
    if (s.status === 'CONFIRMED') return this.get(id);
    if (s.status !== 'SCHEDULED') throw new DomainError('INVALID_STATE', `A ${s.status} shift cannot be confirmed`, HttpStatus.CONFLICT);
    if (s.endAt.getTime() < Date.now()) throw new DomainError('SHIFT_ENDED', 'This shift is already over', HttpStatus.CONFLICT);
    await this.db.update(shifts).set({ status: 'CONFIRMED' }).where(and(eq(shifts.id, id), eq(shifts.status, 'SCHEDULED')));
    return this.get(id);
  }

  // --------------------------------------------------------------- reading

  async getRow(id: string, tx: DbOrTx = this.db): Promise<ShiftRow> {
    const [s] = await tx.select().from(shifts).where(eq(shifts.id, id)).limit(1);
    if (!s) throw notFound('Shift', id);
    return s;
  }

  async get(id: string) {
    const [row] = await this.presentMany([await this.getRow(id)]);
    return row;
  }

  /** Adds hero, template and hub names plus derived attendance figures. */
  async presentMany(rows: ShiftRow[]) {
    const [heroMap, templateMap, hubMap] = await Promise.all([
      this.heroNames(rows.map((r) => r.courierId)),
      loadByIds(this.db, shiftTemplates, shiftTemplates.id, rows.map((r) => r.templateId)),
      loadByIds(this.db, hubs, hubs.id, rows.map((r) => r.hubId)),
    ]);
    return rows.map((s) => {
      const scheduled = scheduledMinutes(s.startAt, s.endAt, s.breakMinutes);
      const t = s.templateId ? templateMap.get(s.templateId) : null;
      const h = s.hubId ? hubMap.get(s.hubId) : null;
      return {
        ...s,
        day: cairoToday(s.startAt),
        scheduledMinutes: scheduled,
        expectedEarningsCents: Math.round((s.hourlyRateCents * scheduled) / 60),
        earnedCents: s.status === 'COMPLETED' ? Math.round((s.hourlyRateCents * s.workedMinutes) / 60) : 0,
        geofenceWarning: !!s.notes?.includes('GEOFENCE_WARNING'),
        autoClockOut: !!s.notes?.includes('AUTO_CLOCK_OUT'),
        courier: heroMap.get(s.courierId) ?? null,
        template: t ? { id: t.id, name: t.name, startTime: t.startTime, endTime: t.endTime } : null,
        hub: h ? { id: h.id, code: h.code, name: h.name } : null,
      };
    });
  }

  private async heroNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, { id: string; code: string; name: string; employmentType: string }>();
    const rows = await this.db
      .select({ id: couriers.id, code: couriers.code, name: users.name, employmentType: couriers.employmentType })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(inArray(couriers.id, unique));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Calendar view. Defaults to the current Sunday–Saturday week. */
  async list(q: ListShiftsQuery, scope: { courierId?: string } = {}) {
    const range = calendarRange(q.from, q.to);
    const conds: Array<SQL | undefined> = [
      gte(shifts.startAt, range.start),
      lt(shifts.startAt, range.end),
      q.hubId ? eq(shifts.hubId, q.hubId) : undefined,
      q.templateId ? eq(shifts.templateId, q.templateId) : undefined,
      q.status ? eq(shifts.status, q.status) : undefined,
      scope.courierId ? eq(shifts.courierId, scope.courierId) : q.courierId ? eq(shifts.courierId, q.courierId) : undefined,
    ];
    const rows = await this.db.select().from(shifts).where(and(...conds)).orderBy(asc(shifts.startAt), asc(shifts.id)).limit(5000);
    const data = await this.presentMany(rows);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return {
      from: range.from,
      to: range.to,
      total: rows.length,
      summary: {
        byStatus,
        scheduledMinutes: data.reduce((s, r) => s + (r.status === 'CANCELLED' ? 0 : r.scheduledMinutes), 0),
        workedMinutes: data.reduce((s, r) => s + r.workedMinutes, 0),
        earnedCents: data.reduce((s, r) => s + r.earnedCents, 0),
      },
      data,
    };
  }

  /** Required vs scheduled heroes per template and Cairo day. */
  async coverage(q: CoverageQuery) {
    const range = calendarRange(q.from, q.to);
    const templates = await this.db
      .select()
      .from(shiftTemplates)
      .where(and(eq(shiftTemplates.isActive, true), q.hubId ? eq(shiftTemplates.hubId, q.hubId) : undefined))
      .orderBy(asc(shiftTemplates.startTime));
    const rows = await this.db
      .select({ templateId: shifts.templateId, startAt: shifts.startAt, status: shifts.status, hubId: shifts.hubId })
      .from(shifts)
      .where(and(gte(shifts.startAt, range.start), lt(shifts.startAt, range.end), ne(shifts.status, 'CANCELLED'), q.hubId ? eq(shifts.hubId, q.hubId) : undefined));
    const counts = new Map<string, Record<string, number>>();
    const adHoc = new Map<string, number>();
    for (const r of rows) {
      const day = cairoToday(r.startAt);
      if (!r.templateId) {
        adHoc.set(day, (adHoc.get(day) ?? 0) + 1);
        continue;
      }
      const key = `${r.templateId}|${day}`;
      const c = counts.get(key) ?? {};
      c[r.status] = (c[r.status] ?? 0) + 1;
      counts.set(key, c);
    }
    const days = daysBetween(range.from, range.to);
    const lines: Array<{ templateId: string; templateName: string; hubId: string | null; date: string; startTime: string; endTime: string; required: number; scheduled: number; gap: number; byStatus: Record<string, number> }> = [];
    for (const t of templates) {
      for (const day of days) {
        if (!t.daysOfWeek.includes(weekdayOf(day))) continue;
        const byStatus = counts.get(`${t.id}|${day}`) ?? {};
        const scheduled = Object.values(byStatus).reduce((s, n) => s + n, 0);
        lines.push({ templateId: t.id, templateName: t.name, hubId: t.hubId, date: day, startTime: t.startTime, endTime: t.endTime, required: t.requiredCouriers, scheduled, gap: Math.max(0, t.requiredCouriers - scheduled), byStatus });
      }
    }
    const required = lines.reduce((s, l) => s + l.required, 0);
    const scheduled = lines.reduce((s, l) => s + Math.min(l.scheduled, l.required), 0);
    return {
      from: range.from,
      to: range.to,
      totals: { required, scheduled, gap: lines.reduce((s, l) => s + l.gap, 0), coveragePct: required ? Math.round((scheduled * 1000) / required) / 10 : 100 },
      lines,
      adHoc: days.map((d) => ({ date: d, shifts: adHoc.get(d) ?? 0 })).filter((d) => d.shifts > 0),
    };
  }

  /** The shift that lets a SHIFT hero be online now: IN_PROGRESS, or booked and starting within 15 min. */
  async activeShiftFor(courierId: string, now = new Date()) {
    const soon = new Date(now.getTime() + ONLINE_BEFORE_SHIFT_MINUTES * MINUTE_MS);
    const [s] = await this.db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.courierId, courierId),
          or(eq(shifts.status, 'IN_PROGRESS'), and(inArray(shifts.status, EDITABLE), lte(shifts.startAt, soon), gt(shifts.endAt, now))),
        ),
      )
      .orderBy(asc(shifts.startAt))
      .limit(1);
    return s ?? null;
  }

  /** Current (in progress or ongoing by schedule) and next booked shift of a hero. */
  async currentAndNext(courierId: string, now = new Date()) {
    const [current] = await this.db
      .select()
      .from(shifts)
      .where(and(eq(shifts.courierId, courierId), or(eq(shifts.status, 'IN_PROGRESS'), and(inArray(shifts.status, EDITABLE), lte(shifts.startAt, now), gt(shifts.endAt, now)))))
      .orderBy(asc(shifts.startAt))
      .limit(1);
    const [next] = await this.db
      .select()
      .from(shifts)
      .where(and(eq(shifts.courierId, courierId), inArray(shifts.status, EDITABLE), gt(shifts.startAt, now), current ? ne(shifts.id, current.id) : undefined))
      .orderBy(asc(shifts.startAt))
      .limit(1);
    const present = await this.presentMany([current, next].filter((s): s is ShiftRow => !!s));
    return { current: current ? present[0] : null, next: next ? present[current ? 1 : 0] : null };
  }

  // ------------------------------------------------------------ attendance

  private async geofence(hubId: string | null, lat?: number | null, lng?: number | null): Promise<string | null> {
    if (!hubId || lat === null || lat === undefined || lng === null || lng === undefined) return null;
    const [h] = await this.db.select({ lat: hubs.lat, lng: hubs.lng, code: hubs.code }).from(hubs).where(eq(hubs.id, hubId)).limit(1);
    if (!h) return null;
    const km = haversineKm({ lat, lng }, h);
    return km > GEOFENCE_RADIUS_KM ? `${(km * 1000).toFixed(0)} m from ${h.code}` : null;
  }

  /** Clock in (hero app or hub staff). Late minutes are computed against the scheduled start with a 5-minute grace. */
  async clockIn(shiftId: string, input: ClockInput, scope: { courierId?: string; principal?: Principal | null; meta?: RequestMetaInfo | null } = {}) {
    const at = input.at ?? new Date();
    const result = await this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).for('update');
      if (!s || (scope.courierId && s.courierId !== scope.courierId)) throw notFound('Shift', shiftId);
      if (s.status === 'IN_PROGRESS') throw new DomainError('ALREADY_CLOCKED_IN', 'You are already clocked in', HttpStatus.CONFLICT);
      if (!EDITABLE.includes(s.status)) throw new DomainError('INVALID_STATE', `Cannot clock in to a ${s.status} shift`, HttpStatus.CONFLICT);
      if (at.getTime() < s.startAt.getTime() - EARLY_CLOCK_IN_MINUTES * MINUTE_MS) {
        throw new DomainError('TOO_EARLY', `Clock-in opens ${EARLY_CLOCK_IN_MINUTES} minutes before the shift`, HttpStatus.CONFLICT, { opensAt: new Date(s.startAt.getTime() - EARLY_CLOCK_IN_MINUTES * MINUTE_MS) });
      }
      if (at.getTime() >= s.endAt.getTime()) throw new DomainError('SHIFT_ENDED', 'This shift is already over', HttpStatus.CONFLICT);
      const [hero] = await tx.select().from(couriers).where(eq(couriers.id, s.courierId)).for('update');
      if (!hero || hero.status !== 'ACTIVE') throw new DomainError('COURIER_NOT_ACTIVE', 'Only active heroes can clock in', HttpStatus.FORBIDDEN);
      const fence = await this.geofence(s.hubId, input.lat, input.lng);
      let notes = s.notes;
      if (fence) notes = appendNote(notes, `GEOFENCE_WARNING clock-in ${fence}`);
      if (input.note) notes = appendNote(notes, input.note);
      await tx
        .update(shifts)
        .set({ status: 'IN_PROGRESS', clockInAt: at, clockInLat: input.lat ?? null, clockInLng: input.lng ?? null, lateMinutes: lateMinutes(s.startAt, at), notes })
        .where(eq(shifts.id, shiftId));
      const goOnline = hero.availability === 'OFFLINE' || hero.availability === 'ON_BREAK';
      if (goOnline) await tx.update(couriers).set({ availability: 'ONLINE', lastSeenAt: at }).where(eq(couriers.id, hero.id));
      if (scope.principal) await this.audit.record(scope.principal, { action: 'shift.clock_in', entity: 'Shift', entityId: shiftId, after: { at, lat: input.lat, lng: input.lng } }, scope.meta, tx);
      return { courierId: hero.id, goOnline, geofenceWarning: !!fence };
    });
    if (result.goOnline) this.events.emit(DomainEvents.CourierAvailability, { courierId: result.courierId, availability: 'ONLINE', at } satisfies CourierAvailabilityEvent);
    return { ...(await this.get(shiftId)), warnings: result.geofenceWarning ? ['GEOFENCE_WARNING'] : [] };
  }

  /** Clock out: computes worked/overtime minutes, completes the shift and posts the hourly earning to the ledger. */
  async clockOut(shiftId: string, input: ClockInput, scope: { courierId?: string; principal?: Principal | null; meta?: RequestMetaInfo | null; auto?: boolean } = {}) {
    const result = await this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).for('update');
      if (!s || (scope.courierId && s.courierId !== scope.courierId)) throw notFound('Shift', shiftId);
      if (s.status !== 'IN_PROGRESS' || !s.clockInAt) throw new DomainError('NOT_CLOCKED_IN', 'Clock in first', HttpStatus.CONFLICT);
      const at = scope.auto ? s.endAt : input.at ?? new Date();
      if (at.getTime() < s.clockInAt.getTime()) throw new DomainError('INVALID_CLOCK_OUT', 'Clock-out cannot be before clock-in', HttpStatus.BAD_REQUEST);
      const att = computeAttendance(s, s.clockInAt, at, { capAtScheduled: scope.auto });
      let notes = s.notes;
      if (scope.auto) notes = appendNote(notes, 'AUTO_CLOCK_OUT');
      const fence = scope.auto ? null : await this.geofence(s.hubId, input.lat, input.lng);
      if (fence) notes = appendNote(notes, `GEOFENCE_WARNING clock-out ${fence}`);
      if (input.note) notes = appendNote(notes, input.note);
      const [res] = (await tx
        .update(shifts)
        .set({
          status: 'COMPLETED', clockOutAt: at, clockOutLat: input.lat ?? null, clockOutLng: input.lng ?? null,
          workedMinutes: att.workedMinutes, overtimeMinutes: att.overtimeMinutes, notes,
        })
        .where(and(eq(shifts.id, shiftId), eq(shifts.status, 'IN_PROGRESS')))) as unknown as [{ affectedRows: number }];
      if (res.affectedRows !== 1) throw new DomainError('INVALID_STATE', 'The shift changed meanwhile', HttpStatus.CONFLICT);
      await this.postings.shiftEarning(tx, s.id, s.courierId, att.earningsCents);
      const [hero] = await tx.select({ availability: couriers.availability }).from(couriers).where(eq(couriers.id, s.courierId)).for('update');
      const goOffline = hero?.availability === 'ONLINE' || hero?.availability === 'ON_BREAK';
      if (goOffline) await tx.update(couriers).set({ availability: 'OFFLINE' }).where(eq(couriers.id, s.courierId));
      if (scope.principal) await this.audit.record(scope.principal, { action: 'shift.clock_out', entity: 'Shift', entityId: shiftId, after: { at, ...att } }, scope.meta, tx);
      return { courierId: s.courierId, goOffline, at, earningsCents: att.earningsCents, geofenceWarning: !!fence };
    });
    if (result.goOffline) this.events.emit(DomainEvents.CourierAvailability, { courierId: result.courierId, availability: 'OFFLINE', at: result.at } satisfies CourierAvailabilityEvent);
    return { ...(await this.get(shiftId)), earningsCents: result.earningsCents, warnings: result.geofenceWarning ? ['GEOFENCE_WARNING'] : [] };
  }

  /**
   * Job `shifts.attendance` (every 5 min): booked shifts without clock-in 30
   * minutes after start become MISSED; IN_PROGRESS shifts are clocked out
   * automatically 4 hours after their scheduled end (worked capped at schedule).
   */
  async runAttendance(now = new Date()): Promise<string> {
    const missedBefore = new Date(now.getTime() - MISSED_AFTER_MINUTES * MINUTE_MS);
    const [missed] = (await this.db
      .update(shifts)
      .set({ status: 'MISSED' })
      .where(and(inArray(shifts.status, EDITABLE), isNull(shifts.clockInAt), lt(shifts.startAt, missedBefore)))) as unknown as [{ affectedRows: number }];

    const autoBefore = new Date(now.getTime() - AUTO_CLOCK_OUT_AFTER_MINUTES * MINUTE_MS);
    const stale = await this.db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.status, 'IN_PROGRESS'), lt(shifts.endAt, autoBefore)))
      .orderBy(asc(shifts.endAt))
      .limit(100);
    let closed = 0;
    for (const s of stale) {
      try {
        await this.clockOut(s.id, {}, { auto: true });
        closed++;
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
      }
    }
    return `missed ${missed.affectedRows}, auto clock-out ${closed}`;
  }
}

/** Calendar window: explicit days, or the current Sunday–Saturday week; at most 62 days. */
function calendarRange(from?: string, to?: string) {
  const f = from ? assertDay(from, 'from') : to ? addDays(assertDay(to, 'to'), -6) : weekStartOf(cairoToday());
  const t = to ?? addDays(f, 6);
  return resolveDayRange(f, t, 7, MAX_GENERATE_DAYS);
}

export function appendNote(notes: string | null, line: string): string {
  const next = notes ? `${notes}\n${line}` : line;
  return next.slice(-1000);
}
