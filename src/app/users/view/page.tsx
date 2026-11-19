'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Heart, Store } from 'lucide-react';
import { currentUser, nowOf, ratingOf, reviewPublished, useDB, userById } from '@/lib/store';
import { distanceKm, PILOT_CENTER, publicLocationOf } from '@/lib/geo';
import { formatDate, timeAgo } from '@/lib/format';
import { ListingCard } from '@/components/ListingVisuals';
import { Avatar, NotFound, Stars } from '@/components/ui';
import { BlockButton, ReportButton } from '@/components/ReportBlock';

function UserPage() {
  const id = useSearchParams().get('id') ?? '';
  const d = useDB()!;
  const u = userById(d, id);
  if (!u || u.status === 'deleted') return <NotFound text="找不到這位使用者。" />;
  const me = currentUser(d);
  const now = nowOf(d);
  const rating = ratingOf(d, u.id);
  const listings = d.listings.filter((l) => l.ownerId === u.id && l.status === 'active');
  const reviews = d.reviews.filter((r) => r.revieweeId === u.id && reviewPublished(d, r));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="card p-5">
        <div className="flex items-center gap-4">
          <Avatar user={u} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-xl font-bold">
              {u.name}
              {u.merchant && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">
                  <Store className="size-3" />
                  試點商家
                </span>
              )}
            </h1>
            <p className="text-sm text-slate-500">{formatDate(u.createdAt)} 加入</p>
            {u.bio && <p className="mt-1 text-sm text-slate-600">{u.bio}</p>}
            {u.status === 'suspended' && <p className="mt-1 text-sm font-semibold text-m-rose">這個帳號已被停權</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <Stars value={rating.avg} />
            {rating.count ? `${rating.avg.toFixed(1)}（${rating.count} 則）` : '還沒有評價'}
          </span>
          <span className="flex items-center gap-1 text-m-rose">
            <Heart className="size-4 fill-current" />
            愛心值 {u.loveScore}
          </span>
          {me && me.id !== u.id && (
            <span className="ml-auto flex">
              <ReportButton targetType="user" targetId={u.id} />
              <BlockButton userId={u.id} />
            </span>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-bold">刊登中（{listings.length}）</h2>
        {listings.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {listings.map((l) => (
              <ListingCard key={l.id} d={d} listing={l} distance={distanceKm(PILOT_CENTER, publicLocationOf(l))} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">目前沒有刊登。</p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-bold">評價</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-slate-500">還沒有公開的評價。</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <Stars value={r.stars} />
                  <span className="font-semibold">{userById(d, r.reviewerId)?.name}</span>
                  <span className="text-xs text-slate-400">{timeAgo(r.createdAt, now)}</span>
                </div>
                {r.comment && <p className="mt-0.5 text-slate-600">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// useSearchParams needs a Suspense boundary in a static export.
export default function Page() {
  return (
    <Suspense>
      <UserPage />
    </Suspense>
  );
}
