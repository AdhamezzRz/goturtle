import { useMemo } from 'react';
import { LiveMap, type MapPoint } from '@/components/ui/Map';
import { timeOnly } from '@/lib/format';
import { useI18n } from '@/i18n';
import type { TrackPoint } from './types';

/** Breadcrumbs of one day (lazy-loaded: Leaflet). */
export default function HeroTrackMap({ points, hub }: { points: TrackPoint[]; hub?: { lat: number | null; lng: number | null; name: string } | null }) {
  const { t } = useI18n();
  const route = useMemo(() => points.map((p) => [p.lat, p.lng] as [number, number]), [points]);
  const markers = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    if (hub?.lat && hub?.lng) out.push({ id: 'hub', lat: hub.lat, lng: hub.lng, kind: 'hub', title: hub.name });
    if (points.length) {
      const first = points[0];
      const last = points[points.length - 1];
      out.push({ id: 'start', lat: first.lat, lng: first.lng, kind: 'home', title: `${t('ops.heroes.d.firstPoint')} · ${timeOnly(first.recordedAt)}` });
      out.push({ id: 'last', lat: last.lat, lng: last.lng, kind: 'hero', title: `${t('ops.heroes.d.lastPoint')} · ${timeOnly(last.recordedAt)}` });
    }
    return out;
  }, [points, hub, t]);
  return <LiveMap points={markers} route={route} height={340} refit />;
}
