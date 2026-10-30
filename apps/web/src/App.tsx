import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { RequirePortal } from '@/lib/auth';
import { Button, EmptyState, PageLoader } from '@/components/ui';
import { useI18n } from '@/i18n';

const LandingPage = lazy(() => import('@/portals/public/LandingPage'));
const LoginPage = lazy(() => import('@/portals/public/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/portals/public/ForgotPasswordPage'));
const OpsApp = lazy(() => import('@/portals/ops/OpsApp'));
const BrandApp = lazy(() => import('@/portals/brand/BrandApp'));
const HeroApp = lazy(() => import('@/portals/hero/HeroApp'));
const CustomerApp = lazy(() => import('@/portals/customer/CustomerApp'));

/**
 * One SPA, four portals (code-split):
 *   /ops/*    company operations (staff)
 *   /brand/*  merchants
 *   /hero/*   delivery heroes (mobile PWA)
 *   /track, /t/:trackingNumber  customers (public + OTP session)
 */
export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/ops/*" element={<RequirePortal portal="ops"><OpsApp /></RequirePortal>} />
        <Route path="/brand/*" element={<RequirePortal portal="brand"><BrandApp /></RequirePortal>} />
        <Route path="/hero/*" element={<RequirePortal portal="hero"><HeroApp /></RequirePortal>} />
        <Route path="/track/*" element={<CustomerApp />} />
        <Route path="/t/*" element={<CustomerApp />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center">
      <EmptyState title="404" description={t('error.NOT_FOUND')} action={<Link to="/"><Button>{t('action.back')}</Button></Link>} />
    </div>
  );
}
