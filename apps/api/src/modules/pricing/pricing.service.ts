import { HttpStatus, Injectable } from '@nestjs/common';
import { asc, count, eq, inArray } from 'drizzle-orm';
import { PricingError, quote, type FeesPayer, type Quote, type QuoteInput, type RateCard } from '@goturtle/shared';
import type { Db, DbOrTx } from '../../db/client';
import { brands, pricingPlans, pricingRules } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import { brandScope, isStaff, type Principal } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { newId } from '../../db/columns';
import { NetworkService, ZONE_HINT, type ZoneInfo } from '../network/network.service';
import type { PricingPlanDto, PricingRuleDto, QuoteDto, UpdatePricingPlanDto } from './pricing.dto';

type PlanRow = typeof pricingPlans.$inferSelect;

export interface BrandRateCard {
  plan: { id: string; name: string; isDefault: boolean };
  card: RateCard;
}

const CACHE_TTL_MS = 30_000;

/**
 * Rate cards (pricing plans + per tier/service rules) and quoting. Fees are
 * computed by the pure shared `quote()` so the API, portals and tests agree.
 */
@Injectable()
export class PricingService {
  private readonly cards = new Map<string, { at: number; value: BrandRateCard }>();
  private defaultPlan: { at: number; id: string | null } | null = null;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly network: NetworkService,
  ) {}

  invalidate() {
    this.cards.clear();
    this.defaultPlan = null;
  }

  // ------------------------------------------------------------- rate cards

  async rateCardForPlan(planId: string, db: DbOrTx = this.db): Promise<BrandRateCard> {
    const hit = this.cards.get(planId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const [plan] = await db.select().from(pricingPlans).where(eq(pricingPlans.id, planId)).limit(1);
    if (!plan) throw notFound('Pricing plan', planId);
    const rules = await db.select().from(pricingRules).where(eq(pricingRules.planId, planId));
    const value: BrandRateCard = {
      plan: { id: plan.id, name: plan.name, isDefault: plan.isDefault },
      card: toCard(plan, rules),
    };
    this.cards.set(planId, { at: Date.now(), value });
    return value;
  }

  async defaultPlanId(db: DbOrTx = this.db): Promise<string> {
    if (this.defaultPlan && Date.now() - this.defaultPlan.at < CACHE_TTL_MS && this.defaultPlan.id) return this.defaultPlan.id;
    const [row] = await db.select({ id: pricingPlans.id }).from(pricingPlans).where(eq(pricingPlans.isDefault, true)).orderBy(asc(pricingPlans.createdAt)).limit(1);
    if (!row) throw new DomainError('PRICING_UNAVAILABLE', 'No default pricing plan is configured', HttpStatus.UNPROCESSABLE_ENTITY);
    this.defaultPlan = { at: Date.now(), id: row.id };
    return row.id;
  }

  /** The brand's own plan, or the default plan when none is assigned. */
  async rateCardForBrand(brandId: string, db: DbOrTx = this.db): Promise<BrandRateCard> {
    const [brand] = await db.select({ planId: brands.pricingPlanId }).from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand) throw notFound('Brand', brandId);
    return this.rateCardForPlan(brand.planId ?? (await this.defaultPlanId(db)), db);
  }

  /** Shared quote() with domain errors instead of PricingError. */
  computeQuote(card: RateCard, input: QuoteInput): Quote {
    try {
      return quote(card, input);
    } catch (err) {
      if (err instanceof PricingError) throw new DomainError('PRICING_UNAVAILABLE', err.message, HttpStatus.UNPROCESSABLE_ENTITY);
      throw err;
    }
  }

  /** POST /pricing/quote */
  async quoteFor(dto: QuoteDto, p: Principal) {
    const scope = brandScope(p);
    const brandId = scope ?? dto.brandId ?? null;
    let feesDefault: FeesPayer = 'BRAND';
    let rate: BrandRateCard;
    if (brandId) {
      const [brand] = await this.db.select({ id: brands.id, defaultFeesPaidBy: brands.defaultFeesPaidBy }).from(brands).where(eq(brands.id, brandId)).limit(1);
      if (!brand) throw notFound('Brand', brandId);
      feesDefault = brand.defaultFeesPaidBy;
      rate = await this.rateCardForBrand(brandId);
    } else {
      rate = await this.rateCardForPlan(await this.defaultPlanId());
    }

    let zone: ZoneInfo | null = null;
    let detection: unknown = null;
    if (dto.zoneId) {
      zone = await this.network.zoneById(dto.zoneId);
      if (!zone) throw notFound('Zone', dto.zoneId);
    } else if (dto.address || (dto.lat != null && dto.lng != null)) {
      const point = dto.lat != null && dto.lng != null ? { lat: dto.lat, lng: dto.lng } : null;
      const res = await this.network.detect(dto.address ?? '', point);
      if (!res.match) throw new DomainError('ZONE_NOT_DETECTED', 'We could not detect the delivery zone for this address', HttpStatus.UNPROCESSABLE_ENTITY, { hint: ZONE_HINT });
      zone = await this.network.zoneById(res.match.zoneId);
      detection = res.match;
    } else {
      throw new DomainError('ZONE_REQUIRED', 'Provide zoneId or an address', HttpStatus.BAD_REQUEST);
    }
    if (!zone!.isActive) throw new DomainError('ZONE_INACTIVE', `Zone ${zone!.code} is not serviceable at the moment`, HttpStatus.UNPROCESSABLE_ENTITY);

    const input: QuoteInput = {
      tier: zone!.tier,
      serviceLevel: dto.serviceLevel ?? 'STANDARD',
      type: dto.type ?? 'DELIVERY',
      weightGrams: dto.weightGrams ?? 1000,
      paymentMethod: dto.paymentMethod ?? 'COD',
      codAmountCents: (dto.paymentMethod ?? 'COD') === 'PREPAID' ? 0 : dto.codAmountCents ?? 0,
      declaredValueCents: dto.declaredValueCents ?? 0,
      feesPaidBy: dto.feesPaidBy ?? feesDefault,
    };
    return {
      zone: this.network.zoneSummary(zone!),
      detection,
      plan: rate.plan,
      input,
      quote: this.computeQuote(rate.card, input),
    };
  }

  // ------------------------------------------------------------- plans CRUD

  async listPlans() {
    const plans = await this.db.select().from(pricingPlans).orderBy(asc(pricingPlans.createdAt));
    const rules = plans.length ? await this.db.select().from(pricingRules).where(inArray(pricingRules.planId, plans.map((x) => x.id))) : [];
    const usage = await this.db.select({ planId: brands.pricingPlanId, n: count() }).from(brands).groupBy(brands.pricingPlanId);
    const byPlan = new Map(usage.map((u) => [u.planId, Number(u.n)]));
    return plans.map((plan) => ({
      ...plan,
      brandsCount: byPlan.get(plan.id) ?? 0,
      rules: sortRules(rules.filter((r) => r.planId === plan.id)),
    }));
  }

  async getPlan(id: string) {
    const [plan] = await this.db.select().from(pricingPlans).where(eq(pricingPlans.id, id)).limit(1);
    if (!plan) throw notFound('Pricing plan', id);
    const rules = await this.db.select().from(pricingRules).where(eq(pricingRules.planId, id));
    const [{ n }] = await this.db.select({ n: count() }).from(brands).where(eq(brands.pricingPlanId, id));
    return { ...plan, brandsCount: Number(n), rules: sortRules(rules) };
  }

  async createPlan(dto: PricingPlanDto, p: Principal, meta: RequestMetaInfo) {
    const id = newId();
    const { rules, ...fields } = dto;
    assertUniqueRules(rules ?? []);
    await this.db.transaction(async (tx) => {
      if (fields.isDefault) await tx.update(pricingPlans).set({ isDefault: false }).where(eq(pricingPlans.isDefault, true));
      await tx.insert(pricingPlans).values({ id, ...fields, isDefault: fields.isDefault ?? false });
      for (const r of rules ?? []) await tx.insert(pricingRules).values({ planId: id, ...r });
      await this.audit.record(p, { action: 'pricing_plan.create', entity: 'PricingPlan', entityId: id, after: dto }, meta, tx);
    });
    this.invalidate();
    return this.getPlan(id);
  }

  async updatePlan(id: string, dto: UpdatePricingPlanDto, p: Principal, meta: RequestMetaInfo) {
    const before = await this.getPlan(id);
    if (dto.isDefault === false && before.isDefault) {
      throw new DomainError('DEFAULT_PLAN_REQUIRED', 'Mark another plan as default instead of un-setting the default', HttpStatus.CONFLICT);
    }
    await this.db.transaction(async (tx) => {
      if (dto.isDefault) await tx.update(pricingPlans).set({ isDefault: false }).where(eq(pricingPlans.isDefault, true));
      if (Object.keys(dto).length) await tx.update(pricingPlans).set(dto).where(eq(pricingPlans.id, id));
      await this.audit.record(p, { action: 'pricing_plan.update', entity: 'PricingPlan', entityId: id, before, after: dto }, meta, tx);
    });
    this.invalidate();
    return this.getPlan(id);
  }

  async deletePlan(id: string, p: Principal, meta: RequestMetaInfo) {
    const plan = await this.getPlan(id);
    if (plan.isDefault) throw new DomainError('PLAN_IS_DEFAULT', 'The default plan cannot be deleted', HttpStatus.CONFLICT);
    if (plan.brandsCount > 0) throw new DomainError('PLAN_IN_USE', `${plan.brandsCount} brand(s) use this plan`, HttpStatus.CONFLICT, { brandsCount: plan.brandsCount });
    await this.db.delete(pricingPlans).where(eq(pricingPlans.id, id));
    await this.audit.record(p, { action: 'pricing_plan.delete', entity: 'PricingPlan', entityId: id, before: plan }, meta);
    this.invalidate();
    return { ok: true };
  }

  /** Replaces every rule of a plan at once (the rate-card editor saves the whole grid). */
  async replaceRules(planId: string, rules: PricingRuleDto[], p: Principal, meta: RequestMetaInfo) {
    const before = await this.getPlan(planId);
    assertUniqueRules(rules);
    await this.db.transaction(async (tx) => {
      await tx.delete(pricingRules).where(eq(pricingRules.planId, planId));
      for (const r of rules) await tx.insert(pricingRules).values({ planId, ...r });
      await this.audit.record(p, { action: 'pricing_plan.rules', entity: 'PricingPlan', entityId: planId, before: before.rules, after: rules }, meta, tx);
    });
    this.invalidate();
    return this.getPlan(planId);
  }

  async upsertRule(planId: string, rule: PricingRuleDto, p: Principal, meta: RequestMetaInfo) {
    await this.getPlan(planId);
    await this.db
      .insert(pricingRules)
      .values({ planId, ...rule })
      .onDuplicateKeyUpdate({ set: { baseFeeCents: rule.baseFeeCents } });
    await this.audit.record(p, { action: 'pricing_rule.upsert', entity: 'PricingPlan', entityId: planId, after: rule }, meta);
    this.invalidate();
    return this.getPlan(planId);
  }

  async deleteRule(ruleId: string, p: Principal, meta: RequestMetaInfo) {
    const [rule] = await this.db.select().from(pricingRules).where(eq(pricingRules.id, ruleId)).limit(1);
    if (!rule) throw notFound('Pricing rule', ruleId);
    await this.db.delete(pricingRules).where(eq(pricingRules.id, ruleId));
    await this.audit.record(p, { action: 'pricing_rule.delete', entity: 'PricingPlan', entityId: rule.planId, before: rule }, meta);
    this.invalidate();
    return this.getPlan(rule.planId);
  }

  /** Rate card shown in the brand portal (brand: own; staff: any brand or the default). */
  async rateCardView(p: Principal, brandId?: string) {
    const scope = brandScope(p);
    const id = scope ?? brandId ?? null;
    const rate = id ? await this.rateCardForBrand(id) : await this.rateCardForPlan(await this.defaultPlanId());
    const { rules, ...card } = rate.card;
    return { plan: rate.plan, ...card, rules: sortRules(rules), brandId: id, staffView: isStaff(p) };
  }
}

