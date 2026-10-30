import { Controller, Get, HttpCode, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { Access, Public } from '../common/decorators';
import { safeEqual } from '../common/crypto';
import { config } from '../config';
import type { Db } from '../db/client';
import { InjectDb } from './database.module';
import { JobsService } from './jobs.service';

const startedAt = new Date();

@ApiTags('System')
@Controller({ path: 'system', version: '1' })
export class SystemController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get('health')
  @ApiOperation({ summary: 'Liveness + database check (for uptime monitors)' })
  async health() {
    let database = 'ok';
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      database = 'down';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      time: new Date().toISOString(),
    };
  }

  /**
   * Hostinger cron hook. hPanel → Advanced → Cron Jobs (every minute):
   *   curl -fsS -X POST "https://your-domain/api/v1/system/cron?key=CRON_SECRET"
   */
  @Public()
  @SkipThrottle()
  @Post('cron')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run due background jobs (protected by CRON_SECRET)' })
  async cron(@Query('key') key?: string) {
    if (!key || !safeEqual(key, config.cronSecret)) throw new UnauthorizedException('Invalid cron key');
    return { ranAt: new Date().toISOString(), jobs: await this.jobs.tick() };
  }

  @Access({ actors: ['staff'], permissions: ['settings.manage'] })
  @Get('jobs')
  async jobStatus() {
    return { registered: this.jobs.list(), state: await this.jobs.status() };
  }

  @Access({ actors: ['staff'], permissions: ['settings.manage'] })
  @Post('jobs/run')
  @HttpCode(200)
  async runJobs(@Query('name') name?: string) {
    return this.jobs.tick({ force: name ? [name] : this.jobs.list().map((j) => j.name) });
  }
}
