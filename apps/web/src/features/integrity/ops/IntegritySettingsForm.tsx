import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info, RotateCcw, Save } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ago, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input, Select, Switch } from '@/components/ui';
import { MoneyInput, Notice, Section, centsToInput } from '@/portals/ops/components/opsb';
import type { IntegritySettings } from '../types';
import '../i18n';

interface Row { value: IntegritySettings; defaults: IntegritySettings; isDefault: boolean; updatedAt: string | null; updatedBy: { id: string; name: string } | null }

type NumKey = { [K in keyof IntegritySettings]: IntegritySettings[K] extends number ? K : never }[keyof IntegritySettings];
const RANGES: Partial<Record<NumKey, [number, number]>> = {
  confirmAboveRisk: [0, 100], holdUnconfirmedAboveRisk: [0, 100], prepayAboveRisk: [1, 100], noResponseAfterHours: [1, 168],
  failedAttemptGeofenceMeters: [0, 5000], unreachableMinCalls: [0, 5], unreachableMinSpacingMinutes: [0, 60], attemptDisputeWindowHours: [1, 168],
};

/** Ops settings → Delivery integrity (PUT /settings/integrity). */
export function IntegritySettingsForm({ row }: { row: Row }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [v, setV] = useState<IntegritySettings>(row.value);
  const [cod, setCod] = useState(centsToInput(row.value.confirmCodAboveCents));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  useEffect(() => { setV(row.value); setCod(centsToInput(row.value.confirmCodAboveCents)); }, [row.value]);
  const dirty = JSON.stringify(v) !== JSON.stringify(row.value);
  const m = useMutation({
    mutationFn: (patch: Partial<IntegritySettings>) => api('/settings/integrity', { method: 'PUT', body: { value: patch } }),
    onSuccess: () => { toast.success(t('ops.settings.saved')); setErrors({}); void qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => {
      if (e instanceof ApiError) {
        const list = (e.details as { errors?: Array<{ field: string; message: string }> } | undefined)?.errors ?? [];
        setErrors(Object.fromEntries(list.map((x) => [x.field, x.message])));
      }
      toast.error(errorMessage(e));
    },
  });
  const set = <K extends keyof IntegritySettings>(k: K, val: IntegritySettings[K]) => {
    setV((s) => ({ ...s, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const save = () => {
    const e: Record<string, string> = {};
    for (const [k, [min, max]] of Object.entries(RANGES) as Array<[NumKey, [number, number]]>) {
      const n = v[k];
      if (!Number.isInteger(n) || n < min || n > max) e[k] = `${min} – ${max}`;
    }
    if (parseEgp(cod) === null && cod !== '0') e.confirmCodAboveCents = t('ops.opsb.invalidAmount');
    setErrors(e);
    if (Object.keys(e).length) return;
    const patch: Partial<IntegritySettings> = {};
    for (const k of Object.keys(v) as Array<keyof IntegritySettings>) if (v[k] !== row.value[k]) (patch as Record<string, unknown>)[k] = v[k];
    m.mutate(patch);
  };
  const num = (k: NumKey, label: string, hint?: string) => (
    <Field label={label} hint={hint} error={errors[k]}>
      {(id) => <Input id={id} type="number" dir="ltr" min={RANGES[k]?.[0]} max={RANGES[k]?.[1]} value={v[k]} onChange={(e) => set(k, Math.round(Number(e.target.value)))} invalid={!!errors[k]} />}
    </Field>
  );
  const toggle = (k: 'confirmationEnabled' | 'requestPinWhenMissing', label: ReactNode) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800 sm:col-span-2">
      <span className="text-sm text-ink-800 dark:text-ink-100">{label}</span>
      <Switch checked={v[k]} onChange={(val) => set(k, val)} />
    </div>
  );

  return (
    <div className="space-y-5">
      <Notice icon={<Info className="h-4 w-4" />}>{t('integrity.settings.help')}</Notice>
      <Section title={t('integrity.settings.confirmation')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {toggle('confirmationEnabled', t('integrity.settings.confirmationEnabled'))}
          {num('confirmAboveRisk', t('integrity.settings.confirmAboveRisk'))}
          <Field label={t('integrity.settings.confirmCodAbove')} error={errors.confirmCodAboveCents}>
            {(id) => <MoneyInput id={id} value={cod} onChange={(val) => { setCod(val); const c = parseEgp(val); if (c !== null) set('confirmCodAboveCents', c); }} invalid={!!errors.confirmCodAboveCents} />}
          </Field>
          {num('holdUnconfirmedAboveRisk', t('integrity.settings.holdAbove'))}
          {num('noResponseAfterHours', t('integrity.settings.noResponseHours'))}
          {num('prepayAboveRisk', t('integrity.settings.prepayAbove'))}
          <Field label={t('integrity.settings.channel')}>
            {(id) => <Select id={id} value={v.confirmationChannel} onChange={(e) => set('confirmationChannel', e.target.value as 'WHATSAPP' | 'SMS')} options={[{ value: 'WHATSAPP', label: t('integrity.channel.WHATSAPP') }, { value: 'SMS', label: t('integrity.channel.SMS') }]} />}
          </Field>
        </div>
      </Section>
      <Section title={t('integrity.settings.attempts')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {num('failedAttemptGeofenceMeters', t('integrity.settings.geofence'))}
          {num('unreachableMinCalls', t('integrity.settings.minCalls'))}
          {num('unreachableMinSpacingMinutes', t('integrity.settings.spacing'))}
          {num('attemptDisputeWindowHours', t('integrity.settings.disputeWindow'))}
        </div>
      </Section>
      <Section title={t('integrity.settings.address')}>
        <div className="grid gap-4 sm:grid-cols-2">{toggle('requestPinWhenMissing', t('integrity.settings.requestPin'))}</div>
      </Section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-500">{row.updatedAt ? `${ago(row.updatedAt)}${row.updatedBy ? ` · ${row.updatedBy.name}` : ''}` : null}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setV(row.defaults); setCod(centsToInput(row.defaults.confirmCodAboveCents)); }}>{t('ops.settings.defaults')}</Button>
          <Button variant="outline" disabled={!dirty} onClick={() => { setV(row.value); setCod(centsToInput(row.value.confirmCodAboveCents)); }}>{t('ops.settings.reset')}</Button>
          <Button icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={m.isPending} onClick={save}>{t('action.save')}</Button>
        </div>
      </div>
    </div>
  );
}
