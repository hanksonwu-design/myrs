'use client';

import Link from 'next/link';
import { PackagePlus, Sparkles, Sprout } from 'lucide-react';
import { currentUser, nowOf, useDB } from '@/lib/store';
import { PILOT_NAME } from '@/lib/geo';
import { formatDate } from '@/lib/format';
import { hasImpact, monthLabel, taipeiMonth } from '@/lib/impact';
import { CLOTHING_COLOR, FOOD_COLOR, itemsText, MonthlyChart, MyImpact, Stat, useCommunityImpact } from '@/components/Impact';
import { ShareButton } from '@/components/Share';
import { Empty, Loading, PageTitle } from '@/components/ui';

export default function ImpactPage() {
  const d = useDB()!;
  const me = currentUser(d);
  const { data, error } = useCommunityImpact(d);

  if (!data) {
    return error ? (
      <p className="card mx-auto max-w-2xl p-6 text-center text-sm text-slate-500">暫時無法載入社區成果，請稍後再試。</p>
    ) : (
      <Loading />
    );
  }

  const { month, total } = data;
  const thisMonth = monthLabel(taipeiMonth(nowOf(d)));
  const shareText = hasImpact(month)
    ? `${PILOT_NAME}的鄰居這個月在 Myrs 分享了 ${itemsText(month)}，有 ${month.neighbours} 位鄰居參與。用不到的東西也可以分享出來：`
    : `${PILOT_NAME}的鄰居在 Myrs 已經分享了 ${itemsText(total)}，有 ${total.neighbours} 位鄰居參與。用不到的東西也可以分享出來：`;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-2">
        <PageTitle sub={`${PILOT_NAME}的鄰居一起做到的事`}>社區成果</PageTitle>
        {hasImpact(total) && <ShareButton path="/impact" title="分享社區成果" text={shareText} />}
      </div>

      {!hasImpact(total) ? (
        <Empty
          icon={<Sprout className="size-6" />}
          title="還沒有完成的交易"
          text="鄰居第一次完成分享後，這裡會開始累積大家一起送出的食物和衣物。"
          action={
            <Link href="/post" className="btn btn-primary">
              <PackagePlus className="size-4" />
              刊登第一件
            </Link>
          }
        />
      ) : (
        <>
          <section className="card p-5">
            <h2 className="mb-3 font-bold">這個月（{thisMonth}）</h2>
            {hasImpact(month) ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat value={month.food} unit="份" label="食物" color={FOOD_COLOR} />
                <Stat value={month.clothing} unit="件" label="衣物" color={CLOTHING_COLOR} />
                <Stat value={month.neighbours} unit="位" label="參與的鄰居" />
                <Stat value={month.free} unit="件" label="免費送出" />
              </div>
            ) : (
              <p className="text-sm text-slate-500">這個月還沒有完成的交易，你可以當第一個。</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-bold">累計</h2>
            {data.since && <p className="mb-3 text-xs text-slate-500">從 {formatDate(data.since)} 第一筆交易到現在</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={total.food} unit="份" label="食物" color={FOOD_COLOR} />
              <Stat value={total.clothing} unit="件" label="衣物" color={CLOTHING_COLOR} />
              <Stat value={total.neighbours} unit="位" label="參與的鄰居" />
              <Stat value={data.wantsFound} unit="則" label="徵求找到了" />
            </div>
            {total.free > 0 && (
              <p className="mt-3 text-sm text-slate-600">
                其中 {total.free} 件是鄰居免費送出的。
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-bold">最近六個月</h2>
            <MonthlyChart months={data.months} />
          </section>
        </>
      )}

      {me ? (
        <MyImpact d={d} user={me} link={false} />
      ) : (
        <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-slate-600">一起加入，讓用不到的東西留在社區裡繼續被用到。</p>
          <Link href="/login?next=%2Fimpact" className="btn btn-primary">
            <Sparkles className="size-4" />
            免費註冊
          </Link>
        </section>
      )}

      <section className="text-xs leading-relaxed text-slate-500">
        <p className="font-semibold">怎麼計算</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>只算已經完成的交易：雙方都確認、一方確認後自動完成，或管理團隊判定成立。取消的不算。</li>
          <li>每筆交易算一件（每次索取就是拿走一件）。食物以「份」、衣物以「件」計。</li>
          <li>「徵求找到了」是發徵求的人，跟回應的鄰居完成了交易。</li>
          <li>月份以台灣時間計算。這裡只有總數，不會顯示是誰、拿了什麼。</li>
        </ul>
      </section>
    </div>
  );
}
