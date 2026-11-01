import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { formatEgp, isTerminal, type ConfirmationStatus, type OrderStatus } from '@goturtle/shared';
import type { Db, Tx } from '../../db/client';
import { brands, customers, orders } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { JobsService } from '../../core/jobs.service';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import { SYSTEM_ACTOR, type ActorContext } from '../../common/actor';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday } from '../../db/helpers';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import { OrdersService } from '../orders/orders.service';
import { CustomersService } from '../customers/customers.service';
import type { OrderRow } from '../orders/order-factory.service';
import { addDays, affected, assertDayInRange, auditPrincipal, endOfCairoDay, type PostCommit } from '../orders/ops-kit';
import { NotificationsService, type OutboundChannel } from '../notifications/notifications.service';
import type { TemplateName, TemplateVars } from '../notifications/templates';
import { HoldsService } from './holds.service';
import { BEFORE_PICKUP, HOLDABLE, HoldReason, PRE_DISPATCH, signLink, trackingLink } from './integrity.util';

export type ConfirmationAction = 'CONFIRM' | 'RESCHEDULE' | 'DECLINE';
/** How the answer reached us (stored in orders.confirmationChannel). */
export type ResponseChannel = 'LINK' | 'TRACKING' | 'WHATSAPP' | 'SMS' | 'PHONE';

export interface RespondInput {
  action: ConfirmationAction;
  date?: string | null;
  note?: string | null;
  channel: ResponseChannel;
  actor: ActorContext;
  meta?: RequestMetaInfo | null;
}

export interface RespondResult {
  orderId: string;
  trackingNumber: string;
  action: ConfirmationAction;
  changed: boolean;
  confirmationStatus: ConfirmationStatus;
  status: OrderStatus;
  scheduledDate: string | null;
}

const BATCH = 100;
/** Orders older than this never get a confirmation request (feature rollout / stale parcels). */
const MAX_AGE_MS = 14 * 24 * 3_600_000;
export const CONFIRM_LINK_TTL_MS = 7 * 24 * 3_600_000;
/** Pre-dispatch statuses (and holds/failed attempts) in which the customer can still answer. */
const ANSWERABLE: readonly OrderStatus[] = [...PRE_DISPATCH, 'ASSIGNED', 'ON_HOLD', 'FAILED_ATTEMPT', 'RESCHEDULED'];

/**
 * RTO shield: risky COD parcels are confirmed by the recipient before they
 * are dispatched. The `integrity.confirmations` job (every 5 min, batches of
 * 100) asks, expires unanswered requests (NO_RESPONSE → ON_HOLD UNCONFIRMED
 * above the hold threshold), releases paid prepay holds and sends declined
 * parcels that reached the hub back to the brand.
 */
