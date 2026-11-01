import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { num } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Badge, Button, ConfirmDialog, Field, Input, PageHeader, Select } from '@/components/ui';
import { InfoRow, Section, UploadButton, useHubName, type Errors } from '@/portals/ops/components/opsb';
import './i18n';
import { PushToggle } from '@/features/intake/push/PushToggle';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

export default function ProfilePage() {
  const { t } = useI18n();
  const { me } = useAuth();
  const hubName = useHubName();
  if (!me) return null;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('ops.account.profile.title')} subtitle={t('ops.account.profile.subtitle')} />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <ProfileForm />
          <PasswordForm />
        </div>
        <div className="space-y-5">
          <Section title={t('ops.account.profile.role')}>
            <div className="flex flex-wrap items-center gap-2"><Badge tone="progress"><ShieldCheck className="h-3 w-3" />{t(`role.${me.role}`)}</Badge><StatusPill status={me.status} /></div>
            <div className="mt-3">
              <InfoRow label={t('common.phone')} value={<span className="ltr">{me.phone}</span>} />
              {me.email && <InfoRow label={t('common.email')} value={<span className="ltr break-all">{me.email}</span>} />}
              <InfoRow label={t('ops.account.profile.hub')} value={me.hubId ? hubName(me.hubId) : '—'} />
              <p className="mt-2 text-xs text-ink-400">{t('ops.account.profile.permissions', { n: num(me.permissions?.length ?? 0) })}</p>
            </div>
          </Section>
          <PushToggle compact />
          <SessionsCard />
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={status === 'ACTIVE' ? 'success' : 'warning'} dot>{t(`state.${status}`)}</Badge>;
}

function ProfileForm() {
  const { t, setLocale } = useI18n();
  const { me, refreshMe } = useAuth();
  const [name, setName] = useState(me?.name ?? '');
  const [locale, setLoc] = useState<'ar' | 'en'>(me?.locale ?? 'ar');
  const [avatar, setAvatar] = useState<string | null>(me?.avatarUrl ?? null);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (me) { setName(me.name); setLoc(me.locale); setAvatar(me.avatarUrl); }
  }, [me]);
  const m = useMutation({
    mutationFn: (body: { name?: string; locale?: 'ar' | 'en'; avatarUrl?: string }) => api('/auth/me', { method: 'PATCH', body }),
    onSuccess: (_r, body) => {
      toast.success(t('ops.account.profile.saved'));
      if (body.locale) setLocale(body.locale);
      refreshMe();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!me) return null;
  const dirty = name.trim() !== me.name || locale !== me.locale;
  return (
    <Section title={<span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4" />{t('ops.account.profile.details')}</span>}>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Avatar name={name || me.name} src={avatar} size={72} />
        <div className="flex flex-wrap gap-2">
          <UploadButton purpose="avatar" accept="image/*" label={t('ops.account.profile.avatar')} onUploaded={(f) => { setAvatar(f.url); m.mutate({ avatarUrl: f.url }); }} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ops.account.profile.name')} required error={err}>{(id) => <Input id={id} value={name} onChange={(e) => { setName(e.target.value); setErr(undefined); }} invalid={!!err} maxLength={120} />}</Field>
        <Field label={t('ops.account.profile.locale')}>{(id) => <Select id={id} value={locale} onChange={(e) => setLoc(e.target.value as 'ar' | 'en')} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />}</Field>
      </div>
      <div className="mt-5 flex justify-end">
        <Button disabled={!dirty} loading={m.isPending} onClick={() => { if (name.trim().length < 2) { setErr(t('ops.opsb.minChars', { n: 2 })); return; } m.mutate({ name: name.trim(), locale }); }}>{t('action.save')}</Button>
      </div>
    </Section>
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const { me, signIn } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [conf, setConf] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const m = useMutation({
    mutationFn: async () => {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: next } });
      // The API revokes every refresh token: sign in again so this tab keeps working.
      if (me) await signIn(me.phone, next).catch(() => undefined);
    },
    onSuccess: () => { toast.success(t('ops.account.pw.done')); setCur(''); setNext(''); setConf(''); setErrors({}); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INVALID_CREDENTIALS') setErrors({ current: t('ops.account.pw.wrong') });
      else if (e instanceof ApiError && e.message.includes('Password')) setErrors({ next: t('ops.account.pw.rule') });
      toast.error(e instanceof ApiError && e.code === 'INVALID_CREDENTIALS' ? t('ops.account.pw.wrong') : errorMessage(e));
    },
  });
  const submit = () => {
    const e: Errors = {};
    if (!cur) e.current = t('ops.opsb.required');
    if (!PASSWORD_RULE.test(next)) e.next = t('ops.account.pw.rule');
    else if (next === cur) e.next = t('ops.account.pw.same');
    if (conf !== next) e.confirm = t('ops.account.pw.mismatch');
    setErrors(e);
    if (!Object.values(e).some(Boolean)) m.mutate();
  };
  const type = show ? 'text' : 'password';
  return (
    <Section title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4" />{t('ops.account.pw.title')}</span>}
      actions={<Button size="sm" variant="ghost" icon={show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={() => setShow(!show)} aria-pressed={show}>{t('ops.account.pw.show')}</Button>}
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input type="text" autoComplete="username" value={me?.phone ?? ''} readOnly hidden />
        <Field label={t('ops.account.pw.current')} required error={errors.current} className="sm:col-span-2">{(id) => <Input id={id} type={type} dir="ltr" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} invalid={!!errors.current} />}</Field>
        <Field label={t('ops.account.pw.new')} required error={errors.next} hint={t('ops.account.pw.rule')}>{(id) => <Input id={id} type={type} dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} invalid={!!errors.next} />}</Field>
        <Field label={t('ops.account.pw.confirm')} required error={errors.confirm}>{(id) => <Input id={id} type={type} dir="ltr" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} invalid={!!errors.confirm} />}</Field>
        <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={m.isPending}>{t('ops.account.pw.submit')}</Button></div>
      </form>
    </Section>
  );
}

function SessionsCard() {
  const { t } = useI18n();
  const { me, signOut } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const m = useMutation({
    mutationFn: async () => {
      await api('/auth/logout-all', { method: 'POST' });
      await signOut();
    },
    onSuccess: () => nav('/login', { replace: true }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title={t('ops.account.sessions.title')}>
      <p className="mb-1 text-sm text-ink-500">{t('ops.account.sessions.desc')}</p>
      {me && <p className="mb-4 text-xs text-ink-400">{t('ops.account.sessions.lastLogin')} <span className="ltr">{me.phone}</span></p>}
      <Button variant="danger" block icon={<LogOut className="h-4 w-4" />} onClick={() => setOpen(true)}>{t('ops.account.sessions.all')}</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} onConfirm={() => m.mutate()} loading={m.isPending} danger title={t('ops.account.sessions.confirm')} description={t('ops.account.sessions.desc')} confirmLabel={t('ops.account.sessions.all')} />
    </Section>
  );
}
