'use client';

import Link from 'next/link';
import { ChevronLeft, Coins, Info, Lock } from 'lucide-react';
import { balanceOf, heldOf, orderById, useDB } from '@/lib/store';
import { formatDate, formatDateTime } from '@/lib/format';
import type { LedgerEntry } from '@/lib/types';
import { Loading } from '@/components/ui';
import { useRequireLogin } from '@/components/hooks';

const TYPE_LABEL: Record<LedgerEntry['type'], string> = {
  signup_bonus: '新手點數',
  reward: '平台獎勵',
  hold: '索取',
  release: '退回',
  transfer_in: '點數收入',
  fee: '手續費',
  adjust: '管理員調整',
};

export default function WalletPage() {
  const d = useDB()!;
  const user = useRequireLogin(d);
  if (!user) return <Loading />;
  const entries = d.ledger.filter((e) => e.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  const held = heldOf(d, user.id);

  const holdState = (e: LedgerEntry) => {
    const o = e.orderId ? orderById(d, e.orderId) : null;
    if (!o) return '';
    if (o.status === 'completed') return '已支付';
    if (o.status === 'cancelled') return '已退回';
    return '凍結中';
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/me" className="btn btn-ghost -ml-3 px-2">
        <ChevronLeft className="size-4" />
        我的
      </Link>
      <section className="rounded-3xl bg-gradient-to-br from-m-amber to-amber-500 p-6 text-white">
        <p className="flex items-center gap-1 text-sm opacity-90">
          <Coins className="size-4" />
          可用點數
        </p>
        <p className="mt-1 text-4xl font-bold">{balanceOf(d, user.id)}</p>
        {held > 0 && (
          <p className="mt-2 flex items-center gap-1 text-sm opacity-90">
            <Lock className="size-3.5" />
            另有 {held} 點凍結中（等待交易完成）
          </p>
        )}
      </section>

      <section className="card flex gap-3 p-4 text-sm text-slate-600">
        <Info className="mt-0.5 size-4 shrink-0 text-brand" />
        <ul className="list-disc space-y-1 pl-4">
          <li>點數只能在 Myrs 內使用，不能兌換現金，也不能轉帳給他人。</li>
          <li>索取時先凍結，雙方確認完成才轉給對方；取消會全數退回。</li>
          <li>
            點數交易成交時，提供者付 {Math.round(d.settings.feeRate * 100)}% 手續費（最低 {d.settings.minFee} 點）。
          </li>
          <li>獎勵點數 {d.settings.rewardExpiryMonths} 個月未使用會到期；每月獎勵上限 {d.settings.monthlyRewardCap} 點。</li>
          <li>購買點數會在營收版開放。</li>
        </ul>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 p-4 font-bold">點數明細</h2>
        <ul className="divide-y divide-slate-100">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 p-4 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {TYPE_LABEL[e.type]}
                  {e.type === 'hold' && (
                    <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{holdState(e)}</span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">{e.note}</p>
                <p className="text-xs text-slate-400">
                  {formatDateTime(e.createdAt)}
                  {e.expiresAt ? `・${formatDate(e.expiresAt)} 到期` : ''}
                </p>
              </div>
              <span className={`text-base font-bold ${e.amount > 0 ? 'text-brand-dark' : 'text-slate-700'}`}>
                {e.amount > 0 ? '+' : ''}
                {e.amount}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