@Injectable()
export class ConfirmationService implements OnModuleInit {
  private readonly log = new Logger('IntegrityConfirmations');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly workflow: OrderWorkflowService,
    private readonly ordersService: OrdersService,
    private readonly customers: CustomersService,
    private readonly notifications: NotificationsService,
    private readonly holds: HoldsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.jobs.register({ name: 'integrity.confirmations', everySeconds: 300, timeoutSeconds: 100, run: () => this.runJob() });
  }

  async runJob(): Promise<string> {
    const asked = await this.requestDue();
    const expired = await this.expireDue();
    const released = await this.holds.sweepPrepaid();
    const returned = await this.returnDeclinedAtHub();
    return `asked ${asked}, no-response ${expired.noResponse} (held ${expired.held}), prepaid released ${released}, declined returned ${returned}`;
  }

  // ------------------------------------------------------------------ job steps

  /** Qualifying COD orders → PENDING + confirm_delivery message (optionally only some orders). */
  async requestDue(now = new Date(), only?: string[]): Promise<number> {
    const s = await this.holds.config();
    if (!s.confirmationEnabled) return 0;
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(
        and(
          eq(orders.confirmationStatus, 'NOT_REQUIRED'),
          eq(orders.paymentMethod, 'COD'),
          sql`${orders.codAmountCents} > 0`,
          inArray(orders.type, ['DELIVERY', 'EXCHANGE']),
          inArray(orders.status, [...PRE_DISPATCH]),
          gte(orders.createdAt, new Date(now.getTime() - MAX_AGE_MS)),
          only?.length ? inArray(orders.id, only) : undefined,
          or(
            gte(orders.riskScore, s.confirmAboveRisk),
            gte(orders.codAmountCents, s.confirmCodAboveCents),
            eq(customers.requirePrepayment, true),
            eq(customers.isBlocked, true),
          ),
        ),
      )
      .orderBy(asc(orders.createdAt))
      .limit(BATCH);
    let asked = 0;
    for (const r of rows) {
      try {
        if (await this.request(r.id, s.confirmationChannel, now)) asked++;
      } catch (err) {
        this.log.warn(`confirmation request failed for ${r.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return asked;
  }

  /** Claims one order (NOT_REQUIRED → PENDING) and queues the message in the same transaction. */
  private async request(orderId: string, channel: OutboundChannel, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const res = await tx
        .update(orders)
        .set({ confirmationStatus: 'PENDING', confirmationRequestedAt: now, confirmationRespondedAt: null, confirmationChannel: channel })
        .where(and(eq(orders.id, orderId), eq(orders.confirmationStatus, 'NOT_REQUIRED')));
      if (affected(res) !== 1) return false;
      const o = await this.workflow.lock(tx, orderId);
      await this.sendConfirmation(tx, o, channel, now);
      await this.workflow.addNote(tx, o, SYSTEM_ACTOR, { reason: 'CONFIRMATION_REQUESTED', note: `Delivery confirmation requested by ${channel}`, metadata: { channel, riskScore: o.riskScore } });
      return true;
    });
  }

  private async sendConfirmation(tx: Tx | Db, o: OrderRow, channel: OutboundChannel, now = new Date()) {
    const [b] = await tx.select({ name: brands.name }).from(brands).where(eq(brands.id, o.brandId)).limit(1);
    const token = signLink(o.trackingNumber, 'confirm', CONFIRM_LINK_TTL_MS, '', now.getTime());
    await this.notifications.queue(
      {
        channel,
        to: o.recipientPhone,
        template: 'confirm_delivery',
        locale: 'ar',
        orderId: o.id,
        vars: { brand: b?.name ?? '', tn: o.trackingNumber, amount: formatEgp(o.collectCents, 'ar'), link: trackingLink(o.trackingNumber, { c: token }) },
        data: { kind: 'confirmation', trackingNumber: o.trackingNumber },
      },
      tx,
    );
  }

  /** PENDING longer than noResponseAfterHours → NO_RESPONSE (+ ON_HOLD UNCONFIRMED when risky). */
  async expireDue(now = new Date(), only?: string[]): Promise<{ noResponse: number; held: number }> {
    const s = await this.holds.config();
    const cutoff = new Date(now.getTime() - s.noResponseAfterHours * 3_600_000);
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.confirmationStatus, 'PENDING'), lt(orders.confirmationRequestedAt, cutoff), only?.length ? inArray(orders.id, only) : undefined))
      .orderBy(asc(orders.confirmationRequestedAt))
      .limit(BATCH);
    let noResponse = 0;
    let held = 0;
    for (const r of rows) {
      try {
        const out = await this.workflow.run(async (tx, fx) => {
          const o = await this.workflow.lock(tx, r.id);
          if (o.confirmationStatus !== 'PENDING') return null;
          await tx.update(orders).set({ confirmationStatus: 'NO_RESPONSE' }).where(eq(orders.id, o.id));
          await this.workflow.addNote(tx, o, SYSTEM_ACTOR, { reason: 'CONFIRMATION_NO_RESPONSE', note: `No reply to the confirmation request within ${s.noResponseAfterHours} h` });
          if (!isTerminal(o.status) && o.riskScore >= s.holdUnconfirmedAboveRisk && HOLDABLE.includes(o.status)) {
            await this.holds.hold(tx, fx, o.id, HoldReason.UNCONFIRMED, SYSTEM_ACTOR, `Held: risk ${o.riskScore} and no customer confirmation within ${s.noResponseAfterHours} h`);
            return 'held';
          }
          return 'expired';
        });
        if (out) noResponse++;
        if (out === 'held') held++;
      } catch (err) {
        this.log.warn(`confirmation expiry failed for ${r.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { noResponse, held };
  }

  /** Declined parcels that were still on their way to the hub go back to the brand once scanned in. */
  async returnDeclinedAtHub(): Promise<number> {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.confirmationStatus, 'DECLINED'), eq(orders.status, 'RECEIVED_AT_HUB')))
      .limit(BATCH);
    let n = 0;
    for (const r of rows) {
      try {
        await this.workflow.transition(r.id, 'RETURN_PENDING', SYSTEM_ACTOR, { reason: 'CUSTOMER_DECLINED', note: 'The customer declined the delivery — returning to the brand' });
        n++;
      } catch (err) {
        this.log.warn(`declined return failed for ${r.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ answers

  /**
   * Applies the customer's answer (signed link, tracking session, WhatsApp/SMS
   * reply or a call recorded by staff). Idempotent: repeating an answer is a no-op.
   */
  async respond(orderId: string, input: RespondInput): Promise<RespondResult> {
    const result = await this.workflow.run(async (tx, fx) => {
      const o = await this.workflow.lock(tx, orderId);
      if (isTerminal(o.status) || o.status === 'RETURN_PENDING' || o.status === 'RETURN_OUT' || o.status === 'DAMAGED') {
        throw new DomainError('CONFIRMATION_CLOSED', 'This shipment can no longer be changed', HttpStatus.CONFLICT, { status: o.status });
      }
      if (!ANSWERABLE.includes(o.status)) {
        throw new DomainError('CONFIRMATION_CLOSED', 'The parcel is already out for delivery — talk to the hero at the door', HttpStatus.CONFLICT, { status: o.status });
      }
      const now = new Date();
      const base = { confirmationRespondedAt: now, confirmationChannel: input.channel };
      const actor = input.actor;
      const noteSuffix = input.note?.trim() ? ` — ${input.note.trim()}` : '';
      switch (input.action) {
        case 'CONFIRM': {
          if (o.confirmationStatus === 'CONFIRMED') return this.result(o, input.action, false);
          if (o.confirmationStatus === 'DECLINED') {
            throw new DomainError('CONFIRMATION_CLOSED', 'You already declined this delivery — contact the seller', HttpStatus.CONFLICT, { confirmationStatus: o.confirmationStatus });
          }
          await tx.update(orders).set({ ...base, confirmationStatus: 'CONFIRMED' }).where(eq(orders.id, o.id));
          await this.workflow.addNote(tx, o, actor, { reason: 'CONFIRMATION_CONFIRMED', note: `Customer confirmed the delivery (${input.channel})${noteSuffix}`, isPublic: true, metadata: { channel: input.channel } });
          const cur = await this.releaseUnconfirmed(tx, fx, o);
          return this.result({ ...cur, confirmationStatus: 'CONFIRMED' }, input.action, true);
        }
        case 'RESCHEDULE': {
          const day = input.date ?? addDays(cairoToday(), 1);
          assertDayInRange(day, { minOffset: 1, maxOffset: 7, field: 'date' });
          if (o.confirmationStatus === 'DECLINED') {
            throw new DomainError('CONFIRMATION_CLOSED', 'You already declined this delivery — contact the seller', HttpStatus.CONFLICT, { confirmationStatus: o.confirmationStatus });
          }
          if (o.confirmationStatus === 'RESCHEDULED' && o.scheduledDate === day) return this.result(o, input.action, false);
          await tx.update(orders).set({ ...base, confirmationStatus: 'RESCHEDULED' }).where(eq(orders.id, o.id));
          const note = `Customer asked for delivery on ${day} (${input.channel})${noteSuffix}`;
          let cur = await this.releaseUnconfirmed(tx, fx, o);
          if (cur.status === 'FAILED_ATTEMPT') {
            cur = await this.workflow.apply(tx, fx, o.id, 'RESCHEDULED', actor, { scheduledDate: day, reason: 'CUSTOMER_RESCHEDULED', note });
          } else {
            if (cur.status === 'ASSIGNED') {
              const runsheetId = cur.runsheetId;
              cur = await this.workflow.apply(tx, fx, o.id, 'RECEIVED_AT_HUB', SYSTEM_ACTOR, { clearRunsheet: true, reason: 'CUSTOMER_RESCHEDULED', isPublic: false, note: 'Removed from runsheet: customer rescheduled' });
              if (runsheetId) await this.ordersService.refreshRunsheetCod(tx, runsheetId);
            }
            await tx.update(orders).set({ scheduledDate: day, promisedBy: endOfCairoDay(day) }).where(eq(orders.id, o.id));
            await this.workflow.addNote(tx, cur, actor, { reason: 'CUSTOMER_RESCHEDULED', note, isPublic: true, metadata: { scheduledDate: day, channel: input.channel } });
            cur = { ...cur, scheduledDate: day };
          }
          return this.result({ ...cur, confirmationStatus: 'RESCHEDULED' }, input.action, true);
        }
        case 'DECLINE': {
          if (o.confirmationStatus === 'DECLINED') return this.result(o, input.action, false);
          await tx.update(orders).set({ ...base, confirmationStatus: 'DECLINED' }).where(eq(orders.id, o.id));
          await this.customers.recordRefused(tx, o.customerId);
          const note = `Customer declined the delivery (${input.channel})${noteSuffix}`;
          await this.workflow.addNote(tx, o, actor, { reason: 'CONFIRMATION_DECLINED', note, isPublic: true, metadata: { channel: input.channel } });
          const by: ActorContext = { ...SYSTEM_ACTOR, name: `${actor.name} (customer declined)` };
          let cur: OrderRow = o;
          const beforePickup = BEFORE_PICKUP.includes(o.status) || (o.status === 'ON_HOLD' && !o.pickedUpAt);
          if (beforePickup) {
            cur = await this.workflow.apply(tx, fx, o.id, 'CANCELLED', by, { reason: 'CUSTOMER_DECLINED', note });
          } else if (o.status !== 'PICKED_UP') {
            // PICKED_UP parcels are still in the van: the job returns them once the hub scans them in.
            if (o.status === 'ASSIGNED') {
              const runsheetId = o.runsheetId;
              cur = await this.workflow.apply(tx, fx, o.id, 'RECEIVED_AT_HUB', SYSTEM_ACTOR, { clearRunsheet: true, reason: 'CUSTOMER_DECLINED', isPublic: false, note: 'Removed from runsheet: customer declined' });
              if (runsheetId) await this.ordersService.refreshRunsheetCod(tx, runsheetId);
            }
            cur = await this.workflow.apply(tx, fx, o.id, 'RETURN_PENDING', by, { reason: 'CUSTOMER_DECLINED', note });
          }
          return this.result({ ...cur, confirmationStatus: 'DECLINED' }, input.action, true);
        }
      }
    });
    if (result.changed) {
      await this.audit.record(auditPrincipal(input.actor), {
        action: `order.confirmation_${input.action.toLowerCase()}`, entity: 'Order', entityId: orderId, after: { channel: input.channel, confirmationStatus: result.confirmationStatus, status: result.status, scheduledDate: result.scheduledDate },
      }, input.meta ?? null);
    }
    return result;
  }

  private async releaseUnconfirmed(tx: Tx, fx: PostCommit, o: OrderRow): Promise<OrderRow> {
    if (o.status !== 'ON_HOLD' || o.holdReason !== HoldReason.UNCONFIRMED) return o;
    return this.holds.releaseInTx(tx, fx, o.id, SYSTEM_ACTOR, 'Customer confirmed — released for dispatch', { reason: 'CONFIRMED' });
  }

  private result(o: Pick<OrderRow, 'id' | 'trackingNumber' | 'confirmationStatus' | 'status' | 'scheduledDate'>, action: ConfirmationAction, changed: boolean): RespondResult {
    return { orderId: o.id, trackingNumber: o.trackingNumber, action, changed, confirmationStatus: o.confirmationStatus, status: o.status, scheduledDate: o.scheduledDate };
  }

  // ------------------------------------------------------------------ staff tools

  /** Re-sends the confirmation message (starts a request when none was sent yet). */
  async resend(orderId: string, actor: ActorContext, meta: RequestMetaInfo) {
    const s = await this.holds.config();
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o) throw notFound('Order', orderId);
    if (!['NOT_REQUIRED', 'PENDING', 'NO_RESPONSE'].includes(o.confirmationStatus) || !ANSWERABLE.includes(o.status)) {
      throw new DomainError('CONFIRMATION_CLOSED', 'This order does not need a confirmation any more', HttpStatus.CONFLICT, { confirmationStatus: o.confirmationStatus, status: o.status });
    }
    if (await this.notifications.recentlySent(o.id, 'confirm_delivery', 10 * 60_000)) {
      throw new DomainError('TOO_SOON', 'A confirmation message was sent less than 10 minutes ago', HttpStatus.TOO_MANY_REQUESTS);
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({ confirmationStatus: 'PENDING', confirmationRequestedAt: now, confirmationChannel: s.confirmationChannel })
        .where(eq(orders.id, o.id));
      await this.sendConfirmation(tx, o, s.confirmationChannel, now);
      await this.workflow.addNote(tx, o, actor, { reason: 'CONFIRMATION_REQUESTED', note: `Confirmation re-sent by ${actor.name}`, metadata: { channel: s.confirmationChannel } });
      await this.audit.record(auditPrincipal(actor), { action: 'integrity.confirmation_resend', entity: 'Order', entityId: o.id }, meta, tx);
    });
    return { ok: true, orderId: o.id, confirmationStatus: 'PENDING' as const };
  }

  /** Acknowledgement after a WhatsApp / SMS reply, on the same channel. */
  async acknowledge(channel: OutboundChannel, to: string, orderId: string, template: TemplateName, vars: TemplateVars) {
    await this.notifications.queue({ channel, to, template, vars, locale: 'ar', orderId, data: { kind: 'inbound_ack' } });
  }
}
