import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bike, CalendarClock, ChevronLeft, ChevronRight, Coins, Download, FileText, KeyRound, Languages, LogOut, MapPin, Moon, Share, Smartphone, SquarePlus, Star, Sun, Trophy, Upload, Wallet, Warehouse,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateOnly, num, phone as fmtPhone } from '@/lib/format';
import { useTheme } from '@/lib/hooks';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Badge, Button, ConfirmDialog, ErrorState, Field, Input, ProgressBar, Skeleton } from '@/components/ui';
import { Ltr, Money, Panel, SectionTitle, Sheet } from '../components/kit';
import { clearHeroCache, useDocuments, useHeroMutation, useInvalidateHero, useProfile } from '../lib/queries';
import { clearLocationQueue } from '../lib/geo';
import { uploadPhoto } from '../lib/media';
import { useInstall } from '../lib/pwa';
import type { HeroDocument, Profile } from '../types';
import { PushToggle } from '@/features/intake/push/PushToggle';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

export default function MePage() {
  const { t, pick } = useI18n();
  const profile = useProfile();
  const [signOut, setSignOut] = useState(false);
  const [pw, setPw] = useState(false);

  if (!profile.data && profile.isError) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  if (!profile.data) return <MeSkeleton />;
  const p = profile.data;
  const k = p.kpis.last7d;

  return (
    <div>
      <Panel className="flex items-center gap-4">
        <Avatar name={p.name} src={p.avatarUrl} size={64} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-bold text-ink-900 dark:text-white">{p.name}</p>
          <p className="text-sm text-ink-500"><Ltr className="font-mono">{p.code}</Ltr> · <Ltr>{fmtPhone(p.phone)}</Ltr></p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="info">{t(`hero.employment.${p.employmentType}`)}</Badge>
            <Badge tone={p.status === 'ACTIVE' ? 'success' : 'warning'} dot>{t(`state.${p.status}`)}</Badge>
            <Badge tone="cash"><Star className="h-3 w-3 fill-current" /> <span className="ltr">{p.rating.toFixed(1)}</span> ({num(p.ratingCount)})</Badge>
          </div>
        </div>
      </Panel>

      <Link to="/hero/achievements" className="mt-3 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-violet-600 to-violet-800 p-4 text-white shadow-card active:scale-[.99]">
        <span className="text-4xl leading-none">{p.level.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white/75">{t('hero.me.level')} <span className="ltr">{p.level.level}</span></p>
          <p className="truncate font-display text-lg font-bold">{pick(p.level)}</p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-sand-300" style={{ width: `${p.level.progress * 100}%` }} /></div>
        </div>
        <Chevron />
      </Link>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Kpi label={t('hero.me.deliveries7')} value={num(k.deliveries)} />
        <Kpi label={t('hero.me.success')} value={<span className="ltr">{num(k.successRate)}%</span>} />
        <Kpi label={t('hero.me.avgTime')} value={k.avgDeliveryMinutes ? t('hero.dur.m', { m: num(k.avgDeliveryMinutes) }) : '—'} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <QuickLink to="/hero/earnings" icon={<Coins />} label={t('hero.earnings.title')} value={<Money cents={p.payableCents} />} hint={t('hero.earnings.payable')} />
        <QuickLink to="/hero/wallet" icon={<Wallet />} label={t('hero.wallet.title')} value={<Money cents={p.cash.onHandCents} />} hint={t('hero.wallet.onHand')} />
        <QuickLink to="/hero/achievements" icon={<Trophy />} label={t('hero.ach.title')} value={t('hero.ach.streakN', { n: p.streakDays })} hint={t('hero.ach.streak')} />
        <QuickLink to="/hero/shifts" icon={<CalendarClock />} label={t('hero.shifts.title')} value={t(`hero.employment.${p.employmentType}`)} hint={t('hero.me.contract')} />
      </div>

      <SectionTitle>{t('hero.me.work')}</SectionTitle>
      <Panel className="space-y-4">
        <Row icon={<Bike />} label={t('hero.me.vehicle')} value={<>{t(`hero.vehicle.${p.vehicleType}`)}{p.vehiclePlate && <> · <span className="font-mono">{p.vehiclePlate}</span></>}</>} />
        {p.licenseNumber && <Row icon={<FileText />} label={t('hero.me.license')} value={<><Ltr className="font-mono">{p.licenseNumber}</Ltr>{p.licenseExpiry && <> · {t('hero.me.expires', { date: dateOnly(p.licenseExpiry) })}</>}</>} />}
        {p.homeHub && <Row icon={<Warehouse />} label={t('common.hub')} value={p.homeHub.name} />}
        <div className="flex gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300"><MapPin className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-500">{t('hero.me.zones')}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {p.zones.length === 0 ? <span className="text-sm text-ink-500">—</span> : p.zones.map((z) => <Badge key={z.zoneId} tone={z.isPrimary ? 'success' : 'neutral'}>{pick(z, 'name')}{z.isPrimary && ' ★'}</Badge>)}
            </div>
          </div>
        </div>
      </Panel>

      <SectionTitle>{t('hero.me.pay')}</SectionTitle>
      <RatesCard p={p} />

      <Documents p={p} />

      <SectionTitle>{t('hero.me.settings')}</SectionTitle>
      <PushToggle className="mb-3" />
      <Settings onPassword={() => setPw(true)} onSignOut={() => setSignOut(true)} />

      <p className="mt-6 text-center text-xs text-ink-400">{t('hero.me.joined', { date: dateOnly(p.joinedAt) })} · {t('common.poweredBy')}</p>

      <PasswordSheet open={pw} onClose={() => setPw(false)} phone={p.phone} />
      <SignOutDialog open={signOut} onClose={() => setSignOut(false)} />
    </div>
  );
}

function Chevron() {
  const { dir } = useI18n();
  return dir === 'rtl' ? <ChevronLeft className="h-5 w-5 shrink-0 opacity-70" /> : <ChevronRight className="h-5 w-5 shrink-0 opacity-70" />;
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-card dark:bg-ink-900">
      <p className="truncate text-[11px] font-semibold text-ink-500">{label}</p>
      <p className="mt-0.5 font-display text-lg font-extrabold text-ink-900 dark:text-white">{value}</p>
    </div>
  );
}

