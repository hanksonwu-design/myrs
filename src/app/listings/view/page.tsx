'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeftRight,
  BadgeCheck,
  Calendar,
  ChevronLeft,
  Clock,
  Heart,
  MapPin,
  Navigation,
  Package,
  Pencil,
  Store,
  TriangleAlert,
} from 'lucide-react';
import {
  actions,
  balanceOf,
  canSeeExact,
  currentUser,
  isBlockedBetween,
  isFavorite,
  listingById,
  nowOf,
  OPEN_STATUSES,
  ratingOf,
  useDB,
  userById,
} from '@/lib/store';
import { CATEGORIES, LISTING_STATUS_LABEL, ORDER_STATUS_LABEL } from '@/lib/rules';
import { distanceKm, publicLocationOf } from '@/lib/geo';
import { directionsUrl } from '@/lib/geocode';
import type { LatLng } from '@/lib/types';
import { formatDate, formatDistance, timeAgo } from '@/lib/format';
import { ExpiryTag, ListingThumb } from '@/components/ListingVisuals';
import { MapView } from '@/components/map/MapView';
import { Avatar, Modal, ModeBadge, NotFound, OrderStatusBadge, Stars } from '@/components/ui';
import { BlockButton, ReportButton } from '@/components/ReportBlock';
import { RemoveListingButton } from '@/components/RemoveListing';
import { isStaff } from '@/lib/staff';
import { IS_REMOTE } from '@/lib/backend';
import { LocationPicker } from '@/components/LocationPicker';
import { TrustBadge } from '@/components/TrustBadge';
import { useMyPosition } from '@/components/hooks';
import { useToast } from '@/components/Providers';
import { chatPath, listingPath, userPath } from '@/lib/links';

