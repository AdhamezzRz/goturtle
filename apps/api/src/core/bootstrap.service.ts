import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { count, eq, or } from 'drizzle-orm';
import { normalizeEgyptPhone } from '@goturtle/shared';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { InjectDb } from './database.module';
import { config } from '../config';
import { hashPassword } from '../modules/auth/auth.service';

/** First boot: create the super admin from BOOTSTRAP_ADMIN_* env vars when none exists yet. */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger('Bootstrap');
  constructor(@InjectDb() private readonly db: Db) {}

  async onApplicationBootstrap() {
    const [{ n }] = await this.db.select({ n: count() }).from(users).where(eq(users.role, 'SUPER_ADMIN'));
    if (Number(n) > 0) return;
    const { phone, email, password, name } = config.bootstrapAdmin;
    const e164 = normalizeEgyptPhone(phone);
    if (!e164 || !password) {
      this.log.warn('No super admin exists and BOOTSTRAP_ADMIN_PHONE / BOOTSTRAP_ADMIN_PASSWORD are not set — set them and restart.');
      return;
    }
    const conflict = await this.db
      .select({ id: users.id })
      .from(users)
      .where(email ? or(eq(users.phone, e164), eq(users.email, email.toLowerCase())) : eq(users.phone, e164))
      .limit(1);
    if (conflict.length) {
      this.log.warn(`Cannot create bootstrap admin: phone/email ${e164} is already used by another account.`);
      return;
    }
    await this.db.insert(users).values({
      name,
      phone: e164,
      email: email ? email.toLowerCase() : null,
      passwordHash: await hashPassword(password),
      role: 'SUPER_ADMIN',
      locale: 'en',
    });
    this.log.log(`Created bootstrap super admin ${e164}. Change the password after first sign-in.`);
  }
}
