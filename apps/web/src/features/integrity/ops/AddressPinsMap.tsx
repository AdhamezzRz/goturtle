import { useMemo } from 'react';
import { MAP_COLORS, OpsMap, type OpsMarker } from '@/portals/ops/components/opsa/OpsMap';
import type { CustomerAddress } from '../types';

/** Customer address book on a map: verified pins green, unverified grey. Lazy-loaded (Leaflet). */
export default function AddressPinsMap({ addresses, selected, onSelect }: { addresses: CustomerAddress[]; selected?: string | null; onSelect?: (id: string) => void }) {
  const markers = useMemo<OpsMarker[]>(
    () =>
      addresses
        .filter((a) => a.lat != null && a.lng != null)
        .map((a, i) => ({
          id: a.id,
          type: 'pin' as const,
          lat: a.lat!,
          lng: a.lng!,
          label: i + 1,
          color: a.isVerified ? MAP_COLORS.done : MAP_COLORS.offline,
          selected: a.id === selected,
          title: a.addressLine,
          onClick: onSelect ? () => onSelect(a.id) : undefined,
        })),
    [addresses, selected, onSelect],
  );
  return <OpsMap markers={markers} height={240} padding={40} />;
}
