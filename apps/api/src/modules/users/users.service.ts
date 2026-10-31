import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, count, desc, eq, inArray, like, ne, or, type SQL } from 'drizzle-orm';
import { BRAND_ROLES, STAFF_ROLES, isStaffRole, normalizeEgyptPhone, type Locale, type UserRole } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brands, hubs, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { CoreEvents, type UserInvitedEvent } from '../../core/events';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService, hashPassword } from '../auth/auth.service';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { likeEscape } from '../../db/helpers';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { config } from '../../config';
import { NotificationsService } from '../notifications/notifications.service';
import { generateTempPassword, publicUser, userIdOf } from './access';
import type { InviteStaffDto, InviteTeamMemberDto, UpdateStaffDto, UpdateTeamMemberDto, UsersQueryDto } from './users.dto';

type UserRow = typeof users.$inferSelect;

export interface NewAccountInput {
  name: string;
  phone: string;
  email?: string | null;
  role: UserRole;
  brandId?: string | null;
  hubId?: string | null;
  locale?: Locale;
  /** Leave empty to generate a temporary password (returned once). */
  password?: string;
}

/**
 * Staff accounts and brand teams.
 *
 * Invited accounts are created ACTIVE with a temporary password that is
 * returned once and sent by SMS / e-mail (CoreEvents.UserInvited);
 * `invitePending` stays true until the first sign-in.
 */
