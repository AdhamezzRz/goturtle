import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrandKit } from '@/features/brand-kit/BrandKit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Bell, Building2, Palette, Phone, Search, Settings2, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { ago, parseEgp } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, ErrorState, Field, Input, Select, Skeleton, Switch, Tabs } from '@/components/ui';
import { MoneyInput, Notice, RequirePermission, Section, UploadButton, centsToInput, v, type Errors } from '@/portals/ops/components/opsb';
import './i18n';
import { IntegritySettingsForm } from '@/features/integrity/ops/IntegritySettingsForm';
import type { IntegritySettings } from '@/features/integrity/types';
import { FinanceSettingsForm } from '@/features/money/ops/FinanceSettingsForm';
import { PlatformSettingsForm } from '@/features/intake/settings/PlatformSettingsForm';
import type { PlatformSettings } from '@/features/intake/types';

type Company = { name: string; legalName: string; taxId: string; address: string; supportPhone: string; supportWhatsapp: string; email: string; logoUrl: string };
type Notifs = { customerSmsOnCreated: boolean; onOutForDelivery: boolean; onDelivered: boolean; onFailed: boolean; onReturned: boolean; channel: 'SMS' | 'WHATSAPP' };
type Ops = { maxAttempts: number; autoReturnOnRefusal: boolean; deliveryOtpForCodAboveCents: number; defaultCashLimitCents: number; pickupCutoffHour: number };
type Branding = { primaryColor: string };
type SettingRow<T> = { key: string; description: string; value: T; defaults: T; isDefault: boolean; updatedAt: string | null; updatedBy: { id: string; name: string } | null };
type PublicSettings = { company: Pick<Company, 'name' | 'supportPhone' | 'supportWhatsapp' | 'logoUrl' | 'email'>; branding: Branding };

const GROUPS = ['company', 'notifications', 'operations', 'branding', 'integrity', 'finance', 'platform'] as const;
type Group = (typeof GROUPS)[number];

