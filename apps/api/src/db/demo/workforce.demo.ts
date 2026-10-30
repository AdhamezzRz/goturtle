import type { INestApplicationContext } from '@nestjs/common';

/** Demo data for the workforce modules. Must be idempotent. */
export async function seedWorkforceDemo(app: INestApplicationContext): Promise<void> {
  void app;
}
