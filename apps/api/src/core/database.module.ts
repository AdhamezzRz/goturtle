import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { config } from '../config';
import { createDb, type Db } from '../db/client';

export const DB = Symbol('DB');
const POOL = Symbol('POOL');

/** Inject the Drizzle database: `constructor(@InjectDb() private readonly db: Db) {}` */
export const InjectDb = () => Inject(DB);

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      useFactory: () => createDb(config.databaseUrl, { connectionLimit: config.dbPoolSize }),
    },
    { provide: DB, useFactory: (h: { db: Db }) => h.db, inject: [POOL] },
    { provide: PoolCloser, useFactory: (h: { pool: Pool }) => new PoolCloser(h.pool), inject: [POOL] },
  ],
  exports: [DB],
})
export class DatabaseModule {}
