import { Injectable, Logger } from '@nestjs/common';
import type { ActorType } from '@goturtle/shared';
import type { Db, DbOrTx } from '../db/client';
import { auditLogs } from '../db/schema';
import { InjectDb } from './database.module';
import type { Principal } from '../common/principal';
import type { RequestMetaInfo } from '../common/decorators';

export interface AuditEntry {
  action: string; // verb in dot notation: order.cancel, brand.update
  entity: string; // Order, Brand …
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only audit trail. Never throws into the caller's flow. */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);
  constructor(@InjectDb() private readonly db: Db) {}

  async record(principal: Principal | null, entry: AuditEntry, meta?: RequestMetaInfo | null, tx?: DbOrTx): Promise<void> {
    const actorType: ActorType = principal ? principal.actorType : 'SYSTEM';
    try {
      await (tx ?? this.db).insert(auditLogs).values({
        actorId: principal?.kind === 'user' ? principal.userId : null,
        actorType,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: redact(entry.before),
        after: redact(entry.after),
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
      });
    } catch (err) {
      if (tx) throw err; // inside a transaction the caller must know
      this.log.error(`audit write failed for ${entry.action}`, err as Error);
    }
  }
}

const SECRET_KEYS = /password|secret|token|hash|credentials|apikey|otp/i;

function redact(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v)]),
  );
}