function toCard(plan: PlanRow, rules: Array<typeof pricingRules.$inferSelect>): RateCard {
  return {
    codFeeBp: plan.codFeeBp,
    codFeeMinCents: plan.codFeeMinCents,
    includedWeightGrams: plan.includedWeightGrams,
    extraKgCents: plan.extraKgCents,
    returnFeeBp: plan.returnFeeBp,
    exchangeFeeCents: plan.exchangeFeeCents,
    insuranceBp: plan.insuranceBp,
    vatBp: plan.vatBp,
    rules: rules.map((r) => ({ tier: r.tier, serviceLevel: r.serviceLevel, baseFeeCents: r.baseFeeCents })),
  };
}

const LEVEL_ORDER = ['STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'];

function sortRules<T extends { tier: string; serviceLevel: string }>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.tier.localeCompare(b.tier) || LEVEL_ORDER.indexOf(a.serviceLevel) - LEVEL_ORDER.indexOf(b.serviceLevel));
}

function assertUniqueRules(rules: PricingRuleDto[]) {
  const seen = new Set<string>();
  for (const r of rules) {
    const k = `${r.tier}/${r.serviceLevel}`;
    if (seen.has(k)) throw new DomainError('DUPLICATE_RULE', `Rule ${k} is listed twice`, HttpStatus.BAD_REQUEST);
    seen.add(k);
  }
}
