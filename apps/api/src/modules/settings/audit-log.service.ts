import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, like, lt, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { auditLogs, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { likeEscape } from '../../db/helpers';
import { offsetOf, paginate } from '../../common/pagination';
import { DomainError } from '../../common/errors';
import { cairoDateTime } from '../../db/helpers';
import type { AuditQueryDto } from './settings.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Read side of the audit trail (AuditService in core writes it). */
@Injectable()
export class AuditLogService {
  constructor(@InjectDb() private readonly db: Db) {}

  async list(q: AuditQueryDto) {
    const conds: SQL[] = [];
    if (q.entity) conds.push(eq(auditLogs.entity, q.entity));
    if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
    if (q.actorId) conds.push(eq(auditLogs.actorId, q.actorId));
    if (q.action) conds.push(q.action.endsWith('.') ? like(auditLogs.action, `${likeEscape(q.action)}%`) : eq(auditLogs.action, q.action));
    const from = q.from ? parseBoundary(q.from, false) : null;
    const to = q.to ? parseBoundary(q.to, true) : null;
    if (from && to && from >= to) throw new DomainError('INVALID_RANGE', '"from" must be before "to"', 400);
    if (from) conds.push(gte(auditLogs.createdAt, from));
    if (to) conds.push(lt(auditLogs.createdAt, to));
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({
          log: auditLogs,
          actor: { id: users.id, name: users.name, role: users.role },
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(q.order === 'asc' ? asc(auditLogs.createdAt) : desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(auditLogs).where(where),
    ]);
    return paginate(
      rows.map((r) => ({ ...r.log, actor: r.actor?.id ? r.actor : null })),
      Number(n),
      q,
    );
  }
}

/** A plain YYYY-MM-DD is a Cairo business day; `to` then means "end of that day". */
function parseBoundary(value: string, isEnd: boolean): Date {
  if (DATE_ONLY.test(value)) {
    if (!isEnd) return cairoDateTime(value, '00:00');
    const next = new Date(`${value}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return cairoDateTime(next.toISOString().slice(0, 10), '00:00');
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new DomainError('INVALID_RANGE', `Invalid date ${value}`, 400);
  return d;
}
