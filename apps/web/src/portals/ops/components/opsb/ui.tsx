import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, KeyRound, SlidersHorizontal, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { money, num } from '@/lib/format';
import { uploadFile } from '@/lib/api';
import { errorMessage, useI18n } from '@/i18n';
import { Badge, Button, ConfirmDialog, Drawer, Field, Input, ProgressBar, Textarea, type BadgeTone } from '@/components/ui';
import './i18n';

/* ───────────────────────────── Money & numbers ───────────────────────────── */

/** Money in piasters, always LTR-isolated so it reads correctly inside Arabic text. */
export function Money({ cents, className, sign, compact, tone }: { cents: number | null | undefined; className?: string; sign?: boolean; compact?: boolean; tone?: 'auto' | 'none' }) {
  const v = (cents ?? 0) || 0;
  return (
    <span className={cn('ltr tabular whitespace-nowrap', tone === 'auto' && (v < 0 ? 'text-red-600 dark:text-red-400' : v > 0 ? 'text-turtle-700 dark:text-turtle-400' : ''), className)}>
      {money(v, { sign, compact })}
    </span>
  );
}

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('ltr whitespace-nowrap font-mono text-xs font-semibold tracking-tight text-ink-600 dark:text-ink-300', className)}>{children}</span>;
}

/* ───────────────────────────── Stat tiles ───────────────────────────── */

type StatTone = 'turtle' | 'sand' | 'ink' | 'red' | 'violet' | 'sky';
const statTone: Record<StatTone, string> = {
  turtle: 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300',
  sand: 'bg-sand-50 text-sand-700 dark:bg-sand-900/40 dark:text-sand-300',
  ink: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
  red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
};

/** Compact KPI tile (dark-mode aware); use inside <StatGrid>. */
export function Stat({ label, value, hint, icon, tone = 'turtle', loading, onClick, active }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: StatTone; loading?: boolean; onClick?: () => void; active?: boolean;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={cn(
        'flex min-w-0 items-start gap-2.5 rounded-2xl border bg-white p-3 text-start shadow-card dark:bg-ink-900 sm:gap-3 sm:p-4',
        active ? 'border-turtle-400 ring-2 ring-turtle-500/20 dark:border-turtle-600' : 'border-ink-100 dark:border-ink-800',
        onClick && 'transition hover:border-turtle-300 focus-visible:ring-2 focus-visible:ring-turtle-500',
      )}
    >
      {icon && <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg sm:h-10 sm:w-10 sm:rounded-xl [&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-5 sm:[&>svg]:w-5', statTone[tone])}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-500 sm:text-sm">{label}</p>
        {loading ? (
          <div className="mt-1.5 h-6 w-20 animate-pulse2 rounded-md bg-ink-100 dark:bg-ink-800" />
        ) : (
          <p className="mt-0.5 truncate font-display text-lg font-bold tracking-tight text-ink-900 dark:text-white sm:text-2xl">{value}</p>
        )}
        {hint && !loading && <div className="mt-0.5 truncate text-xs text-ink-500">{hint}</div>}
      </div>
    </Comp>
  );
}

export function StatGrid({ children, cols = 4, className }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6; className?: string }) {
  const c = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-3 2xl:grid-cols-5', 6: 'lg:grid-cols-3 xl:grid-cols-6' }[cols];
  return <div className={cn('grid grid-cols-2 gap-3 sm:gap-4', c, className)}>{children}</div>;
}

/* ───────────────────────────── Cash bar ───────────────────────────── */

export function cashTone(ratio: number): 'turtle' | 'sand' | 'red' {
  return ratio >= 1 ? 'red' : ratio >= 0.8 ? 'sand' : 'turtle';
}

/** Cash on hand vs custody limit. */
export function CashBar({ onHandCents, limitCents, compact }: { onHandCents: number; limitCents: number; compact?: boolean }) {
  const { t } = useI18n();
  const ratio = limitCents > 0 ? onHandCents / limitCents : onHandCents > 0 ? 1 : 0;
  return (
    <div className={cn('min-w-0', compact ? 'w-full max-w-[180px]' : 'w-full')}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <Money cents={onHandCents} className={cn('font-semibold', ratio >= 1 ? 'text-red-600 dark:text-red-400' : 'text-ink-800 dark:text-ink-100')} />
        <span className="truncate text-ink-400">{t('ops.opsb.ofLimit', { limit: money(limitCents, { compact: true }) })}</span>
      </div>
      <ProgressBar value={ratio} tone={cashTone(ratio)} />
    </div>
  );
}

