import { useMemo } from 'react';
import { MAP_COLORS, OpsMap, type OpsMarker } from '@/portals/ops/components/opsa/OpsMap';

/**
 * Mini map for a disputed attempt: the delivery pin with its geofence circle
 * and where the hero was when reporting the failure. Lazy-loaded (Leaflet).
 */
export default function EvidenceMap({
  destination, hero, geofenceMeters, height = 200, labels,
}: {
  destination: { lat: number; lng: number } | null;
  hero: { lat: number; lng: number } | null;
  geofenceMeters: number;
  height?: number;
  labels: { destination: string; hero: string };
}) {
  const markers = useMemo<OpsMarker[]>(() => {
    const m: OpsMarker[] = [];
    if (destination) m.push({ id: 'dest', type: 'pin', lat: destination.lat, lng: destination.lng, color: MAP_COLORS.order, title: labels.destination });
    if (hero) m.push({ id: 'hero', type: 'hero', lat: hero.lat, lng: hero.lng, color: MAP_COLORS.failed, label: '!', title: labels.hero });
    return m;
  }, [destination, hero, labels.destination, labels.hero]);
  const circles = destination && geofenceMeters > 0 ? [{ id: 'fence', center: [destination.lat, destination.lng] as [number, number], radius: geofenceMeters, color: MAP_COLORS.online }] : [];
  return <OpsMap markers={markers} circles={circles} height={height} padding={30} fitKey={`${destination?.lat}:${hero?.lat}`} />;
}
