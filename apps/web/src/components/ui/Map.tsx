import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/cn';

export const CAIRO_CENTER: [number, number] = [30.0444, 31.2357];

/**
 * Basemap tiles. Default: Esri World Street Map (no API key, Arabic + English
 * labels). Override at build time with VITE_MAP_TILE_URL / VITE_MAP_TILE_ATTRIBUTION
 * (e.g. a MapTiler / Mapbox / Stadia URL with your key) — remember to allow the
 * host in the API's CSP (img-src) via MAP_TILE_HOSTS.
 */
const TILE_URL: string =
  import.meta.env.VITE_MAP_TILE_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const TILE_ATTRIBUTION: string =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION || 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors';

export type MarkerKind = 'hero' | 'hero-idle' | 'hero-offline' | 'order' | 'order-urgent' | 'hub' | 'pickup' | 'home' | 'done';

const COLORS: Record<MarkerKind, string> = {
  hero: '#0e9158',
  'hero-idle': '#f5930b',
  'hero-offline': '#8592ab',
  order: '#6d28d9',
  'order-urgent': '#dc2626',
  hub: '#13161e',
  pickup: '#0284c7',
  home: '#0e9158',
  done: '#19b36e',
};

const ICONS: Partial<Record<MarkerKind, string>> = {
  hero: '<path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0m10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0M7 17h8M14 7h2l3 5v5M5 12h9V7H8z" />',
  hub: '<path d="M3 9l9-6 9 6v11H3zM9 20v-6h6v6" />',
  pickup: '<path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8" />',
  home: '<path d="M3 11l9-8 9 8v9H3z" />',
};

const cache = new Map<string, L.DivIcon>();

/** Small SVG pin icons (no image assets → works offline and with strict CSP). */
export function pinIcon(kind: MarkerKind, label?: string | number): L.DivIcon {
  const key = `${kind}:${label ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const color = COLORS[kind];
  const isHero = kind.startsWith('hero');
  const glyph = ICONS[isHero ? 'hero' : kind];
  const inner = label !== undefined
    ? `<text x="16" y="20" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="Inter,sans-serif">${label}</text>`
    : glyph
      ? `<g transform="translate(6.5 6) scale(.8)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`
      : '<circle cx="16" cy="15" r="4.5" fill="#fff"/>';
  const html = isHero
    ? `<div class="gt-pin-pulse" style="--c:${color}"><svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${color}" stroke="#fff" stroke-width="2.5"/>${inner}</svg></div>`
    : `<svg width="32" height="40" viewBox="0 0 32 40"><path d="M16 39s13-12.6 13-23A13 13 0 0 0 3 16c0 10.4 13 23 13 23z" fill="${color}" stroke="#fff" stroke-width="2"/>${inner}</svg>`;
  const icon = L.divIcon({ html, className: 'gt-pin', iconSize: isHero ? [32, 32] : [32, 40], iconAnchor: isHero ? [16, 16] : [16, 39], popupAnchor: [0, -30] });
  cache.set(key, icon);
  return icon;
}

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  kind: MarkerKind;
  label?: string | number;
  title?: string;
  popup?: React.ReactNode;
  onClick?: () => void;
}

function FitBounds({ points, padding = 40, once = true }: { points: Array<[number, number]>; padding?: number; once?: boolean }) {
  const map = useMap();
  const key = once ? points.length > 0 : JSON.stringify(points);
  useEffect(() => {
    if (!points.length) return;
    let cancelled = false;
    // Wait until the map is laid out and never animate: an animated zoom racing an
    // unmount/re-render is what throws Leaflet's "_leaflet_pos of undefined".
    map.whenReady(() => {
      if (cancelled || !map.getContainer()?.isConnected) return;
      map.invalidateSize({ animate: false });
      if (points.length === 1) map.setView(points[0], 14, { animate: false });
      else map.fitBounds(L.latLngBounds(points), { padding: [padding, padding], maxZoom: 15, animate: false });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

export function LiveMap({
  points, route, className, height = 420, fit = true, refit = false, center = CAIRO_CENTER, zoom = 11,
}: {
  points: MapPoint[]; route?: Array<[number, number]>; className?: string; height?: number | string; fit?: boolean; refit?: boolean; center?: [number, number]; zoom?: number;
}) {
  const bounds = useMemo(() => [...points.map((p) => [p.lat, p.lng] as [number, number]), ...(route ?? [])], [points, route]);
  return (
    <div className={cn('relative isolate z-0 overflow-hidden rounded-2xl border border-ink-100 dark:border-ink-800', className)} style={{ height }}>
      <MapContainer center={center as LatLngExpression} zoom={zoom} scrollWheelZoom className="h-full w-full" attributionControl>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} />
        {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: '#0e9158', weight: 4, opacity: 0.75, dashArray: '8 8' }} />}
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={pinIcon(p.kind, p.label)} eventHandlers={p.onClick ? { click: p.onClick } : undefined}>
            {p.title && <Tooltip direction="top" offset={[0, -24]}>{p.title}</Tooltip>}
            {p.popup && <Popup>{p.popup}</Popup>}
          </Marker>
        ))}
        {fit && <FitBounds points={bounds} once={!refit} />}
      </MapContainer>
    </div>
  );
}
