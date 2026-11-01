import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Scale, TriangleAlert } from 'lucide-react';
import { isValidTrackingNumber, normalizeTrackingNumber, toLatinDigits } from '@goturtle/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Field, Input } from '@/components/ui';
import { Amount, Kg, Ltr, MoneyState } from '../ui';
import type { WeightPanel } from '../types';
import '../i18n';

type Unit = 'g' | 'kg';
type Result = { ok: true; data: WeightPanel } | { ok: false; tn: string; error: string };

const parseNum = (s: string) => {
  const n = Number(toLatinDigits(s).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Hub "Weigh" mode: weight (g or kg) + optional L×W×H, then scan → the
 * result card shows declared vs billable weight and the fee delta.
 */
export function WeighMode() {
  const { t } = useI18n();
  const [unit, setUnit] = useState<Unit>('kg');
  const [weight, setWeight] = useState('');
  const [dims, setDims] = useState({ l: '', w: '', h: '' });
  const [tn, setTn] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const weightRef = useRef<HTMLInputElement>(null);
  const tnRef = useRef<HTMLInputElement>(null);
  useEffect(() => weightRef.current?.focus(), []);

  const value = parseNum(weight);
  const grams = Number.isFinite(value) && value > 0 ? Math.round(unit === 'kg' ? value * 1000 : value) : 0;
  const d = { l: Math.round(parseNum(dims.l)), w: Math.round(parseNum(dims.w)), h: Math.round(parseNum(dims.h)) };
  const anyDim = !!(dims.l || dims.w || dims.h);
  const dimsOk = !anyDim || (d.l > 0 && d.w > 0 && d.h > 0);

  const weigh = useMutation({
    mutationFn: (trackingNumber: string) =>
      api<WeightPanel>('/quality/weigh', { method: 'POST', body: { trackingNumber, weightGrams: grams, ...(anyDim ? { dimensionsCm: d } : {}) } }),
    onSuccess: (data) => {
      setResults((r) => [{ ok: true as const, data }, ...r].slice(0, 20));
      setWeight('');
      setDims({ l: '', w: '', h: '' });
      setTn('');
      weightRef.current?.focus();
    },
    onError: (e, trackingNumber) => {
      setResults((r) => [{ ok: false as const, tn: trackingNumber, error: errorMessage(e) }, ...r].slice(0, 20));
      setTn('');
      tnRef.current?.focus();
    },
  });

  const submit = () => {
    const n = normalizeTrackingNumber(toLatinDigits(tn).trim());
    if (!n) return;
    if (!isValidTrackingNumber(n)) {
      setResults((r) => [{ ok: false as const, tn: n, error: t('money.weigh.invalidTn') }, ...r].slice(0, 20));
      setTn('');
      return;
    }
    if (!grams || !dimsOk) return;
    weigh.mutate(n);
  };
  const latest = results[0];

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="min-w-0 space-y-4 lg:col-span-3">
        <div className="rounded-3xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900 sm:p-6">
          <p className="mb-4 text-sm text-ink-500">{t('money.weigh.hint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('money.weigh.weight')} required>
              {(id) => (
                <div className="flex gap-2">
                  <Input
                    id={id}
                    ref={weightRef}
                    inputMode="decimal"
                    autoComplete="off"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') tnRef.current?.focus(); }}
                    className="ltr h-14 flex-1 text-center font-display text-2xl font-bold"
                    placeholder={unit === 'kg' ? '2.35' : '2350'}
                  />
                  <div className="flex overflow-hidden rounded-lg border border-ink-200 dark:border-ink-700" role="radiogroup" aria-label={t('money.weigh.unit')}>
                    {(['kg', 'g'] as const).map((u) => (
                      <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => setUnit(u)} className={cn('h-14 w-12 text-sm font-semibold', unit === u ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900' : 'bg-white text-ink-600 dark:bg-ink-900 dark:text-ink-300')}>
                        {t(`money.weigh.${u}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Field>
            <Field label={t('money.weigh.dims')} hint={t('money.weigh.dimsHint')} error={!dimsOk ? t('money.weigh.dimsError') : undefined}>
              {(id) => (
                <div className="flex items-center gap-1.5" dir="ltr">
                  {(['l', 'w', 'h'] as const).map((k, i) => (
                    <span key={k} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-ink-400">×</span>}
                      <Input id={i === 0 ? id : undefined} aria-label={t(`money.weigh.${k}`)} inputMode="numeric" value={dims[k]} onChange={(e) => setDims((s) => ({ ...s, [k]: e.target.value }))} className="h-14 w-16 text-center text-lg font-semibold" placeholder={k.toUpperCase()} />
                    </span>
                  ))}
                  <span className="text-xs text-ink-500">{t('money.weigh.cm')}</span>
                </div>
              )}
            </Field>
          </div>
          <Field label={t('money.weigh.scan')} className="mt-4">
            {(id) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  ref={tnRef}
                  autoComplete="off"
                  value={tn}
                  onChange={(e) => setTn(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  className="ltr h-14 flex-1 font-mono text-xl uppercase"
                  placeholder="GT…"
                  disabled={!grams}
                />
                <Button size="xl" className="shrink-0" icon={<Scale className="h-5 w-5" />} loading={weigh.isPending} disabled={!grams || !dimsOk || !tn.trim()} onClick={submit}>{t('money.weigh.go')}</Button>
              </div>
            )}
          </Field>
          {!grams && <p className="mt-2 text-xs text-ink-500">{t('money.weigh.weightFirst')}</p>}
        </div>
        {latest && <ResultCard r={latest} />}
      </div>
      <div className="min-w-0 lg:col-span-2">
        <div className="rounded-3xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
          <p className="border-b border-ink-100 px-5 py-3 text-sm font-semibold text-ink-700 dark:border-ink-800 dark:text-ink-200">{t('money.weigh.session')}</p>
          {results.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-500">{t('money.weigh.none')}</p>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {results.map((r, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  {r.ok ? (r.data.status === 'ADJUSTED' ? <TriangleAlert className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-turtle-600" />) : <TriangleAlert className="h-4 w-4 text-red-600" />}
                  <Ltr className="font-mono">{r.ok ? r.data.trackingNumber : r.tn}</Ltr>
                  <span className="ms-auto">{r.ok ? (r.data.adjustmentCents ? <Amount cents={r.data.adjustmentCents} sign className="font-semibold text-amber-700 dark:text-amber-300" /> : <Kg grams={r.data.billableGrams ?? r.data.actualGrams} className="text-ink-500" />) : <span className="text-xs text-red-600">{t('money.weigh.failed')}</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ r }: { r: Result }) {
  const { t } = useI18n();
  if (!r.ok) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950">
        <p className="flex items-center gap-2 font-semibold text-red-800 dark:text-red-200"><TriangleAlert className="h-5 w-5" /><Ltr className="font-mono">{r.tn}</Ltr></p>
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">{r.error}</p>
      </div>
    );
  }
  const w = r.data;
  const adjusted = w.status !== 'NONE' && w.adjustmentCents > 0;
  return (
    <div className={cn('rounded-3xl border p-5', adjusted ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950' : 'border-turtle-200 bg-turtle-50 dark:border-turtle-900 dark:bg-turtle-950')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/ops/orders/${w.orderId}`} className="ltr font-mono text-lg font-bold text-ink-900 hover:underline dark:text-white">{w.trackingNumber}</Link>
        <div className="flex items-center gap-2">
          {w.alreadyWeighed && <span className="text-xs font-semibold text-ink-500">{t('money.weigh.already')}</span>}
          <MoneyState value={w.status} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <Cell label={t('money.weight.declared')} value={<Kg grams={w.declaredGrams} />} />
        <Cell label={t('money.weight.actual')} value={<Kg grams={w.actualGrams} />} />
        <Cell label={t('money.weight.volumetric')} value={<Kg grams={w.volumetricGrams || null} />} />
        <Cell label={t('money.weight.billable')} value={<Kg grams={w.billableGrams} />} strong />
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/70 px-4 py-3 dark:bg-ink-900/60">
        <span className="text-sm font-semibold text-ink-700 dark:text-ink-200">{adjusted ? t('money.weigh.delta') : t('money.weigh.withinTolerance', { g: String(w.toleranceGrams) })}</span>
        {adjusted && (
          <span className="text-end">
            <Amount cents={w.adjustmentCents} sign className="font-display text-2xl font-bold text-amber-800 dark:text-amber-200" />
            <span className="block text-xs text-ink-500">{t('money.weight.feeVat')} <Amount cents={w.feeCents} /> + <Amount cents={w.vatCents} /></span>
          </span>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-white/70 p-2.5 dark:bg-ink-900/60">
      <dt className="text-[11px] font-semibold text-ink-500">{label}</dt>
      <dd className={cn('mt-0.5 text-base', strong ? 'font-bold text-ink-900 dark:text-white' : 'font-semibold text-ink-700 dark:text-ink-200')}>{value}</dd>
    </div>
  );
}