export default function SettingsPage() {
  return (
    <RequirePermission permission="settings.manage">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  const [s, setS] = useQueryState({ tab: 'company' });
  const q = useQuery({ queryKey: ['settings', 'all'], queryFn: () => api<SettingRow<unknown>[]>('/settings') });
  const [draftBrand, setDraftBrand] = useState<{ company?: Partial<Company>; branding?: Partial<Branding> }>({});
  const onCompany = useCallback((c: Partial<Company>) => setDraftBrand((d) => ({ ...d, company: c })), []);
  const onBranding = useCallback((b: Partial<Branding>) => setDraftBrand((d) => ({ ...d, branding: b })), []);
  const row = <T,>(k: Group) => q.data?.find((r) => r.key === k) as SettingRow<T> | undefined;
  const icons: Record<Group, ReactNode> = { company: <Building2 className="h-4 w-4" />, notifications: <Bell className="h-4 w-4" />, operations: <Settings2 className="h-4 w-4" />, branding: <Palette className="h-4 w-4" />, integrity: <ShieldCheck className="h-4 w-4" />, finance: <Banknote className="h-4 w-4" />, platform: <Sparkles className="h-4 w-4" /> };
  const tab = (GROUPS as readonly string[]).includes(s.tab) ? (s.tab as Group) : 'company';
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{t('ops.settings.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('ops.settings.subtitle')}</p>
      </div>
      <Tabs className="mb-5" value={tab} onChange={(val) => setS({ tab: val })} tabs={GROUPS.map((g) => ({ value: g, label: <span className="inline-flex items-center gap-1.5">{icons[g]}{t(`ops.settings.group.${g}`)}</span> }))} />
      {q.isLoading ? <Skeleton className="h-96" /> : q.error ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div>
            {tab === 'company' && row<Company>('company') && <CompanyForm row={row<Company>('company')!} onDraft={onCompany} />}
            {tab === 'notifications' && row<Notifs>('notifications') && <NotificationsForm row={row<Notifs>('notifications')!} />}
            {tab === 'operations' && row<Ops>('operations') && <OperationsForm row={row<Ops>('operations')!} />}
            {tab === 'branding' && row<Branding>('branding') && <><BrandingForm row={row<Branding>('branding')!} onDraft={onBranding} /><BrandKit /></>}
            {tab === 'integrity' && row<IntegritySettings>('integrity') && <IntegritySettingsForm row={row<IntegritySettings>('integrity')!} />}
            {tab === 'finance' && row('finance') && <FinanceSettingsForm row={row('finance') as Parameters<typeof FinanceSettingsForm>[0]['row']} />}
            {tab === 'platform' && row<PlatformSettings>('platform') && <PlatformSettingsForm row={row<PlatformSettings>('platform')!} />}
          </div>
          <PublicPreview draft={draftBrand} />
        </div>
      )}
    </div>
  );
}

/** Generic save hook: PUT /settings/:key with the changed fields; maps per-field errors. */
function useSave<T extends Record<string, unknown>>(key: Group, row: SettingRow<T>) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [values, setValues] = useState<T>(row.value);
  const [errors, setErrors] = useState<Errors>({});
  useEffect(() => setValues(row.value), [row.value]);
  const dirty = JSON.stringify(values) !== JSON.stringify(row.value);
  const m = useMutation({
    mutationFn: (patch: Partial<T>) => api(`/settings/${key}`, { method: 'PUT', body: { value: patch } }),
    onSuccess: () => { toast.success(t('ops.settings.saved')); setErrors({}); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => {
      if (e instanceof ApiError) {
        const list = (e.details as { errors?: Array<{ field: string; message: string }> } | undefined)?.errors ?? [];
        setErrors(Object.fromEntries(list.map((x) => [x.field, x.message])));
      }
      toast.error(errorMessage(e));
    },
  });
  const set = <K extends keyof T>(k: K, val: T[K]) => {
    setValues((s) => ({ ...s, [k]: val }));
    setErrors((e) => ({ ...e, [k as string]: undefined }));
  };
  const save = (validate?: (v: T) => Errors) => {
    const e = validate?.(values) ?? {};
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    const patch: Partial<T> = {};
    for (const k of Object.keys(values) as Array<keyof T>) if (JSON.stringify(values[k]) !== JSON.stringify(row.value[k])) patch[k] = values[k];
    m.mutate(patch);
  };
  return { values, setValues, set, errors, dirty, save, saving: m.isPending };
}

function FormShell({ group, row, dirty, saving, onSave, onReset, onDefaults, children }: { group: Group; row: SettingRow<unknown>; dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; onDefaults: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Section
      title={t(`ops.settings.group.${group}`)}
      subtitle={t(`ops.settings.desc.${group}`)}
      actions={<span className="text-xs text-ink-400">{row.updatedAt ? t('ops.settings.updated', { ago: ago(row.updatedAt) }) : t('ops.settings.neverSaved')}{row.updatedBy ? ` · ${row.updatedBy.name}` : ''}</span>}
    >
      {children}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
        <Button variant="ghost" size="sm" onClick={onDefaults}>{t('ops.settings.defaults')}</Button>
        <div className="flex items-center gap-2">
          {dirty && <Badge tone="warning" dot>{t('ops.settings.unsaved')}</Badge>}
          <Button variant="outline" disabled={!dirty} onClick={onReset}>{t('ops.settings.reset')}</Button>
          <Button loading={saving} disabled={!dirty} onClick={onSave}>{t('action.save')}</Button>
        </div>
      </div>
    </Section>
  );
}

function CompanyForm({ row, onDraft }: { row: SettingRow<Company>; onDraft: (c: Partial<Company>) => void }) {
  const { t } = useI18n();
  const f = useSave('company', row);
  useEffect(() => onDraft(f.values), [f.values, onDraft]);
  const validate = (c: Company): Errors => {
    const e: Errors = {};
    if (!c.name.trim()) e.name = t('ops.opsb.required');
    if (c.email && !v.email(c.email)) e.email = t('ops.opsb.invalidEmail');
    if (c.supportWhatsapp && !v.phone(c.supportWhatsapp)) e.supportWhatsapp = t('ops.opsb.invalidPhone');
    if (c.supportPhone && !/^\+?[0-9][0-9 -]{2,19}$/.test(c.supportPhone)) e.supportPhone = t('ops.opsb.invalidPhone');
    if (c.logoUrl && !/^(https?:\/\/|\/)\S*$/.test(c.logoUrl)) e.logoUrl = t('ops.settings.urlInvalid');
    return e;
  };
  const text = (k: keyof Company, opts: { ltr?: boolean; max: number; full?: boolean } = { max: 200 }) => (
    <Field label={t(`ops.settings.f.${k}`)} error={f.errors[k]} className={opts.full ? 'sm:col-span-2' : undefined} required={k === 'name'}>
      {(id) => <Input id={id} dir={opts.ltr ? 'ltr' : undefined} value={f.values[k]} maxLength={opts.max} onChange={(e) => f.set(k, e.target.value)} invalid={!!f.errors[k]} />}
    </Field>
  );
  return (
    <FormShell group="company" row={row as SettingRow<unknown>} dirty={f.dirty} saving={f.saving} onSave={() => f.save(validate)} onReset={() => f.setValues(row.value)} onDefaults={() => f.setValues(row.defaults)}>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('name', { max: 120 })}
        {text('legalName', { max: 200 })}
        {text('taxId', { max: 50, ltr: true })}
        {text('email', { max: 191, ltr: true })}
        {text('supportPhone', { max: 20, ltr: true })}
        {text('supportWhatsapp', { max: 20, ltr: true })}
        {text('address', { max: 300, full: true })}
        <div className="sm:col-span-2">
          <Field label={t('ops.settings.f.logoUrl')} error={f.errors.logoUrl}>
            {(id) => (
              <div className="flex flex-wrap items-center gap-3">
                {f.values.logoUrl && <img src={f.values.logoUrl} alt="" className="h-10 w-10 rounded-lg border border-ink-100 object-contain dark:border-ink-700" />}
                <Input id={id} dir="ltr" className="min-w-0 flex-1" value={f.values.logoUrl} maxLength={500} onChange={(e) => f.set('logoUrl', e.target.value)} invalid={!!f.errors.logoUrl} placeholder="https://" />
                <UploadButton purpose="logo" accept="image/*" onUploaded={(file) => f.set('logoUrl', file.url)} />
              </div>
            )}
          </Field>
        </div>
      </div>
    </FormShell>
  );
}

