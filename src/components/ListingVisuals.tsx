'use client';

import Link from 'next/link';
import {
  Baby,
  Carrot,
  Clock,
  Footprints,
  Package,
  Shirt,
  ShoppingBag,
  Snowflake,
  Store,
  type LucideIcon,
} from 'lucide-react';
import type { DB, Listing } from '@/lib/types';
import { expiryLabel, formatDistance, timeAgo } from '@/lib/format';
import { nowOf, ratingOf, userById } from '@/lib/store';
import { ModeBadge, Stars } from './ui';
import { listingPath } from '@/lib/links';

const SUB_ICON: Record<string, LucideIcon> = {
  即期品: Clock,
  包裝食品: Package,
  生鮮蔬果: Carrot,
  上衣: Shirt,
  下身: Shirt,
  外套: Shirt,
  童裝: Baby,
  鞋子: Footprints,
  包包配件: ShoppingBag,
};

export function subIcon(sub: string): LucideIcon {
  return SUB_ICON[sub] ?? Package;
}

export function ListingThumb({ listing, className = '' }: { listing: Listing; className?: string }) {
  if (listing.photos[0]) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={listing.photos[0]} alt={listing.title} className={`object-cover ${className}`} />
    );
  }
  const Icon = subIcon(listing.sub);
  const food = listing.category === 'food';
  return (
    <div
      className={`flex items-center justify-center ${food ? 'bg-amber-50 text-m-amber' : 'bg-sky-50 text-m-sky'} ${className}`}
      aria-label={listing.title}
    >
      <Icon className="size-1/3 max-h-16 max-w-16" strokeWidth={1.5} />
    </div>
  );
}

export function ExpiryTag({ listing, now }: { listing: Listing; now: number }) {
  if (!listing.expiresOn) return null;
  const label = expiryLabel(listing.expiresOn, now);
  const urgent = /今天|明天|後天|已過期/.test(label);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        urgent ? 'bg-rose-50 text-m-rose' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {listing.storage === '冷藏' || listing.storage === '冷凍' ? <Snowflake className="size-3" /> : <Clock className="size-3" />}
      {label}
    </span>
  );
}

export function ListingCard({
  d,
  listing,
  distance,
  highlighted,
  onHover,
}: {
  d: DB;
  listing: Listing;
  distance: number;
  highlighted?: boolean;
  onHover?: (id: string | null) => void;
}) {
  const owner = userById(d, listing.ownerId);
  const rating = ratingOf(d, listing.ownerId);
  const now = nowOf(d);
  return (
    <Link
      href={listingPath(listing.id)}
      onMouseEnter={() => onHover?.(listing.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md ${
        highlighted ? 'ring-2 ring-brand' : ''
      }`}
    >
      <div className="relative">
        <ListingThumb listing={listing} className="aspect-[4/3] w-full" />
        <div className="absolute left-2 top-2">
          <ModeBadge listing={listing} />
        </div>
        {listing.quantity > 1 && (
          <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-slate-600">
            剩 {listing.remaining}/{listing.quantity}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-2 text-sm font-bold leading-snug text-slate-800 group-hover:text-brand-dark">
          {listing.title}
        </p>
        <div className="flex flex-wrap gap-1">
          <ExpiryTag listing={listing} now={now} />
        </div>
        <p className="text-xs text-slate-500">
          {formatDistance(distance)} · {listing.areaLabel}
        </p>
        <div className="mt-auto flex items-center justify-between pt-1 text-xs text-slate-500">
          <span className="flex min-w-0 items-center gap-1 truncate">
            {owner?.merchant && <Store className="size-3 shrink-0 text-brand" />}
            <span className="truncate">{owner?.name}</span>
            {rating.count > 0 && <Stars value={rating.avg} size={10} />}
          </span>
          <span className="shrink-0">{timeAgo(listing.createdAt, now)}</span>
        </div>
      </div>
    </Link>
  );
}
