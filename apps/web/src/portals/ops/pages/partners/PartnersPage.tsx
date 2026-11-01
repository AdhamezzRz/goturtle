import { useState } from 'react';
import { Handshake, Pencil, Plus, Truck, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useQueryState } from '@/lib/hooks';
import { money, num } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, Select, Skeleton, Tabs, type Column } from '@/components/ui';
import { RequirePermission } from '@/portals/ops/components/opsb';
import { usePartners } from '@/features/intake/partners/data';
import { PartnerEditor } from '@/features/intake/partners/PartnerEditor';
import { HandoffQueue } from '@/features/intake/partners/HandoffQueue';
import { PartnerShipments } from '@/features/intake/partners/PartnerShipments';
import { PartnerCustody } from '@/features/intake/partners/PartnerCustody';
import type { Partner } from '@/features/intake/types';
import '@/features/intake/i18n';

type Tab = 'partners' | 'queue' | 'shipments' | 'custody';

/** Partner carriers: nationwide coverage beyond our own fleet. */
export default function PartnersPage() {
  return (
    <RequirePermission permission="dispatch.manage">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [s, setS] = useQueryState({ tab: 'partners', partner: '' });
  const tab = (['partners', 'queue', 'shipments', 'custody'].includes(s.tab) ? s.tab : 'partners') as Tab;
  const q = usePartners();
  const [edit, setEdit] = useState<Partner | 'new' | null>(null);
  const partners = q.data ?? [];
  const current = partners.find((p) => p.id === s.partner) ?? partners.find((p) => p.isActive) ?? partners[0];
  const manage = can('network.manage');

  const columns: Column<Partner>[] = [
    { key: 'name', header: t('intake.pt.c.partner'), cell: (p) => <div><p className="font-semibold text-ink-900 dark:text-white">{p.name}</p><p className="ltr text-start font-mono text-xs text-ink-500">{p.code} · {p.courier?.code}</p></div> },
    { key: 'cov', header: t('intake.pt.c.coverage'), hideBelow: 'md', cell: (p) => (p.governorateCodes.length ? <div className="flex max-w-[220px] flex-wrap gap-1">{p.governorateCodes.map((g) => <Badge key={g} className="font-mono">{g}</Badge>)}</div> : <span className="text-xs text-ink-500">{t('intake.pt.nationwide')}</span>) },
    { key: 'fee', header: t('intake.pt.c.fee'), hideBelow: 'lg', cell: (p) => <span className="ltr text-sm">{money(p.effectiveFeeCents)}{p.feeCents === null && <span className="text-xs text-ink-400"> · {t('intake.pt.default')}</span>}</span> },
    { key: 'active', header: t('intake.pt.c.active'), align: 'end', cell: (p) => <span className="font-semibold">{num(p.stats.active)}</span> },
    { key: 'delivered', header: t('intake.pt.c.delivered'), align: 'end', hideBelow: 'sm', cell: (p) => <span>{num(p.stats.delivered)}</span> },
    { key: 'custody', header: t('intake.pt.c.custody'), align: 'end', hideBelow: 'md', cell: (p) => <span className="ltr font-semibold text-sand-700 dark:text-sand-300">{money(p.custodyCents)}</span> },
    { key: 'status', header: t('common.status'), cell: (p) => (p.isActive ? <Badge tone="success" dot>{t('state.ACTIVE')}</Badge> : <Badge dot>{t('intake.pt.inactive')}</Badge>) },
    {
      key: 'a', header: '', align: 'end', cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" icon={<Truck className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); setS({ tab: 'shipments', partner: p.id }); }}>{t('intake.pt.shipments')}</Button>
          {manage && <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} aria-label={t('action.edit')} onClick={(e) => { e.stopPropagation(); setEdit(p); }} />}
        </div>
      ),
    },
  ];
  const totals = partners.reduce((a, p) => ({ active: a.active + p.stats.active, delivered: a.delivered + p.stats.delivered, custody: a.custody + p.custodyCents, fees: a.fees + p.feesPayableCents }), { active: 0, delivered: 0, custody: 0, fees: 0 });

  const picker = (
    <Select
      className="sm:w-64"
      aria-label={t('intake.pt.partner')}
      value={current?.id ?? ''}
      onChange={(e) => setS({ partner: e.target.value })}
      options={partners.map((p) => ({ value: p.id, label: `${p.name}${p.isActive ? '' : ` (${t('intake.pt.inactive')})`}` }))}
    />
  );

  return (
    <div>
      <PageHeader
        title={t('intake.pt.title')}
        subtitle={t('intake.pt.subtitle')}
        actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('intake.pt.new')}</Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('intake.pt.k.partners')} value={num(partners.filter((p) => p.isActive).length)} icon={<Handshake className="h-5 w-5" />} />
        <KpiCard label={t('intake.pt.k.withPartners')} value={num(totals.active)} icon={<Truck className="h-5 w-5" />} tone="sky" />
        <KpiCard label={t('intake.pt.k.custody')} value={money(totals.custody, { compact: true })} icon={<Wallet className="h-5 w-5" />} tone="sand" />
        <KpiCard label={t('intake.pt.k.fees')} value={money(totals.fees, { compact: true })} icon={<Wallet className="h-5 w-5" />} tone="violet" />
      </div>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(v) => setS({ tab: v })}
        tabs={[
          { value: 'partners', label: t('intake.pt.tab.partners'), count: partners.length },
          { value: 'queue', label: t('intake.pt.tab.queue') },
          { value: 'shipments', label: t('intake.pt.tab.shipments'), count: totals.active || undefined },
          { value: 'custody', label: t('intake.pt.tab.custody') },
        ]}
      />
      {tab === 'partners' && (
        <DataTable
          columns={columns}
          rows={q.data}
          rowKey={(p) => p.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          onRowClick={(p) => setS({ tab: 'shipments', partner: p.id })}
          empty={<EmptyState icon={<Handshake className="h-7 w-7" />} title={t('intake.pt.empty')} description={t('intake.pt.emptyHint')} action={manage ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>{t('intake.pt.new')}</Button> : undefined} />}
          mobileCard={(p) => (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{p.name} <span className="ltr font-mono text-xs text-ink-500">{p.code}</span></p>
                <p className="text-xs text-ink-500">{p.governorateCodes.length ? p.governorateCodes.join(' · ') : t('intake.pt.nationwide')}</p>
                <p className="mt-1 text-xs">{t('intake.pt.c.active')}: <b>{num(p.stats.active)}</b> · {t('intake.pt.c.custody')}: <b className="ltr">{money(p.custodyCents)}</b></p>
              </div>
              {columns[6].cell(p)}
            </div>
          )}
        />
      )}
      {tab === 'queue' && <HandoffQueue />}
      {(tab === 'shipments' || tab === 'custody') && (
        q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !current ? (
          <Card><EmptyState icon={<Handshake className="h-7 w-7" />} title={t('intake.pt.empty')} description={t('intake.pt.emptyHint')} /></Card>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">{picker}<span className="text-sm text-ink-500">{t('intake.pt.pickerHint', { code: current.courier?.code ?? '' })}</span></div>
            {tab === 'shipments' ? <PartnerShipments partner={current} /> : <PartnerCustody partner={current} />}
          </div>
        )
      )}
      <PartnerEditor open={!!edit} partner={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
    </div>
  );
}
