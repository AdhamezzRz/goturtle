import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { TILE_ATTRIBUTION, TILE_URL } from '@/components/ui/Map';
import { CAIRO_CENTER, pinIcon } from '@/components/ui/Map';

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) });
  return null;
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 14));
  }, [lat, lng, map]);
  return null;
}

/** Leaflet map where a click drops (or moves) a single pin. Lazy-load this module. */
export default function PinMap({ lat, lng, onPick, height = 260, recenterOn }: {
  lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void; height?: number; recenterOn?: [number, number] | null;
}) {
  const has = lat !== null && lng !== null;
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-700" style={{ height }}>
      <MapContainer center={has ? [lat, lng] : recenterOn ?? CAIRO_CENTER} zoom={has ? 15 : 12} scrollWheelZoom className="h-full w-full">
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} />
        <ClickToPick onPick={onPick} />
        {has && (
          <Marker
            position={[lat, lng]}
            icon={pinIcon('pickup')}
            draggable
            eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); onPick(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))); } }}
          />
        )}
        {!has && recenterOn && <Recenter lat={recenterOn[0]} lng={recenterOn[1]} />}
      </MapContainer>
    </div>
  );
}
