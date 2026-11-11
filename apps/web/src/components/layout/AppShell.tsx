import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu as MenuIcon, X, WifiOff } from 'lucide-react';
import type { Permission } from '@goturtle/shared';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/hooks';
import { useI18n } from '@/i18n';
import { Logo } from './Brand';
import { ArchMark } from '@/components/brand';
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

  // Brand book p.5: deep green surface, lime mark. The Brand portal uses the ink variant.
  const surface = accent === 'turtle' ? 'bg-gradient-to-b from-turtle-700 via-turtle-800 to-turtle-950' : 'bg-gradient-to-b from-ink-900 to-ink-950';
  const watermark = <ArchMark className="pointer-events-none absolute -bottom-16 -end-20 h-72 w-72 text-white/[.04]" />;
  const sidebar = (
    <nav className="relative flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo light />
        <button className="text-white/70 lg:hidden" onClick={() => setOpen(false)} aria-label="close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="px-5 pb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-lime-300/90">{title}</div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 scrollbar-none">
        {nav.map((group, gi) => {
          const items = group.items.filter((i) => !i.permission || can(i.permission));
          if (!items.length) return null;
          return (
            <div key={gi}>
              {group.label && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">{group.label}</p>}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                          isActive ? 'bg-lime-300 font-semibold text-turtle-950 shadow-[0_6px_18px_-8px_rgba(219,230,76,.7)]' : 'text-white/70 hover:bg-white/[.07] hover:text-white',
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
      <div className="flex items-center gap-2 border-t border-white/10 px-5 py-4 text-xs text-white/45"><ArchMark className="h-3.5 w-3.5 text-lime-300/80" />{t('common.poweredBy')} · v1.1</div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:ps-64">
      <aside className={cn('fixed inset-y-0 start-0 z-40 hidden w-64 overflow-hidden lg:block', surface)}>{watermark}{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setOpen(false)} />
          <aside className={cn('absolute inset-y-0 start-0 w-72 animate-fade-in overflow-hidden', surface)}>{watermark}{sidebar}</aside>
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
