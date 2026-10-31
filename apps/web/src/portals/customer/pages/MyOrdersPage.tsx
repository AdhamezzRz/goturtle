import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, LogOut, PackageOpen, Star } from 'lucide-react';
import { CUSTOMER_STEPS, maskPhone } from '@goturtle/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePollInterval } from '@/lib/hooks';
import { dateOnly, money } from '@/lib/format';
import { useI18n } from '@/i18n';
import { Badge, Button, Skeleton } from '@/components/ui';
import { CustomerShell, Panel, useCustomerSession } from '../components';
import type { MyOrders } from '../types';
import '../i18n';

const TONE = { DELIVERED: 'success', RETURNED: 'neutral', CANCELLED: 'neutral', FAILED_ATTEMPT: 'warning', RESCHEDULED: 'warning', ON_HOLD: 'warning', OUT_FOR_DELIVERY: 'progress', LOST: 'danger', DAMAGED: 'danger', RETURN_PENDING: 'danger', RETURN_OUT: 'danger' } as const;

export default function MyOrdersPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [session, setSession] = useCustomerSession();
  const poll = usePollInterval(60_000);
  const q = useQuery({ queryKey: ['track', 'me', session?.accessToken], queryFn: () => api<MyOrders>('/track/me/orders', { auth: 'customer' }), enabled: !!session, refetchInterval: poll, retry: false });
  if (!session || (q.error instanceof ApiError && q.error.status === 401)) return <Navigate to="/track" replace />;
  const orders = q.data?.orders ?? [];
  const active = orders.filter((o) => o.step >= 0 && o.step < 4);
  const past = orders.filter((o) => !(o.step >= 0 && o.step < 4));

  const card = (o: MyOrders['orders'][number]) => (
    <li key={o.trackingNumber}>
      <button type="button" onClick={() => navigate(`/t/${o.trackingNumber}`)} className="flex w-full items-center gap-3 rounded-3xl border border-ink-100 bg-white p-4 text-start shadow-card transition hover:border-turtle-300 active:scale-[0.99] dark:border-ink-800 dark:bg-ink-900">
        {o.brand.logoUrl ? <img src={o.brand.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-turtle-500 to-turtle-700 font-display text-lg font-bold text-white">{o.brand.name.slice(0, 1)}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold text-ink-900 dark:text-white">{o.brand.name}</span>
            <Badge tone={TONE[o.status as keyof typeof TONE] ?? 'info'}>{locale === 'ar' ? o.statusLabel.ar : o.statusLabel.en}</Badge>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-ink-500">
            <span className="ltr font-mono">{o.trackingNumber}</span>
            <span>{o.deliveredAt ? dateOnly(o.deliveredAt) : dateOnly(o.createdAt)}</span>
          </span>
          {o.step >= 0 && o.step < 4 && (
            <span className="mt-2 flex gap-1" aria-hidden>
              {CUSTOMER_STEPS.map((s, i) => <span key={s} className={cn('h-1.5 flex-1 rounded-full', i <= o.step ? 'bg-turtle-500' : 'bg-ink-100 dark:bg-ink-800')} />)}
            </span>
          )}
          <span className="mt-2 flex items-center justify-between gap-2 text-xs">
            {o.paymentMethod === 'COD' && o.collectCents > 0 && o.step >= 0 && o.step < 4 ? <span className="ltr font-semibold text-ink-700 dark:text-ink-200">{money(o.collectCents)}</span> : <span />}
            {o.can.rate ? <span className="inline-flex items-center gap-1 font-semibold text-sand-700 dark:text-sand-300"><Star className="h-3.5 w-3.5" />{t('customer.orders.rateNow')}</span> : o.rating ? <span className="inline-flex items-center gap-0.5 text-ink-400"><Star className="h-3 w-3 fill-sand-400 text-sand-400" />{o.rating}</span> : null}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-ink-300 rtl:rotate-180" />
      </button>
    </li>
  );

  return (
    <CustomerShell>
      <div className="mb-5 flex items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-ink-900 dark:text-white">{t('customer.orders.title')}</h1>
          <p className="text-sm text-ink-500"><span className="ltr">{maskPhone(session.customer.phone)}</span></p>
        </div>
        <Button variant="ghost" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={() => { setSession(null); navigate('/track'); }}>{t('customer.orders.signOut')}</Button>
      </div>
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-3xl" />)}</div>
      ) : q.isError ? (
        <Panel className="text-center"><p className="font-semibold">{t('error.generic')}</p><Button className="mt-3" variant="outline" onClick={() => q.refetch()}>{t('action.retry')}</Button></Panel>
      ) : !orders.length ? (
        <Panel className="py-10 text-center">
          <PackageOpen className="mx-auto h-12 w-12 text-ink-300" />
          <p className="mt-3 font-semibold text-ink-900 dark:text-white">{t('customer.orders.empty')}</p>
          <p className="mt-1 text-sm text-ink-500">{t('customer.orders.emptyHint')}</p>
          <Link to="/track" className="mt-5 inline-block"><Button variant="outline">{t('customer.landing.cta')}</Button></Link>
        </Panel>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('customer.orders.active', { n: active.length })}</h2>
              <ul className="space-y-3">{active.map(card)}</ul>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('customer.orders.past')}</h2>
              <ul className="space-y-3">{past.map(card)}</ul>
            </section>
          )}
        </div>
      )}
    </CustomerShell>
  );
}
