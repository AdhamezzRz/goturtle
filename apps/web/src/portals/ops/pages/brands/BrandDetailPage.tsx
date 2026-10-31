import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Ban, CheckCircle2, Coins, KeyRound, MapPin, Package, PackageCheck, Pencil, Plug, Plus, RotateCcw, Star, Trash2, Wallet, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { FeesPayer, PayoutMethod, SettlementCycle, type OrderStatus } from '@goturtle/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, dateOnly, num } from '@/lib/format';
import { useQueryState } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, ProgressBar, Select, Skeleton, StateBadge, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { Code, InfoRow, Money, Notice, RequirePermission, Section, Stat, StatGrid, UploadButton, apiFieldErrors, enumOptions, useEnumLabel, useForm, useStaffOptions, v, type Errors } from '@/portals/ops/components/opsb';
import { PayoutDetailFields, payoutBody, payoutErrors, usePlans } from './BrandsPage';
import { LocationModal } from './LocationFields';
import type { ApiKeyRow, BrandDetail, BrandLocation, Connection, WebhookEndpoint } from './types';
import './i18n';

export default function BrandDetailPage() {
  return (
    <RequirePermission permission="brands.read">
      <Inner />
    </RequirePermission>
  );
}

type StatusAction = 'approve' | 'suspend' | 'reactivate';

