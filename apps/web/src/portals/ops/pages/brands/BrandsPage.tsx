import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, Clock, Plus, Search, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { BrandStatus, PayoutMethod, SettlementCycle } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { num } from '@/lib/format';
import { useDebounced, useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Button, Checkbox, DataTable, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, StateBadge, type Column } from '@/components/ui';
import { Code, FilterBar, FilterField, Money, RequirePermission, Stat, StatGrid, TempPasswordPanel, apiFieldErrors, enumOptions, useEnumLabel, useForm, useStaffOptions, v, type Errors } from '@/portals/ops/components/opsb';
import { LocationFields, emptyLocation, validateLocation, type LocationValues } from './LocationFields';
import type { BrandRow, PricingPlan } from './types';
import './i18n';

export const usePlans = () => useQuery({ queryKey: ['opsb', 'plans'], queryFn: () => api<PricingPlan[]>('/pricing/plans'), staleTime: 5 * 60_000 });

const count = (status?: string) => api<Paginated<BrandRow>>('/brands', { query: { status, pageSize: 1 } }).then((r) => r.meta.total);

export default function BrandsPage() {
  return (
    <RequirePermission permission="brands.read">
      <BrandsInner />
    </RequirePermission>
  );
}

function BrandsInner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const nav = useNavigate();
  const plans = usePlans();
  const [f, setF] = useQueryState({ q: '', status: '', planId: '', cycle: '', page: '1', onboard: '' });
  const [q, setQ] = useState(f.q);
  const dq = useDebounced(q, 350);
  useEffect(() => {
    if (dq !== f.q) setF({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const list = useQuery({
    queryKey: ['brands', 'list', f],
    queryFn: () => api<Paginated<BrandRow>>('/brands', { query: { q: f.q, status: f.status, planId: f.planId, cycle: f.cycle, page: f.page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const stats = useQuery({ queryKey: ['brands', 'stats'], queryFn: async () => { const [all, a, p, s] = await Promise.all([count(), count('ACTIVE'), count('PENDING'), count('SUSPENDED')]); return { all, a, p, s }; } });
  const columns: Column<BrandRow>[] = [
    { key: 'brand', header: t('ops.brands.col.brand'), cell: (b) => <div className="flex min-w-[180px] items-center gap-3"><Avatar name={b.name} src={b.logoUrl} size={36} /><div className="min-w-0"><p className="truncate font-semibold text-ink-900 dark:text-ink-50">{b.name}</p><p className="text-xs text-ink-500"><Code>{b.code}</Code>{b.industry ? ` · ${b.industry}` : ''}</p></div></div> },
    { key: 'status', header: t('common.status'), cell: (b) => <StateBadge value={b.status} /> },
    { key: 'plan', header: t('ops.brands.col.plan'), cell: (b) => <span className="text-sm">{b.plan?.name ?? '—'}</span>, hideBelow: 'lg' },
    { key: 'cycle', header: t('ops.brands.f.cycle'), cell: (b) => <div className="text-sm">{en('SettlementCycle', b.settlementCycle)}<p className="text-xs text-ink-400">{en('PayoutMethod', b.payoutMethod)}</p></div>, hideBelow: 'md' },
    { key: 'orders', header: t('ops.brands.col.orders30'), align: 'center', cell: (b) => <span className="ltr tabular">{num(b.orders30d)}</span>, hideBelow: 'md' },
    { key: 'wallet', header: t('ops.brands.col.wallet'), align: 'end', cell: (b) => <Money cents={b.walletBalanceCents} className="font-semibold" /> },
    { key: 'mgr', header: t('ops.brands.col.manager'), cell: (b) => <span className="text-sm">{b.accountManager?.name ?? '—'}</span>, hideBelow: 'xl' },
  ];
  return (
    <div>
      <PageHeader title={t('ops.brands.title')} subtitle={t('ops.brands.subtitle')} actions={can('brands.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setF({ onboard: '1' })}>{t('ops.brands.onboard')}</Button>} />
      <StatGrid className="mb-5">
        <Stat icon={<Building2 />} tone="ink" label={t('ops.brands.kpi.total')} value={num(stats.data?.all)} loading={stats.isLoading} onClick={() => setF({ status: '' })} active={!f.status} />
        <Stat icon={<CheckCircle2 />} label={t('ops.brands.kpi.active')} value={num(stats.data?.a)} loading={stats.isLoading} onClick={() => setF({ status: 'ACTIVE' })} active={f.status === 'ACTIVE'} />
        <Stat icon={<Clock />} tone="sand" label={t('ops.brands.kpi.pending')} value={num(stats.data?.p)} loading={stats.isLoading} onClick={() => setF({ status: 'PENDING' })} active={f.status === 'PENDING'} />
        <Stat icon={<ShieldOff />} tone="red" label={t('ops.brands.kpi.suspended')} value={num(stats.data?.s)} loading={stats.isLoading} onClick={() => setF({ status: 'SUSPENDED' })} active={f.status === 'SUSPENDED'} />
      </StatGrid>
      <FilterBar
        search={<Input type="search" leading={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ops.brands.search')} aria-label={t('action.search')} />}
        activeCount={[f.status, f.planId, f.cycle].filter(Boolean).length}
        onClear={() => setF({ status: '', planId: '', cycle: '' })}
      >
        <FilterField label={t('common.status')}><Select value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder={t('ops.opsb.allStatuses')} options={Object.values(BrandStatus).map((s) => ({ value: s, label: t(`state.${s}`) }))} aria-label={t('common.status')} /></FilterField>
        <FilterField label={t('ops.brands.f.plan')}><Select value={f.planId} onChange={(e) => setF({ planId: e.target.value })} placeholder={t('ops.brands.f.allPlans')} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} aria-label={t('ops.brands.f.plan')} /></FilterField>
        <FilterField label={t('ops.brands.f.cycle')}><Select value={f.cycle} onChange={(e) => setF({ cycle: e.target.value })} placeholder={t('ops.brands.f.allCycles')} options={enumOptions('SettlementCycle', Object.values(SettlementCycle))} aria-label={t('ops.brands.f.cycle')} /></FilterField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(b) => b.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(b) => nav(`/ops/brands/${b.id}`)}
        empty={<EmptyState icon={<Building2 className="h-7 w-7" />} title={t('ops.brands.empty')} />}
        mobileCard={(b) => (
          <div className="flex items-start gap-3">
            <Avatar name={b.name} src={b.logoUrl} size={40} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{b.name}</p><StateBadge value={b.status} /></div>
              <p className="text-xs text-ink-500"><Code>{b.code}</Code> · {b.plan?.name ?? '—'} · {en('SettlementCycle', b.settlementCycle)}</p>
              <div className="flex items-center justify-between text-sm"><span className="text-xs text-ink-500">{t('ops.brands.col.orders30')}: {num(b.orders30d)}</span><Money cents={b.walletBalanceCents} className="font-semibold" /></div>
            </div>
          </div>
        )}
        footer={list.data && list.data.meta.totalPages > 1 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : null}
      />
      {can('brands.manage') && <OnboardBrandModal open={f.onboard === '1'} onClose={() => setF({ onboard: '' })} />}
    </div>
  );
}

/* ───────────────────────────── Onboard ───────────────────────────── */

const blank = {
  code: '', name: '', phone: '', email: '', legalName: '', industry: '', website: '', activate: true,
  ownerName: '', ownerPhone: '', ownerEmail: '', ownerLocale: 'ar',
  pricingPlanId: '', settlementCycle: 'WEEKLY', payoutMethod: 'BANK_TRANSFER', accountManagerId: '',
  bankName: '', iban: '', accountName: '', instapayAddress: '', walletPhone: '',
};

function OnboardBrandModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const plans = usePlans();
  const staff = useStaffOptions(open);
  const { values: f, set, errors, setErrors, reset } = useForm(blank);
  const [loc, setLoc] = useState<LocationValues>(emptyLocation);
  const [done, setDone] = useState<{ brand: BrandRow; temporaryPassword: string; owner: { phone: string } } | null>(null);
  const close = () => { onClose(); setTimeout(() => { reset(blank); setLoc(emptyLocation); setDone(null); }, 200); };
  const m = useMutation({
    mutationFn: () => api<{ brand: BrandRow; temporaryPassword: string; owner: { phone: string } }>('/brands', {
      method: 'POST',
      body: {
        code: f.code.trim().toUpperCase(), name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || undefined, legalName: f.legalName.trim() || undefined, industry: f.industry.trim() || undefined, website: f.website.trim() || undefined,
        status: f.activate ? 'ACTIVE' : 'PENDING', pricingPlanId: f.pricingPlanId || undefined, settlementCycle: f.settlementCycle, payoutMethod: f.payoutMethod, accountManagerId: f.accountManagerId || undefined,
        payoutDetails: payoutBody(f),
        owner: { name: f.ownerName.trim(), phone: f.ownerPhone.trim(), email: f.ownerEmail.trim() || undefined, locale: f.ownerLocale },
        location: { name: loc.name.trim(), contactName: loc.contactName.trim() || undefined, phone: loc.phone.trim() || undefined, addressLine: loc.addressLine.trim(), zoneId: loc.zoneId, lat: loc.lat ?? undefined, lng: loc.lng ?? undefined },
      },
    }),
    onSuccess: (r) => { setDone(r); toast.success(t('ops.brands.o.done', { code: r.brand.code })); qc.invalidateQueries({ queryKey: ['brands'] }); qc.invalidateQueries({ queryKey: ['opsb', 'brand-options'] }); },
    onError: (err) => {
      const raw = apiFieldErrors(err, ['code', 'name', 'phone', 'email', 'website', 'iban', 'owner', 'location'], { BRAND_CODE_TAKEN: 'code', PHONE_TAKEN: 'ownerPhone', EMAIL_TAKEN: 'ownerEmail', INVALID_PHONE: 'ownerPhone', INVALID_ZONE: 'loc_zoneId', INVALID_PRICING_PLAN: 'pricingPlanId', INVALID_ACCOUNT_MANAGER: 'accountManagerId' });
      setErrors(raw);
      toast.error(errorMessage(err));
    },
  });
  const submit = () => {
    const e: Errors = {};
    if (!/^[A-Z0-9]{2,12}$/.test(f.code.trim().toUpperCase())) e.code = t('ops.brands.o.codeInvalid');
    if (f.name.trim().length < 2) e.name = t('ops.opsb.minChars', { n: 2 });
    if (!v.phone(f.phone)) e.phone = t('ops.opsb.invalidPhone');
    if (f.email && !v.email(f.email)) e.email = t('ops.opsb.invalidEmail');
    if (f.website && !/^https?:\/\/\S+$/.test(f.website)) e.website = t('ops.brands.d.urlInvalid');
    if (f.ownerName.trim().length < 2) e.ownerName = t('ops.opsb.minChars', { n: 2 });
    if (!v.phone(f.ownerPhone)) e.ownerPhone = t('ops.opsb.invalidPhone');
    if (f.ownerEmail && !v.email(f.ownerEmail)) e.ownerEmail = t('ops.opsb.invalidEmail');
    Object.assign(e, payoutErrors(f, t));
    const le = validateLocation(loc, t);
    for (const [k, val] of Object.entries(le)) e[`loc_${k}`] = val;
    setErrors(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };
  if (done) {
    return (
      <Modal open={open} onClose={close} title={t('ops.brands.o.successTitle')} footer={<Button onClick={() => { close(); nav(`/ops/brands/${done.brand.id}`); }}>{t('ops.brands.o.open')}</Button>}>
        <div className="space-y-4">
          <div className="flex items-center gap-3"><Avatar name={done.brand.name} size={44} /><div><p className="font-semibold">{done.brand.name}</p><p className="text-sm text-ink-500"><Code>{done.brand.code}</Code></p></div></div>
          <TempPasswordPanel password={done.temporaryPassword} loginId={done.owner.phone} />
        </div>
      </Modal>
    );
  }
  const section = (title: string) => <h3 className="mb-3 mt-2 text-sm font-semibold uppercase tracking-wide text-ink-400 sm:col-span-2">{title}</h3>;
  return (
    <Modal open={open} onClose={close} title={t('ops.brands.o.title')} size="xl"
      footer={<><Button variant="outline" onClick={close}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={submit}>{t('ops.brands.o.submit')}</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {section(t('ops.brands.o.brand'))}
        <Field label={t('ops.brands.o.name')} required error={errors.name}>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} maxLength={150} />}</Field>
        <Field label={t('ops.brands.o.code')} required error={errors.code} hint={t('ops.brands.o.codeHint')}>{(id) => <Input id={id} dir="ltr" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} invalid={!!errors.code} />}</Field>
        <Field label={t('ops.brands.o.phone')} required error={errors.phone}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} invalid={!!errors.phone} maxLength={20} />}</Field>
        <Field label={t('common.email')} error={errors.email}>{(id) => <Input id={id} dir="ltr" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} />}</Field>
        <Field label={t('ops.brands.d.legalName')}>{(id) => <Input id={id} value={f.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={200} />}</Field>
        <Field label={t('ops.brands.d.industry')}>{(id) => <Input id={id} value={f.industry} onChange={(e) => set('industry', e.target.value)} maxLength={80} />}</Field>
        <Field label={t('ops.brands.d.website')} error={errors.website} className="sm:col-span-2">{(id) => <Input id={id} dir="ltr" value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" invalid={!!errors.website} />}</Field>

        {section(t('ops.brands.o.owner'))}
        <Field label={t('ops.brands.o.ownerName')} required error={errors.ownerName}>{(id) => <Input id={id} value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} invalid={!!errors.ownerName} maxLength={120} />}</Field>
        <Field label={t('ops.brands.o.ownerPhone')} required error={errors.ownerPhone}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={f.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} invalid={!!errors.ownerPhone} maxLength={20} />}</Field>
        <Field label={t('ops.brands.o.ownerEmail')} error={errors.ownerEmail}>{(id) => <Input id={id} dir="ltr" type="email" value={f.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} invalid={!!errors.ownerEmail} />}</Field>
        <Field label={t('ops.brands.o.locale')}>{(id) => <Select id={id} value={f.ownerLocale} onChange={(e) => set('ownerLocale', e.target.value)} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />}</Field>

        {section(t('ops.brands.o.location'))}
        <div className="sm:col-span-2"><LocationFields value={loc} onChange={(p) => setLoc((l) => ({ ...l, ...p }))} errors={errors} prefix="loc_" /></div>

        {section(t('ops.brands.o.commercial'))}
        <Field label={t('ops.brands.f.plan')} error={errors.pricingPlanId}>{(id) => <Select id={id} value={f.pricingPlanId} onChange={(e) => set('pricingPlanId', e.target.value)} placeholder={t('ops.brands.o.defaultPlan')} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />}</Field>
        <Field label={t('ops.brands.f.cycle')}>{(id) => <Select id={id} value={f.settlementCycle} onChange={(e) => set('settlementCycle', e.target.value)} options={enumOptions('SettlementCycle', Object.values(SettlementCycle))} />}</Field>
        <Field label={t('ops.brands.col.manager')} error={errors.accountManagerId}>{(id) => <Select id={id} value={f.accountManagerId} onChange={(e) => set('accountManagerId', e.target.value)} placeholder={t('ops.brands.d.noManager')} options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />}</Field>
        <Field label={t('ops.brands.d.payoutMethod')}>{(id) => <Select id={id} value={f.payoutMethod} onChange={(e) => set('payoutMethod', e.target.value)} options={enumOptions('PayoutMethod', Object.values(PayoutMethod))} />}</Field>
        <PayoutDetailFields values={f} set={(k, val) => set(k, val)} errors={errors} />
        <div className="sm:col-span-2"><Checkbox label={t('ops.brands.o.activate')} checked={f.activate} onChange={(e) => set('activate', e.target.checked)} /></div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Payout details (shared with detail page) ───────────────────────────── */

type PayoutFields = { payoutMethod: string; bankName: string; iban: string; accountName: string; instapayAddress: string; walletPhone: string };

export function payoutBody(f: PayoutFields) {
  const out: Record<string, string> = {};
  if (f.payoutMethod === 'BANK_TRANSFER') {
    if (f.bankName.trim()) out.bankName = f.bankName.trim();
    if (f.iban.trim()) out.iban = f.iban.replace(/\s/g, '').toUpperCase();
    if (f.accountName.trim()) out.accountName = f.accountName.trim();
  }
  if (f.payoutMethod === 'INSTAPAY' && f.instapayAddress.trim()) out.instapayAddress = f.instapayAddress.trim();
  if ((f.payoutMethod === 'VODAFONE_CASH' || f.payoutMethod === 'INSTAPAY') && f.walletPhone.trim()) out.walletPhone = f.walletPhone.trim();
  return Object.keys(out).length ? out : undefined;
}

export function payoutErrors(f: PayoutFields, t: (k: string) => string): Errors {
  const e: Errors = {};
  if (f.payoutMethod === 'BANK_TRANSFER' && f.iban && !/^EG\d{27}$/.test(f.iban.replace(/\s/g, '').toUpperCase())) e.iban = t('ops.brands.d.ibanInvalid');
  if (f.walletPhone && (f.payoutMethod === 'VODAFONE_CASH' || f.payoutMethod === 'INSTAPAY') && !v.phone(f.walletPhone)) e.walletPhone = t('ops.opsb.invalidPhone');
  return e;
}

export function PayoutDetailFields({ values, set, errors, disabled }: { values: PayoutFields; set: (k: keyof PayoutFields, v: string) => void; errors: Errors; disabled?: boolean }) {
  const { t } = useI18n();
  if (values.payoutMethod === 'BANK_TRANSFER') {
    return (
      <>
        <Field label={t('ops.brands.payout.bankName')}>{(id) => <Input id={id} value={values.bankName} disabled={disabled} onChange={(e) => set('bankName', e.target.value)} maxLength={120} />}</Field>
        <Field label={t('ops.brands.payout.accountName')}>{(id) => <Input id={id} value={values.accountName} disabled={disabled} onChange={(e) => set('accountName', e.target.value)} maxLength={150} />}</Field>
        <Field label={t('ops.brands.payout.iban')} error={errors.iban} className="sm:col-span-2">{(id) => <Input id={id} dir="ltr" value={values.iban} disabled={disabled} onChange={(e) => set('iban', e.target.value.toUpperCase())} placeholder="EG…" invalid={!!errors.iban} maxLength={34} />}</Field>
      </>
    );
  }
  if (values.payoutMethod === 'INSTAPAY' || values.payoutMethod === 'VODAFONE_CASH') {
    return (
      <>
        {values.payoutMethod === 'INSTAPAY' && <Field label={t('ops.brands.payout.instapayAddress')}>{(id) => <Input id={id} dir="ltr" value={values.instapayAddress} disabled={disabled} onChange={(e) => set('instapayAddress', e.target.value)} maxLength={120} />}</Field>}
        <Field label={t('ops.brands.payout.walletPhone')} error={errors.walletPhone}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={values.walletPhone} disabled={disabled} onChange={(e) => set('walletPhone', e.target.value)} invalid={!!errors.walletPhone} maxLength={20} />}</Field>
      </>
    );
  }
  return null;
}
