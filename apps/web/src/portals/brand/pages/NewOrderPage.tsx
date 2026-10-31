import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Banknote, CheckCircle2, ChevronUp, Clock, Copy, CreditCard, Crosshair, Info, Loader2, MapPin, Package, PackagePlus, Printer, Rocket, Settings2,
  ShieldCheck, Sparkles, Truck, User, Zap, CalendarDays, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { normalizeEgyptPhone, type FeesPayer, type OrderType, type PaymentMethod, type ServiceLevel } from '@goturtle/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDebounced } from '@/lib/hooks';
import { dateOnly, num, parseEgp, pct } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { copyText, Money, nameOf, Row, Segmented, SectionTitle, tomorrowCairo, useCanCreate, useLocations, useMyBrand, useZones } from '../components/common';
import type { DetectZoneResult, OrderDetail, QuoteResult, RateCard } from '../components/types';
import './i18n';

const PinMap = lazy(() => import('../components/PinMap'));

const LEVELS: Array<{ value: ServiceLevel; icon: React.ReactNode }> = [
  { value: 'STANDARD', icon: <Truck /> },
  { value: 'SAME_DAY', icon: <Zap /> },
  { value: 'EXPRESS', icon: <Rocket /> },
  { value: 'SCHEDULED', icon: <CalendarDays /> },
];

interface FormState {
  name: string; phone: string; altPhone: string;
  line: string; building: string; floor: string; apartment: string; landmark: string;
  zoneId: string; manualZone: boolean; pin: { lat: number; lng: number } | null;
  description: string; items: string; weight: string; fragile: boolean; allowOpening: boolean; type: OrderType;
  serviceLevel: ServiceLevel; scheduledDate: string;
  payment: PaymentMethod; cod: string; feesPaidBy: FeesPayer;
  pickupLocationId: string; reference: string; notes: string; otp: boolean;
}

const blank = (allowOpening = true, feesPaidBy: FeesPayer = 'BRAND', pickupLocationId = ''): FormState => ({
  name: '', phone: '', altPhone: '', line: '', building: '', floor: '', apartment: '', landmark: '', zoneId: '', manualZone: false, pin: null,
  description: '', items: '1', weight: '1', fragile: false, allowOpening, type: 'DELIVERY', serviceLevel: 'STANDARD', scheduledDate: tomorrowCairo(2),
  payment: 'COD', cod: '', feesPaidBy, pickupLocationId, reference: '', notes: '', otp: false,
});