export function CashWarningBadge({ ratio }: { ratio: number }) {
  const { t } = useI18n();
  if (ratio >= 1) return <Badge tone="danger" dot>{t('ops.opsb.overLimit')}</Badge>;
  if (ratio >= 0.8) return <Badge tone="warning" dot>{t('ops.opsb.nearLimit')}</Badge>;
  return <Badge tone="success" dot>{t('ops.opsb.withinLimit')}</Badge>;
}

/* ───────────────────────────── Availability ───────────────────────────── */

const availColor: Record<string, string> = { ONLINE: 'bg-turtle-500', BUSY: 'bg-violet-500', ON_BREAK: 'bg-amber-500', OFFLINE: 'bg-ink-300 dark:bg-ink-600' };

export function AvailabilityDot({ value, withLabel, className }: { value: string; withLabel?: boolean; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-ink-600 dark:text-ink-300', className)} title={t(`state.${value}`)}>
      <span className={cn('relative inline-block h-2.5 w-2.5 shrink-0 rounded-full', availColor[value] ?? 'bg-ink-300')}>
        {value === 'ONLINE' && <span className="absolute inset-0 animate-ping rounded-full bg-turtle-400 opacity-60" />}
      </span>
      {withLabel ? t(`state.${value}`) : <span className="sr-only">{t(`state.${value}`)}</span>}
    </span>
  );
}

/* ───────────────────────────── Filters ───────────────────────────── */

/**
 * Search box always visible; the other filters render inline on ≥ md and inside
 * a Drawer on phones.
 */
export function FilterBar({ search, children, activeCount = 0, onClear, actions }: {
  search?: ReactNode; children?: ReactNode; activeCount?: number; onClear?: () => void; actions?: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {search && <div className="min-w-0 flex-1 md:max-w-sm">{search}</div>}
        {children && (
          <Button variant="outline" className="relative shrink-0 md:hidden" onClick={() => setOpen(true)} icon={<SlidersHorizontal className="h-4 w-4" />} aria-label={t('ops.opsb.filters')}>
            <span className="hidden min-[400px]:inline">{t('ops.opsb.filters')}</span>
            {activeCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-turtle-600 px-1 text-[11px] text-white">{num(activeCount)}</span>}
          </Button>
        )}
        {children && <div className="hidden flex-1 flex-wrap items-center gap-2 md:flex [&_select]:w-auto [&_select]:min-w-[150px]">{children}{activeCount > 0 && onClear && <Button variant="ghost" size="sm" onClick={onClear}>{t('ops.opsb.clearFilters')}</Button>}</div>}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title={t('ops.opsb.filters')}
          width="max-w-sm"
          footer={
            <>
              {onClear && <Button variant="ghost" onClick={() => { onClear(); setOpen(false); }}>{t('ops.opsb.clearFilters')}</Button>}
              <Button onClick={() => setOpen(false)}>{t('ops.opsb.applyFilters')}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4 [&_select]:w-full">{children}</div>
        </Drawer>
      )}
    </div>
  );
}

/** Label-on-top select wrapper used inside FilterBar drawers (label hidden on desktop). */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 md:block">
      <span className="text-sm font-medium text-ink-700 dark:text-ink-200 md:sr-only">{label}</span>
      {children}
    </label>
  );
}

/* ───────────────────────────── Copy & secrets ───────────────────────────── */

export async function copyText(text: string, okMsg?: string, failMsg?: string) {
  try {
    await navigator.clipboard.writeText(text);
    if (okMsg) toast.success(okMsg);
    return true;
  } catch {
    if (failMsg) toast.error(failMsg);
    return false;
  }
}

