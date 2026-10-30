import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission, type Permission, type UserRole } from '@goturtle/shared';
import { api, onSessionChange, sessionStore, type UserSession } from './api';
import { PageLoader } from '@/components/ui';

export type Portal = 'ops' | 'brand' | 'hero';

export interface Me {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: UserRole;
  status: string;
  locale: 'ar' | 'en';
  avatarUrl: string | null;
  brandId: string | null;
  hubId: string | null;
  portal: Portal;
  permissions: Permission[];
  brand: { id: string; name: string; code: string; logoUrl: string | null; status: string } | null;
  courier: {
    id: string; code: string; employmentType: string; status: string; availability: string; vehicleType: string;
    xp: number; rating: number; cashOnHandCents: number; cashLimitCents: number;
  } | null;
}

interface AuthValue {
  me: Me | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  can: (p: Permission) => boolean;
  refreshMe: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [hasSession, setHasSession] = useState(() => !!sessionStore.user());
  useEffect(() => onSessionChange(() => setHasSession(!!sessionStore.user())), []);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    enabled: hasSession,
    staleTime: 60_000,
    retry: false,
  });

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const res = await api<UserSession & { user: Me }>('/auth/login', { method: 'POST', body: { identifier, password }, auth: 'none' });
      sessionStore.setUser({ accessToken: res.accessToken, refreshToken: res.refreshToken, expiresAt: res.expiresAt });
      qc.setQueryData(['me'], res.user);
      return res.user;
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    const s = sessionStore.user();
    if (s) await api('/auth/logout', { method: 'POST', body: { refreshToken: s.refreshToken }, auth: 'none' }).catch(() => undefined);
    sessionStore.setUser(null);
    qc.clear();
  }, [qc]);

  const me = hasSession ? meQuery.data ?? null : null;
  const value = useMemo<AuthValue>(
    () => ({
      me,
      loading: hasSession && meQuery.isLoading,
      signIn,
      signOut,
      can: (p) => (me ? hasPermission(me.role, p) : false),
      refreshMe: () => void meQuery.refetch(),
    }),
    [me, hasSession, meQuery, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export const portalHome = (portal: Portal) => (portal === 'ops' ? '/ops' : portal === 'brand' ? '/brand' : '/hero');

/** Gate a portal: sends anonymous users to /login and wrong-portal users to their own portal. */
export function RequirePortal({ portal, children }: { portal: Portal; children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (me.portal !== portal) return <Navigate to={portalHome(me.portal)} replace />;
  return <>{children}</>;
}

/** Hide UI the user is not allowed to use. */
export function Can({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth();
  return <>{can(permission) ? children : fallback}</>;
}
