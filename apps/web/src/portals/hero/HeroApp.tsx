import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { CalendarClock, ListChecks, Map, User, Wallet } from 'lucide-react';
import { HeroShell } from '@/components/layout/HeroShell';
import { PageLoader } from '@/components/ui';
import { useI18n } from '@/i18n';
import { HeroHeader } from './HeroHeader';
import './i18n';

const p = {
  Today: lazy(() => import('./pages/TodayPage')),
  Stop: lazy(() => import('./pages/StopPage')),
  Pickup: lazy(() => import('./pages/PickupPage')),
  Map: lazy(() => import('./pages/MapPage')),
  Wallet: lazy(() => import('./pages/WalletPage')),
  Earnings: lazy(() => import('./pages/EarningsPage')),
  Shifts: lazy(() => import('./pages/ShiftsPage')),
  Me: lazy(() => import('./pages/MePage')),
  Achievements: lazy(() => import('./pages/AchievementsPage')),
};

export default function HeroApp() {
  const { t } = useI18n();
  return (
    <HeroShell
      header={<HeroHeader />}
      tabs={[
        { to: '/hero', end: true, label: t('hero.tab.today'), icon: <ListChecks /> },
        { to: '/hero/map', label: t('hero.tab.map'), icon: <Map /> },
        { to: '/hero/wallet', label: t('hero.tab.wallet'), icon: <Wallet /> },
        { to: '/hero/shifts', label: t('hero.tab.shifts'), icon: <CalendarClock /> },
        { to: '/hero/me', label: t('hero.tab.me'), icon: <User /> },
      ]}
    >
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<p.Today />} />
          <Route path="stops/:orderId" element={<p.Stop />} />
          <Route path="pickups/:id" element={<p.Pickup />} />
          <Route path="map" element={<p.Map />} />
          <Route path="wallet" element={<p.Wallet />} />
          <Route path="earnings" element={<p.Earnings />} />
          <Route path="shifts" element={<p.Shifts />} />
          <Route path="me" element={<p.Me />} />
          <Route path="achievements" element={<p.Achievements />} />
          <Route path="*" element={<Navigate to="/hero" replace />} />
        </Routes>
      </Suspense>
    </HeroShell>
  );
}
