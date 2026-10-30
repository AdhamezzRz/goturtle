import type { INestApplicationContext } from '@nestjs/common';

/** Demo data for the platform modules. Must be idempotent. */
export async function seedPlatformDemo(app: INestApplicationContext): Promise<void> {
  void app;
}