function NotificationsForm({ row }: { row: SettingRow<Notifs> }) {
  const { t } = useI18n();
  const f = useSave('notifications', row);
  const toggles: Array<keyof Notifs> = ['customerSmsOnCreated', 'onOutForDelivery', 'onDelivered', 'onFailed', 'onReturned'];
  return (
    <FormShell group="notifications" row={row as SettingRow<unknown>} dirty={f.dirty} saving={f.saving} onSave={() => f.save()} onReset={() => f.setValues(row.value)} onDefaults={() => f.setValues(row.defaults)}>
      <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
        {toggles.map((k) => (
          <li key={k} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-ink-800 dark:text-ink-100">{t(`ops.settings.f.${k}`)}</span>
            <Switch checked={f.values[k] as boolean} onChange={(val) => f.set(k, val as never)} />
          </li>
        ))}
      </ul>
      <div className="mt-4 max-w-xs">
        <Field label={t('ops.settings.f.channel')} hint={t('ops.settings.f.channelHint')}>
          {(id) => <Select id={id} value={f.values.channel} onChange={(e) => f.set('channel', e.target.value as Notifs['channel'])} options={[{ value: 'SMS', label: t('ops.settings.sms') }, { value: 'WHATSAPP', label: t('ops.settings.whatsapp') }]} />}
        </Field>
      </div>
    </FormShell>
  );
}

