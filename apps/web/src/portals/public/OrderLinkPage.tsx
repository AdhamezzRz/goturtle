import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Banknote, Building2, CheckCircle2, ChevronDown, Clock, Copy, Crosshair, Loader2, LockKeyhole, MapPin, PackageCheck, PackageOpen, ShieldCheck,
  ShoppingBag, Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import { normalizeEgyptPhone } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDebounced } from '@/lib/hooks';
import { money, num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input, Select, Skeleton, Textarea } from '@/components/ui';
import { CustomerShell, Panel } from '@/portals/customer/components';
import type { DetectResult, LinkQuote, PlacedOrder, PublicLink, ZoneOption } from '@/features/intake/types';
import '@/features/intake/i18n';

const PinMap = lazy(() => import('@/portals/brand/components/PinMap'));

type Form = { name: string; phone: string; altPhone: string; addressLine: string; building: string; floor: string; apartment: string; landmark: string; notes: string; website: string };
const BLANK: Form = { name: '', phone: '', altPhone: '', addressLine: '', building: '', floor: '', apartment: '', landmark: '', notes: '', website: '' };

/**
 * /o/:code — the buyer's checkout for a social-seller order link (Instagram /
 * Facebook / WhatsApp). Mobile-first, Arabic-first: items & total, name, phone,
 * address with live zone detection and an optional map pin, then a success
 * screen with the tracking link.
 */
export default function OrderLinkPage() {
  const { code = '' } = useParams();
  const { t } = useI18n();
  const link = useQuery({
    queryKey: ['public-link', code],
    queryFn: () => api<PublicLink>(`/public/order-links/${encodeURIComponent(code)}`, { auth: 'none' }),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    staleTime: 60_000,
  });
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);

  useEffect(() => {
    if (link.data) document.title = `${link.data.title} · ${link.data.brand.name}`;
  }, [link.data]);

  if (link.isLoading) {
    return (
      <CustomerShell>
        <div className="space-y-4"><Skeleton className="h-40 w-full rounded-3xl" /><Skeleton className="h-96 w-full rounded-3xl" /></div>
      </CustomerShell>
    );
  }
  if (link.error || !link.data) {
    const reason = link.error instanceof ApiError ? ((link.error.details as { reason?: string } | undefined)?.reason ?? (link.error.status === 404 ? 'NOT_FOUND' : 'ERROR')) : 'ERROR';
    return <Unavailable reason={reason} onRetry={reason === 'ERROR' ? () => link.refetch() : undefined} />;
  }
  return (
    <CustomerShell>
      {placed ? <Success link={link.data} placed={placed} /> : <Checkout code={code} link={link.data} onPlaced={setPlaced} />}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-ink-400"><LockKeyhole className="h-3.5 w-3.5" />{t('intake.olp.secure')}</p>
    </CustomerShell>
  );
}

// ------------------------------------------------------------------ checkout

