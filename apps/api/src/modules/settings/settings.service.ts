import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { systemSettings, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import type { Principal } from '../../common/principal';
import { principalUserId } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { DomainError } from '../../common/errors';
import { loadByIds } from '../../db/helpers';
import { PUBLIC_SETTINGS, SETTINGS, SETTING_KEYS, isSettingKey, validateSetting, withDefaults, type SettingKey, type SettingsMap } from './settings.registry';

const CACHE_TTL_MS = 30_000;

/**
 * System settings with defaults, validation and a short in-memory cache.
 * Other modules: `await settings.get('operations')` → fully typed object.
 */
@Injectable()
export class SettingsService {
  private readonly cache = new Map<SettingKey, { at: number; value: unknown }>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as SettingsMap[K];
    const [row] = await this.db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    const value = withDefaults(key, row?.value);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Drops the cache (all keys, or one). */
  invalidate(key?: SettingKey) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  /** Every known setting with its effective value and who changed it last. */
  async list() {
    const rows = await this.db.select().from(systemSettings).where(inArray(systemSettings.key, SETTING_KEYS));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const editors = await loadByIds(this.db, users, users.id, rows.map((r) => r.updatedById));
    return SETTING_KEYS.map((key) => {
      const row = byKey.get(key);
      const editor = row?.updatedById ? editors.get(row.updatedById) : undefined;
      return {
        key,
        description: SETTINGS[key].description,
        value: withDefaults(key, row?.value),
        defaults: SETTINGS[key].defaults,
        isDefault: !row,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: editor ? { id: editor.id, name: editor.name } : null,
      };
    });
  }

  async getOne(key: string) {
    if (!isSettingKey(key)) throw new DomainError('UNKNOWN_SETTING', `Unknown setting "${key}"`, 404);
    return (await this.list()).find((s) => s.key === key)!;
  }

  /** Partial update: validated fields are merged over the current value. */
  async set<K extends SettingKey>(key: K, patch: unknown, principal: Principal | null, meta?: RequestMetaInfo | null) {
    const before = await this.load(key);
    const value = validateSetting(key, patch, before);
    const updatedById = principal ? principalUserId(principal) : null;
    await this.db.transaction(async (tx) => {
      await tx
        .insert(systemSettings)
        .values({ key, value, description: SETTINGS[key].description, updatedById })
        .onDuplicateKeyUpdate({ set: { value, updatedById, updatedAt: new Date() } });
      await this.audit.record(principal, { action: 'settings.update', entity: 'Setting', entityId: key, before, after: value }, meta, tx);
    });
    this.invalidate(key);
    return this.getOne(key);
  }

  async setRaw(key: string, patch: unknown, principal: Principal | null, meta?: RequestMetaInfo | null) {
    if (!isSettingKey(key)) throw new DomainError('UNKNOWN_SETTING', `Unknown setting "${key}"`, 404);
    return this.set(key, patch, principal, meta);
  }

  /** Writes defaults for keys that have never been saved (used by seeds). */
  async ensureDefaults(): Promise<number> {
    const rows = await this.db.select({ key: systemSettings.key }).from(systemSettings).where(inArray(systemSettings.key, SETTING_KEYS));
    const existing = new Set(rows.map((r) => r.key));
    let created = 0;
    for (const key of SETTING_KEYS) {
      if (existing.has(key)) continue;
      await this.db
        .insert(systemSettings)
        .values({ key, value: SETTINGS[key].defaults, description: SETTINGS[key].description })
        .onDuplicateKeyUpdate({ set: { key } });
      created++;
    }
    this.invalidate();
    return created;
  }

  /** Branding + support contacts for the public tracking page and login screens. */
  async publicSettings() {
    const company = await this.get('company');
    const branding = await this.get('branding');
    const pick = <T extends object, F extends readonly (keyof T)[]>(obj: T, fields: F) =>
      Object.fromEntries(fields.map((f) => [f, obj[f]])) as { [P in F[number]]: T[P] };
    return {
      company: pick(company, PUBLIC_SETTINGS.company),
      branding: pick(branding, PUBLIC_SETTINGS.branding),
    };
  }

  private async load<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
    const [row] = await this.db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    return withDefaults(key, row?.value);
  }
}
