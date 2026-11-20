'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Clock, MapPin, PackagePlus, Reply, Trash2 } from 'lucide-react';
import { actions, currentUser, isBlockedBetween, nowOf, useDB, userById, wantById } from '@/lib/store';
import { CATEGORIES, WANT_MAX_ANSWERS, wantOpen, wantStatusLabel } from '@/lib/rules';
import { distanceKm, publicLocationOf } from '@/lib/geo';
import { formatDateTime, formatDistance, timeAgo } from '@/lib/format';
import { isStaff } from '@/lib/staff';
import { IS_REMOTE } from '@/lib/backend';
import { ListingCard } from '@/components/ListingVisuals';
import { answersOf, WANT_COLOR, WantIcon, wantTimeLeft } from '@/components/WantVisuals';
import { MapView } from '@/components/map/MapView';
import { Avatar, Modal, NotFound } from '@/components/ui';
import { BlockButton, ReportButton } from '@/components/ReportBlock';
import { TrustBadge } from '@/components/TrustBadge';
import { useMyPosition } from '@/components/hooks';
import { useToast } from '@/components/Providers';
import { userPath } from '@/lib/links';

const GONE = '找不到這則徵求，可能已經結束或被移除。';

function WantPage() {
  const id = useSearchParams().get('id') ?? '';
  const d = useDB()!;
  const router = useRouter();
  const toast = useToast();
  const pos = useMyPosition();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [reason, setReason] = useState('');

  const w = wantById(d, id);
  const me = currentUser(d);
  if (!w) return <NotFound text={GONE} />;
  const owner = userById(d, w.userId);
  const now = nowOf(d);
  const mine = me?.id === w.userId;
  const staff = isStaff(me);
  const open = wantOpen(w, now);
  // Same rule as the server: others see only open wants of active members they have not blocked.
  if (!mine && !staff && (!open || owner?.status !== 'active' || (me && isBlockedBetween(d, me.id, w.userId)))) {
    return <NotFound text={GONE} />;
  }

  const answers = answersOf(d, w.id, me?.id ?? null);
  const myAnswers = me ? d.listings.filter((l) => l.wantId === w.id && l.ownerId === me.id).length : 0;
  const myListings = me
    ? d.listings.filter((l) => l.ownerId === me.id && !l.wantId && (l.status === 'active' || l.status === 'pending_review'))
    : [];
  const canAnswer = !!me && !mine && open && myAnswers < WANT_MAX_ANSWERS;
  const notice = IS_REMOTE ? `，${owner?.name ?? '對方'}會收到 Email 通知` : '';

  const run = async (p: Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) {
      toast(r.error, 'error');
      return false;
    }
    toast(done);
    return true;
  };

  const answerWith = async () => {
    if (!pick) return toast('請先選一則你的刊登', 'error');
    if (await run(actions.respondWant(w.id, pick), `已回應${notice}`)) setPick('');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <button className="btn btn-ghost -ml-3 mb-2 px-2" onClick={() => router.back()}>
        <ChevronLeft className="size-4" />
        返回
      </button>

      <div className="card p-5">
        <div className="flex gap-4">
          <WantIcon want={w} className="size-14" />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">徵求</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {CATEGORIES[w.category].label}
              </span>
              {!open && (
                <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white">
                  {wantStatusLabel(w, now)}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold leading-snug">{w.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span className="flex items-center gap-1">
                <MapPin className="size-4" />
                {formatDistance(distanceKm(pos.point, w.location))} · {w.areaLabel}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-4" />
                {timeAgo(w.createdAt, now)}發布{open && `・${wantTimeLeft(w, now)}`}
              </span>
            </p>
          </div>
        </div>
        {w.description && <p className="mt-4 whitespace-pre-line text-slate-700">{w.description}</p>}

        {owner && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
            <Avatar user={owner} size={40} />
            <div className="min-w-0 flex-1">
              <Link href={userPath(owner.id)} className="font-semibold hover:underline">
                {owner.name}
              </Link>
              <div className="mt-0.5">
                <TrustBadge d={d} userId={owner.id} />
              </div>
            </div>
          </div>
        )}

        {/* What the viewer can do */}
        <div className="mt-4 space-y-3">
          {mine && w.status === 'hidden' && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              有會員檢舉這則徵求，管理團隊確認前暫時不公開。
            </p>
          )}
          {mine && w.status === 'removed' && (
            <p className="rounded-xl bg-rose-50 p-3 text-sm text-m-rose">這則徵求已被管理團隊移除。</p>
          )}
          {mine && (w.status === 'open' || w.status === 'hidden') && w.expiresAt > now && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  confirm('結束這則徵求？結束後別人就看不到了。') &&
                  run(actions.closeWant(w.id), '已結束徵求，恭喜找到了！')
                }
              >
                <CheckCircle2 className="size-4" />
                已經找到了
              </button>
              <p className="text-xs text-slate-500">找到了或不需要了，就結束徵求。有人回應時{IS_REMOTE ? '會寄 Email 通知你' : '會顯示在下方'}。</p>
            </div>
          )}
          {mine && w.status === 'closed' && w.closedAt && (
            <p className="text-sm text-slate-500">已在 {formatDateTime(w.closedAt)} 結束。</p>
          )}

          {!me && open && (
            <Link href={`/login?next=${encodeURIComponent(`/wants/view?id=${w.id}`)}`} className="btn btn-primary">
              登入後回應
            </Link>
          )}

          {canAnswer && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
              <p className="font-bold">你有這個嗎？</p>
              <p className="mt-0.5 text-sm text-slate-600">
                刊登給{owner?.name ?? '對方'}，回應後{IS_REMOTE ? '對方會收到 Email 通知，' : ''}想要的話會到你的刊登按「索取」。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/post?want=${encodeURIComponent(w.id)}`} className="btn btn-primary">
                  <PackagePlus className="size-4" />
                  我有，刊登給對方
                </Link>
              </div>
              {myListings.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-violet-100 pt-3 text-sm">
                  <span className="text-slate-600">或用已經刊登的東西回應：</span>
                  <select
                    className="input w-auto max-w-full flex-1 py-1.5"
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    aria-label="選擇要回應的刊登"
                  >
                    <option value="">選擇刊登…</option>
                    {myListings.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                        {l.status === 'pending_review' ? '（審核中）' : ''}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-outline py-1.5" disabled={busy || !pick} onClick={answerWith}>
                    <Reply className="size-4" />
                    回應
                  </button>
                </div>
              )}
            </div>
          )}
          {!!me && !mine && open && myAnswers >= WANT_MAX_ANSWERS && (
            <p className="text-sm text-slate-500">你已經回應 {WANT_MAX_ANSWERS} 次了，等對方看看吧。</p>
          )}

          <div className="flex flex-wrap items-center gap-1">
            {me && !mine && <ReportButton targetType="want" targetId={w.id} />}
            {me && !mine && <BlockButton userId={w.userId} />}
            {staff && !mine && w.status !== 'removed' && (
              <button className="btn btn-ghost px-2 text-m-rose" onClick={() => setRemoveOpen(true)}>
                <Trash2 className="size-4" />
                移除這則徵求
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <MapView
          center={w.location}
          zoom={15}
          markers={[{ id: w.id, position: w.location, color: WANT_COLOR, label: w.title }]}
          fuzzyCircle={w.location}
          className="h-56"
        />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-bold">回應（{answers.length}）</h2>
        {answers.length === 0 ? (
          <p className="card p-6 text-center text-sm text-slate-500">
            {mine ? '還沒有人回應。附近有人刊登回應你時，會出現在這裡。' : '還沒有人回應，你可以當第一個。'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {answers.map((l) => (
              <ListingCard key={l.id} d={d} listing={l} distance={distanceKm(pos.point, publicLocationOf(l))} />
            ))}
          </div>
        )}
      </section>

      <Modal open={removeOpen} title="移除這則徵求" onClose={() => setRemoveOpen(false)}>
        <p className="text-sm text-slate-600">
          移除後其他人看不到這則徵求，{owner?.name ?? '對方'}會收到通知和原因。這個動作會寫進後台紀錄。
        </p>
        <textarea
          className="input mt-3"
          rows={3}
          maxLength={200}
          placeholder="原因，例如：重複張貼、不是平台允許的物品"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="移除原因"
        />
        <button
          className="btn btn-danger mt-4 w-full"
          disabled={busy}
          onClick={async () => {
            if (await run(actions.adminRemoveWant(w.id, reason), '已移除這則徵求')) setRemoveOpen(false);
          }}
        >
          確定移除
        </button>
      </Modal>
    </div>
  );
}

// useSearchParams needs a Suspense boundary in a static export.
export default function WantViewPage() {
  return (
    <Suspense>
      <WantPage />
    </Suspense>
  );
}
