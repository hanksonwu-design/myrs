import { distanceKm, publicLocationOf } from './geo';
import { isBlockedBetween, ratingOf, userById } from './store';
import { wantOpen } from './rules';
import type { Category, DB, LatLng, Listing, Mode, Want } from './types';

export interface SearchOptions {
  center: LatLng;
  radiusKm: number;
  category: Category | 'all';
  mode: Mode | 'all';
  q: string;
  sort: 'near' | 'new';
  viewerId: string | null;
}

export interface SearchHit {
  listing: Listing;
  distance: number;
  publicLocation: LatLng;
}

/** Rule-based ranking for the MVP (doc section 2 #12): distance, then recency, then reputation. */
export function searchListings(d: DB, o: SearchOptions): SearchHit[] {
  const q = o.q.trim().toLowerCase();
  const hits: SearchHit[] = [];
  for (const l of d.listings) {
    if (l.status !== 'active') continue;
    const owner = userById(d, l.ownerId);
    if (!owner || owner.status !== 'active') continue;
    if (o.viewerId && isBlockedBetween(d, o.viewerId, l.ownerId)) continue;
    if (o.category !== 'all' && l.category !== o.category) continue;
    if (o.mode !== 'all' && l.mode !== o.mode) continue;
    if (q && !`${l.title} ${l.description} ${l.sub} ${l.areaLabel}`.toLowerCase().includes(q)) continue;
    const publicLocation = publicLocationOf(l);
    const distance = distanceKm(o.center, publicLocation);
    if (distance > o.radiusKm) continue;
    hits.push({ listing: l, distance, publicLocation });
  }
  hits.sort((a, b) => {
    if (o.sort === 'new') return b.listing.createdAt - a.listing.createdAt;
    const byBand = Math.round(a.distance * 4) - Math.round(b.distance * 4); // 250 m bands
    if (byBand !== 0) return byBand;
    const byTime = b.listing.createdAt - a.listing.createdAt;
    if (Math.abs(byTime) > 6 * 3_600_000) return byTime;
    return ratingOf(d, b.listing.ownerId).avg - ratingOf(d, a.listing.ownerId).avg;
  });
  return hits;
}

export interface WantHit {
  want: Want;
  distance: number;
}

/** Open wants near a point, nearest (or newest) first. */
export function searchWants(d: DB, o: Omit<SearchOptions, 'mode'>, now: number): WantHit[] {
  const q = o.q.trim().toLowerCase();
  const hits: WantHit[] = [];
  for (const w of d.wants) {
    if (!wantOpen(w, now)) continue;
    if (userById(d, w.userId)?.status !== 'active') continue;
    if (o.viewerId && isBlockedBetween(d, o.viewerId, w.userId)) continue;
    if (o.category !== 'all' && w.category !== o.category) continue;
    if (q && !`${w.title} ${w.description} ${w.areaLabel}`.toLowerCase().includes(q)) continue;
    const distance = distanceKm(o.center, w.location);
    if (distance > o.radiusKm) continue;
    hits.push({ want: w, distance });
  }
  hits.sort((a, b) =>
    o.sort === 'new'
      ? b.want.createdAt - a.want.createdAt
      : Math.round(a.distance * 4) - Math.round(b.distance * 4) || b.want.createdAt - a.want.createdAt,
  );
  return hits;
}

/** Count of active listings within 1 km of a point: the pilot gate metric. */
export function activeWithin(d: DB, center: LatLng, km: number): number {
  return d.listings.filter(
    (l) =>
      l.status === 'active' &&
      userById(d, l.ownerId)?.status === 'active' &&
      distanceKm(center, publicLocationOf(l)) <= km,
  ).length;
}
