import type { LatLng } from './types';

/** Pilot area: 台北市大安區, centred on 大安森林公園. */
export const PILOT_CENTER: LatLng = { lat: 25.0296, lng: 121.5357 };
export const PILOT_NAME = '台北市大安區';
export const FUZZ_RADIUS_M = 200;

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Public, approximate location: the exact point moved 60–180 m in a direction
 * derived from the listing id, so it is stable but does not reveal the address.
 */
export function fuzzLocation(loc: LatLng, seed: string): LatLng {
  const h = hash(seed);
  const angle = ((h % 360) * Math.PI) / 180;
  const dist = 60 + ((h >>> 9) % 120); // metres
  const dLat = (dist * Math.cos(angle)) / 111_320;
  const dLng = (dist * Math.sin(angle)) / (111_320 * Math.cos((loc.lat * Math.PI) / 180));
  return { lat: loc.lat + dLat, lng: loc.lng + dLng };
}

/** The point shown publicly for a listing (server-fuzzed in Supabase mode). */
export function publicLocationOf(l: { id: string; location: LatLng; publicLocation?: LatLng }): LatLng {
  return l.publicLocation ?? fuzzLocation(l.location, l.id);
}
