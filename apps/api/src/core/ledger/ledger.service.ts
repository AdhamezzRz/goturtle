import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { LedgerTxKind } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { couriers, ledgerAccounts, ledgerEntries, ledgerTransactions } from '../../db/schema';
import { InjectDb } from '../database.module';
import { DomainError } from '../../common/errors';
import { describeRef, isDebitNormal, type AccountRef, CompanyAccounts } from './accounts';

export interface LedgerLine {
  account: AccountRef;
  debit?: number;
  credit?: number;
}

export interface PostInput {
  kind: LedgerTxKind;
  /** Idempotency key — posting the same reference twice is a no-op. */
  reference: string;
  description: string;
  orderId?: string | null;
  createdById?: string | null;
  metadata?: Record<string, unknown> | null;
  lines: LedgerLine[];
}

/**
 * Double-entry ledger. Every money movement in GoTurtle is a balanced
 * transaction; account balances are cached on ledger_accounts and the hero's
 * cash custody is mirrored on couriers.cashOnHandCents for fast checks.
 *
 * Always call inside the business transaction (`tx`) so money and state
 * change atomically.
 */
@Injectable()
export class LedgerService {
  constructor(@InjectDb() private readonly db: Db) {}

  async post(tx: DbOrTx, input: PostInput): Promise<{ transactionId: string; duplicate: boolean }> {
    const lines = input.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
    for (const l of lines) {
      const d = l.debit ?? 0;
      const c = l.credit ?? 0;
      if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) {
        throw new DomainError('LEDGER_INVALID', `Ledger amounts must be non-negative integers (piasters) in ${input.reference}`);
      }
      if (d > 0 && c > 0) throw new DomainError('LEDGER_INVALID', 'A ledger line is either a debit or a credit');
    }
    const debits = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credits = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (debits !== credits) {
      throw new DomainError('LEDGER_UNBALANCED', `Unbalanced transaction ${input.reference}: debits ${debits} ≠ credits ${credits}`);
    }

    const [existing] = await tx
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.reference, input.reference))
      .limit(1);
    if (existing) return { transactionId: existing.id, duplicate: true };
    if (!lines.length) return { transactionId: '', duplicate: false };

    const txId = (
      await tx
        .insert(ledgerTransactions)
        .values({
          kind: input.kind,
          reference: input.reference,
          description: input.description.slice(0, 300),
          orderId: input.orderId ?? null,
          createdById: input.createdById ?? null,
          metadata: input.metadata ?? null,
        })
        .$returningId()
    )[0].id;

    for (const line of lines) {
      const account = await this.resolve(tx, line.account);
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      await tx.insert(ledgerEntries).values({ transactionId: txId, accountId: account.id, debitCents: debit, creditCents: credit });
      const delta = isDebitNormal(account.type) ? debit - credit : credit - debit;
      await tx
        .update(ledgerAccounts)
        .set({ balanceCents: sql`${ledgerAccounts.balanceCents} + ${delta}` })
        .where(eq(ledgerAccounts.id, account.id));
      if ('courierCustody' in line.account) {
        await tx
          .update(couriers)
          .set({ cashOnHandCents: sql`${couriers.cashOnHandCents} + ${delta}` })
          .where(eq(couriers.id, line.account.courierCustody));
      }
    }
    return { transactionId: txId, duplicate: false };
  }

  /** Get-or-create the account behind a reference. */
  async resolve(tx: DbOrTx, ref: AccountRef) {
    const d = describeRef(ref);
    const [found] = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.code, d.code)).limit(1);
    if (found) return found;
    await tx
      .insert(ledgerAccounts)
      .values({ code: d.code, name: d.name, type: d.type, brandId: d.brandId ?? null, courierId: d.courierId ?? null })
      .onDuplicateKeyUpdate({ set: { code: d.code } });
    const [created] = await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.code, d.code)).limit(1);
    return created;
  }

  async balance(ref: AccountRef, tx?: DbOrTx): Promise<number> {
    const d = describeRef(ref);
    const [row] = await (tx ?? this.db).select({ b: ledgerAccounts.balanceCents }).from(ledgerAccounts).where(eq(ledgerAccounts.code, d.code)).limit(1);
    return row?.b ?? 0;
  }

  /** Make sure the fixed company accounts exist (called at boot). */
  async ensureChartOfAccounts(): Promise<void> {
    for (const key of Object.keys(CompanyAccounts) as Array<keyof typeof CompanyAccounts>) {
      await this.resolve(this.db, { company: key });
    }
  }

  /** Statement lines for one account, newest first. */
  async statement(ref: AccountRef, opts: { limit?: number; offset?: number } = {}) {
    const account = await this.resolve(this.db, ref);
    const rows = await this.db
      .select({
        id: ledgerEntries.id,
        debitCents: ledgerEntries.debitCents,
        creditCents: ledgerEntries.creditCents,
        createdAt: ledgerEntries.createdAt,
        kind: ledgerTransactions.kind,
        reference: ledgerTransactions.reference,
        description: ledgerTransactions.description,
        orderId: ledgerTransactions.orderId,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
      .where(eq(ledgerEntries.accountId, account.id))
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(opts.limit ?? 100)
      .offset(opts.offset ?? 0);
    return { account, entries: rows };
  }

  /** Trial balance: Σ debits must equal Σ credits across the whole ledger. */
  async trialBalance() {
    const rows = await this.db
      .select({
        accountId: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        balanceCents: ledgerAccounts.balanceCents,
        debits: sql<number>`coalesce(sum(${ledgerEntries.debitCents}), 0)`.mapWith(Number),
        credits: sql<number>`coalesce(sum(${ledgerEntries.creditCents}), 0)`.mapWith(Number),
      })
      .from(ledgerAccounts)
      .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, ledgerAccounts.id))
      .groupBy(ledgerAccounts.id)
      .orderBy(ledgerAccounts.code);
    const totalDebits = rows.reduce((s, r) => s + r.debits, 0);
    const totalCredits = rows.reduce((s, r) => s + r.credits, 0);
    return { accounts: rows, totalDebits, totalCredits, balanced: totalDebits === totalCredits };
  }

  /** Sum of balances for accounts of one owner type, e.g. all brand wallets. */
  async sumByCodePrefix(prefix: string): Promise<number> {
    const [row] = await this.db
      .select({ s: sql<number>`coalesce(sum(${ledgerAccounts.balanceCents}), 0)`.mapWith(Number) })
      .from(ledgerAccounts)
      .where(sql`${ledgerAccounts.code} like ${`${prefix}%`}`);
    return row?.s ?? 0;
  }

  /** Lock courier rows (SELECT … FOR UPDATE) before custody-sensitive checks. */
  async lockCouriers(tx: DbOrTx, courierIds: string[]) {
    if (!courierIds.length) return [];
    return tx.select().from(couriers).where(and(inArray(couriers.id, courierIds))).for('update');
  }
}
