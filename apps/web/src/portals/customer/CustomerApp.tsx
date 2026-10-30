import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PageLoader } from '@/components/ui';

const TrackLanding = lazy(() => import('./pages/TrackLandingPage'));
const Tracking = lazy(() => import('./pages/TrackingPage'));
const MyOrders = lazy(() => import('./pages/MyOrdersPage'));

/** Mounted at /track/* and /t/* (short link used in SMS: /t/GT4829150376). */
export default function CustomerApp() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route index element={<TrackLanding />} />
        <Route path="orders" element={<MyOrders />} />
        <Route path=":trackingNumber" element={<Tracking />} />
      </Routes>
    </Suspense>
  );
}