export default function NewOrderPage() {
  const { t, locale } = useI18n();
  const create = useCanCreate();
  const brand = useMyBrand();
  const locations = useLocations();
  const zones = useZones();
  const rateCard = useQuery({ queryKey: ['pricing', 'rate-card'], queryFn: () => api<RateCard>('/pricing/rate-card'), staleTime: 10 * 60_000 });
  const [f, setF] = useState<FormState>(() => blank());
  const [touched, setTouched] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [created, setCreated] = useState<OrderDetail | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const bind = (k: keyof FormState) => ({ value: f[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value as never) });

  // Brand defaults once loaded
  useEffect(() => {
    if (!brand.data) return;
    const def = (locations.data ?? brand.data.locations).find((l) => l.isDefault && l.isActive) ?? (locations.data ?? brand.data.locations)[0];
    setF((s) => ({ ...s, allowOpening: brand.data.allowOpenPackage, feesPaidBy: brand.data.defaultFeesPaidBy, pickupLocationId: s.pickupLocationId || def?.id || '' }));
  }, [brand.data, locations.data]);

  // Live zone detection from the address text (and pin)
  const addrKey = useDebounced(`${f.line}|${f.pin?.lat ?? ''}|${f.pin?.lng ?? ''}`, 500);
  const detect = useQuery({
    queryKey: ['detect-zone', addrKey],
    queryFn: () => api<DetectZoneResult>('/network/detect-zone', { method: 'POST', body: { address: f.line.trim(), lat: f.pin?.lat, lng: f.pin?.lng } }),
    enabled: f.line.trim().length >= 4,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (!f.manualZone && detect.data) set('zoneId', detect.data.zone?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detect.data, f.manualZone]);

  const codCents = f.payment === 'COD' ? parseEgp(f.cod) : 0;
  const weightGrams = Math.round((Number(f.weight.replace(',', '.')) || 0) * 1000);
  const quoteInput = useDebounced(
    { zoneId: f.zoneId, serviceLevel: f.serviceLevel, type: f.type, weightGrams: Math.max(0, weightGrams), paymentMethod: f.payment, codAmountCents: codCents ?? 0, feesPaidBy: f.feesPaidBy },
    350,
  );
  const quote = useQuery({
    queryKey: ['quote', quoteInput],
    queryFn: () => api<QuoteResult>('/pricing/quote', { method: 'POST', body: quoteInput }),
    enabled: !!quoteInput.zoneId && weightGrams <= 100_000,
    staleTime: 60_000,
  });

  const zone = useMemo(() => zones.data?.find((z) => z.id === f.zoneId) ?? null, [zones.data, f.zoneId]);
  const tier = zone?.tier ?? detect.data?.zone?.tier;
  const levelPrice = (lvl: ServiceLevel) => {
    const rules = rateCard.data?.rules ?? [];
    if (tier) return rules.find((r) => r.tier === tier && r.serviceLevel === lvl)?.baseFeeCents ?? null;
    const all = rules.filter((r) => r.serviceLevel === lvl).map((r) => r.baseFeeCents);
    return all.length ? Math.min(...all) : null;
  };

  const errors = {
    name: f.name.trim().length < 2 ? t('brand.new.errName') : undefined,
    phone: !normalizeEgyptPhone(f.phone) ? (f.phone ? t('error.INVALID_PHONE') : t('brand.new.errPhone')) : undefined,
    altPhone: f.altPhone && !normalizeEgyptPhone(f.altPhone) ? t('error.INVALID_PHONE') : undefined,
    line: f.line.trim().length < 5 ? t('brand.new.errAddress') : undefined,
    zone: !f.zoneId ? t('brand.new.errZone') : undefined,
    weight: weightGrams <= 0 || weightGrams > 100_000 ? t('brand.new.errWeight') : undefined,
    items: !(Number(f.items) >= 1 && Number(f.items) <= 999) ? t('brand.new.errItems') : undefined,
    cod: f.payment === 'COD' && (codCents === null || codCents <= 0 || codCents > 10_000_000) ? t('brand.new.errCod') : undefined,
  };
  const firstError = Object.entries(errors).find(([, v]) => v);
  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined);

  const m = useMutation({
    mutationFn: () =>
      api<OrderDetail>('/orders', {
        method: 'POST',
        body: {
          brandReference: f.reference.trim() || null,
          type: f.type,
          serviceLevel: f.serviceLevel,
          recipient: { name: f.name.trim(), phone: f.phone, altPhone: f.altPhone || null },
          address: {
            line: f.line.trim(), building: f.building.trim() || null, floor: f.floor.trim() || null, apartment: f.apartment.trim() || null, landmark: f.landmark.trim() || null,
            zoneId: f.zoneId || null, lat: f.pin?.lat ?? null, lng: f.pin?.lng ?? null,
          },
          package: { description: f.description.trim() || null, itemsCount: Number(f.items), weightGrams, isFragile: f.fragile, allowOpening: f.allowOpening },
          paymentMethod: f.payment,
          codAmountCents: f.payment === 'COD' ? codCents ?? 0 : 0,
          feesPaidBy: f.feesPaidBy,
          pickupLocationId: f.pickupLocationId || null,
          scheduledDate: f.serviceLevel === 'SCHEDULED' ? f.scheduledDate : null,
          notes: f.notes.trim() || null,
          deliveryOtpRequired: f.otp,
        },
      }),
    onSuccess: (o) => {
      setCreated(o);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    setTouched(true);
    if (firstError) {
      toast.error(firstError[1]!);
      document.querySelector<HTMLElement>(`[name="${firstError[0]}"]`)?.focus();
      return;
    }
    m.mutate();
  };

  if (!create.allowed) {
    return (
      <div>
        <PageHeader title={t('brand.nav.newOrder')} />
        <Card><EmptyState icon={<PackagePlus className="h-7 w-7" />} title={t('brand.new.locked')} description={create.reason} action={<Link to="/brand"><Button variant="outline">{t('brand.nav.dashboard')}</Button></Link>} /></Card>
      </div>
    );
  }

  if (created) return <Success order={created} onAnother={() => { setCreated(null); setTouched(false); setShowPin(false); setF((s) => ({ ...blank(s.allowOpening, s.feesPaidBy, s.pickupLocationId), serviceLevel: s.serviceLevel })); }} />;

  const q = quote.data?.quote;
  const conf = detect.data?.match?.confidence ?? 0;
  const zoneOptions = (zones.data ?? []).map((z) => ({ value: z.id, label: `${nameOf(z, locale)} · ${nameOf(z.city, locale)}` })).sort((a, b) => a.label.localeCompare(b.label, locale));

  const quotePanel = (
    <QuotePanel
      loading={quote.isFetching && !q}
      hasZone={!!f.zoneId}
      error={quote.error}
      q={q}
      payment={f.payment}
      feesPaidBy={f.feesPaidBy}
      serviceLevel={f.serviceLevel}
      zoneLabel={zone ? nameOf(zone, locale) : null}
      submitting={m.isPending}
      onSubmit={submit}
    />
  );

  return (
    <div className="pb-28 lg:pb-0">
      <PageHeader title={t('brand.nav.newOrder')} subtitle={t('brand.new.subtitle')} actions={<Link to="/brand/orders/bulk"><Button variant="outline">{t('brand.new.manyOrders')}</Button></Link>} />
      <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <div className="min-w-0 space-y-6">
          {/* Recipient */}
          <Card>
            <SectionTitle icon={<User />} title={t('brand.new.recipient')} subtitle={t('brand.new.recipientHint')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('brand.new.name')} required error={err('name')} className="sm:col-span-2">
                {(id) => <Input id={id} name="name" autoComplete="off" maxLength={150} {...bind('name')} placeholder={t('brand.new.namePh')} invalid={!!err('name')} />}
              </Field>
              <Field label={t('common.phone')} required error={err('phone')} hint={normalizeEgyptPhone(f.phone) ? <span className="inline-flex items-center gap-1 text-turtle-700 dark:text-turtle-400"><CheckCircle2 className="h-3.5 w-3.5" /><span className="ltr">{normalizeEgyptPhone(f.phone)}</span></span> : t('brand.new.phoneHint')}>
                {(id) => <Input id={id} name="phone" dir="ltr" type="tel" inputMode="tel" autoComplete="off" maxLength={20} {...bind('phone')} placeholder="01X XXXX XXXX" invalid={!!err('phone')} />}
              </Field>
              <Field label={t('brand.new.altPhone')} error={err('altPhone')} hint={t('brand.common.optional')}>
                {(id) => <Input id={id} name="altPhone" dir="ltr" type="tel" inputMode="tel" maxLength={20} {...bind('altPhone')} invalid={!!err('altPhone')} />}
              </Field>
            </div>
          </Card>

          {/* Address */}
          <Card>
            <SectionTitle icon={<MapPin />} title={t('brand.new.address')} subtitle={t('brand.new.addressHint')} />
            <div className="space-y-4">
              <Field label={t('brand.new.addressLine')} required error={err('line')}>
                {(id) => <Textarea id={id} name="line" rows={2} maxLength={500} {...bind('line')} placeholder={t('brand.new.addressPh')} className={cn(err('line') && 'border-red-400')} />}
              </Field>

              {/* Zone detection */}
              <div className={cn('rounded-xl border p-3 transition', f.zoneId ? 'border-turtle-200 bg-turtle-50/60 dark:border-turtle-900 dark:bg-turtle-950/40' : err('zone') ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40' : 'border-dashed border-ink-200 dark:border-ink-700')}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-turtle-700 shadow-sm dark:bg-ink-900 dark:text-turtle-300">
                    {detect.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    {zone ? (
                      <>
                        <p className="text-sm font-semibold text-ink-900 dark:text-white">{nameOf(zone, locale)} <span className="font-normal text-ink-500">· {nameOf(zone.city, locale)}</span></p>
                        <p className="text-xs text-ink-500">
                          {f.manualZone ? t('brand.new.zoneManual') : t('brand.new.zoneDetected', { pct: pct(conf, 0) })}
                          {' · '}{t('brand.new.zoneSla', { h: num(zone.slaHours) })}
                        </p>
                      </>
                    ) : f.line.trim().length >= 4 && !detect.isFetching && detect.data && !detect.data.zone ? (
                      <p className="text-sm text-amber-800 dark:text-amber-300">{t('error.ZONE_NOT_DETECTED')}</p>
                    ) : (
                      <p className="text-sm text-ink-500">{t('brand.new.zoneWaiting')}</p>
                    )}
                    {err('zone') && !zone && <p className="text-xs font-medium text-red-600">{errors.zone}</p>}
                  </div>
                  {!f.manualZone && zone && conf < 0.7 && <Badge tone="warning">{t('brand.new.lowConfidence')}</Badge>}
                  {!f.manualZone && zone && conf >= 0.7 && <Badge tone="success">{pct(conf, 0)}</Badge>}
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    name="zone"
                    aria-label={t('brand.new.chooseZone')}
                    className="sm:max-w-xs"
                    value={f.zoneId}
                    onChange={(e) => setF((s) => ({ ...s, zoneId: e.target.value, manualZone: !!e.target.value }))}
                    options={zoneOptions}
                    placeholder={t('brand.new.chooseZone')}
                  />
                  {f.manualZone && (
                    <Button size="sm" variant="ghost" onClick={() => setF((s) => ({ ...s, manualZone: false, zoneId: detect.data?.zone?.id ?? '' }))}>{t('brand.new.useDetected')}</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Crosshair className="h-4 w-4" />} onClick={() => setShowPin((v) => !v)} className="sm:ms-auto">
                    {f.pin ? t('brand.new.pinSet') : t('brand.new.dropPin')}
                  </Button>
                </div>
              </div>

              {showPin && (
                <div>
                  <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                    <PinMap value={f.pin} onChange={(p) => set('pin', p)} center={detect.data?.zone ? { lat: detect.data.zone.centerLat, lng: detect.data.zone.centerLng } : null} height={280} />
                  </Suspense>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-500">
                    <span>{t('brand.new.pinHint')}</span>
                    {f.pin && <button type="button" className="font-medium text-red-600 hover:underline" onClick={() => set('pin', null)}>{t('brand.new.removePin')}</button>}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <Field label={t('brand.new.building')}>{(id) => <Input id={id} maxLength={50} {...bind('building')} />}</Field>
                <Field label={t('brand.new.floor')}>{(id) => <Input id={id} maxLength={20} {...bind('floor')} />}</Field>
                <Field label={t('brand.new.apartment')}>{(id) => <Input id={id} maxLength={20} {...bind('apartment')} />}</Field>
              </div>
              <Field label={t('brand.new.landmark')}>{(id) => <Input id={id} maxLength={200} {...bind('landmark')} placeholder={t('brand.new.landmarkPh')} />}</Field>
            </div>
          </Card>

          {/* Package */}
          <Card>
            <SectionTitle icon={<Package />} title={t('brand.new.package')} />
            <div className="grid gap-4 sm:grid-cols-6">
              <Field label={t('brand.new.description')} className="sm:col-span-6">{(id) => <Input id={id} maxLength={500} {...bind('description')} placeholder={t('brand.new.descriptionPh')} />}</Field>
              <Field label={t('brand.new.items')} required error={err('items')} className="sm:col-span-2">{(id) => <Input id={id} name="items" type="number" min={1} max={999} inputMode="numeric" {...bind('items')} />}</Field>
              <Field label={t('brand.new.weight')} required error={err('weight')} className="sm:col-span-2">
                {(id) => <Input id={id} name="weight" type="number" min={0.1} max={100} step={0.1} inputMode="decimal" {...bind('weight')} trailing={<span className="text-xs">{t('brand.new.kg')}</span>} />}
              </Field>
              <Field label={t('brand.new.type')} className="sm:col-span-2">
                {(id) => <Select id={id} value={f.type} onChange={(e) => set('type', e.target.value as OrderType)} options={(['DELIVERY', 'EXCHANGE', 'CASH_COLLECTION'] as const).map((v) => ({ value: v, label: t(`brand.type.${v}`) }))} />}
              </Field>
            </div>
            {rateCard.data && <p className="mt-2 text-xs text-ink-500">{t('brand.new.weightIncluded', { kg: num(rateCard.data.includedWeightGrams / 1000) })}</p>}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ToggleCard icon={<Package />} checked={f.fragile} onChange={(v) => set('fragile', v)} title={t('brand.new.fragile')} hint={t('brand.new.fragileHint')} />
              <ToggleCard icon={<Eye />} checked={f.allowOpening} onChange={(v) => set('allowOpening', v)} title={t('brand.new.allowOpening')} hint={t('brand.new.allowOpeningHint')} />
            </div>
          </Card>

          {/* Service level */}
          <Card>
            <SectionTitle icon={<Clock />} title={t('brand.new.service')} subtitle={zone ? t('brand.new.serviceFor', { zone: nameOf(zone, locale) }) : t('brand.new.serviceFrom')} />
            <div role="radiogroup" aria-label={t('brand.new.service')} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {LEVELS.map((l) => {
                const price = levelPrice(l.value);
                const active = f.serviceLevel === l.value;
                return (
                  <button
                    key={l.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => set('serviceLevel', l.value)}
                    className={cn(
                      'relative flex flex-col items-start gap-2 rounded-2xl border-2 p-3 text-start transition focus-visible:ring-2 focus-visible:ring-turtle-500 sm:p-4',
                      active ? 'border-turtle-500 bg-turtle-50/70 dark:bg-turtle-950/50' : 'border-ink-100 hover:border-ink-200 dark:border-ink-800 dark:hover:border-ink-700',
                    )}
                  >
                    <span className={cn('grid h-9 w-9 place-items-center rounded-xl [&>svg]:h-4 [&>svg]:w-4', active ? 'bg-turtle-600 text-white' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}>{l.icon}</span>
                    <span className="font-semibold text-ink-900 dark:text-white">{t(`brand.service.${l.value}`)}</span>
                    <span className="text-xs text-ink-500">{t(`brand.service.${l.value}.hint`)}</span>
                    <span className="mt-auto text-sm font-bold text-ink-900 dark:text-white">
                      {rateCard.isLoading ? <Skeleton className="h-4 w-16" /> : price !== null ? <>{!tier && <span className="text-xs font-normal text-ink-500">{t('brand.new.from')} </span>}<Money cents={price} /></> : '—'}
                    </span>
                    {active && <CheckCircle2 className="absolute end-3 top-3 h-5 w-5 text-turtle-600" />}
                  </button>
                );
              })}
            </div>
            {f.serviceLevel === 'SCHEDULED' && (
              <Field label={t('brand.new.scheduledDate')} className="mt-4 max-w-xs">
                {(id) => <Input id={id} type="date" min={tomorrowCairo(1)} max={tomorrowCairo(30)} value={f.scheduledDate} onChange={(e) => set('scheduledDate', e.target.value)} />}
              </Field>
            )}
          </Card>

          {/* Payment */}
          <Card>
            <SectionTitle icon={<Banknote />} title={t('brand.new.payment')} />
            <div className="space-y-4">
              <Segmented label={t('brand.new.payment')} className="w-full sm:w-auto" value={f.payment} onChange={(v) => set('payment', v)} options={[{ value: 'COD', label: <span className="inline-flex items-center gap-1.5"><Banknote className="h-4 w-4" />{t('brand.pay.COD')}</span> }, { value: 'PREPAID', label: <span className="inline-flex items-center gap-1.5"><CreditCard className="h-4 w-4" />{t('brand.pay.PREPAID')}</span> }]} />
              {f.payment === 'COD' ? (
                <Field label={t('brand.new.codAmount')} required error={err('cod')} hint={t('brand.new.codHint')}>
                  {(id) => <div dir="ltr" className="max-w-xs"><Input id={id} name="cod" inputMode="decimal" className="text-lg font-semibold" {...bind('cod')} placeholder="0" trailing={<span className="text-xs font-semibold">{t('common.egp')}</span>} invalid={!!err('cod')} /></div>}
                </Field>
              ) : (
                <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950 dark:text-sky-200">{t('brand.new.prepaidHint')}</p>
              )}
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('brand.new.feesPayer')}</p>
                <Segmented label={t('brand.new.feesPayer')} value={f.feesPaidBy} onChange={(v) => set('feesPaidBy', v)} options={[{ value: 'BRAND', label: t('brand.new.payerBrand') }, { value: 'RECIPIENT', label: t('brand.new.payerRecipient') }]} />
                <p className="mt-1.5 text-xs text-ink-500">{f.feesPaidBy === 'BRAND' ? t('brand.new.payerBrandHint') : t('brand.new.payerRecipientHint')}</p>
              </div>
            </div>
          </Card>

          {/* More */}
          <Card>
            <SectionTitle icon={<Settings2 />} title={t('brand.new.more')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('brand.pickups.location')}>
                {(id) => (
                  <Select id={id} {...bind('pickupLocationId')} options={(locations.data ?? brand.data?.locations ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: `${l.name}${l.isDefault ? ` · ${t('brand.settings.default')}` : ''}` }))} />
                )}
              </Field>
              <Field label={t('brand.new.reference')} hint={t('brand.new.referenceHint')}>{(id) => <Input id={id} dir="ltr" maxLength={100} {...bind('reference')} placeholder="#1042" />}</Field>
              <Field label={t('brand.new.notes')} hint={t('brand.new.notesHint')} className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} maxLength={1000} {...bind('notes')} />}</Field>
            </div>
            <div className="mt-4">
              <ToggleCard icon={<ShieldCheck />} checked={f.otp} onChange={(v) => set('otp', v)} title={t('brand.new.otp')} hint={t('brand.new.otpHint')} />
            </div>
          </Card>
        </div>

        {/* Quote — sticky panel on desktop */}
        <aside className="hidden lg:block">
          <div className="sticky top-20">{quotePanel}</div>
        </aside>
      </form>

      {/* Mobile bottom sheet bar */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-ink-100 bg-white/95 px-4 pt-3 backdrop-blur dark:border-ink-800 dark:bg-ink-900/95 lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button type="button" onClick={() => setSheet(true)} className="min-w-0 flex-1 text-start" aria-label={t('brand.new.quote')}>
            <span className="flex items-center gap-1 text-xs text-ink-500">{t('brand.new.totalFees')} <ChevronUp className="h-3.5 w-3.5" /></span>
            <span className="block truncate font-display text-lg font-bold text-ink-900 dark:text-white">{q ? <Money cents={q.totalFeesCents} /> : quote.isFetching ? '…' : '—'}</span>
          </button>
          <Button size="lg" loading={m.isPending} onClick={submit} icon={<PackagePlus className="h-5 w-5" />}>{t('brand.new.create')}</Button>
        </div>
      </div>
      <Modal open={sheet} onClose={() => setSheet(false)} title={t('brand.new.quote')}>
        {quotePanel}
      </Modal>
    </div>
  );
}

function ToggleCard({ icon, checked, onChange, title, hint }: { icon: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-3 transition', checked ? 'border-turtle-300 bg-turtle-50/50 dark:border-turtle-800 dark:bg-turtle-950/30' : 'border-ink-100 dark:border-ink-800')}>
      <span className="mt-0.5 text-ink-400 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900 dark:text-white">{title}</p>
        <p className="text-xs text-ink-500">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function QuotePanel({
  loading, hasZone, error, q, payment, feesPaidBy, serviceLevel, zoneLabel, submitting, onSubmit,
}: {
  loading: boolean; hasZone: boolean; error: unknown; q?: QuoteResult['quote']; payment: PaymentMethod; feesPaidBy: FeesPayer; serviceLevel: ServiceLevel; zoneLabel: string | null; submitting: boolean; onSubmit: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card className="overflow-hidden" padded={false}>
      <div className="bg-gradient-to-br from-ink-900 to-turtle-950 px-5 py-4 text-white">
        <p className="text-xs font-medium uppercase tracking-wider text-turtle-200/80">{t('brand.new.quote')}</p>
        <p className="mt-1 text-sm text-ink-200">{t(`brand.service.${serviceLevel}`)}{zoneLabel ? ` · ${zoneLabel}` : ''}</p>
        <p className="mt-2 font-display text-3xl font-bold">{q ? <Money cents={q.totalFeesCents} /> : '—'}</p>
        <p className="text-xs text-ink-300">{t('brand.new.totalFeesVat')}</p>
      </div>
      <div className="p-5">
        {!hasZone ? (
          <p className="flex items-start gap-2 text-sm text-ink-500"><Info className="mt-0.5 h-4 w-4 shrink-0" />{t('brand.new.quoteNeedsZone')}</p>
        ) : loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        ) : error ? (
          <p className="text-sm text-red-600">{errorMessage(error)}</p>
        ) : q ? (
          <div className="divide-y divide-ink-100 dark:divide-ink-800">
            <div className="pb-2">
              <Row muted label={t('brand.fee.shipping')} value={<Money cents={q.shippingFeeCents} />} />
              {payment === 'COD' && <Row muted label={t('brand.fee.cod')} value={<Money cents={q.codFeeCents} />} />}
              {q.extraFeesCents > 0 && <Row muted label={t('brand.fee.extra')} value={<Money cents={q.extraFeesCents} />} />}
              <Row muted label={t('brand.fee.vat')} value={<Money cents={q.vatCents} />} />
              <Row label={t('brand.new.totalFees')} value={<Money cents={q.totalFeesCents} />} className="font-medium" />
            </div>
            <div className="pt-2">
              <Row label={t('brand.new.customerPays')} value={<Money cents={q.collectFromRecipientCents} className="font-semibold" />} />
              <Row strong label={t('brand.new.brandReceives')} value={<Money cents={q.netToBrandCents} className={q.netToBrandCents < 0 ? 'text-red-600' : 'text-turtle-700 dark:text-turtle-400'} />} />
              <p className="mt-1 text-xs text-ink-500">{feesPaidBy === 'BRAND' ? t('brand.new.payerBrandHint') : t('brand.new.payerRecipientHint')}</p>
            </div>
          </div>
        ) : null}
        <Button block size="lg" className="mt-5" loading={submitting} onClick={onSubmit} icon={<PackagePlus className="h-5 w-5" />}>{t('brand.new.create')}</Button>
      </div>
    </Card>
  );
}

function Success({ order, onAnother }: { order: OrderDetail; onAnother: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-xl py-6">
      <Card className="overflow-hidden text-center" padded={false}>
        <div className="bg-gradient-to-br from-turtle-600 to-turtle-800 px-6 pb-8 pt-10 text-white">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15 ring-8 ring-white/10"><CheckCircle2 className="h-9 w-9" /></span>
          <h1 className="mt-4 font-display text-2xl font-bold">{t('brand.new.successTitle')}</h1>
          <p className="mt-1 text-sm text-turtle-50/90">{t('brand.new.successHint')}</p>
        </div>
        <div className="space-y-5 p-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-400">{t('brand.orders.col.tracking')}</p>
            <div className="mt-1 flex items-center justify-center gap-2">
              <span className="ltr font-mono text-2xl font-bold tracking-wider text-ink-900 dark:text-white">{order.trackingNumber}</span>
              <button type="button" onClick={() => copyText(order.trackingNumber, t('action.copied'))} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800" aria-label={t('action.copy')}><Copy className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60"><p className="text-xs text-ink-500">{t('brand.new.customerPays')}</p><Money cents={order.collectCents} className="font-semibold" /></div>
            <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60"><p className="text-xs text-ink-500">{t('brand.new.totalFees')}</p><Money cents={order.totalFeesCents} className="font-semibold" /></div>
            {order.promisedBy && <div className="col-span-2 rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60"><p className="text-xs text-ink-500">{t('brand.order.promised')}</p><p className="font-semibold">{dateOnly(order.promisedBy)}</p></div>}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => navigate(`/brand/orders/labels?ids=${order.id}`)}>{t('brand.order.printLabel')}</Button>
            <Button variant="outline" onClick={() => navigate(`/brand/orders/${order.id}`)}>{t('brand.new.viewOrder')}</Button>
            <Button icon={<PackagePlus className="h-4 w-4" />} onClick={onAnother}>{t('brand.new.another')}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
