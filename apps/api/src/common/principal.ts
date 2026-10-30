import type { ActorType, Permission, UserRole } from '@goturtle/shared';
import { ForbiddenException } from '@nestjs/common';

/** Who is calling. Attached to `req.principal` by the global AuthGuard. */
export type Principal =
  | {
      kind: 'user';
      userId: string;
      name: string;
      role: UserRole;
      actorType: Extract<ActorType, 'STAFF' | 'BRAND' | 'COURIER'>;
      brandId: string | null;
      courierId: string | null;
      hubId: string | null;
      permissions: readonly Permission[];
    }
  | {
      kind: 'apiKey';
      apiKeyId: string;
      name: string;
      brandId: string;
      actorType: 'API';
      permissions: readonly Permission[];
    }
  | {
      kind: 'customer';
      customerId: string | null;
      phone: string;
      name: string;
      actorType: 'CUSTOMER';
      /** Set when the session was opened for a single shipment (track + verify). */
      trackingNumber: string | null;
      permissions: readonly Permission[];
    };

export type ActorKind = 'staff' | 'brand' | 'courier' | 'customer' | 'apiKey';

export function actorKind(p: Principal): ActorKind {
  if (p.kind === 'apiKey') return 'apiKey';
  if (p.kind === 'customer') return 'customer';
  return p.actorType === 'STAFF' ? 'staff' : p.actorType === 'BRAND' ? 'brand' : 'courier';
}

export const isStaff = (p: Principal) => p.kind === 'user' && p.actorType === 'STAFF';

/**
 * Brand scope for queries: staff → null (all brands), brand users & API keys →
 * their brandId. Anyone else is refused.
 */
export function brandScope(p: Principal): string | null {
  if (isStaff(p)) return null;
  if ((p.kind === 'user' && p.actorType === 'BRAND') || p.kind === 'apiKey') {
    if (!p.brandId) throw new ForbiddenException('Brand account is not linked to a brand');
    return p.brandId;
  }
  throw new ForbiddenException('Not allowed');
}

/** The courier id of a hero principal (throws for anyone else). */
export function requireCourierId(p: Principal): string {
  if (p.kind === 'user' && p.actorType === 'COURIER' && p.courierId) return p.courierId;
  throw new ForbiddenException('Hero account required');
}

/** The user id when the principal is a logged-in user, for createdById / audit columns. */
export const principalUserId = (p: Principal | undefined | null): string | null => (p && p.kind === 'user' ? p.userId : null);

export const principalName = (p: Principal) => p.name;
