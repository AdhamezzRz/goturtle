import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { isValidTrackingNumber, normalizeEgyptPhone, normalizeTrackingNumber, ROLE_PERMISSIONS } from '@goturtle/shared';
import { config } from '../../config';
import type { Db } from '../../db/client';
import { brands, couriers, customers, orders, refreshTokens, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { OtpService } from '../../core/otp.service';
import { DomainError } from '../../common/errors';
import { randomToken, sha256 } from '../../common/crypto';
import { newId } from '../../db/columns';
import type { AccessTokenPayload, CustomerTokenPayload } from './auth.guard';
import type { RequestMetaInfo } from '../../common/decorators';

export const BCRYPT_ROUNDS = 10;
export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);

// A real bcrypt hash so failed lookups cost the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('goturtle-timing-equaliser', BCRYPT_ROUNDS);

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  async login(identifier: string, password: string, meta: RequestMetaInfo) {
    const id = identifier.trim();
    const phone = normalizeEgyptPhone(id);
    const [user] = await this.db
      .select()
      .from(users)
      .where(phone ? eq(users.phone, phone) : eq(users.email, id.toLowerCase()))
      .limit(1);

    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new DomainError('INVALID_CREDENTIALS', 'Wrong phone/email or password', HttpStatus.UNAUTHORIZED);
    if (user.status !== 'ACTIVE') throw new DomainError('ACCOUNT_DISABLED', 'Your account is not active. Contact GoTurtle support.', HttpStatus.FORBIDDEN);

    await this.assertLinkedAccountActive(user);
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const tokens = await this.issueTokens(user.id, user.role, newId(), meta);
    return { ...tokens, user: await this.profile(user.id) };
  }

  private async assertLinkedAccountActive(user: typeof users.$inferSelect) {
    if (user.role === 'COURIER') {
      const [c] = await this.db.select({ status: couriers.status }).from(couriers).where(eq(couriers.userId, user.id)).limit(1);
      if (!c) throw new DomainError('ACCOUNT_DISABLED', 'Hero profile missing', HttpStatus.FORBIDDEN);
      if (c.status === 'SUSPENDED' || c.status === 'OFFBOARDED') {
        throw new DomainError('ACCOUNT_DISABLED', 'Your hero account is suspended. Contact your hub manager.', HttpStatus.FORBIDDEN);
      }
    }
    if ((user.role === 'BRAND_OWNER' || user.role === 'BRAND_STAFF') && user.brandId) {
      const [b] = await this.db.select({ status: brands.status }).from(brands).where(eq(brands.id, user.brandId)).limit(1);
      if (b?.status === 'SUSPENDED') throw new DomainError('ACCOUNT_DISABLED', 'Brand account suspended', HttpStatus.FORBIDDEN);
    }
  }

  private async issueTokens(userId: string, role: string, family: string, meta: RequestMetaInfo) {
    const accessToken = await this.jwt.signAsync({ sub: userId, typ: 'access', role } satisfies AccessTokenPayload, {
      secret: config.jwt.accessSecret,
      expiresIn: config.jwt.accessTtl as never,
    });
    const refreshToken = `${newId()}.${randomToken(32)}`;
    await this.db.insert(refreshTokens).values({
      userId,
      tokenHash: sha256(refreshToken),
      family,
      expiresAt: new Date(Date.now() + config.jwt.refreshTtlDays * 86_400_000),
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    const decoded = this.jwt.decode(accessToken) as { exp: number };
    return { accessToken, refreshToken, expiresAt: new Date(decoded.exp * 1000).toISOString() };
  }

  /** Rotating refresh tokens with reuse detection. */
  async refresh(refreshToken: string, meta: RequestMetaInfo) {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(refreshToken))).limit(1);
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.revokedAt) {
      // A rotated token was replayed → assume theft, kill the whole family.
      await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.family, row.family), isNull(refreshTokens.revokedAt)));
      throw new UnauthorizedException('Refresh token reuse detected — please sign in again');
    }
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Session expired');

    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
    await this.assertLinkedAccountActive(user);

    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    return this.issueTokens(user.id, user.role, row.family, meta);
  }

  async logout(refreshToken: string) {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(refreshToken))).limit(1);
    if (row) await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.family, row.family), isNull(refreshTokens.revokedAt)));
    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    return { ok: true };
  }

  /** Session bootstrap payload for every portal. */
  async profile(userId: string) {
    const [row] = await this.db
      .select({
        user: users,
        brand: { id: brands.id, name: brands.name, code: brands.code, logoUrl: brands.logoUrl, status: brands.status },
        courier: {
          id: couriers.id, code: couriers.code, employmentType: couriers.employmentType, status: couriers.status,
          availability: couriers.availability, vehicleType: couriers.vehicleType, xp: couriers.xp, rating: couriers.rating,
          cashOnHandCents: couriers.cashOnHandCents, cashLimitCents: couriers.cashLimitCents,
        },
      })
      .from(users)
      .leftJoin(brands, eq(brands.id, users.brandId))
      .leftJoin(couriers, eq(couriers.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new UnauthorizedException();
    const { passwordHash: _omit, ...user } = row.user;
    void _omit;
    const portal = user.role === 'COURIER' ? 'hero' : user.role === 'BRAND_OWNER' || user.role === 'BRAND_STAFF' ? 'brand' : 'ops';
    return {
      ...user,
      portal,
      permissions: ROLE_PERMISSIONS[user.role],
      brand: row.brand?.id ? row.brand : null,
      courier: row.courier?.id ? row.courier : null,
    };
  }

  async changePassword(userId: string, current: string, next: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new DomainError('INVALID_CREDENTIALS', 'Current password is wrong', HttpStatus.BAD_REQUEST);
    }
    await this.db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
    await this.logoutAll(userId);
    return { ok: true };
  }

  async updateProfile(userId: string, dto: { name?: string; locale?: 'ar' | 'en'; avatarUrl?: string }) {
    await this.db.update(users).set(dto).where(eq(users.id, userId));
    return this.profile(userId);
  }

  // ---------------------------------------------------------------- customers

  /** Customer (consignee) login by SMS code — optionally tied to one shipment. */
  async customerOtpRequest(rawPhone: string, trackingNumber?: string) {
    const phone = normalizeEgyptPhone(rawPhone);
    if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    if (trackingNumber) await this.assertShipmentPhone(trackingNumber, phone);
    else {
      const [c] = await this.db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone)).limit(1);
      // Same response either way so the endpoint cannot be used to discover customers.
      if (!c) return { sent: true, expiresInMinutes: 10 };
    }
    const r = await this.otp.issue(phone, 'TRACKING');
    return { sent: true, expiresInMinutes: r.expiresInMinutes, devCode: r.devCode };
  }

  async customerOtpVerify(rawPhone: string, code: string, trackingNumber?: string) {
    const phone = normalizeEgyptPhone(rawPhone);
    if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    const tn = trackingNumber ? normalizeTrackingNumber(trackingNumber) : null;
    if (tn) await this.assertShipmentPhone(tn, phone);
    await this.otp.verify(phone, 'TRACKING', code);
    const [c] = await this.db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
    const payload: CustomerTokenPayload = { sub: phone, typ: 'customer', cid: c?.id ?? null, tn, name: c?.name ?? 'Customer' };
    const accessToken = await this.jwt.signAsync(payload, { secret: config.jwt.accessSecret, expiresIn: config.jwt.customerTtl as never });
    const decoded = this.jwt.decode(accessToken) as { exp: number };
    return { accessToken, expiresAt: new Date(decoded.exp * 1000).toISOString(), customer: { phone, name: payload.name, id: payload.cid } };
  }

  private async assertShipmentPhone(trackingNumber: string, phone: string) {
    const tn = normalizeTrackingNumber(trackingNumber);
    if (!isValidTrackingNumber(tn)) throw new DomainError('INVALID_TRACKING_NUMBER', 'Tracking number is not valid', HttpStatus.BAD_REQUEST);
    const [o] = await this.db
      .select({ recipientPhone: orders.recipientPhone, recipientAltPhone: orders.recipientAltPhone })
      .from(orders)
      .where(eq(orders.trackingNumber, tn))
      .limit(1);
    if (!o || (o.recipientPhone !== phone && o.recipientAltPhone !== phone)) {
      throw new DomainError('PHONE_MISMATCH', 'This phone number is not linked to the shipment', HttpStatus.BAD_REQUEST);
    }
  }

  // ---------------------------------------------------------- password reset

  async requestPasswordReset(rawPhone: string) {
    const phone = normalizeEgyptPhone(rawPhone);
    if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    const [u] = await this.db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    if (!u) return { sent: true, expiresInMinutes: 10 };
    const r = await this.otp.issue(phone, 'PASSWORD_RESET');
    return { sent: true, expiresInMinutes: r.expiresInMinutes, devCode: r.devCode };
  }

  async resetPassword(rawPhone: string, code: string, newPassword: string) {
    const phone = normalizeEgyptPhone(rawPhone);
    if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    await this.otp.verify(phone, 'PASSWORD_RESET', code);
    const [u] = await this.db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    if (!u) throw new DomainError('NOT_FOUND', 'Account not found', HttpStatus.NOT_FOUND);
    await this.db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, u.id));
    await this.logoutAll(u.id);
    return { ok: true };
  }
}
