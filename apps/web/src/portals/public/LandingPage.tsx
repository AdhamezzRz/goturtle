import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isValidTrackingNumber, normalizeTrackingNumber } from '@goturtle/shared';
import { ArrowLeft, ArrowRight, Banknote, Bike, Boxes, Clock, MapPinned, PackageSearch, ShieldCheck, Smartphone, Store, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n, registerDictionary } from '@/i18n';
import { statusLabel } from '@/lib/format';
import { Button, Input } from '@/components/ui';
import { Logo } from '@/components/layout/Brand';
import { LanguageToggle } from '@/components/layout/Controls';

registerDictionary({
  'landing.hero.kicker': { en: 'Cairo’s smartest last-mile network', ar: 'أذكى شبكة توصيل في القاهرة' },
  'landing.hero.title': { en: 'Your parcels, at the door. Cash, back in your wallet.', ar: 'شحنتك لحد الباب… وفلوسك في جيبك' },
  'landing.hero.body': {
    en: 'GoTurtle picks up from your store, delivers across Greater Cairo with live tracking, collects cash on delivery and settles to you on schedule.',
    ar: 'جو تيرتل بيستلم من مخزنك، ويوصّل في كل القاهرة الكبرى مع تتبع لحظي، ويحصّل الدفع عند الاستلام ويحوّل لك فلوسك في موعدها.',
  },
  'landing.track.placeholder': { en: 'Enter tracking number, e.g. GT4829150376', ar: 'ادخل رقم التتبع مثل GT4829150376' },
  'landing.track.cta': { en: 'Track', ar: 'تتبع' },
  'landing.track.invalid': { en: 'That tracking number does not look right', ar: 'رقم التتبع غير صحيح' },
  'landing.cta.brand': { en: 'Ship with GoTurtle', ar: 'ابدأ الشحن معنا' },
  'landing.cta.hero': { en: 'Become a delivery hero', ar: 'انضم كمندوب' },
  'landing.cta.login': { en: 'Sign in', ar: 'دخول' },
  'landing.f1.t': { en: 'Same-day across Cairo', ar: 'توصيل في نفس اليوم' },
  'landing.f1.b': { en: 'Smart zones, hubs and route optimisation for every hero.', ar: 'مناطق ذكية ومخازن وتحسين لمسار كل مندوب.' },
  'landing.f2.t': { en: 'COD you can trust', ar: 'تحصيل آمن' },
  'landing.f2.b': { en: 'Double-entry ledger, daily cash reconciliation, transparent settlements.', ar: 'دفاتر محاسبية مزدوجة وتسوية يومية للنقدية وتقارير شفافة.' },
  'landing.f3.t': { en: 'Live tracking & OTP', ar: 'تتبع لحظي وكود تأكيد' },
  'landing.f3.b': { en: 'Customers follow their hero on the map and confirm with a one-time code.', ar: 'العميل يتابع المندوب على الخريطة ويأكد الاستلام بكود.' },
  'landing.f4.t': { en: 'Plug into your store', ar: 'اربط متجرك' },
  'landing.f4.b': { en: 'Shopify, WooCommerce, REST API and signed webhooks out of the box.', ar: 'شوبيفاي وووكومرس وواجهة برمجية وويبهوكس جاهزة.' },
  'landing.f5.t': { en: 'Fewer refusals', ar: 'رفض أقل' },
  'landing.f5.b': { en: 'COD risk scoring flags risky orders before they leave the hub.', ar: 'تقييم مخاطر الطلبات قبل خروجها من المخزن.' },
  'landing.f6.t': { en: 'Heroes love it', ar: 'المناديب بيحبوه' },
  'landing.f6.b': { en: 'Per-order or per-shift pay, instant earnings, levels and badges.', ar: 'أجر بالطلب أو بالوردية، أرباح لحظية، مستويات وأوسمة.' },
  'landing.portals': { en: 'One platform, four portals', ar: 'منصة واحدة… أربع بوابات' },
});

