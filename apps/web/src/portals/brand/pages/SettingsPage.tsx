import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Camera, Crosshair, Landmark, Loader2, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeEgyptPhone } from '@goturtle/shared';
import { api, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useQueryState } from '@/lib/hooks';
import { phone } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch, Tabs } from '@/components/ui';
import { Ltr, nameOf, SectionTitle, Segmented, useLocations, useMyBrand, useZones } from '../components/common';
import type { BrandLocation, DetectZoneResult, MyBrand } from '../components/types';
import './i18n';

const PinMap = lazy(() => import('../components/PinMap'));

export default function SettingsPage() {
  const { t } = useI18n();
  const [f, setF] = useQueryState({ tab: 'profile' });
  const brand = useMyBrand();
  return (
    <div>
      <PageHeader title={t('brand.nav.settings')} subtitle={t('brand.settings.subtitle')} />
      <Tabs value={f.tab} onChange={(v) => setF({ tab: v })} className="mb-6" tabs={[{ value: 'profile', label: t('brand.settings.tab.profile') }, { value: 'payout', label: t('brand.settings.tab.payout') }, { value: 'locations', label: t('brand.settings.tab.locations') }]} />
      {brand.isLoading ? <Skeleton className="h-96 w-full" /> : brand.isError || !brand.data ? <Card><ErrorState error={brand.error} onRetry={() => brand.refetch()} /></Card> : f.tab === 'payout' ? <Payout brand={brand.data} /> : f.tab === 'locations' ? <Locations /> : <Profile brand={brand.data} />}
    </div>
  );
}

