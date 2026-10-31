import { lazy, Suspense, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { Button, Checkbox, Field, Input, Modal, Select, Skeleton } from '@/components/ui';
import { apiFieldErrors, useForm, useZones, v, type Errors } from '@/portals/ops/components/opsb';
import type { BrandLocation } from './types';

const PinMap = lazy(() => import('@/portals/ops/components/opsb/PinMap'));

export type LocationValues = { name: string; contactName: string; phone: string; addressLine: string; zoneId: string; lat: number | null; lng: number | null; isDefault: boolean };

export const emptyLocation: LocationValues = { name: '', contactName: '', phone: '', addressLine: '', zoneId: '', lat: null, lng: null, isDefault: false };

export function validateLocation(l: LocationValues, t: (k: string, v?: Record<string, string | number>) => string, opts: { contactOptional?: boolean } = {}): Errors {
  const e: Errors = {};
  if (l.name.trim().length < 2) e.name = t('ops.opsb.minChars', { n: 2 });
  if (l.addressLine.trim().length < 5) e.addressLine = t('ops.brands.loc.addressMin');
  if (!l.zoneId) e.zoneId = t('ops.opsb.required');
  if (l.phone && !v.phone(l.phone)) e.phone = t('ops.opsb.invalidPhone');
  if (!opts.contactOptional && l.contactName && l.contactName.trim().length < 2) e.contactName = t('ops.opsb.minChars', { n: 2 });
  return e;
}

/** Name / contact / address / zone / map pin fields for a pickup location. */
export function LocationFields({ value, onChange, errors, prefix = '' }: { value: LocationValues; onChange: (patch: Partial<LocationValues>) => void; errors: Errors; prefix?: string }) {
  const { t, pick } = useI18n();
  const zones = useZones();
  const zone = zones.data?.find((z) => z.id === value.zoneId) as { centerLat?: number; centerLng?: number } | undefined;
  const e = (k: string) => errors[`${prefix}${k}`];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('ops.brands.loc.name')} required error={e('name')}>{(id) => <Input id={id} value={value.name} onChange={(ev) => onChange({ name: ev.target.value })} invalid={!!e('name')} maxLength={120} />}</Field>
      <Field label={t('ops.brands.loc.zone')} required error={e('zoneId')}>{(id) => <Select id={id} value={value.zoneId} onChange={(ev) => onChange({ zoneId: ev.target.value })} placeholder={t('ops.opsb.select')} options={(zones.data ?? []).map((z) => ({ value: z.id, label: pick(z, 'name') }))} className={e('zoneId') ? 'border-red-400' : undefined} />}</Field>
      <Field label={t('ops.brands.loc.address')} required error={e('addressLine')} className="sm:col-span-2">{(id) => <Input id={id} value={value.addressLine} onChange={(ev) => onChange({ addressLine: ev.target.value })} invalid={!!e('addressLine')} maxLength={500} />}</Field>
      <Field label={t('ops.brands.loc.contact')} hint={t('ops.opsb.optional')} error={e('contactName')}>{(id) => <Input id={id} value={value.contactName} onChange={(ev) => onChange({ contactName: ev.target.value })} maxLength={120} />}</Field>
      <Field label={t('ops.brands.loc.phone')} hint={t('ops.opsb.optional')} error={e('phone')}>{(id) => <Input id={id} dir="ltr" inputMode="tel" value={value.phone} onChange={(ev) => onChange({ phone: ev.target.value })} invalid={!!e('phone')} maxLength={20} />}</Field>
      <div className="sm:col-span-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 dark:text-ink-200"><MapPin className="h-4 w-4" />{t('ops.brands.loc.pin')}</p>
          {value.lat !== null ? (
            <span className="flex items-center gap-2 text-xs text-ink-500"><span className="ltr">{value.lat.toFixed(5)}, {value.lng?.toFixed(5)}</span><Button size="xs" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => onChange({ lat: null, lng: null })}>{t('ops.brands.loc.clearPin')}</Button></span>
          ) : <span className="text-xs text-ink-400">{t('ops.opsb.pinHint')}</span>}
        </div>
        <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
          <PinMap lat={value.lat} lng={value.lng} height={240} onPick={(lat, lng) => onChange({ lat, lng })} recenterOn={zone?.centerLat && zone.centerLng ? [zone.centerLat, zone.centerLng] : null} />
        </Suspense>
      </div>
    </div>
  );
}

export function LocationModal({ open, onClose, brandId, location }: { open: boolean; onClose: () => void; brandId: string; location?: BrandLocation | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { values, patch, errors, setErrors, reset } = useForm<LocationValues>(emptyLocation);
  useEffect(() => {
    if (!open) return;
    reset(location ? { name: location.name, contactName: location.contactName, phone: location.phone, addressLine: location.addressLine, zoneId: location.zoneId, lat: location.lat, lng: location.lng, isDefault: location.isDefault } : emptyLocation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, location?.id]);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: values.name.trim(), contactName: values.contactName.trim() || undefined, phone: values.phone.trim() || undefined, addressLine: values.addressLine.trim(), zoneId: values.zoneId,
        lat: values.lat ?? (location ? null : undefined), lng: values.lng ?? (location ? null : undefined), isDefault: values.isDefault,
      };
      return location ? api(`/brands/${brandId}/locations/${location.id}`, { method: 'PATCH', body }) : api(`/brands/${brandId}/locations`, { method: 'POST', body });
    },
    onSuccess: () => { toast.success(t('ops.brands.loc.saved')); qc.invalidateQueries({ queryKey: ['brands'] }); onClose(); },
    onError: (err) => { setErrors(apiFieldErrors(err, ['name', 'contactName', 'phone', 'addressLine', 'zoneId', 'lat', 'lng'], { INVALID_ZONE: 'zoneId', INVALID_PHONE: 'phone' })); toast.error(errorMessage(err)); },
  });
  return (
    <Modal open={open} onClose={onClose} title={location ? t('ops.brands.loc.edit') : t('ops.brands.loc.new')} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => { const e = validateLocation(values, t); setErrors(e); if (!Object.values(e).some(Boolean)) m.mutate(); }}>{t('action.save')}</Button></>}
    >
      <div className="space-y-4">
        <LocationFields value={values} onChange={patch} errors={errors} />
        <Checkbox label={t('ops.brands.loc.makeDefault')} checked={values.isDefault} disabled={location?.isDefault} onChange={(e) => patch({ isDefault: e.target.checked })} />
      </div>
    </Modal>
  );
}
