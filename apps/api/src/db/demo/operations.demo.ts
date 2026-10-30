import type { INestApplicationContext } from '@nestjs/common';

/** Demo data for the operations modules. Must be idempotent. */
export async function seedOperationsDemo(app: INestApplicationContext): Promise<void> {
  void app;
}
