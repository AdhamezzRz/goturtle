import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, CalendarClock, ListChecks, MapPinned, PackageSearch, ScanLine } from 'lucide-react';
import { isValidTrackingNumber, maskPhone, normalizeTrackingNumber } from '@goturtle/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui';
import { CustomerShell, Panel, useCustomerSession, VerifyPhone } from '../components';
import '../i18n';

export default function TrackLandingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [session] = useCustomerSession();
  const [tn, setTn] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'track' | 'orders'>('track');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = normalizeTrackingNumber(tn);
    if (!/^GT\d{10}$/.test(n)) return setError(t('customer.landing.errFormat'));
    if (!isValidTrackingNumber(n)) return setError(t('customer.landing.errCheck'));
    setError('');
    navigate(`/t/${n}`);
  };

  return (
    <CustomerShell>
      <div className="pt-6 text-center sm:pt-10">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-turtle-500 to-turtle-700 text-white shadow-lg shadow-turtle-700/25">
          <PackageSearch className="h-8 w-8" />
        </span>
        <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight text-ink-900 dark:text-white sm:text-4xl">{t('customer.landing.title')}</h1>
        <p className="mx-auto mt-2 max-w-sm text-ink-500">{t('customer.landing.subtitle')}</p>
      </div>

      <div className="mx-auto mt-8 grid grid-cols-2 rounded-2xl bg-ink-100 p-1 dark:bg-ink-800" role="tablist">
        {(['track', 'orders'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn('rounded-xl py-2.5 text-sm font-semibold transition', mode === m ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-950 dark:text-white' : 'text-ink-500')}
          >
            {t(`customer.landing.mode.${m}`)}
          </button>
        ))}
      </div>

      {mode === 'track' ? (
        <Panel className="mt-4">
          <form onSubmit={submit} noValidate>
            <label htmlFor="tn" className="mb-2 block text-sm font-medium text-ink-700 dark:text-ink-200">{t('customer.landing.label')}</label>
            <div className="relative" dir="ltr">
              <ScanLine className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" />
              <input
                id="tn"
                value={tn}
                onChange={(e) => { setTn(e.target.value.toUpperCase()); setError(''); }}
                placeholder="GT0000000000"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                aria-invalid={!!error}
                aria-describedby={error ? 'tn-err' : undefined}
                className={cn(
                  'block h-14 w-full rounded-2xl border-2 bg-white pl-12 pr-4 font-mono text-xl font-semibold tracking-wider text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-4 dark:bg-ink-950 dark:text-white',
                  error ? 'border-red-400 focus:ring-red-500/15' : 'border-ink-200 focus:border-turtle-500 focus:ring-turtle-500/15 dark:border-ink-700',
                )}
              />
            </div>
            {error && <p id="tn-err" className="mt-2 text-sm font-medium text-red-600">{error}</p>}
            <p className="mt-2 text-xs text-ink-500">{t('customer.landing.hint')}</p>
            <Button type="submit" block size="xl" className="mt-4" iconEnd={<ArrowRight className="h-5 w-5 rtl:rotate-180" />}>{t('customer.landing.cta')}</Button>
          </form>
        </Panel>
      ) : (
        <Panel className="mt-4">
          {session ? (
            <div className="space-y-4 text-center">
              <p className="text-ink-600 dark:text-ink-300">{t('customer.landing.signedInAs')} <span className="ltr font-semibold text-ink-900 dark:text-white">{maskPhone(session.customer.phone)}</span></p>
              <Link to="/track/orders"><Button block size="lg" iconEnd={<ArrowRight className="h-5 w-5 rtl:rotate-180" />}>{t('customer.landing.myOrders')}</Button></Link>
            </div>
          ) : (
            <>
              <p className="mb-1 font-semibold text-ink-900 dark:text-white">{t('customer.landing.ordersTitle')}</p>
              <p className="mb-4 text-sm text-ink-500">{t('customer.landing.ordersHint')}</p>
              <VerifyPhone onVerified={() => navigate('/track/orders')} compact />
            </>
          )}
        </Panel>
      )}

      <ul className="mt-8 grid grid-cols-2 gap-3 text-sm">
        {[
          { icon: <MapPinned />, k: 'live' },
          { icon: <CalendarClock />, k: 'reschedule' },
          { icon: <Bell />, k: 'sms' },
          { icon: <ListChecks />, k: 'all' },
        ].map((f) => (
          <li key={f.k} className="flex items-start gap-2.5 rounded-2xl bg-white/70 p-3 ring-1 ring-ink-100 dark:bg-ink-900/60 dark:ring-ink-800">
            <span className="mt-0.5 text-turtle-600 dark:text-turtle-400 [&>svg]:h-5 [&>svg]:w-5">{f.icon}</span>
            <span className="text-ink-700 dark:text-ink-200">{t(`customer.landing.feature.${f.k}`)}</span>
          </li>
        ))}
      </ul>
    </CustomerShell>
  );
}
