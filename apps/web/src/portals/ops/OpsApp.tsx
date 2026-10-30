import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  Banknote, BarChart3, Bike, Boxes, Building2, CalendarClock, Cog, FileClock, Headphones, LayoutDashboard, Map, Network,
  PackageSearch, Plug, Radar, ReceiptText, ScanLine, Server, Tags, Truck, Users, UserSquare2, Wallet,
} from 'lucide-react';
import { AppShell, type NavGroup } from '@/components/layout/AppShell';
import { PageLoader } from '@/components/ui';
import { useI18n } from '@/i18n';
import './i18n';

const p = {
  Dashboard: lazy(() => import('./pages/dashboard/DashboardPage')),
  Live: lazy(() => import('./pages/live/LivePage')),
  Orders: lazy(() => import('./pages/orders/OrdersPage')),
  OrderDetail: lazy(() => import('./pages/orders/OrderDetailPage')),
  NewOrder: lazy(() => import('./pages/orders/NewOrderPage')),
  Pickups: lazy(() => import('./pages/pickups/PickupsPage')),
  Dispatch: lazy(() => import('./pages/dispatch/DispatchPage')),
  RunsheetDetail: lazy(() => import('./pages/dispatch/RunsheetDetailPage')),
  HubScan: lazy(() => import('./pages/hub/HubScanPage')),
  Customers: lazy(() => import('./pages/customers/CustomersPage')),
  CustomerDetail: lazy(() => import('./pages/customers/CustomerDetailPage')),
  Tickets: lazy(() => import('./pages/tickets/TicketsPage')),
  TicketDetail: lazy(() => import('./pages/tickets/TicketDetailPage')),
  Network: lazy(() => import('./pages/network/NetworkPage')),
  Pricing: lazy(() => import('./pages/pricing/PricingPage')),
  Analytics: lazy(() => import('./pages/analytics/AnalyticsPage')),
  Heroes: lazy(() => import('./pages/heroes/HeroesPage')),
  HeroDetail: lazy(() => import('./pages/heroes/HeroDetailPage')),
  Shifts: lazy(() => import('./pages/shifts/ShiftsPage')),
  Cash: lazy(() => import('./pages/cash/CashPage')),
  Finance: lazy(() => import('./pages/finance/FinancePage')),
  Settlements: lazy(() => import('./pages/finance/SettlementsPage')),
  SettlementDetail: lazy(() => import('./pages/finance/SettlementDetailPage')),
  Payouts: lazy(() => import('./pages/finance/PayoutsPage')),
  Brands: lazy(() => import('./pages/brands/BrandsPage')),
  BrandDetail: lazy(() => import('./pages/brands/BrandDetailPage')),
  Users: lazy(() => import('./pages/users/UsersPage')),
  Settings: lazy(() => import('./pages/settings/SettingsPage')),
  Integrations: lazy(() => import('./pages/integrations/IntegrationsPage')),
  Audit: lazy(() => import('./pages/audit/AuditPage')),
  System: lazy(() => import('./pages/system/SystemPage')),
  Notifications: lazy(() => import('./pages/account/NotificationsPage')),
  Profile: lazy(() => import('./pages/account/ProfilePage')),
};

