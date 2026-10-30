import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { OtpPurpose } from '@goturtle/shared';
import type { Db, DbOrTx } from '../db/client';
import { otpCodes } from '../db/schema';
import { InjectDb } from './database.module';
import { randomOtp, safeEqual, sha256 } from '../common/crypto';
import { DomainError } from '../common/errors';
import { CoreEvents, type OtpRequestedEvent } from './events';
import { config } from '../config';

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 45;

/**
 * One-time codes for customer tracking login, delivery confirmation and
 * password resets. Codes are stored hashed; delivery is done by the
 * notifications module listening to `otp.requested`.
 */
@Injectable()
export class OtpService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventEmitter2,
  ) {}

  /** Creates (and sends) a code. Returns it only when config.exposeOtp (dev/test). */
  async issue(phone: string, purpose: OtpPurpose, opts: { orderId?: string | null; locale?: 'ar' | 'en'; send?: boolean; tx?: DbOrTx } = {}) {
    const db = opts.tx ?? this.db;
    // Delivery codes are per order: a customer can have several parcels out at once.
    const scope = and(
      eq(otpCodes.phone, phone),
      eq(otpCodes.purpose, purpose),
      isNull(otpCodes.consumedAt),
      opts.orderId ? eq(otpCodes.orderId, opts.orderId) : undefined,
    );
    const [recent] = await db
      .select({ createdAt: otpCodes.createdAt })
      .from(otpCodes)
      .where(scope)
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000 && purpose !== 'DELIVERY') {
      throw new DomainError('OTP_COOLDOWN', `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting a new code`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomOtp(purpose === 'DELIVERY' ? 4 : 6);
    // Invalidate older open codes of the same purpose so only the latest works.
    await db.update(otpCodes).set({ consumedAt: new Date() }).where(scope);
    await db.insert(otpCodes).values({
      phone,
      purpose,
      orderId: opts.orderId ?? null,
      codeHash: sha256(`${phone}:${purpose}:${code}`),
      // Delivery codes live for the whole day the parcel is out.
      expiresAt: new Date(Date.now() + (purpose === 'DELIVERY' ? 24 * 60 : TTL_MINUTES) * 60_000),
    });
    if (opts.send !== false) {
      this.events.emit(CoreEvents.OtpRequested, { phone, code, purpose, orderId: opts.orderId ?? null, locale: opts.locale } satisfies OtpRequestedEvent);
    }
    return { expiresInMinutes: purpose === 'DELIVERY' ? 24 * 60 : TTL_MINUTES, devCode: config.exposeOtp ? code : undefined, code };
  }

  /** Verifies and consumes a code. Throws OTP_INVALID / OTP_EXPIRED / OTP_LOCKED. */
  async verify(phone: string, purpose: OtpPurpose, code: string, opts: { orderId?: string | null; tx?: DbOrTx } = {}): Promise<void> {
    const db = opts.tx ?? this.db;
    const conds = [eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, new Date())];
    if (opts.orderId) conds.push(eq(otpCodes.orderId, opts.orderId));
    const [row] = await db.select().from(otpCodes).where(and(...conds)).orderBy(desc(otpCodes.createdAt)).limit(1);
    if (!row) throw new DomainError('OTP_EXPIRED', 'Code expired or not requested', HttpStatus.BAD_REQUEST);
    if (row.attempts >= MAX_ATTEMPTS) throw new DomainError('OTP_LOCKED', 'Too many attempts, request a new code', HttpStatus.TOO_MANY_REQUESTS);

    const ok = safeEqual(row.codeHash, sha256(`${phone}:${purpose}:${String(code).trim()}`));
    if (!ok) {
      await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, row.id));
      throw new DomainError('OTP_INVALID', 'Invalid code', HttpStatus.BAD_REQUEST);
    }
    await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
  }
}
