'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BellPlus,
  BellRing,
  ChevronDown,
  List,
  LocateFixed,
  Map as MapIcon,
  PackageSearch,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { actions, currentUser, nowOf, useDB } from '@/lib/store';
import { IS_REMOTE } from '@/lib/backend';
import { searchListings, searchWants } from '@/lib/search';
import { RADIUS_OPTIONS } from '@/lib/rules';
import type { Category, Mode } from '@/lib/types';
import { ListingCard } from '@/components/ListingVisuals';
import { WANT_COLOR, WantCard } from '@/components/WantVisuals';
import { Announcement } from '@/components/Announcement';
import { ImpactStrip } from '@/components/Impact';
import { InstallBanner } from '@/components/Install';
import { MapView } from '@/components/map/MapView';
import { Empty, Modal } from '@/components/ui';
import { useMyPosition } from '@/components/hooks';
import { useToast } from '@/components/Providers';
import { listingPath, wantPath } from '@/lib/links';

const ZOOM_FOR_RADIUS: Record<number, number> = { 1: 15, 3: 13, 5: 12, 10: 11 };
const MODE_TEXT: Record<Mode, string> = { free: '免費', points: '點數', swap: '以物易物' };

/** One row of choices in the 篩選 sheet; applies at once. */
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-slate-700">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, text]) => (
          <button key={String(v)} className={`chip ${value === v ? 'chip-on' : 'chip-off'}`} aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
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
  const [filterOpen, setFilterOpen] = useState(false);

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
  // Settings in the 篩選 sheet that differ from the defaults (徵求 have no trade method).
  const modeOn = !wants && mode !== 'all';
  const filterCount = Number(modeOn) + Number(radius !== 1) + Number(sort !== 'near');
  const filterSummary = [`${radius} 公里內`, sort === 'near' ? '距離最近' : '最新', modeOn ? MODE_TEXT[mode as Mode] : '']
    .filter(Boolean)
    .join('・');
  const resetFilters = () => {
    setMode('all');
    setRadius(1);
    setSort('near');
  };
  const centre = pos.source === 'gps' ? '你附近' : '大安森林公園附近';
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
      {/* Short, so the first listings show on a phone's first screen. */}
      {!user && (
        <section className="mb-3 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-brand to-m-green p-4 text-white sm:gap-6 sm:rounded-3xl sm:p-6">
          <div className="min-w-0 flex-1">
            <p className="hidden text-sm font-semibold opacity-90 sm:block">分享吾需⇄換取所需</p>
            {/* Two whole phrases, so a phone breaks the line between them and not inside a word. */}
            <h1 className="text-lg font-bold leading-snug sm:mt-1 sm:text-2xl">
              <span className="inline-block">鄰居分享的食物和衣物</span>
              <span className="hidden sm:inline">，</span>
              <span className="inline-block">就在 1 公里內</span>
            </h1>
            <p className="mt-1 text-xs leading-relaxed opacity-90 sm:text-sm">
              免費、點數或以物易物；找不到的，也能發徵求。註冊送 {d.settings.signupBonus} 點。
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            <Link href="/login" className="btn bg-white px-3.5 py-2 text-brand-dark hover:bg-brand-soft">
              <Sparkles className="size-4" />
              免費註冊
            </Link>
            <Link href="/about" className="text-xs font-semibold underline underline-offset-2 opacity-90 hover:opacity-100">
              怎麼運作？
            </Link>
          </div>
        </section>
      )}
      {user && <InstallBanner />}
      <ImpactStrip d={d} />

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
          <label className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder={wants ? '搜尋徵求：外套、鮮奶…' : '搜尋：麵包、童裝…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="搜尋"
            />
          </label>
          <button
            className={`btn relative shrink-0 px-3 ${filterCount ? 'border border-brand bg-brand-soft text-brand-dark' : 'btn-outline'}`}
            onClick={() => setFilterOpen(true)}
            aria-label={filterCount ? `篩選（已設定 ${filterCount} 項）` : '篩選'}
          >
            <SlidersHorizontal className="size-4" />
            篩選
            {filterCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                {filterCount}
              </span>
            )}
          </button>
          <button
            className="btn btn-outline shrink-0 px-3 md:hidden"
            onClick={() => setView(view === 'list' ? 'map' : 'list')}
            aria-label={view === 'list' ? '切換到地圖' : '切換到列表'}
          >
            {view === 'list' ? <MapIcon className="size-4" /> : <List className="size-4" />}
            {view === 'list' ? '地圖' : '列表'}
          </button>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            className="ml-auto flex min-w-0 items-center gap-0.5 truncate text-sm text-slate-500 hover:text-brand"
            onClick={() => setFilterOpen(true)}
          >
            <span className="truncate">{filterSummary}</span>
            <ChevronDown className="size-4 shrink-0" />
          </button>
        </div>
      </div>

      <Modal open={filterOpen} title="篩選" onClose={() => setFilterOpen(false)}>
        <div className="space-y-5">
          {!wants && (
            <Choice
              label="交易方式"
              value={mode}
              options={[
                ['all', '全部'],
                ['free', '免費'],
                ['points', '點數'],
                ['swap', '以物易物'],
              ]}
              onChange={setMode}
            />
          )}
          <Choice label="範圍" value={radius} options={RADIUS_OPTIONS.map((r) => [r, `${r} 公里內`])} onChange={setRadius} />
          <Choice
            label="排序"
            value={sort}
            options={[
              ['near', '距離最近'],
              ['new', wants ? '最新發布' : '最新刊登'],
            ]}
            onChange={setSort}
          />
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-700">從哪裡算距離</legend>
            <div className="flex flex-wrap gap-2">
              <button
                className={`chip ${pos.source !== 'gps' ? 'chip-on' : 'chip-off'}`}
                aria-pressed={pos.source !== 'gps'}
                onClick={() => pos.reset()}
              >
                大安森林公園
              </button>
              <button
                className={`chip ${pos.source === 'gps' ? 'chip-on' : 'chip-off'}`}
                aria-pressed={pos.source === 'gps'}
                onClick={() => pos.locate((m) => toast(m, 'info'))}
                disabled={pos.locating}
              >
                <LocateFixed className="size-4" />
                {pos.locating ? '定位中…' : '我現在的位置'}
              </button>
            </div>
          </fieldset>
        </div>
        <div className="mt-6 flex gap-2">
          <button className="btn btn-outline" onClick={resetFilters} disabled={!filterCount}>
            重設
          </button>
          <button className="btn btn-primary flex-1" onClick={() => setFilterOpen(false)}>
            看 {wants ? wantHits.length : hits.length} 則{wants ? '徵求' : '分享'}
          </button>
        </div>
      </Modal>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {wants ? (
          <>
            <p className="text-sm text-slate-600">
              {centre} {radius} 公里內有 <b className="text-violet-700">{wantHits.length}</b> 則徵求
              <span className="hidden text-slate-400 sm:inline">　你有的話，可以刊登給對方</span>
            </p>
            {newWantButton('發徵求', true)}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              {centre} {radius} 公里內有 <b className="text-brand-dark">{hits.length}</b> 則分享
              <span className="hidden text-slate-400 sm:inline">　位置為約略範圍，對方接受後才顯示精確地點</span>
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
