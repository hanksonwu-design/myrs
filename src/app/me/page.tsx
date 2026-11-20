'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, ChevronRight, Coins, FastForward, Heart, LogOut, Pencil, RotateCcw, Shield, Store, Trash2, Users, X } from 'lucide-react';
import {
  actions,
  balanceOf,
  heldOf,
  listingById,
  nowOf,
  ratingOf,
  reviewPublished,
  useDB,
  userById,
} from '@/lib/store';
import { answersOf, WantIcon, wantTimeLeft } from '@/components/WantVisuals';
import { wantOpen, wantStatusLabel } from '@/lib/rules';
import { LISTING_STATUS_LABEL, RADIUS_OPTIONS } from '@/lib/rules';
import type { Category } from '@/lib/types';
import { formatDate, maskPhone, timeAgo } from '@/lib/format';
import { ListingThumb } from '@/components/ListingVisuals';
import { Avatar, Loading, Modal, ModeBadge, Stars } from '@/components/ui';
import { useMyPosition, useRequireLogin } from '@/components/hooks';
import { TrustBadge } from '@/components/TrustBadge';
import { useToast } from '@/components/Providers';
import { IS_REMOTE } from '@/lib/backend';
import { listingPath, wantPath } from '@/lib/links';

export default function MePage() {
  const d = useDB()!;
  // While logging out or deleting, stop the login guard so we land on 附近 instead of /login.
  const [leaving, setLeaving] = useState(false);
  const user = useRequireLogin(leaving ? null : d);
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const pos = useMyPosition();
  const [kw, setKw] = useState('');
  const [kwCat, setKwCat] = useState<Category | ''>('');
  const [kwRadius, setKwRadius] = useState(3);
  const [kwBusy, setKwBusy] = useState(false);
  if (!user) return <Loading />;

  const now = nowOf(d);
  const rating = ratingOf(d, user.id);
  const myListings = d.listings.filter((l) => l.ownerId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  const myWants = d.wants
    .filter((w) => w.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  const reviews = d.reviews.filter((r) => r.revieweeId === user.id && reviewPublished(d, r));
  const blocked = user.blocked.map((id) => userById(d, id)).filter(Boolean);
  const others = d.users.filter((u) => u.status === 'active' && u.id !== user.id);
  const favorites = d.favorites.filter((f) => f.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  const searches = d.savedSearches.filter((s) => s.userId === user.id).sort((a, b) => a.createdAt - b.createdAt);

  const addSearch = async () => {
    setKwBusy(true);
    const r = await actions.saveSearch({
      keyword: kw,
      category: kwCat || null,
      radiusKm: kwRadius,
      lat: pos.point.lat,
      lng: pos.point.lng,
    });
    setKwBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    setKw('');
    toast(`已訂閱「${kw.trim()}」`);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="card p-5">
        <div className="flex items-center gap-4">
          <Avatar user={user} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-xl font-bold">
              {user.name}
              {user.merchant && <Store className="size-4 text-brand" aria-label="試點商家" />}
              {user.role === 'admin' && <Shield className="size-4 text-slate-600" aria-label="管理員" />}
            </h1>
            <p className="text-sm text-slate-500">
              {maskPhone(user.phone)} · {formatDate(user.createdAt)} 加入
            </p>
            <p className="mt-1">
              <TrustBadge d={d} userId={user.id} deals />
            </p>
            {user.bio && <p className="mt-1 text-sm text-slate-600">{user.bio}</p>}
          </div>
          <button
            className="btn btn-ghost px-2"
            onClick={() => {
              setName(user.name);
              setBio(user.bio);
              setEditing(true);
            }}
            aria-label="編輯個人檔案"
          >
            <Pencil className="size-4" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Link href="/me/wallet" className="rounded-2xl bg-amber-50 p-3 hover:bg-amber-100">
            <p className="flex items-center justify-center gap-1 text-xl font-bold text-amber-700">
              <Coins className="size-4" />
              {balanceOf(d, user.id)}
            </p>
            <p className="text-xs text-amber-800">可用點數{heldOf(d, user.id) ? `（凍結 ${heldOf(d, user.id)}）` : ''}</p>
          </Link>
          <div className="rounded-2xl bg-rose-50 p-3">
            <p className="flex items-center justify-center gap-1 text-xl font-bold text-m-rose">
              <Heart className="size-4 fill-current" />
              {user.loveScore}
            </p>
            <p className="text-xs text-rose-800">愛心值</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-xl font-bold">{rating.count ? rating.avg.toFixed(1) : '－'}</p>
            <p className="text-xs text-slate-500">評價（{rating.count}）</p>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">我的刊登</h2>
          <Link href="/post" className="text-sm font-semibold text-brand">
            ＋ 發布
          </Link>
        </div>
        {myListings.length === 0 ? (
          <p className="text-sm text-slate-500">還沒有刊登。首次刊登送 {d.settings.firstListingReward} 點。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {myListings.map((l) => (
              <li key={l.id}>
                <Link href={listingPath(l.id)} className="flex items-center gap-3 py-2.5">
                  <ListingThumb listing={l} className="size-12 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{l.title}</p>
                    <p className="text-xs text-slate-500">
                      {LISTING_STATUS_LABEL[l.status]} · 剩 {l.remaining}/{l.quantity} · {timeAgo(l.createdAt, now)}
                    </p>
                  </div>
                  <ModeBadge listing={l} />
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">我的徵求</h2>
          <Link href="/wants/new" className="text-sm font-semibold text-brand">
            ＋ 發徵求
          </Link>
        </div>
        {myWants.length === 0 ? (
          <p className="text-sm text-slate-500">找不到想要的東西？發一則徵求，附近剛好有的人可以刊登給你。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {myWants.map((w) => (
              <li key={w.id}>
                <Link href={wantPath(w.id)} className="flex items-center gap-3 py-2.5">
                  <WantIcon want={w} className="size-12" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{w.title}</p>
                    <p className="text-xs text-slate-500">
                      {wantStatusLabel(w, now)}
                      {wantOpen(w, now) && `・${wantTimeLeft(w, now)}`} · {answersOf(d, w.id, user.id).length} 個回應 ·{' '}
                      {timeAgo(w.createdAt, now)}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-1.5 font-bold">
          <Heart className="size-4 text-m-rose" />
          我的收藏
        </h2>
        {favorites.length === 0 ? (
          <p className="text-sm text-slate-500">在刊登頁按右上角的愛心，就會收藏在這裡。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {favorites.map((f) => {
              const l = listingById(d, f.listingId);
              return (
                <li key={f.listingId} className="flex items-center gap-3 py-2.5">
                  {l ? (
                    <Link href={listingPath(l.id)} className="flex min-w-0 flex-1 items-center gap-3">
                      <ListingThumb listing={l} className="size-12 shrink-0 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{l.title}</p>
                        <p className="text-xs text-slate-500">
                          {LISTING_STATUS_LABEL[l.status]} · {l.areaLabel}
                        </p>
                      </div>
                      <ModeBadge listing={l} />
                    </Link>
                  ) : (
                    <p className="flex-1 text-sm text-slate-500">這則刊登已經看不到了</p>
                  )}
                  <button
                    className="btn btn-ghost px-2 text-slate-400"
                    aria-label="取消收藏"
                    title="取消收藏"
                    onClick={async () => {
                      const r = await actions.toggleFavorite(f.listingId);
                      if (!r.ok) toast(r.error, 'error');
                    }}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-1.5 font-bold">
          <Bell className="size-4 text-brand" />
          關鍵字通知
        </h2>
        <p className="mb-3 text-sm text-slate-500">
          附近出現符合關鍵字的新刊登時，寄 Email 通知你（每天最多 10 封）。範圍以
          {pos.source === 'gps' ? '你目前的位置' : '試點中心（大安森林公園）'}為中心，最多 5 個關鍵字。
          {!IS_REMOTE && '（示範模式不會真的寄信）'}
        </p>
        {searches.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-2">
            {searches.map((s) => (
              <li key={s.id} className="flex items-center gap-1 rounded-full bg-brand-soft py-1 pl-3 pr-1 text-sm text-brand-dark">
                <span className="font-semibold">{s.keyword}</span>
                <span className="text-xs">
                  {s.category ? `・${s.category === 'food' ? '食物' : '衣物'}` : ''}・{s.radiusKm} 公里內
                </span>
                <button
                  className="rounded-full p-1 hover:bg-white/60"
                  aria-label={`刪除「${s.keyword}」`}
                  onClick={async () => {
                    const r = await actions.deleteSavedSearch(s.id);
                    toast(r.ok ? `已刪除「${s.keyword}」` : r.error, r.ok ? 'info' : 'error');
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addSearch();
          }}
        >
          <input
            className="input min-w-0 flex-1 basis-40"
            placeholder="例如：吐司、童裝、外套"
            maxLength={20}
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            aria-label="關鍵字"
          />
          <select
            className="rounded-xl border border-slate-300 bg-white px-2 text-sm"
            value={kwCat}
            onChange={(e) => setKwCat(e.target.value as Category | '')}
            aria-label="分類"
          >
            <option value="">全部分類</option>
            <option value="food">食物</option>
            <option value="clothing">衣物</option>
          </select>
          <select
            className="rounded-xl border border-slate-300 bg-white px-2 text-sm"
            value={kwRadius}
            onChange={(e) => setKwRadius(Number(e.target.value))}
            aria-label="範圍"
          >
            {RADIUS_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r} 公里內
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={kwBusy || !kw.trim() || searches.length >= 5}>
            訂閱
          </button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-bold">收到的評價</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-slate-500">雙方都評價後，或交易完成 {d.settings.reviewWindowDays} 天後，評價才會出現在這裡。</p>
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

      {blocked.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-bold">封鎖名單</h2>
          <ul className="space-y-2">
            {blocked.map((u) => (
              <li key={u!.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Avatar user={u} size={28} />
                  {u!.name}
                </span>
                <button
                  className="btn btn-outline py-1.5"
                  onClick={async () => {
                    const r = await actions.toggleBlock(u!.id);
                    toast(r.ok ? '已解除封鎖' : r.error, r.ok ? 'success' : 'error');
                  }}
                >
                  解除
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!IS_REMOTE && (
      <section className="card border-dashed border-amber-300 bg-amber-50/40 p-5">
        <h2 className="mb-1 flex items-center gap-1.5 font-bold">
          <Users className="size-4" />
          示範工具
        </h2>
        <p className="mb-3 text-sm text-slate-500">切換帳號體驗另一方的流程；快轉時間可以測試逾時取消、自動完成、食品過期。</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {others.map((u) => (
            <button
              key={u.id}
              className="btn btn-outline py-1.5"
              onClick={async () => {
                const r = await actions.loginAs(u.id);
                toast(r.ok ? `已切換為「${u.name}」` : r.error, r.ok ? 'success' : 'error');
              }}
            >
              <Avatar user={u} size={20} />
              {u.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-outline py-1.5"
            onClick={async () => {
              const r = await actions.fastForward(25);
              toast(r.ok && r.value ? '已快轉 25 小時，有交易或刊登因時間規則更新了' : '已快轉 25 小時', 'info');
            }}
          >
            <FastForward className="size-4" />
            快轉 25 小時
          </button>
          <button
            className="btn btn-outline py-1.5"
            onClick={async () => {
              if (!confirm('重設會清除你新增的所有資料，回到初始示範資料。確定？')) return;
              await actions.resetDemo();
              toast('已重設示範資料');
              router.push('/login');
            }}
          >
            <RotateCcw className="size-4" />
            重設示範資料
          </button>
        </div>
        {d.clockOffsetMs > 0 && (
          <p className="mt-2 text-xs text-amber-700">目前已快轉 {Math.round(d.clockOffsetMs / 3_600_000)} 小時。</p>
        )}
      </section>
      )}

      <section className="card divide-y divide-slate-100">
        <Link href="/about" className="flex items-center justify-between p-4 text-sm font-semibold">
          關於 Myrs 與使用規則
          <ChevronRight className="size-4 text-slate-300" />
        </Link>
        <button
          className="flex w-full items-center gap-2 p-4 text-left text-sm font-semibold"
          onClick={async () => {
            setLeaving(true);
            await actions.logout();
            router.push('/');
          }}
        >
          <LogOut className="size-4" />
          登出
        </button>
        <button
          className="flex w-full items-center gap-2 p-4 text-left text-sm font-semibold text-m-rose"
          onClick={async () => {
            if (!confirm('刪除帳號後無法復原，進行中的交易會取消、刊登會下架。確定刪除？')) return;
            setLeaving(true);
            const r = await actions.deleteAccount();
            if (!r.ok) {
              setLeaving(false);
              return toast(r.error, 'error');
            }
            toast('帳號已刪除');
            router.push('/');
          }}
        >
          <Trash2 className="size-4" />
          刪除帳號
        </button>
      </section>

      <Modal open={editing} title="編輯個人檔案" onClose={() => setEditing(false)}>
        <label className="label" htmlFor="pname">
          暱稱
        </label>
        <input id="pname" className="input" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="label mt-3" htmlFor="pbio">
          自我介紹
        </label>
        <textarea id="pbio" className="input" rows={3} maxLength={100} value={bio} onChange={(e) => setBio(e.target.value)} />
        <button
          className="btn btn-primary mt-4 w-full"
          onClick={async () => {
            const r = await actions.updateProfile(name, bio);
            if (!r.ok) return toast(r.error, 'error');
            setEditing(false);
            toast('已更新');
          }}
        >
          儲存
        </button>
      </Modal>
    </div>
  );
}
