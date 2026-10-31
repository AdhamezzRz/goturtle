import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { useI18n } from '@/i18n';
import type { BrandLocation, MyBrand, ServiceableZone } from './types';
import '../pages/i18n';

/** Money in piasters → localized EGP, kept LTR inside Arabic text. */
export function Money({ cents, className, sign, compact }: { cents: number | null | undefined; className?: string; sign?: boolean; compact?: boolean }) {
  return <span className={cn('ltr tabular whitespace-nowrap', className)}>{money(cents, { sign, compact })}</span>;
}

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('ltr', className)}>{children}</span>;
}

export async function copyText(value: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(okMessage);
    return true;
  } catch {
    // Fallback for http origins / older browsers
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) toast.success(okMessage);
    return ok;
  }
}

export function CopyButton({ value, label, className, size = 'sm' }: { value: string; label?: string; className?: string; size?: 'xs' | 'sm' }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(value, t('action.copied'))) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
      aria-label={label ?? t('action.copy')}
      title={label ?? t('action.copy')}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-lg font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-100',
        size === 'xs' ? 'h-6 px-1.5 text-xs' : 'h-8 px-2 text-sm',
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5 text-turtle-600" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span>{done ? t('action.copied') : label}</span>}
    </button>
  );
}

const statTones = {
  turtle: 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300',
  sand: 'bg-sand-50 text-sand-700 dark:bg-sand-900/30 dark:text-sand-300',
  ink: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
  red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
} as const;

/** KPI tile with dark-mode aware accents. */
export function Stat({
  label, value, hint, icon, tone = 'turtle', className, loading,
}: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: keyof typeof statTones; className?: string; loading?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-start gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900 sm:p-5', className)}>
      {icon && <div className={cn('hidden h-10 w-10 shrink-0 sm:grid place-items-center rounded-xl [&>svg]:h-5 [&>svg]:w-5', statTones[tone])}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-500 sm:text-sm">{label}</p>
        {loading ? (
          <div className="mt-2 h-7 w-24 animate-pulse2 rounded-lg bg-ink-100 dark:bg-ink-800" />
        ) : (
          <p className="mt-1 break-words font-display text-lg font-bold leading-tight tracking-tight text-ink-900 dark:text-white sm:text-xl 2xl:text-2xl">{value}</p>
        )}
        {hint && <div className="mt-1 truncate text-xs text-ink-500">{hint}</div>}
      </div>
    </div>
  );
}

/** Small "label: value" row used in money breakdowns. */
export function Row({ label, value, strong, muted, className }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1.5 text-sm', strong && 'font-semibold text-ink-900 dark:text-white', muted && 'text-ink-500', className)}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 text-end">{value}</span>
    </div>
  );
}

export function useMyBrand() {
  return useQuery({ queryKey: ['brand', 'me'], queryFn: () => api<MyBrand>('/brands/me'), staleTime: 60_000 });
}

export function useLocations() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['brand', 'locations'],
    queryFn: () => api<BrandLocation[]>('/brands/me/locations'),
    enabled: can('pickups.read'),
    staleTime: 60_000,
  });
}

export function useZones() {
  return useQuery({ queryKey: ['zones', 'serviceable'], queryFn: () => api<ServiceableZone[]>('/network/zones/serviceable'), staleTime: 10 * 60_000 });
}

/** Whether this brand may create orders right now (pending accounts can't). */
export function useCanCreate() {
  const { me, can } = useAuth();
  const { t } = useI18n();
  if (!can('orders.create')) return { allowed: false, reason: t('brand.common.noPermission') };
  if (me?.brand?.status === 'PENDING') return { allowed: false, reason: t('brand.common.pendingCreate') };
  if (me?.brand?.status === 'SUSPENDED') return { allowed: false, reason: t('brand.common.suspendedCreate') };
  return { allowed: true, reason: '' };
}

/** Client-side CSV download (UTF-8 BOM so Excel shows Arabic correctly). */
export function downloadCsv(rows: Array<Record<string, unknown>>, filename: string) {
  const csv = Papa.unparse(rows);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function tomorrowCairo(offset = 1) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86_400_000));
}

/** Bilingual name of a zone / city-like record. */
export function nameOf(z: { nameEn: string; nameAr: string } | null | undefined, locale: 'ar' | 'en'): string {
  if (!z) return '—';
  return locale === 'ar' ? z.nameAr || z.nameEn : z.nameEn || z.nameAr;
}

/** Section title used inside cards/forms. */
export function SectionTitle({ icon, title, subtitle, actions }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <div className="min-w-0">
          <h2 className="font-semibold text-ink-900 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Pill toggle group (radio semantics). */
export function Segmented<T extends string>({ value, onChange, options, className, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; className?: string; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-xl bg-ink-100 p-1 dark:bg-ink-800', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === o.value ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-950 dark:text-white' : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
