'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Flag, Gauge, ListChecks, ScrollText, Settings2, Users } from 'lucide-react';
import {
  actions,
  balanceOf,
  heldOf,
  listingById,
  nowOf,
  OPEN_STATUSES,
  ratingOf,
  useDB,
  userById,
} from '@/lib/store';
import { activeWithin } from '@/lib/search';
import { PILOT_CENTER, PILOT_NAME } from '@/lib/geo';
import { formatDateTime, maskPhone, timeAgo } from '@/lib/format';
import { LISTING_STATUS_LABEL, MODE_LABEL } from '@/lib/rules';
import type { DB, Settings } from '@/lib/types';
import { ListingThumb } from '@/components/ListingVisuals';
import { Avatar, Loading, Modal, ModeBadge } from '@/components/ui';
import { useRequireLogin } from '@/components/hooks';
import { useToast } from '@/components/Providers';
import { listingPath, userPath } from '@/lib/links';

type Tab = 'dash' | 'listings' | 'reports' | 'disputes' | 'users' | 'settings' | 'log';

const GATE_LISTINGS = 30;
const GATE_RATE = 0.4;

export default function AdminPage() {
  const d = useDB()!;
  const user = useRequireLogin(d);
  const [tab, setTab] = useState<Tab>('dash');
  if (!user) return <Loading />;
  if (user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-slate-500">只有管理員可以進入後台。</p>
        <p className="mt-1 text-sm text-slate-400">示範：到「我的 → 示範工具」切換成「Myrs 管理員」。</p>
        <Link href="/me" className="btn btn-outline mt-4">
          前往我的
        </Link>
      </div>
    );
  }

  const pendingListings = d.listings.filter((l) => l.status === 'pending_review').length;
  const openReportTargets = new Set(d.reports.filter((r) => r.status === 'open').map((r) => r.targetId)).size;
  const disputes = d.orders.filter((o) => o.status === 'disputed').length;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'dash', label: '儀表板', icon: <Gauge className="size-4" /> },
    { id: 'listings', label: '刊登審核', icon: <ListChecks className="size-4" />, badge: pendingListings },
    { id: 'reports', label: '檢舉', icon: <Flag className="size-4" />, badge: openReportTargets },
    { id: 'disputes', label: '爭議', icon: <AlertTriangle className="size-4" />, badge: disputes },
    { id: 'users', label: '使用者', icon: <Users className="size-4" /> },
    { id: 'settings', label: '參數', icon: <Settings2 className="size-4" /> },
    { id: 'log', label: '紀錄', icon: <ScrollText className="size-4" /> },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-3 text-xl font-bold sm:text-2xl">管理後台</h1>
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`chip shrink-0 gap-1.5 ${tab === t.id ? 'chip-on' : 'chip-off'}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
            {!!t.badge && (
              <span className="min-w-5 rounded-full bg-m-rose px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {tab === 'dash' && <Dashboard d={d} />}
      {tab === 'listings' && <ListingReview d={d} />}
      {tab === 'reports' && <Reports d={d} />}
      {tab === 'disputes' && <Disputes d={d} />}
      {tab === 'users' && <UserAdmin d={d} />}
      {tab === 'settings' && <SettingsForm d={d} />}
      {tab === 'log' && <Log d={d} />}
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Gate({ label, value, target, display }: { label: string; value: number; target: number; display: string }) {
  const pass = value >= target;
  const pct = Math.min(100, Math.round((value / target) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className={pass ? 'font-bold text-brand-dark' : 'text-slate-600'}>
          {display}
          {pass && <CheckCircle2 className="ml-1 inline size-4" />}
        </span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${pass ? 'bg-brand' : 'bg-m-amber'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Dashboard({ d }: { d: DB }) {
  const members = d.users.filter((u) => u.status !== 'deleted' && u.role !== 'admin');
  const active = d.listings.filter((l) => l.status === 'active');
  const within1 = activeWithin(d, PILOT_CENTER, 1);
  const completed = d.orders.filter((o) => o.status === 'completed').length;
  const cancelled = d.orders.filter((o) => o.status === 'cancelled').length;
  const open = d.orders.filter((o) => OPEN_STATUSES.includes(o.status)).length;
  const rate = completed + cancelled ? completed / (completed + cancelled) : 0;
  const fees = -d.ledger.filter((e) => e.type === 'fee').reduce((s, e) => s + e.amount, 0);
  const issued = d.ledger
    .filter((e) => e.type === 'signup_bonus' || e.type === 'reward' || e.type === 'adjust')
    .reduce((s, e) => s + e.amount, 0);
  const circulating = d.users.reduce((s, u) => s + balanceOf(d, u.id) + heldOf(d, u.id), 0);
  const love = d.users.reduce((s, u) => s + u.loveScore, 0);
  const byMode = (['free', 'points', 'swap'] as const).map((m) => ({
    m,
    n: d.orders.filter((o) => o.mode === m && o.status === 'completed').length,
  }));

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="font-bold">試點門檻：{PILOT_NAME}</h2>
        <p className="mb-4 text-sm text-slate-500">兩項都達標才進入下一階段（開發文件第 11 節）。</p>
        <div className="space-y-4">
          <Gate
            label="試點中心 1 公里內的有效刊登"
            value={within1}
            target={GATE_LISTINGS}
            display={`${within1} / ${GATE_LISTINGS} 則`}
          />
          <Gate
            label="索取完成率"
            value={rate}
            target={GATE_RATE}
            display={`${Math.round(rate * 100)}% / ${GATE_RATE * 100}%`}
          />
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="會員" value={members.length} sub={`商家 ${members.filter((u) => u.merchant).length}`} />
        <Stat label="上架中刊登" value={active.length} sub={`待審 ${d.listings.filter((l) => l.status === 'pending_review').length}`} />
        <Stat label="進行中交易" value={open} sub={`完成 ${completed}・取消 ${cancelled}`} />
        <Stat
          label="完成交易方式"
          value={completed}
          sub={byMode.map((x) => `${MODE_LABEL[x.m]} ${x.n}`).join('・')}
        />
        <Stat label="手續費收入" value={`${fees} 點`} sub="點數交易 10% 手續費" />
        <Stat label="流通點數" value={circulating} sub="所有人可用＋凍結" />
        <Stat label="平台發出點數" value={issued} sub="新手、獎勵、調整" />
        <Stat label="累計愛心值" value={love} sub="免費贈送完成後累積" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- listing review

function ListingReview({ d }: { d: DB }) {
  const toast = useToast();
  const list = d.listings.filter((l) => l.status === 'pending_review');
  if (!list.length) return <p className="card p-6 text-center text-sm text-slate-500">沒有待審核的刊登。</p>;
  return (
    <ul className="space-y-3">
      {list.map((l) => {
        const owner = userById(d, l.ownerId);
        const reports = d.reports.filter((r) => r.targetId === l.id && r.status === 'open');
        return (
          <li key={l.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <ListingThumb listing={l} className="size-16 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Link href={listingPath(l.id)} className="font-bold hover:underline">
                {l.title}
              </Link>
              <p className="text-xs text-slate-500">
                {owner?.name}・{timeAgo(l.createdAt, nowOf(d))}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{l.description}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {l.flaggedWords.length > 0 && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-m-rose">命中禁售詞：{l.flaggedWords.join('、')}</span>
                )}
                {reports.length > 0 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">被 {reports.length} 人檢舉而隱藏</span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-primary py-1.5"
                onClick={async () => {
                  const r = await actions.adminSetListingStatus(l.id, 'active');
                  toast(r.ok ? '已核准上架' : r.error, r.ok ? 'success' : 'error');
                }}
              >
                核准
              </button>
              <button
                className="btn btn-danger py-1.5"
                onClick={async () => {
                  const r = await actions.adminSetListingStatus(l.id, 'removed');
                  toast(r.ok ? '已下架' : r.error, r.ok ? 'success' : 'error');
                }}
              >
                下架
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- reports

function Reports({ d }: { d: DB }) {
  const toast = useToast();
  const open = d.reports.filter((r) => r.status === 'open').sort((a, b) => b.createdAt - a.createdAt);
  const groups = new Map<string, typeof open>();
  for (const r of open) groups.set(r.targetId, [...(groups.get(r.targetId) ?? []), r]);
  if (!groups.size) return <p className="card p-6 text-center text-sm text-slate-500">沒有待處理的檢舉。</p>;

  const run = async (id: string, action: 'dismiss' | 'remove_listing' | 'suspend_user', done: string) => {
    const r = await actions.adminHandleReport(id, action);
    toast(r.ok ? done : r.error, r.ok ? 'success' : 'error');
  };

  return (
    <ul className="space-y-3">
      {[...groups.values()].map((rs) => {
        const first = rs[0];
        const l = first.targetType === 'listing' ? listingById(d, first.targetId) : null;
        const target = first.targetType === 'user' ? userById(d, first.targetId) : l ? userById(d, l.ownerId) : null;
        return (
          <li key={first.targetId} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {first.targetType === 'listing' ? '刊登' : '使用者'}
              </span>
              {l ? (
                <Link href={listingPath(l.id)} className="font-bold hover:underline">
                  {l.title}
                </Link>
              ) : (
                <Link href={userPath(target?.id)} className="font-bold hover:underline">
                  {target?.name}
                </Link>
              )}
              {l && <span className="text-xs text-slate-500">（{LISTING_STATUS_LABEL[l.status]}・{target?.name}）</span>}
              <span className="ml-auto text-xs text-slate-400">{rs.length} 筆檢舉</span>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {rs.map((r) => (
                <li key={r.id} className="text-slate-600">
                  <b>{r.reporterId === 'system' ? '系統偵測' : userById(d, r.reporterId)?.name}</b>：{r.reason}
                  <span className="ml-1 text-xs text-slate-400">{timeAgo(r.createdAt, nowOf(d))}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-outline py-1.5" onClick={() => run(first.id, 'dismiss', '已駁回')}>
                駁回
              </button>
              {l && (
                <button className="btn btn-danger py-1.5" onClick={() => run(first.id, 'remove_listing', '已下架刊登')}>
                  下架刊登
                </button>
              )}
              {target && target.role !== 'admin' && target.status === 'active' && (
                <button
                  className="btn btn-danger py-1.5"
                  onClick={() => confirm(`確定停權「${target.name}」？`) && run(first.id, 'suspend_user', '已停權')}
                >
                  停權 {target.name}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- disputes

function Disputes({ d }: { d: DB }) {
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const list = d.orders.filter((o) => o.status === 'disputed');
  if (!list.length) return <p className="card p-6 text-center text-sm text-slate-500">沒有進行中的爭議。</p>;
  return (
    <ul className="space-y-3">
      {list.map((o) => {
        const l = listingById(d, o.listingId);
        const req = userById(d, o.requesterId);
        const pro = userById(d, o.providerId);
        const msgs = d.messages
          .filter((m) => m.orderId === o.id)
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-6);
        const resolve = async (outcome: 'complete' | 'refund') => {
          const r = await actions.adminResolveDispute(o.id, outcome, notes[o.id] ?? '');
          toast(r.ok ? (outcome === 'complete' ? '已裁定交易成立' : '已裁定退回') : r.error, r.ok ? 'success' : 'error');
        };
        return (
          <li key={o.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{l?.title}</span>
              {l && <ModeBadge listing={l} />}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              索取者 <b>{req?.name}</b>・提供者 <b>{pro?.name}</b>
              {o.mode === 'points' && `・凍結 ${o.points} 點`}
            </p>
            <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
              <b>{userById(d, o.disputeBy)?.name}</b> 提出：{o.disputeReason}
            </p>
            {msgs.length > 0 && (
              <div className="mt-2 space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-500">最近的對話</p>
                {msgs.map((m) => (
                  <p key={m.id}>
                    <b>{m.senderId ? userById(d, m.senderId)?.name : '系統'}</b>：{m.body || '［照片］'}
                    <span className="ml-1 text-slate-400">{formatDateTime(m.createdAt)}</span>
                  </p>
                ))}
              </div>
            )}
            <input
              className="input mt-3"
              placeholder="裁定說明（會顯示給雙方）"
              value={notes[o.id] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [o.id]: e.target.value }))}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn btn-primary py-1.5" onClick={() => resolve('complete')}>
                交易成立{o.mode === 'points' ? '（點數給提供者）' : ''}
              </button>
              <button className="btn btn-outline py-1.5" onClick={() => resolve('refund')}>
                取消交易{o.mode === 'points' ? '（退點給索取者）' : ''}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- users

function UserAdmin({ d }: { d: DB }) {
  const toast = useToast();
  const [adjust, setAdjust] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const users = d.users.filter((u) => u.status !== 'deleted');
  const target = adjust ? userById(d, adjust) : null;
  const say = async (p: Promise<{ ok: boolean; error?: string }>, done: string) => {
    const r = await p;
    toast(r.ok ? done : (r.error ?? ''), r.ok ? 'success' : 'error');
  };

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="p-3">使用者</th>
              <th className="p-3">手機</th>
              <th className="p-3 text-right">點數</th>
              <th className="p-3 text-right">愛心</th>
              <th className="p-3 text-right">評價</th>
              <th className="p-3">狀態</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const rating = ratingOf(d, u.id);
              const held = heldOf(d, u.id);
              return (
                <tr key={u.id}>
                  <td className="p-3">
                    <Link href={userPath(u.id)} className="flex items-center gap-2 font-semibold hover:underline">
                      <Avatar user={u} size={28} />
                      {u.name}
                      {u.role === 'admin' && <span className="text-xs text-slate-400">管理員</span>}
                      {u.merchant && <span className="text-xs text-brand">商家</span>}
                    </Link>
                  </td>
                  <td className="p-3 text-slate-500">{maskPhone(u.phone)}</td>
                  <td className="p-3 text-right">
                    {balanceOf(d, u.id)}
                    {held > 0 && <span className="text-xs text-slate-400">（凍結 {held}）</span>}
                  </td>
                  <td className="p-3 text-right">{u.loveScore}</td>
                  <td className="p-3 text-right">{rating.count ? `${rating.avg.toFixed(1)}（${rating.count}）` : '－'}</td>
                  <td className="p-3">
                    <span className={u.status === 'active' ? 'text-brand-dark' : 'font-semibold text-m-rose'}>
                      {u.status === 'active' ? '正常' : '停權'}
                    </span>
                  </td>
                  <td className="p-3">
                    {u.role !== 'admin' && (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          className="btn btn-outline px-2.5 py-1 text-xs"
                          onClick={() =>
                            say(
                              actions.adminSetUserStatus(u.id, u.status === 'active' ? 'suspended' : 'active'),
                              u.status === 'active' ? '已停權' : '已恢復',
                            )
                          }
                        >
                          {u.status === 'active' ? '停權' : '恢復'}
                        </button>
                        <button
                          className="btn btn-outline px-2.5 py-1 text-xs"
                          onClick={() => say(actions.adminSetMerchant(u.id, !u.merchant), u.merchant ? '已取消商家' : '已設為試點商家')}
                        >
                          {u.merchant ? '取消商家' : '設為商家'}
                        </button>
                        <button
                          className="btn btn-outline px-2.5 py-1 text-xs"
                          onClick={() => {
                            setAdjust(u.id);
                            setAmount('');
                            setNote('');
                          }}
                        >
                          調整點數
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal open={!!target} title={`調整「${target?.name ?? ''}」的點數`} onClose={() => setAdjust(null)}>
        <p className="mb-3 text-sm text-slate-500">目前可用 {target ? balanceOf(d, target.id) : 0} 點。輸入負數可以扣點。每次調整都會留下紀錄。</p>
        <label className="label" htmlFor="adj-amount">
          點數
        </label>
        <input
          id="adj-amount"
          className="input"
          inputMode="numeric"
          placeholder="例如 20 或 -10"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label className="label mt-3" htmlFor="adj-note">
          原因
        </label>
        <input id="adj-note" className="input" placeholder="例如：客服補償" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          className="btn btn-primary mt-4 w-full"
          onClick={async () => {
            if (!target) return;
            const r = await actions.adminAdjustPoints(target.id, Number(amount), note);
            if (!r.ok) return toast(r.error, 'error');
            toast('已調整點數');
            setAdjust(null);
          }}
        >
          確認調整
        </button>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- settings

const SETTING_FIELDS: { key: keyof Settings; label: string; unit: string }[] = [
  { key: 'feeRate', label: '手續費比例', unit: '（0.1 = 10%）' },
  { key: 'minFee', label: '最低手續費', unit: '點' },
  { key: 'signupBonus', label: '新手點數', unit: '點' },
  { key: 'firstListingReward', label: '首次刊登獎勵', unit: '點' },
  { key: 'firstOrderReward', label: '首次完成交易獎勵', unit: '點' },
  { key: 'monthlyRewardCap', label: '每月獎勵上限', unit: '點' },
  { key: 'rewardExpiryMonths', label: '獎勵點數有效期', unit: '個月' },
  { key: 'freeDailyLimit', label: '免費索取每日上限', unit: '件' },
  { key: 'newAccountDays', label: '新帳號觀察期', unit: '天' },
  { key: 'newAccountPointsCap', label: '新帳號點數交易上限', unit: '點' },
  { key: 'requestTimeoutHours', label: '索取逾時自動取消', unit: '小時' },
  { key: 'autoCompleteHours', label: '單方確認後自動完成', unit: '小時' },
  { key: 'acceptTimeoutDays', label: '接受後都沒人確認，自動取消', unit: '天（0 = 不取消）' },
  { key: 'reviewWindowDays', label: '評價期限', unit: '天' },
  { key: 'reportHideThreshold', label: '檢舉幾人自動隱藏', unit: '人' },
];

function SettingsForm({ d }: { d: DB }) {
  const toast = useToast();
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, String(d.settings[f.key])])),
  );
  return (
    <form
      className="card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const patch = Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, Number(form[f.key])])) as Partial<Settings>;
        const r = await actions.adminUpdateSettings(patch);
        toast(r.ok ? '參數已更新' : r.error, r.ok ? 'success' : 'error');
      }}
    >
      <p className="mb-4 text-sm text-slate-500">修改後立即生效；已建立的交易維持建立時的點數與手續費。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SETTING_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="label">
              {f.label}
              <span className="ml-1 font-normal text-slate-400">{f.unit}</span>
            </span>
            <input
              className="input"
              inputMode="decimal"
              value={form[f.key]}
              onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <button className="btn btn-primary mt-5">儲存參數</button>
    </form>
  );
}

// ---------------------------------------------------------------- log

function Log({ d }: { d: DB }) {
  const log = [...d.adminLog].sort((a, b) => b.createdAt - a.createdAt);
  if (!log.length) return <p className="card p-6 text-center text-sm text-slate-500">還沒有操作紀錄。</p>;
  return (
    <ul className="card divide-y divide-slate-100">
      {log.map((x) => (
        <li key={x.id} className="flex items-center gap-3 p-3 text-sm">
          <span className="w-36 shrink-0 text-xs text-slate-400">{formatDateTime(x.createdAt)}</span>
          <span className="font-semibold">{userById(d, x.adminId)?.name}</span>
          <span className="text-slate-600">{x.action}</span>
        </li>
      ))}
    </ul>
  );
}
