import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { ROLE_PERMISSIONS, type Permission } from '@goturtle/shared';
import type { Request } from 'express';
import { ACCESS, IS_PUBLIC, type AccessRule } from '../../common/decorators';
import { actorKind, type Principal } from '../../common/principal';
import { config } from '../../config';
import { InjectDb } from '../../core/database.module';
import type { Db } from '../../db/client';
import { apiKeys, brands, couriers, users } from '../../db/schema';
import { sha256 } from '../../common/crypto';

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
  role: string;
}

export interface CustomerTokenPayload {
  sub: string; // phone (E.164)
  typ: 'customer';
  cid: string | null; // customer id
  tn: string | null; // tracking number the session was opened for
  name: string;
}

const CACHE_TTL_MS = 15_000;

/**
 * Global guard: authenticates (JWT access token, customer token or brand API
 * key) and authorises against @Public / @Access metadata. Routes with neither
 * are staff-only.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cache = new Map<string, { at: number; principal: Principal | null }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectDb() private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS, [ctx.getHandler(), ctx.getClass()]);

    let principal: Principal | null = null;
    try {
      principal = await this.authenticate(req);
    } catch (err) {
      if (!isPublic) throw err;
    }
    if (principal) req.principal = principal;
    if (isPublic) return true;
    if (!principal) throw new UnauthorizedException('Authentication required');

    const actors = rule?.actors ?? ['staff'];
    if (!actors.includes(actorKind(principal))) throw new ForbiddenException('This endpoint is not available for your account type');

    const needed = rule?.permissions ?? [];
    if (needed.length && principal.kind !== 'customer' && !(principal.kind === 'user' && principal.actorType === 'COURIER')) {
      const missing = needed.filter((p) => !principal!.permissions.includes(p));
      if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }

  private async authenticate(req: Request): Promise<Principal | null> {
    const header = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];
    let token: string | null = null;
    if (typeof apiKeyHeader === 'string' && apiKeyHeader) return this.fromApiKey(apiKeyHeader);
    if (header?.startsWith('Bearer ')) token = header.slice(7).trim();
    if (!token) return null;
    if (token.startsWith('gt_')) return this.fromApiKey(token);

    let payload: AccessTokenPayload | CustomerTokenPayload;
    try {
      payload = await this.jwt.verifyAsync(token, { secret: config.jwt.accessSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ === 'customer') {
      return {
        kind: 'customer',
        customerId: payload.cid,
        phone: payload.sub,
        name: payload.name,
        actorType: 'CUSTOMER',
        trackingNumber: payload.tn,
        permissions: [],
      };
    }
    if (payload.typ !== 'access') throw new UnauthorizedException('Invalid token type');
    const principal = await this.loadUser(payload.sub);
    if (!principal) throw new UnauthorizedException('Account is not active');
    return principal;
  }

  /** Clears the cached principal (call after role/status changes). */
  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  private async loadUser(userId: string): Promise<Principal | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.principal;

    const [row] = await this.db
      .select({ user: users, courierId: couriers.id, courierStatus: couriers.status, brandStatus: brands.status })
      .from(users)
      .leftJoin(couriers, eq(couriers.userId, users.id))
      .leftJoin(brands, eq(brands.id, users.brandId))
      .where(eq(users.id, userId))
      .limit(1);

    let principal: Principal | null = null;
    if (row && row.user.status === 'ACTIVE') {
      const role = row.user.role;
      const actorType = role === 'COURIER' ? 'COURIER' : role === 'BRAND_OWNER' || role === 'BRAND_STAFF' ? 'BRAND' : 'STAFF';
      const blocked =
        (actorType === 'COURIER' && (!row.courierId || row.courierStatus === 'OFFBOARDED' || row.courierStatus === 'SUSPENDED')) ||
        (actorType === 'BRAND' && row.brandStatus === 'SUSPENDED');
      if (!blocked) {
        principal = {
          kind: 'user',
          userId: row.user.id,
          name: row.user.name,
          role,
          actorType,
          brandId: row.user.brandId,
          courierId: row.courierId ?? null,
          hubId: row.user.hubId,
          permissions: ROLE_PERMISSIONS[role],
        };
      }
    }
    this.cache.set(userId, { at: Date.now(), principal });
    if (this.cache.size > 5000) this.cache.clear();
    return principal;
  }

  private async fromApiKey(raw: string): Promise<Principal> {
    const [row] = await this.db
      .select({ key: apiKeys, brandStatus: brands.status })
      .from(apiKeys)
      .innerJoin(brands, eq(brands.id, apiKeys.brandId))
      .where(eq(apiKeys.keyHash, sha256(raw)))
      .limit(1);
    if (!row || row.key.revokedAt) throw new UnauthorizedException('Invalid API key');
    if (row.brandStatus !== 'ACTIVE') throw new ForbiddenException('Brand account is not active');

    // Touch lastUsedAt at most once a minute.
    if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000) {
      void this.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id)).catch(() => undefined);
    }
    const brandPerms = ROLE_PERMISSIONS.BRAND_STAFF;
    const scopes = row.key.scopes ?? [];
    const permissions: Permission[] = scopes.includes('*') ? [...brandPerms] : brandPerms.filter((p) => scopes.includes(p));
    return { kind: 'apiKey', apiKeyId: row.key.id, name: row.key.name, brandId: row.key.brandId, actorType: 'API', permissions };
  }
}
