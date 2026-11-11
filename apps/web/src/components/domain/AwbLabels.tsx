import { useEffect, useMemo } from 'react';
import { Wordmark } from '@/components/brand';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { dateOnly, money } from '@/lib/format';
import { registerDictionary, useI18n } from '@/i18n';
import { Barcode, Button, EmptyState, ErrorState, PageLoader, QrCode } from '@/components/ui';

registerDictionary({
  'labels.title': { en: 'Shipping labels', ar: 'بوالص الشحن' },
  'labels.count': { en: '{n} labels · 4×6 in thermal', ar: '{n} بوليصة · مقاس ٤×٦ بوصة' },
  'labels.print': { en: 'Print labels', ar: 'طباعة البوالص' },
  'labels.collect': { en: 'COLLECT', ar: 'المطلوب تحصيله' },
  'labels.prepaid': { en: 'PREPAID — collect nothing', ar: 'مدفوع مسبقاً — لا تحصيل' },
  'labels.to': { en: 'Deliver to', ar: 'المرسل إليه' },
  'labels.from': { en: 'From', ar: 'من' },
  'labels.pieces': { en: 'Pieces', ar: 'القطع' },
  'labels.weight': { en: 'Weight', ar: 'الوزن' },
  'labels.open': { en: 'OPEN ALLOWED', ar: 'مسموح بالفتح' },
  'labels.fragile': { en: 'FRAGILE', ar: 'قابل للكسر' },
  'labels.otp': { en: 'OTP REQUIRED', ar: 'يتطلب كود' },
  'labels.missing': { en: '{n} orders could not be printed', ar: 'تعذر طباعة {n} طلب' },
  'labels.none': { en: 'Select orders to print', ar: 'اختر طلبات للطباعة' },
});

export interface AwbLabel {
  id: string;
  trackingNumber: string;
  barcode: string;
  brandReference: string | null;
  brand: { name: string; code: string; phone: string };
  pickupLocation: string | null;
  recipient: { name: string; phone: string; altPhone: string | null };
  address: { full: string; landmark: string | null };
  zone: { code: string; nameEn: string; nameAr: string };
  hubCode: string | null;
  type: string;
  serviceLevel: string;
  paymentMethod: string;
  codToCollectCents: number;
  pieces: number;
  weightGrams: number;
  description: string | null;
  notes: string | null;
  allowOpening: boolean;
  fragile: boolean;
  deliveryOtpRequired: boolean;
  promisedBy: string | null;
  createdAt: string;
}

