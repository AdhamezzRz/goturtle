import { HttpStatus, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, like, lt, type SQL } from 'drizzle-orm';
import type { AdjustmentType } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { courierAdjustments, couriers, ledgerAccounts, ledgerEntries, ledgerTransactions, orders, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { LedgerService } from '../../core/ledger/ledger.service';
import { PostingsService } from '../../core/ledger/postings.service';
import { CompanyAccounts, type AccountRef, type CompanyAccountKey } from '../../core/ledger/accounts';
import { newId } from '../../db/columns';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import type { Principal } from '../../common/principal';
import { principalUserId } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { loadByIds } from '../../db/helpers';
import { resolveDayRange } from '../couriers/workforce.util';
import type { CreateAdjustmentDto, ListAdjustmentsQuery } from './dto/finance.dto';

type AdjustmentRow = typeof courierAdjustments.$inferSelect;

export interface AdjustmentInput {
  courierId: string;
  type: AdjustmentType;
  amountCents: number;
  reason: string;
  orderId?: string | null;
}

export const REVERSAL_PREFIX = 'REVERSAL of ';

/** Maps a ledger account code back to the reference LedgerService.post() understands. */
export function refFromCode(code: string): AccountRef {
  const [base, owner, id] = code.split(':');
  if (owner === 'BRAND' && base === '2100') return { brandWallet: id };
  if (owner === 'HERO' && base === '1100') return { courierCustody: id };
  if (owner === 'HERO' && base === '2200') return { courierPayable: id };
  const key = (Object.keys(CompanyAccounts) as CompanyAccountKey[]).find((k) => CompanyAccounts[k].code === code);
  if (!key) throw new Error(`Unknown ledger account ${code}`);
  return { company: key };
}

/**
 * Hero adjustments: bonuses, penalties, cash shortages, advances and
 * reimbursements. Each one is posted to the ledger when created and can never
 * be deleted — mistakes are undone with a reversing adjustment.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly postings: PostingsService,
  ) {}

  /** Creates and posts an adjustment inside the caller's transaction (the hero row must be lockable). */
  async createInTx(tx: DbOrTx, input: AdjustmentInput, actorId: string | null): Promise<AdjustmentRow> {
    const [hero] = await this.ledger.lockCouriers(tx, [input.courierId]);
    if (!hero) throw new DomainError('INVALID_COURIER', 'Hero not found', HttpStatus.BAD_REQUEST);
    if (input.type === 'CASH_SHORTAGE' && input.amountCents > hero.cashOnHandCents) {
      throw new DomainError('SHORTAGE_EXCEEDS_CUSTODY', 'A shortage cannot exceed the cash the hero holds', HttpStatus.UNPROCESSABLE_ENTITY, { cashOnHandCents: hero.cashOnHandCents });
    }
    if (input.orderId) {
      const [o] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId)).limit(1);
      if (!o) throw new DomainError('INVALID_ORDER', 'Order not found', HttpStatus.BAD_REQUEST);
    }
    const id = newId();
    await tx.insert(courierAdjustments).values({
      id, courierId: input.courierId, type: input.type, amountCents: input.amountCents, reason: input.reason.trim().slice(0, 500),
      orderId: input.orderId ?? null, createdById: actorId,
    });
    await this.postings.courierAdjustment(tx, { id, courierId: input.courierId, type: input.type, amountCents: input.amountCents, reason: input.reason }, actorId);
    const [row] = await tx.select().from(courierAdjustments).where(eq(courierAdjustments.id, id)).limit(1);
    return row;
  }

  async create(dto: CreateAdjustmentDto, principal: Principal, meta: RequestMetaInfo) {
    const row = await this.db.transaction(async (tx) => {
      const r = await this.createInTx(tx, dto, principalUserId(principal));
      await this.audit.record(principal, { action: 'adjustment.create', entity: 'CourierAdjustment', entityId: r.id, after: dto }, meta, tx);
      return r;
    });
    return this.get(row.id);
  }

  /** Posts the exact mirror of the original ledger transaction as a new adjustment. */
  async reverse(id: string, reason: string, principal: Principal, meta: RequestMetaInfo) {
    const newRowId = await this.db.transaction(async (tx) => {
      const [orig] = await tx.select().from(courierAdjustments).where(eq(courierAdjustments.id, id)).limit(1);
      if (!orig) throw notFound('Adjustment', id);
      if (orig.reason.startsWith(REVERSAL_PREFIX)) throw new DomainError('CANNOT_REVERSE_REVERSAL', 'A reversal cannot itself be reversed', HttpStatus.CONFLICT);
      await this.ledger.lockCouriers(tx, [orig.courierId]);
      const [already] = await tx.select({ id: courierAdjustments.id }).from(courierAdjustments).where(like(courierAdjustments.reason, `${REVERSAL_PREFIX}${id}%`)).limit(1);
      if (already) throw new DomainError('ALREADY_REVERSED', 'This adjustment was already reversed', HttpStatus.CONFLICT, { reversalId: already.id });
      const entries = await tx
        .select({ code: ledgerAccounts.code, debitCents: ledgerEntries.debitCents, creditCents: ledgerEntries.creditCents })
        .from(ledgerEntries)
        .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .where(eq(ledgerTransactions.reference, `adjustment:${id}`));
      if (!entries.length) throw new DomainError('NOT_POSTED', 'The original adjustment has no ledger posting', HttpStatus.CONFLICT);
      const [hero] = await tx.select({ cash: couriers.cashOnHandCents }).from(couriers).where(eq(couriers.id, orig.courierId)).limit(1);
      const custodyDelta = entries.filter((e) => e.code.startsWith('1100:HERO:')).reduce((s, e) => s + e.creditCents - e.debitCents, 0);
      if ((hero?.cash ?? 0) + custodyDelta < 0) throw new DomainError('HANDOVER_EXCEEDS_CUSTODY', 'The reversal would make cash custody negative', HttpStatus.UNPROCESSABLE_ENTITY);

      const rid = newId();
      const fullReason = `${REVERSAL_PREFIX}${id}: ${reason}`.slice(0, 500);
      await tx.insert(courierAdjustments).values({
        id: rid, courierId: orig.courierId, type: orig.type, amountCents: orig.amountCents, reason: fullReason, orderId: orig.orderId, createdById: principalUserId(principal),
      });
      await this.ledger.post(tx, {
        kind: 'COURIER_ADJUSTMENT',
        reference: `adjustment:${rid}`,
        description: `Reversal of ${orig.type}: ${orig.reason}`,
        createdById: principalUserId(principal),
        metadata: { reverses: id },
        lines: entries.map((e) => ({ account: refFromCode(e.code), debit: e.creditCents, credit: e.debitCents })),
      });
      await this.audit.record(principal, { action: 'adjustment.reverse', entity: 'CourierAdjustment', entityId: id, after: { reversalId: rid, reason } }, meta, tx);
      return rid;
    });
    return this.get(newRowId);
  }

  async get(id: string) {
    const [row] = await this.db.select().from(courierAdjustments).where(eq(courierAdjustments.id, id)).limit(1);
    if (!row) throw notFound('Adjustment', id);
    const [view] = await this.present([row]);
    return view;
  }

  async list(q: ListAdjustmentsQuery) {
    const conds: Array<SQL | undefined> = [
      q.courierId ? eq(courierAdjustments.courierId, q.courierId) : undefined,
      q.type ? eq(courierAdjustments.type, q.type) : undefined,
      q.unpaid === 'true' ? isNull(courierAdjustments.payoutId) : undefined,
    ];
    if (q.from || q.to) {
      const r = resolveDayRange(q.from, q.to, 30, 3660);
      conds.push(gte(courierAdjustments.createdAt, r.start), lt(courierAdjustments.createdAt, r.end));
    }
    const where = and(...conds);
    const [rows, [{ n }]] = await Promise.all([
      this.db.select().from(courierAdjustments).where(where).orderBy(desc(courierAdjustments.createdAt), desc(courierAdjustments.id)).limit(q.pageSize).offset(offsetOf(q)),
      this.db.select({ n: count() }).from(courierAdjustments).where(where),
    ]);
    return paginate(await this.present(rows), Number(n), q);
  }

  /** Signed effect on what GoTurtle owes the hero (+ adds to pay, − deducts). */
  static signedAmount(a: Pick<AdjustmentRow, 'type' | 'amountCents' | 'reason'>) {
    const sign = a.type === 'BONUS' || a.type === 'REIMBURSEMENT' ? 1 : -1;
    const reversal = a.reason.startsWith(REVERSAL_PREFIX) ? -1 : 1;
    return sign * reversal * a.amountCents;
  }

  async present(rows: AdjustmentRow[]) {
    const heroIds = [...new Set(rows.map((r) => r.courierId))];
    const heroes = heroIds.length
      ? await this.db.select({ id: couriers.id, code: couriers.code, name: users.name }).from(couriers).innerJoin(users, eq(users.id, couriers.userId)).where(inArray(couriers.id, heroIds))
      : [];
    const heroMap = new Map(heroes.map((h) => [h.id, h]));
    const orderMap = await loadByIds(this.db, orders, orders.id, rows.map((r) => r.orderId));
    return rows.map((r) => ({
      ...r,
      isReversal: r.reason.startsWith(REVERSAL_PREFIX),
      reversesId: r.reason.startsWith(REVERSAL_PREFIX) ? r.reason.slice(REVERSAL_PREFIX.length).split(':')[0] : null,
      signedAmountCents: AdjustmentsService.signedAmount(r),
      courier: heroMap.get(r.courierId) ?? null,
      order: r.orderId && orderMap.get(r.orderId) ? { id: r.orderId, trackingNumber: orderMap.get(r.orderId)!.trackingNumber } : null,
    }));
  }
}
