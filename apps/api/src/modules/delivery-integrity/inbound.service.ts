import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { isTerminal, normalizeEgyptPhone, type InboundIntent } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { brands, inboundMessages, notifications, orders } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import type { ActorContext } from '../../common/actor';
import { DomainError } from '../../common/errors';
import { cairoToday } from '../../db/helpers';
import { isDuplicateOn } from '../orders/ops-kit';
import type { OrderRow } from '../orders/order-factory.service';
import type { OutboundChannel } from '../notifications/notifications.service';
import type { TemplateName, TemplateVars } from '../notifications/templates';
import { AddressBookService, PIN_LINK_TTL_MS } from '../address-book/address-book.service';
import { ConfirmationService, CONFIRM_LINK_TTL_MS } from './confirmation.service';
import { AttemptsService } from './attempts.service';
import { parseReply, signLink, trackingLink } from './integrity.util';

/** One normalised inbound message from any channel. */
export interface InboundInput {
  channel: Extract<OutboundChannel, 'WHATSAPP' | 'SMS'>;
  from: string;
  providerMessageId?: string | null;
  text?: string | null;
  location?: { lat: number; lng: number } | null;
  payload?: Record<string, unknown> | null;
}

export interface InboundOutcome {
  id: string | null;
  duplicate: boolean;
  orderId: string | null;
  intent: InboundIntent;
  applied: boolean;
  ack: TemplateName | null;
  error?: string;
}

type Context = 'confirm' | 'attempt' | 'pin';
const CONTEXT_TEMPLATES: Record<string, Context> = { confirm_delivery: 'confirm', attempt_verify: 'attempt', location_request: 'pin' };
/** A reply refers to a message we sent within this window. */
const CONTEXT_WINDOW_MS = 7 * 24 * 3_600_000;

/**
 * Customer replies by WhatsApp / SMS: every message is stored, matched to the
 * most relevant open order of that phone (the last confirmation / attempt
 * verification / location request we sent it), its intent is parsed
 * (1/2/3, Arabic & Franco yes/no/cancel/change-day, shared locations) and
 * applied idempotently, then acknowledged on the same channel.
 */