function Checkout({ code, link, onPlaced }: { code: string; link: PublicLink; onPlaced: (p: PlacedOrder) => void }) {
  const { t, locale } = useI18n();
  const [f, setF] = useState<Form>(BLANK);
  const [touched, setTouched] = useState(false);
  const [showAlt, setShowAlt] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [manualZone, setManualZone] = useState('');
  const [locating, setLocating] = useState(false);
  const set = (k: keyof Form) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const zones = useQuery({ queryKey: ['zones', 'serviceable'], queryFn: () => api<ZoneOption[]>('/network/zones/serviceable', { auth: 'none' }), staleTime: 10 * 60_000 });
  const address = useDebounced(f.addressLine.trim(), 600);
  const detect = useQuery({
    queryKey: ['public-detect', address, pin?.lat, pin?.lng],
    queryFn: () => api<DetectResult>('/public/detect-zone', { method: 'POST', auth: 'none', body: { address: address || '-', ...(pin ? { lat: pin.lat, lng: pin.lng } : {}) } }),
    enabled: !manualZone && (address.length >= 3 || !!pin),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const detected = !manualZone ? detect.data?.zone ?? null : null;
  const zoneId = manualZone || detected?.id || '';
  const zoneName = (z: { nameAr: string; nameEn: string } | null | undefined) => (z ? (locale === 'ar' ? z.nameAr : z.nameEn) : '');
  const chosenZone = manualZone ? zones.data?.find((z) => z.id === manualZone) : null;

  const quote = useQuery({
    queryKey: ['public-quote', code, zoneId],
    queryFn: () => api<LinkQuote>(`/public/order-links/${encodeURIComponent(code)}/quote`, { method: 'POST', auth: 'none', body: { zoneId } }),
    enabled: !!zoneId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const toPay = quote.data?.totalToPayCents ?? (link.paymentMethod === 'COD' ? link.codAmountCents : 0);

  const phoneOk = !!normalizeEgyptPhone(f.phone);
  const altOk = !f.altPhone.trim() || !!normalizeEgyptPhone(f.altPhone);
  const errors = {
    name: f.name.trim().length < 2 ? t('intake.olp.err.name') : undefined,
    phone: !phoneOk ? t('intake.olp.err.phone') : undefined,
    altPhone: !altOk ? t('intake.olp.err.phone') : undefined,
    addressLine: f.addressLine.trim().length < 5 ? t('intake.olp.err.address') : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  const submit = useMutation({
    mutationFn: () =>
      api<PlacedOrder>(`/public/order-links/${encodeURIComponent(code)}/orders`, {
        method: 'POST',
        auth: 'none',
        body: {
          name: f.name.trim(), phone: f.phone.trim(), ...(f.altPhone.trim() ? { altPhone: f.altPhone.trim() } : {}), addressLine: f.addressLine.trim(),
          ...(f.building.trim() ? { building: f.building.trim() } : {}), ...(f.floor.trim() ? { floor: f.floor.trim() } : {}), ...(f.apartment.trim() ? { apartment: f.apartment.trim() } : {}),
          ...(f.landmark.trim() ? { landmark: f.landmark.trim() } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
          ...(zoneId ? { zoneId } : {}), ...(pin ? { lat: pin.lat, lng: pin.lng } : {}), ...(f.website ? { website: f.website } : {}),
        },
      }),
    onSuccess: (p) => {
      onPlaced(p);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ZONE_NOT_DETECTED') {
        setManualZone('');
        toast.error(t('intake.olp.err.zone'));
        document.querySelector<HTMLElement>('[data-field=zone]')?.focus();
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const locate = () => {
    if (!navigator.geolocation) return toast.error(t('intake.olp.err.geo'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setShowMap(true);
        setManualZone('');
        setPin({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 });
      },
      () => {
        setLocating(false);
        toast.error(t('intake.olp.err.geo'));
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const onSubmit = () => {
    setTouched(true);
    if (!valid) {
      const first = (Object.keys(errors) as Array<keyof typeof errors>).find((k) => errors[k]);
      if (first) document.querySelector<HTMLElement>(`[data-field=${first}]`)?.focus();
      return;
    }
    submit.mutate();
  };

  return (
    <form className="space-y-4 pb-28 sm:pb-0" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <ProductCard link={link} />

      <Panel>
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink-900 dark:text-white"><ShieldCheck className="h-5 w-5 text-turtle-600" />{t('intake.olp.yourDetails')}</h2>
        <div className="space-y-4">
          <Field label={t('intake.olp.name')} required error={touched ? errors.name : undefined}>
            {(id) => <Input id={id} data-field="name" autoComplete="name" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder={t('intake.olp.namePh')} invalid={touched && !!errors.name} className="h-12 text-base" />}
          </Field>
          <Field label={t('intake.olp.phone')} required hint={t('intake.olp.phoneHint')} error={touched ? errors.phone : undefined}>
            {(id) => <Input id={id} data-field="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={f.phone} onChange={(e) => set('phone')(e.target.value)} placeholder="01X XXXX XXXX" invalid={touched && !!errors.phone} className="h-12 text-base" />}
          </Field>
          {showAlt ? (
            <Field label={t('intake.olp.altPhone')} error={touched ? errors.altPhone : undefined}>
              {(id) => <Input id={id} data-field="altPhone" type="tel" inputMode="tel" dir="ltr" value={f.altPhone} onChange={(e) => set('altPhone')(e.target.value)} placeholder="01X XXXX XXXX" className="h-12 text-base" />}
            </Field>
          ) : (
            <button type="button" className="text-sm font-semibold text-turtle-700 hover:underline dark:text-turtle-400" onClick={() => setShowAlt(true)}>+ {t('intake.olp.addAltPhone')}</button>
          )}
        </div>
      </Panel>

      <Panel>
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink-900 dark:text-white"><MapPin className="h-5 w-5 text-turtle-600" />{t('intake.olp.address')}</h2>
        <div className="space-y-4">
          <Field label={t('intake.olp.addressLine')} required hint={t('intake.olp.addressHint')} error={touched ? errors.addressLine : undefined}>
            {(id) => <Textarea id={id} data-field="addressLine" autoComplete="street-address" rows={2} value={f.addressLine} onChange={(e) => set('addressLine')(e.target.value)} placeholder={t('intake.olp.addressPh')} className={cn('text-base', touched && errors.addressLine && 'border-red-400')} />}
          </Field>

          <ZoneChip
            loading={!manualZone && detect.isFetching}
            detected={detected ? `${zoneName(detected)} · ${zoneName(detected.city)}` : null}
            manual={chosenZone ? `${zoneName(chosenZone)} · ${zoneName(chosenZone.city)}` : null}
            searched={!manualZone && !!detect.data && !detect.data.zone}
          />
          <Field label={t('intake.olp.zone')} hint={t('intake.olp.zoneHint')}>
            {(id) => (
              <Select
                id={id}
                data-field="zone"
                value={manualZone}
                onChange={(e) => setManualZone(e.target.value)}
                placeholder={detected ? t('intake.olp.zoneAuto', { zone: zoneName(detected) }) : t('intake.olp.zonePick')}
                options={(zones.data ?? []).map((z) => ({ value: z.id, label: `${zoneName(z)} — ${zoneName(z.city)}` }))}
                className="h-12 text-base"
              />
            )}
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label={t('intake.olp.building')}>{(id) => <Input id={id} value={f.building} onChange={(e) => set('building')(e.target.value)} className="h-12 text-base" />}</Field>
            <Field label={t('intake.olp.floor')}>{(id) => <Input id={id} inputMode="numeric" value={f.floor} onChange={(e) => set('floor')(e.target.value)} className="h-12 text-base" />}</Field>
            <Field label={t('intake.olp.apartment')}>{(id) => <Input id={id} value={f.apartment} onChange={(e) => set('apartment')(e.target.value)} className="h-12 text-base" />}</Field>
          </div>
          <Field label={t('intake.olp.landmark')}>{(id) => <Input id={id} value={f.landmark} onChange={(e) => set('landmark')(e.target.value)} placeholder={t('intake.olp.landmarkPh')} className="h-12 text-base" />}</Field>

          <div className="rounded-2xl border border-dashed border-ink-200 p-3 dark:border-ink-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-600 dark:text-ink-300">{pin ? t('intake.olp.pinSet') : t('intake.olp.pinHint')}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" icon={locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />} onClick={locate}>{t('intake.olp.myLocation')}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowMap((v) => !v)} iconEnd={<ChevronDown className={cn('h-4 w-4 transition', showMap && 'rotate-180')} />}>{t('intake.olp.map')}</Button>
              </div>
            </div>
            {showMap && (
              <div className="mt-3">
                <Suspense fallback={<Skeleton className="h-[240px] w-full rounded-2xl" />}>
                  <PinMap value={pin} onChange={(p) => { setManualZone(''); setPin(p); }} height={240} />
                </Suspense>
                <p className="mt-2 text-xs text-ink-500">{t('intake.olp.mapHint')}</p>
              </div>
            )}
          </div>

          <Field label={t('intake.olp.notes')}>{(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => set('notes')(e.target.value)} placeholder={t('intake.olp.notesPh')} className="text-base" />}</Field>

          {/* Honeypot: invisible to people, irresistible to bots. */}
          <div aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden whitespace-nowrap opacity-0 [clip:rect(0,0,0,0)]">
            <label htmlFor="olp-website">Website</label>
            <input id="olp-website" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website')(e.target.value)} />
          </div>
        </div>
      </Panel>

      {/* Summary + submit: sticky at the bottom on phones */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-100 bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 shadow-pop backdrop-blur dark:border-ink-800 dark:bg-ink-900/95 sm:static sm:rounded-3xl sm:border sm:p-5 sm:shadow-card">
        <div className="mx-auto flex max-w-[560px] items-center gap-3 sm:max-w-none">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-500">{link.paymentMethod === 'COD' ? t('intake.olp.payOnDelivery') : t('intake.olp.prepaid')}</p>
            <p className="font-display text-2xl font-extrabold text-ink-900 dark:text-white"><span className="ltr">{money(toPay)}</span></p>
            {quote.data && quote.data.shippingCents > 0 && <p className="text-[11px] text-ink-500">{t('intake.olp.inclShipping', { fee: money(quote.data.shippingCents) })}</p>}
          </div>
          <Button type="submit" size="xl" loading={submit.isPending} icon={<PackageCheck className="h-5 w-5" />} className="shrink-0">{t('intake.olp.place')}</Button>
        </div>
      </div>
    </form>
  );
}

function ZoneChip({ loading, detected, manual, searched }: { loading: boolean; detected: string | null; manual: string | null; searched: boolean }) {
  const { t } = useI18n();
  if (manual) return <p className="flex items-center gap-2 rounded-xl bg-turtle-50 px-3 py-2 text-sm font-medium text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200"><CheckCircle2 className="h-4 w-4" />{t('intake.olp.zoneChosen', { zone: manual })}</p>;
  if (loading) return <p className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-500 dark:bg-ink-800"><Loader2 className="h-4 w-4 animate-spin" />{t('intake.olp.detecting')}</p>;
  if (detected) return <p className="flex items-center gap-2 rounded-xl bg-turtle-50 px-3 py-2 text-sm font-medium text-turtle-800 dark:bg-turtle-950 dark:text-turtle-200"><MapPin className="h-4 w-4" />{t('intake.olp.zoneDetected', { zone: detected })}</p>;
  if (searched) return <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />{t('intake.olp.zoneUnknown')}</p>;
  return null;
}

function ProductCard({ link }: { link: PublicLink }) {
  const { t } = useI18n();
  const count = link.items.reduce((s, i) => s + i.quantity, 0);
  return (
    <Panel padded={false} className="overflow-hidden">
      <div className="flex items-center gap-3 bg-gradient-to-br from-turtle-600 to-turtle-800 px-5 py-4 text-white">
        {link.brand.logoUrl ? (
          <img src={link.brand.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-2xl bg-white object-cover" />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 font-display text-xl font-bold">{link.brand.name.slice(0, 1)}</span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm text-white/80">{link.brand.name}</p>
          <h1 dir="auto" className="text-start font-display text-xl font-extrabold leading-tight">{link.title}</h1>
        </div>
      </div>
      <div className="p-5">
        {link.description && <p dir="auto" className="mb-4 whitespace-pre-line text-start text-sm text-ink-600 dark:text-ink-300">{link.description}</p>}
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {link.items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-ink-100 px-1.5 text-xs font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200">{num(it.quantity)}×</span>
                <span dir="auto" className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{it.name}</span>
              </span>
              <span className="ltr shrink-0 text-sm font-semibold text-ink-900 dark:text-white">{money(it.quantity * it.priceCents)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-3 dark:border-ink-800">
          <span className="text-sm text-ink-500">{t('intake.olp.itemsTotal', { n: num(count) })}</span>
          <span className="ltr font-display text-lg font-bold text-ink-900 dark:text-white">{money(link.paymentMethod === 'COD' ? link.codAmountCents : link.itemsTotalCents)}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip icon={link.paymentMethod === 'COD' ? <Banknote /> : <ShieldCheck />}>{link.paymentMethod === 'COD' ? t('intake.olp.codBadge') : t('intake.olp.prepaidBadge')}</Chip>
          <Chip icon={<Truck />}>{t(`intake.service.${link.serviceLevel}`)}</Chip>
          {link.allowOpening && <Chip icon={<PackageOpen />}>{t('intake.olp.canOpen')}</Chip>}
          {link.feesPaidBy === 'RECIPIENT' && <Chip icon={<Clock />}>{t('intake.olp.shippingExtra')}</Chip>}
        </div>
      </div>
    </Panel>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-200 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}{children}</span>;
}

// ------------------------------------------------------------------ success / unavailable

function Success({ link, placed }: { link: PublicLink; placed: PlacedOrder }) {
  const { t } = useI18n();
  const trackPath = `/t/${placed.trackingNumber}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${trackPath}`);
      toast.success(t('action.copied'));
    } catch {
      toast.error(t('error.generic'));
    }
  };
  return (
    <Panel className="text-center">
      <span className="mx-auto grid h-20 w-20 animate-slide-up place-items-center rounded-full bg-turtle-50 text-turtle-600 dark:bg-turtle-950 dark:text-turtle-300"><CheckCircle2 className="h-11 w-11" /></span>
      <h1 className="mt-4 font-display text-2xl font-extrabold text-ink-900 dark:text-white">{t('intake.olp.thanks')}</h1>
      <p className="mt-1 text-sm text-ink-500">{t('intake.olp.thanksHint', { brand: link.brand.name })}</p>
      <div className="mx-auto mt-5 max-w-sm rounded-2xl bg-ink-50 p-4 dark:bg-ink-800/60">
        <p className="text-xs text-ink-500">{t('intake.olp.trackingNumber')}</p>
        <p className="ltr mt-1 font-mono text-2xl font-bold tracking-wider text-ink-900 dark:text-white">{placed.trackingNumber}</p>
        {placed.paymentMethod === 'COD' && <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{t('intake.olp.payHero', { amount: money(placed.amountToPayCents) })}</p>}
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link to={trackPath}><Button size="lg" block icon={<Truck className="h-5 w-5" />}>{t('intake.olp.track')}</Button></Link>
        <Button size="lg" variant="outline" icon={<Copy className="h-4 w-4" />} onClick={copy}>{t('intake.olp.copyLink')}</Button>
      </div>
      <p className="mt-4 text-xs text-ink-400">{t('intake.olp.smsNote')}</p>
    </Panel>
  );
}

function Unavailable({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  const { t } = useI18n();
  const key = useMemo(() => (['EXPIRED', 'EXHAUSTED', 'INACTIVE', 'BRAND_INACTIVE', 'NOT_FOUND'].includes(reason) ? reason : 'ERROR'), [reason]);
  return (
    <CustomerShell>
      <Panel className="text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300">{key === 'EXHAUSTED' ? <ShoppingBag className="h-8 w-8" /> : key === 'ERROR' ? <AlertTriangle className="h-8 w-8" /> : <Building2 className="h-8 w-8" />}</span>
        <h1 className="mt-4 font-display text-xl font-bold text-ink-900 dark:text-white">{t(`intake.olp.unavailable.${key}`)}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('intake.olp.unavailableHint')}</p>
        {onRetry && <Button className="mt-4" variant="outline" onClick={onRetry}>{t('action.retry')}</Button>}
      </Panel>
    </CustomerShell>
  );
}
