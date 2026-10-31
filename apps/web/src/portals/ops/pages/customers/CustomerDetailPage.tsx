import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Ban, CheckCircle2, PackageSearch, ShieldCheck } from 'lucide-react';
import type { OrderStatus } from '@goturtle/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateOnly, dateTime, money, num, pct } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Badge, Button, ConfirmDialog, DataTable, ErrorState, Field, Skeleton, StatusBadge, Textarea } from '@/components/ui';
import { CallButton, Gauge, LinkButton, MiniStat, Mono, NoAccess, PhoneLink, SectionCard } from '../../components/opsa/ui';
import type { CustomerRow } from '../../components/opsa/types';
import '../orders/i18n';
import './i18n';

interface CustomerDetail extends CustomerRow {
  stats: {
    totalOrders: number; delivered: number; refused: number; returned: number; cancelled: number; active: number; byStatus: Record<string, number>;
    successRate: number | null; collectedCents: number; avgCodCents: number; failedAttempts: number; brandsCount: number; firstOrderAt: string | null; lastOrderAt: string | null;
  };
  recentOrders: Array<{
    id: string; trackingNumber: string; status: OrderStatus; type: string; paymentMethod: string; codAmountCents: number; collectCents: number; attempts: number; addressLine: string;
    createdAt: string; deliveredAt: string | null; rating: number | null; brand: { id: string; code: string; name: string } | null; zone: { code: string; nameEn: string; nameAr: string } | null;
  }>;
}

