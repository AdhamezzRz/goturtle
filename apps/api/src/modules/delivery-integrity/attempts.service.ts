import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { DomainEvents, type CallStatus, type FailureReason } from '@goturtle/shared';
import type { Db, DbOrTx, Tx } from '../../db/client';
import { callLogs, couriers, deliveryAttempts, orders, ticketMessages, tickets, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { SequenceService } from '../../core/sequence.service';
import { DomainError, notFound } from '../../common/errors';
import { SYSTEM_ACTOR, type ActorContext } from '../../common/actor';
import { principalUserId, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { OrderWorkflowService, type TransitionContext } from '../orders/order-workflow.service';
import type { OrderRow } from '../orders/order-factory.service';
import { firstName, withTag, type PostCommit } from '../orders/ops-kit';
import { NotificationsService } from '../notifications/notifications.service';
import { FAILURE_REASON_LABELS } from '../notifications/templates';
import { AdjustmentsService } from '../finance/adjustments.service';
import { OPEN_STATUSES, slaDue } from '../tickets/tickets.service';
import type { TicketChangedEvent } from '../tickets/tickets.events';
import { HoldsService } from './holds.service';
import { callProviderFromEnv, mapTwilioStatus, type CallProvider } from './call-providers';
import {
  CALL_WINDOW_MS, distanceMeters, nextCountedCallAt, requiredCalls, signLink, spacedCallCount, trackingLink, UNREACHABLE_REASONS,
} from './integrity.util';

type AttemptRow = typeof deliveryAttempts.$inferSelect;
type CallRow = typeof callLogs.$inferSelect;

/** Statuses in which a hero may call the recipient of an order they hold. */
const CALLABLE = ['ASSIGNED', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED', 'RETURN_OUT', 'PICKED_UP'];
const FINAL_CALL: CallStatus[] = ['ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED'];
/** Failure reasons we ask the customer to verify (a damaged parcel is not the customer's call). */
const VERIFY_EXCLUDED: FailureReason[] = ['PACKAGE_DAMAGED'];
/** Penalty cap for a disputed attempt (EGP 1,000). */
export const MAX_PENALTY_CENTS = 100_000;
/** Re-delivery priority given to an order whose failed attempt was found to be fake. */
const REDELIVERY_PRIORITY = 10;

const cairoTime = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

/**
 * Attempt integrity: logged calls to the recipient, proof rules on
 * FAILED_ATTEMPT (hero position inside the geofence, enough spaced calls),
 * the customer's verification of each failed attempt and the dispute flow
 * (HIGH ticket → ops decision → optional penalty through the ledger).
 */
@Injectable()
export class AttemptsService implements OnModuleInit {
  private readonly log = new Logger('IntegrityAttempts');
  private provider: CallProvider = callProviderFromEnv();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly workflow: OrderWorkflowService,
    private readonly holds: HoldsService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly notifications: NotificationsService,
    private readonly adjustments: AdjustmentsService,
  ) {}

  onModuleInit() {
    this.workflow.registerGuard('integrity.attempt-proof', (ctx) => this.attemptGuard(ctx));
    this.workflow.registerEffect('integrity.attempt-proof', (ctx) => this.attemptEffect(ctx));
  }

  /** Swappable for tests. */
  useCallProvider(p: CallProvider) {
    this.provider = p;
  }

  // ------------------------------------------------------------------ calls

  private async heroOrder(orderId: string, courierId: string): Promise<OrderRow> {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o || o.courierId !== courierId) throw notFound('Order', orderId);
    return o;
  }

  /** Logs a call and returns what the hero should dial (the recipient, or a masked proxy number). */
  async startCall(orderId: string, actor: ActorContext, to: 'PRIMARY' | 'ALT' = 'PRIMARY') {
    const courierId = actor.courierId!;
    const o = await this.heroOrder(orderId, courierId);
    if (!CALLABLE.includes(o.status)) throw new DomainError('CALL_NOT_ALLOWED', `Calls are logged only while you hold the parcel (now ${o.status})`, HttpStatus.CONFLICT, { status: o.status });
    const recipient = to === 'ALT' ? o.recipientAltPhone : o.recipientPhone;
    if (!recipient) throw new DomainError('NO_ALT_PHONE', 'This recipient has no alternative number', HttpStatus.UNPROCESSABLE_ENTITY);
    const [hero] = await this.db.select({ phone: users.phone }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(eq(couriers.id, courierId)).limit(1);
    const [row] = await this.db.insert(callLogs).values({ orderId: o.id, courierId, provider: this.provider.name, status: 'INITIATED' }).$returningId();
    let provider: CallProvider['name'] = this.provider.name;
    let dial = recipient;
    let masked = this.provider.masked;
    try {
      const session = await this.provider.start({ callLogId: row.id, heroPhone: hero?.phone ?? '', recipientPhone: recipient, ttlSeconds: 3600 });
      dial = session.dialNumber;
      if (session.providerCallId || session.proxyNumber) {
        await this.db.update(callLogs).set({ providerCallId: session.providerCallId, proxyNumber: session.proxyNumber, status: 'RINGING' }).where(eq(callLogs.id, row.id));
      }
    } catch (err) {
      // Never leave the hero without a way to call: fall back to the plain number (still logged).
      this.log.warn(`masked call failed for ${o.trackingNumber}: ${err instanceof Error ? err.message : err} — falling back to a direct call`);
      provider = 'direct';
      masked = false;
      dial = recipient;
      await this.db.update(callLogs).set({ provider: 'direct' }).where(eq(callLogs.id, row.id));
    }
    return { callLogId: row.id, provider, masked, dial: `tel:${dial}`, number: dial, calls: await this.callSummary(o, courierId) };
  }

  /** The hero reports the outcome after hanging up (provider results win when they arrive). */
  async reportCall(callId: string, courierId: string, dto: { status: CallStatus; durationSeconds?: number }) {
    const [c] = await this.db.select().from(callLogs).where(eq(callLogs.id, callId)).limit(1);
    if (!c || c.courierId !== courierId) throw notFound('Call', callId);
    const providerFinal = c.provider !== 'direct' && FINAL_CALL.includes(c.status);
    if (!providerFinal && !FINAL_CALL.includes(c.status)) {
      await this.db
        .update(callLogs)
        .set({ status: dto.status, durationSeconds: Math.max(0, Math.min(dto.durationSeconds ?? 0, 7200)), endedAt: new Date() })
        .where(eq(callLogs.id, callId));
    }
    const [o] = await this.db.select().from(orders).where(eq(orders.id, c.orderId)).limit(1);
    const [row] = await this.db.select().from(callLogs).where(eq(callLogs.id, callId)).limit(1);
    return { call: this.callView(row), calls: o ? await this.callSummary(o, courierId) : null };
  }

  /** Provider status webhook (Twilio Proxy interaction callback). */
  async providerStatus(providerCallId: string, status: string | undefined, durationSeconds: number | null) {
    const mapped = mapTwilioStatus(status);
    if (!providerCallId || !mapped) return { ok: true, updated: 0 };
    const [c] = await this.db.select().from(callLogs).where(eq(callLogs.providerCallId, providerCallId)).orderBy(desc(callLogs.createdAt)).limit(1);
    if (!c) return { ok: true, updated: 0 };
    const final = FINAL_CALL.includes(mapped);
    await this.db
      .update(callLogs)
      .set({ status: mapped, ...(final ? { endedAt: new Date() } : {}), ...(durationSeconds != null ? { durationSeconds: Math.max(0, Math.round(durationSeconds)) } : {}) })
      .where(eq(callLogs.id, c.id));
    return { ok: true, updated: 1 };
  }

  callView(c: CallRow) {
    return { id: c.id, provider: c.provider, status: c.status, durationSeconds: c.durationSeconds, startedAt: c.startedAt, endedAt: c.endedAt, masked: c.provider !== 'direct' };
  }

  private async recentCalls(db: DbOrTx, orderId: string, courierId: string, now = Date.now()) {
    return db
      .select()
      .from(callLogs)
      .where(and(eq(callLogs.orderId, orderId), eq(callLogs.courierId, courierId), gte(callLogs.startedAt, new Date(now - CALL_WINDOW_MS))))
      .orderBy(asc(callLogs.startedAt));
  }

  /** What the hero app needs to show the fail sheet: geofence, destination, calls made vs required. */
  async callSummary(o: OrderRow, courierId: string) {
    const s = await this.holds.config();
    const calls = await this.recentCalls(this.db, o.id, courierId);
    const times = calls.map((c) => c.startedAt);
    const hasPin = o.lat != null && o.lng != null;
    return {
      made: spacedCallCount(times, s.unreachableMinSpacingMinutes),
      logged: calls.length,
      requiredForUnreachable: requiredCalls('CUSTOMER_UNREACHABLE', hasPin, s.unreachableMinCalls),
      requiredForOther: requiredCalls('OTHER', hasPin, s.unreachableMinCalls),
      spacingMinutes: s.unreachableMinSpacingMinutes,
      nextCountedAt: nextCountedCallAt(times, s.unreachableMinSpacingMinutes),
      list: calls.map((c) => this.callView(c)),
    };
  }

  async heroIntegrity(orderId: string, courierId: string) {
    const s = await this.holds.config();
    const o = await this.heroOrder(orderId, courierId);
    return {
      orderId: o.id,
      geofenceMeters: s.failedAttemptGeofenceMeters,
      destination: o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : null,
      unreachableReasons: UNREACHABLE_REASONS,
      callProvider: this.provider.name,
      calls: await this.callSummary(o, courierId),
    };
  }

  // ------------------------------------------------------------------ FAILED_ATTEMPT proof

  private async attemptGuard(ctx: TransitionContext) {
    if (ctx.to !== 'FAILED_ATTEMPT' || ctx.actor.actorType !== 'COURIER') return;
    // Backfilled history (demo seed / imports) carries no live proof.
    if (ctx.opts.at && ctx.opts.at.getTime() < Date.now() - 60_000) return;
    const s = await this.holds.config();
    const reason = ctx.opts.failure?.reason ?? 'OTHER';
    const { order, opts } = ctx;
    const hasPin = order.lat != null && order.lng != null;
    if (opts.lat == null || opts.lng == null) {
      if (s.failedAttemptGeofenceMeters > 0 || requiredCalls(reason, hasPin, s.unreachableMinCalls) > 0) {
        throw new DomainError('LOCATION_REQUIRED', 'Turn on location so we can confirm you are at the address', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    } else if (hasPin && s.failedAttemptGeofenceMeters > 0) {
      const d = distanceMeters({ lat: opts.lat, lng: opts.lng }, { lat: order.lat!, lng: order.lng! });
      if (d > s.failedAttemptGeofenceMeters) {
        throw new DomainError('TOO_FAR_FROM_DESTINATION', `You are ${d} m from the address — go to the customer before reporting a failed attempt`, HttpStatus.UNPROCESSABLE_ENTITY, {
          distanceMeters: d, allowedMeters: s.failedAttemptGeofenceMeters, destination: { lat: order.lat, lng: order.lng },
        });
      }
    }
    const required = requiredCalls(reason, hasPin, s.unreachableMinCalls);
    if (required > 0) {
      const calls = await this.recentCalls(ctx.tx, order.id, ctx.actor.courierId!);
      const made = spacedCallCount(calls.map((c) => c.startedAt), s.unreachableMinSpacingMinutes);
      if (made < required) {
        throw new DomainError('CALLS_REQUIRED', `Call the customer ${required} times (at least ${s.unreachableMinSpacingMinutes} min apart) before reporting this`, HttpStatus.UNPROCESSABLE_ENTITY, {
          made, required, spacingMinutes: s.unreachableMinSpacingMinutes, nextCountedAt: nextCountedCallAt(calls.map((c) => c.startedAt), s.unreachableMinSpacingMinutes),
        });
      }
    }
  }

  private async attemptEffect(ctx: TransitionContext & { updated: OrderRow }) {
    if (ctx.to !== 'FAILED_ATTEMPT') return;
    const { tx, order, opts, updated } = ctx;
    const [attempt] = await tx
      .select()
      .from(deliveryAttempts)
      .where(and(eq(deliveryAttempts.orderId, order.id), eq(deliveryAttempts.attemptNo, updated.attempts), eq(deliveryAttempts.success, false)))
      .orderBy(desc(deliveryAttempts.createdAt))
      .limit(1);
    if (!attempt) return;
    const at = opts.at ?? new Date();
    const s = await this.holds.config();
    const distance = opts.lat != null && opts.lng != null && order.lat != null && order.lng != null
      ? distanceMeters({ lat: opts.lat, lng: opts.lng }, { lat: order.lat, lng: order.lng })
      : null;
    const calls = await this.recentCalls(tx, order.id, attempt.courierId, at.getTime());
    await tx.update(deliveryAttempts).set({ distanceMeters: distance, callCount: calls.length }).where(eq(deliveryAttempts.id, attempt.id));

    const reason = (opts.failure?.reason ?? 'OTHER') as FailureReason;
    const live = at.getTime() > Date.now() - s.attemptDisputeWindowHours * 3_600_000;
    if (ctx.actor.actorType !== 'COURIER' || VERIFY_EXCLUDED.includes(reason) || !live) return;
    const [hero] = await tx.select({ name: users.name }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(eq(couriers.id, attempt.courierId)).limit(1);
    const token = signLink(order.trackingNumber, 'attempt', s.attemptDisputeWindowHours * 3_600_000, attempt.id, at.getTime());
    await this.notifications.queue(
      {
        channel: s.confirmationChannel,
        to: order.recipientPhone,
        template: 'attempt_verify',
        locale: 'ar',
        orderId: order.id,
        vars: { hero: firstName(hero?.name), tn: order.trackingNumber, time: cairoTime(at), reason: FAILURE_REASON_LABELS[reason]?.ar ?? '', link: trackingLink(order.trackingNumber, { a: token }) },
        data: { kind: 'attempt_verify', attemptId: attempt.id },
      },
      tx,
    );
  }

  // ------------------------------------------------------------------ customer verification & disputes

  /** The latest failed attempt still inside the dispute window. */
  async openAttempt(orderId: string, attemptId?: string | null): Promise<AttemptRow | null> {
    const s = await this.holds.config();
    const since = new Date(Date.now() - s.attemptDisputeWindowHours * 3_600_000);
    const [a] = await this.db
      .select()
      .from(deliveryAttempts)
      .where(and(eq(deliveryAttempts.orderId, orderId), eq(deliveryAttempts.success, false), attemptId ? eq(deliveryAttempts.id, attemptId) : undefined, gte(deliveryAttempts.createdAt, since)))
      .orderBy(desc(deliveryAttempts.createdAt))
      .limit(1);
    return a ?? null;
  }

  /**
   * Customer answer to "was this attempt real?": CONFIRM → CONFIRMED_BY_CUSTOMER,
   * DISPUTE → DISPUTED + HIGH ATTEMPT_DISPUTE ticket + ops notified. Idempotent.
   */
  async feedback(orderId: string, input: { attemptId?: string | null; answer: 'CONFIRM' | 'DISPUTE'; note?: string | null; channel: string; actor: ActorContext }) {
    const s = await this.holds.config();
    const out = await this.workflow.run(async (tx, fx) => {
      const o = await this.workflow.lock(tx, orderId);
      const [a] = await tx
        .select()
        .from(deliveryAttempts)
        .where(and(eq(deliveryAttempts.orderId, orderId), eq(deliveryAttempts.success, false), input.attemptId ? eq(deliveryAttempts.id, input.attemptId) : undefined))
        .orderBy(desc(deliveryAttempts.createdAt))
        .for('update')
        .limit(1);
      if (!a) throw new DomainError('NO_FAILED_ATTEMPT', 'There is no failed delivery attempt to answer for this shipment', HttpStatus.NOT_FOUND);
      if (a.createdAt.getTime() < Date.now() - s.attemptDisputeWindowHours * 3_600_000) {
        throw new DomainError('DISPUTE_WINDOW_CLOSED', `Attempts can be answered within ${s.attemptDisputeWindowHours} hours`, HttpStatus.CONFLICT, { windowHours: s.attemptDisputeWindowHours });
      }
      if (input.answer === 'CONFIRM') {
        if (a.disputeStatus !== 'NONE') return { attemptId: a.id, disputeStatus: a.disputeStatus, changed: false, ticketCode: null as string | null };
        await tx.update(deliveryAttempts).set({ disputeStatus: 'CONFIRMED_BY_CUSTOMER' }).where(eq(deliveryAttempts.id, a.id));
        await this.workflow.addNote(tx, o, input.actor, { reason: 'ATTEMPT_CONFIRMED', note: `Customer confirmed attempt #${a.attemptNo} (${input.channel})`, metadata: { attemptId: a.id } });
        return { attemptId: a.id, disputeStatus: 'CONFIRMED_BY_CUSTOMER' as const, changed: true, ticketCode: null };
      }
      if (['DISPUTED', 'UPHELD', 'REJECTED'].includes(a.disputeStatus)) {
        const [t] = await tx.select({ code: tickets.code }).from(tickets).where(and(eq(tickets.orderId, orderId), eq(tickets.category, 'ATTEMPT_DISPUTE'))).orderBy(desc(tickets.createdAt)).limit(1);
        return { attemptId: a.id, disputeStatus: a.disputeStatus, changed: false, ticketCode: t?.code ?? null };
      }
      const note = input.note?.trim().slice(0, 500) || null;
      await tx.update(deliveryAttempts).set({ disputeStatus: 'DISPUTED', disputedAt: new Date(), disputeNote: note }).where(eq(deliveryAttempts.id, a.id));
      await this.workflow.addNote(tx, o, input.actor, { reason: 'ATTEMPT_DISPUTED', note: `Customer disputed attempt #${a.attemptNo} (${input.channel})${note ? `: ${note}` : ''}`, isPublic: true, metadata: { attemptId: a.id } });
      const ticket = await this.openDisputeTicket(tx, fx, o, a, note, input.channel);
      return { attemptId: a.id, disputeStatus: 'DISPUTED' as const, changed: true, ticketCode: ticket.code, heroName: ticket.heroName };
    });
    if (out.changed && out.disputeStatus === 'DISPUTED') {
      const [o] = await this.db.select({ tn: orders.trackingNumber }).from(orders).where(eq(orders.id, orderId)).limit(1);
      await this.notifications
        .notifyRoles(['OPS_MANAGER', 'DISPATCHER'], 'attempt_disputed', { tn: o?.tn ?? '', hero: (out as { heroName?: string }).heroName ?? '', code: out.ticketCode ?? '' }, {
          orderId, data: { orderId, attemptId: out.attemptId, link: '/ops/integrity?tab=disputes' },
        })
        .catch((err) => this.log.warn(`dispute notification failed: ${err instanceof Error ? err.message : err}`));
    }
    return out;
  }

  private async openDisputeTicket(tx: Tx, fx: PostCommit, o: OrderRow, a: AttemptRow, note: string | null, channel: string) {
    const [hero] = await tx.select({ name: users.name, code: couriers.code }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(eq(couriers.id, a.courierId)).limit(1);
    const code = await this.sequences.code('TK', 'ticket', 6, tx);
    const now = new Date();
    const [row] = await tx
      .insert(tickets)
      .values({
        code, subject: `Attempt dispute — ${o.trackingNumber} (attempt #${a.attemptNo})`.slice(0, 200), category: 'ATTEMPT_DISPUTE', priority: 'HIGH', status: 'OPEN',
        orderId: o.id, brandId: o.brandId, customerId: o.customerId, openedById: null, openedByType: 'CUSTOMER',
        contactName: o.recipientName, contactPhone: o.recipientPhone, slaDueAt: slaDue(now, 'HIGH'),
      })
      .$returningId();
    await tx.insert(ticketMessages).values({
      ticketId: row.id, authorType: 'CUSTOMER', authorName: o.recipientName, isInternal: false,
      body: `I was available — the delivery attempt #${a.attemptNo} did not happen as reported.${note ? `\n\n${note}` : ''}`,
    });
    const reason = a.failureReason ? FAILURE_REASON_LABELS[a.failureReason]?.en : 'unknown reason';
    await tx.insert(ticketMessages).values({
      ticketId: row.id, authorType: 'SYSTEM', authorName: 'GoTurtle', isInternal: true,
      body: [
        `Attempt ${a.id} by ${hero?.name ?? 'hero'} (${hero?.code ?? a.courierId}) at ${a.createdAt.toISOString()} — ${reason}.`,
        `Distance from the pin: ${a.distanceMeters != null ? `${a.distanceMeters} m` : 'no pin'} · logged calls: ${a.callCount}.`,
        `Reported via ${channel}. Resolve it in Delivery integrity → Disputes.`,
      ].join('\n'),
    });
    fx.emit(DomainEvents.TicketCreated, {
      ticketId: row.id, code, brandId: o.brandId, orderId: o.id, change: 'created', actorType: 'CUSTOMER', actorId: null, status: 'OPEN', priority: 'HIGH', assigneeId: null,
    } satisfies TicketChangedEvent);
    return { id: row.id, code, heroName: firstName(hero?.name) };
  }

  /**
   * Ops decision on a disputed attempt. UPHELD (the customer was right): the
   * order gets an extra attempt and re-delivery priority, an optional PENALTY
   * adjustment is posted to the hero through the ledger. REJECTED: the attempt stands.
   */
  async resolve(attemptId: string, dto: { decision: 'UPHELD' | 'REJECTED'; penaltyCents?: number; note: string }, p: Principal, meta: RequestMetaInfo) {
    const penalty = dto.decision === 'UPHELD' ? Math.round(dto.penaltyCents ?? 0) : 0;
    if (penalty > 0 && (p.kind !== 'user' || !p.permissions.includes('couriers.manage'))) {
      throw new DomainError('PENALTY_NOT_ALLOWED', 'Only managers with hero management rights can apply a penalty', HttpStatus.FORBIDDEN);
    }
    if (penalty < 0 || penalty > MAX_PENALTY_CENTS) throw new DomainError('INVALID_AMOUNT', `Penalty must be between 0 and ${MAX_PENALTY_CENTS / 100} EGP`, HttpStatus.BAD_REQUEST);
    const actor: ActorContext = p.kind === 'user' ? { actorType: 'STAFF', actorId: p.userId, name: p.name } : SYSTEM_ACTOR;
    const userId = principalUserId(p);
    const result = await this.workflow.run(async (tx) => {
      const [a] = await tx.select().from(deliveryAttempts).where(eq(deliveryAttempts.id, attemptId)).for('update').limit(1);
      if (!a) throw notFound('Attempt', attemptId);
      if (a.disputeStatus !== 'DISPUTED') throw new DomainError('DISPUTE_NOT_OPEN', 'This attempt has no open dispute', HttpStatus.CONFLICT, { disputeStatus: a.disputeStatus });
      const o = await this.workflow.lock(tx, a.orderId);
      await tx.update(deliveryAttempts).set({ disputeStatus: dto.decision }).where(eq(deliveryAttempts.id, a.id));
      let adjustmentId: string | null = null;
      if (dto.decision === 'UPHELD') {
        if (penalty > 0) {
          const adj = await this.adjustments.createInTx(tx, {
            courierId: a.courierId, type: 'PENALTY', amountCents: penalty, orderId: o.id,
            reason: `Disputed attempt #${a.attemptNo} on ${o.trackingNumber} upheld: ${dto.note.trim()}`,
          }, userId);
          adjustmentId = adj.id;
        }
        await tx
          .update(orders)
          .set({ priority: sql`greatest(${orders.priority}, ${REDELIVERY_PRIORITY})`, maxAttempts: sql`${orders.maxAttempts} + 1`, tags: withTag(o.tags, 'REDELIVERY_PRIORITY') })
          .where(eq(orders.id, o.id));
      }
      await this.workflow.addNote(tx, o, actor, {
        reason: dto.decision === 'UPHELD' ? 'ATTEMPT_DISPUTE_UPHELD' : 'ATTEMPT_DISPUTE_REJECTED',
        note: `Dispute on attempt #${a.attemptNo} ${dto.decision === 'UPHELD' ? 'upheld — re-delivery prioritised' : 'rejected'}: ${dto.note.trim()}`,
        metadata: { attemptId: a.id, penaltyCents: penalty, adjustmentId },
      });
      const open = await tx.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.orderId, o.id), eq(tickets.category, 'ATTEMPT_DISPUTE'), inArray(tickets.status, OPEN_STATUSES)));
      for (const t of open) {
        await tx.update(tickets).set({ status: 'RESOLVED', resolvedAt: new Date() }).where(eq(tickets.id, t.id));
        await tx.insert(ticketMessages).values({
          ticketId: t.id, authorId: userId, authorType: 'STAFF', authorName: p.name, isInternal: true,
          body: `Dispute ${dto.decision.toLowerCase()}${penalty ? ` with a ${(penalty / 100).toFixed(2)} EGP penalty` : ''}: ${dto.note.trim()}`,
        });
      }
      await this.audit.record(p, { action: 'integrity.dispute_resolve', entity: 'DeliveryAttempt', entityId: a.id, before: { disputeStatus: 'DISPUTED' }, after: { decision: dto.decision, penaltyCents: penalty, adjustmentId, note: dto.note } }, meta, tx);
      return { attemptId: a.id, orderId: o.id, disputeStatus: dto.decision, penaltyCents: penalty, adjustmentId, ticketsResolved: open.length };
    });
    return result;
  }
}
