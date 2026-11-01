import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BellRing, BellOff, Send, Share, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { errorMessage, useI18n } from '@/i18n';
import { Button, Switch } from '@/components/ui';
import { currentSubscription, disablePush, enablePush, permission, pushSupport, PushError, resync, type ServerKey } from './push';
import '../i18n';

/**
 * "Notifications on this device" card: permission flow, subscribe /
 * unsubscribe, a test push and the iOS home-screen note. Drop it into any
 * profile page; it renders nothing harmful when push is unavailable.
 */
export function PushToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const { t } = useI18n();
  const support = pushSupport();
  const key = useQuery({ queryKey: ['push', 'key'], queryFn: () => api<ServerKey>('/push/public-key', { auth: 'none' }), staleTime: 10 * 60_000, retry: false });
  const [on, setOn] = useState(false);
  const [checking, setChecking] = useState(support === 'supported');
  const [perm, setPerm] = useState(permission());

  useEffect(() => {
    if (support !== 'supported') return;
    let alive = true;
    currentSubscription()
      .then((s) => {
        const granted = !!s && Notification.permission === 'granted';
        if (alive) setOn(granted);
        // Keep the server in sync (the browser may have rotated the endpoint, or another account used this device).
        if (granted && s) void resync(s);
      })
      .catch(() => undefined)
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [support]);

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await enablePush();
      else await disablePush();
      return next;
    },
    onSuccess: (next) => {
      setOn(next);
      setPerm(permission());
      toast.success(next ? t('intake.push.enabled') : t('intake.push.disabled'));
    },
    onError: (e) => {
      setPerm(permission());
      if (e instanceof PushError) toast.error(t(`intake.push.err.${e.code}`));
      else toast.error(errorMessage(e));
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ sent: number; failed: number }>('/push/test', { method: 'POST' }),
    onSuccess: (r) => (r.sent > 0 ? toast.success(t('intake.push.testSent')) : toast.error(t('intake.push.testNone'))),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const serverOff = key.data && !key.data.enabled;
  const blocked = perm === 'denied';
  const disabled = support !== 'supported' || serverOff || blocked || checking;

  return (
    <div className={cn('rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
      <div className="flex items-start gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', on ? 'bg-turtle-50 text-turtle-700 dark:bg-turtle-950 dark:text-turtle-300' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300')}>
          {on ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-900 dark:text-white">{t('intake.push.title')}</p>
          {!compact && <p className="mt-0.5 text-sm text-ink-500">{t('intake.push.hint')}</p>}
        </div>
        <Switch checked={on} disabled={disabled || toggle.isPending} onChange={(v) => toggle.mutate(v)} label={<span className="sr-only">{t('intake.push.title')}</span>} />
      </div>
      {support === 'ios-needs-install' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950/60 dark:text-sky-200">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('intake.push.ios')} <Share className="inline h-3.5 w-3.5" /></span>
        </p>
      )}
      {support === 'unsupported' && <p className="mt-3 text-xs text-ink-500">{t('intake.push.unsupported')}</p>}
      {serverOff && support === 'supported' && <p className="mt-3 text-xs text-ink-500">{t('intake.push.serverOff')}</p>}
      {blocked && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">{t('intake.push.blocked')}</p>}
      {on && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" icon={<Send className="h-3.5 w-3.5" />} loading={test.isPending} onClick={() => test.mutate()}>{t('intake.push.test')}</Button>
        </div>
      )}
    </div>
  );
}
