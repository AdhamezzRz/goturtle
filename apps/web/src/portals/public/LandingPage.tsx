import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isValidTrackingNumber, normalizeTrackingNumber } from '@goturtle/shared';
import { ArrowLeft, ArrowRight, Banknote, Bike, Boxes, Link2, MapPinned, PackageCheck, PackageSearch, Phone, ShieldCheck, Smartphone, Store, Warehouse, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n, registerDictionary } from '@/i18n';
import { Button, Input } from '@/components/ui';
import { Logo } from '@/components/layout/Brand';
import { LanguageToggle, ThemeToggle } from '@/components/layout/Controls';
import { ArchMark, ArchProgress, Wordmark } from '@/components/brand';
import { cn } from '@/lib/cn';

registerDictionary({
  'landing.hero.kicker': { en: 'Last-mile delivery · Greater Cairo', ar: 'توصيل الميل الأخير · القاهرة الكبرى' },
  'landing.hero.title': { en: 'Slow is a myth. Your parcels, at the door today.', ar: 'شحنتك لحد الباب… النهارده.' },
  'landing.hero.body': {
    en: 'GoTurtle picks up from your store, confirms with your customer, delivers across Greater Cairo with live tracking, collects the cash and settles to you on schedule.',
    ar: 'جو تيرتل بيستلم من مخزنك، يأكد مع عميلك، يوصّل في كل القاهرة الكبرى بتتبع لحظي، يحصّل الفلوس ويحوّلها لك في ميعادها.',
  },
  'landing.track.label': { en: 'Track a parcel', ar: 'تتبع شحنة' },
  'landing.track.placeholder': { en: 'Tracking number, e.g. GT4829150376', ar: 'رقم التتبع مثل GT4829150376' },
  'landing.track.cta': { en: 'Track', ar: 'تتبع' },
  'landing.track.invalid': { en: 'That tracking number does not look right', ar: 'رقم التتبع غير صحيح' },
  'landing.cta.brand': { en: 'Ship with GoTurtle', ar: 'ابدأ الشحن معنا' },
  'landing.cta.hero': { en: 'Become a delivery hero', ar: 'انضم كمندوب' },
  'landing.cta.login': { en: 'Sign in', ar: 'دخول' },
  'landing.nav.track': { en: 'Track', ar: 'تتبع' },
  'landing.nav.brands': { en: 'For brands', ar: 'للتجار' },
  'landing.nav.heroes': { en: 'For heroes', ar: 'للمناديب' },
  'landing.card.status': { en: 'Out for delivery', ar: 'خرجت للتوصيل' },
  'landing.card.eta': { en: 'Arriving in ~18 min', ar: 'هتوصل خلال ~١٨ دقيقة' },
  'landing.card.hero': { en: 'Ahmed · Motorcycle · Nasr City', ar: 'أحمد · موتوسيكل · مدينة نصر' },
  'landing.card.cod': { en: 'EGP COD', ar: 'تحصيل ج.م' },
  'landing.card.otp': { en: 'OTP', ar: 'كود' },
  'landing.card.rating': { en: 'Hero', ar: 'المندوب' },
  'landing.float.settled': { en: 'Settled this week', ar: 'اتحوّل الأسبوع ده' },
  'landing.float.confirmed': { en: 'Customer confirmed on WhatsApp', ar: 'العميل أكد على واتساب' },
  'landing.band.1': { en: 'same-day across Cairo', ar: 'توصيل في نفس اليوم' },
  'landing.band.2': { en: 'zones · 4 hubs', ar: 'منطقة · ٤ مخازن' },
  'landing.band.3': { en: 'piaster-perfect COD', ar: 'تحصيل مظبوط بالقرش' },
  'landing.band.4': { en: 'live tracking', ar: 'تتبع لحظي' },
  'landing.how.title': { en: 'Every parcel walks the arch', ar: 'كل شحنة بتمشي على القوس' },
  'landing.how.body': { en: 'Our logo is a promise: from your shelf to their door, one unbroken journey you can watch.', ar: 'اللوجو بتاعنا وعد: من رفّك لباب عميلك… رحلة واحدة متصلة تقدر تتابعها.' },
  'landing.how.1.t': { en: 'Pickup', ar: 'الاستلام' },
  'landing.how.1.b': { en: 'A hero collects from your store, scanned in.', ar: 'المندوب بيستلم من مخزنك ويتسجل بالباركود.' },
  'landing.how.2.t': { en: 'Hub & confirm', ar: 'المخزن والتأكيد' },
  'landing.how.2.b': { en: 'Sorted by zone; risky COD is confirmed with the customer first.', ar: 'بيتفرز حسب المنطقة، والطلبات الخطرة بتتأكد مع العميل الأول.' },
  'landing.how.3.t': { en: 'Out for delivery', ar: 'خرجت للتوصيل' },
  'landing.how.3.b': { en: 'Optimised route, live map, call & WhatsApp from the app.', ar: 'مسار محسوب، خريطة لحظية، اتصال وواتساب من التطبيق.' },
  'landing.how.4.t': { en: 'At the door', ar: 'عند الباب' },
  'landing.how.4.b': { en: 'OTP or photo proof, cash or InstaPay — settled to you.', ar: 'كود أو صورة إثبات، كاش أو إنستاباي — وفلوسك بتتحوّل لك.' },
  'landing.f1.t': { en: 'Same-day across Cairo', ar: 'توصيل في نفس اليوم' },
  'landing.f1.b': { en: 'Smart zones, hubs and route optimisation for every hero.', ar: 'مناطق ذكية ومخازن وتحسين لمسار كل مندوب.' },
  'landing.f2.t': { en: 'COD you can trust', ar: 'تحصيل آمن' },
  'landing.f2.b': { en: 'Double-entry ledger, daily cash reconciliation, early payouts.', ar: 'دفاتر محاسبية مزدوجة وتسوية يومية للنقدية وتحويل مبكر.' },
  'landing.f3.t': { en: 'Fewer refusals', ar: 'رفض أقل' },
  'landing.f3.b': { en: 'WhatsApp confirmation before dispatch and a shared risk network.', ar: 'تأكيد على واتساب قبل الخروج وشبكة مخاطر مشتركة.' },
  'landing.f4.t': { en: 'No fake attempts', ar: 'مفيش محاولات وهمية' },
  'landing.f4.b': { en: 'Failed attempts need GPS at the door and logged calls.', ar: 'المحاولة الفاشلة محتاجة GPS عند العنوان ومكالمات متسجلة.' },
  'landing.f5.t': { en: 'Plug into your store', ar: 'اربط متجرك' },
  'landing.f5.b': { en: 'Shopify, WooCommerce, EasyOrders, Zid, Salla, YouCan and API.', ar: 'شوبيفاي، ووكومرس، إيزي أوردرز، زد، سلة، يوكان وواجهة برمجية.' },
  'landing.f6.t': { en: 'Sell from Instagram', ar: 'بيع من إنستجرام' },
  'landing.f6.b': { en: 'Share an order link — the buyer fills in the address.', ar: 'ابعت لينك طلب… والعميل يكتب عنوانه بنفسه.' },
  'landing.portals': { en: 'One platform, four portals', ar: 'منصة واحدة… أربع بوابات' },
  'landing.portal.ops': { en: 'Dispatch, hubs, live map, cash & finance', ar: 'التوزيع، المخازن، الخريطة، النقدية والمالية' },
  'landing.portal.brand': { en: 'Orders, pickups, COD wallet, API', ar: 'الطلبات، الاستلام، محفظة التحصيل، الربط' },
  'landing.portal.hero': { en: 'Tasks, routes, OTP delivery, earnings', ar: 'المهام، المسارات، التسليم بالكود، الأرباح' },
  'landing.portal.customer': { en: 'Live tracking, reschedule, rate', ar: 'تتبع لحظي، تغيير الميعاد، التقييم' },
  'landing.final.title': { en: 'Ready when you are.', ar: 'جاهزين لما تكون جاهز.' },
  'landing.final.body': { en: 'Open your brand account and book your first pickup today.', ar: 'افتح حساب متجرك واحجز أول استلام النهارده.' },
  'landing.footer.city': { en: 'Cairo, Egypt', ar: 'القاهرة، مصر' },
});

