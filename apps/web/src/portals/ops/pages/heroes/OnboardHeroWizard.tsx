import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileCheck2, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { EmploymentType, VehicleType, normalizeEgyptPhone } from '@goturtle/shared';
import { api } from '@/lib/api';
import { num, parseEgp } from '@/lib/format';
import { cn } from '@/lib/cn';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Checkbox, Field, Input, Modal, Select } from '@/components/ui';
import { ChipGroup, InfoRow, Money, MoneyInput, Notice, Stepper, TempPasswordPanel, UploadButton, apiFieldErrors, centsToInput, enumOptions, useEnumLabel, useForm, useHubs, useZones, v, type Errors } from '@/portals/ops/components/opsb';
import type { OnboardResult } from './types';

/** Mirrors the API defaults per employment type (piasters) so the form shows what will apply. */
const DEFAULTS: Record<string, { perDelivery: number; perPickup: number; failedAttempt: number; hourly: number; salary: number; cashLimit: number }> = {
  FREELANCE: { perDelivery: 2200, perPickup: 500, failedAttempt: 700, hourly: 0, salary: 0, cashLimit: 600_000 },
  SHIFT: { perDelivery: 500, perPickup: 0, failedAttempt: 0, hourly: 4500, salary: 0, cashLimit: 600_000 },
  FULL_TIME: { perDelivery: 300, perPickup: 0, failedAttempt: 0, hourly: 0, salary: 900_000, cashLimit: 1_500_000 },
};

const WIZARD_DOCS = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'PERSONAL_PHOTO', 'DRIVING_LICENSE', 'VEHICLE_LICENSE', 'CRIMINAL_RECORD'] as const;
const EXPIRING = new Set(['DRIVING_LICENSE', 'VEHICLE_LICENSE', 'CRIMINAL_RECORD']);

const STEP_FIELDS: string[][] = [
  ['name', 'phone', 'email', 'nationalId', 'dateOfBirth', 'emergencyName', 'emergencyPhone'],
  ['vehicleType', 'vehiclePlate', 'licenseNumber', 'licenseExpiry'],
  ['homeHubId', 'zones'],
  ['employmentType', 'perDelivery', 'perPickup', 'failedAttempt', 'hourly', 'salary', 'cashLimit', 'maxActive', 'walletPhone', 'iban'],
  [],
];

const initial = (type = 'FREELANCE') => {
  const d = DEFAULTS[type];
  return {
    name: '', phone: '', email: '', locale: 'ar', nationalId: '', dateOfBirth: '', emergencyName: '', emergencyPhone: '', emergencyRelation: '',
    vehicleType: 'MOTORCYCLE', vehiclePlate: '', licenseNumber: '', licenseExpiry: '',
    homeHubId: '', zones: [] as Array<{ zoneId: string; isPrimary: boolean }>,
    employmentType: type, perDelivery: centsToInput(d.perDelivery), perPickup: centsToInput(d.perPickup), failedAttempt: centsToInput(d.failedAttempt), hourly: centsToInput(d.hourly), salary: centsToInput(d.salary), cashLimit: centsToInput(d.cashLimit), maxActive: '30',
    walletPhone: '', bankName: '', iban: '', accountName: '',
    activate: false,
    docs: {} as Record<string, { url: string; name: string; expiresAt: string }>,
  };
};

