import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { isValidTrackingNumber, normalizeTrackingNumber, type OrderStatus } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { couriers, orders, users, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { DomainError, notFound } from '../../common/errors';
import { actorFromPrincipal, type ActorContext } from '../../common/actor';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday } from '../../db/helpers';
import type { OrderRow } from '../orders/order-factory.service';
import { addDays, firstName } from '../orders/ops-kit';
import { AddressBookService } from '../address-book/address-book.service';
import { ConfirmationService } from './confirmation.service';
import { AttemptsService } from './attempts.service';
import { HoldsService } from './holds.service';
import { PIN_EDITABLE, PRE_DISPATCH, verifyLink, type LinkCheck } from './integrity.util';
import type { AttemptFeedbackDto, CustomerConfirmationDto, IntegrityStateQuery, PinDto } from './integrity.dto';

const CONFIRMABLE: OrderStatus[] = [...PRE_DISPATCH, 'ASSIGNED', 'ON_HOLD'];

const linkError = (check: LinkCheck) =>
  new DomainError(
    check.ok ? 'LINK_INVALID' : check.reason === 'EXPIRED' ? 'LINK_EXPIRED' : 'LINK_INVALID',
    check.ok || check.reason !== 'EXPIRED' ? 'This link is not valid — verify your phone number to continue' : 'This link has expired — verify your phone number to continue',
    HttpStatus.FORBIDDEN,
  );

/**
 * Customer self-service on the tracking page for delivery integrity. Every
 * action works with a signed link from our message (no login) or with a
 * verified customer session for the recipient phone.
 */
