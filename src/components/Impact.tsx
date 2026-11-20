'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, HandHeart, Sprout } from 'lucide-react';
import { actions, nowOf } from '@/lib/store';
import { IS_REMOTE } from '@/lib/backend';
import { communityImpactOf, hasImpact, monthLabel, personalImpactOf } from '@/lib/impact';
import type { CommunityImpact, DB, ImpactCounts, User } from '@/lib/types';

/** Same colours as the food and clothing markers on the map. */
export const FOOD_COLOR = '#F0A000';
export const CLOTHING_COLOR = '#00A8E8';

/**
 * The community numbers. Demo mode counts them from the local data; Supabase mode
 * asks the server, again whenever one of the member's own deals completes.
 */
export function useCommunityImpact(d: DB): { data: CommunityImpact | null; error: string } {
  const local = useMemo(() => (IS_REMOTE ? null : communityImpactOf(d, nowOf(d))), [d]);
  const [remote, setRemote] = useState<{ data: CommunityImpact | null; error: string }>({ data: null, error: '' });
  const doneCount = d.orders.filter((o) => o.status === 'completed').length;
  useEffect(() => {
    if (!IS_REMOTE) return;
    let live = true;
    void actions.communityImpact().then((r) => {
      if (live) setRemote((p) => (r.ok ? { data: r.value, error: '' } : { data: p.data, error: r.error }));
    });
    return () => {
      live = false;
    };
  }, [doneCount]);
  return IS_REMOTE ? remote : { data: local, error: '' };
}

/** 「3 份食物、2 件衣物」, leaving out a kind with nothing. */
export function itemsText(c: Pick<ImpactCounts, 'food' | 'clothing'>): string {
  const parts = [c.food ? `${c.food} 份食物` : '', c.clothing ? `${c.clothing} 件衣物` : ''].filter(Boolean);
  return parts.join('、') || '0 件';
}

/** One line on the home page, linking to the board. Hidden until there is something to show. */
export function ImpactStrip({ d }: { d: DB }) {
  const { data } = useCommunityImpact(d);
  if (!data || !hasImpact(data.total)) return null;
  const month = hasImpact(data.month);
  const c = month ? data.month : data.total;
  return (
    <Link
      href="/impact"
      className="mb-4 flex items-center gap-3 rounded-2xl border border-brand/20 bg-brand-soft/60 px-4 py-3 text-sm transition hover:bg-brand-soft"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-brand">
        <Sprout className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-slate-700">
        {month ? '這個月' : '到目前為止'}，鄰居分享了 <b className="text-brand-dark">{itemsText(c)}</b>
        <span className="text-slate-500">・{c.neighbours} 位鄰居參與</span>
      </span>
      <span className="flex shrink-0 items-center text-xs font-semibold text-brand-dark">
        社區成果
        <ChevronRight className="size-4" />
      </span>
    </Link>
  );
}

export function Stat({ value, unit, label, color }: { value: number; unit: string; label: string; color?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        {color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-bold text-slate-800">
        {value.toLocaleString()}
        <span className="ml-1 text-sm font-semibold text-slate-500">{unit}</span>
      </p>
    </div>
  );
}

/** A member's own numbers, for 「我的」 and the board. */
export function MyImpact({ d, user, link = true }: { d: DB; user: User; link?: boolean }) {
  const p = personalImpactOf(d, user.id);
  const gave = p.gaveFood + p.gaveClothing;
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-bold">
          <HandHeart className="size-5 text-brand" />
          我的分享成果
        </h2>
        {link && (
          <Link href="/impact" className="flex items-center text-sm font-semibold text-brand">
            社區成果
            <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
      {gave + p.received === 0 ? (
        <p className="text-sm text-slate-500">完成第一筆交易後，這裡會記下你分享出去的東西和幫到的鄰居。</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={gave} unit="件" label="分享出去" />
            <Stat value={p.helped} unit="位" label="幫到的鄰居" />
            <Stat value={p.received} unit="件" label="從鄰居收到" />
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {gave > 0 && <>你分享了 {itemsText({ food: p.gaveFood, clothing: p.gaveClothing })}{p.gaveFree > 0 && `，其中 ${p.gaveFree} 件是免費送出的`}。</>}
            {p.wantsFound > 0 && <>有 {p.wantsFound} 則徵求靠鄰居找到了。</>}
            {gave > 0 ? '謝謝你讓東西繼續被用到！' : '下次有用不到的東西，也可以刊登分享給鄰居。'}
          </p>
        </>
      )}
    </section>
  );
}

/** Stacked columns for the last six months, with totals on top and a table under. */
export function MonthlyChart({ months }: { months: CommunityImpact['months'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => m.food + m.clothing));
  const H = 140; // px for the tallest column
  const px = (n: number) => (n ? Math.max(4, Math.round((n / max) * H)) : 0);

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-slate-600" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: FOOD_COLOR }} />
          食物
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: CLOTHING_COLOR }} />
          衣物
        </span>
      </div>
      <div className="relative grid grid-cols-6 border-b border-slate-200" style={{ height: H + 24 }} role="list" aria-label="最近六個月的分享件數">
        {months.map((m, i) => {
          const total = m.food + m.clothing;
          const tip = `${monthLabel(m.month)}：${total ? itemsText(m) : '沒有完成的交易'}`;
          return (
            <div
              key={m.month}
              role="listitem"
              tabIndex={0}
              aria-label={tip}
              className="relative flex flex-col items-center justify-end outline-none focus-visible:bg-slate-50"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span className="mb-1 text-xs font-semibold text-slate-600">{total || ''}</span>
              {/* 2px surface gap between the parts; rounded only at the top end. */}
              <div className="flex w-6 flex-col gap-[2px]">
                {m.clothing > 0 && (
                  <div className="rounded-t-[4px]" style={{ height: px(m.clothing), background: CLOTHING_COLOR }} />
                )}
                {m.food > 0 && (
                  <div
                    className={m.clothing ? '' : 'rounded-t-[4px]'}
                    style={{ height: px(m.food), background: FOOD_COLOR }}
                  />
                )}
              </div>
              {hover === i && (
                <div
                  className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-white shadow ${
                    i === 0 ? 'left-0' : i === months.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                  }`}
                >
                  {tip}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 grid grid-cols-6 text-center text-xs text-slate-500">
        {months.map((m) => (
          <span key={m.month}>{monthLabel(m.month)}</span>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-500">看數字表格</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1 font-semibold">月份</th>
              <th className="py-1 font-semibold">食物（份）</th>
              <th className="py-1 font-semibold">衣物（件）</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-slate-100">
                <td className="py-1">{m.month.replace('-', '/')}</td>
                <td className="py-1">{m.food}</td>
                <td className="py-1">{m.clothing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
