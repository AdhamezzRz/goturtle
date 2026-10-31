import { ForbiddenException, HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  isStaffRole, isValidTrackingNumber, normalizeEgyptPhone, normalizeTrackingNumber,
  type ActorType, type TicketPriority, type TicketStatus,
} from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brands, orders, ticketMessages, tickets, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { JobsService } from '../../core/jobs.service';
import { SequenceService } from '../../core/sequence.service';
import { DomainEvents } from '../../core/events';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { likeEscape } from '../../db/helpers';
import { isStaff, principalUserId, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { PRIORITY_LABELS } from '../notifications/templates';
import type { TicketChangedEvent } from './tickets.events';
import type { AssignTicketDto, CreateTicketDto, ReplyTicketDto, TicketsQueryDto, UpdateTicketDto } from './tickets.dto';

type TicketRow = typeof tickets.$inferSelect;

/** Resolution SLA per priority. */
export const SLA_HOURS: Record<TicketPriority, number> = { URGENT: 2, HIGH: 8, MEDIUM: 24, LOW: 72 };
const NEXT_PRIORITY: Record<TicketPriority, TicketPriority> = { LOW: 'MEDIUM', MEDIUM: 'HIGH', HIGH: 'URGENT', URGENT: 'URGENT' };
export const OPEN_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'];
const SLA_ESCALATING: TicketStatus[] = ['OPEN', 'IN_PROGRESS'];
const SLA_MARKER = '[SLA]';

export const slaDue = (from: Date, priority: TicketPriority) => new Date(from.getTime() + SLA_HOURS[priority] * 3_600_000);

/**
 * Support tickets for staff, brands (their own) and customers (their own,
 * via the customer token). Internal notes are only ever returned to staff.
 */
@Injectable()
export class TicketsService implements OnModuleInit {
  private readonly log = new Logger(TicketsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly events: EventEmitter2,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.jobs.register({ name: 'tickets.sla', everySeconds: 300, timeoutSeconds: 60, run: () => this.slaSweep() });
  }

  // ------------------------------------------------------------------ create

  async create(p: Principal, dto: CreateTicketDto, meta: RequestMetaInfo) {
    const opener = this.opener(p);
    const order = await this.resolveOrder(p, dto);
    let brandId: string | null = order?.brandId ?? null;
    let customerId: string | null = order?.customerId ?? null;
    let contactName = dto.contactName?.trim() || null;
    let contactPhone = dto.contactPhone ? normalizeEgyptPhone(dto.contactPhone) : null;
    if (dto.contactPhone && !contactPhone) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    let priority: TicketPriority = dto.priority ?? 'MEDIUM';

    if (p.kind === 'customer') {
      contactName = contactName ?? p.name;
      contactPhone = p.phone;
      customerId = p.customerId ?? customerId;
      priority = 'MEDIUM';
    } else if (isStaff(p)) {
      if (dto.brandId) {
        if (order && order.brandId !== dto.brandId) throw new DomainError('ORDER_BRAND_MISMATCH', 'The order belongs to another brand', HttpStatus.BAD_REQUEST);
        const [b] = await this.db.select({ id: brands.id }).from(brands).where(eq(brands.id, dto.brandId)).limit(1);
        if (!b) throw new DomainError('INVALID_BRAND', 'Brand not found', HttpStatus.BAD_REQUEST);
        brandId = dto.brandId;
      }
    } else {
      brandId = p.brandId;
    }

    const now = new Date();
    const created = await this.db.transaction(async (tx) => {
      const code = await this.sequences.code('TK', 'ticket', 6, tx);
      const [row] = await tx
        .insert(tickets)
        .values({
          code, subject: dto.subject.trim(), category: dto.category, priority, status: 'OPEN', orderId: order?.id ?? null, brandId, customerId,
          openedById: principalUserId(p), openedByType: opener.type, contactName, contactPhone, slaDueAt: slaDue(now, priority),
        })
        .$returningId();
      await tx.insert(ticketMessages).values({
        ticketId: row.id, authorId: principalUserId(p), authorType: opener.type, authorName: opener.name, body: dto.body.trim(), isInternal: false, attachments: dto.attachments ?? null,
      });
      const ticket = await this.loadRaw(row.id, tx);
      if (p.kind === 'user') await this.audit.record(p, { action: 'ticket.create', entity: 'Ticket', entityId: row.id, after: ticket }, meta, tx);
      return ticket;
    });
    this.emit(DomainEvents.TicketCreated, created, 'created', p);
    return this.detail(p, created.id);
  }

  /** Validates that the order exists and belongs to the caller (brand / customer). */
  private async resolveOrder(p: Principal, dto: CreateTicketDto) {
    if (!dto.orderId && !dto.trackingNumber) {
      if (p.kind === 'customer') throw new DomainError('ORDER_REQUIRED', 'Choose the shipment this is about', HttpStatus.BAD_REQUEST);
      return null;
    }
    let where: SQL;
    if (dto.orderId) where = eq(orders.id, dto.orderId);
    else {
      const tn = normalizeTrackingNumber(dto.trackingNumber!);
      if (!isValidTrackingNumber(tn)) throw new DomainError('INVALID_TRACKING_NUMBER', 'Tracking number is not valid', HttpStatus.BAD_REQUEST);
      where = eq(orders.trackingNumber, tn);
    }
    const [o] = await this.db
      .select({ id: orders.id, brandId: orders.brandId, customerId: orders.customerId, trackingNumber: orders.trackingNumber, recipientPhone: orders.recipientPhone, recipientAltPhone: orders.recipientAltPhone })
      .from(orders)
      .where(where)
      .limit(1);
    const invalid = new DomainError('INVALID_ORDER', 'Order not found', HttpStatus.BAD_REQUEST);
    if (!o) throw invalid;
    if (p.kind === 'customer') {
      const owns = o.recipientPhone === p.phone || o.recipientAltPhone === p.phone;
      if (!owns || (p.trackingNumber && p.trackingNumber !== o.trackingNumber)) throw invalid;
    } else if (!isStaff(p) && o.brandId !== p.brandId) {
      throw invalid;
    }
    return o;
  }

  // ------------------------------------------------------------------ read

  async list(p: Principal, q: TicketsQueryDto) {
    const conds: SQL[] = [this.scope(p)].filter((c): c is SQL => !!c);
    if (q.status) conds.push(eq(tickets.status, q.status));
    if (q.open) conds.push(inArray(tickets.status, OPEN_STATUSES));
    if (q.priority) conds.push(eq(tickets.priority, q.priority));
    if (q.category) conds.push(eq(tickets.category, q.category));
    if (q.orderId) conds.push(eq(tickets.orderId, q.orderId));
    if (isStaff(p)) {
      if (q.brandId) conds.push(eq(tickets.brandId, q.brandId));
      if (q.assigneeId === 'me') conds.push(eq(tickets.assigneeId, principalUserId(p)!));
      else if (q.assigneeId === 'none') conds.push(isNull(tickets.assigneeId));
      else if (q.assigneeId) conds.push(eq(tickets.assigneeId, q.assigneeId));
    }
    if (q.breached !== undefined) conds.push(q.breached ? breachedSql() : sql`not (${breachedSql()})`);
    if (q.q) {
      const term = `%${likeEscape(q.q.trim())}%`;
      conds.push(or(like(tickets.code, term), like(tickets.subject, term))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({ ticket: tickets, brandName: brands.name, assigneeName: users.name, trackingNumber: orders.trackingNumber })
        .from(tickets)
        .leftJoin(brands, eq(brands.id, tickets.brandId))
        .leftJoin(users, eq(users.id, tickets.assigneeId))
        .leftJoin(orders, eq(orders.id, tickets.orderId))
        .where(where)
        .orderBy(q.order === 'asc' ? asc(tickets.createdAt) : desc(tickets.createdAt), desc(tickets.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(tickets).where(where),
    ]);
    const now = Date.now();
    return paginate(
      rows.map((r) => ({
        ...this.presentTicket(p, r.ticket, now),
        brand: r.ticket.brandId ? { id: r.ticket.brandId, name: r.brandName } : null,
        assignee: r.ticket.assigneeId ? { id: r.ticket.assigneeId, name: r.assigneeName } : null,
        order: r.ticket.orderId ? { id: r.ticket.orderId, trackingNumber: r.trackingNumber } : null,
      })),
      Number(n),
      q,
    );
  }

  async detail(p: Principal, id: string) {
    const t = await this.loadFor(p, id);
    const staff = isStaff(p);
    const [messages, order, brand, assignee] = await Promise.all([
      this.db
        .select()
        .from(ticketMessages)
        .where(and(eq(ticketMessages.ticketId, id), staff ? undefined : eq(ticketMessages.isInternal, false)))
        .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id)),
      t.orderId
        ? this.db.select({ id: orders.id, trackingNumber: orders.trackingNumber, status: orders.status, brandReference: orders.brandReference }).from(orders).where(eq(orders.id, t.orderId)).limit(1).then((r) => r[0] ?? null)
        : null,
      t.brandId ? this.db.select({ id: brands.id, name: brands.name, code: brands.code }).from(brands).where(eq(brands.id, t.brandId)).limit(1).then((r) => r[0] ?? null) : null,
      t.assigneeId ? this.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, t.assigneeId)).limit(1).then((r) => r[0] ?? null) : null,
    ]);
    return {
      ...this.presentTicket(p, t, Date.now()),
      order,
      brand,
      assignee,
      messages: messages.map((m) => ({
        id: m.id, authorType: m.authorType, authorName: m.authorName, body: m.body, attachments: m.attachments ?? [], createdAt: m.createdAt,
        ...(staff ? { authorId: m.authorId, isInternal: m.isInternal } : {}),
      })),
    };
  }

  // ------------------------------------------------------------------ write

  async reply(p: Principal, id: string, dto: ReplyTicketDto, meta: RequestMetaInfo) {
    const staff = isStaff(p);
    if (dto.isInternal && !staff) throw new ForbiddenException('Only GoTurtle staff can add internal notes');
    const t = await this.loadFor(p, id);
    if (!staff && t.status === 'CLOSED') throw new DomainError('TICKET_CLOSED', 'This ticket is closed — open a new one', HttpStatus.CONFLICT);
    const opener = this.opener(p);
    const isInternal = !!dto.isInternal;
    const updated = await this.db.transaction(async (tx) => {
      const [m] = await tx
        .insert(ticketMessages)
        .values({ ticketId: id, authorId: principalUserId(p), authorType: opener.type, authorName: opener.name, body: dto.body.trim(), isInternal, attachments: dto.attachments ?? null })
        .$returningId();
      // Workflow: first staff answer starts work; a requester reply re-opens waiting/resolved tickets.
      let status: TicketStatus | null = null;
      if (!isInternal && staff && t.status === 'OPEN') status = 'IN_PROGRESS';
      if (!staff && (t.status === 'WAITING_ON_CUSTOMER' || t.status === 'RESOLVED')) status = 'IN_PROGRESS';
      if (status) await tx.update(tickets).set({ status, resolvedAt: null }).where(eq(tickets.id, id));
      else await tx.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, id));
      if (p.kind === 'user') await this.audit.record(p, { action: isInternal ? 'ticket.note' : 'ticket.reply', entity: 'Ticket', entityId: id, after: { messageId: m.id, status } }, meta, tx);
      return { ticket: await this.loadRaw(id, tx), messageId: m.id };
    });
    this.emit(DomainEvents.TicketUpdated, updated.ticket, 'reply', p, { messageId: updated.messageId, isInternal });
    return this.detail(p, id);
  }

  async assign(p: Principal, id: string, dto: AssignTicketDto, meta: RequestMetaInfo) {
    const before = await this.loadFor(p, id);
    if (dto.assigneeId) {
      const [u] = await this.db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, dto.assigneeId)).limit(1);
      if (!u || !isStaffRole(u.role) || u.status !== 'ACTIVE') throw new DomainError('INVALID_ASSIGNEE', 'Assignee must be an active staff user', HttpStatus.BAD_REQUEST);
    }
    await this.db.update(tickets).set({ assigneeId: dto.assigneeId }).where(eq(tickets.id, id));
    await this.audit.record(p, { action: 'ticket.assign', entity: 'Ticket', entityId: id, before: { assigneeId: before.assigneeId }, after: { assigneeId: dto.assigneeId } }, meta);
    const after = await this.loadRaw(id);
    if (before.assigneeId !== dto.assigneeId) this.emit(DomainEvents.TicketUpdated, after, 'assigned', p);
    return this.detail(p, id);
  }

  async setStatus(p: Principal, id: string, status: TicketStatus, meta: RequestMetaInfo) {
    const before = await this.loadFor(p, id);
    if (!isStaff(p) && !['RESOLVED', 'CLOSED'].includes(status)) {
      throw new DomainError('STATUS_NOT_ALLOWED', 'You can only resolve or close your ticket', HttpStatus.FORBIDDEN);
    }
    if (before.status === status) return this.detail(p, id);
    const closing = status === 'RESOLVED' || status === 'CLOSED';
    await this.db
      .update(tickets)
      .set({ status, resolvedAt: closing ? (before.resolvedAt ?? new Date()) : null })
      .where(eq(tickets.id, id));
    if (p.kind === 'user') await this.audit.record(p, { action: 'ticket.status', entity: 'Ticket', entityId: id, before: { status: before.status }, after: { status } }, meta);
    this.emit(DomainEvents.TicketUpdated, await this.loadRaw(id), 'status', p);
    return this.detail(p, id);
  }

  async update(p: Principal, id: string, dto: UpdateTicketDto, meta: RequestMetaInfo) {
    const before = await this.loadFor(p, id);
    const patch: Partial<typeof tickets.$inferInsert> = {};
    if (dto.subject !== undefined) patch.subject = dto.subject.trim();
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.priority !== undefined && dto.priority !== before.priority) {
      patch.priority = dto.priority;
      patch.slaDueAt = slaDue(before.createdAt, dto.priority);
    }
    if (Object.keys(patch).length) await this.db.update(tickets).set(patch).where(eq(tickets.id, id));
    await this.audit.record(p, { action: 'ticket.update', entity: 'Ticket', entityId: id, before, after: patch }, meta);
    this.emit(DomainEvents.TicketUpdated, await this.loadRaw(id), 'updated', p);
    return this.detail(p, id);
  }

  // ------------------------------------------------------------------ SLA job

  /**
   * Open tickets past their SLA get their priority bumped one level — once
   * (an internal "[SLA]" system note marks it) — and the assignee (or the
   * support leads when unassigned) is notified in-app.
   */
  async slaSweep(): Promise<string> {
    const breached = await this.db
      .select()
      .from(tickets)
      .where(and(inArray(tickets.status, SLA_ESCALATING), isNotNull(tickets.slaDueAt), lt(tickets.slaDueAt, new Date())))
      .orderBy(asc(tickets.slaDueAt))
      .limit(100);
    if (!breached.length) return 'idle';
    const marked = await this.db
      .select({ ticketId: ticketMessages.ticketId })
      .from(ticketMessages)
      .where(and(inArray(ticketMessages.ticketId, breached.map((t) => t.id)), eq(ticketMessages.authorType, 'SYSTEM'), like(ticketMessages.body, `${likeEscape(SLA_MARKER)}%`)));
    const done = new Set(marked.map((m) => m.ticketId));
    let escalated = 0;
    for (const t of breached) {
      if (done.has(t.id)) continue;
      const priority = NEXT_PRIORITY[t.priority];
      await this.db.transaction(async (tx) => {
        if (priority !== t.priority) await tx.update(tickets).set({ priority }).where(eq(tickets.id, t.id));
        await tx.insert(ticketMessages).values({
          ticketId: t.id, authorType: 'SYSTEM', authorName: 'GoTurtle', isInternal: true,
          body: `${SLA_MARKER} SLA breached (due ${t.slaDueAt!.toISOString()}). Priority ${t.priority} → ${priority}.`,
        });
      });
      const vars = { code: t.code, subject: t.subject, priority: PRIORITY_LABELS[priority].en };
      const opts = { data: { ticketId: t.id, link: `/ops/tickets/${t.id}` } };
      try {
        if (t.assigneeId) await this.notifications.inApp([t.assigneeId], 'ticket_sla_breached', vars, opts);
        else await this.notifications.notifyRoles(['SUPPORT', 'OPS_MANAGER'], 'ticket_sla_breached', vars, opts);
      } catch (err) {
        this.log.warn(`SLA notification for ${t.code} failed: ${err instanceof Error ? err.message : err}`);
      }
      this.events.emit(DomainEvents.TicketUpdated, this.eventOf({ ...t, priority }, 'sla_breached', { actorType: 'SYSTEM', actorId: null }));
      escalated++;
    }
    return `escalated ${escalated}`;
  }

  // ------------------------------------------------------------------ helpers

  /** Row-level visibility: staff all, brand users/API keys their brand, customers their own tickets. */
  private scope(p: Principal): SQL | undefined {
    if (isStaff(p)) return undefined;
    if (p.kind === 'customer') return and(eq(tickets.openedByType, 'CUSTOMER'), eq(tickets.contactPhone, p.phone));
    if ((p.kind === 'user' && p.actorType === 'BRAND' && p.brandId) || p.kind === 'apiKey') return eq(tickets.brandId, p.brandId!);
    throw new ForbiddenException('Not allowed');
  }

  private async loadFor(p: Principal, id: string): Promise<TicketRow> {
    const [t] = await this.db.select().from(tickets).where(and(eq(tickets.id, id), this.scope(p))).limit(1);
    if (!t) throw notFound('Ticket', id);
    return t;
  }

  private async loadRaw(id: string, db: DbOrTx = this.db): Promise<TicketRow> {
    const [t] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    if (!t) throw notFound('Ticket', id);
    return t;
  }

  private opener(p: Principal): { type: ActorType; name: string } {
    if (p.kind === 'customer') return { type: 'CUSTOMER', name: p.name || 'Customer' };
    if (p.kind === 'apiKey') return { type: 'API', name: p.name };
    return { type: p.actorType, name: p.name };
  }

  private presentTicket(p: Principal, t: TicketRow, now: number) {
    const breached = !!t.slaDueAt && (t.resolvedAt ? t.resolvedAt.getTime() > t.slaDueAt.getTime() : t.slaDueAt.getTime() < now);
    const base = { ...t, breached };
    if (isStaff(p)) return base;
    const { openedById: _o, assigneeId: _a, customerId: _c, ...rest } = base;
    void _o;
    void _a;
    void _c;
    return rest;
  }

  private eventOf(t: TicketRow, change: TicketChangedEvent['change'], actor: { actorType: ActorType; actorId: string | null }, extra: Partial<TicketChangedEvent> = {}): TicketChangedEvent {
    return {
      ticketId: t.id, code: t.code, brandId: t.brandId, orderId: t.orderId, change, actorType: actor.actorType, actorId: actor.actorId,
      status: t.status, priority: t.priority, assigneeId: t.assigneeId, ...extra,
    };
  }

  private emit(name: string, t: TicketRow, change: TicketChangedEvent['change'], p: Principal, extra: Partial<TicketChangedEvent> = {}) {
    this.events.emit(name, this.eventOf(t, change, { actorType: this.opener(p).type, actorId: principalUserId(p) }, extra));
  }
}

/** SLA due time passed before the ticket was resolved (or it is still unresolved). */
export function breachedSql(): SQL {
  return sql`(${tickets.slaDueAt} is not null and ${tickets.slaDueAt} < coalesce(${tickets.resolvedAt}, ${new Date()}))`;
}

