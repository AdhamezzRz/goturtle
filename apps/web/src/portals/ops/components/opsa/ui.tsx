import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Filter, Lock, Phone, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { cairoToday, num, phone as fmtPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { Badge, Button, Card, Drawer, EmptyState, Input, Skeleton, type BadgeTone } from '@/components/ui';
import './i18n';

// ------------------------------------------------------------------ hooks

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(query).matches));
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = () => setMatch(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return match;
}

/** True while the app is in dark mode (follows the <html class="dark"> toggle). */
export function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** Re-render every `ms` (countdowns, "x minutes ago"). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ------------------------------------------------------------------ text helpers

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('ltr', className)}>{children}</span>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('ltr whitespace-nowrap font-mono text-[13px] tracking-tight', className)}>{children}</span>;
}

export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn('inline-grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turtle-500 dark:hover:bg-ink-800 dark:hover:text-ink-200', className)}
      aria-label={label ?? t('ops.opsa.copy')}
      title={label ?? t('ops.opsa.copy')}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          toast.success(t('ops.opsa.copied'));
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-turtle-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function PhoneLink({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-ink-400">—</span>;
  return (
    <a href={`tel:${value}`} onClick={(e) => e.stopPropagation()} className={cn('ltr inline-flex items-center gap-1 text-ink-700 hover:text-turtle-700 hover:underline dark:text-ink-200', className)}>
      {fmtPhone(value)}
    </a>
  );
}

export function CallButton({ value, name, size = 'sm' }: { value: string | null | undefined; name?: string; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  if (!value) return null;
  return (
    <a
      href={`tel:${value}`}
      onClick={(e) => e.stopPropagation()}
      aria-label={t('ops.opsa.call', { name: name ?? '' })}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg bg-turtle-600 font-semibold text-white hover:bg-turtle-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turtle-500 focus-visible:ring-offset-2',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
      )}
    >
      <Phone className="h-4 w-4" />
      {t('action.call')}
    </a>
  );
}

// ------------------------------------------------------------------ KPI tiles (dark-mode safe)

const kpiTones = {
  turtle: 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300',
  sand: 'bg-sand-50 text-sand-700 dark:bg-sand-900/40 dark:text-sand-300',
  ink: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
  red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
};
export type KpiTone = keyof typeof kpiTones;