export function CopyButton({ value, label, size = 'sm', variant = 'outline' }: { value: string; label?: string; size?: 'xs' | 'sm' | 'md'; variant?: 'outline' | 'ghost' | 'primary' }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      aria-label={label ?? t('action.copy')}
      icon={done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      onClick={async () => {
        if (await copyText(value, t('ops.opsb.copied'), t('ops.opsb.copyFailed'))) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {label ?? (done ? t('action.copied') : t('action.copy'))}
    </Button>
  );
}

/** One-time secret (temporary password) display with copy. */
export function TempPasswordPanel({ password, loginId, title }: { password: string; loginId?: string; title?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-sand-300 bg-sand-50 p-4 dark:border-sand-700/60 dark:bg-sand-900/20">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-sand-800 dark:text-sand-200">
        <KeyRound className="h-4 w-4" />
        {title ?? t('ops.opsb.tempPassword')}
      </div>
      {loginId && (
        <p className="mb-2 text-sm text-ink-600 dark:text-ink-300">
          {t('ops.opsb.loginId')}: <span className="ltr font-semibold">{loginId}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <code className="ltr min-w-0 flex-1 select-all rounded-xl border border-sand-200 bg-white px-3 py-2.5 font-mono text-lg font-bold tracking-wider text-ink-900 dark:border-sand-800 dark:bg-ink-950 dark:text-white">{password}</code>
        <CopyButton value={password} size="md" variant="primary" />
      </div>
      <p className="mt-3 text-xs text-sand-800 dark:text-sand-200">{t('ops.opsb.tempPasswordOnce')}</p>
    </div>
  );
}

/* ───────────────────────────── Reason dialog ───────────────────────────── */

/** Confirm dialog that collects a mandatory reason (min 3 chars). */
export function ReasonDialog({ open, onClose, onConfirm, title, description, confirmLabel, danger, loading, minLength = 3, optional, children, label }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void; title: ReactNode; description?: ReactNode; confirmLabel?: ReactNode;
  danger?: boolean; loading?: boolean; minLength?: number; optional?: boolean; children?: ReactNode; label?: ReactNode;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = !optional && reason.trim().length < minLength;
  const close = () => {
    setReason('');
    setTouched(false);
    onClose();
  };
  return (
    <ConfirmDialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      danger={danger}
      loading={loading}
      confirmLabel={confirmLabel}
      onConfirm={() => {
        setTouched(true);
        if (invalid) return;
        onConfirm(reason.trim());
      }}
    >
      <div className="space-y-4">
        {children}
        <Field label={label ?? t('ops.opsb.reason')} required={!optional} error={touched && invalid ? t('ops.opsb.minChars', { n: minLength }) : undefined} hint={t('ops.opsb.reasonHint')}>
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
        </Field>
      </div>
    </ConfirmDialog>
  );
}

/* ───────────────────────────── Money input ───────────────────────────── */

export function MoneyInput({ id, value, onChange, invalid, placeholder, disabled }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; placeholder?: string; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <Input
      id={id}
      inputMode="decimal"
      dir="ltr"
      value={value}
      disabled={disabled}
      placeholder={placeholder ?? '0.00'}
      onChange={(e) => onChange(e.target.value)}
      invalid={invalid}
      trailing={<span className="text-xs font-semibold">{t('ops.opsb.egpSuffix')}</span>}
    />
  );
}

/** Piasters → editable EGP string. */
export const centsToInput = (c: number | null | undefined) => (c === null || c === undefined ? '' : String(Math.round(c) / 100));

/* ───────────────────────────── Chips ───────────────────────────── */

export function ChipGroup<T extends string | number>({ options, value, onChange, multiple = true, ariaLabel }: {
  options: Array<{ value: T; label: string }>; value: T[]; onChange: (v: T[]) => void; multiple?: boolean; ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(multiple ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value])}
            className={cn(
              'h-9 rounded-full border px-3 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-turtle-500',
              on ? 'border-turtle-600 bg-turtle-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-turtle-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Stepper ───────────────────────────── */

export function Stepper({ steps, current, onStep }: { steps: string[]; current: number; onStep?: (i: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="mb-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400 sm:hidden">
        {t('ops.opsb.step', { n: num(current + 1), total: num(steps.length) })} · <span className="text-ink-700 dark:text-ink-200">{steps[current]}</span>
      </p>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {steps.map((s, i) => (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!onStep || i > current}
              onClick={() => onStep?.(i)}
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition',
                i < current ? 'bg-turtle-600 text-white' : i === current ? 'bg-turtle-100 text-turtle-800 ring-2 ring-turtle-500 dark:bg-turtle-950 dark:text-turtle-200' : 'bg-ink-100 text-ink-500 dark:bg-ink-800',
              )}
              aria-current={i === current ? 'step' : undefined}
              aria-label={s}
            >
              {i < current ? <Check className="h-3.5 w-3.5" /> : num(i + 1)}
            </button>
            <span className={cn('hidden truncate text-sm sm:block', i === current ? 'font-semibold text-ink-900 dark:text-white' : 'text-ink-500')}>{s}</span>
            {i < steps.length - 1 && <span className={cn('h-0.5 min-w-2 flex-1 rounded', i < current ? 'bg-turtle-500' : 'bg-ink-200 dark:bg-ink-700')} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ───────────────────────────── File upload ───────────────────────────── */

export function UploadButton({ purpose, onUploaded, accept = 'image/*,application/pdf', label, size = 'sm', variant = 'outline', disabled }: {
  purpose: string; onUploaded: (f: { id: string; url: string; name: string }) => void; accept?: string; label?: string; size?: 'xs' | 'sm' | 'md'; variant?: 'outline' | 'ghost' | 'primary'; disabled?: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            const res = await uploadFile(file, purpose);
            onUploaded({ ...res, name: file.name });
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button size={size} variant={variant} loading={busy} disabled={disabled} icon={<Upload className="h-4 w-4" />} onClick={() => ref.current?.click()}>
        {busy ? t('ops.opsb.uploading') : label ?? t('action.upload')}
      </Button>
    </>
  );
}

/* ───────────────────────────── JSON ───────────────────────────── */

export function JsonBlock({ value, className, maxHeight = 320 }: { value: unknown; className?: string; maxHeight?: number }) {
  const text = useMemo(() => {
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  }, [value]);
  return (
    <pre dir="ltr" className={cn('overflow-auto whitespace-pre-wrap break-all rounded-xl bg-ink-950 p-3 text-start font-mono text-xs leading-relaxed text-ink-100', className)} style={{ maxHeight }}>
      {text ?? 'null'}
    </pre>
  );
}

const fmtVal = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

/** Before/after field diff with a raw JSON toggle. */
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const { t } = useI18n();
  const [raw, setRaw] = useState(false);
  const [changedOnly, setChangedOnly] = useState(true);
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const rows = keys.map((k) => ({ k, b: b[k], a: a[k], changed: JSON.stringify(b[k]) !== JSON.stringify(a[k]) })).filter((r) => !changedOnly || r.changed);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
          <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-turtle-600" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
          {t('ops.opsb.changedOnly')}
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
          <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-turtle-600" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          {t('ops.opsb.rawJson')}
        </label>
      </div>
      {raw ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="mb-1 text-xs font-semibold uppercase text-ink-400">{t('ops.opsb.before')}</p><JsonBlock value={before ?? null} /></div>
          <div><p className="mb-1 text-xs font-semibold uppercase text-ink-400">{t('ops.opsb.after')}</p><JsonBlock value={after ?? null} /></div>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-ink-50 p-4 text-center text-sm text-ink-500 dark:bg-ink-800/50">{t('ops.opsb.noData')}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
          <div className="hidden grid-cols-[minmax(110px,0.6fr)_1fr_1fr] gap-px bg-ink-50 text-xs font-semibold uppercase text-ink-500 dark:bg-ink-800/60 sm:grid">
            <div className="px-3 py-2">{t('ops.opsb.field')}</div>
            <div className="px-3 py-2">{t('ops.opsb.before')}</div>
            <div className="px-3 py-2">{t('ops.opsb.after')}</div>
          </div>
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {rows.map((r) => (
              <li key={r.k} className="grid gap-1 px-3 py-2 text-xs sm:grid-cols-[minmax(110px,0.6fr)_1fr_1fr] sm:gap-0 sm:px-0 sm:py-0">
                <div className="ltr font-mono font-semibold text-ink-700 dark:text-ink-200 sm:px-3 sm:py-2">{r.k}</div>
                <div dir="ltr" className={cn('break-all rounded px-2 py-1 font-mono sm:rounded-none sm:px-3 sm:py-2', r.changed ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300' : 'text-ink-500')}>{fmtVal(r.b)}</div>
                <div dir="ltr" className={cn('break-all rounded px-2 py-1 font-mono sm:rounded-none sm:px-3 sm:py-2', r.changed ? 'bg-turtle-50 text-turtle-800 dark:bg-turtle-950/40 dark:text-turtle-300' : 'text-ink-500')}>{fmtVal(r.a)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Misc ───────────────────────────── */

export function Section({ title, subtitle, actions, children, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900 sm:p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function InfoRow({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: 'danger' | 'success' }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1.5 text-sm', strong && 'border-t border-ink-100 pt-2.5 font-semibold dark:border-ink-800')}>
      <span className="text-ink-500">{label}</span>
      <span className={cn('text-end', tone === 'danger' ? 'text-red-600 dark:text-red-400' : tone === 'success' ? 'text-turtle-700 dark:text-turtle-400' : 'text-ink-900 dark:text-ink-50')}>{value}</span>
    </div>
  );
}

export function Notice({ tone = 'info', icon, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: ReactNode; children: ReactNode; className?: string }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
    warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    danger: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
    success: 'border-turtle-200 bg-turtle-50 text-turtle-900 dark:border-turtle-900 dark:bg-turtle-950/40 dark:text-turtle-200',
  };
  return <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0', tones[tone], className)}>{icon}<div className="min-w-0 flex-1">{children}</div></div>;
}

/** Badge mapping for statuses that are not in the default StateBadge map. */
export const toneOf = (map: Record<string, BadgeTone>, v: string, fallback: BadgeTone = 'neutral') => map[v] ?? fallback;
