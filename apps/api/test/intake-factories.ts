import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { ACCOUNTS, type AccountName, type TestContext } from './helpers';
import { bearer, tokenFor, type Agent } from './ops-factories';

/**
 * Authenticated agent for a seeded account without the (rate-limited) login
 * endpoint — test files run in parallel and share the login throttle.
 */
export async function staffAgent(t: TestContext, who: AccountName): Promise<Agent> {
  const [u] = await t.db.select({ id: s.users.id, role: s.users.role }).from(s.users).where(eq(s.users.phone, ACCOUNTS[who].identifier)).limit(1);
  if (!u) throw new Error(`seeded account ${who} missing`);
  return bearer(t, await tokenFor(t, u.id, u.role));
}

export async function userIdOf(t: TestContext, who: AccountName): Promise<string> {
  const [u] = await t.db.select({ id: s.users.id }).from(s.users).where(eq(s.users.phone, ACCOUNTS[who].identifier)).limit(1);
  return u.id;
}
