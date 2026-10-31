import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { num } from '@/lib/format';
import { Button } from './Button';
import { EmptyState, ErrorState, Skeleton } from './Display';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide below this breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  align?: 'start' | 'end' | 'center';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  selected?: Set<string>;
  onSelectChange?: (next: Set<string>) => void;
  footer?: ReactNode;
  dense?: boolean;
  /**
   * Phone layout: when given, rows render as stacked cards below the `md`
   * breakpoint instead of a horizontally scrolling table.
   */
  mobileCard?: (row: T) => ReactNode;
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, onRowClick, empty, selected, onSelectChange, footer, dense, mobileCard }: DataTableProps<T>) {
  const selectable = !!onSelectChange;
  const allIds = rows?.map(rowKey) ?? [];
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selected?.has(id));
  const toggleAll = () => onSelectChange?.(allSelected ? new Set() : new Set(allIds));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectChange?.(next);
  };
  const pad = dense ? 'px-3 py-2' : 'px-4 py-3';

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
      {mobileCard && (
        <ul className="divide-y divide-ink-100 md:hidden dark:divide-ink-800">
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <li key={`msk${i}`} className="space-y-2 p-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </li>
            ))}
          {!loading &&
            rows?.map((row) => {
              const id = rowKey(row);
              return (
                <li
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('flex items-start gap-3 p-4', onRowClick && 'cursor-pointer active:bg-ink-50 dark:active:bg-ink-800', selected?.has(id) && 'bg-turtle-50/60 dark:bg-turtle-950/30')}
                >
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={selected?.has(id) ?? false}
                      onChange={() => toggle(id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-ink-300 text-turtle-600"
                      aria-label="select row"
                    />
                  )}
                  <div className="min-w-0 flex-1">{mobileCard(row)}</div>
                </li>
              );
            })}
        </ul>
      )}
      <div className={cn('overflow-x-auto', mobileCard && 'hidden md:block')}>
        <table className="min-w-full divide-y divide-ink-100 text-sm dark:divide-ink-800">
          <thead className="bg-ink-50/70 dark:bg-ink-950/40">
            <tr>
              {selectable && (
                <th className={cn(pad, 'w-10')}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-ink-300 text-turtle-600" aria-label="select all" />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(pad, 'whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-ink-500', c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start', c.hideBelow && hide[c.hideBelow], c.className)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk${i}`}>
                  {selectable && <td className={pad} />}
                  {columns.map((c) => (
                    <td key={c.key} className={cn(pad, c.hideBelow && hide[c.hideBelow])}>
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows?.map((row) => {
                const id = rowKey(row);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-turtle-50/40 dark:hover:bg-ink-800/60', selected?.has(id) && 'bg-turtle-50/60 dark:bg-turtle-950/30')}
                  >
                    {selectable && (
                      <td className={pad} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected?.has(id) ?? false} onChange={() => toggle(id)} className="h-4 w-4 rounded border-ink-300 text-turtle-600" aria-label="select row" />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cn(pad, 'align-middle text-ink-700 dark:text-ink-200', c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start', c.hideBelow && hide[c.hideBelow], c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {!loading && error ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error && rows && rows.length === 0 && (typeof empty === 'object' && empty !== null ? empty : <EmptyState title={empty} />)}
      {footer}
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  const { t, dir } = useI18n();
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-ink-100 px-4 py-3 text-sm text-ink-500 dark:border-ink-800">
      <span>{t('common.rows', { n: num(total) })}</span>
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">{t('common.page', { page: num(page), pages: num(totalPages) })}</span>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<Prev className="h-4 w-4" />} aria-label={t('action.previous')} />
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} icon={<Next className="h-4 w-4" />} aria-label={t('action.next')} />
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: ReactNode; count?: number }>; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-ink-100 dark:border-ink-800', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            value === tab.value ? 'border-turtle-600 text-turtle-700 dark:text-turtle-400' : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', value === tab.value ? 'bg-turtle-100 text-turtle-700' : 'bg-ink-100 text-ink-600 dark:bg-ink-800')}>{num(tab.count)}</span>
          )}
        </button>
      ))}
    </div>
  );
}
