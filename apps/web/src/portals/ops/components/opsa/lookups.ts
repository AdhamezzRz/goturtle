import { useQuery } from '@tanstack/react-query';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n';
import type { BrandRow, CourierRow, HubRow, StaffUser, ZoneRow } from './types';

/** Cached reference data used by filters and pickers across the Ops screens. */
const LONG = 5 * 60_000;

export function useHubs() {
  const { can } = useAuth();
  return useQuery({ queryKey: ['network', 'hubs'], queryFn: () => api<HubRow[]>('/network/hubs'), staleTime: LONG, enabled: can('network.read') });
}

export function useZones() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['network', 'zones', 'all'],
    queryFn: () => api<Paginated<ZoneRow>>('/network/zones', { query: { pageSize: 200, order: 'asc' } }).then((r) => r.data),
    staleTime: LONG,
    enabled: can('network.read'),
  });
}

export function useBrands() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['brands', 'lookup'],
    queryFn: () => api<Paginated<BrandRow>>('/brands', { query: { pageSize: 200 } }).then((r) => r.data),
    staleTime: LONG,
    enabled: can('brands.read'),
  });
}

export function useCouriers(filter: { hubId?: string; zoneId?: string; status?: string } = {}) {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['couriers', 'lookup', filter],
    queryFn: () => api<Paginated<CourierRow>>('/couriers', { query: { pageSize: 200, status: filter.status ?? 'ACTIVE', hubId: filter.hubId, zoneId: filter.zoneId } }).then((r) => r.data),
    staleTime: 60_000,
    enabled: can('couriers.read'),
  });
}

export function useStaffUsers() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['users', 'staff-lookup'],
    queryFn: () => api<Paginated<StaffUser>>('/users', { query: { pageSize: 200, kind: 'staff', status: 'ACTIVE' } }).then((r) => r.data),
    staleTime: LONG,
    enabled: can('users.read'),
  });
}

/** Select options helpers (bilingual labels). */
export function useLookupOptions() {
  const { pick } = useI18n();
  const hubs = useHubs();
  const zones = useZones();
  const brands = useBrands();
  return {
    hubs: (hubs.data ?? []).map((h) => ({ value: h.id, label: `${pick(h as unknown as Record<string, unknown>, 'name') || h.name} · ${h.code}` })),
    zones: (zones.data ?? []).map((z) => ({ value: z.id, label: `${pick(z as unknown as Record<string, unknown>, 'name')} · ${z.code}` })),
    brands: (brands.data ?? []).map((b) => ({ value: b.id, label: `${b.name} · ${b.code}` })),
    hubsData: hubs.data ?? [],
    zonesData: zones.data ?? [],
    brandsData: brands.data ?? [],
  };
}
