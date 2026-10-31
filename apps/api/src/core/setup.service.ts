import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { brands, couriers, hubs, orders, systemSettings, zones } from '../db/schema';
import { InjectDb } from './database.module';
import { DomainError } from '../common/errors';

const DEMO_KEY = 'setup.demo';

export interface DemoState {
  state: 'idle' | 'running' | 'done' | 'error';
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/**
 * First-run setup for hosts without SSH (Hostinger): load the Greater Cairo
 * network, and optionally demo data, from the Ops portal (System page).
 */
@Injectable()
export class SetupService {
  private readonly log = new Logger('Setup');
  private demoRunning = false;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly moduleRef: ModuleRef,
  ) {}

  async status() {
    const n = async (table: typeof zones | typeof hubs | typeof brands | typeof couriers | typeof orders) => Number((await this.db.select({ n: count() }).from(table))[0].n);
    const [demo] = await this.db.select().from(systemSettings).where(eq(systemSettings.key, DEMO_KEY)).limit(1);
    return {
      network: { zones: await n(zones), hubs: await n(hubs) },
      counts: { brands: await n(brands), heroes: await n(couriers), orders: await n(orders) },
      demo: ((demo?.value as DemoState | undefined) ?? { state: 'idle' }) as DemoState,
    };
  }

  /** Greater Cairo: 3 governorates, 5 cities, 4 hubs, 25 zones, Standard & Growth rate cards. */
  async loadNetwork() {
    const { seedNetwork } = await import('../db/seed');
    const created = await seedNetwork(this.db);
    return { created, ...(await this.status()) };
  }

  /**
   * Demo accounts (password Turtle@2026) + 3 weeks of activity. Runs in the
   * background (it can take longer than a request may last on shared hosting);
   * poll status() for completion.
   */
  async startDemo(): Promise<DemoState> {
    const [{ n }] = await this.db.select({ n: count() }).from(orders);
    if (Number(n) > 0) throw new DomainError('DEMO_NOT_EMPTY', 'Demo data can only be loaded into an empty system (orders already exist)', HttpStatus.CONFLICT);
    if (this.demoRunning) throw new DomainError('DEMO_RUNNING', 'Demo data is already being generated', HttpStatus.CONFLICT);
    this.demoRunning = true;
    const state: DemoState = { state: 'running', startedAt: new Date().toISOString() };
    await this.save(state);
    void this.runDemo(state);
    return state;
  }

  private async runDemo(state: DemoState) {
    try {
      const { seedNetwork, seedDemoAccounts } = await import('../db/seed');
      const { runDemoSteps } = await import('../db/demo/run-demo');
      await seedNetwork(this.db);
      await seedDemoAccounts(this.db);
      // The demo steps only need `get(token)`; resolve across all modules.
      const app = { get: (token: unknown) => this.moduleRef.get(token as never, { strict: false }) } as unknown as INestApplicationContext;
      await runDemoSteps(app);
      await this.save({ ...state, state: 'done', finishedAt: new Date().toISOString() });
      this.log.log('Demo data loaded');
    } catch (err) {
      this.log.error('Demo data failed', err instanceof Error ? err.stack : String(err));
      await this.save({ ...state, state: 'error', finishedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.demoRunning = false;
    }
  }

  private async save(value: DemoState) {
    await this.db
      .insert(systemSettings)
      .values({ key: DEMO_KEY, value, description: 'Demo data generation status' })
      .onDuplicateKeyUpdate({ set: { value } });
  }
}
