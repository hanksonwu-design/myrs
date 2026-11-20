'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  Gauge,
  ListChecks,
  Mail,
  Megaphone,
  RefreshCw,
  ScrollText,
  Search,
  Settings2,
  ShieldBan,
  Users,
  X,
} from 'lucide-react';
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
import { DAY, formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { announcementOn, LISTING_STATUS_LABEL, MODE_LABEL, ORDER_STATUS_LABEL } from '@/lib/rules';
import { IS_REMOTE } from '@/lib/backend';
import { activeSuspension, formatUntil, hasLevel, isStaff, LEVEL_DUTIES, LEVEL_LABEL, levelOf } from '@/lib/staff';
import type { AdminLevel, DB, LedgerEntry, MailItem, MailStatus, Settings, User } from '@/lib/types';
import { ListingThumb } from '@/components/ListingVisuals';
import { RemoveListingButton } from '@/components/RemoveListing';
import { Avatar, Loading, Modal, ModeBadge } from '@/components/ui';
import { useRequireLogin } from '@/components/hooks';
import { PointsHealth } from '@/components/PointsHealth';
import { useToast } from '@/components/Providers';
import { listingPath, userPath } from '@/lib/links';

type Tab = 'dash' | 'listings' | 'reports' | 'disputes' | 'users' | 'mail' | 'settings' | 'log';

/** The lowest level that sees each tab; the server checks the same levels. */
const TAB_LEVEL: Record<Tab, AdminLevel> = {
  dash: 'admin',
  listings: 'moderator',
  reports: 'moderator',
  disputes: 'admin',
  users: 'admin',
  mail: 'admin',
  settings: 'owner',
  log: 'admin',
};

const GATE_LISTINGS = 30;
const GATE_RATE = 0.4;

export default function AdminPage() {
  const d = useDB()!;
  const user = useRequireLogin(d);
  const [tab, setTab] = useState<Tab>('dash');
  if (!user) return <Loading />;
  if (!isStaff(user)) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-slate-500">只有管理團隊可以進入後台。</p>
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

  const level = levelOf(user)!;
  const allTabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'dash', label: '儀表板', icon: <Gauge className="size-4" /> },
    { id: 'listings', label: '刊登審核', icon: <ListChecks className="size-4" />, badge: pendingListings },
    { id: 'reports', label: '檢舉', icon: <Flag className="size-4" />, badge: openReportTargets },
    { id: 'disputes', label: '爭議', icon: <AlertTriangle className="size-4" />, badge: disputes },
    { id: 'users', label: '使用者', icon: <Users className="size-4" /> },
    { id: 'mail', label: '通知信', icon: <Mail className="size-4" /> },
    { id: 'settings', label: '設定', icon: <Settings2 className="size-4" /> },
    { id: 'log', label: '紀錄', icon: <ScrollText className="size-4" /> },
  ];
  const tabs = allTabs.filter((t) => hasLevel(user, TAB_LEVEL[t.id]));
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold sm:text-2xl">管理後台</h1>
        <p className="text-sm text-slate-500">
          你的權限：<b className="text-slate-700">{LEVEL_LABEL[level]}</b>・{LEVEL_DUTIES[level]}
        </p>
      </div>
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`chip shrink-0 gap-1.5 ${current === t.id ? 'chip-on' : 'chip-off'}`}
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
      {current === 'dash' && <Dashboard d={d} />}
      {current === 'listings' && <ListingReview d={d} me={user} />}
      {current === 'reports' && <Reports d={d} me={user} />}
      {current === 'disputes' && <Disputes d={d} />}
      {current === 'users' && <UserAdmin d={d} me={user} />}
      {current === 'mail' && <MailView d={d} />}
      {current === 'settings' && <SettingsTab d={d} />}
      {current === 'log' && <Log d={d} />}
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
      <PointsHealth d={d} />
    </div>
  );
}

// ---------------------------------------------------------------- listing review

