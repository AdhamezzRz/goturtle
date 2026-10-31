import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calculator, Plus, Save, Star, Tags, Trash2, Undo2 } from 'lucide-react';
import { PricingError, quote, returnFee, type FeesPayer, type OrderType, type PaymentMethod, type PricingTier, type RateCard, type ServiceLevel } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { money, num, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { NoAccess, SectionCard } from '../../components/opsa/ui';
import '../orders/i18n';
import './i18n';

interface Plan {
  id: string; name: string; description: string | null; isDefault: boolean; codFeeBp: number; codFeeMinCents: number; includedWeightGrams: number; extraKgCents: number;
  returnFeeBp: number; exchangeFeeCents: number; insuranceBp: number; vatBp: number; brandsCount: number;
  rules: Array<{ id: string; tier: PricingTier; serviceLevel: ServiceLevel; baseFeeCents: number }>;
}

const TIERS: PricingTier[] = ['A', 'B', 'C', 'D'];
const LEVELS: ServiceLevel[] = ['STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'];
const key = (t: string, l: string) => `${t}:${l}`;
const egp = (cents: number) => String(cents / 100);
const pctOf = (bp: number) => String(bp / 100);
const toBp = (s: string) => {
  const n = Number(s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

type Fees = { name: string; description: string; isDefault: boolean; codFee: string; codMin: string; includedKg: string; extraKg: string; returnFee: string; exchange: string; insurance: string; vat: string };
const feesOf = (p: Plan): Fees => ({
  name: p.name, description: p.description ?? '', isDefault: p.isDefault, codFee: pctOf(p.codFeeBp), codMin: egp(p.codFeeMinCents), includedKg: String(p.includedWeightGrams / 1000),
  extraKg: egp(p.extraKgCents), returnFee: pctOf(p.returnFeeBp), exchange: egp(p.exchangeFeeCents), insurance: pctOf(p.insuranceBp), vat: pctOf(p.vatBp),
});
const ratesOf = (p: Plan) => Object.fromEntries(p.rules.map((r) => [key(r.tier, r.serviceLevel), egp(r.baseFeeCents)])) as Record<string, string>;

export default function PricingPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [f, setF] = useQueryState({ plan: '' });
  const [newOpen, setNewOpen] = useState(false);
  const plans = useQuery({ queryKey: ['pricing', 'plans'], queryFn: () => api<Plan[]>('/pricing/plans'), enabled: can('pricing.manage') });
  const selected = plans.data?.find((p) => p.id === f.plan) ?? plans.data?.find((p) => p.isDefault) ?? plans.data?.[0];
  if (!can('pricing.manage')) return <NoAccess />;
  return (
    <div className="space-y-4">
      <PageHeader title={t('ops.pricing.title')} subtitle={t('ops.pricing.subtitle')} actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>{t('ops.pricing.newPlan')}</Button>} />
      {plans.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-4"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-96 rounded-2xl lg:col-span-3" /></div>
      ) : plans.error ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
      ) : !plans.data?.length ? (
        <EmptyState icon={<Tags className="h-7 w-7" />} title={t('ops.pricing.noPlans')} action={<Button onClick={() => setNewOpen(true)}>{t('ops.pricing.newPlan')}</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          <nav aria-label={t('ops.pricing.plans')} className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {plans.data.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setF({ plan: p.id })}
                className={cn(
                  'min-w-[180px] rounded-2xl border p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turtle-500 lg:min-w-0',
                  selected?.id === p.id ? 'border-turtle-400 bg-turtle-50 dark:border-turtle-800 dark:bg-turtle-950/50' : 'border-ink-100 bg-white hover:bg-ink-50 dark:border-ink-800 dark:bg-ink-900 dark:hover:bg-ink-800',
                )}
              >
                <p className="flex items-center gap-2 font-semibold text-ink-900 dark:text-white">{p.name}{p.isDefault && <Badge tone="success"><Star className="h-3 w-3" />{t('ops.pricing.default')}</Badge>}</p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-500">{p.description}</p>
                <p className="mt-2 text-xs font-medium text-ink-600 dark:text-ink-300">{t('ops.pricing.brandsN', { n: num(p.brandsCount) })}</p>
              </button>
            ))}
          </nav>
          {selected && <PlanEditor key={selected.id} plan={selected} onDeleted={() => setF({ plan: '' })} />}
        </div>
      )}
      {newOpen && plans.data && <NewPlanModal plans={plans.data} onClose={() => setNewOpen(false)} onCreated={(id) => setF({ plan: id })} />}
    </div>
  );
}

