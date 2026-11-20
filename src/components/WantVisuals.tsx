'use client';

import Link from 'next/link';
import { Shirt, Utensils } from 'lucide-react';
import type { DB, Want } from '@/lib/types';
import { DAY, formatDistance, timeAgo } from '@/lib/format';
import { isBlockedBetween, nowOf, userById } from '@/lib/store';
import { wantPath } from '@/lib/links';

export const WANT_COLOR = '#7C3AED';

/** e.g. 「剩 12 天」 */
export function wantTimeLeft(w: Want, now: number): string {
  const days = Math.ceil((w.expiresAt - now) / DAY);
  return days <= 1 ? '最後一天' : `剩 ${days} 天`;
}

/** Listings answering a want that the viewer can still see and request. */
export function answersOf(d: DB, wantId: string, viewerId: string | null) {
  return d.listings
    .filter(
      (l) =>
        l.wantId === wantId &&
        (l.ownerId === viewerId ||
          ((l.status === 'active' || l.status === 'reserved') &&
            userById(d, l.ownerId)?.status === 'active' &&
            !(viewerId && isBlockedBetween(d, viewerId, l.ownerId)))),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function WantIcon({ want, className = 'size-12' }: { want: Pick<Want, 'category'>; className?: string }) {
  const Icon = want.category === 'food' ? Utensils : Shirt;
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 ${className}`}>
      <Icon className="size-1/2" strokeWidth={1.5} />
    </div>
  );
}

export function WantCard({
  d,
  want,
  distance,
  highlighted,
  onHover,
}: {
  d: DB;
  want: Want;
  distance: number | null;
  highlighted?: boolean;
  onHover?: (id: string | null) => void;
}) {
  const owner = userById(d, want.userId);
  const now = nowOf(d);
  const answers = answersOf(d, want.id, null).length;
  return (
    <Link
      href={wantPath(want.id)}
      onMouseEnter={() => onHover?.(want.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`card group flex gap-3 p-3 transition hover:-translate-y-0.5 hover:shadow-md ${
        highlighted ? 'ring-2 ring-violet-500' : ''
      }`}
    >
      <WantIcon want={want} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">徵求</span>
          <span className="truncate font-bold text-slate-800 group-hover:text-brand-dark">{want.title}</span>
        </p>
        {want.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{want.description}</p>}
        <p className="mt-1 text-xs text-slate-500">
          {distance !== null && `${formatDistance(distance)} · `}
          {want.areaLabel}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span>{owner?.name}</span>
          <span>{timeAgo(want.createdAt, now)}</span>
          <span>{wantTimeLeft(want, now)}</span>
          {answers > 0 && <span className="font-semibold text-brand-dark">{answers} 人回應</span>}
        </p>
      </div>
    </Link>
  );
}
