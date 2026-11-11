import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { BarChart3, Boxes, Code2, FileWarning, Headphones, LayoutDashboard, Link2, PackagePlus, PackageSearch, Settings, Upload, Users, Wallet } from 'lucide-react';
import { AppShell, type NavGroup } from '@/components/layout/AppShell';
import { Button, PageLoader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n';
import './i18n';

const p = {
  Dashboard: lazy(() => import('./pages/DashboardPage')),
  Orders: lazy(() => import('./pages/OrdersPage')),
  OrderDetail: lazy(() => import('./pages/OrderDetailPage')),
  NewOrder: lazy(() => import('./pages/NewOrderPage')),
  Bulk: lazy(() => import('./pages/BulkUploadPage')),
  Labels: lazy(() => import('./pages/LabelsPage')),
  Pickups: lazy(() => import('./pages/PickupsPage')),
  Wallet: lazy(() => import('./pages/WalletPage')),
  SettlementDetail: lazy(() => import('./pages/SettlementDetailPage')),
  Analytics: lazy(() => import('./pages/AnalyticsPage')),
  Tickets: lazy(() => import('./pages/TicketsPage')),
  TicketDetail: lazy(() => import('./pages/TicketDetailPage')),
  Team: lazy(() => import('./pages/TeamPage')),
  Developers: lazy(() => import('./pages/DevelopersPage')),
  Settings: lazy(() => import('./pages/SettingsPage')),
  Notifications: lazy(() => import('./pages/NotificationsPage')),
  Profile: lazy(() => import('./pages/ProfilePage')),
  Claims: lazy(() => import('./pages/ClaimsPage')),
  OrderLinks: lazy(() => import('./pages/OrderLinksPage')),
};

export default function BrandApp() {
  const { t } = useI18n();
  const { me } = useAuth();
  const nav: NavGroup[] = [
    {
      items: [
        { to: '/brand', end: true, label: t('brand.nav.dashboard'), icon: <LayoutDashboard /> },
        { to: '/brand/orders', end: true, label: t('brand.nav.orders'), icon: <PackageSearch />, permission: 'orders.read' },
        { to: '/brand/orders/new', label: t('brand.nav.newOrder'), icon: <PackagePlus />, permission: 'orders.create' },
        { to: '/brand/orders/bulk', label: t('brand.nav.bulk'), icon: <Upload />, permission: 'orders.create' },
        { to: '/brand/pickups', label: t('brand.nav.pickups'), icon: <Boxes />, permission: 'pickups.read' },
        { to: '/brand/order-links', label: t('brand.nav.orderLinks'), icon: <Link2 />, permission: 'orders.create' },
      ],
    },
    {
      label: t('brand.nav.group.business'),
      items: [
        { to: '/brand/wallet', label: t('brand.nav.wallet'), icon: <Wallet />, permission: 'finance.read' },
        { to: '/brand/analytics', label: t('brand.nav.analytics'), icon: <BarChart3 />, permission: 'analytics.read' },
        { to: '/brand/support', label: t('brand.nav.support'), icon: <Headphones />, permission: 'tickets.read' },
        { to: '/brand/claims', label: t('brand.nav.claims'), icon: <FileWarning />, permission: 'tickets.read' },
      ],
    },
    {
      label: t('brand.nav.group.account'),
      items: [
        { to: '/brand/team', label: t('brand.nav.team'), icon: <Users />, permission: 'users.read' },
        { to: '/brand/developers', label: t('brand.nav.developers'), icon: <Code2 />, permission: 'integrations.manage' },
        { to: '/brand/settings', label: t('brand.nav.settings'), icon: <Settings /> },
      ],
    },
  ];
  const pending = me?.brand?.status === 'PENDING';
  return (
    <AppShell
      accent="ink"
      nav={nav}
      title={me?.brand?.name ?? t('portal.brand')}
      profilePath="/brand/profile"
      notificationsPath="/brand/notifications"
      headerExtra={
        <Link to="/brand/orders/new" className="hidden sm:inline-block">
          <Button size="sm" icon={<PackagePlus className="h-4 w-4" />}>{t('brand.nav.newOrder')}</Button>
        </Link>
      }
    >
      {pending && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="font-semibold">{t('brand.pending.title')}</p>
          <p className="mt-0.5">{t('brand.pending.body')}</p>
        </div>
      )}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<p.Dashboard />} />
          <Route path="orders" element={<p.Orders />} />
          <Route path="orders/new" element={<p.NewOrder />} />
          <Route path="orders/bulk" element={<p.Bulk />} />
          <Route path="orders/labels" element={<p.Labels />} />
          <Route path="orders/:id" element={<p.OrderDetail />} />
          <Route path="pickups" element={<p.Pickups />} />
          <Route path="wallet" element={<p.Wallet />} />
          <Route path="wallet/settlements/:id" element={<p.SettlementDetail />} />
          <Route path="analytics" element={<p.Analytics />} />
          <Route path="support" element={<p.Tickets />} />
          <Route path="support/:id" element={<p.TicketDetail />} />
          <Route path="team" element={<p.Team />} />
          <Route path="developers" element={<p.Developers />} />
          <Route path="settings" element={<p.Settings />} />
          <Route path="notifications" element={<p.Notifications />} />
          <Route path="profile" element={<p.Profile />} />
          <Route path="claims" element={<p.Claims />} />
          <Route path="order-links" element={<p.OrderLinks />} />
          <Route path="*" element={<Navigate to="/brand" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
