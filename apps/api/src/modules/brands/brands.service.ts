import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { isStaffRole, normalizeEgyptPhone, type BrandStatus } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brandLocations, brands, ledgerAccounts, orders, pricingPlans, users, zones } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { LedgerService } from '../../core/ledger/ledger.service';
import { describeRef } from '../../core/ledger/accounts';
import { DomainError, notFound } from '../../common/errors';
import { offsetOf, paginate } from '../../common/pagination';
import { likeEscape, loadByIds, sumOf } from '../../db/helpers';
import type { Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { config } from '../../config';
import { UsersService } from '../users/users.service';
import { isBrandOwner, publicUser } from '../users/access';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  BrandsQueryDto, CreateBrandDto, LocationInputDto, PayoutDetailsDto, RegisterBrandDto, UpdateBrandDto, UpdateLocationDto, UpdateMyBrandDto,
} from './brands.dto';

type BrandRow = typeof brands.$inferSelect;
type LocationRow = typeof brandLocations.$inferSelect;

/**
 * Brands (merchants): onboarding by staff, self sign-up, profile, approval
 * workflow and pickup locations. A brand is created together with its owner
 * account and (when given) its default pickup location in one transaction.
 */
@Injectable()
export class BrandsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ queries

  async list(q: BrandsQueryDto) {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(brands.status, q.status));
    if (q.planId) conds.push(eq(brands.pricingPlanId, q.planId));
    if (q.cycle) conds.push(eq(brands.settlementCycle, q.cycle));
    if (q.accountManagerId) conds.push(eq(brands.accountManagerId, q.accountManagerId));
    if (q.q) {
      const term = `%${likeEscape(q.q.trim())}%`;
      const phone = normalizeEgyptPhone(q.q);
      conds.push(or(like(brands.name, term), like(brands.code, term), like(brands.email, term), like(brands.legalName, term), phone ? eq(brands.phone, phone) : undefined)!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select({ brand: brands, planName: pricingPlans.name, managerName: users.name })
        .from(brands)
        .leftJoin(pricingPlans, eq(pricingPlans.id, brands.pricingPlanId))
        .leftJoin(users, eq(users.id, brands.accountManagerId))
        .where(where)
        .orderBy(q.order === 'asc' ? asc(brands.createdAt) : desc(brands.createdAt), asc(brands.id))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      this.db.select({ n: count() }).from(brands).where(where),
    ]);
    const ids = rows.map((r) => r.brand.id);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [volumes, wallets] = ids.length
      ? await Promise.all([
          this.db
            .select({ brandId: orders.brandId, n: count() })
            .from(orders)
            .where(and(inArray(orders.brandId, ids), gte(orders.createdAt, since)))
            .groupBy(orders.brandId),
          this.db
            .select({ code: ledgerAccounts.code, balance: ledgerAccounts.balanceCents })
            .from(ledgerAccounts)
            .where(inArray(ledgerAccounts.code, ids.map((id) => describeRef({ brandWallet: id }).code))),
        ])
      : [[], []];
    const volumeBy = new Map(volumes.map((v) => [v.brandId, Number(v.n)]));
    const walletBy = new Map(wallets.map((w) => [w.code, w.balance]));
    return paginate(
      rows.map((r) => ({
        ...this.present(r.brand, { payout: true }),
        plan: r.brand.pricingPlanId ? { id: r.brand.pricingPlanId, name: r.planName } : null,
        accountManager: r.brand.accountManagerId ? { id: r.brand.accountManagerId, name: r.managerName } : null,
        orders30d: volumeBy.get(r.brand.id) ?? 0,
        walletBalanceCents: walletBy.get(describeRef({ brandWallet: r.brand.id }).code) ?? 0,
      })),
      Number(n),
      q,
    );
  }

  /** Full brand profile with operational stats (staff view). */
  async detail(id: string) {
    const brand = await this.load(id);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [plan, manager, byStatus, [last30], walletBalanceCents, locations, team] = await Promise.all([
      brand.pricingPlanId ? this.db.select().from(pricingPlans).where(eq(pricingPlans.id, brand.pricingPlanId)).limit(1).then((r) => r[0] ?? null) : null,
      brand.accountManagerId ? this.db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email }).from(users).where(eq(users.id, brand.accountManagerId)).limit(1).then((r) => r[0] ?? null) : null,
      this.db.select({ status: orders.status, n: count() }).from(orders).where(eq(orders.brandId, id)).groupBy(orders.status),
      this.db
        .select({
          orders: count(),
          delivered: sql<number>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then 1 else 0 end), 0)`.mapWith(Number),
          returned: sql<number>`coalesce(sum(case when ${orders.status} = 'RETURNED' then 1 else 0 end), 0)`.mapWith(Number),
          codCollectedCents: sumOf(orders.collectedCents),
          feesCents: sumOf(orders.totalFeesCents),
        })
        .from(orders)
        .where(and(eq(orders.brandId, id), gte(orders.createdAt, since))),
      this.ledger.balance({ brandWallet: id }),
      this.listLocations(id),
      this.users.listTeam(id),
    ]);
    const ordersByStatus = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));
    return {
      ...this.present(brand, { payout: true }),
      plan: plan ? { id: plan.id, name: plan.name } : null,
      accountManager: manager,
      stats: {
        totalOrders: byStatus.reduce((s, r) => s + Number(r.n), 0),
        ordersByStatus,
        last30Days: { orders: Number(last30.orders), delivered: last30.delivered, returned: last30.returned, codCollectedCents: last30.codCollectedCents, feesCents: last30.feesCents },
        walletBalanceCents,
      },
      locations,
      team,
    };
  }

  /** The caller's own brand (brand portal). Payout details only for owners. */
  async mine(p: Principal, brandId: string) {
    const brand = await this.load(brandId);
    const [walletBalanceCents, locations] = await Promise.all([this.ledger.balance({ brandWallet: brandId }), this.listLocations(brandId)]);
    const plan = brand.pricingPlanId ? (await this.db.select({ id: pricingPlans.id, name: pricingPlans.name }).from(pricingPlans).where(eq(pricingPlans.id, brand.pricingPlanId)).limit(1))[0] ?? null : null;
    const { notes: _notes, accountManagerId: _am, ...rest } = this.present(brand, { payout: isBrandOwner(p) });
    void _notes;
    void _am;
    return { ...rest, plan, walletBalanceCents, locations, canCreateOrders: brand.status === 'ACTIVE' };
  }

  // ------------------------------------------------------------------ writes

  async create(dto: CreateBrandDto, actor: Principal, meta: RequestMetaInfo) {
    const result = await this.db.transaction(async (tx) => {
      await this.assertCodeFree(tx, dto.code);
      const phone = this.phone(dto.phone);
      const planId = await this.resolvePlan(tx, dto.pricingPlanId);
      if (dto.accountManagerId) await this.assertStaff(tx, dto.accountManagerId);
      await this.assertZone(tx, dto.location.zoneId);
      const [row] = await tx
        .insert(brands)
        .values({
          code: dto.code, name: dto.name.trim(), legalName: dto.legalName ?? null, commercialRegNo: dto.commercialRegNo ?? null, taxId: dto.taxId ?? null,
          industry: dto.industry ?? null, logoUrl: dto.logoUrl ?? null, website: dto.website ?? null, email: dto.email?.toLowerCase() ?? null, phone,
          status: dto.status ?? 'ACTIVE', pricingPlanId: planId, settlementCycle: dto.settlementCycle ?? 'WEEKLY', payoutMethod: dto.payoutMethod ?? 'BANK_TRANSFER',
          payoutDetails: this.payout(dto.payoutDetails) ?? null, allowOpenPackage: dto.allowOpenPackage ?? false, defaultFeesPaidBy: dto.defaultFeesPaidBy ?? 'BRAND',
          accountManagerId: dto.accountManagerId ?? null, notes: dto.notes ?? null,
        })
        .$returningId();
      const owner = await this.users.createAccount(tx, { ...dto.owner, role: 'BRAND_OWNER', brandId: row.id });
      const location = await this.insertLocation(tx, row.id, { ...dto.location, isDefault: true }, { name: owner.user.name, phone: owner.user.phone });
      const brand = await this.load(row.id, tx);
      await this.audit.record(actor, { action: 'brand.create', entity: 'Brand', entityId: row.id, after: brand }, meta, tx);
      return { brand, owner, location };
    });
    this.users.emitInvited(result.owner.user, result.owner.temporaryPassword!);
    return {
      brand: this.present(result.brand, { payout: true }),
      owner: publicUser(result.owner.user),
      temporaryPassword: result.owner.temporaryPassword,
      location: result.location,
    };
  }

  /** Public self sign-up → PENDING brand + owner who can sign in right away (orders stay blocked until approval). */
  async register(dto: RegisterBrandDto, meta: RequestMetaInfo) {
    const result = await this.db.transaction(async (tx) => {
      const phone = this.phone(dto.phone);
      const code = await this.generateCode(tx, dto.brandName);
      const planId = await this.resolvePlan(tx, undefined);
      if (dto.location) await this.assertZone(tx, dto.location.zoneId);
      const [row] = await tx
        .insert(brands)
        .values({
          code, name: dto.brandName.trim(), industry: dto.industry ?? null, website: dto.website ?? null, email: dto.email.toLowerCase(), phone,
          status: 'PENDING', pricingPlanId: planId,
        })
        .$returningId();
      const owner = await this.users.createAccount(tx, {
        name: dto.ownerName, phone: dto.phone, email: dto.email, role: 'BRAND_OWNER', brandId: row.id, password: dto.password, locale: dto.locale ?? 'ar',
      });
      if (dto.location) await this.insertLocation(tx, row.id, { ...dto.location, isDefault: true }, { name: owner.user.name, phone: owner.user.phone });
      const brand = await this.load(row.id, tx);
      await this.audit.record(null, { action: 'brand.register', entity: 'Brand', entityId: row.id, after: brand }, meta, tx);
      return { brand, owner: owner.user };
    });
    await this.notifications
      .notifyRoles(['SUPER_ADMIN', 'OPS_MANAGER'], 'brand_registered', { brand: result.brand.name, code: result.brand.code }, { data: { brandId: result.brand.id, link: `/ops/brands/${result.brand.id}` } })
      .catch(() => undefined);
    return {
      brand: { id: result.brand.id, code: result.brand.code, name: result.brand.name, status: result.brand.status },
      user: { id: result.owner.id, name: result.owner.name, phone: result.owner.phone, email: result.owner.email },
      next: 'Sign in with your phone and password. You can create orders once GoTurtle approves your account.',
    };
  }

  async update(id: string, dto: UpdateBrandDto, actor: Principal, meta: RequestMetaInfo) {
    await this.db.transaction(async (tx) => {
      const before = await this.load(id, tx, true);
      const patch: Partial<typeof brands.$inferInsert> = this.profilePatch(dto);
      if (dto.name !== undefined) patch.name = dto.name.trim();
      if (dto.pricingPlanId !== undefined) patch.pricingPlanId = dto.pricingPlanId === null ? await this.resolvePlan(tx, undefined) : await this.resolvePlan(tx, dto.pricingPlanId);
      if (dto.settlementCycle !== undefined) patch.settlementCycle = dto.settlementCycle;
      if (dto.payoutMethod !== undefined) patch.payoutMethod = dto.payoutMethod;
      if (dto.payoutDetails !== undefined) patch.payoutDetails = this.payout(dto.payoutDetails);
      if (dto.allowOpenPackage !== undefined) patch.allowOpenPackage = dto.allowOpenPackage;
      if (dto.defaultFeesPaidBy !== undefined) patch.defaultFeesPaidBy = dto.defaultFeesPaidBy;
      if (dto.accountManagerId !== undefined) {
        if (dto.accountManagerId) await this.assertStaff(tx, dto.accountManagerId);
        patch.accountManagerId = dto.accountManagerId;
      }
      if (dto.notes !== undefined) patch.notes = dto.notes;
      if (Object.keys(patch).length) await tx.update(brands).set(patch).where(eq(brands.id, id));
      const after = await this.load(id, tx);
      await this.audit.record(actor, { action: 'brand.update', entity: 'Brand', entityId: id, before, after }, meta, tx);
    });
    return this.detail(id);
  }

  async updateMine(brandId: string, dto: UpdateMyBrandDto, actor: Principal, meta: RequestMetaInfo) {
    const touchesPayout = dto.payoutMethod !== undefined || dto.payoutDetails !== undefined;
    if (touchesPayout && !isBrandOwner(actor)) {
      throw new DomainError('OWNER_ONLY', 'Only the brand owner can change payout details', HttpStatus.FORBIDDEN);
    }
    await this.db.transaction(async (tx) => {
      const before = await this.load(brandId, tx, true);
      const patch: Partial<typeof brands.$inferInsert> = this.profilePatch(dto);
      if (dto.payoutMethod !== undefined) patch.payoutMethod = dto.payoutMethod;
      if (dto.payoutDetails !== undefined) patch.payoutDetails = this.payout(dto.payoutDetails);
      if (dto.defaultFeesPaidBy !== undefined) patch.defaultFeesPaidBy = dto.defaultFeesPaidBy;
      if (Object.keys(patch).length) await tx.update(brands).set(patch).where(eq(brands.id, brandId));
      const after = await this.load(brandId, tx);
      await this.audit.record(actor, { action: 'brand.update_profile', entity: 'Brand', entityId: brandId, before, after }, meta, tx);
    });
    return this.mine(actor, brandId);
  }

  async approve(id: string, actor: Principal, meta: RequestMetaInfo) {
    const brand = await this.transition(id, ['PENDING'], 'ACTIVE', 'brand.approve', actor, meta);
    await this.notifications
      .notifyBrandOwners(id, 'brand_approved', { brand: brand.name, link: `${config.appUrl}/brand` }, { email: true, data: { brandId: id } })
      .catch(() => undefined);
    return this.detail(id);
  }

  async suspend(id: string, actor: Principal, meta: RequestMetaInfo) {
    await this.transition(id, ['PENDING', 'ACTIVE'], 'SUSPENDED', 'brand.suspend', actor, meta);
    return this.detail(id);
  }

  async reactivate(id: string, actor: Principal, meta: RequestMetaInfo) {
    await this.transition(id, ['SUSPENDED'], 'ACTIVE', 'brand.reactivate', actor, meta);
    return this.detail(id);
  }

  private async transition(id: string, from: BrandStatus[], to: BrandStatus, action: string, actor: Principal, meta: RequestMetaInfo) {
    const brand = await this.db.transaction(async (tx) => {
      const before = await this.load(id, tx, true);
      if (!from.includes(before.status)) {
        throw new DomainError('INVALID_BRAND_STATUS', `Brand is ${before.status}; expected ${from.join(' or ')}`, HttpStatus.CONFLICT);
      }
      await tx.update(brands).set({ status: to }).where(eq(brands.id, id));
      await this.audit.record(actor, { action, entity: 'Brand', entityId: id, before: { status: before.status }, after: { status: to } }, meta, tx);
      return { ...before, status: to };
    });
    // Brand users' cached principals carry the brand status → refresh them now.
    this.users.invalidateAuth(await this.users.brandUserIds(id));
    return brand;
  }

  // ------------------------------------------------------------------ locations

  async listLocations(brandId: string) {
    const rows = await this.db
      .select({ location: brandLocations, zoneName: zones.nameEn, zoneNameAr: zones.nameAr, zoneCode: zones.code })
      .from(brandLocations)
      .innerJoin(zones, eq(zones.id, brandLocations.zoneId))
      .where(eq(brandLocations.brandId, brandId))
      .orderBy(desc(brandLocations.isDefault), asc(brandLocations.createdAt));
    return rows.map((r) => ({ ...r.location, zone: { id: r.location.zoneId, code: r.zoneCode, nameEn: r.zoneName, nameAr: r.zoneNameAr } }));
  }

  async createLocation(brandId: string, dto: LocationInputDto, actor: Principal, meta: RequestMetaInfo) {
    await this.load(brandId);
    const loc = await this.db.transaction(async (tx) => {
      await this.assertZone(tx, dto.zoneId);
      const fallback = await this.contactFallback(tx, brandId);
      const created = await this.insertLocation(tx, brandId, dto, fallback);
      await this.audit.record(actor, { action: 'brand_location.create', entity: 'BrandLocation', entityId: created.id, after: created }, meta, tx);
      return created;
    });
    return this.location(brandId, loc.id);
  }

  async updateLocation(brandId: string, locationId: string, dto: UpdateLocationDto, actor: Principal, meta: RequestMetaInfo) {
    await this.db.transaction(async (tx) => {
      const before = await this.lockLocation(tx, brandId, locationId);
      if (dto.zoneId) await this.assertZone(tx, dto.zoneId);
      if (dto.isActive === false && before.isActive) await this.assertNotLastActive(tx, brandId, locationId);
      if (dto.isDefault === false && before.isDefault) {
        throw new DomainError('DEFAULT_LOCATION_REQUIRED', 'Mark another location as default instead', HttpStatus.CONFLICT);
      }
      const patch: Partial<typeof brandLocations.$inferInsert> = {};
      if (dto.name !== undefined) patch.name = dto.name.trim();
      if (dto.contactName !== undefined) patch.contactName = dto.contactName.trim();
      if (dto.phone !== undefined) patch.phone = this.phone(dto.phone);
      if (dto.addressLine !== undefined) patch.addressLine = dto.addressLine.trim();
      if (dto.zoneId !== undefined) patch.zoneId = dto.zoneId;
      if (dto.lat !== undefined) patch.lat = dto.lat;
      if (dto.lng !== undefined) patch.lng = dto.lng;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;
      if (dto.isDefault === true) {
        await tx.update(brandLocations).set({ isDefault: false }).where(and(eq(brandLocations.brandId, brandId), ne(brandLocations.id, locationId)));
        patch.isDefault = true;
        patch.isActive = true;
      }
      if (Object.keys(patch).length) await tx.update(brandLocations).set(patch).where(eq(brandLocations.id, locationId));
      // Deactivating the default moves the default flag to the oldest other active location.
      if (patch.isActive === false && before.isDefault) {
        await tx.update(brandLocations).set({ isDefault: false }).where(eq(brandLocations.id, locationId));
        await this.promoteDefault(tx, brandId, locationId);
      }
      const [after] = await tx.select().from(brandLocations).where(eq(brandLocations.id, locationId));
      await this.audit.record(actor, { action: 'brand_location.update', entity: 'BrandLocation', entityId: locationId, before, after }, meta, tx);
    });
    return this.location(brandId, locationId);
  }

  /** Deletes a location; locations used by orders/pickups are deactivated instead. */
  async deleteLocation(brandId: string, locationId: string, actor: Principal, meta: RequestMetaInfo) {
    const before = await this.db.transaction(async (tx) => {
      const row = await this.lockLocation(tx, brandId, locationId);
      if (row.isActive) await this.assertNotLastActive(tx, brandId, locationId);
      await this.audit.record(actor, { action: 'brand_location.delete', entity: 'BrandLocation', entityId: locationId, before: row }, meta, tx);
      return row;
    });
    let deleted = true;
    try {
      await this.db.delete(brandLocations).where(and(eq(brandLocations.id, locationId), eq(brandLocations.brandId, brandId)));
    } catch (err) {
      const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
      if (code !== 'ER_ROW_IS_REFERENCED_2' && code !== 'ER_ROW_IS_REFERENCED') throw err;
      deleted = false;
      await this.db.update(brandLocations).set({ isActive: false, isDefault: false }).where(eq(brandLocations.id, locationId));
    }
    if (before.isDefault) await this.db.transaction((tx) => this.promoteDefault(tx, brandId, locationId));
    return { deleted, deactivated: !deleted };
  }

  private async location(brandId: string, id: string) {
    const loc = (await this.listLocations(brandId)).find((l) => l.id === id);
    if (!loc) throw notFound('Location', id);
    return loc;
  }

  private async insertLocation(tx: DbOrTx, brandId: string, dto: LocationInputDto, fallback: { name: string; phone: string }): Promise<LocationRow> {
    const [{ n }] = await tx.select({ n: count() }).from(brandLocations).where(and(eq(brandLocations.brandId, brandId), eq(brandLocations.isActive, true)));
    const makeDefault = dto.isDefault === true || Number(n) === 0;
    if (makeDefault) await tx.update(brandLocations).set({ isDefault: false }).where(eq(brandLocations.brandId, brandId));
    const [row] = await tx
      .insert(brandLocations)
      .values({
        brandId, name: dto.name.trim(), contactName: (dto.contactName ?? fallback.name).trim(), phone: dto.phone ? this.phone(dto.phone) : fallback.phone,
        addressLine: dto.addressLine.trim(), zoneId: dto.zoneId, lat: dto.lat ?? null, lng: dto.lng ?? null, isDefault: makeDefault, isActive: true,
      })
      .$returningId();
    const [created] = await tx.select().from(brandLocations).where(eq(brandLocations.id, row.id));
    return created;
  }

  private async lockLocation(tx: DbOrTx, brandId: string, id: string) {
    const [row] = await tx.select().from(brandLocations).where(and(eq(brandLocations.id, id), eq(brandLocations.brandId, brandId))).limit(1).for('update');
    if (!row) throw notFound('Location', id);
    return row;
  }

  private async assertNotLastActive(tx: DbOrTx, brandId: string, exceptId: string) {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(brandLocations)
      .where(and(eq(brandLocations.brandId, brandId), eq(brandLocations.isActive, true), ne(brandLocations.id, exceptId)));
    if (Number(n) === 0) throw new DomainError('LAST_LOCATION', 'A brand needs at least one active pickup location', HttpStatus.CONFLICT);
  }

  private async promoteDefault(tx: DbOrTx, brandId: string, exceptId: string) {
    const [next] = await tx
      .select({ id: brandLocations.id })
      .from(brandLocations)
      .where(and(eq(brandLocations.brandId, brandId), eq(brandLocations.isActive, true), ne(brandLocations.id, exceptId)))
      .orderBy(asc(brandLocations.createdAt))
      .limit(1);
    if (next) await tx.update(brandLocations).set({ isDefault: true }).where(eq(brandLocations.id, next.id));
  }

  private async contactFallback(tx: DbOrTx, brandId: string) {
    const [owner] = await tx
      .select({ name: users.name, phone: users.phone })
      .from(users)
      .where(and(eq(users.brandId, brandId), eq(users.role, 'BRAND_OWNER')))
      .orderBy(asc(users.createdAt))
      .limit(1);
    if (owner) return owner;
    const brand = await this.load(brandId, tx);
    return { name: brand.name, phone: brand.phone };
  }

  // ------------------------------------------------------------------ helpers

  async load(id: string, db: DbOrTx = this.db, lock = false): Promise<BrandRow> {
    const q = db.select().from(brands).where(eq(brands.id, id)).limit(1);
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw notFound('Brand', id);
    return row;
  }

  private present(b: BrandRow, opts: { payout: boolean }) {
    return opts.payout ? b : { ...b, payoutDetails: maskPayout(b.payoutDetails) };
  }

  private profilePatch(dto: UpdateMyBrandDto | UpdateBrandDto): Partial<typeof brands.$inferInsert> {
    const patch: Partial<typeof brands.$inferInsert> = {};
    if (dto.legalName !== undefined) patch.legalName = dto.legalName;
    if (dto.commercialRegNo !== undefined) patch.commercialRegNo = dto.commercialRegNo;
    if (dto.taxId !== undefined) patch.taxId = dto.taxId;
    if (dto.industry !== undefined) patch.industry = dto.industry;
    if (dto.logoUrl !== undefined) patch.logoUrl = dto.logoUrl;
    if (dto.website !== undefined) patch.website = dto.website;
    if (dto.email !== undefined) patch.email = dto.email.toLowerCase();
    if (dto.phone !== undefined) patch.phone = this.phone(dto.phone);
    return patch;
  }

  private payout(d: PayoutDetailsDto | null | undefined) {
    if (d === undefined) return undefined;
    if (d === null) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    if (out.walletPhone) {
      const p = normalizeEgyptPhone(out.walletPhone);
      if (!p) throw new DomainError('INVALID_PHONE', 'walletPhone must be a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
      out.walletPhone = p;
    }
    return out;
  }

  private phone(raw: string): string {
    const p = normalizeEgyptPhone(raw);
    if (!p) throw new DomainError('INVALID_PHONE', 'Enter a valid Egyptian mobile number', HttpStatus.BAD_REQUEST);
    return p;
  }

  private async assertCodeFree(tx: DbOrTx, code: string) {
    const [row] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.code, code)).limit(1);
    if (row) throw new DomainError('BRAND_CODE_TAKEN', `Brand code ${code} is already used`, HttpStatus.CONFLICT);
  }

  /** NILE THREADS → NILETHRE, then NILETHRE2, NILETHRE3 … on collision. */
  private async generateCode(tx: DbOrTx, name: string): Promise<string> {
    const latin = name.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = (latin.length >= 2 ? latin : `BR${latin}`).slice(0, 8);
    const taken = new Set(
      (await tx.select({ code: brands.code }).from(brands).where(like(brands.code, `${likeEscape(base)}%`))).map((r) => r.code),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; i < 10_000; i++) {
      const candidate = `${base}${i}`.slice(-12);
      if (!taken.has(candidate)) return candidate;
    }
    throw new DomainError('BRAND_CODE_TAKEN', 'Could not generate a brand code', HttpStatus.CONFLICT);
  }

  private async resolvePlan(tx: DbOrTx, planId: string | undefined): Promise<string | null> {
    if (planId) {
      const [plan] = await tx.select({ id: pricingPlans.id }).from(pricingPlans).where(eq(pricingPlans.id, planId)).limit(1);
      if (!plan) throw new DomainError('INVALID_PRICING_PLAN', 'Pricing plan not found', HttpStatus.BAD_REQUEST);
      return plan.id;
    }
    const [def] = await tx.select({ id: pricingPlans.id }).from(pricingPlans).where(eq(pricingPlans.isDefault, true)).limit(1);
    return def?.id ?? null;
  }

  private async assertStaff(tx: DbOrTx, userId: string) {
    const [u] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u || !isStaffRole(u.role) || u.status !== 'ACTIVE') {
      throw new DomainError('INVALID_ACCOUNT_MANAGER', 'Account manager must be an active staff user', HttpStatus.BAD_REQUEST);
    }
  }

  async assertZone(tx: DbOrTx, zoneId: string) {
    const [z] = await tx.select({ id: zones.id, isActive: zones.isActive }).from(zones).where(eq(zones.id, zoneId)).limit(1);
    if (!z) throw new DomainError('INVALID_ZONE', 'Zone not found', HttpStatus.BAD_REQUEST);
    if (!z.isActive) throw new DomainError('INVALID_ZONE', 'This zone is not served right now', HttpStatus.BAD_REQUEST);
  }

  /** Brand ids → names (for other platform modules). */
  async names(ids: string[]) {
    const map = await loadByIds(this.db, brands, brands.id, ids);
    return new Map([...map.values()].map((b) => [b.id, b.name]));
  }
}

/** Shows only the last 4 characters of account identifiers. */
export function maskPayout(d: BrandRow['payoutDetails']) {
  if (!d) return d;
  const mask = (v?: string) => (v ? `••••${v.slice(-4)}` : v);
  return { ...d, iban: mask(d.iban), accountNumber: mask(d.accountNumber), walletPhone: mask(d.walletPhone), instapayAddress: d.instapayAddress ? '••••' : undefined };
}
