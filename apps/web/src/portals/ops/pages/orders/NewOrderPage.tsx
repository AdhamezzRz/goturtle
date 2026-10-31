import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, MapPin, PackagePlus, Printer, Sparkles, Wand2 } from 'lucide-react';
import { isValidEgyptPhone, type FeesPayer, type OrderType, type PaymentMethod, type ServiceLevel } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { cairoToday, money, num, parseEgp, pct } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, Field, Input, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { LinkButton, Mono, NoAccess, SectionCard } from '../../components/opsa/ui';
import { useBrands, useZones } from '../../components/opsa/lookups';
import type { ZoneRow } from '../../components/opsa/types';
import './i18n';

interface DetectResult { match: { zoneId: string; code: string; confidence: number; method: string; matched: string } | null; zone: ZoneRow | null; hint?: string }
interface QuoteResult {
  zone: ZoneRow;
  plan: { id: string; name: string };
  input: { tier: string; feesPaidBy: FeesPayer };
  quote: { shippingFeeCents: number; codFeeCents: number; extraFeesCents: number; vatCents: number; totalFeesCents: number; collectFromRecipientCents: number; netToBrandCents: number; breakdown: Array<{ key: string; cents: number }> };
}
interface Location { id: string; name: string; addressLine: string; isDefault: boolean; isActive: boolean }
interface Created { id: string; trackingNumber: string; status: string; totalFeesCents: number; collectCents: number; riskScore: number }

const EMPTY = {
  brandId: '', brandReference: '', pickupLocationId: '',
  name: '', phone: '', altPhone: '',
  line: '', building: '', floor: '', apartment: '', landmark: '', zoneId: '',
  description: '', items: '1', weight: '1', declared: '', fragile: false, allowOpening: true, serviceLevel: 'STANDARD' as ServiceLevel, type: 'DELIVERY' as OrderType, scheduledDate: '', otp: false,
  paymentMethod: 'COD' as PaymentMethod, cod: '', feesPaidBy: 'BRAND' as FeesPayer, notes: '',
};