function Inner() {
  const { id = '' } = useParams();
  const { t, dir } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [s, setS] = useQueryState({ tab: 'overview' });
  const [action, setAction] = useState<StatusAction | null>(null);
  const q = useQuery({ queryKey: ['brands', 'detail', id], queryFn: () => api<BrandDetail>(`/brands/${id}`) });
  const status = useMutation({
    mutationFn: (a: StatusAction) => api(`/brands/${id}/${a}`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('ops.brands.d.statusChanged')); setAction(null); qc.invalidateQueries({ queryKey: ['brands'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-24" /><Skeleton className="h-80" /></div>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const manage = can('brands.manage');
  const tabs = [
    { value: 'overview', label: t('ops.brands.d.tab.overview') },
    { value: 'profile', label: t('ops.brands.d.tab.profile') },
    { value: 'commercial', label: t('ops.brands.d.tab.commercial') },
    { value: 'locations', label: t('ops.brands.d.tab.locations'), count: b.locations.length },
    { value: 'team', label: t('ops.brands.d.tab.team'), count: b.team.length },
    { value: 'integrations', label: t('ops.brands.d.tab.integrations') },
  ];
  return (
    <div>
      <Link to="/ops/brands" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"><Back className="h-4 w-4" />{t('ops.brands.d.back')}</Link>
      <Card className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={b.name} src={b.logoUrl} size={60} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{b.name}</h1>
                <StateBadge value={b.status} />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
                <Code>{b.code}</Code>
                <span className="ltr">{b.phone}</span>
                {b.email && <span className="ltr">{b.email}</span>}
                {b.plan && <Badge tone="info">{b.plan.name}</Badge>}
              </p>
            </div>
          </div>
          {manage && (
            <div className="flex flex-wrap gap-2">
              {b.status === 'PENDING' && <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setAction('approve')}>{t('ops.brands.d.approve')}</Button>}
              {b.status === 'SUSPENDED' && <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setAction('reactivate')}>{t('ops.brands.d.reactivate')}</Button>}
              {b.status !== 'SUSPENDED' && <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setAction('suspend')}>{t('ops.brands.d.suspend')}</Button>}
            </div>
          )}
        </div>
      </Card>
      <Tabs className="mb-5" value={s.tab} onChange={(val) => setS({ tab: val })} tabs={tabs} />
      {s.tab === 'overview' && <Overview b={b} />}
      {s.tab === 'profile' && <Profile b={b} />}
      {s.tab === 'commercial' && <Commercial b={b} />}
      {s.tab === 'locations' && <Locations b={b} />}
      {s.tab === 'team' && <Team b={b} />}
      {s.tab === 'integrations' && <Integrations b={b} />}
      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        onConfirm={() => action && status.mutate(action)}
        loading={status.isPending}
        danger={action === 'suspend'}
        title={action ? t(`ops.brands.d.${action}Title`, { name: b.name }) : ''}
        description={action === 'approve' ? t('ops.brands.d.approveDesc') : action === 'suspend' ? t('ops.brands.d.suspendDesc') : undefined}
        confirmLabel={action ? t(`ops.brands.d.${action}`) : undefined}
      />
    </div>
  );
}

function Overview({ b }: { b: BrandDetail }) {
  const { t } = useI18n();
  const st = b.stats;
  const max = Math.max(1, ...Object.values(st.ordersByStatus));
  return (
    <div className="space-y-5">
      <StatGrid cols={5}>
        <Stat icon={<Package />} tone="ink" label={t('ops.brands.d.totalOrders')} value={num(st.totalOrders)} />
        <Stat icon={<PackageCheck />} label={t('ops.brands.d.orders30')} value={num(st.last30Days.orders)} hint={t('ops.brands.d.returned30', { n: num(st.last30Days.returned) })} />
        <Stat icon={<Coins />} tone="sand" label={t('ops.brands.d.cod30')} value={<Money cents={st.last30Days.codCollectedCents} compact />} />
        <Stat icon={<Star />} tone="violet" label={t('ops.brands.d.fees30')} value={<Money cents={st.last30Days.feesCents} compact />} />
        <Stat icon={<Wallet />} tone="sky" label={t('ops.brands.d.wallet')} value={<Money cents={st.walletBalanceCents} compact />} />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section className="lg:col-span-2" title={t('ops.brands.d.byStatus')} actions={<Link to={`/ops/orders?brandId=${b.id}`}><Button size="sm" variant="outline">{t('ops.brands.d.viewOrders')}</Button></Link>}>
          {Object.keys(st.ordersByStatus).length === 0 ? <p className="text-sm text-ink-500">{t('ops.opsb.noData')}</p> : (
            <ul className="space-y-2.5">
              {Object.entries(st.ordersByStatus).sort((a, c) => c[1] - a[1]).map(([k, n]) => (
                <li key={k} className="grid grid-cols-[minmax(110px,150px)_1fr_auto] items-center gap-3">
                  <StatusBadge status={k as OrderStatus} />
                  <ProgressBar value={n / max} />
                  <span className="ltr w-10 text-end text-sm font-semibold tabular">{num(n)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t('ops.brands.d.tab.commercial')} actions={<Link to={`/ops/finance/settlements?brandId=${b.id}`}><Button size="sm" variant="outline">{t('ops.brands.d.viewSettlements')}</Button></Link>}>
          <CommercialSummary b={b} />
        </Section>
      </div>
    </div>
  );
}

function CommercialSummary({ b }: { b: BrandDetail }) {
  const { t } = useI18n();
  const en = useEnumLabel();
  return (
    <>
      <InfoRow label={t('ops.brands.f.plan')} value={b.plan?.name ?? '—'} />
      <InfoRow label={t('ops.brands.f.cycle')} value={en('SettlementCycle', b.settlementCycle)} />
      <InfoRow label={t('ops.brands.d.payoutMethod')} value={en('PayoutMethod', b.payoutMethod)} />
      {Object.entries(b.payoutDetails ?? {}).filter(([, val]) => val).map(([k, val]) => <InfoRow key={k} label={t(`ops.brands.payout.${k}`)} value={<span className="ltr">{val}</span>} />)}
      <InfoRow label={t('ops.brands.d.feesPayer')} value={en('FeesPayer', b.defaultFeesPaidBy)} />
      <InfoRow label={t('ops.brands.col.manager')} value={b.accountManager?.name ?? t('ops.brands.d.noManager')} />
      <InfoRow label={t('ops.opsb.created')} value={dateOnly(b.createdAt)} />
    </>
  );
}

const profileOf = (b: BrandDetail) => ({
  name: b.name, phone: b.phone, email: b.email ?? '', legalName: b.legalName ?? '', commercialRegNo: b.commercialRegNo ?? '', taxId: b.taxId ?? '', industry: b.industry ?? '', website: b.website ?? '',
  logoUrl: b.logoUrl ?? '', notes: b.notes ?? '', allowOpenPackage: b.allowOpenPackage, defaultFeesPaidBy: b.defaultFeesPaidBy,
});

function Profile({ b }: { b: BrandDetail }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const ro = !can('brands.manage');
  const { values: f, set, errors, setErrors, reset } = useForm(profileOf(b));
  useEffect(() => {
    reset(profileOf(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.updatedAt]);
  const m = useMutation({
    mutationFn: () => api(`/brands/${b.id}`, {
      method: 'PATCH',
      body: {
        name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || undefined, legalName: f.legalName.trim() || undefined, commercialRegNo: f.commercialRegNo.trim() || undefined, taxId: f.taxId.trim() || undefined,
        industry: f.industry.trim() || undefined, website: f.website.trim() || undefined, logoUrl: f.logoUrl || undefined, notes: f.notes.trim() || null, allowOpenPackage: f.allowOpenPackage, defaultFeesPaidBy: f.defaultFeesPaidBy,
      },
    }),
    onSuccess: () => { toast.success(t('ops.brands.d.saved')); qc.invalidateQueries({ queryKey: ['brands'] }); },
    onError: (e) => { setErrors(apiFieldErrors(e, ['name', 'phone', 'email', 'website', 'logoUrl', 'legalName', 'taxId'], { INVALID_PHONE: 'phone' })); toast.error(errorMessage(e)); },
  });
  const submit = () => {
    const e: Errors = {};
    if (f.name.trim().length < 2) e.name = t('ops.opsb.minChars', { n: 2 });
    if (!v.phone(f.phone)) e.phone = t('ops.opsb.invalidPhone');
    if (f.email && !v.email(f.email)) e.email = t('ops.opsb.invalidEmail');
    if (f.website && !/^https?:\/\/\S+$/.test(f.website)) e.website = t('ops.brands.d.urlInvalid');
    setErrors(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };
  return (
    <Section title={t('ops.brands.d.tab.profile')} actions={!ro && <Button loading={m.isPending} onClick={submit}>{t('action.save')}</Button>}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Avatar name={f.name || b.name} src={f.logoUrl || null} size={56} />
          {!ro && <UploadButton purpose="logo" accept="image/*" label={t('ops.brands.d.logo')} onUploaded={(file) => set('logoUrl', file.url)} />}
        </div>
        <Field label={t('ops.brands.o.name')} required error={errors.name}>{(id) => <Input id={id} value={f.name} disabled={ro} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} />}</Field>
        <Field label={t('ops.brands.o.phone')} required error={errors.phone}>{(id) => <Input id={id} dir="ltr" value={f.phone} disabled={ro} onChange={(e) => set('phone', e.target.value)} invalid={!!errors.phone} />}</Field>
        <Field label={t('common.email')} error={errors.email}>{(id) => <Input id={id} dir="ltr" value={f.email} disabled={ro} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} />}</Field>
        <Field label={t('ops.brands.d.legalName')}>{(id) => <Input id={id} value={f.legalName} disabled={ro} onChange={(e) => set('legalName', e.target.value)} />}</Field>
        <Field label={t('ops.brands.d.crNo')}>{(id) => <Input id={id} dir="ltr" value={f.commercialRegNo} disabled={ro} onChange={(e) => set('commercialRegNo', e.target.value)} />}</Field>
        <Field label={t('ops.brands.d.taxId')}>{(id) => <Input id={id} dir="ltr" value={f.taxId} disabled={ro} onChange={(e) => set('taxId', e.target.value)} />}</Field>
        <Field label={t('ops.brands.d.industry')}>{(id) => <Input id={id} value={f.industry} disabled={ro} onChange={(e) => set('industry', e.target.value)} />}</Field>
        <Field label={t('ops.brands.d.website')} error={errors.website}>{(id) => <Input id={id} dir="ltr" value={f.website} disabled={ro} onChange={(e) => set('website', e.target.value)} invalid={!!errors.website} />}</Field>
        <Field label={t('ops.brands.d.feesPayer')}>{(id) => <Select id={id} value={f.defaultFeesPaidBy} disabled={ro} onChange={(e) => set('defaultFeesPaidBy', e.target.value)} options={enumOptions('FeesPayer', Object.values(FeesPayer))} />}</Field>
        <div className="sm:col-span-2 lg:col-span-3"><Checkbox label={t('ops.brands.d.openPackage')} checked={f.allowOpenPackage} disabled={ro} onChange={(e) => set('allowOpenPackage', e.target.checked)} /></div>
        <Field label={t('ops.brands.d.notes')} className="sm:col-span-2 lg:col-span-3">{(id) => <Textarea id={id} value={f.notes} disabled={ro} onChange={(e) => set('notes', e.target.value)} maxLength={5000} />}</Field>
      </div>
    </Section>
  );
}

const commercialOf = (b: BrandDetail) => ({
  pricingPlanId: b.pricingPlanId ?? '', settlementCycle: b.settlementCycle, payoutMethod: b.payoutMethod, accountManagerId: b.accountManagerId ?? '',
  bankName: b.payoutDetails?.bankName ?? '', iban: b.payoutDetails?.iban ?? '', accountName: b.payoutDetails?.accountName ?? '', instapayAddress: b.payoutDetails?.instapayAddress ?? '', walletPhone: b.payoutDetails?.walletPhone ?? '',
});

function Commercial({ b }: { b: BrandDetail }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const plans = usePlans();
  const staff = useStaffOptions();
  const ro = !can('brands.manage');
  const managers = [...(staff.data ?? []), ...(b.accountManager && !staff.data?.some((s) => s.id === b.accountManager!.id) ? [{ id: b.accountManager.id, name: b.accountManager.name }] : [])];
  const { values: f, set, errors, setErrors, reset } = useForm(commercialOf(b));
  useEffect(() => {
    reset(commercialOf(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.updatedAt]);
  const m = useMutation({
    mutationFn: () => api(`/brands/${b.id}`, { method: 'PATCH', body: { pricingPlanId: f.pricingPlanId || null, settlementCycle: f.settlementCycle, payoutMethod: f.payoutMethod, accountManagerId: f.accountManagerId || null, payoutDetails: payoutBody(f) ?? null } }),
    onSuccess: () => { toast.success(t('ops.brands.d.saved')); qc.invalidateQueries({ queryKey: ['brands'] }); },
    onError: (e) => { setErrors(apiFieldErrors(e, ['iban', 'walletPhone', 'pricingPlanId', 'accountManagerId'], { INVALID_PRICING_PLAN: 'pricingPlanId', INVALID_ACCOUNT_MANAGER: 'accountManagerId' })); toast.error(errorMessage(e)); },
  });
  return (
    <Section title={t('ops.brands.d.tab.commercial')} actions={!ro && <Button loading={m.isPending} onClick={() => { const e = payoutErrors(f, t); setErrors(e); if (!Object.values(e).some(Boolean)) m.mutate(); }}>{t('action.save')}</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ops.brands.f.plan')} error={errors.pricingPlanId}>{(id) => <Select id={id} value={f.pricingPlanId} disabled={ro} onChange={(e) => set('pricingPlanId', e.target.value)} placeholder={t('ops.brands.o.defaultPlan')} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />}</Field>
        <Field label={t('ops.brands.f.cycle')}>{(id) => <Select id={id} value={f.settlementCycle} disabled={ro} onChange={(e) => set('settlementCycle', e.target.value)} options={enumOptions('SettlementCycle', Object.values(SettlementCycle))} />}</Field>
        <Field label={t('ops.brands.col.manager')} error={errors.accountManagerId}>{(id) => <Select id={id} value={f.accountManagerId} disabled={ro} onChange={(e) => set('accountManagerId', e.target.value)} placeholder={t('ops.brands.d.noManager')} options={managers.map((s) => ({ value: s.id, label: s.name }))} />}</Field>
        <Field label={t('ops.brands.d.payoutMethod')}>{(id) => <Select id={id} value={f.payoutMethod} disabled={ro} onChange={(e) => set('payoutMethod', e.target.value)} options={enumOptions('PayoutMethod', Object.values(PayoutMethod))} />}</Field>
        <PayoutDetailFields values={f} set={(k, val) => set(k, val)} errors={errors} disabled={ro} />
      </div>
    </Section>
  );
}

function Locations({ b }: { b: BrandDetail }) {
  const { t, pick } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can('brands.manage');
  const [edit, setEdit] = useState<BrandLocation | 'new' | null>(null);
  const [del, setDel] = useState<BrandLocation | null>(null);
  const patch = useMutation({
    mutationFn: ({ l, body }: { l: BrandLocation; body: Record<string, unknown> }) => api(`/brands/${b.id}/locations/${l.id}`, { method: 'PATCH', body }),
    onSuccess: () => { toast.success(t('ops.brands.loc.saved')); qc.invalidateQueries({ queryKey: ['brands'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (l: BrandLocation) => api(`/brands/${b.id}/locations/${l.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(t('ops.brands.loc.deleted')); setDel(null); qc.invalidateQueries({ queryKey: ['brands'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      {manage && <div className="flex justify-end"><Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('ops.brands.loc.new')}</Button></div>}
      {b.locations.length === 0 ? <Card><EmptyState icon={<MapPin className="h-7 w-7" />} title={t('ops.brands.loc.empty')} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {b.locations.map((l) => (
            <Card key={l.id} className="flex flex-col">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="font-semibold text-ink-900 dark:text-white">{l.name}</h3>
                <div className="flex gap-1">{l.isDefault && <Badge tone="success">{t('ops.brands.loc.default')}</Badge>}{!l.isActive && <Badge tone="neutral">{t('ops.brands.loc.inactive')}</Badge>}</div>
              </div>
              <p className="text-sm text-ink-600 dark:text-ink-300">{l.addressLine}</p>
              <p className="mt-1 text-xs text-ink-500">{l.zone ? pick(l.zone, 'name') : '—'}</p>
              <p className="mt-2 text-sm">{l.contactName} · <span className="ltr">{l.phone}</span></p>
              {l.lat !== null && l.lng !== null && <a href={`https://maps.google.com/?q=${l.lat},${l.lng}`} target="_blank" rel="noreferrer" className="ltr mt-1 inline-flex items-center gap-1 text-xs text-turtle-700 hover:underline dark:text-turtle-400"><MapPin className="h-3 w-3" />{l.lat.toFixed(4)}, {l.lng.toFixed(4)}</a>}
              {manage && (
                <div className="mt-auto flex flex-wrap gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
                  <Button size="sm" variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(l)}>{t('action.edit')}</Button>
                  {!l.isDefault && l.isActive && <Button size="sm" variant="ghost" onClick={() => patch.mutate({ l, body: { isDefault: true } })}>{t('ops.brands.loc.makeDefault')}</Button>}
                  {!l.isDefault && <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4 text-red-500" />} onClick={() => setDel(l)}>{t('ops.brands.loc.delete')}</Button>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <LocationModal open={!!edit} onClose={() => setEdit(null)} brandId={b.id} location={edit === 'new' ? null : edit} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} danger loading={remove.isPending} title={del ? t('ops.brands.loc.deleteTitle', { name: del.name }) : ''} confirmLabel={t('ops.brands.loc.delete')} />
    </div>
  );
}

function Team({ b }: { b: BrandDetail }) {
  const { t } = useI18n();
  return (
    <Section title={t('ops.brands.d.team')}>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {b.team.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
            <Avatar name={m.name} src={m.avatarUrl} size={36} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{m.name}</p>
              <p className="text-xs text-ink-500"><span className="ltr">{m.phone}</span>{m.email && <> · <span className="ltr">{m.email}</span></>}</p>
            </div>
            <Badge tone="info">{t(`role.${m.role}`)}</Badge>
            <StateBadge value={m.status} />
            <span className="w-full text-xs text-ink-400 sm:w-auto">{m.invitePending ? t('ops.brands.d.invitePending') : t('ops.brands.d.lastLogin', { ago: ago(m.lastLoginAt) })}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Integrations({ b }: { b: BrandDetail }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const en = useEnumLabel();
  const qc = useQueryClient();
  const canKeys = can('integrations.manage');
  const [revoke, setRevoke] = useState<ApiKeyRow | null>(null);
  const keys = useQuery({ queryKey: ['brands', 'keys', b.id], queryFn: () => api<Paginated<ApiKeyRow>>('/api-keys', { query: { brandId: b.id, includeRevoked: 'true', pageSize: 50 } }), enabled: canKeys });
  const hooks = useQuery({ queryKey: ['brands', 'hooks', b.id], queryFn: () => api<Paginated<WebhookEndpoint>>('/webhooks/endpoints', { query: { brandId: b.id, pageSize: 50 } }) });
  const conns = useQuery({ queryKey: ['brands', 'conns', b.id], queryFn: () => api<Paginated<Connection>>('/integrations', { query: { brandId: b.id, pageSize: 50 } }) });
  const rev = useMutation({
    mutationFn: (k: ApiKeyRow) => api(`/api-keys/${k.id}/revoke`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('ops.brands.d.revoked')); setRevoke(null); qc.invalidateQueries({ queryKey: ['brands', 'keys'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const block = (loading: boolean, err: unknown, retry: () => void, empty: boolean, emptyText: string, children: React.ReactNode) =>
    loading ? <Skeleton className="h-20" /> : err ? <ErrorState error={err} onRetry={retry} /> : empty ? <p className="text-sm text-ink-500">{emptyText}</p> : children;
  return (
    <div className="space-y-5">
      {canKeys && (
        <Section title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4" />{t('ops.brands.d.apiKeys')}</span>}>
          {block(keys.isLoading, keys.error, () => keys.refetch(), !keys.data?.data.length, t('ops.brands.d.noKeys'), (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {keys.data?.data.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{k.name} <Code className="ms-1">{k.prefix}…</Code></p>
                    <p className="text-xs text-ink-500">{k.scopes.join(' · ')} · {k.lastUsedAt ? t('ops.brands.d.lastUsed', { ago: ago(k.lastUsedAt) }) : t('ops.brands.d.neverUsed')}</p>
                  </div>
                  <Badge tone={k.active ? 'success' : 'neutral'} dot>{k.active ? t('state.ACTIVE') : t('state.CANCELLED')}</Badge>
                  {k.active && <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4 text-red-500" />} onClick={() => setRevoke(k)}>{t('ops.brands.d.revoke')}</Button>}
                </li>
              ))}
            </ul>
          ))}
        </Section>
      )}
      <Section title={<span className="inline-flex items-center gap-2"><Webhook className="h-4 w-4" />{t('ops.brands.d.webhooks')}</span>}>
        {block(hooks.isLoading, hooks.error, () => hooks.refetch(), !hooks.data?.data.length, t('ops.brands.d.noHooks'), (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {hooks.data?.data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="ltr truncate text-start font-mono text-xs font-semibold">{h.url}</p>
                  <p className="text-xs text-ink-500">{t('ops.brands.d.events', { n: num(h.events.length) })}{h.failureCount > 0 && <> · <span className="text-red-600">{t('ops.brands.d.failures', { n: num(h.failureCount) })}</span></>}</p>
                </div>
                <Badge tone={h.isActive ? 'success' : 'neutral'} dot>{h.isActive ? t('state.ACTIVE') : t('state.PAUSED')}</Badge>
                {can('integrations.manage') && <Link to={`/ops/integrations?tab=webhooks&endpoint=${h.id}`}><Button size="sm" variant="outline">{t('ops.brands.d.logs')}</Button></Link>}
              </li>
            ))}
          </ul>
        ))}
      </Section>
      <Section title={<span className="inline-flex items-center gap-2"><Plug className="h-4 w-4" />{t('ops.brands.d.connections')}</span>}>
        {block(conns.isLoading, conns.error, () => conns.refetch(), !conns.data?.data.length, t('ops.brands.d.noConnections'), (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {conns.data?.data.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 font-medium">{en('IntegrationProvider', c.provider)} <span className="ltr text-xs text-ink-500">{c.shopDomain}</span></p>
                  <StateBadge value={c.status} />
                </div>
                {c.lastError && <Notice tone="warning" className="mt-2">{c.lastError}</Notice>}
              </li>
            ))}
          </ul>
        ))}
      </Section>
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(null)} onConfirm={() => revoke && rev.mutate(revoke)} danger loading={rev.isPending} title={revoke ? t('ops.brands.d.revokeTitle', { name: revoke.name }) : ''} description={t('ops.brands.d.revokeDesc')} confirmLabel={t('ops.brands.d.revoke')} />
    </div>
  );
}
