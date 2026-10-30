import type { ActorType } from '@goturtle/shared';
import type { Principal } from './principal';

/**
 * Who performed a write. Services take an ActorContext (not a Principal) so the
 * same business logic serves HTTP calls, integrations, jobs and seeds.
 */
export interface ActorContext {
  actorType: ActorType;
  /** users.id when a logged-in user acted. */
  actorId: string | null;
  name: string;
  /** Set for brand users / API keys / brand integrations. */
  brandId?: string | null;
  /** Set when a hero acted. */
  courierId?: string | null;
}

export function actorFromPrincipal(p: Principal): ActorContext {
  switch (p.kind) {
    case 'user':
      return { actorType: p.actorType, actorId: p.userId, name: p.name, brandId: p.brandId, courierId: p.courierId };
    case 'apiKey':
      return { actorType: 'API', actorId: null, name: `API key ${p.name}`, brandId: p.brandId };
    case 'customer':
      return { actorType: 'CUSTOMER', actorId: null, name: p.name };
  }
}

export const SYSTEM_ACTOR: ActorContext = { actorType: 'SYSTEM', actorId: null, name: 'GoTurtle' };

export const integrationActor = (brandId: string, provider: string): ActorContext => ({
  actorType: 'INTEGRATION',
  actorId: null,
  name: provider,
  brandId,
});