export default function NewOrderPage() {
  const { t, locale, dir } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const brands = useBrands();
  const zones = useZones();
  const [v, setV] = useState(EMPTY);
  const [touched, setTouched] = useState(false);
  const [manualZone, setManualZone] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;

  const brand = brands.data?.find((b) => b.id === v.brandId);
  useEffect(() => {
    if (brand) setV((p) => ({ ...p, feesPaidBy: brand.defaultFeesPaidBy, allowOpening: brand.allowOpenPackage, pickupLocationId: '' }));
  }, [brand]);

  const locations = useQuery({ queryKey: ['brands', v.brandId, 'locations'], queryFn: () => api<Location[]>(`/brands/${v.brandId}/locations`), enabled: !!v.brandId && can('brands.read') });

  // live zone detection (debounced)
  const detectText = useDebounced(v.line.trim(), 500);
  const detect = useQuery({
    queryKey: ['network', 'detect', detectText],
    queryFn: () => api<DetectResult>('/network/detect-zone', { method: 'POST', body: { address: detectText } }),
    enabled: detectText.length >= 5 && !manualZone,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (manualZone || !detect.data) return;
    set('zoneId', detect.data.match?.zoneId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detect.data, manualZone]);

  // live fee quote (debounced)
  const codCents = v.paymentMethod === 'PREPAID' ? 0 : parseEgp(v.cod) ?? 0;
  const quoteInput = useDebounced(
    useMemo(() => ({
      zoneId: v.zoneId || undefined, brandId: v.brandId || undefined, serviceLevel: v.serviceLevel, type: v.type,
      weightGrams: Math.max(1, Math.round((Number(v.weight) || 1) * 1000)), paymentMethod: v.paymentMethod, codAmountCents: codCents,
      declaredValueCents: parseEgp(v.declared) ?? 0, feesPaidBy: v.feesPaidBy,
    }), [v.zoneId, v.brandId, v.serviceLevel, v.type, v.weight, v.paymentMethod, codCents, v.declared, v.feesPaidBy]),
    350,
  );
  const quote = useQuery({ queryKey: ['pricing', 'quote', quoteInput], queryFn: () => api<QuoteResult>('/pricing/quote', { method: 'POST', body: quoteInput }), enabled: !!quoteInput.zoneId, retry: false });

  const errors: Record<string, string> = {};
  if (!v.brandId) errors.brandId = t('ops.opsa.required');
  if (v.name.trim().length < 2) errors.name = t('ops.orders.create.minName');
  if (!isValidEgyptPhone(v.phone)) errors.phone = t('ops.opsa.invalidPhone');
  if (v.altPhone && !isValidEgyptPhone(v.altPhone)) errors.altPhone = t('ops.opsa.invalidPhone');
  if (v.line.trim().length < 5) errors.line = t('ops.orders.create.minLine');
  if (!v.zoneId) errors.zoneId = t('ops.orders.create.zoneRequired');
  if (v.paymentMethod === 'COD' && (parseEgp(v.cod) ?? 0) <= 0) errors.cod = t('ops.orders.create.codRequired');
  const err = (k: string) => (touched ? errors[k] : undefined);

  const create = useMutation({
    mutationFn: () =>
      api<Created>('/orders', {
        method: 'POST',
        body: {
          brandId: v.brandId,
          brandReference: v.brandReference || undefined,
          type: v.type,
          serviceLevel: v.serviceLevel,
          recipient: { name: v.name.trim(), phone: v.phone, altPhone: v.altPhone || undefined },
          address: { line: v.line.trim(), building: v.building || undefined, floor: v.floor || undefined, apartment: v.apartment || undefined, landmark: v.landmark || undefined, zoneId: v.zoneId },
          package: {
            description: v.description || undefined, itemsCount: Math.max(1, Number(v.items) || 1), weightGrams: Math.max(1, Math.round((Number(v.weight) || 1) * 1000)),
            isFragile: v.fragile, allowOpening: v.allowOpening, declaredValueCents: parseEgp(v.declared) ?? 0,
          },
          paymentMethod: v.paymentMethod,
          codAmountCents: codCents,
          feesPaidBy: v.feesPaidBy,
          pickupLocationId: v.pickupLocationId || undefined,
          scheduledDate: v.scheduledDate || undefined,
          notes: v.notes || undefined,
          deliveryOtpRequired: v.otp,
        },
      }),
    onSuccess: (r) => {
      setCreated(r);
      toast.success(t('ops.orders.create.success'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) {
      toast.error(t('ops.orders.create.fixErrors'));
      return;
    }
    create.mutate();
  };

  if (!can('orders.create')) return <NoAccess />;

  if (created) {
    return (
      <div className="mx-auto max-w-xl py-6">
        <div className="rounded-3xl border border-turtle-200 bg-white p-6 text-center shadow-card dark:border-turtle-900 dark:bg-ink-900 sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-turtle-50 text-turtle-600 dark:bg-turtle-950 dark:text-turtle-300"><CheckCircle2 className="h-9 w-9" /></div>
          <h1 className="mt-4 font-display text-2xl font-bold">{t('ops.orders.create.success')}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('ops.orders.col.tracking')}</p>
          <p className="mt-2"><Mono className="text-2xl font-bold text-ink-900 dark:text-white">{created.trackingNumber}</Mono></p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-start">
            <div className="rounded-xl bg-sand-50 p-3 dark:bg-sand-900/30"><p className="text-xs text-sand-800 dark:text-sand-200">{t('ops.orders.create.collectFromRecipient')}</p><p className="font-display text-lg font-bold"><span className="ltr">{money(created.collectCents)}</span></p></div>
            <div className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800/60"><p className="text-xs text-ink-500">{t('ops.orders.detail.fee.total')}</p><p className="font-display text-lg font-bold"><span className="ltr">{money(created.totalFeesCents)}</span></p></div>
          </div>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <LinkButton to={`/ops/orders/labels?ids=${created.id}`} variant="primary" size="md" icon={<Printer />}>{t('ops.orders.detail.label')}</LinkButton>
            <LinkButton to={`/ops/orders/${created.id}`} size="md">{t('ops.orders.create.view')}</LinkButton>
            <Button variant="ghost" icon={<PackagePlus className="h-4 w-4" />} onClick={() => { setCreated(null); setTouched(false); setManualZone(false); setV({ ...EMPTY, brandId: v.brandId, feesPaidBy: v.feesPaidBy, allowOpening: v.allowOpening, pickupLocationId: v.pickupLocationId }); }}>{t('ops.orders.create.another')}</Button>
          </div>
        </div>
      </div>
    );
  }

  const zoneOptions = (zones.data ?? []).filter((z) => z.isActive).map((z) => ({ value: z.id, label: `${locale === 'ar' ? z.nameAr : z.nameEn} · ${z.code}` }));
  const zone = zones.data?.find((z) => z.id === v.zoneId);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div>
        <Link to="/ops/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"><Back className="h-4 w-4" /> {t('ops.orders.detail.back')}</Link>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{t('ops.orders.create.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('ops.orders.create.subtitle')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Step n={1} title={t('ops.orders.create.s.brand')}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('ops.orders.create.brand')} required error={err('brandId')} className="sm:col-span-1">
                {(id) => brands.isLoading ? <Skeleton className="h-10" /> : <Select id={id} value={v.brandId} onChange={(e) => set('brandId', e.target.value)} placeholder={t('ops.orders.create.pickBrand')} options={(brands.data ?? []).filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.id, label: `${b.name} · ${b.code}` }))} />}
              </Field>
              <Field label={t('ops.orders.detail.pickupFrom')}>
                {(id) => <Select id={id} value={v.pickupLocationId} disabled={!v.brandId} onChange={(e) => set('pickupLocationId', e.target.value)} placeholder="—" options={(locations.data ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: `${l.name}${l.isDefault ? ' ★' : ''}` }))} />}
              </Field>
              <Field label={t('ops.orders.create.reference')} hint={t('ops.opsa.optional')}>{(id) => <Input id={id} value={v.brandReference} onChange={(e) => set('brandReference', e.target.value)} className="ltr" maxLength={100} />}</Field>
            </div>
          </Step>

          <Step n={2} title={t('ops.orders.create.s.recipient')}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('ops.orders.create.name')} required error={err('name')}>{(id) => <Input id={id} value={v.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" maxLength={150} />}</Field>
              <Field label={t('ops.orders.create.phone')} required error={err('phone')}>{(id) => <Input id={id} value={v.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" placeholder="01XXXXXXXXX" className="ltr" invalid={!!err('phone')} />}</Field>
              <Field label={t('ops.orders.create.altPhone')} error={err('altPhone')}>{(id) => <Input id={id} value={v.altPhone} onChange={(e) => set('altPhone', e.target.value)} inputMode="tel" className="ltr" />}</Field>
            </div>
          </Step>

          <Step n={3} title={t('ops.orders.create.s.address')}>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={t('ops.orders.create.line')} required error={err('line')} className="sm:col-span-4">
                {(id) => <Input id={id} value={v.line} onChange={(e) => set('line', e.target.value)} placeholder={t('ops.orders.create.linePh')} leading={<MapPin className="h-4 w-4" />} invalid={!!err('line')} />}
              </Field>
              <Field label={t('ops.orders.create.building')}>{(id) => <Input id={id} value={v.building} onChange={(e) => set('building', e.target.value)} />}</Field>
              <Field label={t('ops.orders.create.floor')}>{(id) => <Input id={id} value={v.floor} onChange={(e) => set('floor', e.target.value)} />}</Field>
              <Field label={t('ops.orders.create.apartment')}>{(id) => <Input id={id} value={v.apartment} onChange={(e) => set('apartment', e.target.value)} />}</Field>
              <Field label={t('ops.orders.create.landmark')}>{(id) => <Input id={id} value={v.landmark} onChange={(e) => set('landmark', e.target.value)} />}</Field>
              <div className="sm:col-span-4">
                <Field label={t('ops.orders.create.zone')} required error={err('zoneId')}>
                  {(id) => (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Select id={id} value={v.zoneId} onChange={(e) => { setManualZone(true); set('zoneId', e.target.value); }} placeholder="—" options={zoneOptions} className="sm:max-w-xs" />
                      {manualZone && (
                        <Button type="button" variant="ghost" size="sm" icon={<Wand2 className="h-4 w-4" />} onClick={() => setManualZone(false)}>{t('ops.orders.create.zoneAuto')}</Button>
                      )}
                    </div>
                  )}
                </Field>
                <ZoneHint detecting={detect.isFetching} result={manualZone ? null : detect.data} manual={manualZone} zone={zone} enabled={detectText.length >= 5} />
              </div>
            </div>
          </Step>

          <Step n={4} title={t('ops.orders.create.s.package')}>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={t('ops.orders.create.description')} className="sm:col-span-2">{(id) => <Input id={id} value={v.description} onChange={(e) => set('description', e.target.value)} maxLength={500} />}</Field>
              <Field label={t('ops.orders.create.items')}>{(id) => <Input id={id} type="number" min={1} max={999} value={v.items} onChange={(e) => set('items', e.target.value)} className="ltr" />}</Field>
              <Field label={t('ops.orders.create.weight')}>{(id) => <Input id={id} type="number" min={0.1} step={0.1} value={v.weight} onChange={(e) => set('weight', e.target.value)} className="ltr" />}</Field>
              <Field label={t('ops.orders.create.service')}>
                {(id) => <Select id={id} value={v.serviceLevel} onChange={(e) => set('serviceLevel', e.target.value as ServiceLevel)} options={['STANDARD', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'].map((s) => ({ value: s, label: t(`ops.opsa.service.${s}`) }))} />}
              </Field>
              <Field label={t('ops.orders.create.type')}>
                {(id) => <Select id={id} value={v.type} onChange={(e) => set('type', e.target.value as OrderType)} options={['DELIVERY', 'EXCHANGE', 'RETURN', 'CASH_COLLECTION'].map((s) => ({ value: s, label: t(`ops.opsa.type.${s}`) }))} />}
              </Field>
              <Field label={t('ops.orders.create.scheduled')} hint={t('ops.opsa.optional')}>{(id) => <Input id={id} type="date" min={cairoToday()} value={v.scheduledDate} onChange={(e) => set('scheduledDate', e.target.value)} className="ltr" />}</Field>
              <Field label={t('ops.orders.create.declared')} hint={t('ops.opsa.optional')}>{(id) => <Input id={id} inputMode="decimal" value={v.declared} onChange={(e) => set('declared', e.target.value)} className="ltr" />}</Field>
              <div className="flex flex-wrap gap-x-6 gap-y-3 sm:col-span-4">
                <Switch checked={v.fragile} onChange={(x) => set('fragile', x)} label={t('ops.orders.create.fragile')} />
                <Switch checked={v.allowOpening} onChange={(x) => set('allowOpening', x)} label={t('ops.orders.create.allowOpen')} />
                <Switch checked={v.otp} onChange={(x) => set('otp', x)} label={t('ops.orders.create.otp')} />
              </div>
            </div>
          </Step>

          <Step n={5} title={t('ops.orders.create.s.payment')}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('ops.orders.create.method')}>
                {(id) => <Select id={id} value={v.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value as PaymentMethod)} options={['COD', 'PREPAID'].map((s) => ({ value: s, label: t(`ops.opsa.payment.${s}`) }))} />}
              </Field>
              <Field label={t('ops.orders.create.cod')} required={v.paymentMethod === 'COD'} error={err('cod')}>
                {(id) => <Input id={id} inputMode="decimal" disabled={v.paymentMethod === 'PREPAID'} value={v.paymentMethod === 'PREPAID' ? '0' : v.cod} onChange={(e) => set('cod', e.target.value)} className="ltr" invalid={!!err('cod')} />}
              </Field>
              <Field label={t('ops.orders.create.payer')}>
                {(id) => <Select id={id} value={v.feesPaidBy} onChange={(e) => set('feesPaidBy', e.target.value as FeesPayer)} options={['BRAND', 'RECIPIENT'].map((s) => ({ value: s, label: t(`ops.opsa.payer.${s}`) }))} />}
              </Field>
              <Field label={t('ops.orders.create.notes')} className="sm:col-span-3">{(id) => <Textarea id={id} value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />}</Field>
            </div>
          </Step>
        </div>

        {/* quote */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionCard title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-sand-500" />{t('ops.orders.create.quote')}</span>} subtitle={t('ops.orders.create.quoteHint')}>
            {!v.zoneId ? (
              <p className="text-sm text-ink-500">{t('ops.orders.create.quoteNeedZone')}</p>
            ) : quote.isLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
            ) : quote.error ? (
              <p className="text-sm text-red-600">{errorMessage(quote.error)}</p>
            ) : quote.data ? (
              <div className={cn('space-y-3 transition-opacity', quote.isFetching && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <Badge tone="info">{t('ops.orders.create.plan', { p: quote.data.plan.name, t: quote.data.input.tier })}</Badge>
                  <span>{locale === 'ar' ? quote.data.zone.nameAr : quote.data.zone.nameEn}</span>
                </div>
                <dl className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
                  {quote.data.quote.breakdown.map((b) => (
                    <div key={b.key} className="flex justify-between py-1.5">
                      <dt className="text-ink-500">{t(`ops.orders.detail.fee.${['shipping', 'cod', 'weight', 'insurance', 'exchange', 'vat'].includes(b.key) ? b.key : 'extra'}`)}</dt>
                      <dd><span className="ltr">{money(b.cents)}</span></dd>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 font-semibold">
                    <dt>{t('ops.orders.detail.fee.total')}</dt>
                    <dd className="font-display text-lg"><span className="ltr">{money(quote.data.quote.totalFeesCents)}</span></dd>
                  </div>
                </dl>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-sand-50 p-3 dark:bg-sand-900/30">
                    <p className="text-[11px] text-sand-800 dark:text-sand-200">{t('ops.orders.create.collectFromRecipient')}</p>
                    <p className="font-display font-bold"><span className="ltr">{money(quote.data.quote.collectFromRecipientCents)}</span></p>
                  </div>
                  <div className="rounded-xl bg-turtle-50 p-3 dark:bg-turtle-950/50">
                    <p className="text-[11px] text-turtle-800 dark:text-turtle-200">{t('ops.orders.detail.netToBrand')}</p>
                    <p className="font-display font-bold"><span className="ltr">{money(quote.data.quote.netToBrandCents)}</span></p>
                  </div>
                </div>
              </div>
            ) : null}
            <Button type="submit" block size="lg" className="mt-5" loading={create.isPending} icon={<PackagePlus className="h-5 w-5" />}>{t('ops.orders.create.submit')}</Button>
            <Button type="button" variant="ghost" block className="mt-2" onClick={() => navigate('/ops/orders')}>{t('action.cancel')}</Button>
          </SectionCard>
        </div>
      </div>
    </form>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <SectionCard title={<span className="flex items-center gap-2.5"><span className="ltr grid h-6 w-6 place-items-center rounded-full bg-turtle-600 text-xs font-bold text-white">{n}</span>{title}</span>}>
      {children}
    </SectionCard>
  );
}

function ZoneHint({ detecting, result, manual, zone, enabled }: { detecting: boolean; result?: DetectResult | null; manual: boolean; zone?: ZoneRow; enabled: boolean }) {
  const { t, locale } = useI18n();
  if (manual) return zone ? <p className="mt-1.5 text-xs text-ink-500">{t('ops.orders.create.manual')} · {t('ops.opsa.tier', { t: zone.tier })} · {zone.hub?.code}</p> : null;
  if (!enabled) return null;
  if (detecting) return <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('ops.orders.create.detecting')}</p>;
  if (result?.match && result.zone) {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-turtle-700 dark:text-turtle-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t('ops.orders.create.detected', { zone: locale === 'ar' ? result.zone.nameAr : result.zone.nameEn, conf: pct(result.match.confidence, 0) })}
        <span className="text-ink-400">· {t('ops.opsa.tier', { t: result.zone.tier })} · <span className="ltr">{result.zone.hub?.code}</span> · SLA {t('ops.opsa.unit.h', { n: num(result.zone.slaHours) })}</span>
      </p>
    );
  }
  if (result) return <p className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">{t('ops.orders.create.notDetected')}</p>;
  return null;
}
