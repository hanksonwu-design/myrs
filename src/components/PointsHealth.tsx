'use client';

import { AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import { balanceOf, heldOf, nowOf } from '@/lib/store';
import { DAY } from '@/lib/format';
import type { DB, LedgerType } from '@/lib/types';

// Categorical slots 1–3 of the validated reference palette (adjacent CVD ΔE 9.2 on
// white). Aqua is under 3:1 on white, so the legend always prints every amount.
const PART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'];
const STATUS = {
  good: { color: '#0ca30c', track: 'rgba(12,163,12,0.16)', Icon: CheckCircle2, text: 'text-[#006300]' },
  warning: { color: '#fab219', track: 'rgba(250,178,25,0.22)', Icon: CircleAlert, text: 'text-amber-800' },
  serious: { color: '#ec835a', track: 'rgba(236,131,90,0.2)', Icon: AlertTriangle, text: 'text-orange-800' },
} as const;
type Level = keyof typeof STATUS;

const fmt = (n: number) => n.toLocaleString('zh-TW');

function StatusChip({ level, label }: { level: Level; label: string }) {
  const s = STATUS[level];
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${s.text}`}>
      <s.Icon className="size-4" style={{ color: s.color }} aria-hidden />
      {label}
    </span>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}

/**
 * Admin view of the points economy: where every issued point is now, whether there
 * is enough to buy (or too much), how concentrated it is, and this month's flow.
 */
export function PointsHealth({ d }: { d: DB }) {
  const now = nowOf(d);
  const sum = (types: LedgerType[], since = 0) =>
    d.ledger.filter((e) => types.includes(e.type) && e.createdAt >= since).reduce((s, e) => s + e.amount, 0);

  const issued = sum(['signup_bonus', 'reward', 'adjust']);
  const fees = -sum(['fee']);
  const available = d.users.reduce((s, u) => s + balanceOf(d, u.id), 0);
  const held = d.users.reduce((s, u) => s + heldOf(d, u.id), 0);
  const parts = [
    { name: '會員可用', value: available, note: '在會員錢包裡，可以拿來索取' },
    { name: '凍結中', value: held, note: '已索取、等待完成的交易' },
    { name: '手續費回收', value: fees, note: '成交時平台收回，不再流通' },
  ];
  const whole = parts.reduce((s, p) => s + Math.max(0, p.value), 0);

  // Can members spend their points? Available points vs everything on sale for points.
  const demand = d.listings
    .filter((l) => l.status === 'active' && l.mode === 'points')
    .reduce((s, l) => s + l.remaining * l.pricePoints, 0);
  const coverage = demand ? available / demand : null;
  const coverageLevel: Level = coverage === null ? 'warning' : coverage < 1 ? 'warning' : coverage <= 4 ? 'good' : 'serious';
  const coverageLabel =
    coverage === null ? '沒有上架中的點數商品' : coverage < 1 ? '點數偏少' : coverage <= 4 ? '健康' : '點數偏多';

  // How much of the available points the richest tenth of members hold.
  const balances = d.users
    .filter((u) => u.role !== 'admin' && u.status !== 'deleted')
    .map((u) => balanceOf(d, u.id))
    .sort((a, b) => b - a);
  const top = Math.max(1, Math.ceil(balances.length * 0.1));
  const memberTotal = balances.reduce((s, b) => s + Math.max(0, b), 0);
  const topShare = memberTotal ? balances.slice(0, top).reduce((s, b) => s + Math.max(0, b), 0) / memberTotal : 0;
  const shareLevel: Level = topShare < 0.4 ? 'good' : topShare <= 0.6 ? 'warning' : 'serious';
  const shareLabel = topShare < 0.4 ? '分散' : topShare <= 0.6 ? '有點集中' : '過度集中';

  // This month's flow, and how much changed hands in the last 30 days.
  const start = new Date(now);
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
  const issuedMonth = d.ledger
    .filter((e) => ['signup_bonus', 'reward', 'adjust'].includes(e.type) && e.createdAt >= monthStart)
    .reduce((s, e) => s + e.amount, 0);
  const feesMonth = -sum(['fee'], monthStart);
  const traded30 = sum(['transfer_in'], now - 30 * DAY);

  const advice: string[] = [];
  if (coverage !== null && coverage > 4) advice.push('點數比可買的東西多很多：可以降低獎勵、提高手續費，或鼓勵商家用點數刊登。');
  if (coverage !== null && coverage < 1) advice.push('點數不夠買上架的東西：可以提高獎勵或新手點數，或提醒刊登者調低點數。');
  if (coverage === null) advice.push('目前沒有用點數刊登的東西，點數沒地方花：可以邀請試點商家用點數上架。');
  if (topShare > 0.6 && balances.length >= 10) advice.push('點數集中在少數人手上：到「會員」頁看看是否有刷點，或降低每月獎勵上限。');
  if (issuedMonth > 0 && feesMonth / issuedMonth < 0.05) advice.push('本月幾乎只發不收：點數會越來越多，留意上面的「點數夠不夠用」。');

  return (
    <section className="card space-y-5 p-5">
      <div>
        <h2 className="font-bold">點數健康度</h2>
        <p className="text-sm text-slate-500">
          平台一共發出 <b className="text-slate-800">{fmt(issued)} 點</b>（新手、獎勵、調整），現在分成三部分，加起來永遠等於發出的總數。
        </p>
      </div>

      {/* Where the issued points are: one whole, three parts. */}
      <div>
        <div
          className="flex h-7 gap-0.5"
          role="img"
          aria-label={parts.map((p) => `${p.name} ${fmt(p.value)} 點`).join('，')}
        >
          {whole > 0 ? (
            parts.map((p, i) => {
              const share = Math.max(0, p.value) / whole;
              if (share <= 0) return null;
              return (
                <div
                  key={p.name}
                  title={`${p.name}：${fmt(p.value)} 點（${Math.round(share * 100)}%）`}
                  className="flex items-center rounded px-2 text-xs font-semibold text-white"
                  style={{ width: `${share * 100}%`, background: PART_COLORS[i] }}
                >
                  {share >= 0.15 ? `${Math.round(share * 100)}%` : ''}
                </div>
              );
            })
          ) : (
            <div className="flex-1 rounded bg-slate-100" />
          )}
        </div>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
          {parts.map((p, i) => (
            <li key={p.name} className="flex items-start gap-2">
              <span className="mt-1 size-2.5 shrink-0 rounded-sm" style={{ background: PART_COLORS[i] }} aria-hidden />
              <span>
                <span className="font-semibold">{p.name}</span> {fmt(p.value)} 點
                <span className="block text-xs text-slate-500">{p.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-semibold">點數夠不夠用</p>
          <p className="mt-1 text-3xl font-semibold">{coverage === null ? '－' : `${coverage.toFixed(1)} 倍`}</p>
          <StatusChip level={coverageLevel} label={coverageLabel} />
          <p className="mt-1 text-xs text-slate-500">
            會員可用 {fmt(available)} 點 ÷ 上架中點數商品總價 {fmt(demand)} 點。1～4 倍算健康：太低買不起，太高點數就不值錢。
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-semibold">點數集中度</p>
          <p className="mt-1 text-3xl font-semibold">{Math.round(topShare * 100)}%</p>
          <div className="my-1.5 h-2.5 rounded-full" style={{ background: STATUS[shareLevel].track }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round(topShare * 100)}%`, background: STATUS[shareLevel].color }}
            />
          </div>
          <StatusChip level={shareLevel} label={shareLabel} />
          <p className="mt-1 text-xs text-slate-500">
            持有最多點數的前 {top} 位會員（前 10%）占所有會員可用點數的比例。40% 以下算分散
            {balances.length < 20 ? '；會員少於 20 人時僅供參考' : ''}。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="近 30 天點數成交" value={`${fmt(traded30)} 點`} sub={available ? `約為可用點數的 ${Math.round((traded30 / available) * 100)}%` : '－'} />
        <Tile label="本月發出" value={`${fmt(issuedMonth)} 點`} sub="新手、獎勵、調整" />
        <Tile label="本月回收" value={`${fmt(feesMonth)} 點`} sub="成交手續費" />
        <Tile
          label="本月淨增加"
          value={`${issuedMonth - feesMonth > 0 ? '+' : ''}${fmt(issuedMonth - feesMonth)} 點`}
          sub="發出減回收"
        />
      </div>

      {advice.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
          {advice.map((a) => (
            <li key={a} className="flex gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {a}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
