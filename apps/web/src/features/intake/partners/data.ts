import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Partner } from '../types';

export type Governorate = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
};

export function usePartners(enabled = true) {
  const { can } = useAuth();
  return useQuery({ queryKey: ['partners'], queryFn: () => api<Partner[]>('/partners'), enabled: enabled && can('dispatch.manage'), staleTime: 30_000 });
}

export function useGovernorates() {
  return useQuery({ queryKey: ['network', 'governorates'], queryFn: () => api<Governorate[]>('/network/governorates'), staleTime: 10 * 60_000 });
}

/** Outcomes staff record on behalf of a manual partner. */
export const OUTCOMES = ['DELIVERED', 'FAILED', 'RETURNED'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const PARTNER_FAILURE_REASONS = ['CUSTOMER_UNREACHABLE', 'CUSTOMER_REFUSED', 'CUSTOMER_NOT_PRESENT', 'WRONG_ADDRESS', 'INCOMPLETE_ADDRESS', 'NO_CASH', 'OUT_OF_ZONE', 'OTHER'] as const;
