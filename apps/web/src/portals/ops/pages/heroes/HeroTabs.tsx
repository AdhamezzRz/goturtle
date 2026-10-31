import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, FileText, Plus, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { DocumentType, EmploymentType, VehicleType } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cairoToday, dateOnly, dateTime, money as fmtMoney, num, parseEgp, timeOnly } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, DataTable, Field, Input, Select, StateBadge, type Column } from '@/components/ui';
import {
  AdjustmentModal, AttendanceFlags, CashBar, ChipGroup, InfoRow, Money, MoneyInput, Notice, ReasonDialog, RecordHandoverModal, Section, UploadButton,
  addDaysStr, apiFieldErrors, centsToInput, enumOptions, minutesLabel, useEnumLabel, useForm, useHubs, useZones, v,
  type AdjustmentRow, type CustodyList, type Errors, type HandoverRow, type PayoutRow, type ShiftList, type ShiftRow,
} from '@/portals/ops/components/opsb';
import { ZonePrimaryList } from './OnboardHeroWizard';
import type { HeroDetail, HeroDocument } from './types';
import '../cash/i18n';
import '../finance/i18n';

const invalidateHero = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['heroes'] });
  qc.invalidateQueries({ queryKey: ['opsb', 'courier-options'] });
};

/* ───────────────────────────── Profile & rates ───────────────────────────── */

const fromHero = (h: HeroDetail) => ({
  name: h.name, phone: h.phone, email: h.email ?? '', locale: h.locale, nationalId: h.nationalId ?? '', dateOfBirth: h.dateOfBirth ?? '',
  vehicleType: h.vehicleType, vehiclePlate: h.vehiclePlate ?? '', licenseNumber: h.licenseNumber ?? '', licenseExpiry: h.licenseExpiry?.slice(0, 10) ?? '',
  homeHubId: h.homeHub?.id ?? '', employmentType: h.employmentType,
  perDelivery: centsToInput(h.rates.perDeliveryRateCents), perPickup: centsToInput(h.rates.perPickupRateCents), failedAttempt: centsToInput(h.rates.failedAttemptRateCents),
  hourly: centsToInput(h.rates.hourlyRateCents), salary: centsToInput(h.rates.monthlySalaryCents), cashLimit: centsToInput(h.cash.limitCents), maxActive: String(h.maxActiveOrders),
  walletPhone: h.walletPhone ?? '', bankName: h.bankDetails?.bankName ?? '', iban: h.bankDetails?.iban ?? '', accountName: h.bankDetails?.accountName ?? '', instapay: h.bankDetails?.instapayAddress ?? '',
  emergencyName: h.emergencyContact?.name ?? '', emergencyPhone: h.emergencyContact?.phone ?? '', emergencyRelation: h.emergencyContact?.relation ?? '',
});

