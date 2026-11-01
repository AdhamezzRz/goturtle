import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CollectionMethod } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';
import { ago, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, Checkbox, Field, Input } from '@/components/ui';
import { METHOD_ICON } from '../ui';
import type { FinanceSettings } from '../types';
import '../i18n';

type Row = { key: string; value: FinanceSettings; defaults: FinanceSettings; updatedAt: string | null; updatedBy: { id: string; name: string } | null };
type Errors = Partial<Record<keyof FinanceSettings, string>>;

const INT_FIELDS = ['earlyPayoutFeeBp', 'codAdvanceFeeBp', 'codAdvanceMaxRateBp', 'claimWindowHours', 'weightToleranceGrams', 'weightTolerancePct', 'volumetricDivisor', 'weightDisputeWindowHours'] as const;
const MONEY_FIELDS = ['advanceMinCents', 'claimDefaultCapCents'] as const;

/** Ops settings → Finance group (door payments, advances, claims, weighing). */
export function FinanceSettingsForm({ row }: { row: Row }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [v, setV] = useState<FinanceSettings>(row.value);
  const [money, setMoney] = useState(() => Object.fromEntries(MONEY_FIELDS.map((k) => [k, String(row.value[k] / 100)])) as Record<(typeof MONEY_FIELDS)[number], string>);
  const [errors, setErrors] = useState<Errors>({});
  const reset = (from: FinanceSettings) => {
    setV(from);
    setMoney(Object.fromEntries(MONEY_FIELDS.map((k) => [k, String(from[k] / 100)])) as Record<(typeof MONEY_FIELDS)[number], string>);
    setErrors({});
  };
  useEffect(() => reset(row.value), [row.value]);
  const current: FinanceSettings = { ...v, ...Object.fromEntries(MONEY_FIELDS.map((k) => [k, parseEgp(money[k]) ?? -1])) };
  const dirty = JSON.stringify(current) !== JSON.stringify(row.value);
  const save = useMutation({
    mutationFn: (patch: Partial<FinanceSettings>) => api('/settings/finance', { method: 'PUT', body: { value: patch } }),
    onSuccess: () => { toast.success(t('money.settings.saved')); setErrors({}); void qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => {
      if (e instanceof ApiError) {
        const list = (e.details as { errors?: Array<{ field: string; message: string }> } | undefined)?.errors ?? [];
        setErrors(Object.fromEntries(list.map((x) => [x.field, x.message])));
      }
      toast.error(errorMessage(e));
    },
  });
  const submit = () => {
    const e: Errors = {};
    if (!current.acceptedCollectionMethods.length) e.acceptedCollectionMethods = t('money.settings.oneMethod');
    for (const k of MONEY_FIELDS) if (current[k] < 0) e[k] = t('money.settings.invalid');
    for (const k of INT_FIELDS) if (!Number.isInteger(current[k]) || current[k] < 0) e[k] = t('money.settings.invalid');
    setErrors(e);
    if (Object.keys(e).length) return;
    const patch: Partial<FinanceSettings> = {};
    for (const k of Object.keys(current) as Array<keyof FinanceSettings>) {
      if (JSON.stringify(current[k]) !== JSON.stringify(row.value[k])) (patch as Record<string, unknown>)[k] = current[k];
    }
    save.mutate(patch);
  };
  const int = (k: (typeof INT_FIELDS)[number], suffix: ReactNode, hint?: string) => (
    <Field label={t(`money.settings.f.${k}`)} hint={hint} error={errors[k]}>
      {(id) => <Input id={id} inputMode="numeric" className="ltr" value={String(v[k])} onChange={(e) => setV((s) => ({ ...s, [k]: Number(e.target.value.replace(/\D/g, '') || 0) }))} trailing={<span className="text-xs font-semibold">{suffix}</span>} />}
    </Field>
  );
  const egp = (k: (typeof MONEY_FIELDS)[number]) => (
    <Field label={t(`money.settings.f.${k}`)} error={errors[k]}>
      {(id) => <Input id={id} inputMode="decimal" className="ltr" value={money[k]} onChange={(e) => setMoney((s) => ({ ...s, [k]: e.target.value }))} trailing={<span className="text-xs font-semibold">{t('money.egp')}</span>} />}
    </Field>
  );
  const toggle = (m: CollectionMethod) =>
    setV((s) => ({ ...s, acceptedCollectionMethods: s.acceptedCollectionMethods.includes(m) ? s.acceptedCollectionMethods.filter((x) => x !== m) : [...s.acceptedCollectionMethods, m] }));
  const bpHint = (bp: number) => t('money.settings.bpHint', { pct: String(bp / 100) });
  return (
    <Card>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold text-ink-900 dark:text-white">{t('ops.settings.group.finance')}</h2>
          <p className="text-sm text-ink-500">{t('ops.settings.desc.finance')}</p>
        </div>
        <span className="text-xs text-ink-400">{row.updatedAt ? t('money.settings.updated', { ago: ago(row.updatedAt) }) : t('money.settings.never')}{row.updatedBy ? ` · ${row.updatedBy.name}` : ''}</span>
      </div>
      <div className="space-y-8">
        <section className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">{t('money.settings.door')}</h3>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-700 dark:text-ink-200">{t('money.settings.f.acceptedCollectionMethods')}</p>
            <div className="flex flex-wrap gap-3">
              {Object.values(CollectionMethod).map((m) => (
                <Checkbox key={m} checked={v.acceptedCollectionMethods.includes(m)} onChange={() => toggle(m)} label={<span className="inline-flex items-center gap-1.5">{METHOD_ICON[m]}{t(`money.method.${m}`)}</span>} />
              ))}
            </div>
            {errors.acceptedCollectionMethods && <p className="mt-1 text-xs font-medium text-red-600">{errors.acceptedCollectionMethods}</p>}
            <p className="mt-1 text-xs text-ink-500">{t('money.settings.linkHint')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('money.settings.f.instapayAddress')} hint={t('money.settings.instapayHint')} error={errors.instapayAddress}>
              {(id) => <Input id={id} className="ltr" value={v.instapayAddress} onChange={(e) => setV((s) => ({ ...s, instapayAddress: e.target.value }))} placeholder="goturtle@instapay" maxLength={120} />}
            </Field>
            <Field label={t('money.settings.f.walletNumber')} hint={t('money.settings.walletHint')} error={errors.walletNumber}>
              {(id) => <Input id={id} className="ltr" inputMode="tel" value={v.walletNumber} onChange={(e) => setV((s) => ({ ...s, walletNumber: e.target.value }))} placeholder="010…" maxLength={20} />}
            </Field>
          </div>
        </section>
        <section className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">{t('money.settings.advances')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {int('earlyPayoutFeeBp', t('money.settings.bp'), bpHint(v.earlyPayoutFeeBp))}
            {int('codAdvanceFeeBp', t('money.settings.bp'), bpHint(v.codAdvanceFeeBp))}
            {int('codAdvanceMaxRateBp', t('money.settings.bp'), bpHint(v.codAdvanceMaxRateBp))}
            {egp('advanceMinCents')}
          </div>
        </section>
        <section className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">{t('money.settings.claims')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {egp('claimDefaultCapCents')}
            {int('claimWindowHours', t('money.settings.hours'))}
          </div>
        </section>
        <section className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">{t('money.settings.weighing')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {int('weightToleranceGrams', t('money.settings.grams'))}
            {int('weightTolerancePct', '%')}
            {int('volumetricDivisor', '', t('money.settings.divisorHint'))}
            {int('weightDisputeWindowHours', t('money.settings.hours'))}
          </div>
          <p className="text-xs text-ink-500">{t('money.settings.toleranceHint')}</p>
        </section>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
        <Button variant="ghost" size="sm" onClick={() => reset(row.defaults)}>{t('ops.settings.defaults')}</Button>
        <div className="flex items-center gap-2">
          {dirty && <Badge tone="warning" dot>{t('ops.settings.unsaved')}</Badge>}
          <Button variant="outline" disabled={!dirty} onClick={() => reset(row.value)}>{t('ops.settings.reset')}</Button>
          <Button loading={save.isPending} disabled={!dirty} onClick={submit}>{t('action.save')}</Button>
        </div>
      </div>
    </Card>
  );
}
