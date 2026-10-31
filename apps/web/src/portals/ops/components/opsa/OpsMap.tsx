import { useEffect, useMemo, type ReactNode } from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/cn';

/**
 * Ops map built on react-leaflet: hero avatars with state colours + pulse,
 * numbered stop pins, hub squares, order dots, zone circles and routes.
 * Dark-mode tiles follow the app theme. Lazy-load pages that use it.
 */
export const CAIRO: [number, number] = [30.0444, 31.2357];

export const MAP_COLORS = {
  online: '#0e9158',
  busy: '#6d28d9',
  break: '#f5930b',
  offline: '#8592ab',
  order: '#2a78d6',
  urgent: '#dc2626',
  hub: '#13161e',
  done: '#19b36e',
  failed: '#d03b3b',
  pickup: '#0284c7',
} as const;

export type OpsMarker =
  | { id: string; lat: number; lng: number; type: 'hero'; color: string; label: string; pulse?: boolean; selected?: boolean; title?: string; popup?: ReactNode; onClick?: () => void }
  | { id: string; lat: number; lng: number; type: 'pin'; color: string; label?: string | number; selected?: boolean; title?: string; popup?: ReactNode; onClick?: () => void }
  | { id: string; lat: number; lng: number; type: 'hub'; title?: string; popup?: ReactNode; onClick?: () => void }
  | { id: string; lat: number; lng: number; type: 'dot'; color: string; title?: string; popup?: ReactNode; onClick?: () => void };

const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cache = new Map<string, L.DivIcon>();

function iconFor(m: OpsMarker): L.DivIcon {
  const key = m.type === 'hub' ? 'hub' : m.type === 'dot' ? `dot:${m.color}` : m.type === 'hero' ? `hero:${m.color}:${m.label}:${m.pulse}:${m.selected}` : `pin:${m.color}:${m.label ?? ''}:${m.selected}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let icon: L.DivIcon;
  if (m.type === 'hero') {
    const ring = m.selected ? '<circle cx="18" cy="18" r="17" fill="none" stroke="#fbb324" stroke-width="3"/>' : '';
    icon = L.divIcon({
      className: 'gt-pin',
      html: `<div class="${m.pulse ? 'gt-pin-pulse' : ''}" style="--c:${m.color};width:36px;height:36px"><svg width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="${m.color}" stroke="#fff" stroke-width="2.5"/>${ring}<text x="18" y="22" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="Inter,sans-serif">${esc(m.label)}</text></svg></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -16],
    });
  } else if (m.type === 'pin') {
    const inner = m.label !== undefined
      ? `<text x="16" y="20" text-anchor="middle" font-size="${String(m.label).length > 2 ? 10 : 12}" font-weight="700" fill="#fff" font-family="Inter,sans-serif">${esc(m.label)}</text>`
      : '<circle cx="16" cy="15" r="4.5" fill="#fff"/>';
    const sel = m.selected ? 'stroke="#fbb324" stroke-width="3"' : 'stroke="#fff" stroke-width="2"';
    icon = L.divIcon({
      className: 'gt-pin',
      html: `<svg width="32" height="40" viewBox="0 0 32 40"><path d="M16 39s13-12.6 13-23A13 13 0 0 0 3 16c0 10.4 13 23 13 23z" fill="${m.color}" ${sel}/>${inner}</svg>`,
      iconSize: [32, 40],
      iconAnchor: [16, 39],
      popupAnchor: [0, -32],
    });
  } else if (m.type === 'hub') {
    icon = L.divIcon({
      className: 'gt-pin',
      html: '<svg width="30" height="30" viewBox="0 0 30 30"><rect x="2" y="2" width="26" height="26" rx="7" fill="#13161e" stroke="#fff" stroke-width="2"/><g transform="translate(6 6) scale(.75)" fill="none" stroke="#7de4b0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-6 9 6v11H3zM9 20v-6h6v6"/></g></svg>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -14],
    });
  } else {
    icon = L.divIcon({
      className: 'gt-pin',
      html: `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="${m.color}" stroke="#fff" stroke-width="2"/></svg>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }
  cache.set(key, icon);
  return icon;
}

function Fit({ points, fitKey, padding }: { points: Array<[number, number]>; fitKey: string; padding: number }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [padding, padding], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function FlyTo({ target }: { target?: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [target, map]);
  return null;
}

/** Invalidate size when the container resizes (drawers, responsive layouts). */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const obs = new ResizeObserver(() => map.invalidateSize());
    obs.observe(el);
    return () => obs.disconnect();
  }, [map]);
  return null;
}

export function OpsMap({
  markers, routes = [], circles = [], height = 420, className, fitKey, flyTo, padding = 40, rounded = true,
}: {
  markers: OpsMarker[];
  routes?: Array<{ id: string; positions: Array<[number, number]>; color?: string; dashed?: boolean }>;
  circles?: Array<{ id: string; center: [number, number]; radius: number; color: string; title?: string; onClick?: () => void; active?: boolean }>;
  height?: number | string;
  className?: string;
  /** Change this to re-fit the map to the markers (defaults to fitting once). */
  fitKey?: string;
  flyTo?: [number, number] | null;
  padding?: number;
  rounded?: boolean;
}) {
  const points = useMemo(() => markers.map((m) => [m.lat, m.lng] as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)), [markers]);
  const key = fitKey ?? (points.length ? 'ready' : 'empty');
  return (
    <div className={cn('relative isolate overflow-hidden border border-ink-100 dark:border-ink-800', rounded && 'rounded-2xl', className)} style={{ height }}>
      <MapContainer center={CAIRO} zoom={11} scrollWheelZoom className="h-full w-full" attributionControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        {circles.map((c) => (
          <Circle
            key={c.id}
            center={c.center}
            radius={c.radius}
            pathOptions={{ color: c.color, weight: c.active ? 3 : 1.5, fillOpacity: c.active ? 0.25 : 0.1 }}
            eventHandlers={c.onClick ? { click: c.onClick } : undefined}
          >
            {c.title && <Tooltip>{c.title}</Tooltip>}
          </Circle>
        ))}
        {routes.map((r) => (
          <Polyline key={r.id} positions={r.positions} pathOptions={{ color: r.color ?? '#0e9158', weight: 4, opacity: 0.8, dashArray: r.dashed ? '8 8' : undefined }} />
        ))}
        {markers.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={iconFor(m)} eventHandlers={m.onClick ? { click: m.onClick } : undefined} zIndexOffset={m.type === 'hero' ? 500 : m.type === 'hub' ? 300 : 0}>
            {m.title && <Tooltip direction="top" offset={[0, m.type === 'pin' ? -30 : -14]}>{m.title}</Tooltip>}
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        ))}
        <Fit points={points} fitKey={key} padding={padding} />
        <FlyTo target={flyTo} />
        <AutoResize />
      </MapContainer>
    </div>
  );
}

export function heroColor(h: { availability: string; online?: boolean; stale?: boolean }) {
  if (h.online === false || h.stale || h.availability === 'OFFLINE') return MAP_COLORS.offline;
  if (h.availability === 'BUSY') return MAP_COLORS.busy;
  if (h.availability === 'ON_BREAK') return MAP_COLORS.break;
  return MAP_COLORS.online;
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