@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly guard: AuthGuard,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------- shared core

  /**
   * Creates a user (inside the caller's transaction when given). Validates
   * phone/email and uniqueness. Emit `emitInvited()` after the transaction commits.
   */
  async createAccount(tx: DbOrTx, input: NewAccountInput): Promise<{ user: UserRow; temporaryPassword: string | null }> {
    const phone = normalizeEgyptPhone(input.phone);
    if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    const email = input.email ? input.email.trim().toLowerCase() : null;
    await this.assertUnique(tx, phone, email);
    if (input.hubId) await this.assertHub(tx, input.hubId);
    const temporaryPassword = input.password ? null : generateTempPassword();
    const [row] = await tx
      .insert(users)
      .values({
        name: input.name.trim(),
        phone,
        email,
        role: input.role,
        status: 'ACTIVE',
        locale: input.locale ?? 'ar',
        brandId: input.brandId ?? null,
        hubId: input.hubId ?? null,
        passwordHash: await hashPassword(input.password ?? temporaryPassword!),
      })
      .$returningId();
    const [user] = await tx.select().from(users).where(eq(users.id, row.id)).limit(1);
    return { user, temporaryPassword };
  }

  emitInvited(user: UserRow, temporaryPassword: string) {
    this.events.emit(CoreEvents.UserInvited, {
      userId: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      temporaryPassword,
    } satisfies UserInvitedEvent);
  }

  private async assertUnique(db: DbOrTx, phone: string, email: string | null, exceptId?: string) {
    const conds = email ? or(eq(users.phone, phone), eq(users.email, email)) : eq(users.phone, phone);
    const rows = await db
      .select({ id: users.id, phone: users.phone, email: users.email })
      .from(users)
      .where(exceptId ? and(conds, ne(users.id, exceptId)) : conds)
      .limit(2);
    if (rows.some((r) => r.phone === phone)) throw new DomainError('PHONE_TAKEN', 'This phone number already has an account', HttpStatus.CONFLICT);
    if (email && rows.some((r) => r.email?.toLowerCase() === email)) throw new DomainError('EMAIL_TAKEN', 'This e-mail already has an account', HttpStatus.CONFLICT);
  }

  private async assertEmailFree(db: DbOrTx, email: string, exceptId: string) {
    const [row] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, exceptId))).limit(1);
    if (row) throw new DomainError('EMAIL_TAKEN', 'This e-mail already has an account', HttpStatus.CONFLICT);
  }

  private async assertHub(db: DbOrTx, hubId: string) {
    const [hub] = await db.select({ id: hubs.id, isActive: hubs.isActive }).from(hubs).where(eq(hubs.id, hubId)).limit(1);
    if (!hub) throw new DomainError('INVALID_HUB', 'Hub not found', HttpStatus.BAD_REQUEST);
    if (!hub.isActive) throw new DomainError('INVALID_HUB', 'Hub is not active', HttpStatus.BAD_REQUEST);
  }

  /** Locks every active super admin and fails if `targetId` is the last one. */
  private async assertNotLastSuperAdmin(tx: DbOrTx, targetId: string) {
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'SUPER_ADMIN'), eq(users.status, 'ACTIVE')))
      .for('update');
    if (admins.length <= 1 && admins.some((a) => a.id === targetId)) {
      throw new DomainError('LAST_SUPER_ADMIN', 'At least one active super admin must remain', HttpStatus.CONFLICT);
    }
  }

  private async load(id: string, db: DbOrTx = this.db, lock = false): Promise<UserRow> {
    const q = db.select().from(users).where(eq(users.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw notFound('User', id);
    return row;
  }

  private async revokeSessions(userId: string) {
    this.guard.invalidate(userId);
    await this.auth.logoutAll(userId);
  }

  // ------------------------------------------------------------------- staff

  async list(q: UsersQueryDto) {
    const conds: SQL[] = [];
    const roles: readonly UserRole[] | null =
      q.kind === 'staff' ? STAFF_ROLES : q.kind === 'brand' ? BRAND_ROLES : q.kind === 'courier' ? ['COURIER'] : null;
    if (roles) conds.push(inArray(users.role, [...roles]));
    if (q.role) conds.push(eq(users.role, q.role));
    if (q.status) conds.push(eq(users.status, q.status));
    if (q.hubId) conds.push(eq(users.hubId, q.hubId));
    if (q.brandId) conds.push(eq(users.brandId, q.brandId));
    if (q.q) {
      const term = `%${likeEscape(q.q.trim())}%`;
      const phone = normalizeEgyptPhone(q.q);
      conds.push(or(like(users.name, term), like(users.email, term), like(users.phone, phone ? `%${phone}%` : term))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({ user: users, hubName: hubs.name, brandName: brands.name })
        .from(users)
        .leftJoin(hubs, eq(hubs.id, users.hubId))
        .leftJoin(brands, eq(brands.id, users.brandId))
        .where(where)
        .orderBy(q.order === 'asc' ? asc(users.createdAt) : desc(users.createdAt), asc(users.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(users).where(where),
    ]);
    return paginate(
      rows.map((r) => ({ ...publicUser(r.user), hub: r.user.hubId ? { id: r.user.hubId, name: r.hubName } : null, brand: r.user.brandId ? { id: r.user.brandId, name: r.brandName } : null })),
      Number(n),
      q,
    );
  }

  async get(id: string) {
    const [r] = await this.db
      .select({ user: users, hubName: hubs.name, brandName: brands.name })
      .from(users)
      .leftJoin(hubs, eq(hubs.id, users.hubId))
      .leftJoin(brands, eq(brands.id, users.brandId))
      .where(eq(users.id, id))
      .limit(1);
    if (!r) throw notFound('User', id);
    return { ...publicUser(r.user), hub: r.user.hubId ? { id: r.user.hubId, name: r.hubName } : null, brand: r.user.brandId ? { id: r.user.brandId, name: r.brandName } : null };
  }

  async inviteStaff(dto: InviteStaffDto, actor: Principal, meta: RequestMetaInfo) {
    this.assertCanGrant(actor, dto.role);
    const out = await this.db.transaction(async (tx) => {
      const created = await this.createAccount(tx, { ...dto, hubId: dto.hubId ?? null });
      await this.audit.record(actor, { action: 'user.invite', entity: 'User', entityId: created.user.id, after: publicUser(created.user) }, meta, tx);
      return created;
    });
    this.emitInvited(out.user, out.temporaryPassword!);
    return { user: publicUser(out.user), temporaryPassword: out.temporaryPassword };
  }

  async updateStaff(id: string, dto: UpdateStaffDto, actor: Principal, meta: RequestMetaInfo) {
    const actorId = userIdOf(actor);
    const updated = await this.db.transaction(async (tx) => {
      const before = await this.load(id, tx, true);
      if (!isStaffRole(before.role)) throw new DomainError('NOT_STAFF_USER', 'Use the brand team or hero screens to edit this account', HttpStatus.CONFLICT);
      const roleChange = dto.role !== undefined && dto.role !== before.role;
      const statusChange = dto.status !== undefined && dto.status !== before.status;
      if (id === actorId && (roleChange || dto.status === 'SUSPENDED')) {
        throw new DomainError('SELF_LOCKOUT', 'You cannot change your own role or suspend yourself', HttpStatus.CONFLICT);
      }
      if (roleChange) this.assertCanGrant(actor, dto.role!);
      if (before.role === 'SUPER_ADMIN') this.assertCanGrant(actor, 'SUPER_ADMIN');
      if (before.role === 'SUPER_ADMIN' && before.status === 'ACTIVE' && ((roleChange && dto.role !== 'SUPER_ADMIN') || dto.status === 'SUSPENDED')) {
        await this.assertNotLastSuperAdmin(tx, id);
      }
      const email = dto.email === undefined ? undefined : dto.email === null ? null : dto.email.trim().toLowerCase();
      if (email) await this.assertEmailFree(tx, email, id);
      if (dto.hubId) await this.assertHub(tx, dto.hubId);
      const patch = {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.hubId !== undefined ? { hubId: dto.hubId } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      };
      if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, id));
      const after = await this.load(id, tx);
      await this.audit.record(actor, { action: 'user.update', entity: 'User', entityId: id, before: publicUser(before), after: publicUser(after) }, meta, tx);
      return { after, statusChange, roleChange };
    });
    if (updated.statusChange && updated.after.status === 'SUSPENDED') await this.revokeSessions(id);
    else this.guard.invalidate(id);
    return this.get(id);
  }

  /** Staff: issue a new temporary password for a staff or brand account. */
  async resetPassword(id: string, actor: Principal, meta: RequestMetaInfo) {
    const target = await this.load(id);
    if (target.role === 'COURIER') throw new DomainError('USE_HERO_MODULE', 'Reset hero passwords from the heroes screen', HttpStatus.CONFLICT);
    if (target.role === 'SUPER_ADMIN') this.assertCanGrant(actor, 'SUPER_ADMIN');
    return this.issueTemporaryPassword(target, actor, meta);
  }

  private async issueTemporaryPassword(target: UserRow, actor: Principal, meta: RequestMetaInfo) {
    const temporaryPassword = generateTempPassword();
    await this.db.update(users).set({ passwordHash: await hashPassword(temporaryPassword) }).where(eq(users.id, target.id));
    await this.revokeSessions(target.id);
    await this.audit.record(actor, { action: 'user.reset_password', entity: 'User', entityId: target.id }, meta);
    const portal = isStaffRole(target.role) ? 'ops' : 'brand';
    await this.notifications
      .sendNow({
        channel: 'SMS', to: target.phone, template: 'temp_password', locale: target.locale, userId: target.id,
        vars: { password: temporaryPassword, link: `${config.appUrl}/login?portal=${portal}` },
      })
      .catch((err) => this.log.warn(`temp password SMS for ${target.id} failed: ${err instanceof Error ? err.message : err}`));
    return { temporaryPassword };
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', actor: Principal, meta: RequestMetaInfo) {
    const actorId = userIdOf(actor);
    if (id === actorId && status === 'SUSPENDED') throw new DomainError('SELF_LOCKOUT', 'You cannot suspend yourself', HttpStatus.CONFLICT);
    await this.db.transaction(async (tx) => {
      const before = await this.load(id, tx, true);
      if (before.role === 'COURIER') throw new DomainError('USE_HERO_MODULE', 'Suspend heroes from the heroes screen', HttpStatus.CONFLICT);
      if (before.role === 'SUPER_ADMIN') this.assertCanGrant(actor, 'SUPER_ADMIN');
      if (before.status === status) return;
      if (status === 'SUSPENDED' && before.role === 'SUPER_ADMIN' && before.status === 'ACTIVE') await this.assertNotLastSuperAdmin(tx, id);
      await tx.update(users).set({ status }).where(eq(users.id, id));
      await this.audit.record(actor, { action: status === 'SUSPENDED' ? 'user.suspend' : 'user.reactivate', entity: 'User', entityId: id, before: { status: before.status }, after: { status } }, meta, tx);
    });
    if (status === 'SUSPENDED') await this.revokeSessions(id);
    else this.guard.invalidate(id);
    return this.get(id);
  }

  /** Only super admins may create or touch super admins. */
  private assertCanGrant(actor: Principal, role: UserRole) {
    if (role === 'SUPER_ADMIN' && !(actor.kind === 'user' && actor.role === 'SUPER_ADMIN')) {
      throw new DomainError('FORBIDDEN_ROLE', 'Only a super admin can manage super admins', HttpStatus.FORBIDDEN);
    }
  }

  // -------------------------------------------------------------- brand team

  async listTeam(brandId: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.brandId, brandId), inArray(users.role, [...BRAND_ROLES])))
      .orderBy(asc(users.createdAt));
    return rows.map(publicUser);
  }

  async inviteTeamMember(brandId: string, dto: InviteTeamMemberDto, actor: Principal, meta: RequestMetaInfo) {
    const out = await this.db.transaction(async (tx) => {
      const created = await this.createAccount(tx, { ...dto, brandId, hubId: null });
      await this.audit.record(actor, { action: 'brand_team.invite', entity: 'User', entityId: created.user.id, after: publicUser(created.user) }, meta, tx);
      return created;
    });
    this.emitInvited(out.user, out.temporaryPassword!);
    return { user: publicUser(out.user), temporaryPassword: out.temporaryPassword };
  }

  async updateTeamMember(brandId: string, id: string, dto: UpdateTeamMemberDto, actor: Principal, meta: RequestMetaInfo) {
    const actorId = userIdOf(actor);
    const result = await this.db.transaction(async (tx) => {
      const before = await this.loadTeamMember(tx, brandId, id);
      const roleChange = dto.role !== undefined && dto.role !== before.role;
      if (id === actorId && (roleChange || dto.status === 'SUSPENDED')) {
        throw new DomainError('SELF_LOCKOUT', 'You cannot change your own role or suspend yourself', HttpStatus.CONFLICT);
      }
      if (before.role === 'BRAND_OWNER' && before.status === 'ACTIVE' && ((roleChange && dto.role !== 'BRAND_OWNER') || dto.status === 'SUSPENDED')) {
        await this.assertNotLastOwner(tx, brandId, id);
      }
      const email = dto.email === undefined ? undefined : dto.email === null ? null : dto.email.trim().toLowerCase();
      if (email) await this.assertEmailFree(tx, email, id);
      const patch = {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      };
      if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, id));
      const after = await this.load(id, tx);
      await this.audit.record(actor, { action: 'brand_team.update', entity: 'User', entityId: id, before: publicUser(before), after: publicUser(after) }, meta, tx);
      return after;
    });
    if (result.status === 'SUSPENDED') await this.revokeSessions(id);
    else this.guard.invalidate(id);
    return publicUser(result);
  }

  /**
   * Removes a team member. Accounts that are referenced by history
   * (orders, tickets, audit …) are suspended and detached instead.
   */
  async removeTeamMember(brandId: string, id: string, actor: Principal, meta: RequestMetaInfo) {
    if (id === userIdOf(actor)) throw new DomainError('SELF_LOCKOUT', 'You cannot remove yourself', HttpStatus.CONFLICT);
    const outcome = await this.db.transaction(async (tx) => {
      const before = await this.loadTeamMember(tx, brandId, id);
      if (before.role === 'BRAND_OWNER' && before.status === 'ACTIVE') await this.assertNotLastOwner(tx, brandId, id);
      await this.audit.record(actor, { action: 'brand_team.remove', entity: 'User', entityId: id, before: publicUser(before) }, meta, tx);
      return before;
    });
    await this.revokeSessions(id);
    try {
      await this.db.delete(users).where(and(eq(users.id, id), eq(users.brandId, brandId)));
      return { removed: true, suspended: false };
    } catch (err) {
      const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
      if (code !== 'ER_ROW_IS_REFERENCED_2' && code !== 'ER_ROW_IS_REFERENCED') throw err;
      await this.db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, outcome.id));
      this.guard.invalidate(id);
      return { removed: false, suspended: true };
    }
  }

  private async loadTeamMember(tx: DbOrTx, brandId: string, id: string) {
    const [row] = await tx.select().from(users).where(and(eq(users.id, id), eq(users.brandId, brandId))).limit(1).for('update');
    if (!row || !(BRAND_ROLES as readonly string[]).includes(row.role)) throw notFound('Team member', id);
    return row;
  }

  private async assertNotLastOwner(tx: DbOrTx, brandId: string, targetId: string) {
    const owners = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.brandId, brandId), eq(users.role, 'BRAND_OWNER'), eq(users.status, 'ACTIVE')))
      .for('update');
    if (owners.length <= 1 && owners.some((o) => o.id === targetId)) {
      throw new DomainError('LAST_BRAND_OWNER', 'A brand needs at least one active owner', HttpStatus.CONFLICT);
    }
  }

  /** All user ids of a brand (to refresh the auth cache after a brand status change). */
  async brandUserIds(brandId: string, db: DbOrTx = this.db): Promise<string[]> {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.brandId, brandId));
    return rows.map((r) => r.id);
  }

  invalidateAuth(userIds: string[]) {
    for (const id of userIds) this.guard.invalidate(id);
  }
}
