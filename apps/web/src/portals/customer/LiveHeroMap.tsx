import { LiveMap, type MapPoint } from '@/components/ui/Map';

/** Hero position + destination (lazy-loaded: Leaflet is heavy). */
export default function LiveHeroMap({ hero, home, heroTitle, homeTitle }: { hero: { lat: number; lng: number }; home: { lat: number; lng: number } | null; heroTitle: string; homeTitle: string }) {
  const points: MapPoint[] = [{ id: 'hero', lat: hero.lat, lng: hero.lng, kind: 'hero', title: heroTitle }];
  if (home) points.push({ id: 'home', lat: home.lat, lng: home.lng, kind: 'home', title: homeTitle });
  return <LiveMap points={points} height={260} refit className="rounded-3xl" />;
}
