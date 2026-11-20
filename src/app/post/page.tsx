'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, Check, ChevronLeft, ImagePlus, Shirt, Utensils, X } from 'lucide-react';
import { actions, nowOf, useDB, validateListing, type NewListingInput } from '@/lib/store';
import { calcFee, CATEGORIES, findBannedWords, MODE_LABEL, STORAGE_OPTIONS } from '@/lib/rules';
import { ymdLocal } from '@/lib/format';
import { compressImage } from '@/lib/image';
import type { Category, LatLng, Listing, Mode } from '@/lib/types';
import { LocationPicker } from '@/components/LocationPicker';
import { ListingCard } from '@/components/ListingVisuals';
import { Loading } from '@/components/ui';
import { useMyPosition, useRequireLogin } from '@/components/hooks';
import { useToast } from '@/components/Providers';
import { listingPath } from '@/lib/links';

const STEPS = ['照片', '類別', '內容', '交易方式', '地點時段', '預覽'];

export default function PostPage() {
  const d = useDB()!;
  const user = useRequireLogin(d);
  const router = useRouter();
  const toast = useToast();
  const pos = useMyPosition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState<Omit<NewListingInput, 'location'> & { location: LatLng | null }>({
    category: 'food',
    sub: CATEGORIES.food.subs[0],
    title: '',
    description: '',
    quantity: 1,
    mode: 'free',
    pricePoints: 20,
    swapWish: '',
    expiresOn: null,
    storage: null,
    photos: [],
    location: null,
    areaLabel: '',
    timeSlots: '平日 18:00 後、週末全天',
  });
  // The place name follows the pin until the user types their own.
  const [labelAuto, setLabelAuto] = useState(true);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  if (!user) return <Loading />;
  const today = ymdLocal(nowOf(d));
  const location = f.location ?? pos.point;
  const input: NewListingInput = { ...f, location };
  const flagged = findBannedWords(`${f.title} ${f.description} ${f.swapWish}`);

  const stepError = (s: number): string | null => {
    if (s === 2) {
      if (f.title.trim().length < 2) return '標題至少 2 個字';
      if (f.category === 'food' && !f.expiresOn) return '食品必須填到期日';
      if (f.category === 'food' && f.expiresOn && f.expiresOn < today) return '到期日不能早於今天';
      if (f.category === 'food' && !f.storage) return '請選擇保存方式';
      if (f.quantity < 1 || f.quantity > 99) return '數量要在 1 到 99 之間';
    }
    if (s === 3) {
      if (f.mode === 'points' && (f.pricePoints < 1 || f.pricePoints > 5000)) return '點數要是 1 到 5,000';
      if (f.mode === 'swap' && !f.swapWish.trim()) return '請寫下想交換的東西';
    }
    if (s === 4) {
      if (!f.location) return '請選擇面交地點：搜尋地點、使用目前位置，或直接點地圖。';
      if (!f.areaLabel.trim()) return '請填寫地點名稱';
      if (!f.timeSlots.trim()) return '請填寫可面交時段';
    }
    return null;
  };

  const next = () => {
    const e = stepError(step);
    setError(e ?? '');
    if (!e) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    try {
      const room = 6 - f.photos.length;
      const list = await Promise.all([...files].slice(0, room).map((file) => compressImage(file)));
      set('photos', [...f.photos, ...list]);
      if (files.length > room) toast('照片最多 6 張', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : '照片處理失敗', 'error');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    const e = validateListing(input, today);
    if (e) return setError(e);
    setPublishing(true);
    const r = await actions.createListing(input);
    setPublishing(false);
    if (!r.ok) return setError(r.error);
    const { status, reward } = r.value;
    toast(
      status === 'pending_review'
        ? '已送出。內容有需要確認的字詞，審核通過後才會公開。'
        : `刊登成功！${reward ? `獲得首次刊登獎勵 ${reward} 點` : ''}`,
      status === 'pending_review' ? 'info' : 'success',
    );
    router.push(listingPath(r.value.id));
  };

  const preview: Listing = {
    ...input,
    id: 'preview',
    ownerId: user.id,
    remaining: f.quantity,
    status: 'active',
    flaggedWords: [],
    createdAt: nowOf(d),
    pricePoints: f.mode === 'points' ? f.pricePoints : 0,
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        {step > 0 ? (
          <button className="btn btn-ghost -ml-3 px-2" onClick={() => (setError(''), setStep(step - 1))}>
            <ChevronLeft className="size-4" />
            上一步
          </button>
        ) : (
          <Link href="/" className="btn btn-ghost -ml-3 px-2">
            <ChevronLeft className="size-4" />
            取消
          </Link>
        )}
        <h1 className="text-xl font-bold">發布分享</h1>
        <span className="ml-auto text-sm text-slate-500">
          {step + 1} / {STEPS.length}
        </span>
      </div>

      <ol className="mb-5 grid grid-cols-6 gap-1" aria-label="步驟">
        {STEPS.map((s, i) => (
          <li key={s} className="text-center">
            <div className={`h-1.5 rounded-full ${i <= step ? 'bg-brand' : 'bg-slate-200'}`} />
            <span className={`mt-1 hidden text-xs sm:block ${i === step ? 'font-bold text-brand-dark' : 'text-slate-400'}`}>
              {s}
            </span>
          </li>
        ))}
      </ol>

      <div className="card space-y-5 p-5">
        {step === 0 && (
          <>
            <div>
              <h2 className="text-lg font-bold">拍幾張照片</h2>
              <p className="text-sm text-slate-500">最多 6 張。清楚的照片比較快被索取；沒有照片也可以先跳過。</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {f.photos.map((p, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-xl border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt={`照片 ${i + 1}`} className="size-full object-cover" />
                  <button
                    className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-1 text-white"
                    onClick={() => set('photos', f.photos.filter((_, j) => j !== i))}
                    aria-label="移除照片"
                  >
                    <X className="size-3.5" />
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-1 left-1 rounded bg-slate-900/70 px-1.5 text-[11px] text-white">封面</span>
                  )}
                </div>
              ))}
              {f.photos.length < 6 && (
                <button
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-brand hover:text-brand"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  {busy ? '處理中…' : f.photos.length ? <ImagePlus className="size-6" /> : <Camera className="size-6" />}
                  <span className="text-xs">{f.photos.length ? '再加一張' : '拍照或選照片'}</span>
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void addPhotos(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-lg font-bold">選擇類別</h2>
            <div className="grid grid-cols-2 gap-3">
              {(['food', 'clothing'] as Category[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setF((x) => ({ ...x, category: c, sub: CATEGORIES[c].subs[0] }))}
                  aria-pressed={f.category === c}
                  className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-5 ${
                    f.category === c ? 'border-brand bg-brand-soft' : 'border-slate-200'
                  }`}
                >
                  {c === 'food' ? <Utensils className="size-7 text-m-amber" /> : <Shirt className="size-7 text-m-sky" />}
                  <span className="text-lg font-bold">{CATEGORIES[c].label}</span>
                  <span className="text-xs text-slate-500">{c === 'food' ? '即期品、包裝食品、蔬果' : '衣物、鞋子、包包'}</span>
                </button>
              ))}
            </div>
            <div>
              <p className="label">子類別</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES[f.category].subs.map((s) => (
                  <button key={s} className={`chip ${f.sub === s ? 'chip-on' : 'chip-off'}`} onClick={() => set('sub', s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
              {f.category === 'food'
                ? '只接受未拆封的包裝食品、即期品、生鮮蔬果。不接受自製熟食、酒類、保健食品、嬰兒配方奶粉。'
                : '不接受貼身衣物（內衣褲）與仿冒品。'}
            </p>
            <p className="text-xs text-slate-400">住、行、育、樂會在之後的階段開放。</p>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-lg font-bold">描述一下</h2>
            <div>
              <label className="label" htmlFor="title">
                標題
              </label>
              <input
                id="title"
                className="input"
                maxLength={40}
                placeholder={f.category === 'food' ? '例如：優格 6 入（明天到期）' : '例如：女童洋裝 120cm 兩件'}
                value={f.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="desc">
                說明（選填）
              </label>
              <textarea
                id="desc"
                className="input"
                rows={4}
                maxLength={500}
                placeholder="狀況、尺寸、為什麼不需要了…"
                value={f.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="qty">
                  數量
                </label>
                <input
                  id="qty"
                  type="number"
                  min={1}
                  max={99}
                  className="input"
                  value={f.quantity}
                  onChange={(e) => set('quantity', Math.floor(Number(e.target.value) || 0))}
                />
              </div>
              {f.category === 'food' && (
                <div>
                  <label className="label" htmlFor="exp">
                    到期日
                  </label>
                  <input
                    id="exp"
                    type="date"
                    min={today}
                    className="input"
                    value={f.expiresOn ?? ''}
                    onChange={(e) => set('expiresOn', e.target.value || null)}
                  />
                </div>
              )}
            </div>
            {f.category === 'food' && (
              <div>
                <p className="label">保存方式</p>
                <div className="flex gap-2">
                  {STORAGE_OPTIONS.map((s) => (
                    <button key={s} className={`chip ${f.storage === s ? 'chip-on' : 'chip-off'}`} onClick={() => set('storage', s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {flagged.length > 0 && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                內容包含「{[...new Set(flagged)].join('、')}」，送出後會先由管理員審核。
              </p>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-lg font-bold">怎麼交換？</h2>
            <div className="space-y-2">
              {(['free', 'points', 'swap'] as Mode[]).map((m) => (
                <label
                  key={m}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 ${
                    f.mode === m ? 'border-brand bg-brand-soft/50' : 'border-slate-200'
                  }`}
                >
                  <input type="radio" name="mode" className="mt-1 accent-brand" checked={f.mode === m} onChange={() => set('mode', m)} />
                  <span>
                    <span className="font-bold">{MODE_LABEL[m]}</span>
                    <span className="block text-sm text-slate-500">
                      {m === 'free' && '直接送給需要的人。完成後你會得到 1 點愛心值（不是點數）。'}
                      {m === 'points' && `對方付點數給你，成交時平台收 ${Math.round(d.settings.feeRate * 100)}% 手續費（最低 ${d.settings.minFee} 點）。`}
                      {m === 'swap' && '寫下你想換的東西，對方提出交換。'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {f.mode === 'points' && (
              <div>
                <label className="label" htmlFor="price">
                  需要幾點？（建議 1 點約等於 1 元）
                </label>
                <input
                  id="price"
                  type="number"
                  min={1}
                  max={5000}
                  className="input"
                  value={f.pricePoints}
                  onChange={(e) => set('pricePoints', Math.floor(Number(e.target.value) || 0))}
                />
                <p className="mt-1 text-xs text-slate-500">
                  成交後你實收 {Math.max(0, f.pricePoints - calcFee(f.pricePoints, d.settings))} 點
                </p>
              </div>
            )}
            {f.mode === 'swap' && (
              <div>
                <label className="label" htmlFor="wish">
                  想換什麼？
                </label>
                <input
                  id="wish"
                  className="input"
                  maxLength={60}
                  placeholder="例如：洗衣精或衛生紙"
                  value={f.swapWish}
                  onChange={(e) => set('swapWish', e.target.value)}
                />
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <div>
              <h2 className="text-lg font-bold">在哪裡面交？</h2>
              <p className="text-sm text-slate-500">其他人只會看到約 200 公尺的範圍，你接受索取後對方才看得到精確位置。</p>
            </div>
            <LocationPicker
              value={f.location}
              onChange={(p) => set('location', p)}
              label={f.areaLabel}
              labelAuto={labelAuto}
              onLabel={(text, auto) => {
                set('areaLabel', text);
                setLabelAuto(auto);
              }}
              fallback={pos.point}
            />
            <div>
              <label className="label" htmlFor="slots">
                可面交時段
              </label>
              <input
                id="slots"
                className="input"
                maxLength={40}
                value={f.timeSlots}
                onChange={(e) => set('timeSlots', e.target.value)}
              />
            </div>
            <p className="text-xs text-slate-500">建議約在公共場所，例如捷運站出口、超商門口。</p>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-lg font-bold">確認後送出</h2>
            <div className="mx-auto w-56">
              <ListingCard d={d} listing={preview} distance={0} />
            </div>
            <ul className="space-y-1 text-sm text-slate-600">
              <li className="flex gap-2">
                <Check className="size-4 text-brand" />
                {f.category === 'food' ? `到期日 ${f.expiresOn}，${f.storage}保存` : `${f.sub}`}
              </li>
              <li className="flex gap-2">
                <Check className="size-4 text-brand" />
                {f.areaLabel}・{f.timeSlots}
              </li>
              <li className="flex gap-2">
                <Check className="size-4 text-brand" />
                {f.photos.length} 張照片
              </li>
            </ul>
          </>
        )}

        {error && <p className="text-sm font-semibold text-m-rose">{error}</p>}

        <div className="flex justify-end gap-2">
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary min-w-32" onClick={next} disabled={busy}>
              {step === 0 && !f.photos.length ? '先跳過' : '下一步'}
            </button>
          ) : (
            <button className="btn btn-primary min-w-32" onClick={publish} disabled={publishing}>
              {publishing ? (f.photos.length ? '上傳照片中…' : '發布中…') : '確認發布'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
