import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import { ORDER_STATUS_TONE, type OrderStatus, type StatusTone } from '@goturtle/shared';
import { cn } from '@/lib/cn';
import { statusLabel } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Button } from './Button';

export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', padded && 'p-5', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

const toneClasses: Record<StatusTone | 'cash', string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:ring-ink-700',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900',
  progress: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900',
  success: 'bg-turtle-50 text-turtle-700 ring-turtle-200 dark:bg-turtle-950 dark:text-turtle-300 dark:ring-turtle-900',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  danger: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900',
  cash: 'bg-sand-50 text-sand-800 ring-sand-200',
};

export type BadgeTone = keyof typeof toneClasses;

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', toneClasses[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge tone={ORDER_STATUS_TONE[status] ?? 'neutral'} dot className={className}>
      {statusLabel(status)}
    </Badge>
  );
}

/** Generic status → tone mapper for non-order entities (runsheets, payouts, tickets…). */
export function StateBadge({ value, map, label }: { value: string; map?: Record<string, BadgeTone>; label?: string }) {
  const { t } = useI18n();
  const defaults: Record<string, BadgeTone> = {
    ACTIVE: 'success', COMPLETED: 'success', CONFIRMED: 'success', PAID: 'success', SUCCESS: 'success', APPROVED: 'success', RESOLVED: 'success', ONLINE: 'success', SENT: 'success',
    PENDING: 'warning', DRAFT: 'neutral', REQUESTED: 'warning', SCHEDULED: 'info', ASSIGNED: 'info', DISPATCHED: 'progress', IN_PROGRESS: 'progress', OPEN: 'warning', QUEUED: 'info', BUSY: 'progress', ON_BREAK: 'warning', WAITING_ON_CUSTOMER: 'warning',
    FAILED: 'danger', REJECTED: 'danger', SUSPENDED: 'danger', CANCELLED: 'neutral', DEAD: 'danger', MISSED: 'danger', OFFLINE: 'neutral', CLOSED: 'neutral', OFFBOARDED: 'neutral', PAUSED: 'warning', ERROR: 'danger',
    URGENT: 'danger', HIGH: 'warning', MEDIUM: 'info', LOW: 'neutral',
  };
  return <Badge tone={map?.[value] ?? defaults[value] ?? 'neutral'} dot>{label ?? t(`state.${value}`)}</Badge>;
}

export function RiskBadge({ score }: { score: number }) {
  const { t } = useI18n();
  const level = score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
  return (
    <Badge tone={level === 'HIGH' ? 'danger' : level === 'MEDIUM' ? 'warning' : 'success'}>
      {t(`risk.${level}`)} · {score}
    </Badge>
  );
}

export function KpiCard({
  label, value, hint, icon, trend, tone = 'turtle', className,
}: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; trend?: number | null; tone?: 'turtle' | 'sand' | 'ink' | 'red' | 'violet' | 'sky'; className?: string;
}) {
  const tones = {
    turtle: 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300',
    sand: 'bg-sand-50 text-sand-700',
    ink: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
    red: 'bg-red-50 text-red-700',
    violet: 'bg-violet-50 text-violet-700',
    sky: 'bg-sky-50 text-sky-700',
  };
  return (
    <Card className={cn('flex items-start gap-4', className)}>
      {icon && <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', tones[tone])}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-500">{label}</p>
        <p className="mt-1 truncate font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{value}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
          {trend !== undefined && trend !== null && Number.isFinite(trend) && (
            <span className={cn('inline-flex items-center gap-0.5 font-semibold', trend >= 0 ? 'text-turtle-600' : 'text-red-600')}>
              {trend >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(trend * 100).toFixed(1)}%
            </span>
          )}
          {hint}
        </div>
      </div>
    </Card>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-turtle-600', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse2 rounded-lg bg-ink-100 dark:bg-ink-800', className)} />;
}

export function PageLoader() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-ink-500">
      <Spinner className="h-7 w-7" />
      <span className="text-sm">{t('common.loading')}</span>
    </div>
  );
}

export function EmptyState({ title, description, icon, action, className }: { title?: ReactNode; description?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-ink-400 dark:bg-ink-800">{icon ?? <Inbox className="h-7 w-7" />}</div>
      <p className="font-semibold text-ink-800 dark:text-ink-100">{title ?? t('common.empty')}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const msg = (error as { message?: string })?.message ?? t('error.generic');
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="font-semibold text-ink-800 dark:text-ink-100">{t('error.generic')}</p>
      <p className="mt-1 max-w-md text-sm text-ink-500">{msg}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          {t('action.retry')}
        </Button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-sm text-ink-500">{breadcrumb}</div>}
        <h1 className="truncate font-display text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DescriptionList({ items, cols = 2 }: { items: Array<{ label: ReactNode; value: ReactNode; full?: boolean }>; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {items.map((it, i) => (
        <div key={i} className={cn(it.full && 'sm:col-span-full')}>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{it.label}</dt>
          <dd className="mt-1 text-sm text-ink-900 dark:text-ink-100">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  if (src) return <img src={src} alt={name} width={size} height={size} className={cn('rounded-full object-cover', className)} style={{ width: size, height: size }} />;
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 55% 42%)` }}
    >
      {initials || '?'}
    </span>
  );
}

export function ProgressBar({ value, tone = 'turtle', className }: { value: number; tone?: 'turtle' | 'sand' | 'red'; className?: string }) {
  const pctValue = Math.max(0, Math.min(1, value)) * 100;
  const bar = { turtle: 'bg-turtle-500', sand: 'bg-sand-400', red: 'bg-red-500' }[tone];
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800', className)}>
      <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${pctValue}%` }} />
    </div>
  );
}
