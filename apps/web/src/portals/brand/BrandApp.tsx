import { Route, Routes } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { AppShell, type NavGroup } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui';
import { useI18n } from '@/i18n';

export default function BrandApp() {
  const { t } = useI18n();
  const nav: NavGroup[] = [{ items: [{ to: '/brand', end: true, label: 'Dashboard', icon: <LayoutDashboard /> }] }];
  return (
    <AppShell nav={nav} title={t('portal.brand')} profilePath="/brand/profile" notificationsPath="/brand/notifications">
      <Routes>
        <Route index element={<PageHeader title="Brand" />} />
      </Routes>
    </AppShell>
  );
}