function useSaveBrand() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { refreshMe } = useAuth();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<MyBrand>('/brands/me', { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success(t('brand.common.saved'));
      qc.invalidateQueries({ queryKey: ['brand'] });
      refreshMe();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function Profile({ brand }: { brand: MyBrand }) {
  const { t } = useI18n();
  const save = useSaveBrand();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const init = () => ({ legalName: brand.legalName ?? '', commercialRegNo: brand.commercialRegNo ?? '', taxId: brand.taxId ?? '', industry: brand.industry ?? '', website: brand.website ?? '', email: brand.email ?? '', phone: brand.phone.replace(/^\+20/, '0'), defaultFeesPaidBy: brand.defaultFeesPaidBy });
  const [f, setF] = useState(init);
  useEffect(() => { setF(init()); }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps
  const [touched, setTouched] = useState(false);
  const errors = {
    website: f.website && !/^https?:\/\/\S+$/.test(f.website) ? t('brand.settings.errWebsite') : undefined,
    email: f.email && !/^\S+@\S+\.\S+$/.test(f.email) ? t('brand.team.errEmail') : undefined,
    phone: !normalizeEgyptPhone(f.phone) && !/^\+?\d{8,15}$/.test(f.phone) ? t('error.INVALID_PHONE') : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const onLogo = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error(t('brand.settings.logoType'));
    if (file.size > 2 * 1024 * 1024) return toast.error(t('brand.settings.logoSize'));
    setUploading(true);
    try {
      const up = await uploadFile(file, 'logo');
      save.mutate({ logoUrl: up.url });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => {
    setTouched(true);
    if (!valid) return;
    const body: Record<string, unknown> = { defaultFeesPaidBy: f.defaultFeesPaidBy, phone: f.phone };
    for (const k of ['legalName', 'commercialRegNo', 'taxId', 'industry', 'website', 'email'] as const) if (f[k].trim()) body[k] = f[k].trim();
    save.mutate(body);
  };
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.name} className="h-28 w-28 rounded-3xl border border-ink-100 object-cover dark:border-ink-800" />
            ) : (
              <span className="grid h-28 w-28 place-items-center rounded-3xl bg-gradient-to-br from-turtle-500 to-turtle-800 font-display text-4xl font-bold text-white">{brand.name.slice(0, 1)}</span>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} className="absolute -bottom-2 -end-2 grid h-10 w-10 place-items-center rounded-full bg-white text-ink-700 shadow-pop ring-1 ring-ink-100 hover:bg-ink-50 dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-700" aria-label={t('brand.settings.uploadLogo')}>
              {uploading || save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => onLogo(e.target.files?.[0])} />
          </div>
          <p className="mt-4 font-display text-xl font-bold text-ink-900 dark:text-white">{brand.name}</p>
          <p className="ltr font-mono text-sm text-ink-500">{brand.code}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Badge tone={brand.status === 'ACTIVE' ? 'success' : brand.status === 'PENDING' ? 'warning' : 'danger'} dot>{t(`state.${brand.status}`)}</Badge>
            {brand.plan && <Badge tone="info">{brand.plan.name}</Badge>}
          </div>
          <p className="mt-4 text-xs text-ink-500">{t('brand.settings.logoHint')}</p>
        </div>
        <dl className="mt-6 space-y-2 border-t border-ink-100 pt-4 text-sm dark:border-ink-800">
          <div className="flex justify-between gap-2"><dt className="text-ink-500">{t('brand.settings.cycle')}</dt><dd className="font-medium">{t(`brand.cycle.${brand.settlementCycle}`)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-ink-500">{t('brand.settings.openPackages')}</dt><dd className="font-medium">{brand.allowOpenPackage ? t('common.yes') : t('common.no')}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-ink-400">{t('brand.settings.managedByUs')}</p>
      </Card>
      <Card className="lg:col-span-2">
        <SectionTitle icon={<Building2 />} title={t('brand.settings.business')} subtitle={t('brand.settings.businessHint')} />
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label={t('brand.settings.legalName')}>{(id) => <Input id={id} maxLength={200} value={f.legalName} onChange={set('legalName')} />}</Field>
          <Field label={t('brand.settings.industry')}>{(id) => <Input id={id} maxLength={80} value={f.industry} onChange={set('industry')} />}</Field>
          <Field label={t('brand.settings.crn')}>{(id) => <Input id={id} dir="ltr" maxLength={50} value={f.commercialRegNo} onChange={set('commercialRegNo')} />}</Field>
          <Field label={t('brand.settings.taxId')}>{(id) => <Input id={id} dir="ltr" maxLength={50} value={f.taxId} onChange={set('taxId')} />}</Field>
          <Field label={t('common.phone')} error={touched ? errors.phone : undefined}>{(id) => <Input id={id} dir="ltr" type="tel" value={f.phone} onChange={set('phone')} />}</Field>
          <Field label={t('common.email')} error={touched ? errors.email : undefined}>{(id) => <Input id={id} dir="ltr" type="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label={t('brand.settings.website')} error={touched ? errors.website : undefined} className="sm:col-span-2">{(id) => <Input id={id} dir="ltr" type="url" placeholder="https://" value={f.website} onChange={set('website')} />}</Field>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('brand.settings.defaultPayer')}</p>
            <Segmented value={f.defaultFeesPaidBy} onChange={(v) => setF({ ...f, defaultFeesPaidBy: v })} options={[{ value: 'BRAND', label: t('brand.new.payerBrand') }, { value: 'RECIPIENT', label: t('brand.new.payerRecipient') }]} />
          </div>
          <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={save.isPending}>{t('action.save')}</Button></div>
        </form>
      </Card>
    </div>
  );
}

const PAYOUT_FIELDS: Record<string, string[]> = {
  BANK_TRANSFER: ['bankName', 'accountName', 'iban', 'accountNumber'],
  INSTAPAY: ['instapayAddress', 'accountName'],
  VODAFONE_CASH: ['walletPhone', 'accountName'],
  FAWRY: ['walletPhone', 'accountName'],
  CASH: [],
  OTHER: ['accountName', 'accountNumber'],
};

function Payout({ brand }: { brand: MyBrand }) {
  const { t } = useI18n();
  const { me } = useAuth();
  const owner = me?.role === 'BRAND_OWNER';
  const save = useSaveBrand();
  const [method, setMethod] = useState(brand.payoutMethod ?? 'INSTAPAY');
  const [details, setDetails] = useState<Record<string, string>>(brand.payoutDetails ?? {});
  const [touched, setTouched] = useState(false);
  useEffect(() => { setMethod(brand.payoutMethod ?? 'INSTAPAY'); setDetails(brand.payoutDetails ?? {}); }, [brand]);
  const fields = PAYOUT_FIELDS[method] ?? [];
  const errors: Record<string, string | undefined> = {
    iban: details.iban && !/^EG\d{27}$/.test(details.iban.replace(/\s/g, '').toUpperCase()) ? t('brand.settings.errIban') : undefined,
    walletPhone: details.walletPhone && !normalizeEgyptPhone(details.walletPhone) ? t('error.INVALID_PHONE') : undefined,
  };
  const valid = fields.every((k) => !errors[k]);
  const submit = () => {
    setTouched(true);
    if (!valid) return;
    const payoutDetails = Object.fromEntries(fields.map((k) => [k, k === 'iban' ? (details[k] ?? '').replace(/\s/g, '').toUpperCase() : (details[k] ?? '').trim()]).filter(([, v]) => v));
    save.mutate({ payoutMethod: method, payoutDetails });
  };
  return (
    <Card className="max-w-3xl">
      <SectionTitle icon={<Landmark />} title={t('brand.settings.payoutTitle')} subtitle={t('brand.settings.payoutHint')} />
      {!owner && <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">{t('brand.common.ownerOnly')}</p>}
      <fieldset disabled={!owner} className="space-y-4">
        <Field label={t('brand.wallet.payoutMethod')}>
          {(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)} options={['INSTAPAY', 'BANK_TRANSFER', 'VODAFONE_CASH', 'FAWRY', 'CASH', 'OTHER'].map((m) => ({ value: m, label: t(`brand.payout.${m}`) }))} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((k) => (
            <Field key={k} label={t(`brand.payoutField.${k}`)} error={touched ? errors[k] : undefined} hint={k === 'iban' ? 'EG + 27' : undefined}>
              {(id) => <Input id={id} dir={['iban', 'accountNumber', 'walletPhone', 'instapayAddress'].includes(k) ? 'ltr' : undefined} className={k === 'iban' ? 'font-mono' : ''} value={details[k] ?? ''} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} />}
            </Field>
          ))}
        </div>
        {method === 'CASH' && <p className="text-sm text-ink-500">{t('brand.settings.cashHint')}</p>}
        {owner && <div className="flex justify-end"><Button loading={save.isPending} onClick={submit}>{t('action.save')}</Button></div>}
      </fieldset>
    </Card>
  );
}

function Locations() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useLocations();
  const manage = can('pickups.manage');
  const [edit, setEdit] = useState<BrandLocation | 'new' | null>(null);
  const [del, setDel] = useState<BrandLocation | null>(null);
  const inv = () => { qc.invalidateQueries({ queryKey: ['brand'] }); };
  const makeDefault = useMutation({ mutationFn: (l: BrandLocation) => api(`/brands/me/locations/${l.id}`, { method: 'PATCH', body: { isDefault: true } }), onSuccess: () => { inv(); toast.success(t('brand.common.saved')); }, onError: (e) => toast.error(errorMessage(e)) });
  const toggle = useMutation({ mutationFn: (l: BrandLocation) => api(`/brands/me/locations/${l.id}`, { method: 'PATCH', body: { isActive: !l.isActive } }), onSuccess: inv, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (l: BrandLocation) => api(`/brands/me/locations/${l.id}`, { method: 'DELETE' }), onSuccess: () => { setDel(null); inv(); toast.success(t('brand.settings.locationDeleted')); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle icon={<MapPin />} title={t('brand.settings.locationsTitle')} subtitle={t('brand.settings.locationsHint')} actions={manage && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('brand.settings.addLocation')}</Button>} />
      </Card>
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !q.data?.length ? (
        <Card><EmptyState icon={<MapPin className="h-7 w-7" />} title={t('brand.settings.noLocations')} description={t('brand.pickups.noLocation')} action={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('brand.settings.addLocation')}</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((l) => (
            <Card key={l.id} padded={false} className={cn('overflow-hidden', !l.isActive && 'opacity-60')}>
              <Suspense fallback={<Skeleton className="h-36 w-full rounded-none" />}>
                {l.lat != null && l.lng != null ? <PinMap value={{ lat: l.lat, lng: l.lng }} height={140} className="rounded-none border-0" /> : <div className="grid h-[140px] place-items-center bg-ink-50 text-sm text-ink-400 dark:bg-ink-800/50">{t('brand.settings.noPin')}</div>}
              </Suspense>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink-900 dark:text-white">{l.name}</p>
                  <div className="flex gap-1">
                    {l.isDefault && <Badge tone="success"><Star className="h-3 w-3" />{t('brand.settings.default')}</Badge>}
                    {!l.isActive && <Badge>{t('brand.settings.inactive')}</Badge>}
                  </div>
                </div>
                <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{l.addressLine}</p>
                <p className="text-xs text-ink-500">{nameOf(l.zone, locale)}</p>
                <p className="mt-2 text-xs text-ink-500">{l.contactName} · <Ltr>{phone(l.phone)}</Ltr></p>
                {manage && (
                  <div className="mt-3 flex flex-wrap gap-1 border-t border-ink-100 pt-3 dark:border-ink-800">
                    <Button size="xs" variant="ghost" icon={<Pencil className="h-3 w-3" />} onClick={() => setEdit(l)}>{t('action.edit')}</Button>
                    {!l.isDefault && l.isActive && <Button size="xs" variant="ghost" icon={<Star className="h-3 w-3" />} onClick={() => makeDefault.mutate(l)}>{t('brand.settings.makeDefault')}</Button>}
                    {!l.isDefault && <Button size="xs" variant="ghost" onClick={() => toggle.mutate(l)}>{l.isActive ? t('brand.settings.deactivate') : t('brand.settings.activate')}</Button>}
                    {!l.isDefault && <Button size="xs" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDel(l)}>{t('action.delete')}</Button>}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <LocationModal loc={edit} onClose={() => setEdit(null)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} danger title={t('brand.settings.deleteLocation', { name: del?.name ?? '' })} description={t('brand.settings.deleteLocationBody')} confirmLabel={t('action.delete')} />
    </div>
  );
}

function LocationModal({ loc, onClose }: { loc: BrandLocation | 'new' | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const qc = useQueryClient();
  const zones = useZones();
  const isNew = loc === 'new';
  const blank = { name: '', contactName: me?.name ?? '', phone: me?.phone?.replace(/^\+20/, '0') ?? '', addressLine: '', zoneId: '', pin: null as { lat: number; lng: number } | null, isDefault: false };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!loc) return;
    setTouched(false);
    setF(loc === 'new' ? blank : { name: loc.name, contactName: loc.contactName, phone: loc.phone.replace(/^\+20/, '0'), addressLine: loc.addressLine, zoneId: loc.zoneId, pin: loc.lat != null && loc.lng != null ? { lat: loc.lat, lng: loc.lng } : null, isDefault: loc.isDefault });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc]);
  const detect = useMutation({
    mutationFn: () => api<DetectZoneResult>('/network/detect-zone', { method: 'POST', body: { address: f.addressLine, lat: f.pin?.lat, lng: f.pin?.lng } }),
    onSuccess: (r) => (r.zone ? setF((s) => ({ ...s, zoneId: r.zone!.id, pin: s.pin ?? { lat: r.zone!.centerLat, lng: r.zone!.centerLng } })) : toast.error(t('error.ZONE_NOT_DETECTED'))),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const errors = {
    name: f.name.trim().length < 2 ? t('brand.new.errName') : undefined,
    contactName: f.contactName.trim().length < 2 ? t('brand.new.errName') : undefined,
    phone: !normalizeEgyptPhone(f.phone) ? t('error.INVALID_PHONE') : undefined,
    addressLine: f.addressLine.trim().length < 5 ? t('brand.new.errAddress') : undefined,
    zoneId: !f.zoneId ? t('brand.new.errZone') : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), contactName: f.contactName.trim(), phone: f.phone, addressLine: f.addressLine.trim(), zoneId: f.zoneId, lat: f.pin?.lat ?? (isNew ? undefined : null), lng: f.pin?.lng ?? (isNew ? undefined : null), isDefault: f.isDefault };
      return isNew ? api('/brands/me/locations', { method: 'POST', body }) : api(`/brands/me/locations/${(loc as BrandLocation).id}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      toast.success(t('brand.common.saved'));
      qc.invalidateQueries({ queryKey: ['brand'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  return (
    <Modal open={!!loc} onClose={onClose} size="lg" title={isNew ? t('brand.settings.addLocation') : t('brand.settings.editLocation')} footer={<><Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button loading={m.isPending} onClick={() => { setTouched(true); if (valid) m.mutate(); }}>{t('action.save')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('brand.settings.locationName')} required error={err('name')}>{(id) => <Input id={id} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('brand.settings.locationNamePh')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('brand.settings.contactName')} required error={err('contactName')}>{(id) => <Input id={id} maxLength={120} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />}</Field>
          <Field label={t('common.phone')} required error={err('phone')}>{(id) => <Input id={id} dir="ltr" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        </div>
        <Field label={t('common.address')} required error={err('addressLine')}>{(id) => <Input id={id} maxLength={500} value={f.addressLine} onChange={(e) => setF({ ...f, addressLine: e.target.value })} />}</Field>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label={t('common.zone')} required error={err('zoneId')} className="flex-1">
            {(id) => <Select id={id} value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })} placeholder={t('brand.new.chooseZone')} options={(zones.data ?? []).map((z) => ({ value: z.id, label: `${nameOf(z, locale)} · ${nameOf(z.city, locale)}` })).sort((a, b) => a.label.localeCompare(b.label, locale))} />}
          </Field>
          <Button variant="outline" icon={<Crosshair className="h-4 w-4" />} loading={detect.isPending} disabled={f.addressLine.trim().length < 3} onClick={() => detect.mutate()}>{t('brand.settings.detect')}</Button>
        </div>
        <div>
          <Suspense fallback={<Skeleton className="h-56 w-full" />}>
            <PinMap value={f.pin} onChange={(p) => setF({ ...f, pin: p })} height={230} />
          </Suspense>
          <p className="mt-1 text-xs text-ink-500">{t('brand.new.pinHint')}</p>
        </div>
        <Switch checked={f.isDefault} onChange={(v) => setF({ ...f, isDefault: v })} label={t('brand.settings.setDefault')} />
      </div>
    </Modal>
  );
}
