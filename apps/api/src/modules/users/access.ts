import { ForbiddenException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Permission } from '@goturtle/shared';
import type { Principal } from '../../common/principal';
import type { users } from '../../db/schema';

/** Small access helpers shared by the platform modules (users, brands, keys, webhooks, integrations). */

export function userIdOf(p: Principal): string {
  if (p.kind !== 'user') throw new ForbiddenException('A user account is required');
  return p.userId;
}

export const isBrandUser = (p: Principal) => p.kind === 'user' && p.actorType === 'BRAND';
export const isBrandOwner = (p: Principal) => p.kind === 'user' && p.role === 'BRAND_OWNER';

/** The caller's brand id for brand users (throws for anyone else). */
export function requireBrandId(p: Principal): string {
  if (p.kind === 'user' && p.actorType === 'BRAND' && p.brandId) return p.brandId;
  if (p.kind === 'apiKey') return p.brandId;
  throw new ForbiddenException('Brand account required');
}

export function requireBrandOwner(p: Principal): { userId: string; brandId: string } {
  if (p.kind === 'user' && p.role === 'BRAND_OWNER' && p.brandId) return { userId: p.userId, brandId: p.brandId };
  throw new ForbiddenException('Only the brand owner can do this');
}

export function hasPermission(p: Principal, perm: Permission): boolean {
  return p.kind !== 'customer' && p.permissions.includes(perm);
}

/**
 * Different permission per actor kind on one route, e.g. staff need
 * `brands.read` while brand users need `integrations.manage`.
 */
export function assertPermission(p: Principal, rule: { staff?: Permission; brand?: Permission }) {
  const isStaff = p.kind === 'user' && p.actorType === 'STAFF';
  const needed = isStaff ? rule.staff : rule.brand;
  if (needed && !hasPermission(p, needed)) throw new ForbiddenException(`Missing permission: ${needed}`);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** Readable temporary password with letters and digits (meets PASSWORD_RULE). */
export function generateTempPassword(length = 10): string {
  for (;;) {
    let out = '';
    for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    if (/[A-Za-z]/.test(out) && /\d/.test(out)) return out;
  }
}

type UserRow = typeof users.$inferSelect;

/** User row without secrets, plus derived flags for the UI. */
export function publicUser(u: UserRow) {
  const { passwordHash: _omit, ...rest } = u;
  void _omit;
  return { ...rest, invitePending: !u.lastLoginAt };
}