@Injectable()
export class CustomerActionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly confirmations: ConfirmationService,
    private readonly attempts: AttemptsService,
    private readonly holds: HoldsService,
    private readonly addressBook: AddressBookService,
  ) {}

  private async byTracking(raw: string): Promise<OrderRow> {
    const tn = normalizeTrackingNumber(raw);
    if (!isValidTrackingNumber(tn)) throw new DomainError('INVALID_TRACKING_NUMBER', 'Tracking number is not valid', HttpStatus.BAD_REQUEST);
    const [o] = await this.db.select().from(orders).where(eq(orders.trackingNumber, tn)).limit(1);
    if (!o) throw notFound('Shipment', tn);
    return o;
  }

  private owner(p: Principal | undefined, o: Pick<OrderRow, 'recipientPhone' | 'recipientAltPhone' | 'trackingNumber'>): boolean {
    return !!p && p.kind === 'customer' && (p.phone === o.recipientPhone || (!!o.recipientAltPhone && p.phone === o.recipientAltPhone)) && (!p.trackingNumber || p.trackingNumber === o.trackingNumber);
  }

  private actor(p: Principal | undefined, owner: boolean): ActorContext {
    return owner && p ? actorFromPrincipal(p) : { actorType: 'CUSTOMER', actorId: null, name: 'Customer (link)' };
  }

  /** What the tracking page should offer: confirmation, attempt verification, pin drop. */
  async state(raw: string, q: IntegrityStateQuery, p?: Principal) {
    const o = await this.byTracking(raw);
    const owner = this.owner(p, o);
    const confirmLink = q.c ? verifyLink(q.c, o.trackingNumber, 'confirm') : null;
    const pinLink = q.p ? verifyLink(q.p, o.trackingNumber, 'pin') : null;
    const attempt = await this.attempts.openAttempt(o.id);
    const attemptLink = q.a && attempt ? verifyLink(q.a, o.trackingNumber, 'attempt', attempt.id) : null;
    const s = await this.holds.config();
    let hero: string | null = null;
    if (attempt) {
      const [h] = await this.db.select({ name: users.name }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(eq(couriers.id, attempt.courierId)).limit(1);
      hero = firstName(h?.name);
    }
    const [z] = await this.db.select({ lat: zones.centerLat, lng: zones.centerLng }).from(zones).where(eq(zones.id, o.zoneId)).limit(1);
    const today = cairoToday();
    return {
      trackingNumber: o.trackingNumber,
      status: o.status,
      verified: owner,
      confirmation: {
        status: o.confirmationStatus,
        requestedAt: o.confirmationRequestedAt,
        respondedAt: o.confirmationRespondedAt,
        scheduledDate: o.scheduledDate,
        canRespond: CONFIRMABLE.includes(o.status) && ['PENDING', 'NO_RESPONSE'].includes(o.confirmationStatus),
        authorized: owner || !!confirmLink?.ok,
        link: confirmLink ? (confirmLink.ok ? 'VALID' : confirmLink.reason) : null,
        rescheduleRange: { min: addDays(today, 1), max: addDays(today, 7) },
        held: o.status === 'ON_HOLD' ? o.holdReason : null,
      },
      attempt: attempt
        ? {
            id: attempt.id,
            attemptNo: attempt.attemptNo,
            at: attempt.createdAt,
            failureReason: attempt.failureReason,
            heroFirstName: hero,
            disputeStatus: attempt.disputeStatus,
            windowEndsAt: new Date(attempt.createdAt.getTime() + s.attemptDisputeWindowHours * 3_600_000),
            canRespond: attempt.disputeStatus === 'NONE',
            authorized: owner || !!attemptLink?.ok,
            link: attemptLink ? (attemptLink.ok ? 'VALID' : attemptLink.reason) : null,
          }
        : null,
      pin: {
        hasPin: o.lat != null && o.lng != null,
        canDrop: PIN_EDITABLE.includes(o.status),
        authorized: owner || !!pinLink?.ok || !!confirmLink?.ok,
        link: pinLink ? (pinLink.ok ? 'VALID' : pinLink.reason) : null,
        center: owner && o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : z ? { lat: z.lat, lng: z.lng } : null,
      },
    };
  }

  async confirm(raw: string, dto: CustomerConfirmationDto, p: Principal | undefined, meta: RequestMetaInfo) {
    const o = await this.byTracking(raw);
    const owner = this.owner(p, o);
    if (!owner) {
      const check = verifyLink(dto.token, o.trackingNumber, 'confirm');
      if (!check.ok) throw linkError(check);
    }
    const out = await this.confirmations.respond(o.id, {
      action: dto.action, date: dto.date ?? null, note: dto.note ?? null, channel: owner ? 'TRACKING' : 'LINK', actor: this.actor(p, owner), meta,
    });
    return out;
  }

  async attemptFeedback(raw: string, dto: AttemptFeedbackDto, p: Principal | undefined) {
    const o = await this.byTracking(raw);
    const owner = this.owner(p, o);
    const attempt = await this.attempts.openAttempt(o.id, dto.attemptId ?? null);
    if (!attempt) throw new DomainError('DISPUTE_WINDOW_CLOSED', 'There is no recent delivery attempt to answer', HttpStatus.CONFLICT);
    if (!owner) {
      const check = verifyLink(dto.token, o.trackingNumber, 'attempt', attempt.id);
      if (!check.ok) throw linkError(check);
    }
    return this.attempts.feedback(o.id, { attemptId: attempt.id, answer: dto.answer, note: dto.note ?? null, channel: owner ? 'TRACKING' : 'LINK', actor: this.actor(p, owner) });
  }

  async pin(raw: string, dto: PinDto, p: Principal | undefined) {
    const o = await this.byTracking(raw);
    const owner = this.owner(p, o);
    if (!owner) {
      const pinCheck = verifyLink(dto.token, o.trackingNumber, 'pin');
      if (!pinCheck.ok && !verifyLink(dto.token, o.trackingNumber, 'confirm').ok) throw linkError(pinCheck);
    }
    return this.addressBook.applyPin(o.id, { lat: dto.lat, lng: dto.lng }, 'CUSTOMER_PIN', this.actor(p, owner));
  }
}
