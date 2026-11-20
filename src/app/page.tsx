'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellPlus, BellRing, List, LocateFixed, Map as MapIcon, PackageSearch, Search, Sparkles } from 'lucide-react';
import { actions, currentUser, nowOf, useDB } from '@/lib/store';
import { IS_REMOTE } from '@/lib/backend';
import { searchListings, searchWants } from '@/lib/search';
import { RADIUS_OPTIONS } from '@/lib/rules';
import type { Category, Mode } from '@/lib/types';
import { ListingCard } from '@/components/ListingVisuals';
import { WANT_COLOR, WantCard } from '@/components/WantVisuals';
import { Announcement } from '@/components/Announcement';
import { MapView } from '@/components/map/MapView';
import { Empty } from '@/components/ui';
import { useMyPosition } from '@/components/hooks';
import { useToast } from '@/components/Providers';
import { listingPath, wantPath } from '@/lib/links';

const ZOOM_FOR_RADIUS: Record<number, number> = { 1: 15, 3: 13, 5: 12, 10: 11 };
const KIND_KEY = 'myrs-home-kind';
type Kind = 'share' | 'want';

export default function NearbyPage() {
  const d = useDB()!;
  const router = useRouter();
  const toast = useToast();
  const user = currentUser(d);
  const pos = useMyPosition();
  const [kind, setKindState] = useState<Kind>('share');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [mode, setMode] = useState<Mode | 'all'>('all');
  const [radius, setRadius] = useState(1);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'near' | 'new'>('near');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [hover, setHover] = useState<string | null>(null);

  // Coming back from a want keeps the 徵求 tab; read after mount (the page is pre-rendered).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sessionStorage.getItem(KIND_KEY) === 'want') setKindState('want');
  }, []);
  const setKind = (k: Kind) => {
    sessionStorage.setItem(KIND_KEY, k);
    setKindState(k);
  };

  const hits = useMemo(
    () =>
      searchListings(d, {
        center: pos.point,
        radiusKm: radius,
        category,
        mode,
        q,
        sort,
        viewerId: user?.id ?? null,
      }),
    [d, pos.point, radius, category, mode, q, sort, user?.id],
  );
  const wantHits = useMemo(
    () => searchWants(d, { center: pos.point, radiusKm: radius, category, q, sort, viewerId: user?.id ?? null }, nowOf(d)),
    [d, pos.point, radius, category, q, sort, user?.id],
  );

  const wants = kind === 'want';
  const nextRadius = RADIUS_OPTIONS.find((r) => r > radius);
  const keyword = q.trim();
  const alertCat = category === 'all' ? null : category;
  const subscribed =
    !!user &&
    d.savedSearches.some(
      (s) => s.userId === user.id && s.keyword.toLowerCase() === keyword.toLowerCase() && s.category === alertCat,
    );
  const newWantHref = keyword ? `/wants/new?title=${encodeURIComponent(keyword.slice(0, 30))}` : '/wants/new';

  const subscribe = async () => {
    if (!user) return router.push('/login?next=/');
    if (keyword.length > 20) return toast('關鍵字最多 20 個字', 'error');
    const r = await actions.saveSearch({
      keyword,
      category: alertCat,
      radiusKm: radius,
      lat: pos.point.lat,
      lng: pos.point.lng,
    });
    if (!r.ok) return toast(r.error, 'error');
    toast(
      IS_REMOTE
        ? `已訂閱：${radius} 公里內有新的「${keyword}」會寄 Email 給你。可以在「我的」頁面管理。`
        : `已訂閱「${keyword}」（示範模式不會真的寄信）`,
    );
  };

  const map = (
    <MapView
      center={pos.point}
      zoom={ZOOM_FOR_RADIUS[radius]}
      radiusKm={radius}
      userPosition={pos.point}
      markers={
        wants
          ? wantHits.map((h) => ({
              id: h.want.id,
              position: h.want.location,
              color: WANT_COLOR,
              label: h.want.title,
              active: hover === h.want.id,
            }))
          : hits.map((h) => ({
              id: h.listing.id,
              position: h.publicLocation,
              color: h.listing.category === 'food' ? '#F0A000' : '#00A8E8',
              label: h.listing.title,
              active: hover === h.listing.id,
            }))
      }
      onMarkerClick={(id) => router.push(wants ? wantPath(id) : listingPath(id))}
      className="h-[calc(100vh-15rem)] min-h-80 md:h-[calc(100vh-9rem)]"
    />
  );

  const newWantButton = (label: string, primary = false) => (
    <Link href={newWantHref} className={`btn ${primary ? 'btn-primary' : 'btn-outline'} py-1.5 text-sm`}>
      <PackageSearch className="size-4" />
      {label}
    </Link>
  );

  return (
    <div>
      <Announcement d={d} />
      {!user && (
        <section className="mb-4 overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-m-green p-5 text-white sm:p-7">
          <p className="text-sm font-semibold opacity-90">分享吾需⇄換取所需</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">打開就看到 1 公里內，鄰居分享的食物與衣物</h1>
          <p className="mt-2 max-w-xl text-sm opacity-90">
            多餘的東西刊登出來，需要的人用點數、以物易物或免費索取。找不到的，也可以發徵求。註冊就送{' '}
            {d.settings.signupBonus} 點。
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/login" className="btn bg-white text-brand-dark hover:bg-brand-soft">
              <Sparkles className="size-4" />
              免費註冊
            </Link>
            <Link href="/about" className="btn border border-white/50 text-white hover:bg-white/10">
              怎麼運作
            </Link>
          </div>
        </section>
      )}

      {/* Filters */}
      <div className="sticky top-14 z-[1000] -mx-4 mb-3 space-y-2 bg-[#f6f8f7]/95 px-4 pb-2 pt-1 backdrop-blur">
        <div className="grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1 text-sm font-semibold" role="tablist">
          {(
            [
              ['share', '附近的分享'],
              ['want', '附近的徵求'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              className={`rounded-xl py-1.5 transition ${
                kind === k ? `bg-white shadow-sm ${k === 'want' ? 'text-violet-700' : 'text-brand-dark'}` : 'text-slate-500'
              }`}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder={wants ? '搜尋徵求：外套、鮮奶…' : '搜尋：麵包、童裝、外套…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="搜尋"
            />
          </label>
          <button
            className="btn btn-outline px-3 md:hidden"
            onClick={() => setView(view === 'list' ? 'map' : 'list')}
            aria-label={view === 'list' ? '切換到地圖' : '切換到列表'}
          >
            {view === 'list' ? <MapIcon className="size-4" /> : <List className="size-4" />}
            {view === 'list' ? '地圖' : '列表'}
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {(
            [
              ['all', '全部'],
              ['food', '食'],
              ['clothing', '衣'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} className={`chip ${category === v ? 'chip-on' : 'chip-off'}`} onClick={() => setCategory(v)}>
              {label}
            </button>
          ))}
          {!wants && (
            <>
              <span className="mx-1 w-px shrink-0 bg-slate-300" />
              {(
                [
                  ['all', '所有方式'],
                  ['free', '免費'],
                  ['points', '點數'],
                  ['swap', '以物易物'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={`chip ${mode === v ? 'chip-on' : 'chip-off'}`} onClick={() => setMode(v)}>
                  {label}
                </button>
              ))}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="flex items-center gap-1">
            <span className="text-slate-500">範圍</span>
            <select
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              aria-label="搜尋範圍"
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} 公里內
                </option>
              ))}
            </select>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-slate-500">排序</span>
            <select
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold"
              value={sort}
              onChange={(e) => setSort(e.target.value as 'near' | 'new')}
              aria-label="排序"
            >
              <option value="near">距離最近</option>
              <option value="new">{wants ? '最新發布' : '最新刊登'}</option>
            </select>
          </span>
          <button
            className="flex items-center gap-1 text-slate-600 hover:text-brand"
            onClick={() => (pos.source === 'gps' ? pos.reset() : pos.locate((m) => toast(m, 'info')))}
            disabled={pos.locating}
          >
            <LocateFixed className="size-4" />
            {pos.locating ? '定位中…' : pos.source === 'gps' ? '我的位置（改回試點中心）' : '大安森林公園（使用我的位置）'}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {wants ? (
          <>
            <p className="text-sm text-slate-600">
              {radius} 公里內有 <b className="text-violet-700">{wantHits.length}</b> 則徵求
              <span className="text-slate-400">　你有的話，可以刊登給對方</span>
            </p>
            {newWantButton('發徵求', true)}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              {radius} 公里內有 <b className="text-brand-dark">{hits.length}</b> 則分享
              <span className="text-slate-400">　位置為約略範圍，對方接受後才顯示精確地點</span>
            </p>
            {keyword &&
              (subscribed ? (
                <Link href="/me" className="flex items-center gap-1 text-sm font-semibold text-brand-dark">
                  <BellRing className="size-4" />
                  已訂閱「{keyword}」通知
                </Link>
              ) : (
                <button className="btn btn-outline py-1.5 text-sm" onClick={subscribe}>
                  <BellPlus className="size-4" />
                  有新的「{keyword}」通知我
                </button>
              ))}
          </>
        )}
      </div>

      <div className="md:grid md:grid-cols-[1fr_minmax(320px,42%)] md:gap-4">
        <div className={view === 'map' ? 'hidden md:block' : ''}>
          {wants ? (
            wantHits.length === 0 ? (
              <Empty
                icon={<PackageSearch className="size-6" />}
                title={`${radius} 公里內${keyword ? '沒有符合的徵求' : '還沒有人徵求'}`}
                text="有想要的東西？發一則徵求，附近剛好有的人就能刊登給你。"
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {newWantButton(keyword ? `發徵求「${keyword}」` : '發徵求', true)}
                    {nextRadius && (
                      <button className="btn btn-outline py-1.5 text-sm" onClick={() => setRadius(nextRadius)}>
                        擴大到 {nextRadius} 公里
                      </button>
                    )}
                  </div>
                }
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {wantHits.map((h) => (
                  <WantCard
                    key={h.want.id}
                    d={d}
                    want={h.want}
                    distance={h.distance}
                    highlighted={hover === h.want.id}
                    onHover={setHover}
                  />
                ))}
              </div>
            )
          ) : hits.length === 0 ? (
            <Empty
              icon={<Search className="size-6" />}
              title={`${radius} 公里內沒有符合的分享`}
              text={`${nextRadius ? '擴大範圍看看，或換個關鍵字。' : '換個關鍵字或篩選條件看看。'}找不到的話，可以發一則徵求。`}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {nextRadius && (
                    <button className="btn btn-primary py-1.5 text-sm" onClick={() => setRadius(nextRadius)}>
                      擴大到 {nextRadius} 公里
                    </button>
                  )}
                  {newWantButton(keyword ? `發徵求「${keyword}」` : '發徵求')}
                </div>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {hits.map((h) => (
                <ListingCard
                  key={h.listing.id}
                  d={d}
                  listing={h.listing}
                  distance={h.distance}
                  highlighted={hover === h.listing.id}
                  onHover={setHover}
                />
              ))}
            </div>
          )}
        </div>
        <div className={`${view === 'list' ? 'hidden md:block' : ''} md:sticky md:top-[13.5rem] md:self-start`}>{map}</div>
      </div>
    </div>
  );
}