function OperationsForm({ row }: { row: SettingRow<Ops> }) {
  const { t } = useI18n();
  const f = useSave('operations', row);
  const [otp, setOtp] = useState(centsToInput(row.value.deliveryOtpForCodAboveCents));
  const [cash, setCash] = useState(centsToInput(row.value.defaultCashLimitCents));
  useEffect(() => { setOtp(centsToInput(f.values.deliveryOtpForCodAboveCents)); setCash(centsToInput(f.values.defaultCashLimitCents)); }, [f.values.deliveryOtpForCodAboveCents, f.values.defaultCashLimitCents]);
  const validate = (o: Ops): Errors => {
    const e: Errors = {};
    if (!Number.isInteger(o.maxAttempts) || o.maxAttempts < 1 || o.maxAttempts > 10) e.maxAttempts = '1 – 10';
    if (parseEgp(otp) === null && otp !== '0') e.deliveryOtpForCodAboveCents = t('ops.opsb.invalidAmount');
    if (parseEgp(cash) === null) e.defaultCashLimitCents = t('ops.opsb.invalidAmount');
    return e;
  };
  return (
    <FormShell group="operations" row={row as SettingRow<unknown>} dirty={f.dirty} saving={f.saving} onSave={() => f.save(validate)} onReset={() => f.setValues(row.value)} onDefaults={() => f.setValues(row.defaults)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ops.settings.f.maxAttempts')} error={f.errors.maxAttempts}>
          {(id) => <Input id={id} type="number" dir="ltr" min={1} max={10} value={f.values.maxAttempts} onChange={(e) => f.set('maxAttempts', Number(e.target.value))} invalid={!!f.errors.maxAttempts} />}
        </Field>
        <Field label={t('ops.settings.f.pickupCutoffHour')} hint={t('ops.settings.f.cutoffHint')} error={f.errors.pickupCutoffHour}>
          {(id) => <Select id={id} value={String(f.values.pickupCutoffHour)} onChange={(e) => f.set('pickupCutoffHour', Number(e.target.value))} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: t('ops.settings.hour', { h: String(h).padStart(2, '0') }) }))} />}
        </Field>
        <Field label={t('ops.settings.f.deliveryOtpForCodAboveCents')} hint={t('ops.settings.f.otpHint')} error={f.errors.deliveryOtpForCodAboveCents}>
          {(id) => <MoneyInput id={id} value={otp} onChange={(val) => { setOtp(val); const c = parseEgp(val); if (c !== null) f.set('deliveryOtpForCodAboveCents', c); }} invalid={!!f.errors.deliveryOtpForCodAboveCents} />}
        </Field>
        <Field label={t('ops.settings.f.defaultCashLimitCents')} error={f.errors.defaultCashLimitCents}>
          {(id) => <MoneyInput id={id} value={cash} onChange={(val) => { setCash(val); const c = parseEgp(val); if (c !== null) f.set('defaultCashLimitCents', c); }} invalid={!!f.errors.defaultCashLimitCents} />}
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800 sm:col-span-2">
          <span className="text-sm text-ink-800 dark:text-ink-100">{t('ops.settings.f.autoReturnOnRefusal')}</span>
          <Switch checked={f.values.autoReturnOnRefusal} onChange={(val) => f.set('autoReturnOnRefusal', val)} />
        </div>
      </div>
    </FormShell>
  );
}

/** WCAG relative-luminance contrast of a hex colour against white. */
function contrastWithWhite(hex: string) {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return 1.05 / (L + 0.05);
}

