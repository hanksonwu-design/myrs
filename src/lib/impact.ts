/**
 * Impact board (社區成果): counts of completed deals. Demo mode counts everything in
 * the browser; Supabase mode gets the community numbers from public.community_impact()
 * (migration 11), which applies the same rules, and counts a member's own numbers here.
 */
import type { CommunityImpact, DB, ImpactCounts, Listing, Order, PersonalImpact } from './types';

const TAIPEI = 8 * 3_600_000; // UTC+8 all year

/** YYYY-MM in Taipei time, like the server's months. */
export function taipeiMonth(t: number): string {
  const d = new Date(t + TAIPEI);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The six months ending with the one that holds `now`, oldest first. */
export function lastSixMonths(now: number): string[] {
  const d = new Date(now + TAIPEI);
  return Array.from({ length: 6 }, (_, i) => taipeiMonth(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 5 + i, 15)));
}

/** 2026-11 → 11 月; January also shows its year. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y} 年 1 月` : `${m} 月`;
}

type Done = { order: Order; listing: Listing };

function completed(d: DB): Done[] {
  const byId = new Map(d.listings.map((l) => [l.id, l]));
  return d.orders
    .filter((o) => o.status === 'completed' && o.completedAt !== null)
    .map((o) => ({ order: o, listing: byId.get(o.listingId) }))
    .filter((x): x is Done => !!x.listing);
}

function counts(done: Done[]): ImpactCounts {
  const people = new Set(done.flatMap(({ order }) => [order.requesterId, order.providerId]));
  return {
    food: done.filter((x) => x.listing.category === 'food').length,
    clothing: done.filter((x) => x.listing.category === 'clothing').length,
    free: done.filter((x) => x.order.mode === 'free').length,
    neighbours: people.size,
  };
}

/** A deal on an answer fulfils a want when the member who posted the want received it. */
function wantsFoundIn(d: DB, done: Done[]): number {
  const owner = new Map(d.wants.map((w) => [w.id, w.userId]));
  const found = new Set(
    done
      .filter(({ order, listing }) => listing.wantId && owner.get(listing.wantId) === order.requesterId)
      .map(({ listing }) => listing.wantId),
  );
  return found.size;
}

export function communityImpactOf(d: DB, now: number): CommunityImpact {
  const done = completed(d);
  const month = taipeiMonth(now);
  const inMonth = (m: string) => done.filter((x) => taipeiMonth(x.order.completedAt!) === m);
  return {
    month: counts(inMonth(month)),
    total: counts(done),
    wantsFound: wantsFoundIn(d, done),
    since: done.length ? Math.min(...done.map((x) => x.order.completedAt!)) : null,
    months: lastSixMonths(now).map((m) => {
      const c = counts(inMonth(m));
      return { month: m, food: c.food, clothing: c.clothing };
    }),
  };
}

/** Works in both modes: members can always read their own deals and those listings. */
export function personalImpactOf(d: DB, userId: string): PersonalImpact {
  const done = completed(d);
  const gave = done.filter((x) => x.order.providerId === userId);
  const got = done.filter((x) => x.order.requesterId === userId);
  return {
    gaveFood: gave.filter((x) => x.listing.category === 'food').length,
    gaveClothing: gave.filter((x) => x.listing.category === 'clothing').length,
    gaveFree: gave.filter((x) => x.order.mode === 'free').length,
    helped: new Set(gave.map((x) => x.order.requesterId)).size,
    received: got.length,
    wantsFound: wantsFoundIn(d, got),
  };
}

/** Whether there is anything to show yet. */
export const hasImpact = (c: ImpactCounts) => c.food + c.clothing > 0;
