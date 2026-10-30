import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TimelineItem {
  id: string;
  title: ReactNode;
  time?: ReactNode;
  body?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'muted';
  icon?: ReactNode;
}

const dot = {
  default: 'bg-turtle-600 ring-turtle-100',
  success: 'bg-turtle-500 ring-turtle-100',
  warning: 'bg-amber-500 ring-amber-100',
  danger: 'bg-red-500 ring-red-100',
  muted: 'bg-ink-300 ring-ink-100',
};

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn('relative space-y-5 border-s border-ink-200 ps-6 dark:border-ink-700', className)}>
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span className={cn('absolute -start-[31px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full ring-4 dark:ring-ink-900', dot[it.tone ?? 'default'])}>{it.icon}</span>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{it.title}</p>
            {it.time && <time className="text-xs text-ink-400">{it.time}</time>}
          </div>
          {it.body && <div className="mt-1 text-sm text-ink-600 dark:text-ink-300">{it.body}</div>}
        </li>
      ))}
    </ol>
  );
}
