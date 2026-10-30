import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu as MenuIcon, X, WifiOff } from 'lucide-react';
import type { Permission } from '@goturtle/shared';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Logo } from './Brand';
import { LanguageToggle, NotificationBell, ProfileMenu, ThemeToggle } from './Controls';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  permission?: Permission;
  end?: boolean;
  badge?: ReactNode;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * Desktop-first shell for the Ops and Brand portals: collapsible sidebar,
 * top bar with language/theme/notifications/profile, offline banner.
 */
export function AppShell({ nav, children, title, profilePath, notificationsPath, headerExtra, accent = 'turtle' }: {
  nav: NavGroup[]; children: ReactNode; title: ReactNode; profilePath: string; notificationsPath: string; headerExtra?: ReactNode; accent?: 'turtle' | 'ink';
}) {
  const [open, setOpen] = useState(false);
  const { can } = useAuth();
  const location = useLocation();
  const online = useOnline();
  const { t } = useI18n();
  useEffect(() => setOpen(false), [location.pathname]);

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo light />
        <button className="text-ink-300 lg:hidden" onClick={() => setOpen(false)} aria-label="close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="px-5 pb-2 text-[11px] font-semibold uppercase tracking-widest text-turtle-300/80">{title}</div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 scrollbar-none">
        {nav.map((group, gi) => {
          const items = group.items.filter((i) => !i.permission || can(i.permission));
          if (!items.length) return null;
          return (
            <div key={gi}>
              {group.label && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{group.label}</p>}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                          isActive ? 'bg-white/10 text-white shadow-inner' : 'text-ink-300 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      <span className="shrink-0 opacity-90 [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 px-5 py-4 text-xs text-ink-400">{t('common.poweredBy')} · v1.0</div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:ps-64">
      <aside className={cn('fixed inset-y-0 start-0 z-40 hidden w-64 lg:block', accent === 'turtle' ? 'bg-gradient-to-b from-ink-950 via-ink-950 to-turtle-950' : 'bg-ink-950')}>{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 animate-fade-in bg-ink-950">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-100 bg-white/85 px-4 backdrop-blur dark:border-ink-800 dark:bg-ink-950/80 sm:px-6">
        <button className="rounded-lg p-1.5 text-ink-600 hover:bg-ink-100 lg:hidden" onClick={() => setOpen(true)} aria-label="open menu">
          <MenuIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">{headerExtra}</div>
        <LanguageToggle />
        <ThemeToggle />
        <NotificationBell to={notificationsPath} />
        <ProfileMenu profilePath={profilePath} />
      </header>
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900">
          <WifiOff className="h-4 w-4" /> {t('common.offline')}
        </div>
      )}
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
