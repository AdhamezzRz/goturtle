import { pointInPolygon, haversineKm, type LatLng } from './geo';
import { toLatinDigits } from './phone';

/**
 * Smart address → zone detection for Egyptian addresses written in Arabic,
 * English or Franco-Arabic ("madinet nasr", "el tagamo3").
 */
export function normalizeText(input: string): string {
  return toLatinDigits(input)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel & tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\b(el|al)[\s-]+/g, '') // el tagamo3 -> tagamo3
    .replace(/(^|\s)ال/g, '$1') // التجمع -> تجمع
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ZoneCandidate {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  keywords: string[];
  centerLat: number;
  centerLng: number;
  polygon?: { type: 'Polygon'; coordinates: Array<Array<[number, number]>> } | null;
}

export interface ZoneMatch {
  zoneId: string;
  code: string;
  confidence: number; // 0..1
  method: 'polygon' | 'keyword' | 'nearest';
  matched?: string;
}

/**
 * 1. If coordinates are given and fall inside a zone polygon → that zone (0.99).
 * 2. Longest keyword/name match inside the normalised address text.
 * 3. Coordinates without polygon hit → nearest zone centre within 8 km.
 */
export function detectZone(
  zones: ZoneCandidate[],
  address: string,
  point?: LatLng | null,
): ZoneMatch | null {
  if (point) {
    for (const z of zones) {
      const ring = z.polygon?.coordinates?.[0];
      if (ring && pointInPolygon(point, ring)) {
        return { zoneId: z.id, code: z.code, confidence: 0.99, method: 'polygon' };
      }
    }
  }

  const text = ` ${normalizeText(address)} `;
  let best: ZoneMatch | null = null;
  let bestLen = 0;
  for (const z of zones) {
    for (const raw of [z.nameEn, z.nameAr, ...z.keywords]) {
      const kw = normalizeText(raw);
      if (kw.length < 3) continue;
      if (text.includes(` ${kw} `) || (kw.length >= 6 && text.includes(kw))) {
        if (kw.length > bestLen) {
          bestLen = kw.length;
          best = {
            zoneId: z.id,
            code: z.code,
            confidence: Math.min(0.95, 0.6 + kw.length / 40),
            method: 'keyword',
            matched: raw,
          };
        }
      }
    }
  }
  if (best) return best;

  if (point) {
    let nearest: ZoneCandidate | null = null;
    let nearestKm = Infinity;
    for (const z of zones) {
      const d = haversineKm(point, { lat: z.centerLat, lng: z.centerLng });
      if (d < nearestKm) {
        nearestKm = d;
        nearest = z;
      }
    }
    if (nearest && nearestKm <= 8) {
      return { zoneId: nearest.id, code: nearest.code, confidence: Math.max(0.3, 0.8 - nearestKm / 10), method: 'nearest' };
    }
  }
  return null;
}