export function HeroProfileTab({ hero }: { hero: HeroDetail }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const hubs = useHubs();
  const ro = !can('couriers.manage') || hero.status === 'OFFBOARDED';
  const { values: f, set, errors, setErrors, reset } = useForm(fromHero(hero));
  useEffect(() => {
    reset(fromHero(hero));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero.id, hero.updatedAt]);

  const save = useMutation({
    mutationFn: () => {
      const c = (s: string) => parseEgp(s) ?? 0;
      return api(`/couriers/${hero.id}`, {
        method: 'PATCH',
        body: {
          name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || undefined, locale: f.locale,
          nationalId: f.nationalId || undefined, dateOfBirth: f.dateOfBirth || undefined,
          vehicleType: f.vehicleType, vehiclePlate: f.vehiclePlate.trim() || undefined, licenseNumber: f.licenseNumber.trim() || undefined, licenseExpiry: f.licenseExpiry || undefined,
          homeHubId: f.homeHubId || undefined, employmentType: f.employmentType,
          perDeliveryRateCents: c(f.perDelivery), perPickupRateCents: c(f.perPickup), failedAttemptRateCents: c(f.failedAttempt), hourlyRateCents: c(f.hourly), monthlySalaryCents: c(f.salary),
          cashLimitCents: c(f.cashLimit), maxActiveOrders: Number(f.maxActive),
          walletPhone: f.walletPhone.trim() || undefined,
          bankDetails: { bankName: f.bankName || undefined, iban: f.iban || undefined, accountName: f.accountName || undefined, instapayAddress: f.instapay || undefined },
          emergencyContact: f.emergencyName ? { name: f.emergencyName.trim(), phone: f.emergencyPhone.trim(), relation: f.emergencyRelation.trim() || undefined } : undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success(t('ops.heroes.d.saved'));
      invalidateHero(qc);
    },
    onError: (err) => {
      const map: Record<string, string> = { perDeliveryRateCents: 'perDelivery', perPickupRateCents: 'perPickup', failedAttemptRateCents: 'failedAttempt', hourlyRateCents: 'hourly', monthlySalaryCents: 'salary', cashLimitCents: 'cashLimit', maxActiveOrders: 'maxActive' };
      const raw = apiFieldErrors(err, ['name', 'phone', 'email', 'nationalId', 'dateOfBirth', 'vehiclePlate', 'licenseNumber', 'licenseExpiry', 'walletPhone', 'homeHubId', 'emergencyContact', ...Object.keys(map)], {
        PHONE_TAKEN: 'phone', INVALID_PHONE: 'phone', EMAIL_TAKEN: 'email', NATIONAL_ID_TAKEN: 'nationalId', NATIONAL_ID_MISMATCH: 'dateOfBirth', INVALID_NATIONAL_ID: 'nationalId', HOURLY_RATE_REQUIRED: 'hourlyRateCents', INVALID_HUB: 'homeHubId',
      });
      const e: Errors = {};
      for (const [k, val] of Object.entries(raw)) e[map[k] ?? (k === 'emergencyContact' ? 'emergencyPhone' : k)] = val;
      setErrors(e);
      toast.error(errorMessage(err));
    },
  });

  const submit = () => {
    const e: Errors = {};
    if (!v.min(f.name, 2)) e.name = t('ops.opsb.minChars', { n: 2 });
    if (!v.phone(f.phone)) e.phone = t('ops.opsb.invalidPhone');
    if (f.email && !v.email(f.email)) e.email = t('ops.opsb.invalidEmail');
    if (f.nationalId && !/^\d{14}$/.test(f.nationalId)) e.nationalId = t('ops.heroes.w.nationalIdInvalid');
    for (const k of ['perDelivery', 'perPickup', 'failedAttempt', 'hourly', 'salary', 'cashLimit'] as const) if (f[k] !== '' && parseEgp(f[k]) === null) e[k] = t('ops.opsb.invalidAmount');
    if (f.employmentType === 'SHIFT' && !(parseEgp(f.hourly) ?? 0)) e.hourly = t('ops.heroes.w.hourlyRequired');
    const max = Number(f.maxActive);
    if (!Number.isInteger(max) || max < 1 || max > 200) e.maxActive = '1 – 200';
    if (f.walletPhone && !v.phone(f.walletPhone)) e.walletPhone = t('ops.opsb.invalidPhone');
    if (f.emergencyName && !v.phone(f.emergencyPhone)) e.emergencyPhone = t('ops.opsb.invalidPhone');
    setErrors(e);
    if (!Object.values(e).some(Boolean)) save.mutate();
  };

  const money = (k: 'perDelivery' | 'perPickup' | 'failedAttempt' | 'hourly' | 'salary' | 'cashLimit', label: string, required?: boolean) => (
    <Field label={label} error={errors[k]} required={required}>{(id) => <MoneyInput id={id} value={f[k]} onChange={(x) => set(k, x)} invalid={!!errors[k]} disabled={ro} />}</Field>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Section title={t('ops.heroes.d.personal')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('ops.heroes.w.name')} required error={errors.name}>{(id) => <Input id={id} value={f.name} disabled={ro} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} />}</Field>
            <Field label={t('ops.heroes.w.phone')} required error={errors.phone}>{(id) => <Input id={id} dir="ltr" value={f.phone} disabled={ro} onChange={(e) => set('phone', e.target.value)} invalid={!!errors.phone} />}</Field>
            <Field label={t('common.email')} error={errors.email}>{(id) => <Input id={id} dir="ltr" value={f.email} disabled={ro} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} />}</Field>
            <Field label={t('ops.heroes.w.locale')}>{(id) => <Select id={id} value={f.locale} disabled={ro} onChange={(e) => set('locale', e.target.value as 'ar' | 'en')} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />}</Field>
            <Field label={t('ops.heroes.w.nationalId')} error={errors.nationalId}>{(id) => <Input id={id} dir="ltr" value={f.nationalId} disabled={ro} onChange={(e) => set('nationalId', e.target.value.replace(/\D/g, '').slice(0, 14))} invalid={!!errors.nationalId} />}</Field>
            <Field label={t('ops.heroes.w.dob')} error={errors.dateOfBirth}>{(id) => <Input id={id} type="date" value={f.dateOfBirth} disabled={ro} onChange={(e) => set('dateOfBirth', e.target.value)} />}</Field>
            <Field label={t('ops.heroes.w.emergencyName')}>{(id) => <Input id={id} value={f.emergencyName} disabled={ro} onChange={(e) => set('emergencyName', e.target.value)} />}</Field>
            <Field label={t('ops.heroes.w.emergencyPhone')} error={errors.emergencyPhone}>{(id) => <Input id={id} dir="ltr" value={f.emergencyPhone} disabled={ro} onChange={(e) => set('emergencyPhone', e.target.value)} invalid={!!errors.emergencyPhone} />}</Field>
          </div>
        </Section>
        <Section title={t('ops.heroes.d.vehicle')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('ops.heroes.w.vehicleType')}>{(id) => <Select id={id} value={f.vehicleType} disabled={ro} onChange={(e) => set('vehicleType', e.target.value)} options={enumOptions('VehicleType', Object.values(VehicleType))} />}</Field>
            <Field label={t('ops.heroes.w.plate')}>{(id) => <Input id={id} value={f.vehiclePlate} disabled={ro} onChange={(e) => set('vehiclePlate', e.target.value)} />}</Field>
            <Field label={t('ops.heroes.w.license')}>{(id) => <Input id={id} dir="ltr" value={f.licenseNumber} disabled={ro} onChange={(e) => set('licenseNumber', e.target.value)} />}</Field>
            <Field label={t('ops.heroes.w.licenseExpiry')} error={errors.licenseExpiry}>{(id) => <Input id={id} type="date" value={f.licenseExpiry} disabled={ro} onChange={(e) => set('licenseExpiry', e.target.value)} />}</Field>
            <Field label={t('ops.heroes.w.homeHub')} error={errors.homeHubId} className="sm:col-span-2">{(id) => <Select id={id} value={f.homeHubId} disabled={ro} onChange={(e) => set('homeHubId', e.target.value)} placeholder={t('ops.opsb.none')} options={(hubs.data ?? []).map((h) => ({ value: h.id, label: `${h.code} · ${h.name}` }))} />}</Field>
          </div>
        </Section>
      </div>
      <Section title={t('ops.heroes.d.rates')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('ops.heroes.w.employment')}>{(id) => <Select id={id} value={f.employmentType} disabled={ro} onChange={(e) => set('employmentType', e.target.value)} options={enumOptions('EmploymentType', Object.values(EmploymentType))} />}</Field>
          {money('perDelivery', t('ops.heroes.w.perDelivery'))}
          {money('perPickup', t('ops.heroes.w.perPickup'))}
          {money('failedAttempt', t('ops.heroes.w.failedAttempt'))}
          {money('hourly', t('ops.heroes.w.hourly'), f.employmentType === 'SHIFT')}
          {money('salary', t('ops.heroes.w.salary'))}
          {money('cashLimit', t('ops.heroes.w.cashLimit'))}
          <Field label={t('ops.heroes.w.maxActive')} error={errors.maxActive}>{(id) => <Input id={id} dir="ltr" inputMode="numeric" value={f.maxActive} disabled={ro} onChange={(e) => set('maxActive', e.target.value.replace(/\D/g, ''))} invalid={!!errors.maxActive} />}</Field>
        </div>
      </Section>
      <Section title={t('ops.heroes.d.payoutDetails')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('ops.heroes.w.wallet')} error={errors.walletPhone}>{(id) => <Input id={id} dir="ltr" value={f.walletPhone} disabled={ro} onChange={(e) => set('walletPhone', e.target.value)} invalid={!!errors.walletPhone} />}</Field>
          <Field label={t('ops.heroes.w.bankName')}>{(id) => <Input id={id} value={f.bankName} disabled={ro} onChange={(e) => set('bankName', e.target.value)} />}</Field>
          <Field label={t('ops.heroes.w.iban')}>{(id) => <Input id={id} dir="ltr" value={f.iban} disabled={ro} onChange={(e) => set('iban', e.target.value.toUpperCase())} maxLength={40} />}</Field>
          <Field label={t('ops.heroes.w.accountName')}>{(id) => <Input id={id} value={f.accountName} disabled={ro} onChange={(e) => set('accountName', e.target.value)} />}</Field>
        </div>
      </Section>
      {!ro && (
        <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 rounded-2xl border border-ink-100 bg-white/90 p-3 backdrop-blur dark:border-ink-800 dark:bg-ink-900/90">
          <Button variant="outline" onClick={() => reset(fromHero(hero))}>{t('action.cancel')}</Button>
          <Button loading={save.isPending} onClick={submit}>{t('action.save')}</Button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Zones ───────────────────────────── */

export function HeroZonesTab({ hero }: { hero: HeroDetail }) {
  const { t, pick } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const zones = useZones();
  const ro = !can('couriers.manage') || hero.status === 'OFFBOARDED';
  const [sel, setSel] = useState(hero.zones.map((z) => ({ zoneId: z.zoneId, isPrimary: z.isPrimary })));
  const [filter, setFilter] = useState('');
  useEffect(() => setSel(hero.zones.map((z) => ({ zoneId: z.zoneId, isPrimary: z.isPrimary }))), [hero.zones]);
  const dirty = JSON.stringify(sel) !== JSON.stringify(hero.zones.map((z) => ({ zoneId: z.zoneId, isPrimary: z.isPrimary })));
  const save = useMutation({
    mutationFn: () => api(`/couriers/${hero.id}`, { method: 'PATCH', body: { zones: sel } }),
    onSuccess: () => { toast.success(t('ops.heroes.d.saved')); invalidateHero(qc); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const toggle = (id: string) => {
    const has = sel.find((z) => z.zoneId === id);
    if (has) {
      const rest = sel.filter((z) => z.zoneId !== id);
      if (has.isPrimary && rest.length) rest[0] = { ...rest[0], isPrimary: true };
      setSel(rest);
    } else setSel([...sel, { zoneId: id, isPrimary: sel.length === 0 }]);
  };
  const name = (id: string) => {
    const z = zones.data?.find((x) => x.id === id) ?? hero.zones.find((x) => x.zoneId === id);
    return z ? pick(z, 'name') : id;
  };
  const opts = useMemo(() => (zones.data ?? []).filter((z) => !filter || z.nameEn.toLowerCase().includes(filter.toLowerCase()) || z.nameAr.includes(filter)), [zones.data, filter]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title={t('ops.heroes.d.zonesTitle')} actions={!ro && <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('ops.heroes.d.saveZones')}</Button>}>
        <ZonePrimaryList zones={sel} name={name} onPrimary={(id) => !ro && setSel(sel.map((z) => ({ ...z, isPrimary: z.zoneId === id })))} onRemove={(id) => !ro && toggle(id)} />
      </Section>
      {!ro && (
        <Section title={t('ops.heroes.w.zones')} subtitle={t('ops.heroes.w.zonesHint')} actions={<Input type="search" className="w-48" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('ops.heroes.w.zoneSearch')} aria-label={t('ops.heroes.w.zoneSearch')} />}>
          <ChipGroup
            ariaLabel={t('ops.heroes.w.zones')}
            options={opts.map((z) => ({ value: z.id, label: pick(z, 'name') }))}
            value={sel.map((z) => z.zoneId)}
            onChange={(next) => {
              const added = next.find((id) => !sel.some((z) => z.zoneId === id));
              const removed = sel.find((z) => !next.includes(z.zoneId));
              toggle((added ?? removed?.zoneId) as string);
            }}
          />
        </Section>
      )}
    </div>
  );
}

/* ───────────────────────────── Documents ───────────────────────────── */

const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

export function HeroDocumentsTab({ hero }: { hero: HeroDetail }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const manage = can('couriers.manage') && hero.status !== 'OFFBOARDED';
  const docs = useQuery({ queryKey: ['heroes', 'docs', hero.id], queryFn: () => api<HeroDocument[]>(`/couriers/${hero.id}/documents`) });
  const [newType, setNewType] = useState<string>(hero.documents.missingRequired[0] ?? 'NATIONAL_ID_FRONT');
  const [newExpiry, setNewExpiry] = useState('');
  const [rejecting, setRejecting] = useState<HeroDocument | null>(null);

  const add = useMutation({
    mutationFn: (url: string) => api(`/couriers/${hero.id}/documents`, { method: 'POST', body: { type: newType, url, expiresAt: newExpiry ? new Date(`${newExpiry}T00:00:00Z`).toISOString() : undefined } }),
    onSuccess: () => { toast.success(t('ops.heroes.d.docAdded')); setNewExpiry(''); qc.invalidateQueries({ queryKey: ['heroes'] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const review = useMutation({
    mutationFn: ({ doc, status, note }: { doc: HeroDocument; status: 'APPROVED' | 'REJECTED'; note?: string }) => api(`/couriers/${hero.id}/documents/${doc.id}/review`, { method: 'POST', body: { status, note } }),
    onSuccess: () => { toast.success(t('ops.heroes.d.reviewed')); setRejecting(null); qc.invalidateQueries({ queryKey: ['heroes'] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const expiryBadge = (d: HeroDocument) => {
    if (!d.expiresAt) return null;
    const n = daysUntil(d.expiresAt);
    if (n < 0) return <Badge tone="danger">{t('ops.heroes.d.expired')}</Badge>;
    if (n <= 30) return <Badge tone="warning">{t('ops.heroes.d.expiresIn', { n: num(n) })}</Badge>;
    return <span className="text-xs text-ink-500">{t('ops.heroes.d.expires', { date: dateOnly(d.expiresAt) })}</span>;
  };

  const columns: Column<HeroDocument>[] = [
    { key: 'type', header: t('ops.heroes.d.docType'), cell: (d) => <span className="inline-flex items-center gap-2 font-medium text-ink-800 dark:text-ink-100"><FileText className="h-4 w-4 text-ink-400" />{en('DocumentType', d.type)}</span> },
    { key: 'status', header: t('common.status'), cell: (d) => <Badge tone={d.status === 'APPROVED' ? 'success' : d.status === 'REJECTED' ? 'danger' : 'warning'} dot>{en('DocumentStatus', d.status)}</Badge> },
    { key: 'expiry', header: t('ops.heroes.d.docExpiry'), cell: (d) => expiryBadge(d) ?? '—' },
    { key: 'note', header: t('common.notes'), cell: (d) => <span className="text-xs text-ink-500">{d.reviewNote ?? '—'}</span>, hideBelow: 'lg' },
    { key: 'created', header: t('ops.opsb.created'), cell: (d) => <span className="text-xs">{dateTime(d.createdAt)}</span>, hideBelow: 'lg' },
    {
      key: 'actions', header: '', align: 'end', cell: (d) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm font-medium text-turtle-700 hover:bg-turtle-50 dark:text-turtle-400 dark:hover:bg-ink-800"><ExternalLink className="h-4 w-4" />{t('action.view')}</a>
          {manage && d.status !== 'APPROVED' && <Button size="sm" variant="outline" icon={<CheckCircle2 className="h-4 w-4" />} loading={review.isPending && review.variables?.doc.id === d.id && review.variables.status === 'APPROVED'} onClick={() => review.mutate({ doc: d, status: 'APPROVED' })}>{t('ops.heroes.d.approve')}</Button>}
          {manage && d.status !== 'REJECTED' && <Button size="sm" variant="ghost" icon={<XCircle className="h-4 w-4 text-red-500" />} onClick={() => setRejecting(d)}>{t('ops.heroes.d.reject')}</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {hero.documents.missingRequired.length > 0 && <Notice tone="warning">{t('ops.heroes.d.docsMissing', { list: hero.documents.missingRequired.map((x) => en('DocumentType', x)).join('، ') })}</Notice>}
      {manage && (
        <Section title={t('ops.heroes.d.docUpload')}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label={t('ops.heroes.d.docType')} className="sm:w-64">{(id) => <Select id={id} value={newType} onChange={(e) => setNewType(e.target.value)} options={enumOptions('DocumentType', Object.values(DocumentType))} />}</Field>
            <Field label={t('ops.heroes.d.docExpiry')} hint={t('ops.opsb.optional')} className="sm:w-48">{(id) => <Input id={id} type="date" value={newExpiry} min={cairoToday()} onChange={(e) => setNewExpiry(e.target.value)} />}</Field>
            <div className="sm:pb-6"><UploadButton purpose="courier_document" variant="primary" size="md" label={t('ops.opsb.chooseFile')} disabled={add.isPending} onUploaded={(file) => add.mutate(file.url)} /></div>
          </div>
        </Section>
      )}
      <DataTable
        columns={columns}
        rows={docs.data}
        rowKey={(d) => d.id}
        loading={docs.isLoading}
        error={docs.error}
        onRetry={() => docs.refetch()}
        empty={t('ops.heroes.d.noDocs')}
        mobileCard={(d) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-ink-800 dark:text-ink-100">{en('DocumentType', d.type)}</p>
              <Badge tone={d.status === 'APPROVED' ? 'success' : d.status === 'REJECTED' ? 'danger' : 'warning'} dot>{en('DocumentStatus', d.status)}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">{expiryBadge(d)}<span>{t('ops.heroes.d.uploaded', { date: dateOnly(d.createdAt) })}</span></div>
            {d.reviewNote && <p className="text-xs text-ink-500">{d.reviewNote}</p>}
            {columns[columns.length - 1].cell(d)}
          </div>
        )}
      />
      <ReasonDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={t('ops.heroes.d.rejectTitle')}
        description={rejecting ? en('DocumentType', rejecting.type) : undefined}
        label={t('ops.heroes.d.rejectNote')}
        danger
        confirmLabel={t('ops.heroes.d.reject')}
        loading={review.isPending}
        onConfirm={(note) => rejecting && review.mutate({ doc: rejecting, status: 'REJECTED', note })}
      />
    </div>
  );
}

/* ───────────────────────────── Shifts ───────────────────────────── */

export function ShiftTimeCell({ s }: { s: ShiftRow }) {
  return (
    <span className="ltr whitespace-nowrap text-sm tabular">
      {timeOnly(s.startAt)} – {timeOnly(s.endAt)}
    </span>
  );
}

export function HeroShiftsTab({ hero }: { hero: HeroDetail }) {
  const { t } = useI18n();
  const today = cairoToday();
  const from = addDaysStr(today, -14);
  const to = addDaysStr(today, 7);
  const q = useQuery({ queryKey: ['shifts', 'hero', hero.id, from, to], queryFn: () => api<ShiftList>('/shifts', { query: { courierId: hero.id, from, to } }) });
  const columns: Column<ShiftRow>[] = [
    { key: 'day', header: t('common.date'), cell: (s) => <span className="whitespace-nowrap font-medium">{dateOnly(s.startAt)}</span> },
    { key: 'tpl', header: t('ops.opsb.type'), cell: (s) => s.template?.name ?? '—', hideBelow: 'md' },
    { key: 'time', header: t('ops.opsb.period'), cell: (s) => <ShiftTimeCell s={s} /> },
    { key: 'status', header: t('common.status'), cell: (s) => <StateBadge value={s.status} /> },
    { key: 'worked', header: t('ops.heroes.d.worked'), cell: (s) => <span className="ltr tabular">{minutesLabel(s.workedMinutes)} / {minutesLabel(s.scheduledMinutes)}</span>, hideBelow: 'md' },
    { key: 'flags', header: '', cell: (s) => <AttendanceFlags s={s} /> },
    { key: 'earned', header: t('ops.heroes.d.k.earnings'), align: 'end', cell: (s) => <Money cents={s.earnedCents || s.expectedEarningsCents} className={s.earnedCents ? '' : 'text-ink-400'} /> },
  ];
  return (
    <Section title={t('ops.heroes.d.shiftsTitle')} actions={<Link to={`/ops/shifts?courierId=${hero.id}`}><Button size="sm" variant="outline">{t('ops.nav.shifts')}</Button></Link>}>
      <DataTable
        columns={columns}
        rows={q.data?.data}
        rowKey={(s) => s.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={t('ops.heroes.d.noShifts')}
        dense
        mobileCard={(s) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{dateOnly(s.startAt)} · {s.template?.name ?? '—'}</span><StateBadge value={s.status} /></div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><ShiftTimeCell s={s} /><Money cents={s.earnedCents || s.expectedEarningsCents} /></div>
            <AttendanceFlags s={s} />
          </div>
        )}
      />
    </Section>
  );
}

/* ───────────────────────────── Pay ───────────────────────────── */

export function HeroPayTab({ hero }: { hero: HeroDetail }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const [adjOpen, setAdjOpen] = useState(false);
  const [reversing, setReversing] = useState<AdjustmentRow | null>(null);
  const adj = useQuery({ queryKey: ['finance', 'adjustments', 'hero', hero.id], queryFn: () => api<Paginated<AdjustmentRow>>('/finance/adjustments', { query: { courierId: hero.id, pageSize: 50 } }) });
  const pays = useQuery({ queryKey: ['finance', 'payouts', 'hero', hero.id], queryFn: () => api<Paginated<PayoutRow>>('/finance/payouts', { query: { courierId: hero.id, pageSize: 20 } }) });
  const reverse = useMutation({
    mutationFn: ({ a, reason }: { a: AdjustmentRow; reason: string }) => api(`/finance/adjustments/${a.id}/reverse`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success(t('ops.opsb.adj.done')); setReversing(null); qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['heroes'] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const adjCols: Column<AdjustmentRow>[] = [
    { key: 'date', header: t('common.date'), cell: (a) => <span className="whitespace-nowrap text-sm">{dateTime(a.createdAt)}</span> },
    { key: 'type', header: t('ops.opsb.type'), cell: (a) => <Badge tone={a.signedAmountCents >= 0 ? 'success' : 'danger'}>{en('AdjustmentType', a.type)}{a.isReversal ? ' ↺' : ''}</Badge> },
    { key: 'reason', header: t('ops.opsb.reason'), cell: (a) => <span className="line-clamp-2 text-sm">{a.reason}</span>, hideBelow: 'md' },
    { key: 'amount', header: t('common.amount'), align: 'end', cell: (a) => <Money cents={a.signedAmountCents} sign tone="auto" className="font-semibold" /> },
    { key: 'paid', header: '', cell: (a) => (a.payoutId ? <Badge tone="neutral">{t('state.PAID')}</Badge> : null), hideBelow: 'sm' },
    {
      key: 'act', header: '', align: 'end',
      cell: (a) => (can('finance.manage') && !a.isReversal && !a.payoutId ? <Button size="xs" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setReversing(a)}>{t('ops.payouts.adj.reverse')}</Button> : null),
    },
  ];
  const payCols: Column<PayoutRow>[] = [
    { key: 'code', header: t('ops.opsb.code'), cell: (p) => <span className="ltr font-mono text-xs font-semibold">{p.code}</span> },
    { key: 'period', header: t('ops.opsb.period'), cell: (p) => <span className="whitespace-nowrap text-sm">{dateOnly(p.periodStart)} – {dateOnly(p.periodEnd)}</span> },
    { key: 'status', header: t('common.status'), cell: (p) => <StateBadge value={p.status} /> },
    { key: 'net', header: t('common.total'), align: 'end', cell: (p) => <Money cents={p.netCents} className="font-semibold" /> },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title={t('ops.heroes.d.payable')}><p className="font-display text-3xl font-bold"><Money cents={hero.payableCents} /></p></Section>
        <Section title={t('ops.heroes.d.k.earnings')}>
          <InfoRow label={t('ops.heroes.d.window.today')} value={<Money cents={hero.kpis.today.earningsCents} />} />
          <InfoRow label={t('ops.heroes.d.window.last7d')} value={<Money cents={hero.kpis.last7d.earningsCents} />} />
          <InfoRow label={t('ops.heroes.d.window.last30d')} value={<Money cents={hero.kpis.last30d.earningsCents} />} />
        </Section>
      </div>
      <Section title={t('ops.heroes.d.adjustments')} actions={can('finance.manage') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdjOpen(true)}>{t('ops.heroes.d.newAdjustment')}</Button>}>
        <DataTable columns={adjCols} rows={adj.data?.data} rowKey={(a) => a.id} loading={adj.isLoading} error={adj.error} onRetry={() => adj.refetch()} dense
          mobileCard={(a) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">{adjCols[1].cell(a)}<Money cents={a.signedAmountCents} sign tone="auto" className="font-semibold" /></div>
              <p className="text-sm text-ink-600 dark:text-ink-300">{a.reason}</p>
              <div className="flex items-center justify-between text-xs text-ink-400"><span>{dateTime(a.createdAt)}</span>{adjCols[5].cell(a)}</div>
            </div>
          )}
        />
      </Section>
      <Section title={t('ops.heroes.d.payouts')} actions={<Link to={`/ops/finance/payouts?courierId=${hero.id}`}><Button size="sm" variant="outline">{t('ops.nav.payouts')}</Button></Link>}>
        <DataTable columns={payCols} rows={pays.data?.data} rowKey={(p) => p.id} loading={pays.isLoading} error={pays.error} onRetry={() => pays.refetch()} dense
          mobileCard={(p) => (
            <div className="flex items-center justify-between gap-2">
              <div><p className="ltr font-mono text-xs font-semibold">{p.code}</p><p className="text-xs text-ink-500">{dateOnly(p.periodStart)} – {dateOnly(p.periodEnd)}</p></div>
              <div className="text-end"><Money cents={p.netCents} className="font-semibold" /><div className="mt-1"><StateBadge value={p.status} /></div></div>
            </div>
          )}
        />
      </Section>
      <AdjustmentModal open={adjOpen} onClose={() => setAdjOpen(false)} courier={{ id: hero.id, name: hero.name, code: hero.code }} />
      <ReasonDialog
        open={!!reversing}
        onClose={() => setReversing(null)}
        title={t('ops.payouts.adj.reverseTitle')}
        description={reversing ? <span>{en('AdjustmentType', reversing.type)} · <Money cents={reversing.signedAmountCents} sign /></span> : undefined}
        danger
        loading={reverse.isPending}
        confirmLabel={t('ops.payouts.adj.reverse')}
        onConfirm={(reason) => reversing && reverse.mutate({ a: reversing, reason })}
      />
    </div>
  );
}

/* ───────────────────────────── Cash ───────────────────────────── */

export function HeroCashTab({ hero }: { hero: HeroDetail }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const [drop, setDrop] = useState(false);
  const [shortage, setShortage] = useState(false);
  const custody = useQuery({ queryKey: ['cash', 'custody', 'hero', hero.code], queryFn: () => api<CustodyList>('/cash/custody', { query: { q: hero.code, pageSize: 5 } }).then((r) => r.data.find((c) => c.courierId === hero.id) ?? null) });
  const ho = useQuery({ queryKey: ['cash', 'handovers', 'hero', hero.id], queryFn: () => api<Paginated<HandoverRow>>('/cash/handovers', { query: { courierId: hero.id, pageSize: 30 } }) });
  const conv = useMutation({
    mutationFn: (reason: string) => api('/cash/shortages', { method: 'POST', body: { courierId: hero.id, reason } }),
    onSuccess: () => { toast.success(t('ops.cash.shortageDone')); setShortage(false); qc.invalidateQueries({ queryKey: ['cash'] }); qc.invalidateQueries({ queryKey: ['heroes'] }); qc.invalidateQueries({ queryKey: ['finance'] }); },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const c = custody.data;
  const cols: Column<HandoverRow>[] = [
    { key: 'code', header: t('ops.opsb.code'), cell: (h) => <span className="ltr font-mono text-xs font-semibold">{h.code}</span> },
    { key: 'date', header: t('common.date'), cell: (h) => <span className="whitespace-nowrap text-sm">{dateTime(h.createdAt)}</span> },
    { key: 'method', header: t('ops.opsb.method'), cell: (h) => en('HandoverMethod', h.method), hideBelow: 'md' },
    { key: 'status', header: t('common.status'), cell: (h) => <StateBadge value={h.status} /> },
    { key: 'declared', header: t('ops.cash.declared'), align: 'end', cell: (h) => <Money cents={h.declaredCents} /> },
    { key: 'received', header: t('ops.cash.received'), align: 'end', cell: (h) => (h.status === 'CONFIRMED' ? <Money cents={h.receivedCents} /> : '—') },
    { key: 'var', header: t('ops.cash.variance'), align: 'end', cell: (h) => (h.status === 'CONFIRMED' ? <Money cents={h.varianceCents} sign tone="auto" /> : '—'), hideBelow: 'sm' },
  ];
  return (
    <div className="space-y-5">
      <Section
        title={t('ops.heroes.d.custody')}
        actions={can('cash.manage') && (
          <>
            {!!c?.outstandingShortageCents && <Button size="sm" variant="outline" onClick={() => setShortage(true)}>{t('ops.heroes.d.convertShortage')}</Button>}
            <Button size="sm" variant="cash" disabled={hero.cash.onHandCents <= 0} onClick={() => setDrop(true)}>{t('ops.heroes.d.recordDrop')}</Button>
          </>
        )}
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="mb-2 font-display text-3xl font-bold"><Money cents={hero.cash.onHandCents} /></p>
            <CashBar onHandCents={hero.cash.onHandCents} limitCents={hero.cash.limitCents} />
          </div>
          <div>
            <InfoRow label={t('ops.cash.unhanded')} value={c ? <span className="ltr">{num(c.unhandedOrders)}</span> : '—'} />
            <InfoRow label={t('ops.cash.oldest')} value={c?.oldestUnhandedHours ? t('ops.opsb.hours', { n: num(Math.round(c.oldestUnhandedHours)) }) : '—'} tone={c && (c.oldestUnhandedHours ?? 0) > 24 ? 'danger' : undefined} />
            <InfoRow label={t('ops.cash.pending')} value={c ? <Money cents={c.pendingDeclaredCents} /> : '—'} />
            <InfoRow label={t('ops.cash.shortage')} value={c ? <Money cents={c.outstandingShortageCents} tone={c.outstandingShortageCents ? 'auto' : 'none'} /> : '—'} />
          </div>
        </div>
      </Section>
      <Section title={t('ops.heroes.d.handovers')}>
        <DataTable columns={cols} rows={ho.data?.data} rowKey={(h) => h.id} loading={ho.isLoading} error={ho.error} onRetry={() => ho.refetch()} dense
          mobileCard={(h) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2"><span className="ltr font-mono text-xs font-semibold">{h.code}</span><StateBadge value={h.status} /></div>
              <div className="flex items-center justify-between gap-2 text-sm"><span>{en('HandoverMethod', h.method)}</span><Money cents={h.status === 'CONFIRMED' ? h.receivedCents : h.declaredCents} className="font-semibold" /></div>
              <p className="text-xs text-ink-400">{dateTime(h.createdAt)}</p>
            </div>
          )}
        />
      </Section>
      <RecordHandoverModal open={drop} onClose={() => setDrop(false)} courier={{ id: hero.id, name: hero.name, code: hero.code, cashOnHandCents: hero.cash.onHandCents, homeHubId: hero.homeHub?.id }} />
      <ReasonDialog
        open={shortage}
        onClose={() => setShortage(false)}
        title={t('ops.cash.shortageTitle')}
        description={c ? t('ops.cash.shortageDesc', { amount: fmtMoney(c.outstandingShortageCents) }) : undefined}
        danger
        loading={conv.isPending}
        confirmLabel={t('ops.heroes.d.convertShortage')}
        onConfirm={(reason) => conv.mutate(reason)}
      />
    </div>
  );
}
