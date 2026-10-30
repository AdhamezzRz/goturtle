import { Route, Routes } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { HeroShell } from '@/components/layout/HeroShell';
import { useAuth } from '@/lib/auth';

export default function HeroApp() {
  const { me } = useAuth();
  return (
    <HeroShell header={<p className="text-lg font-bold">{me?.name}</p>} tabs={[{ to: '/hero', end: true, label: 'Today', icon: <ListChecks /> }]}>
      <Routes>
        <Route index element={<p>Hero</p>} />
      </Routes>
    </HeroShell>
  );
}
