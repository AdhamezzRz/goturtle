import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { ago, parseEgp } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Field, Input, Select } from '@/components/ui';
import { Section } from '@/portals/ops/components/opsb';
import { EventsEditor, eventErrors } from '../forecast/EventsEditor';
import type { PlatformSettings } from '../types';
import '../i18n';

interface Row {
  value: PlatformSettings;
  defaults: PlatformSettings;
  updatedAt: string | null;
  updatedBy: { name: string } | null;
}

/** Ops → Settings → Platform: staffing ratio, demand events, partner fee default, routing provider. */
export function PlatformSettingsForm({ row }: { row: Row }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [v, setV] = useState<PlatformSettings>(row.value);
  const [fee, setFee] = useState(String(row.value.partnerFeeCents / 100));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    setV(row.value);
    setFee(String(row.value.partnerFeeCents / 100));
  }, [row.value]);
  const dirty = JSON.stringify(v) !== JSON.stringify(row.value);
  const m = useMutation({
    mutationFn: (patch: Partial<PlatformSettings>) => api('/settings/platform', { method: 'PUT', body: { value: patch } }),
    onSuccess: () => {
      toast.success(t('intake.set.saved'));
      setErrors({});
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['forecast'] });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const list = (e.details as { errors?: Array<{ field: string; message: string }> } | undefined)?.errors ?? [];
        setErrors(Object.fromEntries(list.map((x) => [x.field, x.message])));
      }
      toast.error(errorMessage(e));
    },
  });
  const save = () => {
    const e: Record<string, string | undefined> = {};
    if (!Number.isInteger(v.ordersPerHeroPerShift) || v.ordersPerHeroPerShift < 1 || v.ordersPerHeroPerShift > 500) e.ordersPerHeroPerShift = '1 – 500';
    if (parseEgp(fee) === null && fee.trim() !== '0') e.partnerFeeCents = t('intake.pt.err.amount');
    const ev = eventErrors(v.forecastEvents);
    if (ev) e.forecastEvents = t(`intake.fc.err.${ev}`);
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    const patch: Partial<PlatformSettings> = {};
    for (const k of Object.keys(v) as Array<keyof PlatformSettings>) if (JSON.stringify(v[k]) !== JSON.stringify(row.value[k])) (patch as Record<string, unknown>)[k] = v[k];
    m.mutate(patch);
  };
  return (
    <Section
      title={t('intake.set.title')}
      subtitle={t('intake.set.subtitle')}
      actions={<span className="text-xs text-ink-400">{row.updatedAt ? t('intake.set.updated', { ago: ago(row.updatedAt) }) : t('intake.set.defaults')}{row.updatedBy ? ` · ${row.updatedBy.name}` : ''}</span>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('intake.set.ordersPerHero')} hint={t('intake.set.ordersPerHeroHint')} error={errors.ordersPerHeroPerShift}>
          {(id) => <Input id={id} type="number" dir="ltr" min={1} max={500} value={v.ordersPerHeroPerShift} onChange={(e) => setV({ ...v, ordersPerHeroPerShift: Number(e.target.value) })} invalid={!!errors.ordersPerHeroPerShift} />}
        </Field>
        <Field label={t('intake.set.partnerFee')} hint={t('intake.set.partnerFeeHint')} error={errors.partnerFeeCents}>
          {(id) => <Input id={id} inputMode="decimal" dir="ltr" value={fee} onChange={(e) => { setFee(e.target.value); const c = parseEgp(e.target.value); if (c !== null) setV({ ...v, partnerFeeCents: c }); }} trailing={<span className="text-xs">{t('common.egp')}</span>} invalid={!!errors.partnerFeeCents} />}
        </Field>
        <Field className="sm:col-span-2" label={t('intake.set.routing')} hint={t('intake.set.routingHint')}>
          {(id) => <Select id={id} value={v.routingProvider} onChange={(e) => setV({ ...v, routingProvider: e.target.value as PlatformSettings['routingProvider'] })} options={(['haversine', 'osrm', 'google'] as const).map((p) => ({ value: p, label: t(`intake.set.routing.${p}`) }))} />}
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-ink-700 dark:text-ink-200">{t('intake.fc.events')}</p>
          <p className="mb-2 text-xs text-ink-500">{t('intake.fc.eventsHint')}</p>
          <EventsEditor value={v.forecastEvents} onChange={(list) => setV({ ...v, forecastEvents: list })} />
          {errors.forecastEvents && <p className="mt-2 text-xs font-medium text-red-600">{errors.forecastEvents}</p>}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
        <Button variant="ghost" size="sm" onClick={() => { setV(row.defaults); setFee(String(row.defaults.partnerFeeCents / 100)); }}>{t('intake.set.restore')}</Button>
        <div className="flex items-center gap-2">
          {dirty && <Badge tone="warning" dot>{t('intake.set.unsaved')}</Badge>}
          <Button variant="outline" disabled={!dirty} onClick={() => { setV(row.value); setFee(String(row.value.partnerFeeCents / 100)); }}>{t('intake.set.discard')}</Button>
          <Button loading={m.isPending} disabled={!dirty} onClick={save}>{t('action.save')}</Button>
        </div>
      </div>
    </Section>
  );
}