function BrandingForm({ row, onDraft }: { row: SettingRow<Branding>; onDraft: (b: Partial<Branding>) => void }) {
  const { t } = useI18n();
  const f = useSave('branding', row);
  useEffect(() => onDraft(f.values), [f.values, onDraft]);
  const valid = /^#[0-9A-Fa-f]{6}$/.test(f.values.primaryColor);
  const ratio = valid ? contrastWithWhite(f.values.primaryColor) : 0;
  // Brand palette first (go turtle Logo.pdf), then a few accessible alternatives.
  const swatches = ['#00804C', '#006A3F', '#045434', '#080C19', '#1D4ED8', '#7C3AED', '#B45309', '#BE123C'];
  return (
    <FormShell group="branding" row={row as SettingRow<unknown>} dirty={f.dirty} saving={f.saving} onSave={() => f.save((b) => (/^#[0-9A-Fa-f]{6}$/.test(b.primaryColor) ? {} : { primaryColor: t('ops.settings.colorInvalid') }))} onReset={() => f.setValues(row.value)} onDefaults={() => f.setValues(row.defaults)}>
      <Field label={t('ops.settings.f.primaryColor')} error={f.errors.primaryColor}>
        {(id) => (
          <div className="flex flex-wrap items-center gap-3">
            <input type="color" aria-label={t('ops.settings.f.primaryColor')} value={valid ? f.values.primaryColor : '#000000'} onChange={(e) => f.set('primaryColor', e.target.value.toUpperCase())} className="h-10 w-14 cursor-pointer rounded-lg border border-ink-200 bg-white p-1 dark:border-ink-700 dark:bg-ink-900" />
            <Input id={id} dir="ltr" className="!w-32 font-mono" value={f.values.primaryColor} maxLength={7} onChange={(e) => f.set('primaryColor', e.target.value)} invalid={!!f.errors.primaryColor} />
            <div className="flex flex-wrap gap-1.5">
              {swatches.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => f.set('primaryColor', c)} className={cn('h-8 w-8 rounded-full border-2 transition', f.values.primaryColor.toUpperCase() === c ? 'border-ink-900 dark:border-white' : 'border-transparent')} style={{ background: c }} />
              ))}
            </div>
          </div>
        )}
      </Field>
      {valid && ratio < 4.5 && <Notice tone="warning" className="mt-3">{t('ops.settings.contrastLow', { ratio: ratio.toFixed(1) })}</Notice>}
    </FormShell>
  );
}

function PublicPreview({ draft }: { draft: { company?: Partial<Company>; branding?: Partial<Branding> } }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/settings/public', { auth: 'none' }) });
  const merged = useMemo(() => {
    const base = q.data;
    if (!base) return null;
    return { company: { ...base.company, ...pickPublic(draft.company) }, branding: { ...base.branding, ...draft.branding } };
  }, [q.data, draft]);
  const isDraft = !!q.data && JSON.stringify(merged) !== JSON.stringify(q.data);
  const color = merged && /^#[0-9A-Fa-f]{6}$/.test(merged.branding.primaryColor) ? merged.branding.primaryColor : '#00804C';
  return (
    <aside className="xl:sticky xl:top-20 xl:self-start">
      <Section title={t('ops.settings.preview')} subtitle={t('ops.settings.previewHint')}>
        {!merged ? <Skeleton className="h-64" /> : (
          <div className="overflow-hidden rounded-2xl border border-ink-100 dark:border-ink-800">
            <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: color }}>
              {merged.company.logoUrl ? <img src={merged.company.logoUrl} alt="" className="h-8 w-8 rounded-lg bg-white object-contain p-0.5" /> : <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/20 font-bold">{merged.company.name.slice(0, 1)}</span>}
              <span className="font-semibold">{merged.company.name}</span>
            </div>
            <div className="space-y-3 bg-white p-4 dark:bg-ink-950">
              <p className="font-display text-lg font-bold text-ink-900 dark:text-white">{t('ops.settings.previewTrack')}</p>
              <div className="flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-400 dark:border-ink-700"><Search className="h-4 w-4" /><span className="ltr">GT1234567890</span></div>
              <button type="button" className="w-full rounded-xl py-2.5 text-sm font-semibold text-white" style={{ background: color }}>{t('action.search')}</button>
              {(merged.company.supportPhone || merged.company.supportWhatsapp) && (
                <p className="flex items-center gap-2 text-xs text-ink-500"><Phone className="h-3.5 w-3.5" />{t('ops.settings.previewCall')}: <span className="ltr">{merged.company.supportPhone || merged.company.supportWhatsapp}</span></p>
              )}
              {merged.company.email && <p className="ltr text-start text-xs text-ink-500">{merged.company.email}</p>}
            </div>
          </div>
        )}
        {isDraft && <p className="mt-2 text-xs text-sand-700 dark:text-sand-300">{t('ops.settings.previewDraft')}</p>}
      </Section>
    </aside>
  );
}

function pickPublic(c?: Partial<Company>) {
  if (!c) return {};
  const { name, supportPhone, supportWhatsapp, logoUrl, email } = c;
  return Object.fromEntries(Object.entries({ name, supportPhone, supportWhatsapp, logoUrl, email }).filter(([, val]) => val !== undefined));
}
