import type { LatLng } from './types';

/**
 * Place search and reverse lookup with OpenStreetMap Nominatim (free, no key).
 * Its usage policy allows at most one request a second and no search-as-you-type,
 * so searches only run when the user presses 搜尋, and every call is throttled.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
const BASE = 'https://nominatim.openstreetmap.org';
const LABEL_MAX = 30;

export interface Place {
  /** Short public label, e.g. 「捷運大安站附近」. Never contains a house number. */
  label: string;
  /** Longer description shown in the result list. */
  detail: string;
  point: LatLng;
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
}

let last = 0;
async function throttle() {
  const wait = last + 1100 - Date.now();
  last = Math.max(Date.now(), last + 1100);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function get(path: string, params: Record<string, string>): Promise<unknown> {
  await throttle();
  const qs = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', 'accept-language': 'zh-TW', ...params });
  const res = await fetch(`${BASE}/${path}?${qs}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

// Named public places that make a good meeting label on their own. Buildings in
// general are left out on purpose: an apartment block's name would give away where
// someone lives. Public buildings (stations, schools…) are let in by their type.
const NAMED = new Set(['railway', 'public_transport', 'leisure', 'amenity', 'tourism', 'shop']);
const PUBLIC_TYPES = new Set([
  'train_station', 'station', 'subway_entrance', 'bus_stop', 'bus_station', 'stop_position', 'platform',
  'park', 'garden', 'playground', 'school', 'university', 'college', 'library', 'marketplace',
  'supermarket', 'convenience', 'mall', 'department_store', 'hospital', 'post_office', 'townhall',
  'community_centre', 'place_of_worship', 'temple', 'church',
]);
// A house number such as 「12號」 or 「12之3號」, but not 「3號出口」.
const HOUSE_NO = /\d+(之\d+)?號(?!出口)/;

/** A public label for a spot: a named place, else district + road, never the house number. */
function labelOf(r: NominatimResult): string {
  const a = r.address ?? {};
  const district = a.suburb || a.city_district || a.town || a.village || a.city || '';
  const road = a.road || a.pedestrian || a.footway || a.neighbourhood || a.quarter || '';
  let label = '';
  const publicPlace = (r.category && NAMED.has(r.category)) || (r.type && PUBLIC_TYPES.has(r.type));
  if (r.name && publicPlace && !HOUSE_NO.test(r.name)) label = r.name;
  else if (road) label = `${district}${road}`;
  else label = district || r.name || '';
  label = label.replace(/\s+/g, '');
  if (!label) return '';
  return `${label.slice(0, LABEL_MAX - 2)}附近`;
}

function detailOf(r: NominatimResult): string {
  // display_name is "name, road, district, city, postcode, country"; drop the tail noise.
  return (r.display_name ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/^\d{3,6}$/.test(s) && s !== '臺灣' && s !== '台灣')
    .slice(0, 4)
    .join('，');
}

const toPlace = (r: NominatimResult): Place => ({
  label: labelOf(r),
  detail: detailOf(r),
  point: { lat: Number(r.lat), lng: Number(r.lon) },
});

/** Search Taiwan for a place or address; results near `near` come first. */
export async function searchPlaces(q: string, near?: LatLng): Promise<Place[]> {
  const params: Record<string, string> = { q: q.trim(), countrycodes: 'tw', limit: '5' };
  if (near) {
    const d = 0.15;
    params.viewbox = [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(',');
  }
  const rows = (await get('search', params)) as NominatimResult[];
  return Array.isArray(rows) ? rows.map(toPlace) : [];
}

/** The public label for a point on the map, or '' when nothing is known there. */
export async function reverseLabel(p: LatLng): Promise<string> {
  const r = (await get('reverse', { lat: String(p.lat), lon: String(p.lng), zoom: '18' })) as NominatimResult & {
    error?: string;
  };
  return r && !r.error ? labelOf(r) : '';
}

/** Google Maps walking directions to a point (opens the app on phones). */
export const directionsUrl = (p: LatLng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}&travelmode=walking`;
