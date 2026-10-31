import type { ActorType, TicketPriority, TicketStatus } from '@goturtle/shared';
import type { TicketEvent } from '../../core/events';

/**
 * Payload emitted with DomainEvents.TicketCreated / TicketUpdated. It extends
 * the core TicketEvent (so generic listeners keep working) with what changed.
 */
export interface TicketChangedEvent extends TicketEvent {
  change: 'created' | 'reply' | 'assigned' | 'status' | 'updated' | 'sla_breached';
  actorType: ActorType;
  actorId: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  /** For replies. */
  messageId?: string | null;
  isInternal?: boolean;
}
