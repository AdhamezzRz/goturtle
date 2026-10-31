import { HttpStatus, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { ROLE_PERMISSIONS } from '@goturtle/shared';
import type { Db } from '../../db/client';
import { apiKeys, brands, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { randomToken, sha256 } from '../../common/crypto';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { brandScope, principalUserId, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import type { ApiKeysQueryDto, CreateApiKeyDto } from './api-keys.dto';

export const MAX_ACTIVE_KEYS = 10;
export const KEY_PREFIX = 'gt_live_';
const PREFIX_LENGTH = 14;

/** Scopes an API key can carry: any brand-staff permission, or '*' for all of them. */
export const API_KEY_SCOPES = [...ROLE_PERMISSIONS.BRAND_STAFF];

/**
 * Brand API keys. The raw key (`gt_live_<43 chars>`) is shown once; only its
 * SHA-256 and a 14-char display prefix are stored. AuthGuard authenticates
 * `X-Api-Key` / `Authorization: Bearer gt_…` by hash lookup.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  scopes() {
    return { scopes: API_KEY_SCOPES, wildcard: '*' };
  }

  async list(p: Principal, q: ApiKeysQueryDto) {
    const scope = brandScope(p);
    const conds: SQL[] = [];
    if (scope) conds.push(eq(apiKeys.brandId, scope));
    else if (q.brandId) conds.push(eq(apiKeys.brandId, q.brandId));
    if (!q.includeRevoked) conds.push(isNull(apiKeys.revokedAt));
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({
          id: apiKeys.id, brandId: apiKeys.brandId, brandName: brands.name, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes,
          lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt, createdById: apiKeys.createdById, createdByName: users.name,
        })
        .from(apiKeys)
        .innerJoin(brands, eq(brands.id, apiKeys.brandId))
        .leftJoin(users, eq(users.id, apiKeys.createdById))
        .where(where)
        .orderBy(desc(apiKeys.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(apiKeys).where(where),
    ]);
    return paginate(rows.map((r) => ({ ...r, active: !r.revokedAt })), Number(n), q);
  }

  async create(brandId: string, dto: CreateApiKeyDto, actor: Principal, meta: RequestMetaInfo) {
    const scopes = normalizeScopes(dto.scopes);
    const created = await this.db.transaction(async (tx) => {
      // Lock the brand row so two concurrent creates cannot both pass the limit.
      await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).for('update');
      const [{ n }] = await tx.select({ n: count() }).from(apiKeys).where(and(eq(apiKeys.brandId, brandId), isNull(apiKeys.revokedAt)));
      if (Number(n) >= MAX_ACTIVE_KEYS) {
        throw new DomainError('API_KEY_LIMIT', `A brand can have at most ${MAX_ACTIVE_KEYS} active API keys — revoke one first`, HttpStatus.CONFLICT);
      }
      for (let attempt = 0; ; attempt++) {
        const raw = `${KEY_PREFIX}${randomToken(32)}`;
        const prefix = raw.slice(0, PREFIX_LENGTH);
        const [clash] = await tx.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.prefix, prefix)).limit(1);
        if (clash && attempt < 5) continue;
        const [row] = await tx
          .insert(apiKeys)
          .values({ brandId, name: dto.name.trim(), prefix, keyHash: sha256(raw), scopes, createdById: principalUserId(actor) })
          .$returningId();
        await this.audit.record(actor, { action: 'api_key.create', entity: 'ApiKey', entityId: row.id, after: { name: dto.name, prefix, scopes } }, meta, tx);
        return { id: row.id, raw, prefix };
      }
    });
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, created.id)).limit(1);
    const { keyHash: _h, ...safe } = row;
    void _h;
    return { ...safe, active: true, key: created.raw, warning: 'Copy this key now — it will not be shown again.' };
  }

  async revoke(id: string, actor: Principal, meta: RequestMetaInfo) {
    const scope = brandScope(actor);
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(scope ? and(eq(apiKeys.id, id), eq(apiKeys.brandId, scope)) : eq(apiKeys.id, id))
      .limit(1);
    if (!row) throw notFound('API key', id);
    if (!row.revokedAt) {
      const revokedAt = new Date();
      await this.db.update(apiKeys).set({ revokedAt }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
      await this.audit.record(actor, { action: 'api_key.revoke', entity: 'ApiKey', entityId: id, before: { revokedAt: null }, after: { revokedAt } }, meta);
    }
    const [after] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    const { keyHash: _h, ...safe } = after;
    void _h;
    return { ...safe, active: false };
  }
}

export function normalizeScopes(input: string[]): string[] {
  const unique = [...new Set(input.map((s) => s.trim()))];
  if (!unique.length) throw new DomainError('INVALID_SCOPES', 'Choose at least one scope', HttpStatus.BAD_REQUEST);
  if (unique.includes('*')) {
    if (unique.length > 1) throw new DomainError('INVALID_SCOPES', '"*" cannot be combined with other scopes', HttpStatus.BAD_REQUEST);
    return ['*'];
  }
  const invalid = unique.filter((s) => !(API_KEY_SCOPES as string[]).includes(s));
  if (invalid.length) {
    throw new DomainError('INVALID_SCOPES', `Unknown scopes: ${invalid.join(', ')}`, HttpStatus.BAD_REQUEST, { allowed: API_KEY_SCOPES });
  }
  return unique.sort();
}
