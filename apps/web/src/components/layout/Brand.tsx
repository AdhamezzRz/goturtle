import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';

export function Logo({ className, compact, light }: { className?: string; compact?: boolean; light?: boolean }) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <img src="/turtle.svg" alt="" className="h-9 w-9 rounded-xl shadow-sm" />
      {!compact && (
        <span className={cn('font-display text-lg font-extrabold tracking-tight', light ? 'text-white' : 'text-ink-900 dark:text-white')}>
          {t('app.name')}
        </span>
      )}
    </span>
  );
}
