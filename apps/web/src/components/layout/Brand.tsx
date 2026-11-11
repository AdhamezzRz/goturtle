import { cn } from '@/lib/cn';
import { ArchTile, Wordmark } from '@/components/brand';

/**
 * GoTurtle logo. Default: ink wordmark (white in dark mode). `light`: lime wordmark for
 * deep-green / ink surfaces (brand book page 5). `compact`: the arch app tile only.
 */
export function Logo({ className, compact, light, size = 'md' }: { className?: string; compact?: boolean; light?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  if (compact) return <ArchTile className={cn(size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9', className)} />;
  const h = size === 'sm' ? 'h-6' : size === 'xl' ? 'h-14' : size === 'lg' ? 'h-10' : 'h-8';
  return (
    <span className={cn('inline-flex items-center', className)}>
      <Wordmark className={cn(h, light ? 'text-lime-300' : 'text-ink-950 dark:text-white')} title="GoTurtle" />
    </span>
  );
}