export default function OpsApp() {
  const { t } = useI18n();
  const nav: NavGroup[] = [
    {
      items: [
        { to: '/ops', end: true, label: t('ops.nav.dashboard'), icon: <LayoutDashboard /> },
        { to: '/ops/live', label: t('ops.nav.live'), icon: <Radar />, permission: 'couriers.track' },
        { to: '/ops/analytics', label: t('ops.nav.analytics'), icon: <BarChart3 />, permission: 'analytics.read' },
      ],
    },
    {
      label: t('ops.nav.group.operations'),
      items: [
        { to: '/ops/orders', label: t('ops.nav.orders'), icon: <PackageSearch />, permission: 'orders.read' },
        { to: '/ops/pickups', label: t('ops.nav.pickups'), icon: <Boxes />, permission: 'pickups.read' },
        { to: '/ops/dispatch', label: t('ops.nav.dispatch'), icon: <Truck />, permission: 'runsheets.read' },
        { to: '/ops/hub', label: t('ops.nav.hub'), icon: <ScanLine />, permission: 'hubs.scan' },
        { to: '/ops/customers', label: t('ops.nav.customers'), icon: <UserSquare2 />, permission: 'orders.read' },
        { to: '/ops/tickets', label: t('ops.nav.tickets'), icon: <Headphones />, permission: 'tickets.read' },
      ],
    },
    {
      label: t('ops.nav.group.workforce'),
      items: [
        { to: '/ops/heroes', label: t('ops.nav.heroes'), icon: <Bike />, permission: 'couriers.read' },
        { to: '/ops/shifts', label: t('ops.nav.shifts'), icon: <CalendarClock />, permission: 'shifts.read' },
        { to: '/ops/cash', label: t('ops.nav.cash'), icon: <Wallet />, permission: 'cash.read' },
      ],
    },
    {
      label: t('ops.nav.group.finance'),
      items: [
        { to: '/ops/finance', end: true, label: t('ops.nav.finance'), icon: <Banknote />, permission: 'finance.read' },
        { to: '/ops/finance/settlements', label: t('ops.nav.settlements'), icon: <ReceiptText />, permission: 'finance.read' },
        { to: '/ops/finance/payouts', label: t('ops.nav.payouts'), icon: <Users />, permission: 'finance.read' },
      ],
    },
    {
      label: t('ops.nav.group.commercial'),
      items: [
        { to: '/ops/brands', label: t('ops.nav.brands'), icon: <Building2 />, permission: 'brands.read' },
        { to: '/ops/pricing', label: t('ops.nav.pricing'), icon: <Tags />, permission: 'pricing.manage' },
      ],
    },
    {
      label: t('ops.nav.group.admin'),
      items: [
        { to: '/ops/network', label: t('ops.nav.network'), icon: <Network />, permission: 'network.read' },
        { to: '/ops/users', label: t('ops.nav.users'), icon: <Users />, permission: 'users.read' },
        { to: '/ops/integrations', label: t('ops.nav.integrations'), icon: <Plug />, permission: 'integrations.manage' },
        { to: '/ops/settings', label: t('ops.nav.settings'), icon: <Cog />, permission: 'settings.manage' },
        { to: '/ops/audit', label: t('ops.nav.audit'), icon: <FileClock />, permission: 'audit.read' },
        { to: '/ops/system', label: t('ops.nav.system'), icon: <Server />, permission: 'settings.manage' },
      ],
    },
  ];

  return (
    <AppShell nav={nav} title={t('portal.ops')} profilePath="/ops/profile" notificationsPath="/ops/notifications" headerExtra={<span className="hidden items-center gap-2 text-sm text-ink-500 md:flex"><Map className="h-4 w-4" />{t('ops.header.network')}</span>}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<p.Dashboard />} />
          <Route path="live" element={<p.Live />} />
          <Route path="analytics" element={<p.Analytics />} />
          <Route path="orders" element={<p.Orders />} />
          <Route path="orders/new" element={<p.NewOrder />} />
          <Route path="orders/:id" element={<p.OrderDetail />} />
          <Route path="pickups" element={<p.Pickups />} />
          <Route path="dispatch" element={<p.Dispatch />} />
          <Route path="dispatch/runsheets/:id" element={<p.RunsheetDetail />} />
          <Route path="hub" element={<p.HubScan />} />
          <Route path="customers" element={<p.Customers />} />
          <Route path="customers/:id" element={<p.CustomerDetail />} />
          <Route path="tickets" element={<p.Tickets />} />
          <Route path="tickets/:id" element={<p.TicketDetail />} />
          <Route path="network" element={<p.Network />} />
          <Route path="pricing" element={<p.Pricing />} />
          <Route path="heroes" element={<p.Heroes />} />
          <Route path="heroes/:id" element={<p.HeroDetail />} />
          <Route path="shifts" element={<p.Shifts />} />
          <Route path="cash" element={<p.Cash />} />
          <Route path="finance" element={<p.Finance />} />
          <Route path="finance/settlements" element={<p.Settlements />} />
          <Route path="finance/settlements/:id" element={<p.SettlementDetail />} />
          <Route path="finance/payouts" element={<p.Payouts />} />
          <Route path="brands" element={<p.Brands />} />
          <Route path="brands/:id" element={<p.BrandDetail />} />
          <Route path="users" element={<p.Users />} />
          <Route path="settings" element={<p.Settings />} />
          <Route path="integrations" element={<p.Integrations />} />
          <Route path="audit" element={<p.Audit />} />
          <Route path="system" element={<p.System />} />
          <Route path="notifications" element={<p.Notifications />} />
          <Route path="profile" element={<p.Profile />} />
          <Route path="*" element={<Navigate to="/ops" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
