'use client';

import Link from 'next/link';
import { Coins, HandHeart, MapPin, MessageCircle, Repeat, ShieldCheck } from 'lucide-react';
import { useDB } from '@/lib/store';
import { PILOT_NAME } from '@/lib/geo';
import { IS_REMOTE } from '@/lib/backend';
import { asset } from '@/lib/links';

export default function AboutPage() {
  const d = useDB()!;
  const s = d.settings;
  const steps = [
    { icon: <MapPin className="size-5" />, title: '看附近', text: '打開就看到身邊 1～10 公里內的即期食品和二手衣物，地圖上的位置是模糊範圍。' },
    { icon: <HandHeart className="size-5" />, title: '送出索取', text: '免費、點數或以物易物三種方式；點數會先凍結，不會直接扣走。' },
    { icon: <MessageCircle className="size-5" />, title: '接受後聊天', text: '提供者接受後才開聊天室，並顯示精確面交地點，約好時間就出門。' },
    { icon: <ShieldCheck className="size-5" />, title: '雙方確認完成', text: `兩邊都按「面交完成」才算成交；一方確認後 ${s.autoCompleteHours} 小時對方沒回應就自動完成。` },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="rounded-3xl bg-gradient-to-br from-brand to-m-sky p-6 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset('/myrs-logo.png')} alt="Myrs" className="mb-3 h-10 w-auto rounded-xl bg-white/90 p-1.5" />
        <h1 className="text-2xl font-bold">你的我的，都是大家的</h1>
        <p className="mt-2 text-sm opacity-90">
          Myrs 讓鄰居把用不到的即期食品和衣物送給需要的人，少一點浪費，多一點交流。目前在{PILOT_NAME}試點。
        </p>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-bold">怎麼用</h2>
        <ol className="space-y-3">
          {steps.map((x, i) => (
            <li key={x.title} className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">{x.icon}</span>
              <div>
                <p className="font-semibold">
                  {i + 1}. {x.title}
                </p>
                <p className="text-sm text-slate-600">{x.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-1.5 font-bold">
          <Coins className="size-4 text-m-amber" />
          點數規則
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>註冊送 {s.signupBonus} 點；首次刊登送 {s.firstListingReward} 點；首次完成交易送 {s.firstOrderReward} 點。每月獎勵最多 {s.monthlyRewardCap} 點，{s.rewardExpiryMonths} 個月後到期。</li>
          <li>點數只能在 Myrs 內使用，<b>不能兌換現金，也不能轉帳</b>。</li>
          <li>點數交易成交時，提供者付 {Math.round(s.feeRate * 100)}% 手續費（最低 {s.minFee} 點），手續費是平台營運收入。</li>
          <li>免費贈送不會產生點數，完成後提供者得到 1 點「愛心值」，顯示在個人頁。</li>
          <li>新帳號前 {s.newAccountDays} 天，點數交易總額上限 {s.newAccountPointsCap} 點。</li>
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-1.5 font-bold">
          <Repeat className="size-4 text-m-sky" />
          安全與規範
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li>食品必須填到期日和保存方式，過期自動下架。禁止酒類、菸品、藥品、自製生鮮熟食等（完整清單見刊登頁提示）。</li>
          <li>免費索取每天最多 {s.freeDailyLimit} 件；提供者 {s.requestTimeoutHours} 小時內沒回應會自動取消並退回點數。</li>
          <li>同一則刊登被 {s.reportHideThreshold} 人檢舉會先隱藏，等管理員處理。</li>
          <li>面交請選在人多的公共場所。發生問題可以在交易中「提出爭議」，由管理員裁定。</li>
        </ul>
      </section>

      <section className="card p-5 text-sm text-slate-600">
        <h2 className="mb-2 font-bold text-slate-800">公益合作</h2>
        <p>規劃中：營收版上線後，每季公開手續費收入與捐贈明細。合作的食物銀行與社福團體名單確定後公布在這裡。</p>
      </section>

      <section className="card p-5 text-sm text-slate-600">
        <h2 className="mb-2 font-bold text-slate-800">服務條款與隱私權</h2>
        {IS_REMOTE ? (
          <p>
            正式條款會在上線前由法務審閱後公布。帳號、刊登、交易和聊天紀錄存放在 Myrs 的資料庫；手機號碼和 Email
            只用來登入，不會顯示給其他使用者。面交的精確地點只有提供者接受索取後，雙方才看得到。
          </p>
        ) : (
          <p>
            正式條款會在上線前由法務審閱後公布。這個網頁是示範版：所有資料只存在你這台裝置的瀏覽器裡，不會上傳到任何伺服器；清除瀏覽器資料或在「我的
            → 示範工具」重設，就會全部清空。
          </p>
        )}
      </section>

      <div className="text-center">
        <Link href="/" className="btn btn-primary">
          開始逛附近
        </Link>
      </div>
    </div>
  );
}
