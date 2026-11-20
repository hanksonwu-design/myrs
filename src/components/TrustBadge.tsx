'use client';

import { ShieldCheck } from 'lucide-react';
import { trustOf, type TrustTone } from '@/lib/store';
import type { DB } from '@/lib/types';

const TONE: Record<TrustTone, string> = {
  new: 'bg-sky-50 text-sky-700',
  high: 'bg-brand-soft text-brand-dark',
  good: 'bg-emerald-50 text-emerald-700',
  ok: 'bg-slate-100 text-slate-600',
  low: 'bg-amber-50 text-amber-800',
};

export const TRUST_HELP = '信任分數從 50 開始：每完成 1 筆交易 +2（最多 +30），評價高於或低於 3 顆星最多 ±15，加入滿 30 天 +5。';

/** Trust score chip: 「可信 78」, or 「新朋友」 before the first completed deal. */
export function TrustBadge({ d, userId, deals = false }: { d: DB; userId: string; deals?: boolean }) {
  const t = trustOf(d, userId);
  return (
    <span
      title={`信任分數 ${t.score}，完成 ${t.deals} 筆交易。${TRUST_HELP}`}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${TONE[t.tone]}`}
    >
      <ShieldCheck className="size-3" />
      {t.tone === 'new' ? '新朋友' : `${t.label} ${t.score}`}
      {deals && <span className="font-normal">・完成 {t.deals} 筆</span>}
    </span>
  );
}
