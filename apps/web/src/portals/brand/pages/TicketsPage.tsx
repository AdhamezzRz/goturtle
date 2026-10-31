import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Headphones, Plus, Search, X } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useDebounced, usePollInterval, useQueryState } from '@/lib/hooks';
import { ago, dateTime } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Badge, Button, DataTable, EmptyState, Input, PageHeader, Pagination, StateBadge, Tabs, type Column } from '@/components/ui';
import { CreateTicketModal } from '../components/tickets';
import type { Ticket } from '../components/types';
import './i18n';

const TABS = { open: { open: true }, resolved: { status: 'RESOLVED' }, closed: { status: 'CLOSED' }, all: {} } as const;
type Tab = keyof typeof TABS;

export default function TicketsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const poll = usePollInterval(30_000);
  const [f, setF] = useQueryState({ tab: 'open', q: '', page: '1', new: '' });
  const [search, setSearch] = useState(f.q);
  const debounced = useDebounced(search, 350);
  useEffect(() => {
    if (debounced !== f.q) setF({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const tab = (f.tab in TABS ? f.tab : 'open') as Tab;
  const query = { ...TABS[tab], q: f.q || undefined, page: Number(f.page) || 1, pageSize: 20 };
  const list = useQuery({ queryKey: ['tickets', 'list', query], queryFn: () => api<Paginated<Ticket>>('/tickets', { query }), placeholderData: keepPreviousData, refetchInterval: poll });

  const columns: Column<Ticket>[] = [
    {
      key: 'subject',
      header: t('brand.support.subject'),
      cell: (tk) => (
        <div className="max-w-[360px]">
          <p className="truncate font-medium text-ink-900 dark:text-white">{tk.subject}</p>
          <p className="text-xs text-ink-500"><span className="ltr font-mono">{tk.code}</span> · {t(`brand.ticketCat.${tk.category}`)}{tk.openedByType === 'CUSTOMER' ? ` · ${t('brand.support.byCustomer')}` : ''}</p>
        </div>
      ),
    },
    { key: 'order', header: t('brand.support.order'), hideBelow: 'lg', cell: (tk) => (tk.order ? <span className="ltr font-mono text-sm">{tk.order.trackingNumber}</span> : <span className="text-ink-400">—</span>) },
    { key: 'priority', header: t('brand.support.priority'), hideBelow: 'md', cell: (tk) => <StateBadge value={tk.priority} /> },
    { key: 'status', header: t('common.status'), cell: (tk) => <div className="flex flex-wrap items-center gap-1"><StateBadge value={tk.status} />{tk.breached && <Badge tone="danger">{t('brand.support.overdue')}</Badge>}</div> },
    { key: 'updated', header: t('brand.support.updated'), hideBelow: 'md', cell: (tk) => <span className="whitespace-nowrap text-xs text-ink-500" title={dateTime(tk.updatedAt)}>{ago(tk.updatedAt)}</span> },
  ];

  return (
    <div>
      <PageHeader title={t('brand.support.title')} subtitle={t('brand.support.subtitle')} actions={can('tickets.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setF({ new: '1' })}>{t('brand.support.new')}</Button>} />
      <Tabs value={tab} onChange={(v) => setF({ tab: v })} tabs={(Object.keys(TABS) as Tab[]).map((k) => ({ value: k, label: t(`brand.support.tab.${k}`) }))} className="mb-4" />
      <Input
        className="mb-4 sm:max-w-sm"
        leading={<Search className="h-4 w-4" />}
        trailing={search ? <button type="button" onClick={() => setSearch('')} aria-label={t('action.clear')}><X className="h-4 w-4" /></button> : undefined}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('brand.support.searchPh')}
        aria-label={t('action.search')}
      />
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(tk) => tk.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(tk) => navigate(`/brand/support/${tk.id}`)}
        mobileCard={(tk) => (
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className={cn('min-w-0 truncate text-sm font-semibold text-ink-900 dark:text-white')}>{tk.subject}</p>
              <StateBadge value={tk.status} />
            </div>
            <p className="text-xs text-ink-500"><span className="ltr font-mono">{tk.code}</span> · {t(`brand.ticketCat.${tk.category}`)} · {ago(tk.updatedAt)}</p>
          </div>
        )}
        empty={
          <EmptyState
            icon={<Headphones className="h-7 w-7" />}
            title={tab === 'open' ? t('brand.support.emptyOpen') : t('common.empty')}
            description={tab === 'open' ? t('brand.support.emptyHint') : undefined}
            action={tab === 'open' && can('tickets.manage') ? <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setF({ new: '1' })}>{t('brand.support.new')}</Button> : undefined}
          />
        }
        footer={list.data && list.data.meta.total > 0 ? <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={(p) => setF({ page: String(p) })} /> : undefined}
      />
      <CreateTicketModal open={f.new === '1'} onClose={() => setF({ new: '' })} />
    </div>
  );
}
