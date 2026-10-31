import { LiveMap, type MapPoint } from '@/components/ui/Map';
import { useGeo } from '../lib/geo';

/** Small map on the stop page: the drop-off and where I am. Lazy-loaded (Leaflet chunk). */
export default function StopMiniMap({ lat, lng, kind = 'order' }: { lat: number; lng: number; kind?: 'order' | 'pickup' }) {
  const geo = useGeo();
  const points: MapPoint[] = [{ id: 'dest', lat, lng, kind }];
  if (geo.last) points.push({ id: 'me', lat: geo.last.lat, lng: geo.last.lng, kind: 'hero' });
  return <LiveMap points={points} height={170} className="rounded-2xl" />;
}