function QuickLink({ to, icon, label, value, hint }: { to: string; icon: React.ReactNode; label: string; value: React.ReactNode; hint: string }) {
  return (
    <Link to={to} className="flex min-h-[84px] flex-col justify-between rounded-2xl border border-ink-100 bg-white p-3 shadow-card active:scale-[.99] dark:border-ink-800 dark:bg-ink-900">
      <span className="flex items-center gap-2 text-sm font-bold text-ink-800 dark:text-ink-100 [&>svg]:h-5 [&>svg]:w-5 [&>svg]:text-turtle-600">
        {icon}
        {label}
      </span>
      <span>
        <span className="block truncate text-base font-extrabold text-ink-900 dark:text-white">{value}</span>
        <span className="block truncate text-[11px] text-ink-500">{hint}</span>
      </span>
    </Link>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-500">{label}</p>
        <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

function RatesCard({ p }: { p: Profile }) {
  const { t } = useI18n();
  const r = p.rates;
  const items = [
    { key: 'perDelivery', v: r.perDeliveryRateCents },
    { key: 'perPickup', v: r.perPickupRateCents },
    { key: 'failedAttempt', v: r.failedAttemptRateCents },
    { key: 'hourly', v: r.hourlyRateCents },
    { key: 'monthly', v: r.monthlySalaryCents },
  ].filter((i) => i.v > 0);
  return (
    <Panel>
      {items.length === 0 ? (
        <p className="text-sm text-ink-500">{t('hero.me.noRates')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {items.map((i) => (
            <li key={i.key} className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800">
              <p className="text-[11px] font-semibold text-ink-500">{t(`hero.rate.${i.key}`)}</p>
              <Money cents={i.v} className="text-base font-extrabold text-ink-900 dark:text-white" />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 border-t border-ink-100 pt-3 dark:border-ink-800">
        <div className="flex items-center justify-between text-xs">
          <span className="text-ink-500">{t('hero.me.cashLimit')}</span>
          <Money cents={p.cash.limitCents} className="font-bold" />
        </div>
        <ProgressBar value={p.cash.limitCents ? p.cash.onHandCents / p.cash.limitCents : 0} tone={p.cash.warning === 'OVER_LIMIT' ? 'red' : p.cash.warning === 'NEAR_LIMIT' ? 'sand' : 'turtle'} className="mt-2" />
      </div>
    </Panel>
  );
}

function Documents({ p }: { p: Profile }) {
  const { t } = useI18n();
  const docs = useDocuments();
  const invalidate = useInvalidateHero();
  const latest = new Map<string, HeroDocument>();
  for (const d of docs.data ?? []) if (!latest.has(d.type)) latest.set(d.type, d);
  const types = Array.from(new Set([...p.documents.missingRequired, ...latest.keys()]));
  return (
    <>
      <SectionTitle count={p.documents.missingRequired.length || undefined}>{t('hero.me.documents')}</SectionTitle>
      <Panel className="space-y-2">
        {p.documents.missingRequired.length > 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('hero.docs.missing', { n: p.documents.missingRequired.length })}</p>}
        {p.documents.expiringSoon > 0 && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">{t('hero.docs.expiring', { n: p.documents.expiringSoon })}</p>}
        {types.length === 0 && <p className="text-sm text-ink-500">{t('hero.docs.none')}</p>}
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {types.map((type) => {
            const d = latest.get(type);
            const missing = !d || d.status === 'REJECTED';
            return (
              <li key={type} className="flex items-center gap-3 py-2.5">
                <FileText className="h-5 w-5 shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">{t(`hero.doc.${type}`)}</p>
                  {d?.status === 'REJECTED' && d.reviewNote && <p className="truncate text-xs text-red-600">{d.reviewNote}</p>}
                  {d?.expiresAt && <p className="text-xs text-ink-500">{t('hero.me.expires', { date: dateOnly(d.expiresAt) })}</p>}
                </div>
                {d && <Badge tone={d.status === 'APPROVED' ? 'success' : d.status === 'REJECTED' ? 'danger' : 'warning'} dot>{t(`hero.docs.status.${d.status}`)}</Badge>}
                {missing && <DocUpload type={type} onDone={() => invalidate(['hero', 'documents'])} />}
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}

function DocUpload({ type, onDone }: { type: string; onDone: () => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            const url = await uploadPhoto(file, 'courier_document');
            await api('/hero/me/documents', { method: 'POST', body: { type, url } });
            toast.success(t('hero.docs.uploaded'));
            onDone();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button size="sm" variant="outline" className="h-10 shrink-0" loading={busy} icon={<Upload className="h-4 w-4" />} onClick={() => input.current?.click()}>
        {t('action.upload')}
      </Button>
    </>
  );
}

function Settings({ onPassword, onSignOut }: { onPassword: () => void; onSignOut: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { dark, toggle } = useTheme();
  const install = useInstall();
  const [iosHelp, setIosHelp] = useState(false);
  const changeLocale = (l: 'ar' | 'en') => {
    setLocale(l);
    void api('/auth/me', { method: 'PATCH', body: { locale: l } }).catch(() => undefined);
  };
  return (
    <div className="space-y-2">
      <Panel className="space-y-4">
        <Segment
          icon={<Languages />}
          label={t('hero.me.language')}
          value={locale}
          onChange={(v) => changeLocale(v as 'ar' | 'en')}
          options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]}
        />
        <Segment
          icon={dark ? <Moon /> : <Sun />}
          label={t('common.theme')}
          value={dark ? 'dark' : 'light'}
          onChange={(v) => (v === 'dark') !== dark && toggle()}
          options={[{ value: 'light', label: t('hero.me.light') }, { value: 'dark', label: t('hero.me.dark') }]}
        />
      </Panel>

      {!install.installed && (
        <Panel className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300"><Smartphone className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-900 dark:text-white">{t('hero.install.title')}</p>
            <p className="text-xs text-ink-500">{t('hero.install.hint')}</p>
          </div>
          {install.canPrompt ? (
            <Button size="sm" className="h-11 shrink-0" icon={<Download className="h-4 w-4" />} onClick={async () => (await install.prompt()) && toast.success(t('hero.install.done'))}>
              {t('hero.install.cta')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-11 shrink-0" onClick={() => setIosHelp(true)}>
              {t('hero.install.how')}
            </Button>
          )}
        </Panel>
      )}

      <Panel className="divide-y divide-ink-100 p-0 dark:divide-ink-800">
        <button type="button" onClick={onPassword} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-start text-sm font-semibold text-ink-800 dark:text-ink-100">
          <KeyRound className="h-5 w-5 text-ink-400" /> <span className="flex-1">{t('hero.pw.title')}</span> <Chevron />
        </button>
        <button type="button" onClick={onSignOut} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-start text-sm font-semibold text-red-600">
          <LogOut className="h-5 w-5" /> <span className="flex-1">{t('action.signOut')}</span>
        </button>
      </Panel>

      <Sheet open={iosHelp} onClose={() => setIosHelp(false)} title={t('hero.install.title')}>
        <ol className="space-y-3 pb-4 text-sm text-ink-700 dark:text-ink-200">
          {install.ios ? (
            <>
              <Step n={1}>{t('hero.install.ios1')} <Share className="inline h-4 w-4" /></Step>
              <Step n={2}>{t('hero.install.ios2')} <SquarePlus className="inline h-4 w-4" /></Step>
              <Step n={3}>{t('hero.install.ios3')}</Step>
            </>
          ) : (
            <>
              <Step n={1}>{t('hero.install.android1')}</Step>
              <Step n={2}>{t('hero.install.android2')}</Step>
            </>
          )}
        </ol>
      </Sheet>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-turtle-600 text-xs font-bold text-white">{n}</span>
      <span className="pt-1">{children}</span>
    </li>
  );
}

function Segment({ icon, label, value, onChange, options }: { icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{label}</span>
      <div className="flex shrink-0 rounded-xl bg-ink-100 p-1 dark:bg-ink-800" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn('h-10 rounded-lg px-3 text-sm font-semibold', value === o.value ? 'bg-white text-ink-900 shadow dark:bg-ink-600 dark:text-white' : 'text-ink-500')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PasswordSheet({ open, onClose, phone }: { open: boolean; onClose: () => void; phone: string }) {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const invalidate = useInvalidateHero();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const weak = next.length > 0 && !PASSWORD_RULE.test(next);
  const mismatch = again.length > 0 && again !== next;
  const change = useHeroMutation(() => api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } }), {
    onSuccess: async () => {
      // Changing the password signs out every device — sign this one back in with the new password.
      await signIn(phone, next).catch(() => undefined);
      invalidate();
      toast.success(t('hero.pw.done'));
      setCurrent('');
      setNext('');
      setAgain('');
      onClose();
    },
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('hero.pw.title')}
      footer={
        <div className="pb-1">
          <Button size="xl" block loading={change.isPending} disabled={!current || !PASSWORD_RULE.test(next) || next !== again} onClick={() => change.mutate(undefined)}>
            {t('action.save')}
          </Button>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <Field label={t('hero.pw.current')} required>{(id) => <Input id={id} type="password" autoComplete="current-password" className="h-12" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field label={t('hero.pw.new')} required hint={t('hero.pw.rule')} error={weak ? t('hero.pw.rule') : undefined}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" className="h-12" value={next} onChange={(e) => setNext(e.target.value)} invalid={weak} />}
        </Field>
        <Field label={t('hero.pw.again')} required error={mismatch ? t('hero.pw.mismatch') : undefined}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" className="h-12" value={again} onChange={(e) => setAgain(e.target.value)} invalid={mismatch} />}
        </Field>
      </form>
    </Sheet>
  );
}

function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      danger
      loading={busy}
      title={t('action.signOut')}
      description={t('hero.me.signOutHint')}
      confirmLabel={t('action.signOut')}
      onConfirm={async () => {
        setBusy(true);
        clearLocationQueue();
        clearHeroCache();
        await signOut();
        navigate('/login', { replace: true });
      }}
    />
  );
}

function MeSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  );
}