function ListingReview({ d, me }: { d: DB; me: User }) {
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
            {l.ownerId === me.id ? (
              <p className="text-xs text-slate-500 sm:w-40">這是你自己的刊登，需要由其他管理團隊成員審核。</p>
            ) : (
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
                <RemoveListingButton listing={l} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- reports

function Reports({ d, me }: { d: DB; me: User }) {
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
            {target?.id === me.id ? (
              <p className="mt-3 text-xs text-slate-500">這是針對你的檢舉，需要由其他管理團隊成員處理。</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-outline py-1.5" onClick={() => run(first.id, 'dismiss', '已駁回')}>
                  駁回
                </button>
                {l && (
                  <button className="btn btn-danger py-1.5" onClick={() => run(first.id, 'remove_listing', '已下架刊登')}>
                    下架刊登
                  </button>
              )}
              {target && hasLevel(me, 'admin') && target.role !== 'admin' && target.status === 'active' && (
                <button
                  className="btn btn-danger py-1.5"
                  onClick={() =>
                    confirm(`確定停權「${target.name}」？原因會記為「經檢舉確認違反使用規則」，沒有期限；要寫其他原因或期限，請到「使用者」分頁操作。`) &&
                    run(first.id, 'suspend_user', `已停權${TOLD}`)
                  }
                >
                  停權 {target.name}
                </button>
              )}
            </div>
            )}
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

type UserFilter = 'all' | 'suspended' | 'merchant' | 'staff';

const USER_FILTERS: { id: UserFilter; label: string; test: (u: User) => boolean }[] = [
  { id: 'all', label: '全部', test: () => true },
  { id: 'suspended', label: '停權中', test: (u) => u.status === 'suspended' },
  { id: 'merchant', label: '商家', test: (u) => u.merchant },
  { id: 'staff', label: '管理團隊', test: (u) => u.role === 'admin' },
];

const LEDGER_LABEL: Record<LedgerEntry['type'], string> = {
  signup_bonus: '新手點數',
  reward: '平台獎勵',
  hold: '索取凍結',
  release: '退回',
  transfer_in: '點數收入',
  fee: '手續費',
  adjust: '管理員調整',
};

function UserBadges({ u }: { u: User }) {
  const level = levelOf(u);
  return (
    <>
      {level && <span className="rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-600">{LEVEL_LABEL[level]}</span>}
      {u.merchant && <span className="rounded-full bg-emerald-50 px-1.5 text-xs font-semibold text-brand-dark">商家</span>}
      {u.status === 'suspended' && <span className="rounded-full bg-rose-50 px-1.5 text-xs font-semibold text-m-rose">停權中</span>}
    </>
  );
}

function UserAdmin({ d, me }: { d: DB; me: User }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const all = d.users.filter((u) => u.status !== 'deleted');
  const query = q.trim().toLowerCase();
  const test = USER_FILTERS.find((f) => f.id === filter)!.test;
  const users = all
    .filter((u) => test(u) && (!query || u.name.toLowerCase().includes(query)))
    .sort((a, b) => b.createdAt - a.createdAt);
  const target = open ? userById(d, open) : null;

  return (
    <>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="搜尋會員名稱"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜尋會員名稱"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {USER_FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'chip-on' : 'chip-off'}`} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="ml-1 text-xs opacity-70">{all.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      </div>
      {!users.length ? (
        <p className="card p-6 text-center text-sm text-slate-500">找不到符合的會員。</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="p-3">會員</th>
                <th className="p-3">加入</th>
                <th className="p-3 text-right">點數</th>
                <th className="p-3 text-right">評價</th>
                <th className="p-3 text-right">被檢舉</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const rating = ratingOf(d, u.id);
                const held = heldOf(d, u.id);
                const reports = reportsAgainst(d, u.id).length;
                return (
                  <tr key={u.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(u.id)}>
                    <td className="p-3">
                      <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                        <Avatar user={u} size={28} />
                        {u.name}
                        <UserBadges u={u} />
                      </span>
                    </td>
                    <td className="p-3 text-slate-500">{formatDate(u.createdAt)}</td>
                    <td className="p-3 text-right">
                      {balanceOf(d, u.id)}
                      {held > 0 && <span className="text-xs text-slate-400">（凍結 {held}）</span>}
                    </td>
                    <td className="p-3 text-right">{rating.count ? `${rating.avg.toFixed(1)}（${rating.count}）` : '－'}</td>
                    <td className={`p-3 text-right ${reports ? 'font-semibold text-m-rose' : 'text-slate-400'}`}>{reports || '－'}</td>
                    <td className="p-3 text-right">
                      <button className="btn btn-outline px-2.5 py-1 text-xs">管理</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!target} title={target ? `會員「${target.name}」` : ''} onClose={() => setOpen(null)}>
        {target && <UserDetail key={target.id} d={d} me={me} u={target} />}
      </Modal>
    </>
  );
}

/** Reports filed against a member or any of their listings. */
function reportsAgainst(d: DB, userId: string) {
  const mine = new Set(d.listings.filter((l) => l.ownerId === userId).map((l) => l.id));
  return d.reports.filter((r) => (r.targetType === 'user' ? r.targetId === userId : mine.has(r.targetId)));
}

/** Supabase mode e-mails the member; the demo has no mail. */
const TOLD = IS_REMOTE ? '，並寄信通知對方' : '';

const SUSPEND_PRESETS = ['多次爽約', '疑似詐騙', '騷擾其他會員', '販售禁售品', '濫用點數或獎勵'];
const SUSPEND_DAYS = [1, 3, 7, 14, 30, 90];
const REPORT_STATUS_LABEL = { open: '待處理', resolved: '已處理', dismissed: '已駁回' } as const;

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-sm font-bold">
        {title}
        {count !== undefined && <span className="ml-1 font-normal text-slate-400">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function UserDetail({ d, me, u }: { d: DB; me: User; u: User }) {
  const toast = useToast();
  const owner = hasLevel(me, 'owner');
  const [panel, setPanel] = useState<'none' | 'suspend' | 'points' | 'role'>('none');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('7');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [level, setLevel] = useState<AdminLevel | 'member'>(levelOf(u) ?? 'member');
  const [busy, setBusy] = useState(false);

  const now = nowOf(d);
  const staff = u.role === 'admin';
  const currentLevel = levelOf(u) ?? 'member';
  const otherOwner = currentLevel === 'owner' && u.id !== me.id;
  const rating = ratingOf(d, u.id);
  const listings = d.listings.filter((l) => l.ownerId === u.id).sort((a, b) => b.createdAt - a.createdAt);
  const orders = d.orders
    .filter((o) => o.requesterId === u.id || o.providerId === u.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const completed = u.completedDeals ?? orders.filter((o) => o.status === 'completed').length;
  const reports = reportsAgainst(d, u.id).sort((a, b) => b.createdAt - a.createdAt);
  const suspensions = d.suspensions.filter((s) => s.userId === u.id).sort((a, b) => b.createdAt - a.createdAt);
  const current = activeSuspension(d, u.id);
  const ledger = d.ledger.filter((e) => e.userId === u.id).sort((a, b) => b.createdAt - a.createdAt);
  const held = heldOf(d, u.id);

  const run = async (p: Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) {
      toast(r.error ?? '', 'error');
      return false;
    }
    toast(done);
    setPanel('none');
    return true;
  };
  const toggle = (p: typeof panel) => setPanel((x) => (x === p ? 'none' : p));

  return (
    <div className="text-sm">
      <div className="flex items-center gap-3">
        <Avatar user={u} size={48} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-base font-bold">
            {u.name}
            <UserBadges u={u} />
          </p>
          <p className="text-xs text-slate-500">
            {formatDate(u.createdAt)} 加入・
            <Link href={userPath(u.id)} className="underline">
              公開頁面
            </Link>
          </p>
        </div>
      </div>

      {u.status === 'suspended' && (
        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-rose-800">
          {current ? (
            <>
              停權原因：{current.reason}
              <br />
              {current.until ? `預定 ${formatUntil(current.until)} 自動恢復` : '無期限，需要手動恢復'}
            </>
          ) : (
            '這個帳號停權中。'
          )}
        </p>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[
          ['點數', `${balanceOf(d, u.id)}${held ? `+${held}` : ''}`],
          ['愛心', u.loveScore],
          ['評價', rating.count ? rating.avg.toFixed(1) : '－'],
          ['完成交易', completed],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-slate-50 p-2">
            <p className="text-[11px] text-slate-500">{k}</p>
            <p className="font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {!staff && u.status === 'active' && (
          <button className={`btn px-2.5 py-1 text-xs ${panel === 'suspend' ? 'btn-danger' : 'btn-outline'}`} onClick={() => toggle('suspend')}>
            停權
          </button>
        )}
        {u.status === 'suspended' && (
          <button
            className="btn btn-primary px-2.5 py-1 text-xs"
            disabled={busy}
            onClick={() => confirm(`確定恢復「${u.name}」的帳號？`) && run(actions.adminSetUserStatus(u.id, 'active'), `已恢復${TOLD}`)}
          >
            恢復帳號
          </button>
        )}
        {!staff && (
          <button
            className="btn btn-outline px-2.5 py-1 text-xs"
            disabled={busy}
            onClick={() => run(actions.adminSetMerchant(u.id, !u.merchant), u.merchant ? '已取消商家' : '已設為試點商家')}
          >
            {u.merchant ? '取消商家' : '設為商家'}
          </button>
        )}
        {owner && (
          <button className={`btn px-2.5 py-1 text-xs ${panel === 'points' ? 'btn-primary' : 'btn-outline'}`} onClick={() => toggle('points')}>
            調整點數
          </button>
        )}
        {owner && u.status === 'active' && (
          <button className={`btn px-2.5 py-1 text-xs ${panel === 'role' ? 'btn-primary' : 'btn-outline'}`} onClick={() => toggle('role')}>
            管理權限
          </button>
        )}
      </div>
      {staff && <p className="mt-1.5 text-xs text-slate-500">管理團隊成員不能停權；如有需要，請先由擁有者撤銷權限。</p>}

      {panel === 'suspend' && (
        <div className="mt-3 rounded-xl border border-rose-200 p-3">
          <p className="label">停權原因{IS_REMOTE && '（會寄給對方）'}</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUSPEND_PRESETS.map((p) => (
              <button key={p} type="button" className={`chip ${reason === p ? 'chip-on' : 'chip-off'}`} onClick={() => setReason(p)}>
                {p}
              </button>
            ))}
          </div>
          <textarea
            className="input min-h-16"
            maxLength={200}
            placeholder="寫下原因，例如：連續三次答應面交卻沒出現"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="停權原因"
          />
          <label className="label mt-2" htmlFor="suspend-days">
            停權期間
          </label>
          <select id="suspend-days" className="input" value={days} onChange={(e) => setDays(e.target.value)}>
            {SUSPEND_DAYS.map((n) => (
              <option key={n} value={n}>
                {n} 天後自動恢復
              </option>
            ))}
            <option value="">無期限（需要手動恢復）</option>
          </select>
          <p className="mt-2 text-xs text-slate-500">停權後對方不能登入使用，進行中的索取會取消並退回凍結點數，刊登也會暫時隱藏。</p>
          <button
            className="btn btn-danger mt-2 w-full"
            disabled={busy || !reason.trim()}
            onClick={() =>
              run(actions.adminSetUserStatus(u.id, 'suspended', reason, days ? Number(days) : null), `已停權${TOLD}`)
            }
          >
            確認停權
          </button>
        </div>
      )}

      {panel === 'points' && (
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <p className="mb-2 text-xs text-slate-500">輸入負數可以扣點。每次調整都會留下紀錄。</p>
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
          <label className="label mt-2" htmlFor="adj-note">
            原因
          </label>
          <input id="adj-note" className="input" placeholder="例如：客服補償" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-primary mt-3 w-full"
            disabled={busy}
            onClick={async () => {
              if (await run(actions.adminAdjustPoints(u.id, Number(amount), note), '已調整點數')) {
                setAmount('');
                setNote('');
              }
            }}
          >
            確認調整
          </button>
        </div>
      )}

      {panel === 'role' && (
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          {otherOwner ? (
            <p className="text-slate-600">其他擁有者的權限只能由本人調整。</p>
          ) : (
            <>
              <p className="label">管理權限</p>
              <div className="space-y-1.5">
                {(['member', 'moderator', 'admin', 'owner'] as const).map((x) => (
                  <label
                    key={x}
                    className={`flex cursor-pointer gap-2 rounded-xl border p-2 ${level === x ? 'border-brand bg-emerald-50' : 'border-slate-200'}`}
                  >
                    <input type="radio" name="level" className="mt-1" checked={level === x} onChange={() => setLevel(x)} />
                    <span>
                      <b>{LEVEL_LABEL[x]}</b>
                      {x === currentLevel && <span className="ml-1 text-xs text-slate-400">（目前）</span>}
                      <span className="block text-xs text-slate-500">{x === 'member' ? '沒有後台權限' : LEVEL_DUTIES[x]}</span>
                    </span>
                  </label>
                ))}
              </div>
              <button
                className="btn btn-primary mt-3 w-full"
                disabled={busy || level === currentLevel}
                onClick={() =>
                  (level !== 'owner' || confirm(`擁有者可以指派管理團隊、修改參數和調整點數，而且其他擁有者不能撤銷他。確定把「${u.name}」設為擁有者？`)) &&
                  run(actions.adminSetRole(u.id, level), `已把「${u.name}」改為${LEVEL_LABEL[level]}${TOLD}`)
                }
              >
                更新權限
              </button>
            </>
          )}
        </div>
      )}

      <Section title="刊登" count={listings.length}>
        {listings.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {listings.slice(0, 6).map((l) => (
              <li key={l.id} className="flex items-center gap-2 p-2">
                <Link href={listingPath(l.id)} className="min-w-0 flex-1 truncate hover:underline">
                  {l.title}
                </Link>
                <span className="shrink-0 text-xs text-slate-500">{LISTING_STATUS_LABEL[l.status]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">還沒有刊登。</p>
        )}
      </Section>

      <Section title="交易" count={orders.length}>
        {orders.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {orders.slice(0, 6).map((o) => (
              <li key={o.id} className="flex items-center gap-2 p-2">
                <span className="shrink-0 rounded bg-slate-100 px-1 text-[11px] text-slate-600">{o.requesterId === u.id ? '索取' : '提供'}</span>
                <span className="min-w-0 flex-1 truncate">{listingById(d, o.listingId)?.title ?? '（已刪除的刊登）'}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {ORDER_STATUS_LABEL[o.status]}・{timeAgo(o.createdAt, now)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">還沒有交易。</p>
        )}
      </Section>

      <Section title="被檢舉" count={reports.length}>
        {reports.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {reports.slice(0, 6).map((r) => (
              <li key={r.id} className="p-2">
                <p>
                  {r.targetType === 'listing' && (
                    <span className="text-slate-500">刊登「{listingById(d, r.targetId)?.title}」：</span>
                  )}
                  {r.reason}
                </p>
                <p className="text-xs text-slate-400">
                  {r.reporterId === 'system' ? '系統偵測' : userById(d, r.reporterId)?.name}・{timeAgo(r.createdAt, now)}・
                  {REPORT_STATUS_LABEL[r.status]}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">沒有被檢舉過。</p>
        )}
      </Section>

      <Section title="停權紀錄" count={suspensions.length}>
        {suspensions.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {suspensions.map((s) => (
              <li key={s.id} className="p-2">
                <p>{s.reason}</p>
                <p className="text-xs text-slate-400">
                  {formatDateTime(s.createdAt)}・{s.createdBy ? userById(d, s.createdBy)?.name : '系統'}・
                  {s.until ? `${Math.max(1, Math.round((s.until - s.createdAt) / DAY))} 天` : '無期限'}・
                  {!s.liftedAt
                    ? '停權中'
                    : s.liftedBy
                      ? `${userById(d, s.liftedBy)?.name ?? '管理員'} 已恢復`
                      : '到期自動恢復'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">沒有停權紀錄。</p>
        )}
      </Section>

      <Section title="點數紀錄" count={ledger.length}>
        {ledger.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {ledger.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-center gap-2 p-2">
                <span className="min-w-0 flex-1 truncate">
                  {LEDGER_LABEL[e.type]}
                  {e.note && <span className="text-slate-400">・{e.note}</span>}
                </span>
                <span className="shrink-0 text-xs text-slate-400">{formatDate(e.createdAt)}</span>
                <span className={`w-12 shrink-0 text-right font-semibold ${e.amount < 0 ? 'text-m-rose' : 'text-brand-dark'}`}>
                  {e.amount > 0 ? `+${e.amount}` : e.amount}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">沒有點數紀錄。</p>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- settings

const SETTING_FIELDS: { key: keyof Settings; label: string; unit: string; min?: number }[] = [
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
  { key: 'requestTimeoutHours', label: '索取逾時自動取消', unit: '小時', min: 1 },
  { key: 'autoCompleteHours', label: '單方確認後自動完成', unit: '小時', min: 1 },
  { key: 'acceptTimeoutDays', label: '接受後都沒人確認，自動取消', unit: '天（0 = 不取消）' },
  { key: 'reviewWindowDays', label: '評價期限', unit: '天', min: 1 },
  { key: 'reportHideThreshold', label: '檢舉幾人自動隱藏', unit: '人', min: 1 },
];

/** The same limits the server checks, worded with the field names admins see. */
function settingsError(patch: Partial<Settings>): string | null {
  for (const f of SETTING_FIELDS) {
    const v = patch[f.key];
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < 0) return `「${f.label}」必須是 0 以上的數字`;
    if (f.min !== undefined && v < f.min) return `「${f.label}」至少要是 ${f.min}`;
  }
  const a = patch.acceptTimeoutDays;
  if (a !== undefined && a > 0 && a < 1) return '「接受後都沒人確認，自動取消」要是 0（不取消）或 1 以上';
  return null;
}

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
        const bad = settingsError(patch);
        if (bad) return toast(bad, 'error');
        const r = await actions.adminUpdateSettings(patch);
        toast(r.ok ? '參數已更新' : r.error, r.ok ? 'success' : 'error');
      }}
    >
      <h2 className="flex items-center gap-1.5 font-bold">
        <Settings2 className="size-4 text-brand" />
        平台參數
      </h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">
        修改後立即生效；已建立的交易維持建立時的點數與手續費。每次修改都會在「紀錄」寫下改了哪些項目。
      </p>
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

// ---------------------------------------------------------------- settings tab

function SettingsTab({ d }: { d: DB }) {
  return (
    <div className="space-y-4">
      <AnnouncementForm d={d} />
      <BannedWordsForm d={d} />
      <SettingsForm d={d} />
    </div>
  );
}

/** datetime-local value for a time, in the browser's time zone. */
const localInput = (t: number) => {
  const x = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};

function AnnouncementForm({ d }: { d: DB }) {
  const toast = useToast();
  const s = d.site;
  const now = nowOf(d);
  const on = announcementOn(s, now);
  const [text, setText] = useState(s.announcement);
  const [noEnd, setNoEnd] = useState(!!s.announcement && s.announcementUntil === null);
  const [until, setUntil] = useState(localInput(s.announcementUntil && s.announcementUntil > now ? s.announcementUntil : now + 7 * DAY));
  const [busy, setBusy] = useState(false);

  const save = async (clear: boolean) => {
    const end = noEnd ? null : new Date(until).getTime();
    if (!clear && !text.trim()) return toast('請先寫公告內容', 'error');
    if (!clear && end !== null && !Number.isFinite(end)) return toast('請選擇結束時間', 'error');
    setBusy(true);
    const r = await actions.adminSetAnnouncement(clear ? '' : text, clear ? null : end);
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    if (clear) setText('');
    toast(clear ? '已取消公告' : '公告已發布，首頁會顯示');
  };

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-1.5 font-bold">
        <Megaphone className="size-4 text-brand" />
        全站公告
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {on
          ? `首頁正在顯示公告${s.announcementUntil ? `，到 ${formatUntil(s.announcementUntil)} 自動結束` : '，沒有結束時間'}。`
          : s.announcement
            ? '上一則公告已經過了結束時間，首頁不再顯示。'
            : '目前沒有公告。發布後會顯示在首頁最上方，看過的人可以關掉。'}
      </p>
      <textarea
        className="input mt-3 min-h-20"
        maxLength={200}
        placeholder="例如：11/23（六）凌晨 2～4 點系統維護，期間暫停使用。"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="公告內容"
      />
      <p className="mt-1 text-right text-xs text-slate-400">{text.length}/200</p>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          結束時間
          <input
            type="datetime-local"
            className="input w-auto py-1.5"
            value={until}
            disabled={noEnd}
            onChange={(e) => setUntil(e.target.value)}
            aria-label="公告結束時間"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} />
          不設結束時間
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => save(false)}>
          {s.announcement ? '更新公告' : '發布公告'}
        </button>
        {s.announcement && (
          <button className="btn btn-outline" disabled={busy} onClick={() => confirm('確定取消這則公告？') && save(true)}>
            取消公告
          </button>
        )}
      </div>
    </section>
  );
}

function BannedWordsForm({ d }: { d: DB }) {
  const toast = useToast();
  const saved = d.site.bannedWords;
  const [words, setWords] = useState<string[]>(saved);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = words.length !== saved.length || words.some((w, i) => w !== saved[i]);

  const add = () => {
    const fresh = input
      .split(/[,，、\s]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (!fresh.length) return;
    const tooLong = fresh.find((w) => w.length > 10);
    if (tooLong) return toast(`「${tooLong}」太長，每個詞最多 10 個字`, 'error');
    setWords((x) => [...x, ...fresh.filter((w, i) => !x.includes(w) && fresh.indexOf(w) === i)]);
    setInput('');
  };

  const save = async () => {
    setBusy(true);
    const r = await actions.adminSetBannedWords(words);
    setBusy(false);
    toast(r.ok ? '禁售詞已更新，之後的新刊登會用新的清單檢查' : r.error, r.ok ? 'success' : 'error');
  };

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-1.5 font-bold">
        <ShieldBan className="size-4 text-m-rose" />
        禁售詞
        <span className="text-sm font-normal text-slate-400">{words.length} 個</span>
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        新刊登的標題、說明或想交換的東西包含這些字，會先進「刊登審核」，通過後才公開。修改只影響之後的新刊登，已上架的不會重新檢查。
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {words.map((w) => (
          <span key={w} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1.5 text-sm">
            {w}
            <button
              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label={`移除「${w}」`}
              onClick={() => setWords((x) => x.filter((y) => y !== w))}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {!words.length && <span className="text-sm text-slate-400">清單是空的：所有新刊登都會直接上架。</span>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className="input flex-1"
          placeholder="新增禁售詞，可以用逗號或空白一次加好幾個"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          aria-label="新增禁售詞"
        />
        <button className="btn btn-outline" onClick={add}>
          加入
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
          儲存禁售詞
        </button>
        {dirty && (
          <button className="btn btn-ghost" onClick={() => setWords(saved)}>
            還原
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- mail

const MAIL_STATE: Record<MailItem['state'], { label: string; tone: string }> = {
  pending: { label: '等待寄出', tone: 'bg-amber-50 text-amber-700' },
  failed: { label: '寄送失敗', tone: 'bg-rose-50 text-m-rose' },
  no_address: { label: '沒有信箱', tone: 'bg-slate-100 text-slate-600' },
  sent: { label: '已寄出', tone: 'bg-emerald-50 text-brand-dark' },
};

function MailView({ d }: { d: DB }) {
  const toast = useToast();
  const [filter, setFilter] = useState<'problem' | 'all'>('problem');
  const [data, setData] = useState<MailStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (f: 'problem' | 'all') => {
    setBusy(true);
    const r = await actions.adminMailStatus(f);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError('');
    setData(r.value);
  };

  useEffect(() => {
    if (IS_REMOTE) void load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  if (!IS_REMOTE) {
    return (
      <p className="card p-6 text-center text-sm text-slate-500">
        示範模式不會寄出通知信，所以這裡沒有寄送紀錄。正式版會顯示每封信的寄送狀況，寄失敗的信可以重寄。
      </p>
    );
  }

  const retry = async (id: string | null) => {
    setBusy(true);
    const r = await actions.adminRetryMail(id);
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    toast(`已排入重寄 ${r.value} 封，1～2 分鐘內會寄出`);
    void load(filter);
  };

  const now = nowOf(d);
  const stuck = !!data?.oldestPending && now - data.oldestPending > 15 * 60_000;

  return (
    <div className="space-y-4">
      {error && <p className="card p-4 text-sm text-m-rose">{error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="等待寄出" value={data.pending} sub={data.oldestPending ? `最早一封 ${timeAgo(data.oldestPending, now)}` : '沒有排隊中的信'} />
            <Stat label="寄送失敗" value={<span className={data.failed ? 'text-m-rose' : ''}>{data.failed}</span>} sub="試了 5 次都沒寄出" />
            <Stat label="24 小時內寄出" value={data.sent24h} />
            <Stat label="沒有信箱" value={data.noAddress} sub="用手機註冊、沒有 Email 的會員" />
          </div>
          {stuck && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              有信已經排隊超過 15 分鐘還沒寄出，寄信程式可能停了。請到 Supabase 檢查 Edge Function「send-notifications」和寄信密碼（說明文件第 7 節）。
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(['problem', 'all'] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? 'chip-on' : 'chip-off'}`} onClick={() => setFilter(f)}>
            {f === 'problem' ? '有問題的信' : '最近 50 封'}
          </button>
        ))}
        <button className="btn btn-ghost px-2 py-1 text-sm" disabled={busy} onClick={() => load(filter)}>
          <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
          重新整理
        </button>
        {!!data?.failed && (
          <button className="btn btn-primary ml-auto py-1.5" disabled={busy} onClick={() => retry(null)}>
            全部重寄（{data.failed} 封）
          </button>
        )}
      </div>
      {data && !data.items.length && (
        <p className="card p-6 text-center text-sm text-slate-500">
          {filter === 'problem' ? '沒有寄送有問題的信。' : '還沒有任何通知信。'}
        </p>
      )}
      {data && data.items.length > 0 && (
        <ul className="card divide-y divide-slate-100">
          {data.items.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${MAIL_STATE[m.state].tone}`}>
                {MAIL_STATE[m.state].label}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.subject}</p>
                <p className="text-xs text-slate-500">
                  寄給{' '}
                  <Link href={userPath(m.userId)} className="underline">
                    {m.name || '已刪除的使用者'}
                  </Link>
                  ・{formatDateTime(m.createdAt)}
                  {m.state !== 'sent' && m.attempts > 0 && `・試了 ${m.attempts} 次`}
                </p>
                {m.error && m.state !== 'no_address' && <p className="mt-0.5 break-all text-xs text-m-rose">{m.error}</p>}
              </div>
              {m.state === 'failed' && (
                <button className="btn btn-outline shrink-0 px-2.5 py-1 text-xs" disabled={busy} onClick={() => retry(m.id)}>
                  重寄
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-400">為了保護會員隱私，這裡不顯示 Email 地址和信件內容。</p>
    </div>
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
