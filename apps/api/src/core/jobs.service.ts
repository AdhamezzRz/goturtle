import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { jobLocks } from '../db/schema';
import { InjectDb } from './database.module';
import { config } from '../config';

export interface JobDefinition {
  /** Unique name, e.g. "webhooks.deliver". */
  name: string;
  /** Minimum seconds between two runs. */
  everySeconds: number;
  /** Max seconds a run may hold the lock (must be < 120s — Hostinger request timeout). */
  timeoutSeconds?: number;
  run: () => Promise<string | void>;
}

/**
 * Background jobs that survive Hostinger's "no background workers" rule.
 *
 * Jobs run (a) in-process on a timer while the Node app is awake and (b) on
 * demand when the cron endpoint is hit (hPanel cron / cron-job.org). A row
 * lock in `job_locks` guarantees one runner per job even with both triggers
 * or several app instances.
 *
 * Register from any module:  onModuleInit() { this.jobs.register({...}) }
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Jobs');
  private readonly jobs = new Map<string, JobDefinition>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(@InjectDb() private readonly db: Db) {}

  register(job: JobDefinition) {
    if (this.jobs.has(job.name)) throw new Error(`Job ${job.name} registered twice`);
    this.jobs.set(job.name, job);
  }

  list() {
    return [...this.jobs.values()].map((j) => ({ name: j.name, everySeconds: j.everySeconds }));
  }

  onApplicationBootstrap() {
    if (config.inProcessJobs && !config.isTest) {
      this.timer = setInterval(() => void this.tick(), 20_000);
      this.timer.unref();
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs every due job once. Safe to call concurrently. */
  async tick(opts: { force?: string[] } = {}): Promise<Array<{ name: string; ran: boolean; result?: string; error?: string; ms?: number }>> {
    if (this.ticking && !opts.force) return [];
    this.ticking = true;
    const results: Array<{ name: string; ran: boolean; result?: string; error?: string; ms?: number }> = [];
    try {
      for (const job of this.jobs.values()) {
        const forced = opts.force?.includes(job.name) ?? false;
        const acquired = await this.acquire(job, forced);
        if (!acquired) {
          results.push({ name: job.name, ran: false });
          continue;
        }
        const started = Date.now();
        try {
          const out = (await job.run()) ?? 'ok';
          await this.release(job.name, String(out));
          results.push({ name: job.name, ran: true, result: String(out), ms: Date.now() - started });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.error(`job ${job.name} failed: ${msg}`, err instanceof Error ? err.stack : undefined);
          await this.release(job.name, `error: ${msg}`.slice(0, 1000));
          results.push({ name: job.name, ran: true, error: msg, ms: Date.now() - started });
        }
      }
    } finally {
      this.ticking = false;
    }
    return results;
  }

  /** Atomically claims a job if it is due and not locked. */
  private async acquire(job: JobDefinition, force: boolean): Promise<boolean> {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + (job.timeoutSeconds ?? 90) * 1000);
    await this.db
      .insert(jobLocks)
      .values({ name: job.name, lockedUntil: new Date(0), lastRunAt: null })
      .onDuplicateKeyUpdate({ set: { name: sql`${jobLocks.name}` } });
    const due = new Date(now.getTime() - job.everySeconds * 1000);
    const res = (await this.db
      .update(jobLocks)
      .set({ lockedUntil: lockUntil })
      .where(
        and(
          eq(jobLocks.name, job.name),
          lt(jobLocks.lockedUntil, now),
          force ? undefined : or(sql`${jobLocks.lastRunAt} is null`, lt(jobLocks.lastRunAt, due)),
        ),
      )) as unknown as [{ affectedRows: number }];
    return res[0].affectedRows === 1;
  }

  private async release(name: string, result: string) {
    await this.db.update(jobLocks).set({ lockedUntil: new Date(0), lastRunAt: new Date(), lastResult: result.slice(0, 1000) }).where(eq(jobLocks.name, name));
  }

  async status() {
    return this.db.select().from(jobLocks).orderBy(jobLocks.name);
  }
}
