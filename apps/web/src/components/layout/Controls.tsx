import { Bell, Globe, LogOut, Moon, Sun, User } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme, usePollInterval } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Avatar, IconButton, Menu } from '@/components/ui';
import { num } from '@/lib/format';

export function LanguageToggle({ className }: { className?: string }) {
  const { t, toggle } = useI18n();
  return (
    <button onClick={toggle} className={className ?? 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'}>
      <Globe className="h-4 w-4" />
      {t('common.language')}
    </button>
  );
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  const { t } = useI18n();
  return <IconButton label={t('common.theme')} onClick={toggle} icon={dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} />;
}

/** Unread in-app notifications (polls; hidden if the endpoint is unavailable). */
export function NotificationBell({ to }: { to: string }) {
  const navigate = useNavigate();
  const interval = usePollInterval(45_000);
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ unread?: number; count?: number }>('/notifications/unread-count'),
    refetchInterval: interval,
    retry: false,
  });
  if (q.isError) return null;
  const count = q.data?.unread ?? q.data?.count ?? 0;
  return (
    <button onClick={() => navigate(to)} className="relative grid h-8 w-8 place-items-center rounded-lg text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800" aria-label="notifications">
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{count > 99 ? '99+' : num(count)}</span>
      )}
    </button>
  );
}

export function ProfileMenu({ profilePath }: { profilePath: string }) {
  const { me, signOut } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <Menu
      trigger={
        <button className="flex items-center gap-2 rounded-lg p-1 pe-2 hover:bg-ink-100 dark:hover:bg-ink-800">
          <Avatar name={me.name} src={me.avatarUrl} size={30} />
          <span className="hidden text-start leading-tight md:block">
            <span className="block max-w-[140px] truncate text-sm font-semibold">{me.name}</span>
            <span className="block text-[11px] text-ink-500">{t(`role.${me.role}`)}</span>
          </span>
        </button>
      }
      items={[
        { label: t('nav.profile'), icon: <User className="h-4 w-4" />, onClick: () => navigate(profilePath) },
        { label: t('action.signOut'), icon: <LogOut className="h-4 w-4" />, danger: true, onClick: () => void signOut().then(() => navigate('/login')) },
      ]}
    />
  );
}