export function OnboardHeroWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, pick } = useI18n();
  const en = useEnumLabel();
  const nav = useNavigate();
  const qc = useQueryClient();
  const hubs = useHubs();
  const zones = useZones();
  const [step, setStep] = useState(0);
  const [zoneFilter, setZoneFilter] = useState('');
  const [result, setResult] = useState<OnboardResult | null>(null);
  const { values: f, set, patch, errors, setErrors, reset } = useForm(initial());
  const steps = [t('ops.heroes.w.s1'), t('ops.heroes.w.s2'), t('ops.heroes.w.s3'), t('ops.heroes.w.s4'), t('ops.heroes.w.s5')];

  const close = () => {
    onClose();
    setTimeout(() => {
      reset(initial());
      setStep(0);
      setResult(null);
    }, 200);
  };

  const validate = (s: number): Errors => {
    const e: Errors = {};
    if (s === 0) {
      if (!v.min(f.name, 2)) e.name = t('ops.opsb.minChars', { n: 2 });
      if (!v.phone(f.phone)) e.phone = t('ops.opsb.invalidPhone');
      if (f.email && !v.email(f.email)) e.email = t('ops.opsb.invalidEmail');
      if (f.nationalId && !/^\d{14}$/.test(f.nationalId)) e.nationalId = t('ops.heroes.w.nationalIdInvalid');
      if (f.emergencyName && !v.min(f.emergencyName, 2)) e.emergencyName = t('ops.opsb.minChars', { n: 2 });
      if (f.emergencyName && !v.phone(f.emergencyPhone)) e.emergencyPhone = t('ops.opsb.invalidPhone');
    }
    if (s === 3) {
      for (const k of ['perDelivery', 'perPickup', 'failedAttempt', 'hourly', 'salary', 'cashLimit'] as const) {
        if (f[k] !== '' && parseEgp(f[k]) === null) e[k] = t('ops.opsb.invalidAmount');
      }
      if (f.employmentType === 'SHIFT' && !(parseEgp(f.hourly) ?? 0)) e.hourly = t('ops.heroes.w.hourlyRequired');
      const max = Number(f.maxActive);
      if (!Number.isInteger(max) || max < 1 || max > 200) e.maxActive = '1 – 200';
      if (f.walletPhone && !v.phone(f.walletPhone)) e.walletPhone = t('ops.opsb.invalidPhone');
    }
    return e;
  };

  const next = () => {
    const e = validate(step);
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const body = () => {
    const c = (s: string) => (s === '' ? undefined : parseEgp(s) ?? undefined);
    const bank = f.bankName || f.iban || f.accountName ? { bankName: f.bankName || undefined, iban: f.iban.replace(/\s/g, '') || undefined, accountName: f.accountName || undefined } : undefined;
    return {
      name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || undefined, locale: f.locale,
      nationalId: f.nationalId || undefined, dateOfBirth: f.dateOfBirth || undefined,
      emergencyContact: f.emergencyName ? { name: f.emergencyName.trim(), phone: f.emergencyPhone.trim(), relation: f.emergencyRelation.trim() || undefined } : undefined,
      vehicleType: f.vehicleType, vehiclePlate: f.vehiclePlate.trim() || undefined, licenseNumber: f.licenseNumber.trim() || undefined, licenseExpiry: f.licenseExpiry || undefined,
      homeHubId: f.homeHubId || undefined, zones: f.zones.length ? f.zones : undefined,
      employmentType: f.employmentType,
      perDeliveryRateCents: c(f.perDelivery), perPickupRateCents: c(f.perPickup), failedAttemptRateCents: c(f.failedAttempt),
      hourlyRateCents: c(f.hourly), monthlySalaryCents: c(f.salary), cashLimitCents: c(f.cashLimit), maxActiveOrders: Number(f.maxActive),
      walletPhone: f.walletPhone.trim() || undefined, bankDetails: bank, activate: f.activate,
    };
  };

  const create = useMutation({
    mutationFn: async () => {
      const res = await api<OnboardResult>('/couriers', { method: 'POST', body: body() });
      const docs = Object.entries(f.docs);
      const outcomes = await Promise.allSettled(
        docs.map(([type, d]) => api(`/couriers/${res.id}/documents`, { method: 'POST', body: { type, url: d.url, expiresAt: d.expiresAt ? new Date(`${d.expiresAt}T00:00:00Z`).toISOString() : undefined } })),
      );
      return { res, attached: outcomes.filter((o) => o.status === 'fulfilled').length, failed: outcomes.filter((o) => o.status === 'rejected').length };
    },
    onSuccess: ({ res, attached, failed }) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ['heroes'] });
      qc.invalidateQueries({ queryKey: ['opsb', 'courier-options'] });
      toast.success(t('ops.heroes.w.done', { code: res.code }));
      if (attached) toast.success(t('ops.heroes.w.docsUploaded', { n: num(attached) }));
      if (failed) toast.error(t('ops.heroes.w.docsFailed'));
    },
    onError: (err) => {
      const fieldMap: Record<string, string> = {
        perDeliveryRateCents: 'perDelivery', perPickupRateCents: 'perPickup', failedAttemptRateCents: 'failedAttempt', hourlyRateCents: 'hourly',
        monthlySalaryCents: 'salary', cashLimitCents: 'cashLimit', maxActiveOrders: 'maxActive', homeHubId: 'homeHubId',
      };
      const raw = apiFieldErrors(err, ['name', 'phone', 'email', 'nationalId', 'dateOfBirth', 'vehiclePlate', 'licenseNumber', 'licenseExpiry', 'walletPhone', 'iban', 'zones', 'emergencyContact', ...Object.keys(fieldMap)], {
        PHONE_TAKEN: 'phone', INVALID_PHONE: 'phone', EMAIL_TAKEN: 'email', NATIONAL_ID_TAKEN: 'nationalId', NATIONAL_ID_MISMATCH: 'dateOfBirth', INVALID_NATIONAL_ID: 'nationalId', HERO_UNDERAGE: 'nationalId',
        HOURLY_RATE_REQUIRED: 'hourlyRateCents', INVALID_HUB: 'homeHubId', INVALID_ZONE: 'zones', MULTIPLE_PRIMARY_ZONES: 'zones', DUPLICATE_ZONE: 'zones',
      });
      const mapped: Errors = {};
      for (const [k, val] of Object.entries(raw)) mapped[fieldMap[k] ?? (k === 'emergencyContact' ? 'emergencyPhone' : k)] = val;
      setErrors(mapped);
      const first = STEP_FIELDS.findIndex((fs) => fs.some((x) => mapped[x]));
      if (first >= 0) setStep(first);
      toast.error(errorMessage(err));
    },
  });

  const filteredZones = useMemo(() => {
    const q = zoneFilter.trim().toLowerCase();
    return (zones.data ?? []).filter((z) => !q || z.nameEn.toLowerCase().includes(q) || z.nameAr.includes(q) || z.code.toLowerCase().includes(q));
  }, [zones.data, zoneFilter]);

  const toggleZone = (zoneId: string) => {
    const has = f.zones.find((z) => z.zoneId === zoneId);
    if (has) {
      const rest = f.zones.filter((z) => z.zoneId !== zoneId);
      if (has.isPrimary && rest.length) rest[0] = { ...rest[0], isPrimary: true };
      set('zones', rest);
    } else set('zones', [...f.zones, { zoneId, isPrimary: f.zones.length === 0 }]);
  };

  const changeType = (type: string) => {
    const d = DEFAULTS[type];
    patch({ employmentType: type, perDelivery: centsToInput(d.perDelivery), perPickup: centsToInput(d.perPickup), failedAttempt: centsToInput(d.failedAttempt), hourly: centsToInput(d.hourly), salary: centsToInput(d.salary), cashLimit: centsToInput(d.cashLimit) });
    setErrors({});
  };

  const zoneName = (id: string) => {
    const z = zones.data?.find((x) => x.id === id);
    return z ? pick(z, 'name') : id;
  };

  if (result) {
    return (
      <Modal open={open} onClose={close} title={t('ops.heroes.w.successTitle')} size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { reset(initial()); setStep(0); setResult(null); }}>{t('ops.heroes.w.another')}</Button>
            <Button onClick={() => { close(); nav(`/ops/heroes/${result.id}`); }}>{t('ops.heroes.w.openProfile')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-turtle-50 text-turtle-600 dark:bg-turtle-950"><CheckCircle2 className="h-6 w-6" /></div>
            <div>
              <p className="font-semibold text-ink-900 dark:text-white">{result.name}</p>
              <p className="ltr text-sm text-ink-500">{result.code} · {result.phone}</p>
            </div>
          </div>
          <TempPasswordPanel password={result.temporaryPassword} loginId={result.phone} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('ops.heroes.w.title')}
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={step === 0 ? close : () => setStep(step - 1)}>{step === 0 ? t('action.cancel') : t('action.back')}</Button>
          {step < steps.length - 1 ? <Button onClick={next}>{t('action.next')}</Button> : <Button loading={create.isPending} onClick={() => create.mutate()}>{t('ops.heroes.w.submit')}</Button>}
        </div>
      }
    >
      <Stepper steps={steps} current={step} onStep={(i) => setStep(i)} />

      {step === 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ops.heroes.w.name')} required error={errors.name}>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} maxLength={120} autoComplete="off" />}</Field>
          <Field label={t('ops.heroes.w.phone')} required error={errors.phone} hint={normalizeEgyptPhone(f.phone) ?? undefined}>{(id) => <Input id={id} dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" value={f.phone} onChange={(e) => set('phone', e.target.value)} invalid={!!errors.phone} maxLength={20} />}</Field>
          <Field label={t('common.email')} hint={t('ops.opsb.optional')} error={errors.email}>{(id) => <Input id={id} dir="ltr" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} maxLength={191} />}</Field>
          <Field label={t('ops.heroes.w.locale')}>{(id) => <Select id={id} value={f.locale} onChange={(e) => set('locale', e.target.value)} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />}</Field>
          <Field label={t('ops.heroes.w.nationalId')} error={errors.nationalId}>{(id) => <Input id={id} dir="ltr" inputMode="numeric" value={f.nationalId} onChange={(e) => set('nationalId', e.target.value.replace(/\D/g, '').slice(0, 14))} invalid={!!errors.nationalId} />}</Field>
          <Field label={t('ops.heroes.w.dob')} hint={t('ops.heroes.w.dobHint')} error={errors.dateOfBirth}>{(id) => <Input id={id} type="date" value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} invalid={!!errors.dateOfBirth} />}</Field>
          <fieldset className="grid gap-4 rounded-xl border border-ink-100 p-4 dark:border-ink-800 sm:col-span-2 sm:grid-cols-3">
            <legend className="px-1 text-sm font-semibold text-ink-700 dark:text-ink-200">{t('ops.heroes.w.emergency')} <span className="font-normal text-ink-400">· {t('ops.opsb.optional')}</span></legend>
            <Field label={t('ops.heroes.w.emergencyName')} error={errors.emergencyName}>{(id) => <Input id={id} value={f.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} invalid={!!errors.emergencyName} maxLength={120} />}</Field>
            <Field label={t('ops.heroes.w.emergencyPhone')} error={errors.emergencyPhone}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={f.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} invalid={!!errors.emergencyPhone} maxLength={20} />}</Field>
            <Field label={t('ops.heroes.w.relation')}>{(id) => <Input id={id} value={f.emergencyRelation} onChange={(e) => set('emergencyRelation', e.target.value)} maxLength={60} />}</Field>
          </fieldset>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('ops.heroes.w.vehicleType')} required>{(id) => <Select id={id} value={f.vehicleType} onChange={(e) => set('vehicleType', e.target.value)} options={enumOptions('VehicleType', Object.values(VehicleType))} />}</Field>
            <Field label={t('ops.heroes.w.plate')} error={errors.vehiclePlate}>{(id) => <Input id={id} value={f.vehiclePlate} onChange={(e) => set('vehiclePlate', e.target.value)} maxLength={20} />}</Field>
            <Field label={t('ops.heroes.w.license')} error={errors.licenseNumber}>{(id) => <Input id={id} dir="ltr" value={f.licenseNumber} onChange={(e) => set('licenseNumber', e.target.value)} maxLength={40} />}</Field>
            <Field label={t('ops.heroes.w.licenseExpiry')} error={errors.licenseExpiry}>{(id) => <Input id={id} type="date" value={f.licenseExpiry} onChange={(e) => set('licenseExpiry', e.target.value)} />}</Field>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{t('ops.heroes.w.docs')}</h3>
            <p className="mb-3 text-xs text-ink-500">{t('ops.heroes.w.docsHint')}</p>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
              {WIZARD_DOCS.map((type) => {
                const d = f.docs[type];
                return (
                  <li key={type} className="flex flex-wrap items-center gap-3 p-3">
                    <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', d ? 'bg-turtle-50 text-turtle-600 dark:bg-turtle-950' : 'bg-ink-100 text-ink-400 dark:bg-ink-800')}><FileCheck2 className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{en('DocumentType', type)}</p>
                      {d && <p className="truncate text-xs text-ink-500" dir="ltr">{d.name}</p>}
                    </div>
                    {d && EXPIRING.has(type) && (
                      <Input type="date" aria-label={t('ops.heroes.d.docExpiry')} className="!w-40" value={d.expiresAt} onChange={(e) => set('docs', { ...f.docs, [type]: { ...d, expiresAt: e.target.value } })} />
                    )}
                    <UploadButton purpose="courier_document" label={d ? t('ops.opsb.replaceFile') : t('ops.opsb.chooseFile')} onUploaded={(file) => set('docs', { ...f.docs, [type]: { url: file.url, name: file.name, expiresAt: d?.expiresAt ?? '' } })} />
                    {d && (
                      <Button variant="ghost" size="sm" aria-label={t('action.delete')} icon={<X className="h-4 w-4" />} onClick={() => { const n = { ...f.docs }; delete n[type]; set('docs', n); }} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <Field label={t('ops.heroes.w.homeHub')} error={errors.homeHubId}>
            {(id) => <Select id={id} value={f.homeHubId} onChange={(e) => set('homeHubId', e.target.value)} placeholder={t('ops.opsb.none')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: `${h.code} · ${h.name}` }))} />}
          </Field>
          <div>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{t('ops.heroes.w.zones')}</p>
                <p className="text-xs text-ink-500">{t('ops.heroes.w.zonesHint')}</p>
              </div>
              <Input className="!w-full sm:!w-56" type="search" placeholder={t('ops.heroes.w.zoneSearch')} value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} aria-label={t('ops.heroes.w.zoneSearch')} />
            </div>
            {errors.zones && <p className="mb-2 text-xs font-medium text-red-600">{errors.zones}</p>}
            <div className="max-h-56 overflow-y-auto rounded-xl border border-ink-100 p-3 dark:border-ink-800">
              <ChipGroup
                ariaLabel={t('ops.heroes.w.zones')}
                options={filteredZones.map((z) => ({ value: z.id, label: pick(z, 'name') }))}
                value={f.zones.map((z) => z.zoneId)}
                onChange={(next) => {
                  const added = next.find((id) => !f.zones.some((z) => z.zoneId === id));
                  const removed = f.zones.find((z) => !next.includes(z.zoneId));
                  toggleZone((added ?? removed?.zoneId) as string);
                }}
              />
            </div>
            <ZonePrimaryList zones={f.zones} name={zoneName} onPrimary={(id) => set('zones', f.zones.map((z) => ({ ...z, isPrimary: z.zoneId === id })))} onRemove={toggleZone} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div role="radiogroup" aria-label={t('ops.heroes.w.employment')} className="grid gap-3 sm:grid-cols-3">
            {Object.values(EmploymentType).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={f.employmentType === type}
                onClick={() => changeType(type)}
                className={cn('rounded-xl border p-3 text-start transition focus-visible:ring-2 focus-visible:ring-turtle-500', f.employmentType === type ? 'border-turtle-500 bg-turtle-50 ring-1 ring-turtle-500 dark:bg-turtle-950/40' : 'border-ink-200 hover:border-turtle-300 dark:border-ink-700')}
              >
                <p className="text-sm font-semibold text-ink-900 dark:text-white">{en('EmploymentType', type)}</p>
                <p className="mt-0.5 text-xs text-ink-500">{t(`ops.heroes.w.emp.${type}`)}</p>
              </button>
            ))}
          </div>
          <Notice tone="info">{t('ops.heroes.w.defaultsHint')}</Notice>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('ops.heroes.w.perDelivery')} error={errors.perDelivery}>{(id) => <MoneyInput id={id} value={f.perDelivery} onChange={(x) => set('perDelivery', x)} invalid={!!errors.perDelivery} />}</Field>
            {f.employmentType === 'FREELANCE' && <Field label={t('ops.heroes.w.perPickup')} error={errors.perPickup}>{(id) => <MoneyInput id={id} value={f.perPickup} onChange={(x) => set('perPickup', x)} invalid={!!errors.perPickup} />}</Field>}
            {f.employmentType === 'FREELANCE' && <Field label={t('ops.heroes.w.failedAttempt')} error={errors.failedAttempt}>{(id) => <MoneyInput id={id} value={f.failedAttempt} onChange={(x) => set('failedAttempt', x)} invalid={!!errors.failedAttempt} />}</Field>}
            {f.employmentType === 'SHIFT' && <Field label={t('ops.heroes.w.hourly')} required error={errors.hourly}>{(id) => <MoneyInput id={id} value={f.hourly} onChange={(x) => set('hourly', x)} invalid={!!errors.hourly} />}</Field>}
            {f.employmentType === 'FULL_TIME' && <Field label={t('ops.heroes.w.salary')} error={errors.salary}>{(id) => <MoneyInput id={id} value={f.salary} onChange={(x) => set('salary', x)} invalid={!!errors.salary} />}</Field>}
            <Field label={t('ops.heroes.w.cashLimit')} error={errors.cashLimit}>{(id) => <MoneyInput id={id} value={f.cashLimit} onChange={(x) => set('cashLimit', x)} invalid={!!errors.cashLimit} />}</Field>
            <Field label={t('ops.heroes.w.maxActive')} error={errors.maxActive}>{(id) => <Input id={id} dir="ltr" inputMode="numeric" value={f.maxActive} onChange={(e) => set('maxActive', e.target.value.replace(/\D/g, ''))} invalid={!!errors.maxActive} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('ops.heroes.w.wallet')} error={errors.walletPhone}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={f.walletPhone} onChange={(e) => set('walletPhone', e.target.value)} invalid={!!errors.walletPhone} maxLength={20} />}</Field>
            <Field label={t('ops.heroes.w.bankName')}>{(id) => <Input id={id} value={f.bankName} onChange={(e) => set('bankName', e.target.value)} maxLength={120} />}</Field>
            <Field label={t('ops.heroes.w.iban')} error={errors.iban}>{(id) => <Input id={id} dir="ltr" value={f.iban} onChange={(e) => set('iban', e.target.value.toUpperCase())} invalid={!!errors.iban} maxLength={40} />}</Field>
            <Field label={t('ops.heroes.w.accountName')}>{(id) => <Input id={id} value={f.accountName} onChange={(e) => set('accountName', e.target.value)} maxLength={120} />}</Field>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          {Object.values(errors).some(Boolean) && <Notice tone="danger">{t('ops.heroes.w.fixErrors')}</Notice>}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-ink-100 p-4 dark:border-ink-800">
              <p className="mb-2 text-xs font-semibold uppercase text-ink-400">{t('ops.heroes.w.s1')}</p>
              <InfoRow label={t('ops.heroes.w.name')} value={f.name} />
              <InfoRow label={t('ops.heroes.w.phone')} value={<span className="ltr">{normalizeEgyptPhone(f.phone) ?? f.phone}</span>} />
              {f.email && <InfoRow label={t('common.email')} value={<span className="ltr">{f.email}</span>} />}
              {f.nationalId && <InfoRow label={t('ops.heroes.w.nationalId')} value={<span className="ltr">{f.nationalId}</span>} />}
              <InfoRow label={t('ops.heroes.w.vehicleType')} value={en('VehicleType', f.vehicleType)} />
              <InfoRow label={t('ops.heroes.w.docs')} value={num(Object.keys(f.docs).length)} />
            </div>
            <div className="rounded-xl border border-ink-100 p-4 dark:border-ink-800">
              <p className="mb-2 text-xs font-semibold uppercase text-ink-400">{t('ops.heroes.w.s4')}</p>
              <InfoRow label={t('ops.heroes.w.employment')} value={en('EmploymentType', f.employmentType)} />
              <InfoRow label={t('ops.heroes.w.perDelivery')} value={<Money cents={parseEgp(f.perDelivery) ?? 0} />} />
              {f.employmentType === 'SHIFT' && <InfoRow label={t('ops.heroes.w.hourly')} value={<Money cents={parseEgp(f.hourly) ?? 0} />} />}
              {f.employmentType === 'FULL_TIME' && <InfoRow label={t('ops.heroes.w.salary')} value={<Money cents={parseEgp(f.salary) ?? 0} />} />}
              <InfoRow label={t('ops.heroes.w.cashLimit')} value={<Money cents={parseEgp(f.cashLimit) ?? 0} />} />
              <InfoRow label={t('ops.heroes.w.homeHub')} value={hubs.data?.find((h) => h.id === f.homeHubId)?.name ?? '—'} />
              <InfoRow label={t('ops.heroes.w.zones')} value={f.zones.length ? f.zones.map((z) => zoneName(z.zoneId) + (z.isPrimary ? ' ★' : '')).join('، ') : '—'} />
            </div>
          </div>
          <div className="rounded-xl bg-ink-50 p-4 dark:bg-ink-800/50">
            <Checkbox label={t('ops.heroes.w.activate')} checked={f.activate} onChange={(e) => set('activate', e.target.checked)} />
            <p className="ms-6 mt-1 text-xs text-ink-500">{t('ops.heroes.w.activateHint')}</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ZonePrimaryList({ zones, name, onPrimary, onRemove }: { zones: Array<{ zoneId: string; isPrimary: boolean }>; name: (id: string) => string; onPrimary: (id: string) => void; onRemove: (id: string) => void }) {
  const { t } = useI18n();
  if (!zones.length) return <p className="mt-3 text-sm text-ink-400">{t('ops.heroes.w.noZones')}</p>;
  return (
    <ul className="mt-3 divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
      {zones.map((z) => (
        <li key={z.zoneId} className="flex items-center gap-3 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800 dark:text-ink-100">{name(z.zoneId)}</span>
          {z.isPrimary ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sand-700 dark:text-sand-300"><Star className="h-3.5 w-3.5 fill-current" />{t('ops.heroes.w.primary')}</span>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => onPrimary(z.zoneId)}>{t('ops.heroes.w.makePrimary')}</Button>
          )}
          <Button size="xs" variant="ghost" aria-label={t('action.delete')} icon={<X className="h-3.5 w-3.5" />} onClick={() => onRemove(z.zoneId)} />
        </li>
      ))}
    </ul>
  );
}