function ListingPage() {
  const id = useSearchParams().get('id') ?? '';
  const d = useDB()!;
  const router = useRouter();
  const toast = useToast();
  const pos = useMyPosition();
  const [photo, setPhoto] = useState(0);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [swapOffer, setSwapOffer] = useState('');
  const [sending, setSending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoc, setEditLoc] = useState<LatLng | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAuto, setEditAuto] = useState(false);
  const [saving, setSaving] = useState(false);

  const l = listingById(d, id);
  const me = currentUser(d);
  if (!l || (l.status === 'removed' && l.ownerId !== me?.id && !isStaff(me))) {
    return <NotFound text="找不到這則刊登，可能已被下架。" />;
  }
  const owner = userById(d, l.ownerId);
  const involved = !!me && (l.ownerId === me.id || isStaff(me) || d.orders.some((o) => o.listingId === l.id && o.requesterId === me.id));
  // Same rule as the server: a suspended member's listings are hidden from everyone else.
  if (owner && owner.status !== 'active' && !involved) {
    return <NotFound text="找不到這則刊登，可能已被下架。" />;
  }
  const rating = ratingOf(d, l.ownerId);
  const now = nowOf(d);
  const isOwner = me?.id === l.ownerId;
  const publicLoc = publicLocationOf(l);
  const myOrder = me
    ? [...d.orders].reverse().find((o) => o.listingId === l.id && o.requesterId === me.id)
    : undefined;
  const myOpenOrder = myOrder && OPEN_STATUSES.includes(myOrder.status) ? myOrder : undefined;
  const requests = d.orders.filter((o) => o.listingId === l.id);
  const blocked = me ? isBlockedBetween(d, me.id, l.ownerId) : false;
  const balance = me ? balanceOf(d, me.id) : 0;
  const exact = canSeeExact(d, l, me?.id);
  const fav = isFavorite(d, me?.id, l.id);
  const dealOn = requests.some((o) => o.status === 'accepted' || o.status === 'disputed');
  const canMove = isOwner && ['active', 'pending_review', 'reserved'].includes(l.status);

  const toggleFav = async () => {
    if (!me) return router.push(`/login?next=${encodeURIComponent(listingPath(l.id))}`);
    const r = await actions.toggleFavorite(l.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.value ? '已加入收藏，可以在「我的」頁面找到' : '已取消收藏', r.value ? 'success' : 'info');
  };

  const openEdit = () => {
    setEditLoc(l.location);
    setEditLabel(l.areaLabel);
    setEditAuto(false);
    setEditOpen(true);
  };

  const saveLocation = async () => {
    if (!editLoc) return;
    setSaving(true);
    const r = await actions.updateListingLocation(l.id, editLoc, editLabel);
    setSaving(false);
    if (!r.ok) return toast(r.error, 'error');
    setEditOpen(false);
    toast('已更新面交地點');
  };

  const submit = async () => {
    setSending(true);
    const r = await actions.requestListing(l.id, { note, swapOffer });
    setSending(false);
    if (!r.ok) return toast(r.error, 'error');
    setOpen(false);
    toast(l.mode === 'points' ? `已送出索取，先凍結 ${l.pricePoints} 點，等對方回覆` : '已送出索取，等對方回覆');
    router.push('/orders?tab=request');
  };

  return (
    <div className="mx-auto max-w-5xl">
      <button onClick={() => router.back()} className="btn btn-ghost -ml-3 mb-2 px-2">
        <ChevronLeft className="size-4" />
        返回
      </button>

      {l.status !== 'active' && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <TriangleAlert className="size-4 shrink-0" />
          {l.status === 'pending_review'
            ? `這則刊登正在等候審核，通過後才會公開。${l.flaggedWords.length ? `（偵測到：${[...new Set(l.flaggedWords)].join('、')}）` : ''}`
            : `這則刊登目前「${LISTING_STATUS_LABEL[l.status]}」。`}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {/* Photos */}
        <div>
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
            {l.photos.length ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.photos[photo]} alt={l.title} className="aspect-square w-full object-cover" />
            ) : (
              <ListingThumb listing={l} className="aspect-square w-full" />
            )}
          </div>
          {l.photos.length > 1 && (
            <div className="mt-2 flex gap-2">
              {l.photos.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setPhoto(i)}
                  className={`size-16 overflow-hidden rounded-xl border-2 ${i === photo ? 'border-brand' : 'border-transparent'}`}
                  aria-label={`第 ${i + 1} 張照片`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <ModeBadge listing={l} large />
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {CATEGORIES[l.category].label}・{l.sub}
              </span>
              <ExpiryTag listing={l} now={now} />
            </div>
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-2xl font-bold leading-snug">{l.title}</h1>
              {!isOwner && (
                <button
                  className={`btn btn-ghost -mr-2 shrink-0 px-2 ${fav ? 'text-m-rose' : 'text-slate-400'}`}
                  onClick={toggleFav}
                  aria-pressed={fav}
                  aria-label={fav ? '取消收藏' : '收藏'}
                  title={fav ? '取消收藏' : '收藏'}
                >
                  <Heart className={`size-6 ${fav ? 'fill-current' : ''}`} />
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {timeAgo(l.createdAt, now)}刊登 · {formatDistance(distanceKm(pos.point, publicLoc))}
            </p>
          </div>

          {l.mode === 'swap' && (
            <div className="flex items-start gap-2 rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
              <ArrowLeftRight className="mt-0.5 size-4 shrink-0" />
              <span>
                想交換：<b>{l.swapWish}</b>
              </span>
            </div>
          )}

          {l.description && <p className="whitespace-pre-line leading-relaxed text-slate-700">{l.description}</p>}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="card p-3">
              <dt className="flex items-center gap-1 text-slate-500">
                <Package className="size-3.5" />
                數量
              </dt>
              <dd className="mt-0.5 font-semibold">
                剩 {l.remaining}／共 {l.quantity}
              </dd>
            </div>
            <div className="card p-3">
              <dt className="flex items-center gap-1 text-slate-500">
                <Clock className="size-3.5" />
                可面交時段
              </dt>
              <dd className="mt-0.5 font-semibold">{l.timeSlots}</dd>
            </div>
            {l.expiresOn && (
              <div className="card p-3">
                <dt className="flex items-center gap-1 text-slate-500">
                  <Calendar className="size-3.5" />
                  到期日
                </dt>
                <dd className="mt-0.5 font-semibold">{l.expiresOn.replaceAll('-', '/')}</dd>
              </div>
            )}
            {l.storage && (
              <div className="card p-3">
                <dt className="text-slate-500">保存方式</dt>
                <dd className="mt-0.5 font-semibold">{l.storage}</dd>
              </div>
            )}
          </dl>

          {/* Owner */}
          {owner && (
            <Link href={userPath(owner.id)} className="card flex items-center gap-3 p-3 hover:border-brand">
              <Avatar user={owner} size={44} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 font-bold">
                  {owner.name}
                  {owner.merchant && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand-dark">
                      <Store className="size-3" />
                      試點商家
                    </span>
                  )}
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <TrustBadge d={d} userId={owner.id} />
                  {rating.count ? (
                    <span className="flex items-center gap-1">
                      <Stars value={rating.avg} size={12} />
                      {rating.avg.toFixed(1)}（{rating.count}）
                    </span>
                  ) : (
                    <span>還沒有評價</span>
                  )}
                  <span className="flex items-center gap-0.5 text-m-rose">
                    <Heart className="size-3 fill-current" />
                    愛心值 {owner.loveScore}
                  </span>
                  <span>{formatDate(owner.createdAt)} 加入</span>
                </p>
              </div>
            </Link>
          )}

          {/* Actions */}
          {isOwner ? (
            <div className="card space-y-3 p-4">
              <p className="font-bold">這是你的刊登</p>
              {requests.length ? (
                <ul className="space-y-1 text-sm">
                  {requests.map((o) => (
                    <li key={o.id} className="flex items-center justify-between">
                      <span>
                        {userById(d, o.requesterId)?.name}・{timeAgo(o.createdAt, now)}
                      </span>
                      <OrderStatusBadge status={o.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">還沒有人索取。</p>
              )}
              <div className="flex gap-2">
                <Link href="/orders?tab=provide" className="btn btn-primary flex-1">
                  處理索取
                </Link>
                {['active', 'pending_review', 'reserved'].includes(l.status) && (
                  <button
                    className="btn btn-danger"
                    onClick={async () => {
                      if (!confirm('確定下架這則刊登？還沒回覆的索取會自動取消。')) return;
                      const r = await actions.closeListing(l.id);
                      toast(r.ok ? '已下架' : r.error, r.ok ? 'success' : 'error');
                    }}
                  >
                    下架
                  </button>
                )}
              </div>
            </div>
          ) : myOpenOrder ? (
            <div className="card flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-bold">你已索取</p>
                <p className="text-sm text-slate-500">狀態：{ORDER_STATUS_LABEL[myOpenOrder.status]}</p>
              </div>
              <Link
                href={myOpenOrder.acceptedAt ? chatPath(myOpenOrder.id) : '/orders?tab=request'}
                className="btn btn-primary"
              >
                {myOpenOrder.acceptedAt ? '前往聊天' : '查看索取'}
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                className="btn btn-primary w-full py-3 text-base"
                disabled={l.status !== 'active' || l.remaining <= 0 || blocked}
                onClick={() => (me ? setOpen(true) : router.push(`/login?next=${encodeURIComponent(listingPath(l.id))}`))}
              >
                {blocked
                  ? '你和對方之間有封鎖'
                  : l.mode === 'points'
                    ? `用 ${l.pricePoints} 點索取`
                    : l.mode === 'swap'
                      ? '提出交換'
                      : '免費索取'}
              </button>
              {me && l.mode === 'points' && (
                <p className="text-center text-xs text-slate-500">你目前可用 {balance} 點；索取時先凍結，完成才轉給對方。</p>
              )}
            </div>
          )}

          {!isOwner && (
            <div className="flex items-center justify-end gap-1">
              <ReportButton targetType="listing" targetId={l.id} />
              <BlockButton userId={l.ownerId} />
            </div>
          )}

          {isStaff(me) && !isOwner && l.status !== 'removed' && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-600">
              <span className="flex-1">
                管理團隊：這則刊登違反規則時可以直接下架{IS_REMOTE ? '，刊登者會收到 Email 和原因' : ''}。
              </span>
              <RemoveListingButton listing={l} className="btn btn-danger shrink-0 px-3 py-1.5 text-sm" />
            </div>
          )}
        </div>
      </div>

      {/* Location */}
      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-1 font-bold">
          <MapPin className="size-4 text-brand" />
          {l.areaLabel}
        </h2>
        <p className="mb-2 text-sm text-slate-500">
          {!exact
            ? '圓圈是約略範圍（約 200 公尺）。對方接受索取後，聊天室會顯示精確面交地點。'
            : isOwner
              ? '圖釘是精確面交地點，只有你和你接受索取的人看得到；其他人只看到約 200 公尺的範圍。'
              : myOrder
                ? '你的索取已被接受，圖釘是精確面交地點。'
                : '管理員檢視：圖釘是精確面交地點。'}
        </p>
        {exact ? (
          <MapView center={l.location} zoom={17} markers={[{ id: 'exact', position: l.location, color: '#00A078' }]} className="h-64" />
        ) : (
          <MapView center={publicLoc} zoom={16} fuzzyCircle={publicLoc} className="h-64" />
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {exact && !isOwner && (
            <a href={directionsUrl(l.location)} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
              <Navigation className="size-4" />
              用 Google 地圖導航
            </a>
          )}
          {canMove && !dealOn && (
            <button className="btn btn-outline" onClick={openEdit}>
              <Pencil className="size-4" />
              修改面交地點
            </button>
          )}
          {canMove && dealOn && <p className="text-xs text-slate-500">已經有接受的交易，要換地點請在聊天室和對方另約。</p>}
        </div>
      </section>

      <Modal open={editOpen} title="修改面交地點" onClose={() => setEditOpen(false)}>
        <LocationPicker
          value={editLoc}
          onChange={setEditLoc}
          label={editLabel}
          labelAuto={editAuto}
          onLabel={(text, auto) => {
            setEditLabel(text);
            setEditAuto(auto);
          }}
          fallback={l.location}
          mapClassName="h-56"
        />
        <p className="mt-2 text-xs text-slate-500">其他人看到的約略範圍會跟著更新。</p>
        <button className="btn btn-primary mt-3 w-full" onClick={saveLocation} disabled={saving || !editLoc || !editLabel.trim()}>
          {saving ? '儲存中…' : '儲存新地點'}
        </button>
      </Modal>

      <Modal open={open} title={l.mode === 'swap' ? '提出交換' : '索取'} onClose={() => setOpen(false)}>
        <div className="mb-4 flex items-center gap-3">
          <ListingThumb listing={l} className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{l.title}</p>
            <ModeBadge listing={l} />
          </div>
        </div>
        {l.mode === 'points' && (
          <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            會先凍結 <b>{l.pricePoints} 點</b>（你目前可用 {balance} 點）。對方婉拒或交易取消會全數退回；雙方確認完成後才轉給對方。
          </div>
        )}
        {l.mode === 'free' && (
          <div className="mb-4 rounded-xl bg-brand-soft p-3 text-sm text-brand-dark">
            免費索取每天最多 {d.settings.freeDailyLimit} 件，請只索取自己需要的。
          </div>
        )}
        {l.mode === 'swap' && (
          <div className="mb-3">
            <label className="label" htmlFor="swap">
              你想拿什麼交換？
            </label>
            <input
              id="swap"
              className="input"
              placeholder={`對方想要：${l.swapWish}`}
              value={swapOffer}
              onChange={(e) => setSwapOffer(e.target.value)}
            />
          </div>
        )}
        <label className="label" htmlFor="note">
          給對方的話（選填）
        </label>
        <textarea
          id="note"
          className="input"
          rows={3}
          maxLength={200}
          placeholder="例如：想週六下午去拿，可以嗎？"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <BadgeCheck className="size-3.5" />
          對方 {d.settings.requestTimeoutHours} 小時內沒回覆會自動取消。
        </p>
        <button className="btn btn-primary mt-4 w-full" onClick={submit} disabled={sending}>
          {sending ? '送出中…' : '確認送出'}
        </button>
      </Modal>
    </div>
  );
}

// useSearchParams needs a Suspense boundary in a static export.
export default function Page() {
  return (
    <Suspense>
      <ListingPage />
    </Suspense>
  );
}
