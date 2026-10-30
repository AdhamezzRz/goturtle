import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useOnline } from '@/lib/hooks';
import { useI18n } from '@/i18n';

export interface HeroTab {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/** Mobile-first shell for the Hero PWA: sticky header + thumb-reachable bottom navigation. */
export function HeroShell({ header, tabs, children }: { header: ReactNode; tabs: HeroTab[]; children: ReactNode }) {
  const online = useOnline();
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-ink-50 dark:bg-ink-950">
      <header className="sticky top-0 z-30 bg-gradient-to-br from-turtle-700 to-turtle-900 px-4 pb-4 pt-[max(env(safe-area-inset-top),0.75rem)] text-white shadow-md">{header}</header>
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-900">
          <WifiOff className="h-4 w-4" /> {t('common.offline')}
        </div>
      )}
      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t border-ink-100 bg-white/95 backdrop-blur dark:border-ink-800 dark:bg-ink-900/95">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold', isActive ? 'text-turtle-700 dark:text-turtle-400' : 'text-ink-400')}
              >
                <span className="[&>svg]:h-6 [&>svg]:w-6">{tab.icon}</span>
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
