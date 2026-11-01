import { useQuery } from '@tanstack/react-query';
import { Gavel, PauseCircle, PhoneCall, ShieldCheck, Undo2, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { num, pct } from '@/lib/format';
import { usePollInterval, useQueryState } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { PageHeader, Tabs } from '@/components/ui';
import { Kpi, NoAccess } from '../../components/opsa/ui';
import { ConfirmationsTab, HoldsTab } from '@/features/integrity/ops/QueueTabs';
import { DisputesTab } from '@/features/integrity/ops/DisputesTab';
import { HeroesTab, NetworkTab } from '@/features/integrity/ops/PeopleTabs';
import type { Overview } from '@/features/integrity/types';
import '@/features/integrity/i18n';

const TABS = ['holds', 'confirmations', 'disputes', 'heroes', 'network'] as const;
type Tab = (typeof TABS)[number];

/**
 * Ops delivery integrity: RTO shield KPIs, the hold queue, pending
 * confirmations, attempt disputes with evidence, hero integrity scores and
 * the network blocklist.
 */
export default function IntegrityPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [s, setS] = useQueryState({ tab: 'holds' });
  const poll = usePollInterval(60_000);
  const q = useQuery({ queryKey: ['integrity', 'overview'], queryFn: () => api<Overview>('/integrity/overview'), refetchInterval: poll, enabled: can('orders.read') });
  if (!can('orders.read')) return <NoAccess />;
  const o = q.data;
  const tab: Tab = (TABS as readonly string[]).includes(s.tab) ? (s.tab as Tab) : 'holds';
  const visible = TABS.filter((x) => x !== 'heroes' || can('couriers.read'));
  const rate = (r: number | null | undefined) => (r == null ? '—' : pct(r));
  const rtoTrend = o?.rto.change;

  return (
    <div className="space-y-6">
      <PageHeader title={t('integrity.title')} subtitle={t('integrity.subtitle')} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          loading={q.isLoading}
          icon={<PhoneCall />}
          tone="amber"
          label={t('integrity.kpi.pending')}
          value={num(o?.confirmations.pending)}
          hint={o ? t('integrity.kpi.blocked', { n: num(o.confirmations.blockedForDispatch) }) : undefined}
          emphasis={!!o?.confirmations.blockedForDispatch}
        />
        <Kpi
          loading={q.isLoading}
          icon={<ShieldCheck />}
          tone="turtle"
          label={t('integrity.kpi.rate')}
          value={rate(o?.confirmations.confirmationRate)}
          hint={o ? t('integrity.kpi.rateHint', { c: num(o.confirmations.last30.confirmed + o.confirmations.last30.rescheduled), d: num(o.confirmations.last30.declined), n: num(o.confirmations.last30.noResponse) }) : undefined}
        />
        <Kpi loading={q.isLoading} icon={<PauseCircle />} tone="sand" label={t('integrity.kpi.holds')} value={num(o?.holds.total)} hint={o ? t('integrity.kpi.noResponse', { n: num(o.confirmations.noResponse) }) : undefined} />
        <Kpi
          loading={q.isLoading}
          icon={<Gavel />}
          tone="violet"
          label={t('integrity.kpi.disputes')}
          value={num(o?.disputes.open)}
          hint={o ? t('integrity.kpi.upheld', { n: num(o.disputes.upheld30), r: num(o.disputes.rejected30) }) : undefined}
          emphasis={!!o?.disputes.open}
        />
        <Kpi
          loading={q.isLoading}
          icon={<Undo2 />}
          tone={rtoTrend != null && rtoTrend > 0 ? 'red' : 'sky'}
          label={t('integrity.kpi.rto')}
          value={rate(o?.rto.last30.rate)}
          hint={o ? <span>{t('integrity.kpi.rtoPrev', { p: rate(o.rto.previous30.rate) })}{rtoTrend != null && <b className={rtoTrend > 0 ? 'ms-1 text-red-600' : 'ms-1 text-turtle-600'}><span className="ltr">{rtoTrend > 0 ? '▲' : '▼'} {pct(Math.abs(rtoTrend))}</span></b>}</span> : undefined}
        />
        <Kpi loading={q.isLoading} icon={<UserX />} tone="red" label={t('integrity.kpi.blocklist')} value={num(o?.customers.blocklisted)} hint={o ? t('integrity.kpi.prepay', { n: num(o.customers.prepayOnly) }) : undefined} />
      </div>

      <Tabs
        value={tab}
        onChange={(v) => setS({ tab: v })}
        tabs={visible.map((v) => ({
          value: v,
          label: t(`integrity.tab.${v}`),
          count: v === 'holds' ? o?.holds.total : v === 'confirmations' ? o ? o.confirmations.pending + o.confirmations.noResponse : undefined : v === 'disputes' ? o?.disputes.open : undefined,
        }))}
      />
      {tab === 'holds' && <HoldsTab />}
      {tab === 'confirmations' && <ConfirmationsTab />}
      {tab === 'disputes' && <DisputesTab />}
      {tab === 'heroes' && can('couriers.read') && <HeroesTab />}
      {tab === 'network' && <NetworkTab />}
    </div>
  );
}
