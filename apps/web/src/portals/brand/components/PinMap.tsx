import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LeafletEvent, Marker as LMarker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CAIRO_CENTER, pinIcon } from '@/components/ui/Map';
import { cn } from '@/lib/cn';

export interface LatLng {
  lat: number;
  lng: number;
}

function ClickToPin({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) }) });
  return null;
}

function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1]]);
  return null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Tap/click to drop a pin; drag the pin to adjust. Read-only when `onChange` is omitted.
 * Lazy-load the module that imports this (Leaflet is heavy).
 */
export default function PinMap({
  value, onChange, center, height = 260, className, zoom = 15,
}: {
  value: LatLng | null; onChange?: (p: LatLng) => void; center?: LatLng | null; height?: number | string; className?: string; zoom?: number;
}) {
  const c = useMemo<[number, number]>(() => (value ? [value.lat, value.lng] : center ? [center.lat, center.lng] : CAIRO_CENTER), [value, center]);
  const z = value || center ? zoom : 11;
  return (
    <div className={cn('relative z-0 overflow-hidden rounded-2xl border border-ink-100 dark:border-ink-800', className)} style={{ height }}>
      <MapContainer center={c} zoom={z} scrollWheelZoom={false} className="h-full w-full" attributionControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <Recenter center={c} zoom={z} />
        {onChange && <ClickToPin onPick={onChange} />}
        {value && (
          <Marker
            position={[value.lat, value.lng]}
            icon={pinIcon('home')}
            draggable={!!onChange}
            eventHandlers={
              onChange
                ? {
                    dragend: (e: LeafletEvent) => {
                      const ll = (e.target as LMarker).getLatLng();
                      onChange({ lat: round6(ll.lat), lng: round6(ll.lng) });
                    },
                  }
                : undefined
            }
          />
        )}
      </MapContainer>
    </div>
  );
}
