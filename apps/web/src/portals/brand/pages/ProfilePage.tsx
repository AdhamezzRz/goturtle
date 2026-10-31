import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Eye, EyeOff, KeyRound, Loader2, LogOut, MonitorSmartphone, User } from 'lucide-react';
import { toast } from 'sonner';
import { api, sessionStore, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { phone } from '@/lib/format';
import { errorMessage, useI18n } from '@/i18n';
import { Avatar, Badge, Button, Card, ConfirmDialog, Field, Input } from '@/components/ui';
import { Ltr, SectionTitle, Segmented } from '../components/common';
import './i18n';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

export default function ProfilePage() {
  const { t, setLocale } = useI18n();
  const { me, refreshMe, signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me?.name ?? '');
  const [lang, setLang] = useState<'ar' | 'en'>(me?.locale ?? 'ar');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwTouched, setPwTouched] = useState(false);
  const [logoutAll, setLogoutAll] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (me) {
      setName(me.name);
      setLang(me.locale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const save = useMutation({
    mutationFn: (body: { name?: string; locale?: 'ar' | 'en'; avatarUrl?: string }) => api('/auth/me', { method: 'PATCH', body }),
    onSuccess: (_, body) => {
      toast.success(t('brand.common.saved'));
      if (body.locale) setLocale(body.locale);
      qc.invalidateQueries({ queryKey: ['me'] });
      refreshMe();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pwErrors = {
    current: !pw.current ? t('brand.profile.errCurrent') : undefined,
    next: !PASSWORD_RULE.test(pw.next) ? t('brand.profile.errRule') : undefined,
    confirm: pw.confirm !== pw.next ? t('brand.profile.errMatch') : undefined,
  };
  const change = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.current, newPassword: pw.next } }),
    onSuccess: async () => {
      // The API signs every session out after a password change.
      toast.success(t('brand.profile.pwChanged'));
      sessionStore.setUser(null);
      qc.clear();
      navigate('/login');
    },
    onError: (e) => toast.error((e as { code?: string }).code === 'INVALID_CREDENTIALS' ? t('brand.profile.errWrongCurrent') : errorMessage(e)),
  });
  const everywhere = useMutation({
    mutationFn: () => api('/auth/logout-all', { method: 'POST' }),
    onSuccess: async () => {
      await signOut();
      navigate('/login');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onAvatar = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error(t('brand.settings.logoType'));
    setUploading(true);
    try {
      const up = await uploadFile(file, 'avatar');
      save.mutate({ avatarUrl: up.url });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  if (!me) return null;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-start">
        <div className="relative">
          <Avatar name={me.name} src={me.avatarUrl} size={80} />
          <button type="button" onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -end-1 grid h-8 w-8 place-items-center rounded-full bg-white text-ink-700 shadow-pop ring-1 ring-ink-100 dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-700" aria-label={t('brand.profile.photo')}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => onAvatar(e.target.files?.[0])} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold text-ink-900 dark:text-white">{me.name}</h1>
          <p className="text-sm text-ink-500"><Ltr>{phone(me.phone)}</Ltr>{me.email ? ` · ${me.email}` : ''}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Badge tone="success">{t(`role.${me.role}`)}</Badge>
            {me.brand && <Badge>{me.brand.name}</Badge>}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<User />} title={t('brand.profile.personal')} />
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) save.mutate({ name: name.trim(), locale: lang }); }}>
          <Field label={t('common.name')} error={name.trim().length < 2 ? t('brand.new.errName') : undefined}>{(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}</Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{t('brand.profile.language')}</p>
            <Segmented label={t('brand.profile.language')} value={lang} onChange={setLang} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
            <p className="mt-1.5 text-xs text-ink-500">{t('brand.profile.languageHint')}</p>
          </div>
          <div className="flex justify-end"><Button type="submit" loading={save.isPending} disabled={name.trim().length < 2}>{t('action.save')}</Button></div>
        </form>
      </Card>

      <Card>
        <SectionTitle icon={<KeyRound />} title={t('brand.profile.password')} subtitle={t('brand.profile.passwordHint')} />
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setPwTouched(true); if (!pwErrors.current && !pwErrors.next && !pwErrors.confirm) change.mutate(); }}>
          <Field label={t('brand.profile.current')} error={pwTouched ? pwErrors.current : undefined} className="sm:col-span-2">
            {(id) => <Input id={id} type={showPw ? 'text' : 'password'} autoComplete="current-password" dir="ltr" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} trailing={<button type="button" onClick={() => setShowPw((s) => !s)} aria-label={t('brand.profile.show')}>{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>} />}
          </Field>
          <Field label={t('brand.profile.new')} error={pwTouched ? pwErrors.next : undefined} hint={t('brand.profile.errRule')}>{(id) => <Input id={id} type={showPw ? 'text' : 'password'} autoComplete="new-password" dir="ltr" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}</Field>
          <Field label={t('brand.profile.confirm')} error={pwTouched ? pwErrors.confirm : undefined}>{(id) => <Input id={id} type={showPw ? 'text' : 'password'} autoComplete="new-password" dir="ltr" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
          <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={change.isPending}>{t('brand.profile.update')}</Button></div>
        </form>
      </Card>

      <Card>
        <SectionTitle icon={<MonitorSmartphone />} title={t('brand.profile.sessions')} subtitle={t('brand.profile.sessionsHint')} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<LogOut className="h-4 w-4" />} onClick={() => signOut().then(() => navigate('/login'))}>{t('action.signOut')}</Button>
          <Button variant="danger" icon={<LogOut className="h-4 w-4" />} onClick={() => setLogoutAll(true)}>{t('brand.profile.everywhere')}</Button>
        </div>
      </Card>
      <ConfirmDialog open={logoutAll} onClose={() => setLogoutAll(false)} onConfirm={() => everywhere.mutate()} loading={everywhere.isPending} danger title={t('brand.profile.everywhereTitle')} description={t('brand.profile.everywhereBody')} confirmLabel={t('brand.profile.everywhere')} />
    </div>
  );
}
