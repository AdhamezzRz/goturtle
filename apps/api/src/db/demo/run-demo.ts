/* eslint-disable no-console */
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { seedOperationsDemo } from './operations.demo';
import { seedWorkforceDemo } from './workforce.demo';
import { seedPlatformDemo } from './platform.demo';

/**
 * Demo activity generated through the real services (so the ledger, events,
 * KPIs and timelines are all consistent). Each step is idempotent.
 */
export async function runDemoSteps(app: INestApplicationContext) {
  await seedOperationsDemo(app);
  await seedWorkforceDemo(app);
  await seedPlatformDemo(app);
}

/** CLI entry (npm run db:seed): boots its own application context. */
export async function runDemo() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await runDemoSteps(app);
  } finally {
    await app.close();
  }
}
