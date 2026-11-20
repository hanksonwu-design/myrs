'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BellPlus, ChevronLeft, Shirt, Utensils } from 'lucide-react';
import { actions, useDB, validateWant, type NewWantInput } from '@/lib/store';
import { findBannedWords, WANT_DAYS, WANT_MAX_OPEN } from '@/lib/rules';
import { IS_REMOTE } from '@/lib/backend';
import type { Category, LatLng } from '@/lib/types';
import { LocationPicker } from '@/components/LocationPicker';
import { Loading } from '@/components/ui';
import { useMyPosition, useRequireLogin } from '@/components/hooks';
import { useToast } from '@/components/Providers';
import { wantPath } from '@/lib/links';

function NewWantForm() {
  const d = useDB()!;
  const user = useRequireLogin(d);
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const pos = useMyPosition();
  const [category, setCategory] = useState<Category>('clothing');
  const [title, setTitle] = useState((params.get('title') ?? '').slice(0, 30));
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<LatLng | null>(null);
  const [areaLabel, setAreaLabel] = useState('');
  const [labelAuto, setLabelAuto] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) return <Loading />;
  const flagged = findBannedWords(`${title} ${description}`, d.site.bannedWords);

  const submit = async () => {
    if (!location) return setError('請選擇大概的位置：搜尋地點、使用目前位置，或直接點地圖。');
    const input: NewWantInput = { category, title, description, location, areaLabel };
    const e = validateWant(input);
    if (e) return setError(e);
    if (flagged.length) return setError(`徵求內容包含「${flagged.join('、')}」，這類物品不能在 Myrs 交換`);
    const kw = keyword.trim();
    if (kw.length > 20) return setError('通知關鍵字最多 20 個字');
    setError('');
    setBusy(true);
    const r = await actions.createWant(input);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    if (kw) {
      const s = await actions.saveSearch({ keyword: kw, category, radiusKm: 3, lat: location.lat, lng: location.lng });
      if (!s.ok) toast(`徵求已發布，但關鍵字通知沒有設定成功：${s.error}`, 'info');
    }
    setBusy(false);
    toast('徵求已發布，附近有的人可以回應你');
    router.push(wantPath(r.value));
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/" className="btn btn-ghost -ml-3 px-2">
          <ChevronLeft className="size-4" />
          取消
        </Link>
        <h1 className="text-xl font-bold">發徵求</h1>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        說說你需要什麼，附近剛好有的人可以刊登給你，你再用一般的方式索取。徵求會顯示 {WANT_DAYS} 天，找到了可以提早結束。
      </p>

      <div className="card space-y-5 p-5">
        <div>
          <p className="label">類別</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['clothing', '衣', '衣物、鞋子、包包', Shirt],
                ['food', '食', '即期品、包裝食品、蔬果', Utensils],
              ] as const
            ).map(([v, label, hint, Icon]) => (
              <button
                key={v}
                type="button"
                className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left ${
                  category === v ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => setCategory(v)}
                aria-pressed={category === v}
              >
                <Icon className="size-6 text-violet-600" />
                <span>
                  <span className="block font-bold">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="want-title">
            想要什麼
          </label>
          <input
            id="want-title"
            className="input"
            maxLength={30}
            placeholder="例如：130cm 男童外套、即期鮮奶"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="want-desc">
            說明（選填）
          </label>
          <textarea
            id="want-desc"
            className="input"
            rows={3}
            maxLength={200}
            placeholder="尺寸、數量、什麼時候需要、可以用什麼交換…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="mt-1 text-right text-xs text-slate-400">{description.length}/200</p>
        </div>

        <div>
          <p className="label">大概的位置</p>
          <p className="mb-2 text-xs text-slate-500">別人只會看到約略範圍，不會看到你的確切位置。</p>
          <LocationPicker
            value={location}
            onChange={setLocation}
            label={areaLabel}
            labelAuto={labelAuto}
            onLabel={(text, auto) => {
              setAreaLabel(text);
              setLabelAuto(auto);
            }}
            fallback={pos.point}
            hint="點地圖選擇大概的位置"
          />
        </div>

        <div>
          <label className="label flex items-center gap-1.5" htmlFor="want-keyword">
            <BellPlus className="size-4 text-brand" />
            通知關鍵字（選填）
          </label>
          <input
            id="want-keyword"
            className="input"
            maxLength={20}
            placeholder="例如：外套"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            3 公里內有人刊登包含這個字的東西時，{IS_REMOTE ? '寄 Email 通知你' : '通知你（示範模式不會真的寄信）'}
            。可以在「我的」頁面刪除。
          </p>
        </div>

        {flagged.length > 0 && (
          <p className="rounded-xl bg-rose-50 p-3 text-sm text-m-rose">
            內容包含「{[...new Set(flagged)].join('、')}」，這類物品不能在 Myrs 交換，請修改後再發布。
          </p>
        )}
        {error && <p className="text-sm font-semibold text-m-rose">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">同時最多 {WANT_MAX_OPEN} 則徵求。</p>
          <button className="btn btn-primary min-w-32" onClick={submit} disabled={busy}>
            {busy ? '發布中…' : '發布徵求'}
          </button>
        </div>
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary in a static export.
export default function NewWantPage() {
  return (
    <Suspense>
      <NewWantForm />
    </Suspense>
  );
}
