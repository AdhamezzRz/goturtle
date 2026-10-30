import { Route, Routes } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { AppShell, type NavGroup } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui';
import { useI18n } from '@/i18n';

export default function OpsApp() {
  const { t } = useI18n();
  const nav: NavGroup[] = [{ items: [{ to: '/ops', end: true, label: 'Dashboard', icon: <LayoutDashboard /> }] }];
  return (
    <AppShell nav={nav} title={t('portal.ops')} profilePath="/ops/profile" notificationsPath="/ops/notifications">
      <Routes>
        <Route index element={<PageHeader title="Operations" />} />
      </Routes>
    </AppShell>
  );
}
