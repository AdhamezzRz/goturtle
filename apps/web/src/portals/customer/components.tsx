import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Globe, Loader2, Moon, ShieldCheck, Smartphone, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { maskPhone, normalizeEgyptPhone } from '@goturtle/shared';
import { api, sessionStore, type CustomerSession } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Input } from '@/components/ui';
import './i18n';

export interface PublicSettings {
  company: { name: string; supportPhone: string; supportWhatsapp: string; logoUrl: string; email: string };
  branding: { primaryColor: string };
}

export function usePublicSettings() {
  return useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/settings/public', { auth: 'none' }), staleTime: 10 * 60_000, retry: false });
}

/** Re-renders when the customer session changes (verify / sign out). */
export function useCustomerSession() {
  const [s, setS] = useState<CustomerSession | null>(() => sessionStore.customer());
  useEffect(() => {
    const h = () => setS(sessionStore.customer());
    window.addEventListener('storage', h);
    const id = setInterval(h, 5_000);
    return () => {
      window.removeEventListener('storage', h);
      clearInterval(id);
    };
  }, []);
  return [s, (next: CustomerSession | null) => { sessionStore.setCustomer(next); setS(next); }] as const;
}

/** Minimal, mobile-first frame for public pages (logo, language, theme). */
export function CustomerShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { t, toggle, locale } = useI18n();
  const { dark, toggle: toggleTheme } = useTheme();
  const settings = usePublicSettings();
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-ink-50 dark:bg-ink-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-turtle-100/80 via-turtle-50/40 to-transparent dark:from-turtle-950/70 dark:via-turtle-950/20" />
      <header className="relative z-10 mx-auto flex w-full items-center justify-between px-4 pt-[max(env(safe-area-inset-top),1rem)] sm:px-6" style={{ maxWidth: wide ? 960 : 560 }}>
        <Link to="/track" className="inline-flex items-center gap-2.5" aria-label={t('app.name')}>
          <img src="/turtle.svg" alt="" className="h-9 w-9 rounded-xl shadow-sm" />
          <span className="font-display text-lg font-extrabold tracking-tight text-ink-900 dark:text-white">{t('app.name')}</span>
        </Link>
        <div className="flex items-center gap-1">
          <button type="button" onClick={toggle} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-700 hover:bg-white/70 dark:text-ink-200 dark:hover:bg-ink-800" aria-label={t('common.language')}>
            <Globe className="h-4 w-4" />
            {locale === 'ar' ? 'EN' : 'ع'}
          </button>
          <button type="button" onClick={toggleTheme} className="grid h-10 w-10 place-items-center rounded-xl text-ink-700 hover:bg-white/70 dark:text-ink-200 dark:hover:bg-ink-800" aria-label={t('common.theme')}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>
      <main className="relative z-10 mx-auto w-full flex-1 px-4 pb-10 pt-4 sm:px-6" style={{ maxWidth: wide ? 960 : 560 }}>{children}</main>
      <footer className="relative z-10 mx-auto w-full px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] text-center text-xs text-ink-400 sm:px-6" style={{ maxWidth: 560 }}>
        <p>{t('customer.footer', { name: t('app.name') })}</p>
        {(settings.data?.company.supportPhone || settings.data?.company.email) && (
          <p className="mt-1">
            {settings.data.company.supportPhone && <a className="ltr hover:underline" href={`tel:${settings.data.company.supportPhone}`}>{settings.data.company.supportPhone}</a>}
            {settings.data.company.supportPhone && settings.data.company.email && ' · '}
            {settings.data.company.email && <a className="hover:underline" href={`mailto:${settings.data.company.email}`}>{settings.data.company.email}</a>}
          </p>
        )}
      </footer>
    </div>
  );
}

