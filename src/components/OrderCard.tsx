'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, MessageCircle, Star } from 'lucide-react';
import { actions, chatOpen, counterpartId, listingById, nowOf, unreadIn, userById, type Result } from '@/lib/store';
import { HOUR, formatDateTime, hoursLeft } from '@/lib/format';
import type { DB, Order } from '@/lib/types';
import { ListingThumb } from './ListingVisuals';
import { Avatar, Modal, OrderStatusBadge } from './ui';
import { useToast } from './Providers';
import { TrustBadge } from './TrustBadge';
import { chatPath, listingPath, userPath } from '@/lib/links';

type Dialog = null | 'decline' | 'cancel' | 'dispute' | 'review';

export function OrderCard({ d, order: o, viewerId, inChat }: { d: DB; order: Order; viewerId: string; inChat?: boolean }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [stars, setStars] = useState(5);
  const l = listingById(d, o.listingId);
  const other = userById(d, counterpartId(o, viewerId));
  const iAmProvider = o.providerId === viewerId;
  const now = nowOf(d);
  const s = d.settings;
  const myDone = iAmProvider ? o.providerDoneAt : o.requesterDoneAt;
  const otherDone = iAmProvider ? o.requesterDoneAt : o.providerDoneAt;
  const reviewed = d.reviews.some((r) => r.orderId === o.id && r.reviewerId === viewerId);
  const canReview =
    o.status === 'completed' && !reviewed && o.completedAt !== null && now - o.completedAt <= s.reviewWindowDays * 24 * HOUR;
  const unread = unreadIn(d, viewerId, o.id);

  const [busy, setBusy] = useState(false);
  const run = async <T,>(p: Promise<Result<T>>, msg: string | ((v: T) => string)) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    toast(typeof msg === 'function' ? msg(r.value) : msg);
    setDialog(null);
    setText('');
  };

  let hint = '';
  if (o.status === 'requested') {
    hint = iAmProvider
      ? `請在 ${hoursLeft(o.createdAt + s.requestTimeoutHours * HOUR, now)}內回覆，逾時會自動取消`
      : `等待對方回覆（剩 ${hoursLeft(o.createdAt + s.requestTimeoutHours * HOUR, now)}）`;
  } else if (o.status === 'accepted') {
    if (myDone && !otherDone) hint = `你已確認完成，對方 ${hoursLeft(myDone + s.autoCompleteHours * HOUR, now)}內沒回應會自動完成`;
    else if (otherDone && !myDone) hint = '對方已確認完成，面交沒問題的話請按「面交完成」';
    else if (s.acceptTimeoutDays > 0 && o.acceptedAt) {
      const left = Math.max(0, Math.ceil((o.acceptedAt + s.acceptTimeoutDays * 24 * HOUR - now) / (24 * HOUR)));
      hint = `面交後，雙方都按「面交完成」；${left} 天內都沒人確認會自動取消並退點`;
    } else hint = '面交後，雙方都按「面交完成」';
  } else if (o.status === 'disputed') hint = '管理員處理中，點數暫時維持凍結';
  else if (o.status === 'cancelled') hint = o.cancelReason;
  else if (o.status === 'completed') hint = canReview ? `完成後 ${s.reviewWindowDays} 天內可以評價` : reviewed ? '你已評價' : '';

  return (
    <div className="card p-4">
      <div className="flex gap-3">
        <Link href={listingPath(o.listingId)} className="shrink-0">
          {l ? <ListingThumb listing={l} className="size-16 rounded-xl" /> : <div className="size-16 rounded-xl bg-slate-100" />}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link href={listingPath(o.listingId)} className="line-clamp-1 font-bold hover:text-brand">
              {l?.title ?? '已刪除的刊登'}
            </Link>
            <OrderStatusBadge status={o.status} />
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
            <Avatar user={other} size={18} />
            <span>
              {iAmProvider ? '索取者' : '提供者'}：<Link href={userPath(other?.id)} className="hover:underline">{other?.name}</Link>
            </span>
            {other && <TrustBadge d={d} userId={other.id} />}
          </p>
          <p className="mt-0.5 text-sm">
            {o.mode === 'points' ? (
              <span className="font-semibold text-amber-700">
                {o.points} 點{iAmProvider && o.fee ? `（手續費 ${o.fee} 點，實收 ${o.points - o.fee} 點）` : ''}
              </span>
            ) : o.mode === 'free' ? (
              <span className="font-semibold text-brand-dark">免費</span>
            ) : (
              <span className="inline-flex items-center gap-1 font-semibold text-sky-700">
                <ArrowLeftRight className="size-3.5" />
                以「{o.swapOffer}」交換
              </span>
            )}
            <span className="text-slate-400">　{formatDateTime(o.createdAt)}</span>
          </p>
        </div>
      </div>

      {o.note && o.status === 'requested' && (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">「{o.note}」</p>
      )}
      {o.status === 'disputed' && (
        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-m-rose">
          爭議：{o.disputeReason}（{userById(d, o.disputeBy)?.name} 提出）
        </p>
      )}
      {hint && <p className="mt-3 text-xs text-slate-500">{hint}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {o.status === 'requested' && iAmProvider && (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(actions.acceptOrder(o.id), '已接受，聊天室已開啟')}>
              接受
            </button>
            <button className="btn btn-outline" onClick={() => setDialog('decline')}>
              婉拒
            </button>
          </>
        )}
        {o.status === 'requested' && !iAmProvider && (
          <button
            className="btn btn-outline"
            disabled={busy}
            onClick={() => confirm('確定撤回這筆索取？') && run(actions.cancelMyOrder(o.id, ''), '已撤回，凍結點數已退回')}
          >
            撤回索取
          </button>
        )}
        {o.status === 'accepted' && (
          <>
            {!myDone && (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => run(actions.markDone(o.id), (done) => (done ? '交易完成！記得給對方評價' : '已確認，等待對方確認'))}
              >
                面交完成
              </button>
            )}
            {!myDone && !otherDone && (
              <button className="btn btn-outline" onClick={() => setDialog('cancel')}>
                取消交易
              </button>
            )}
            <button className="btn btn-ghost text-m-rose" onClick={() => setDialog('dispute')}>
              提出爭議
            </button>
          </>
        )}
        {canReview && (
          <button className="btn btn-primary" onClick={() => setDialog('review')}>
            <Star className="size-4" />
            評價對方
          </button>
        )}
        {!inChat && chatOpen(o) && (
          <Link href={chatPath(o.id)} className="btn btn-outline relative">
            <MessageCircle className="size-4" />
            聊天
            {unread > 0 && (
              <span className="ml-1 rounded-full bg-m-rose px-1.5 text-[11px] font-bold text-white">{unread}</span>
            )}
          </Link>
        )}
      </div>

      <Modal
        open={dialog === 'decline' || dialog === 'cancel' || dialog === 'dispute'}
        title={dialog === 'decline' ? '婉拒索取' : dialog === 'cancel' ? '取消交易' : '提出爭議'}
        onClose={() => setDialog(null)}
      >
        <p className="mb-3 text-sm text-slate-600">
          {dialog === 'decline' && '可以簡單說明原因（選填），對方會看到。'}
          {dialog === 'cancel' && '面交前可以取消。點數會退回給索取者。'}
          {dialog === 'dispute' && '面交發生問題（例如對方沒出現、東西和描述不符）？管理員會介入處理，處理完前點數維持凍結。'}
        </p>
        <textarea
          className="input"
          rows={3}
          maxLength={200}
          placeholder={dialog === 'decline' ? '例如：已經送給鄰居了' : '請說明原因'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className={`btn mt-4 w-full ${dialog === 'dispute' ? 'btn-danger' : 'btn-primary'}`}
          disabled={busy}
          onClick={() => {
            if (dialog === 'decline') run(actions.declineOrder(o.id, text), '已婉拒');
            if (dialog === 'cancel') run(actions.cancelMyOrder(o.id, text), '已取消交易');
            if (dialog === 'dispute') run(actions.openDispute(o.id, text), '已提出爭議，管理員會盡快處理');
          }}
        >
          確認
        </button>
      </Modal>

      <Modal open={dialog === 'review'} title={`評價 ${other?.name ?? ''}`} onClose={() => setDialog(null)}>
        <div className="mb-3 flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} onClick={() => setStars(i)} aria-label={`${i} 顆星`}>
              <Star className={`size-9 ${i <= stars ? 'fill-m-amber text-m-amber' : 'text-slate-300'}`} />
            </button>
          ))}
        </div>
        <textarea
          className="input"
          rows={3}
          maxLength={200}
          placeholder="分享這次交易的感受（選填）"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="mt-2 text-xs text-slate-500">雙方都評價後，或完成 {s.reviewWindowDays} 天後，評價才會公開。</p>
        <button className="btn btn-primary mt-4 w-full" disabled={busy} onClick={() => run(actions.submitReview(o.id, stars, text), '感謝你的評價')}>
          送出評價
        </button>
      </Modal>
    </div>
  );
}
