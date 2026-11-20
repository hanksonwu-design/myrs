'use client';

import { useState } from 'react';
import { Copy, Gift, UserPlus } from 'lucide-react';
import { actions, isParty, nowOf, userById } from '@/lib/store';
import { INVITE_DAYS } from '@/lib/rules';
import { clearInvite, inviteLink } from '@/lib/invite';
import { DAY, timeAgo } from '@/lib/format';
import type { DB, User } from '@/lib/types';
import { ShareActions } from './Share';
import { useToast } from './Providers';

/** 「我的」: my code and the neighbours I invited, or a box to use someone's code. */
export function InviteCard({ d, user }: { d: DB; user: User }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const now = nowOf(d);
  const reward = d.settings.inviteReward;

  const mine = d.invites.filter((i) => i.inviterId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  const done = mine.filter((i) => i.rewardedAt !== null);
  const earned = done.reduce((s, i) => s + i.inviterPoints, 0);
  const invitedBy = d.invites.find((i) => i.inviteeId === user.id);
  const canRedeem =
    !invitedBy &&
    user.createdAt >= now - INVITE_DAYS * DAY &&
    !d.orders.some((o) => o.status === 'completed' && isParty(o, user.id));

  const text = user.inviteCode
    ? reward > 0
      ? `我在用 Myrs，跟大安區的鄰居分享多餘的食物和衣物。用我的邀請碼 ${user.inviteCode} 註冊，完成第一筆交易後我們各得 ${reward} 點：`
      : `我在用 Myrs，跟大安區的鄰居分享多餘的食物和衣物。用我的邀請碼 ${user.inviteCode} 一起加入：`
    : '';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(user.inviteCode ?? '');
      toast('已複製邀請碼');
    } catch {
      toast('無法複製，請自己記下邀請碼', 'error');
    }
  };

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await actions.redeemInvite(code);
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    setCode('');
    toast(reward > 0 ? `已填入 ${r.value} 的邀請碼，完成第一筆交易後你們各得 ${reward} 點` : `已填入 ${r.value} 的邀請碼`);
  };

  return (
    <section className="card p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-bold">
        <UserPlus className="size-4 text-brand" />
        邀請鄰居
      </h2>
      <p className="text-sm text-slate-600">
        {reward > 0
          ? `鄰居用你的邀請碼註冊，並完成第一筆交易（對象不能是你）後，你們各得 ${reward} 點。每月獎勵最多 ${d.settings.monthlyRewardCap} 點。`
          : '附近一起用的人越多，想要的東西就越好找。'}
      </p>

      {user.inviteCode ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="rounded-xl border border-dashed border-brand/40 bg-brand-soft px-4 py-2">
            <p className="text-xs text-slate-500">我的邀請碼</p>
            <p className="font-mono text-2xl font-bold tracking-[0.2em] text-brand">{user.inviteCode}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline py-1.5" onClick={copyCode}>
              <Copy className="size-4" />
              複製邀請碼
            </button>
            <button type="button" className="btn btn-primary py-1.5" onClick={() => setSharing((s) => !s)} aria-expanded={sharing}>
              <Gift className="size-4" />
              傳給鄰居
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">邀請碼還在準備中，請稍後再回來看看。</p>
      )}

      {sharing && user.inviteCode && (
        <div className="mt-3 rounded-2xl bg-slate-50 p-3">
          <p className="mb-2 whitespace-pre-line text-sm text-slate-700">{text}</p>
          <ShareActions url={inviteLink(user.inviteCode)} text={text} />
        </div>
      )}

      {mine.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-sm font-semibold">
            已邀請 {mine.length} 人・{done.length} 人完成第一筆交易
            {earned > 0 && `・共得 ${earned} 點`}
          </p>
          <ul className="mt-1 divide-y divide-slate-100 text-sm">
            {mine.slice(0, 10).map((i) => (
              <li key={i.inviteeId} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate">{userById(d, i.inviteeId)?.name ?? '已刪除的使用者'}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {i.rewardedAt === null
                    ? `${timeAgo(i.createdAt, now)}加入・等第一筆交易`
                    : i.inviterPoints > 0
                      ? `已完成・你得到 ${i.inviterPoints} 點`
                      : '已完成'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invitedBy && (
        <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
          你是 {userById(d, invitedBy.inviterId)?.name ?? '一位鄰居'} 邀請來的。
          {invitedBy.rewardedAt === null
            ? reward > 0
              ? `完成第一筆交易（對象不能是邀請你的人）後，你們各得 ${reward} 點。`
              : ''
            : invitedBy.inviteePoints > 0
              ? `你已經得到 ${invitedBy.inviteePoints} 點邀請獎勵。`
              : ''}
        </p>
      )}

      {canRedeem && (
        <form onSubmit={redeem} className="mt-4 border-t border-slate-100 pt-3">
          <label className="label" htmlFor="invite-code">
            有鄰居的邀請碼嗎？
          </label>
          <div className="flex gap-2">
            <input
              id="invite-code"
              className="input flex-1 font-mono uppercase tracking-widest"
              maxLength={12}
              autoComplete="off"
              placeholder="例如：MAMA88"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn btn-outline" disabled={busy || !code.trim()}>
              送出
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">加入 {INVITE_DAYS} 天內、完成第一筆交易前可以填。</p>
        </form>
      )}
    </section>
  );
}

/** Optional code on the sign-up form, filled in from a shared link. */
export function InviteCodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor="signup-invite">
        邀請碼（選填）
      </label>
      <input
        id="signup-invite"
        className="input font-mono uppercase tracking-widest"
        maxLength={12}
        autoComplete="off"
        placeholder="鄰居給你的 6 碼"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Right after sign-up: use the code, if any. Returns a sentence for the welcome toast, or the error. */
export async function applyInviteAfterSignup(code: string): Promise<{ note: string; error: string | null }> {
  const c = code.trim();
  if (!c) {
    clearInvite();
    return { note: '', error: null };
  }
  const r = await actions.redeemInvite(c);
  clearInvite();
  if (!r.ok) return { note: '', error: `邀請碼沒有套用：${r.error}。可以到「我的」頁面再填一次。` };
  return { note: `已填入 ${r.value} 的邀請碼。`, error: null };
}
