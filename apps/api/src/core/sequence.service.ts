import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { formatCode } from '@goturtle/shared';
import type { Db, DbOrTx } from '../db/client';
import { InjectDb } from './database.module';

/**
 * Gap-tolerant atomic counters (MySQL `LAST_INSERT_ID(expr)` trick — one
 * round-trip, safe under concurrency, works inside transactions).
 */
@Injectable()
export class SequenceService {
  constructor(@InjectDb() private readonly db: Db) {}

  async next(key: string, tx?: DbOrTx): Promise<number> {
    const runner = tx ?? this.db;
    const result = (await runner.execute(
      sql`insert into sequences (\`key\`, \`value\`) values (${key}, 1) on duplicate key update \`value\` = last_insert_id(\`value\` + 1)`,
    )) as unknown as [{ insertId: number; affectedRows: number }];
    const header = result[0];
    // Fresh row: affectedRows = 1 and insertId = 0 → value is 1.
    return header.affectedRows === 1 && !header.insertId ? 1 : Number(header.insertId);
  }

  /** e.g. code('RS', 'runsheet') → RS-000042 */
  async code(prefix: string, key = prefix, pad = 6, tx?: DbOrTx): Promise<string> {
    return formatCode(prefix, await this.next(key, tx), pad);
  }
}
