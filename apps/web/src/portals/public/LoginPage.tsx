import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Phone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { portalHome, useAuth } from '@/lib/auth';
import { errorMessage, registerDictionary, useI18n } from '@/i18n';

registerDictionary({
  'login.pitch': { en: 'Ops · Brands · Heroes · Customers — one platform for every parcel in Cairo.', ar: 'العمليات · التجار · المناديب · العملاء — منصة واحدة لكل شحنة في القاهرة.' },
  'login.zones': { en: 'Zones', ar: 'منطقة' },
  'login.hubs': { en: 'Hubs', ar: 'مخازن' },
  'login.tracking': { en: 'Live tracking', ar: 'تتبع لحظي' },
});
import { Button, Card, Field, Input } from '@/components/ui';
import { Logo } from '@/components/layout/Brand';
import { LanguageToggle } from '@/components/layout/Controls';

const DEMO = [
  { label: 'Super admin', identifier: '01000000000', password: 'Admin@12345' },
  { label: 'Ops manager', identifier: '01000000001', password: 'Turtle@2026' },
  { label: 'Finance', identifier: '01000000004', password: 'Turtle@2026' },
  { label: 'Brand · Nile Threads', identifier: '01110000011', password: 'Turtle@2026' },
  { label: 'Hero · Ahmed', identifier: '01200000001', password: 'Turtle@2026' },
];

export default function LoginPage() {
  const { t, dir } = useI18n();
  const { me, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const showDemo = import.meta.env.DEV || window.location.hostname.includes('demo') || params.has('demo');

  if (me) return <Navigate to={params.get('next') || portalHome(me.portal)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await signIn(identifier, password);
      const next = params.get('next');
      navigate(next && next.startsWith(`/${user.portal}`) ? next : portalHome(user.portal), { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-turtle-800 via-turtle-900 to-ink-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo light />
        <div className="relative z-10 max-w-md">
          <h2 className="font-display text-4xl font-extrabold leading-tight">{t('app.tagline')}</h2>
          <p className="mt-4 text-turtle-100/80">{t('login.pitch')}</p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-4 text-sm">
          {[['25', t('login.zones')], ['4', t('login.hubs')], ['24/7', t('login.tracking')]].map(([v, l]) => (
            <div key={l} className="rounded-2xl bg-white/10 p-4 backdrop-blur">
              <p className="font-display text-2xl font-bold">{v}</p>
              <p className="text-turtle-100/80">{l}</p>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute -end-24 -top-24 h-96 w-96 rounded-full bg-turtle-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -start-16 h-96 w-96 rounded-full bg-sand-400/10 blur-3xl" />
      </div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between p-5">
          <Link to="/" className="lg:invisible"><Logo /></Link>
          <LanguageToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-3xl font-bold">{t('auth.title')}</h1>
            <p className="mt-2 text-ink-500">{t('auth.subtitle')}</p>
            <form onSubmit={submit} className="mt-8 space-y-4">
              <Field label={t('auth.identifier')}>
                {(id) => <Input id={id} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" inputMode="email" required leading={<Phone className="h-4 w-4" />} className="ltr" />}
              </Field>
              <Field label={t('auth.password')}>
                {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required minLength={6} leading={<Lock className="h-4 w-4" />} />}
              </Field>
              <div className="flex justify-end">
                <Link to="/forgot-password" className="text-sm font-medium text-turtle-700 hover:underline">{t('auth.forgot')}</Link>
              </div>
              <Button type="submit" block size="lg" loading={busy}>{t('action.signIn')}</Button>
            </form>
            <p className="mt-6 text-center text-sm text-ink-500">
              <Link to="/track" className="font-semibold text-turtle-700 hover:underline">{t('portal.customer')} {dir === 'rtl' ? '←' : '→'}</Link>
            </p>
            {showDemo && (
              <Card className="mt-8 bg-turtle-50/60 dark:bg-ink-900">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-turtle-800 dark:text-turtle-300"><Sparkles className="h-4 w-4" />{t('auth.demo')}</p>
                <div className="grid gap-1.5">
                  {DEMO.map((d) => (
                    <button key={d.label} type="button" onClick={() => { setIdentifier(d.identifier); setPassword(d.password); }} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-start text-sm hover:bg-white dark:hover:bg-ink-800">
                      <span className="font-medium">{d.label}</span>
                      <span className="ltr text-xs text-ink-500">{d.identifier}</span>
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
