/* eslint-disable no-console */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { seedOperationsDemo } from './operations.demo';
import { seedWorkforceDemo } from './workforce.demo';
import { seedPlatformDemo } from './platform.demo';

/**
 * Demo activity generated through the real services (so the ledger, events,
 * KPIs and timelines are all consistent). Each file is owned by one module
 * group; each runner must be idempotent (skip if its data already exists).
 */
export async function runDemo() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await seedOperationsDemo(app);
    await seedWorkforceDemo(app);
    await seedPlatformDemo(app);
  } finally {
    await app.close();
  }
}