@Injectable()
export class InboundService {
  private readonly log = new Logger('IntegrityInbound');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly confirmations: ConfirmationService,
    private readonly attempts: AttemptsService,
    private readonly addressBook: AddressBookService,
  ) {}

  async handle(input: InboundInput): Promise<InboundOutcome> {
    const phone = normalizeEgyptPhone(input.from) ?? (input.from.startsWith('+') ? input.from : `+${input.from}`).slice(0, 20);
    let id: string;
    try {
      [{ id }] = await this.db
        .insert(inboundMessages)
        .values({
          channel: input.channel, fromPhone: phone, body: input.text?.slice(0, 4000) ?? null, providerMessageId: input.providerMessageId?.slice(0, 120) || null,
          intent: 'OTHER', payload: { ...(input.payload ?? {}), ...(input.location ? { location: input.location } : {}) },
        })
        .$returningId();
    } catch (err) {
      if (isDuplicateOn(err, 'providerMessageId') || isDuplicateOn(err, 'inbound_messages')) {
        return { id: null, duplicate: true, orderId: null, intent: 'OTHER', applied: false, ack: null };
      }
      throw err;
    }

    const outcome = await this.process(id, phone, input).catch((err): InboundOutcome => {
      const code = err instanceof DomainError ? err.code : 'ERROR';
      if (!(err instanceof DomainError)) this.log.error(`inbound ${id} failed: ${err instanceof Error ? err.stack : err}`);
      return { id, duplicate: false, orderId: null, intent: 'OTHER', applied: false, ack: null, error: code };
    });
    await this.db
      .update(inboundMessages)
      .set({ orderId: outcome.orderId, intent: outcome.intent, processedAt: new Date(), ...(outcome.error ? { payload: { ...(input.payload ?? {}), error: outcome.error } } : {}) })
      .where(eq(inboundMessages.id, id));
    return outcome;
  }

  /** The order and the question this phone is answering. */
  private async context(phone: string): Promise<{ order: OrderRow; context: Context } | null> {
    const sent = await this.db
      .select({ orderId: notifications.orderId, template: notifications.template })
      .from(notifications)
      .where(and(eq(notifications.recipient, phone), inArray(notifications.template, Object.keys(CONTEXT_TEMPLATES)), gte(notifications.createdAt, new Date(Date.now() - CONTEXT_WINDOW_MS))))
      .orderBy(desc(notifications.createdAt))
      .limit(10);
    for (const n of sent) {
      if (!n.orderId) continue;
      const [o] = await this.db.select().from(orders).where(eq(orders.id, n.orderId)).limit(1);
      if (!o || isTerminal(o.status) || (o.recipientPhone !== phone && o.recipientAltPhone !== phone)) continue;
      return { order: o, context: CONTEXT_TEMPLATES[n.template] };
    }
    // No outbound question on record: fall back to the phone's most relevant open order.
    const open = await this.db
      .select()
      .from(orders)
      .where(and(or(eq(orders.recipientPhone, phone), eq(orders.recipientAltPhone, phone)), inArray(orders.status, ['CREATED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'RECEIVED_AT_HUB', 'ASSIGNED', 'ON_HOLD', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RESCHEDULED'])))
      .orderBy(desc(orders.updatedAt))
      .limit(10);
    const pending = open.find((o) => ['PENDING', 'NO_RESPONSE'].includes(o.confirmationStatus));
    if (pending) return { order: pending, context: 'confirm' };
    const failed = open.find((o) => o.status === 'FAILED_ATTEMPT');
    if (failed) return { order: failed, context: 'attempt' };
    return open[0] ? { order: open[0], context: open[0].lat == null ? 'pin' : 'confirm' } : null;
  }

  private async process(id: string, phone: string, input: InboundInput): Promise<InboundOutcome> {
    const ctx = await this.context(phone);
    const base = { id, duplicate: false };
    if (!ctx) return { ...base, orderId: null, intent: input.location ? 'LOCATION' : 'OTHER', applied: false, ack: null };
    const { order: o } = ctx;
    const actor: ActorContext = { actorType: 'CUSTOMER', actorId: null, name: `Customer (${input.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'})` };
    const ack = async (template: TemplateName, vars: TemplateVars) => {
      await this.confirmations.acknowledge(input.channel, phone, o.id, template, { tn: o.trackingNumber, ...vars });
      return template;
    };

    if (input.location) {
      const pin = await this.addressBook.applyPin(o.id, input.location, 'WHATSAPP_LOCATION', actor);
      return { ...base, orderId: pin.orderId, intent: 'LOCATION', applied: true, ack: await ack('location_ack', {}) };
    }

    const reply = parseReply(input.text, cairoToday());
    if (ctx.context === 'attempt') {
      if (reply.kind === 'YES' || reply.kind === 'NO' || reply.kind === 'CHANGE') {
        // "1 correct, 2 not correct": option 2 is parsed as CHANGE in the confirmation vocabulary.
        const answer = reply.kind === 'YES' ? 'CONFIRM' : 'DISPUTE';
        const out = await this.attempts.feedback(o.id, { answer, channel: input.channel, actor, note: answer === 'DISPUTE' ? input.text?.slice(0, 500) : null });
        const link = trackingLink(o.trackingNumber);
        const template = answer === 'CONFIRM' ? await ack('attempt_ack', { link }) : await ack('dispute_ack', { code: out.ticketCode ?? '' });
        return { ...base, orderId: o.id, intent: answer === 'CONFIRM' ? 'ATTEMPT_TRUE' : 'ATTEMPT_FALSE', applied: out.changed, ack: template };
      }
      return { ...base, orderId: o.id, intent: 'OTHER', applied: false, ack: await ack('inbound_help', { link: trackingLink(o.trackingNumber) }) };
    }

    if (reply.kind === 'YES' || reply.kind === 'CHANGE' || reply.kind === 'CANCEL' || reply.kind === 'NO') {
      const action = reply.kind === 'YES' ? 'CONFIRM' : reply.kind === 'CHANGE' ? 'RESCHEDULE' : 'DECLINE';
      const out = await this.confirmations.respond(o.id, { action, date: reply.date ?? null, channel: input.channel, actor, note: null });
      const intent: InboundIntent = action === 'CONFIRM' ? 'CONFIRM' : action === 'RESCHEDULE' ? 'RESCHEDULE' : 'CANCEL';
      let template: TemplateName;
      if (action === 'CONFIRM') template = await ack('confirmation_ack', {});
      else if (action === 'RESCHEDULE') {
        const token = signLink(o.trackingNumber, 'confirm', CONFIRM_LINK_TTL_MS);
        template = await ack('reschedule_ack', { date: out.scheduledDate ?? '', link: trackingLink(o.trackingNumber, { c: token }) });
      } else {
        const [b] = await this.db.select({ name: brands.name }).from(brands).where(eq(brands.id, o.brandId)).limit(1);
        template = await ack('decline_ack', { brand: b?.name ?? '' });
      }
      return { ...base, orderId: o.id, intent, applied: out.changed, ack: template };
    }

    const link = ctx.context === 'pin'
      ? trackingLink(o.trackingNumber, { pin: '1', p: signLink(o.trackingNumber, 'pin', PIN_LINK_TTL_MS) })
      : trackingLink(o.trackingNumber, { c: signLink(o.trackingNumber, 'confirm', CONFIRM_LINK_TTL_MS) });
    return { ...base, orderId: o.id, intent: 'OTHER', applied: false, ack: await ack('inbound_help', { link }) };
  }

  /** Staff: recent inbound messages (for the integrity page / support). */
  async recent(limit = 50, unmatchedOnly = false) {
    return this.db
      .select()
      .from(inboundMessages)
      .where(unmatchedOnly ? isNull(inboundMessages.orderId) : undefined)
      .orderBy(desc(inboundMessages.createdAt))
      .limit(Math.min(200, Math.max(1, limit)));
  }
}