const toIso = (s: string | null) => (s ? s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z') : null);

export default function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { t, dir, locale } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`), enabled: can('orders.read') });
  const c = q.data;
  const toggle = useMutation({
    mutationFn: () => api(`/customers/${id}/${c?.isBlocked ? 'unblock' : 'block'}`, { method: 'POST', body: c?.isBlocked ? {} : { reason: reason || undefined } }),
    onSuccess: () => {
      toast.success(c?.isBlocked ? t('ops.customers.d.unblocked') : t('ops.customers.d.blocked'));
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: ['customer', id] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  if (!can('orders.read')) return <NoAccess />;
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>;
  if (q.error || !c) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = c.stats;

  return (
    <div className="space-y-6">
      <Link to="/ops/customers" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"><Back className="h-4 w-4" /> {t('ops.customers.d.back')}</Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900 lg:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar name={c.name} size={56} />
              <div className="min-w-0">
                <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold">{c.name}{c.isBlocked && <Badge tone="danger">{t('ops.customers.blocked')}</Badge>}</h1>
                <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
                  <PhoneLink value={c.phone} />
                  {c.altPhone && <span className="text-ink-500">{t('ops.customers.d.altPhone')}: <PhoneLink value={c.altPhone} /></span>}
                  {c.email && <span className="ltr text-ink-500">{c.email}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CallButton value={c.phone} name={c.name} size="md" />
              {can('orders.update') && (
                c.isBlocked
                  ? <Button variant="outline" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setConfirm(true)}>{t('ops.customers.d.unblock')}</Button>
                  : <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => { setReason(''); setConfirm(true); }}>{t('ops.customers.d.block')}</Button>
              )}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label={t('ops.customers.d.total')} value={num(s.totalOrders)} />
            <MiniStat label={t('ops.customers.d.delivered')} value={num(s.delivered)} tone="success" />
            <MiniStat label={t('ops.customers.d.refused')} value={num(s.refused)} tone={s.refused ? 'danger' : undefined} />
            <MiniStat label={t('ops.customers.d.returned')} value={num(s.returned)} />
            <MiniStat label={t('ops.customers.d.active')} value={num(s.active)} />
            <MiniStat label={t('ops.customers.d.cancelled')} value={num(s.cancelled)} />
            <MiniStat label={t('ops.customers.d.success')} value={s.successRate == null ? '—' : pct(s.successRate > 1 ? s.successRate / 100 : s.successRate)} />
            <MiniStat label={t('ops.customers.d.failedAttempts')} value={num(s.failedAttempts)} />
            <MiniStat label={t('ops.customers.d.collected')} value={money(s.collectedCents)} tone="cash" />
            <MiniStat label={t('ops.customers.d.avgCod')} value={money(s.avgCodCents)} />
            <MiniStat label={t('ops.customers.d.brands')} value={num(s.brandsCount)} />
            <MiniStat label={t('ops.customers.d.last')} value={s.lastOrderAt ? dateOnly(toIso(s.lastOrderAt)) : '—'} />
          </div>
        </div>
        <SectionCard title={t('ops.customers.d.score')} subtitle={t('ops.customers.d.scoreHint')}>
          <div className="flex flex-col items-center gap-2 py-2">
            <Gauge value={c.reliabilityScore} size={200} label={t(`ops.opsa.reliability.${c.reliabilityLevel}`)} sublabel={s.firstOrderAt ? `${t('ops.customers.d.first')}: ${dateOnly(toIso(s.firstOrderAt))}` : undefined} />
            {c.reliabilityLevel === 'GOOD' && <p className="flex items-center gap-1.5 text-sm text-turtle-700 dark:text-turtle-400"><CheckCircle2 className="h-4 w-4" />{t('ops.opsa.reliability.GOOD')}</p>}
          </div>
        </SectionCard>
      </div>

      <SectionCard title={t('ops.customers.d.history')} padded={false} actions={<LinkButton to={`/ops/orders?customer=${c.id}`} icon={<PackageSearch />}>{t('ops.customers.d.allOrders')}</LinkButton>}>
        <div className="p-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
          <DataTable
            columns={[
              { key: 'tn', header: t('ops.orders.col.tracking'), cell: (o) => <div><Mono className="font-semibold">{o.trackingNumber}</Mono><p className="text-xs text-ink-500">{o.brand?.name}</p></div> },
              { key: 'st', header: t('ops.orders.col.status'), cell: (o) => <StatusBadge status={o.status} /> },
              { key: 'z', header: t('ops.orders.col.zone'), hideBelow: 'lg', cell: (o) => (o.zone ? (locale === 'ar' ? o.zone.nameAr : o.zone.nameEn) : '—') },
              { key: 'cod', header: t('ops.orders.col.cod'), cell: (o) => <span className="ltr font-semibold text-sand-700 dark:text-sand-300">{o.collectCents ? money(o.collectCents) : '—'}</span> },
              { key: 'at', header: t('ops.orders.col.created'), hideBelow: 'md', cell: (o) => <span className="text-xs text-ink-500">{dateTime(o.createdAt)}</span> },
            ]}
            rows={c.recentOrders}
            rowKey={(o) => o.id}
            onRowClick={(o) => navigate(`/ops/orders/${o.id}`)}
            mobileCard={(o) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2"><Mono className="font-semibold">{o.trackingNumber}</Mono><StatusBadge status={o.status} /></div>
                <div className="flex justify-between text-xs text-ink-500"><span>{o.brand?.name} · {dateOnly(o.createdAt)}</span><span className="ltr font-semibold text-sand-700">{o.collectCents ? money(o.collectCents) : ''}</span></div>
              </div>
            )}
          />
        </div>
      </SectionCard>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => toggle.mutate()}
        loading={toggle.isPending}
        danger={!c.isBlocked}
        title={c.isBlocked ? t('ops.customers.d.unblockTitle', { name: c.name }) : t('ops.customers.d.blockTitle', { name: c.name })}
        description={c.isBlocked ? undefined : t('ops.customers.d.blockDesc')}
        confirmLabel={c.isBlocked ? t('ops.customers.d.unblock') : t('ops.customers.d.block')}
      >
        {!c.isBlocked && <Field label={t('ops.customers.d.reason')}>{(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>}
      </ConfirmDialog>
    </div>
  );
}