function PlanEditor({ plan, onDeleted }: { plan: Plan; onDeleted: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [fees, setFees] = useState<Fees>(() => feesOf(plan));
  const [rates, setRates] = useState<Record<string, string>>(() => ratesOf(plan));
  const [del, setDel] = useState(false);
  useEffect(() => { setFees(feesOf(plan)); setRates(ratesOf(plan)); }, [plan]);
  const set = <K extends keyof Fees>(k: K, v: Fees[K]) => setFees((p) => ({ ...p, [k]: v }));
  const feesDirty = JSON.stringify(fees) !== JSON.stringify(feesOf(plan));
  const ratesDirty = JSON.stringify(Object.entries(rates).filter(([, v]) => v !== '').sort()) !== JSON.stringify(Object.entries(ratesOf(plan)).sort());

  const feeBody = () => {
    const vals = {
      codFeeBp: toBp(fees.codFee), codFeeMinCents: parseEgp(fees.codMin), includedWeightGrams: fees.includedKg.trim() === '' ? null : Math.round(Number(fees.includedKg) * 1000),
      extraKgCents: parseEgp(fees.extraKg), returnFeeBp: toBp(fees.returnFee), exchangeFeeCents: parseEgp(fees.exchange), insuranceBp: toBp(fees.insurance), vatBp: toBp(fees.vat),
    };
    if (Object.values(vals).some((v) => v === null || !Number.isFinite(v as number))) return null;
    return vals as Record<keyof typeof vals, number>;
  };
  const ruleBody = () => {
    const rules: Array<{ tier: PricingTier; serviceLevel: ServiceLevel; baseFeeCents: number }> = [];
    for (const tier of TIERS) for (const lvl of LEVELS) {
      const raw = rates[key(tier, lvl)];
      if (raw === undefined || raw.trim() === '') continue;
      const c = parseEgp(raw);
      if (c === null) return null;
      rules.push({ tier, serviceLevel: lvl, baseFeeCents: c });
    }
    return rules;
  };

  // live card for the simulator (unsaved values)
  const card: RateCard | null = useMemo(() => {
    const b = feeBody();
    const r = ruleBody();
    if (!b || !r) return null;
    return { ...b, rules: r };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fees, rates]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['pricing'] });
  const saveFees = useMutation({
    mutationFn: () => {
      const b = feeBody();
      if (!b) throw new Error(t('ops.pricing.invalid'));
      return api(`/pricing/plans/${plan.id}`, { method: 'PATCH', body: { ...b, name: fees.name.trim(), description: fees.description.trim() || undefined, isDefault: fees.isDefault || undefined } });
    },
    onSuccess: () => { toast.success(t('ops.pricing.feesSaved')); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveRates = useMutation({
    mutationFn: () => {
      const rules = ruleBody();
      if (!rules) throw new Error(t('ops.pricing.invalid'));
      return api(`/pricing/plans/${plan.id}/rules`, { method: 'PUT', body: { rules } });
    },
    onSuccess: () => { toast.success(t('ops.pricing.ratesSaved')); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/pricing/plans/${plan.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(t('ops.pricing.deleted')); setDel(false); invalidate(); onDeleted(); },
    onError: (e) => { setDel(false); toast.error(errorMessage(e)); },
  });

  return (
    <div className="min-w-0 space-y-4 lg:col-span-3">
      <SectionCard
        title={t('ops.pricing.matrix')}
        subtitle={t('ops.pricing.matrixSub')}
        actions={
          <>
            {ratesDirty && <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => setRates(ratesOf(plan))}>{t('ops.pricing.discard')}</Button>}
            <Button size="sm" icon={<Save className="h-4 w-4" />} disabled={!ratesDirty} loading={saveRates.isPending} onClick={() => saveRates.mutate()}>{t('ops.pricing.saveRates')}</Button>
          </>
        }
      >
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                <th className="w-24 p-2" />
                {LEVELS.map((l) => <th key={l} className="p-2 text-start text-xs font-semibold uppercase tracking-wide text-ink-500">{t(`ops.opsa.service.${l}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {TIERS.map((tier) => (
                <tr key={tier} className="border-t border-ink-100 dark:border-ink-800">
                  <th scope="row" className="p-2 text-start font-semibold">{t('ops.pricing.tierRow', { t: tier })}</th>
                  {LEVELS.map((lvl) => {
                    const k = key(tier, lvl);
                    const v = rates[k] ?? '';
                    const orig = ratesOf(plan)[k] ?? '';
                    const bad = v.trim() !== '' && parseEgp(v) === null;
                    return (
                      <td key={lvl} className="p-1.5">
                        <Input
                          aria-label={`${t('ops.pricing.tierRow', { t: tier })} · ${t(`ops.opsa.service.${lvl}`)}`}
                          value={v}
                          inputMode="decimal"
                          placeholder="—"
                          onChange={(e) => setRates((r) => ({ ...r, [k]: e.target.value }))}
                          invalid={bad}
                          className={cn('ltr text-end font-semibold', v !== orig && 'border-sand-400 bg-sand-50 dark:bg-sand-900/20')}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title={t('ops.pricing.fees')}
          subtitle={feesDirty ? <span className="font-medium text-sand-700 dark:text-sand-300">{t('ops.pricing.unsaved')}</span> : t('ops.pricing.feesSub')}
          actions={
            <>
              {feesDirty && <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={() => setFees(feesOf(plan))}>{t('ops.pricing.discard')}</Button>}
              <Button size="sm" icon={<Save className="h-4 w-4" />} disabled={!feesDirty || fees.name.trim().length < 2} loading={saveFees.isPending} onClick={() => saveFees.mutate()}>{t('ops.pricing.saveFees')}</Button>
            </>
          }
        >
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <Field label={t('ops.pricing.name')} className="sm:col-span-2">{(id) => <Input id={id} value={fees.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />}</Field>
            <Field label={t('ops.pricing.description')} className="sm:col-span-2">{(id) => <Textarea id={id} value={fees.description} onChange={(e) => set('description', e.target.value)} className="min-h-[56px]" maxLength={500} />}</Field>
            <NumField label={t('ops.pricing.codFee')} value={fees.codFee} onChange={(v) => set('codFee', v)} />
            <NumField label={t('ops.pricing.codMin')} value={fees.codMin} onChange={(v) => set('codMin', v)} />
            <NumField label={t('ops.pricing.includedKg')} value={fees.includedKg} onChange={(v) => set('includedKg', v)} />
            <NumField label={t('ops.pricing.extraKg')} value={fees.extraKg} onChange={(v) => set('extraKg', v)} />
            <NumField label={t('ops.pricing.returnFee')} value={fees.returnFee} onChange={(v) => set('returnFee', v)} />
            <NumField label={t('ops.pricing.exchangeFee')} value={fees.exchange} onChange={(v) => set('exchange', v)} />
            <NumField label={t('ops.pricing.insurance')} value={fees.insurance} onChange={(v) => set('insurance', v)} />
            <NumField label={t('ops.pricing.vat')} value={fees.vat} onChange={(v) => set('vat', v)} />
            <div className="sm:col-span-2"><Switch checked={fees.isDefault} disabled={plan.isDefault} onChange={(v) => set('isDefault', v)} label={t('ops.pricing.makeDefault')} /></div>
          </div>
          <div className="mt-4 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Button variant="ghost" size="sm" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} disabled={plan.isDefault} onClick={() => setDel(true)}>{t('ops.pricing.delete')}</Button>
          </div>
        </SectionCard>
        <Simulator card={card} />
      </div>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger title={t('ops.pricing.deleteTitle', { name: plan.name })} description={t('ops.pricing.deleteDesc')} confirmLabel={t('action.delete')} />
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const bad = value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0;
  return <Field label={label} error={bad ? ' ' : undefined}>{(id) => <Input id={id} value={value} inputMode="decimal" onChange={(e) => onChange(e.target.value)} invalid={bad} className="ltr" />}</Field>;
}

function Simulator({ card }: { card: RateCard | null }) {
  const { t } = useI18n();
  const [s, setS] = useState({ tier: 'A' as PricingTier, serviceLevel: 'STANDARD' as ServiceLevel, type: 'DELIVERY' as OrderType, weight: '1', paymentMethod: 'COD' as PaymentMethod, cod: '1000', declared: '', feesPaidBy: 'BRAND' as FeesPayer });
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((p) => ({ ...p, [k]: v }));
  let result: ReturnType<typeof quote> | null = null;
  let error: string | null = null;
  if (card) {
    try {
      result = quote(card, { tier: s.tier, serviceLevel: s.serviceLevel, type: s.type, weightGrams: Math.max(0, Math.round((Number(s.weight) || 0) * 1000)), paymentMethod: s.paymentMethod, codAmountCents: s.paymentMethod === 'COD' ? parseEgp(s.cod) ?? 0 : 0, declaredValueCents: parseEgp(s.declared) ?? 0, feesPaidBy: s.feesPaidBy });
    } catch (e) {
      error = e instanceof PricingError ? t('ops.pricing.sim.noRate') : String(e);
    }
  } else error = t('ops.pricing.invalid');
  const rf = result && card ? returnFee(card, result.shippingFeeCents) : null;
  const feeLabel = (k: string) => t(`ops.orders.detail.fee.${['shipping', 'cod', 'weight', 'insurance', 'exchange', 'vat'].includes(k) ? k : 'extra'}`);
  return (
    <SectionCard title={<span className="flex items-center gap-2"><Calculator className="h-4 w-4 text-turtle-600" />{t('ops.pricing.sim')}</span>} subtitle={t('ops.pricing.simSub')}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('ops.pricing.sim.tier')}>{(id) => <Select id={id} value={s.tier} onChange={(e) => set('tier', e.target.value as PricingTier)} options={TIERS.map((x) => ({ value: x, label: t('ops.opsa.tier', { t: x }) }))} />}</Field>
        <Field label={t('ops.pricing.sim.service')}>{(id) => <Select id={id} value={s.serviceLevel} onChange={(e) => set('serviceLevel', e.target.value as ServiceLevel)} options={LEVELS.map((x) => ({ value: x, label: t(`ops.opsa.service.${x}`) }))} />}</Field>
        <Field label={t('ops.pricing.sim.type')}>{(id) => <Select id={id} value={s.type} onChange={(e) => set('type', e.target.value as OrderType)} options={['DELIVERY', 'EXCHANGE', 'RETURN', 'CASH_COLLECTION'].map((x) => ({ value: x, label: t(`ops.opsa.type.${x}`) }))} />}</Field>
        <Field label={t('ops.pricing.sim.weight')}>{(id) => <Input id={id} value={s.weight} onChange={(e) => set('weight', e.target.value)} inputMode="decimal" className="ltr" />}</Field>
        <Field label={t('ops.pricing.sim.payment')}>{(id) => <Select id={id} value={s.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value as PaymentMethod)} options={['COD', 'PREPAID'].map((x) => ({ value: x, label: t(`ops.opsa.payment.${x}`) }))} />}</Field>
        <Field label={t('ops.pricing.sim.cod')}>{(id) => <Input id={id} value={s.paymentMethod === 'COD' ? s.cod : '0'} disabled={s.paymentMethod !== 'COD'} onChange={(e) => set('cod', e.target.value)} inputMode="decimal" className="ltr" />}</Field>
        <Field label={t('ops.pricing.sim.declared')}>{(id) => <Input id={id} value={s.declared} onChange={(e) => set('declared', e.target.value)} inputMode="decimal" className="ltr" placeholder="0" />}</Field>
        <Field label={t('ops.pricing.sim.payer')}>{(id) => <Select id={id} value={s.feesPaidBy} onChange={(e) => set('feesPaidBy', e.target.value as FeesPayer)} options={['BRAND', 'RECIPIENT'].map((x) => ({ value: x, label: t(`ops.opsa.payer.${x}`) }))} />}</Field>
      </div>
      <div className="mt-4 rounded-2xl bg-ink-50 p-4 dark:bg-ink-800/50" aria-live="polite">
        {error || !result ? (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{error}</p>
        ) : (
          <>
            <dl className="divide-y divide-ink-200/70 text-sm dark:divide-ink-700">
              {result.breakdown.map((b) => (
                <div key={b.key} className="flex justify-between py-1.5"><dt className="text-ink-500">{feeLabel(b.key)}</dt><dd><span className="ltr">{money(b.cents)}</span></dd></div>
              ))}
              <div className="flex justify-between py-2 font-semibold"><dt>{t('ops.pricing.sim.total')}</dt><dd className="font-display text-lg"><span className="ltr">{money(result.totalFeesCents)}</span></dd></div>
            </dl>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white p-2 dark:bg-ink-900"><p className="text-[11px] text-ink-500">{t('ops.pricing.sim.collect')}</p><p className="font-display font-bold text-sand-700 dark:text-sand-300"><span className="ltr">{money(result.collectFromRecipientCents)}</span></p></div>
              <div className="rounded-xl bg-white p-2 dark:bg-ink-900"><p className="text-[11px] text-ink-500">{t('ops.pricing.sim.net')}</p><p className={cn('ltr font-display font-bold', result.netToBrandCents < 0 ? 'text-red-600' : 'text-turtle-700 dark:text-turtle-400')}>{money(result.netToBrandCents)}</p></div>
              <div className="rounded-xl bg-white p-2 dark:bg-ink-900"><p className="text-[11px] text-ink-500">{t('ops.pricing.sim.return')}</p><p className="font-display font-bold"><span className="ltr">{rf != null ? money(rf) : '—'}</span></p></div>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}

function NewPlanModal({ plans, onClose, onCreated }: { plans: Plan[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [from, setFrom] = useState(plans.find((p) => p.isDefault)?.id ?? plans[0]?.id ?? '');
  const create = useMutation({
    mutationFn: () => {
      const src = plans.find((p) => p.id === from);
      const body = src
        ? {
            name: name.trim(), description: description.trim() || undefined, codFeeBp: src.codFeeBp, codFeeMinCents: src.codFeeMinCents, includedWeightGrams: src.includedWeightGrams, extraKgCents: src.extraKgCents,
            returnFeeBp: src.returnFeeBp, exchangeFeeCents: src.exchangeFeeCents, insuranceBp: src.insuranceBp, vatBp: src.vatBp, rules: src.rules.map((r) => ({ tier: r.tier, serviceLevel: r.serviceLevel, baseFeeCents: r.baseFeeCents })),
          }
        : { name: name.trim(), description: description.trim() || undefined };
      return api<Plan>('/pricing/plans', { method: 'POST', body });
    },
    onSuccess: (p) => {
      toast.success(t('ops.pricing.created', { name: p.name }));
      void qc.invalidateQueries({ queryKey: ['pricing'] });
      onCreated(p.id);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('ops.pricing.newPlan')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={name.trim().length < 2} loading={create.isPending} onClick={() => create.mutate()}>{t('action.create')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('ops.pricing.name')} required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Enterprise" />}</Field>
        <Field label={t('ops.pricing.description')}>{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="min-h-[56px]" />}</Field>
        <Field label={t('ops.pricing.copyFrom')}>{(id) => <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="—" options={plans.map((p) => ({ value: p.id, label: p.name }))} />}</Field>
      </div>
    </Modal>
  );
}
