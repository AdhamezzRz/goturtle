import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { errorMessage, useI18n, registerDictionary } from '@/i18n';
import { Button, Field, Input } from '@/components/ui';
import { Logo } from '@/components/layout/Brand';

registerDictionary({
  'forgot.title': { en: 'Reset your password', ar: 'إعادة تعيين كلمة المرور' },
  'forgot.subtitle': { en: 'We will text a code to your phone', ar: 'سنرسل كود إلى رقم موبايلك' },
  'forgot.send': { en: 'Send code', ar: 'إرسال الكود' },
  'forgot.code': { en: 'Code from SMS', ar: 'الكود المرسل' },
  'forgot.newPassword': { en: 'New password', ar: 'كلمة المرور الجديدة' },
  'forgot.reset': { en: 'Reset password', ar: 'تغيير كلمة المرور' },
  'forgot.done': { en: 'Password changed — sign in now', ar: 'تم تغيير كلمة المرور — سجل الدخول الآن' },
});

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ devCode?: string }>('/auth/password/forgot', { method: 'POST', body: { phone }, auth: 'none' });
      if (r.devCode) setCode(r.devCode);
      setStep('code');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { phone, code, newPassword: password }, auth: 'none' });
      toast.success(t('forgot.done'));
      navigate('/login');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5">
      <Link to="/" className="mb-8"><Logo /></Link>
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-bold">{t('forgot.title')}</h1>
        <p className="mt-1 text-ink-500">{t('forgot.subtitle')}</p>
        {step === 'phone' ? (
          <form onSubmit={send} className="mt-6 space-y-4">
            <Field label={t('common.phone')}>{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required className="ltr" />}</Field>
            <Button type="submit" block loading={busy}>{t('forgot.send')}</Button>
          </form>
        ) : (
          <form onSubmit={reset} className="mt-6 space-y-4">
            <Field label={t('forgot.code')}>{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required className="ltr tracking-[0.4em]" />}</Field>
            <Field label={t('forgot.newPassword')} hint="8+ characters, letters and numbers">{(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />}</Field>
            <Button type="submit" block loading={busy}>{t('forgot.reset')}</Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm"><Link to="/login" className="font-medium text-turtle-700 hover:underline">{t('action.back')}</Link></p>
      </div>
    </div>
  );
}