/** 6-box one-time code input (paste & autofill friendly). */
export function CodeInput({ value, onChange, length = 6, disabled, autoFocus, onComplete }: { value: string; onChange: (v: string) => void; length?: number; disabled?: boolean; autoFocus?: boolean; onComplete?: (v: string) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');
  return (
    <div className="relative" dir="ltr" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={t('customer.otp.code')}
        maxLength={length}
        onChange={(e) => {
          const v = e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '').slice(0, length);
          onChange(v);
          if (v.length === length) onComplete?.(v);
        }}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }} aria-hidden>
        {digits.map((d, i) => {
          const active = i === Math.min(value.length, length - 1);
          return (
            <span
              key={i}
              className={cn(
                'grid h-14 place-items-center rounded-xl border-2 bg-white font-mono text-2xl font-bold text-ink-900 transition dark:bg-ink-900 dark:text-white',
                d.trim() ? 'border-turtle-500' : active ? 'border-turtle-400 ring-4 ring-turtle-500/15' : 'border-ink-200 dark:border-ink-700',
              )}
            >
              {d.trim()}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const RESEND_SECONDS = 45;

/**
 * Phone → SMS code → customer session. With `trackingNumber` the code must be
 * sent to the shipment's recipient phone (unlocks that shipment's actions).
 */
export function VerifyPhone({ trackingNumber, maskedPhone, onVerified, compact }: { trackingNumber?: string; maskedPhone?: string; onVerified: (s: CustomerSession) => void; compact?: boolean }) {
  const { t } = useI18n();
  const [, setSession] = useCustomerSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const e164 = normalizeEgyptPhone(phoneRaw);

  const send = useMutation({
    mutationFn: () => api<{ sent: boolean; expiresInMinutes: number; devCode?: string }>('/auth/customer/otp', { method: 'POST', auth: 'none', body: { phone: phoneRaw, trackingNumber } }),
    onSuccess: (r) => {
      setStep('code');
      setCode('');
      setLeft(RESEND_SECONDS);
      setDevCode(r.devCode ?? null);
      toast.success(t('customer.otp.sent'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const verify = useMutation({
    mutationFn: (c: string) => api<CustomerSession>('/auth/customer/verify', { method: 'POST', auth: 'none', body: { phone: phoneRaw, code: c, trackingNumber } }),
    onSuccess: (s) => {
      const session = { ...s, trackingNumber: trackingNumber ?? null };
      setSession(session);
      toast.success(t('customer.otp.verified'));
      onVerified(session);
    },
    onError: (e) => {
      setCode('');
      toast.error(errorMessage(e));
    },
  });

  if (step === 'code') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300"><Smartphone className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="font-semibold text-ink-900 dark:text-white">{t('customer.otp.enter')}</p>
            <p className="text-sm text-ink-500">{t('customer.otp.sentTo')} <span className="ltr font-medium text-ink-700 dark:text-ink-200">{e164 ? maskPhone(e164) : phoneRaw}</span> · <button type="button" className="font-medium text-turtle-700 hover:underline dark:text-turtle-400" onClick={() => setStep('phone')}>{t('customer.otp.change')}</button></p>
          </div>
        </div>
        <CodeInput value={code} onChange={setCode} autoFocus disabled={verify.isPending} onComplete={(c) => verify.mutate(c)} />
        {devCode && <p className="text-center text-xs text-ink-400">{t('customer.otp.devCode')}: <button type="button" className="ltr font-mono font-semibold text-ink-600 underline dark:text-ink-300" onClick={() => { setCode(devCode); verify.mutate(devCode); }}>{devCode}</button></p>}
        <Button block size="lg" loading={verify.isPending} disabled={code.length < 6} onClick={() => verify.mutate(code)} icon={<ShieldCheck className="h-5 w-5" />}>{t('customer.otp.verify')}</Button>
        <p className="text-center text-sm text-ink-500">
          {left > 0 ? (
            t('customer.otp.resendIn', { s: left })
          ) : (
            <button type="button" className="font-semibold text-turtle-700 hover:underline disabled:opacity-50 dark:text-turtle-400" disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? <Loader2 className="inline h-4 w-4 animate-spin" /> : t('customer.otp.resend')}
            </button>
          )}
        </p>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (e164) send.mutate();
      }}
    >
      {!compact && maskedPhone && <p className="text-sm text-ink-500">{t('customer.otp.hintMasked')} <span className="ltr font-medium text-ink-700 dark:text-ink-200">{maskedPhone}</span></p>}
      <label className="block">
        <span className="sr-only">{t('customer.otp.phone')}</span>
        <Input
          dir="ltr"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phoneRaw}
          onChange={(e) => setPhoneRaw(e.target.value)}
          placeholder="01X XXXX XXXX"
          className="h-12 text-lg"
          invalid={touched && !e164}
          leading={<Smartphone className="h-5 w-5" />}
        />
      </label>
      {touched && !e164 && <p className="text-xs font-medium text-red-600">{t('error.INVALID_PHONE')}</p>}
      <Button type="submit" block size="lg" loading={send.isPending} iconEnd={<ArrowRight className="h-5 w-5 rtl:rotate-180" />}>{t('customer.otp.send')}</Button>
    </form>
  );
}

/** Rounded section card used across customer pages. */
export function Panel({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cn('rounded-3xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', padded && 'p-5', className)}>{children}</section>;
}