/** Cycles 0 … n-1 every `ms` (paused for reduced motion). */
function useCycle(n: number, ms: number) {
  const [i, setI] = useState(n - 1);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => window.clearInterval(id);
  }, [n, ms]);
  return i;
}

export default function LandingPage() {
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const [tn, setTn] = useState('');
  const Arrow = dir === 'rtl' ? ArrowLeft : ArrowRight;
  const step = useCycle(4, 1700);

  const track = (e: FormEvent) => {
    e.preventDefault();
    const n = normalizeTrackingNumber(tn);
    if (!isValidTrackingNumber(n)) return toast.error(t('landing.track.invalid'));
    navigate(`/t/${n}`);
  };

  const features: Array<{ icon: ReactNode; k: string }> = [
    { icon: <Zap />, k: 'f1' },
    { icon: <Banknote />, k: 'f2' },
    { icon: <Phone />, k: 'f3' },
    { icon: <MapPinned />, k: 'f4' },
    { icon: <Boxes />, k: 'f5' },
    { icon: <Link2 />, k: 'f6' },
  ];
  const portals = [
    { icon: <Warehouse />, title: t('portal.ops'), to: '/login', body: t('landing.portal.ops') },
    { icon: <Store />, title: t('portal.brand'), to: '/login', body: t('landing.portal.brand') },
    { icon: <Smartphone />, title: t('portal.hero'), to: '/hero', body: t('landing.portal.hero') },
    { icon: <PackageSearch />, title: t('portal.customer'), to: '/track', body: t('landing.portal.customer') },
  ];
  const how = [
    { icon: <Store />, k: '1' },
    { icon: <ShieldCheck />, k: '2' },
    { icon: <Bike />, k: '3' },
    { icon: <PackageCheck />, k: '4' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-cream text-ink-950 dark:bg-ink-950 dark:text-white">
      {/* ------------------------------------------------------------ header */}
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-5">
        <Link to="/" aria-label="GoTurtle"><Logo /></Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-ink-700 dark:text-ink-200 md:flex">
          <Link to="/track" className="hover:text-turtle-700 dark:hover:text-lime-300">{t('landing.nav.track')}</Link>
          <Link to="/login" className="hover:text-turtle-700 dark:hover:text-lime-300">{t('landing.nav.brands')}</Link>
          <Link to="/hero" className="hover:text-turtle-700 dark:hover:text-lime-300">{t('landing.nav.heroes')}</Link>
        </nav>
        <div className="flex items-center gap-1.5">
          <LanguageToggle />
          <ThemeToggle />
          <Link to="/login"><Button size="sm" className="!bg-ink-950 !text-white hover:!bg-ink-800 dark:!bg-lime-300 dark:!text-turtle-950">{t('landing.cta.login')}</Button></Link>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative">
        <ArchMark className="pointer-events-none absolute -top-24 end-[-14rem] hidden h-[44rem] w-[44rem] text-turtle-600/[.05] dark:text-lime-300/[.04] lg:block" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-6 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:pt-14">
          <div>
            <span className="inline-flex animate-rise items-center gap-2 rounded-full bg-lime-300 px-3.5 py-1.5 text-sm font-semibold text-turtle-900">
              <ArchMark className="h-3.5 w-3.5" /> {t('landing.hero.kicker')}
            </span>
            <h1 className="mt-6 animate-rise font-display text-[2.6rem] font-semibold leading-[1.08] tracking-tight [animation-delay:80ms] sm:text-6xl lg:text-7xl">
              {t('landing.hero.title')}
            </h1>
            <p className="mt-6 max-w-xl animate-rise text-lg leading-relaxed text-ink-600 [animation-delay:160ms] dark:text-ink-300">{t('landing.hero.body')}</p>

            <form onSubmit={track} className="mt-9 max-w-xl animate-rise [animation-delay:240ms]" aria-label={t('landing.track.label')}>
              <div className="flex flex-col gap-2 rounded-2xl bg-white p-2 shadow-pop ring-1 ring-ink-900/5 dark:bg-ink-900 dark:ring-white/10 sm:flex-row">
                <Input value={tn} onChange={(e) => setTn(e.target.value)} placeholder={t('landing.track.placeholder')} aria-label={t('landing.track.label')} className="ltr h-12 flex-1 border-0 text-base shadow-none focus:ring-0" leading={<PackageSearch className="h-5 w-5" />} />
                <Button type="submit" size="lg" iconEnd={<Arrow className="h-4 w-4" />}>{t('landing.track.cta')}</Button>
              </div>
            </form>
            <div className="mt-6 flex animate-rise flex-wrap gap-3 [animation-delay:320ms]">
              <Link to="/login"><Button size="lg" variant="secondary" icon={<Store className="h-5 w-5" />}>{t('landing.cta.brand')}</Button></Link>
              <Link to="/hero"><Button variant="ghost" size="lg" icon={<Bike className="h-5 w-5" />}>{t('landing.cta.hero')}</Button></Link>
            </div>
          </div>

          {/* live tracking card — the arch is the journey */}
          <div className="relative mx-auto w-full max-w-md animate-rise [animation-delay:200ms]">
            <div className="relative overflow-hidden rounded-[2rem] bg-turtle-600 p-6 text-white shadow-[0_30px_60px_-20px_rgba(0,128,76,.55)]">
              <ArchMark className="pointer-events-none absolute -end-16 -top-10 h-56 w-56 text-white/[.06]" />
              <div className="relative flex items-center justify-between text-sm">
                <span className="ltr rounded-lg bg-white/15 px-2 py-1 font-mono text-xs font-semibold tracking-wider">GT4829150376</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-lime-300 px-2.5 py-1 text-xs font-bold text-turtle-950">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-turtle-700" />{t('landing.card.status')}
                </span>
              </div>
              <div className="relative mx-auto mt-4 w-48">
                <ArchProgress surface="dark" mirror={dir === 'rtl'} live progress={0.82} steps={[0, 1 / 3, 2 / 3, 1].map((at, i) => ({ at, done: i < 3 }))} />
              </div>
              <p className="relative mt-2 text-center font-display text-3xl font-semibold">{t('landing.card.eta')}</p>
              <p className="relative text-center text-white/75">{t('landing.card.hero')}</p>
              <div className="relative mt-6 grid grid-cols-3 gap-2.5 text-center text-sm">
                <div className="rounded-2xl bg-turtle-800/60 p-3"><p className="ltr text-xl font-bold text-lime-300">1,250</p><p className="text-white/70">{t('landing.card.cod')}</p></div>
                <div className="rounded-2xl bg-turtle-800/60 p-3"><p className="ltr text-xl font-bold text-lime-300">4821</p><p className="text-white/70">{t('landing.card.otp')}</p></div>
                <div className="rounded-2xl bg-turtle-800/60 p-3"><p className="ltr text-xl font-bold text-lime-300">★ 4.9</p><p className="text-white/70">{t('landing.card.rating')}</p></div>
              </div>
            </div>
            <div className="absolute -start-10 top-[30%] hidden animate-float rounded-2xl bg-white p-4 shadow-pop ring-1 ring-ink-900/5 sm:block dark:bg-ink-900 dark:ring-white/10">
              <p className="text-xs text-ink-500">{t('landing.float.settled')}</p>
              <p className="ltr font-display text-xl font-semibold text-turtle-700 dark:text-lime-300">EGP 184,320</p>
            </div>
            <div className="absolute -end-3 -top-5 hidden animate-float items-center gap-2 rounded-2xl bg-ink-950 px-3.5 py-2.5 text-sm font-medium text-white shadow-pop [animation-delay:1.2s] sm:flex">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#25D366] text-[11px] font-bold">✓</span>{t('landing.float.confirmed')}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ palette band (brand book p.9) */}
      <section className="grid grid-cols-2 lg:grid-cols-4">
        {[
          { v: '24h', k: '1', cls: 'bg-turtle-600 text-white', vc: 'text-lime-300' },
          { v: '25', k: '2', cls: 'bg-leaf-400 text-turtle-950', vc: 'text-white' },
          { v: '1:1', k: '3', cls: 'bg-lime-300 text-turtle-950', vc: 'text-turtle-700' },
          { v: '24/7', k: '4', cls: 'bg-white text-ink-950 dark:bg-ink-900 dark:text-white', vc: 'text-turtle-600 dark:text-lime-300' },
        ].map((b) => (
          <div key={b.k} className={cn('flex min-h-[9.5rem] flex-col justify-end p-6 sm:min-h-[12rem] sm:p-8', b.cls)}>
            <p className={cn('ltr font-display text-5xl font-semibold tracking-tight sm:text-6xl', b.vc)}>{b.v}</p>
            <p className="mt-1 text-sm font-medium opacity-90 sm:text-base">{t(`landing.band.${b.k}`)}</p>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------------------ how it works: the arch */}
      <section className="mx-auto max-w-7xl px-5 py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{t('landing.how.title')}</h2>
            <p className="mt-4 max-w-lg text-lg text-ink-600 dark:text-ink-300">{t('landing.how.body')}</p>
            <ol className="mt-10 space-y-3">
              {how.map((h, i) => (
                <li key={h.k} className={cn('flex gap-4 rounded-2xl p-4 transition-all duration-500', i === step ? 'bg-white shadow-card ring-1 ring-ink-900/5 dark:bg-ink-900 dark:ring-white/10' : 'opacity-60')}>
                  <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors duration-500 [&>svg]:h-5 [&>svg]:w-5', i <= step ? 'bg-turtle-600 text-lime-300' : 'bg-ink-100 text-ink-400 dark:bg-ink-800')}>{h.icon}</span>
                  <div>
                    <p className="font-semibold">{t(`landing.how.${h.k}.t`)}</p>
                    <p className="text-sm text-ink-500 dark:text-ink-400">{t(`landing.how.${h.k}.b`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="mx-auto w-full max-w-md">
            <ArchProgress mirror={dir === 'rtl'} live={step === 2} progress={step / 3} steps={[0, 1 / 3, 2 / 3, 1].map((at, i) => ({ at, done: i <= step }))} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ features */}
      <section className="bg-white py-20 dark:bg-ink-900/40">
        <div className="mx-auto grid max-w-7xl gap-5 px-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.k} className="group rounded-3xl bg-cream p-7 ring-1 ring-ink-900/5 transition hover:-translate-y-0.5 hover:shadow-pop dark:bg-ink-900 dark:ring-white/10">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-turtle-600 text-lime-300 transition group-hover:bg-lime-300 group-hover:text-turtle-800 [&>svg]:h-5 [&>svg]:w-5">{f.icon}</div>
              <h3 className="mt-5 font-display text-xl font-semibold">{t(`landing.${f.k}.t`)}</h3>
              <p className="mt-1.5 text-ink-600 dark:text-ink-300">{t(`landing.${f.k}.b`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ portals */}
      <section className="relative overflow-hidden bg-ink-950 py-20 text-white">
        <ArchMark className="pointer-events-none absolute -bottom-40 -start-32 h-[30rem] w-[30rem] text-lime-300/[.05]" />
        <div className="relative mx-auto max-w-7xl px-5">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t('landing.portals')}</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {portals.map((p) => (
              <Link key={p.title} to={p.to} className="group rounded-3xl bg-white/[.04] p-6 ring-1 ring-white/10 transition hover:bg-white/[.08] hover:ring-lime-300/40">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-lime-300 text-turtle-900 [&>svg]:h-5 [&>svg]:w-5">{p.icon}</div>
                <p className="mt-5 font-semibold">{p.title}</p>
                <p className="mt-1 text-sm text-white/60">{p.body}</p>
                <Arrow className="mt-5 h-4 w-4 text-lime-300 transition group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ final CTA */}
      <section className="relative overflow-hidden bg-lime-300 text-turtle-950">
        <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-8 px-5 py-16 lg:flex-row lg:items-center lg:justify-between lg:py-20">
          <div>
            <Wordmark className="h-12 text-turtle-600 sm:h-16" title="GoTurtle" />
            <h2 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t('landing.final.title')}</h2>
            <p className="mt-2 text-lg text-turtle-900/80">{t('landing.final.body')}</p>
          </div>
          <Link to="/login"><Button size="lg" className="!bg-turtle-600 !px-7 !text-white hover:!bg-turtle-700" iconEnd={<Arrow className="h-4 w-4" />}>{t('landing.cta.brand')}</Button></Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-ink-500 sm:flex-row">
        <Logo size="sm" />
        <p>© {new Date().getFullYear()} GoTurtle Logistics · {t('landing.footer.city')}</p>
      </footer>
    </div>
  );
}