export default function LandingPage() {
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const [tn, setTn] = useState('');
  const Arrow = dir === 'rtl' ? ArrowLeft : ArrowRight;

  const track = (e: FormEvent) => {
    e.preventDefault();
    const n = normalizeTrackingNumber(tn);
    if (!isValidTrackingNumber(n)) return toast.error(t('landing.track.invalid'));
    navigate(`/t/${n}`);
  };

  const features = [
    { icon: <Zap />, k: 'f1' },
    { icon: <Banknote />, k: 'f2' },
    { icon: <MapPinned />, k: 'f3' },
    { icon: <Boxes />, k: 'f4' },
    { icon: <ShieldCheck />, k: 'f5' },
    { icon: <Bike />, k: 'f6' },
  ];
  const portals = [
    { icon: <Clock />, title: t('portal.ops'), to: '/login', body: 'Dispatch, hubs, live map, cash & finance' },
    { icon: <Store />, title: t('portal.brand'), to: '/login', body: 'Create orders, pickups, COD wallet, API' },
    { icon: <Smartphone />, title: t('portal.hero'), to: '/hero', body: 'Tasks, routes, OTP delivery, earnings' },
    { icon: <PackageSearch />, title: t('portal.customer'), to: '/track', body: 'Live tracking, reschedule, rate' },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-ink-950">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <Link to="/login"><Button variant="outline" size="sm">{t('landing.cta.login')}</Button></Link>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(25,179,110,.16),transparent_60%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-10 lg:grid-cols-2 lg:items-center lg:pt-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-turtle-50 px-3 py-1 text-sm font-semibold text-turtle-700 ring-1 ring-turtle-200">🐢 {t('landing.hero.kicker')}</span>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.15] tracking-tight text-ink-950 dark:text-white sm:text-5xl lg:text-6xl">{t('landing.hero.title')}</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-600 dark:text-ink-300">{t('landing.hero.body')}</p>
            <form onSubmit={track} className="mt-8 flex max-w-xl flex-col gap-2 rounded-2xl bg-white p-2 shadow-pop ring-1 ring-ink-100 dark:bg-ink-900 dark:ring-ink-800 sm:flex-row">
              <Input value={tn} onChange={(e) => setTn(e.target.value)} placeholder={t('landing.track.placeholder')} className="ltr h-12 flex-1 border-0 text-base shadow-none focus:ring-0" leading={<PackageSearch className="h-5 w-5" />} />
              <Button type="submit" size="lg" iconEnd={<Arrow className="h-4 w-4" />}>{t('landing.track.cta')}</Button>
            </form>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/login"><Button variant="secondary" size="lg" icon={<Store className="h-5 w-5" />}>{t('landing.cta.brand')}</Button></Link>
              <Link to="/hero"><Button variant="outline" size="lg" icon={<Bike className="h-5 w-5" />}>{t('landing.cta.hero')}</Button></Link>
            </div>
          </div>
          <div className="relative">
            <div className="rounded-[2rem] bg-gradient-to-br from-turtle-600 to-turtle-900 p-6 text-white shadow-pop">
              <div className="flex items-center justify-between text-sm text-turtle-100">
                <span className="ltr font-mono">GT4829150376</span>
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">{statusLabel('OUT_FOR_DELIVERY')}</span>
              </div>
              <p className="mt-6 font-display text-3xl font-bold">Arriving in ~18 min</p>
              <p className="text-turtle-100/80">Ahmed · Motorcycle · Nasr City</p>
              <div className="mt-6 grid grid-cols-5 gap-2">
                {[1, 1, 1, 1, 0].map((on, i) => <div key={i} className={`h-2 rounded-full ${on ? 'bg-sand-300' : 'bg-white/20'}`} />)}
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-2xl bg-white/10 p-3"><p className="text-xl font-bold">1,250</p><p className="text-turtle-100/80">EGP COD</p></div>
                <div className="rounded-2xl bg-white/10 p-3"><p className="text-xl font-bold">4821</p><p className="text-turtle-100/80">OTP</p></div>
                <div className="rounded-2xl bg-white/10 p-3"><p className="text-xl font-bold">★ 4.9</p><p className="text-turtle-100/80">Hero</p></div>
              </div>
            </div>
            <div className="absolute -bottom-14 start-8 hidden rounded-2xl bg-white p-4 shadow-pop ring-1 ring-ink-100 sm:block dark:bg-ink-900 dark:ring-ink-800">
              <p className="text-xs text-ink-500">Settled this week</p>
              <p className="font-display text-xl font-bold text-turtle-700">EGP 184,320</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.k} className="rounded-2xl border border-ink-100 p-6 transition hover:shadow-card dark:border-ink-800">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-turtle-50 text-turtle-700 [&>svg]:h-5 [&>svg]:w-5">{f.icon}</div>
              <h3 className="mt-4 text-lg font-semibold">{t(`landing.${f.k}.t`)}</h3>
              <p className="mt-1.5 text-ink-500">{t(`landing.${f.k}.b`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-ink-950 py-16 text-white">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className="font-display text-3xl font-bold">{t('landing.portals')}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {portals.map((p) => (
              <Link key={p.title} to={p.to} className="group rounded-2xl bg-white/5 p-6 ring-1 ring-white/10 transition hover:bg-white/10">
                <div className="text-turtle-300 [&>svg]:h-6 [&>svg]:w-6">{p.icon}</div>
                <p className="mt-4 font-semibold">{p.title}</p>
                <p className="mt-1 text-sm text-ink-300">{p.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-ink-500 sm:flex-row">
        <Logo compact />
        <p>© {new Date().getFullYear()} GoTurtle Logistics · Cairo, Egypt</p>
      </footer>
    </div>
  );
}