/** One 4×6 in label (also looks right on A6 / A4 printers). */
export function AwbLabelCard({ l }: { l: AwbLabel }) {
  const { t } = useI18n();
  const trackUrl = `${window.location.origin}/t/${l.trackingNumber}`;
  return (
    <div className="label-sheet mx-auto flex aspect-[2/3] w-full max-w-[4in] flex-col overflow-hidden rounded-lg border-2 border-ink-900 bg-white text-ink-950 print:h-[6in] print:w-[4in] print:max-w-none print:rounded-none" dir="ltr">
      <div className="flex items-center justify-between border-b-2 border-ink-900 px-3 py-2">
        <div className="leading-tight">
          <Wordmark className="h-7 text-black" title="GoTurtle" />
          <p className="mt-0.5 text-[10px] font-medium tracking-wide text-ink-600">goturtle.co</p>
        </div>
        <div className="text-end">
          <p className="font-mono text-3xl font-black leading-none tracking-tight">{l.zone.code.split('-').slice(1).join('-') || l.zone.code}</p>
          <p className="text-[10px] font-semibold">{l.hubCode ?? ''} · {l.serviceLevel}</p>
        </div>
      </div>

      <div className="flex flex-col items-center border-b-2 border-ink-900 px-3 py-2">
        <Barcode value={l.barcode} height={56} width={1.9} fontSize={14} />
      </div>

      <div className="grid flex-1 grid-cols-[1fr_auto] gap-2 px-3 py-2">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[10px] font-bold uppercase text-ink-500">{t('labels.to')}</p>
          <p className="truncate text-base font-extrabold" dir="auto">{l.recipient.name}</p>
          <p className="font-mono text-sm font-bold">{l.recipient.phone}{l.recipient.altPhone ? ` / ${l.recipient.altPhone}` : ''}</p>
          <p className="line-clamp-3 text-[13px] leading-snug" dir="auto">{l.address.full}</p>
          {l.address.landmark && <p className="line-clamp-1 text-[11px] text-ink-600" dir="auto">↳ {l.address.landmark}</p>}
          <p className="text-[12px] font-bold" dir="auto">{l.zone.nameEn} · {l.zone.nameAr}</p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <QrCode value={trackUrl} size={78} />
          <span className="text-[8px] text-ink-500">scan to track</span>
        </div>
      </div>

      <div className="border-t-2 border-ink-900 bg-ink-950 px-3 py-2 text-white">
        {l.codToCollectCents > 0 ? (
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-bold">{t('labels.collect')}</span>
            <span className="font-mono text-2xl font-black">{money(l.codToCollectCents)}</span>
          </div>
        ) : (
          <p className="text-center text-sm font-bold">{t('labels.prepaid')}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-1 px-3 pt-2">
        {l.allowOpening && <span className="rounded border border-ink-900 px-1.5 text-[10px] font-bold">{t('labels.open')}</span>}
        {l.fragile && <span className="rounded bg-ink-900 px-1.5 text-[10px] font-bold text-white">{t('labels.fragile')}</span>}
        {l.deliveryOtpRequired && <span className="rounded border border-ink-900 px-1.5 text-[10px] font-bold">{t('labels.otp')}</span>}
        {l.type !== 'DELIVERY' && <span className="rounded bg-ink-900 px-1.5 text-[10px] font-bold text-white">{l.type}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 px-3 py-2 text-[10px]">
        <div>
          <p className="font-bold uppercase text-ink-500">{t('labels.from')}</p>
          <p className="truncate font-semibold">{l.brand.name}</p>
          <p className="font-mono">{l.brand.code}{l.brandReference ? ` · ${l.brandReference}` : ''}</p>
        </div>
        <div>
          <p className="font-bold uppercase text-ink-500">{t('labels.pieces')} / {t('labels.weight')}</p>
          <p className="font-semibold">{l.pieces} · {(l.weightGrams / 1000).toFixed(1)} kg</p>
        </div>
        <div className="text-end">
          <p className="font-bold uppercase text-ink-500">Date</p>
          <p className="font-semibold">{dateOnly(l.createdAt)}</p>
        </div>
      </div>
      {(l.description || l.notes) && (
        <p className="line-clamp-2 border-t border-dashed border-ink-400 px-3 py-1.5 text-[10px] text-ink-700" dir="auto">
          {[l.description, l.notes].filter(Boolean).join(' — ')}
        </p>
      )}
    </div>
  );
}

/**
 * Print view used by Ops and Brand portals: /…/orders/labels?ids=a,b,c
 * Fetches POST /orders/labels and renders one label per page.
 */
export function LabelsPrintView({ backTo }: { backTo: string }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const ids = useMemo(() => (params.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200), [params]);
  const q = useQuery({
    queryKey: ['labels', ids],
    queryFn: () => api<{ labels: AwbLabel[]; missing: string[] }>('/orders/labels', { method: 'POST', body: { ids } }),
    enabled: ids.length > 0,
  });

  useEffect(() => {
    if (q.data?.labels.length && params.get('autoprint') === '1') setTimeout(() => window.print(), 400);
  }, [q.data, params]);

  if (!ids.length) return <EmptyState title={t('labels.none')} action={<Link to={backTo}><Button variant="outline">{t('action.back')}</Button></Link>} />;
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const labels = q.data?.labels ?? [];

  return (
    <div>
      <div className="no-print mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link to={backTo}><Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4 rtl:rotate-180" />}>{t('action.back')}</Button></Link>
          <div>
            <h1 className="font-display text-xl font-bold">{t('labels.title')}</h1>
            <p className="text-sm text-ink-500">{t('labels.count', { n: labels.length })}</p>
          </div>
        </div>
        <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!labels.length}>{t('labels.print')}</Button>
      </div>
      {q.data?.missing.length ? <p className="no-print mb-4 text-sm text-amber-700">{t('labels.missing', { n: q.data.missing.length })}</p> : null}
      <style>{'@media print { @page { size: 4in 6in; margin: 0; } body * { visibility: hidden; } .labels-print, .labels-print * { visibility: visible; } .labels-print { position: absolute; inset: 0; } .label-sheet { border-radius: 0 !important; margin: 0 !important; } }'}</style>
      <div className="labels-print grid gap-6 print:block print:gap-0">
        {labels.map((l) => <AwbLabelCard key={l.id} l={l} />)}
      </div>
    </div>
  );
}