export function Kpi({
  label, value, hint, icon, tone = 'turtle', to, loading, className, emphasis,
}: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: KpiTone; to?: string; loading?: boolean; className?: string; emphasis?: boolean;
}) {
  const body = (
    <div className={cn('flex h-full flex-col gap-2 rounded-2xl border border-ink-100 bg-white p-3.5 shadow-card transition dark:border-ink-800 dark:bg-ink-900 sm:flex-row sm:items-start sm:gap-3 sm:p-4', to && 'hover:border-turtle-300 hover:shadow-pop dark:hover:border-turtle-800', emphasis && 'ring-1 ring-red-200 dark:ring-red-900', className)}>
      {icon && <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg sm:h-10 sm:w-10 sm:rounded-xl [&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-5 sm:[&>svg]:w-5', kpiTones[tone])}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink-500 dark:text-ink-400">{label}</p>
        {loading ? <Skeleton className="mt-2 h-7 w-20" /> : <p className="mt-0.5 truncate font-display text-lg font-bold leading-tight tracking-tight text-ink-900 dark:text-white sm:text-[22px]"><span className="ltr">{value}</span></p>}
        {hint && !loading && <div className="mt-0.5 line-clamp-2 text-xs text-ink-500 dark:text-ink-400">{hint}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turtle-500">{body}</Link> : body;
}

// ------------------------------------------------------------------ search & filters

/** Debounced search box (keeps its own text; reports after 300 ms). */
export function SearchInput({ value, onChange, placeholder, className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  const debounced = useDebounced(text, 300);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <Input
        type="search"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? t('ops.opsa.searchPlaceholder')}
        aria-label={placeholder ?? t('action.search')}
        className="ps-9 pe-8"
      />
      {text && (
        <button type="button" onClick={() => { setText(''); onChange(''); }} className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700" aria-label={t('action.clear')}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Filter panel: a toggle button that expands an inline grid on tablets/desktop
 * and opens a Drawer on phones. Render it inside a `flex flex-wrap` row — the
 * desktop panel takes a full row (basis-full). Children are rendered once.
 */
export function ResponsiveFilters({ children, active, onClear, className, cols = 4, defaultOpen }: { children: ReactNode; active: number; onClear: () => void; className?: string; cols?: 2 | 3 | 4 | 5 | 6; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const desktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches && (defaultOpen ?? active > 0));
  const grid = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4', 5: 'md:grid-cols-3 lg:grid-cols-5', 6: 'md:grid-cols-3 xl:grid-cols-6' }[cols];
  const button = (
    <Button variant={open && desktop ? 'secondary' : 'outline'} onClick={() => setOpen((o) => !o)} icon={<Filter className="h-4 w-4" />} className={className} aria-expanded={open}>
      {t('ops.opsa.filters')}
      {active > 0 && <span className="ltr rounded-full bg-turtle-600 px-1.5 text-[11px] text-white">{num(active)}</span>}
    </Button>
  );
  if (desktop) {
    return (
      <>
        {button}
        {open && (
          <div className="basis-full rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className={cn('grid grid-cols-1 items-end gap-3', grid)}>{children}</div>
            {active > 0 && (
              <div className="mt-3 flex justify-end border-t border-ink-100 pt-3 dark:border-ink-800">
                <Button variant="ghost" size="sm" onClick={onClear} icon={<X className="h-4 w-4" />}>{t('ops.opsa.clearFilters')}</Button>
              </div>
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {button}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t('ops.opsa.filters')}
        footer={
          <>
            <Button variant="ghost" onClick={() => { onClear(); setOpen(false); }}>{t('ops.opsa.clearFilters')}</Button>
            <Button onClick={() => setOpen(false)}>{t('ops.opsa.applyFilters')}</Button>
          </>
        }
      >
        <div className="space-y-4">{children}</div>
      </Drawer>
    </>
  );
}

/** Pill segmented control (status filters, view switches). */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; count?: number }>; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="tablist" className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1 scrollbar-none dark:bg-ink-800', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turtle-500',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-950 dark:text-white' : 'text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="ltr rounded-full bg-ink-200/70 px-1.5 text-[11px] font-semibold text-ink-600 dark:bg-ink-700 dark:text-ink-200">{num(o.count)}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ dates

const addDays = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
export { addDays as addDaysIso };

export function presetRange(days: number): { from: string; to: string } {
  const to = cairoToday();
  return { from: addDays(to, -(days - 1)), to };
}

/** From/To date inputs with quick presets. */
export function DateRange({ from, to, onChange, presets = [1, 7, 30, 90], className }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void; presets?: number[]; className?: string }) {
  const { t } = useI18n();
  const key = (d: number) => (d === 1 ? 'today' : `${d}d`);
  const active = presets.find((d) => {
    const r = presetRange(d);
    return r.from === from && r.to === to;
  });
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      <Segmented
        size="sm"
        value={active ? String(active) : 'custom'}
        onChange={(v) => v !== 'custom' && onChange(presetRange(Number(v)))}
        options={[...presets.map((d) => ({ value: String(d), label: t(`ops.opsa.range.${key(d)}`) })), { value: 'custom', label: t('ops.opsa.range.custom') }]}
      />
      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label={t('ops.opsa.from')}
          value={from}
          max={to}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to })}
          className="ltr h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 sm:flex-none"
        />
        <span className="text-ink-400">–</span>
        <input
          type="date"
          aria-label={t('ops.opsa.to')}
          value={to}
          min={from}
          onChange={(e) => e.target.value && onChange({ from, to: e.target.value })}
          className="ltr h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 sm:flex-none"
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ SLA

export function durationText(ms: number, t: (k: string, v?: Record<string, string | number>) => string) {
  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins < 60) return t('ops.opsa.unit.m', { n: num(mins) });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${t('ops.opsa.unit.h', { n: num(hours) })} ${mins % 60 ? t('ops.opsa.unit.m', { n: num(mins % 60) }) : ''}`.trim();
  return t('ops.opsa.unit.d', { n: num(Math.round(hours / 24)) });
}

/** SLA countdown chip: green → amber (< warnMs left) → red (overdue). */
export function SlaChip({ due, done, warnMs = 2 * 3_600_000, className }: { due: string | null | undefined; done?: boolean; warnMs?: number; className?: string }) {
  const { t } = useI18n();
  const now = useNow(30_000);
  if (!due) return <span className={cn('text-xs text-ink-400', className)}>{t('ops.opsa.sla.none')}</span>;
  if (done) return <Badge tone="success" className={className}>{t('ops.opsa.sla.done')}</Badge>;
  const left = new Date(due).getTime() - now;
  const tone: BadgeTone = left < 0 ? 'danger' : left < warnMs ? 'warning' : 'success';
  return (
    <Badge tone={tone} dot className={className}>
      {left < 0 ? t('ops.opsa.sla.overdue', { t: durationText(left, t) }) : t('ops.opsa.sla.left', { t: durationText(left, t) })}
    </Badge>
  );
}

// ------------------------------------------------------------------ reliability gauge

export function Gauge({ value, size = 160, label, sublabel }: { value: number; size?: number; label?: ReactNode; sublabel?: ReactNode }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 42;
  const c = Math.PI * r;
  const color = v >= 75 ? '#0ca30c' : v >= 50 ? '#e0a106' : '#d03b3b';
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg viewBox="0 0 100 58" width={size} height={size * 0.58} role="img" aria-label={`${v}/100`}>
        <path d="M8 50 A42 42 0 0 1 92 50" fill="none" strokeWidth="9" strokeLinecap="round" className="stroke-ink-100 dark:stroke-ink-800" />
        <path d="M8 50 A42 42 0 0 1 92 50" fill="none" strokeWidth="9" strokeLinecap="round" stroke={color} strokeDasharray={`${(v / 100) * c} ${c}`} />
        <text x="50" y="47" textAnchor="middle" className="fill-ink-900 font-display dark:fill-white" fontSize="20" fontWeight="700">{num(v)}</text>
      </svg>
      {label && <div className="mt-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{label}</div>}
      {sublabel && <div className="text-xs text-ink-500">{sublabel}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ misc

export function NoAccess() {
  const { t } = useI18n();
  return (
    <Card>
      <EmptyState icon={<Lock className="h-7 w-7" />} title={t('ops.opsa.noPermission')} description={t('ops.opsa.noPermissionHint')} />
    </Card>
  );
}

export function SectionCard({ title, subtitle, actions, children, className, padded = true, bodyClassName }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; bodyClassName?: string }) {
  return (
    <section className={cn('rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800 sm:px-5">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-ink-900 dark:text-ink-50">{title}</h2>
          {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn(padded && 'p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function MiniStat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: 'danger' | 'success' | 'cash' }) {
  return (
    <div className="min-w-0 rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-800/60">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={cn('truncate font-display text-base font-bold', tone === 'danger' ? 'text-red-600 dark:text-red-400' : tone === 'success' ? 'text-turtle-700 dark:text-turtle-400' : tone === 'cash' ? 'text-sand-700 dark:text-sand-300' : 'text-ink-900 dark:text-white')}><span className="ltr">{value}</span></p>
    </div>
  );
}

/** Small "label: value" row used in side cards. */
export function InfoRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 py-1.5 text-sm', className)}>
      <span className="shrink-0 text-ink-500">{label}</span>
      <span className="min-w-0 text-end font-medium text-ink-900 dark:text-ink-100">{children}</span>
    </div>
  );
}

export const today = cairoToday;

/** A router link styled like a Button (avoids nesting <button> inside <a>). */
export function LinkButton({ to, children, icon, iconEnd, variant = 'outline', size = 'sm', className, target }: { to: string; children?: ReactNode; icon?: ReactNode; iconEnd?: ReactNode; variant?: 'primary' | 'outline' | 'ghost'; size?: 'sm' | 'md'; className?: string; target?: string }) {
  const v = {
    primary: 'bg-turtle-600 text-white hover:bg-turtle-700',
    outline: 'border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 dark:bg-ink-900 dark:border-ink-700 dark:text-ink-100 dark:hover:bg-ink-800',
    ghost: 'text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800',
  }[variant];
  const s = size === 'sm' ? 'h-8 px-3 text-sm gap-1.5 rounded-lg' : 'h-10 px-4 text-sm gap-2 rounded-lg';
  const cls = cn('inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turtle-500 focus-visible:ring-offset-2 [&>svg]:h-4 [&>svg]:w-4', v, s, className);
  if (target || /^https?:/.test(to)) return <a href={to} target={target} rel="noreferrer" className={cls}>{icon}{children}{iconEnd}</a>;
  return <Link to={to} className={cls}>{icon}{children}{iconEnd}</Link>;
}
