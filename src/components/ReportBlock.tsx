'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Flag } from 'lucide-react';
import { actions, currentUser, useDB } from '@/lib/store';
import { Modal } from './ui';
import { useToast } from './Providers';

const NOUN = { listing: '刊登', user: '使用者', want: '徵求' } as const;

const REASONS: Record<keyof typeof NOUN, string[]> = {
  listing: ['違禁品或不允許的食品', '疑似詐騙或轉賣', '內容與實物不符', '騷擾或不當言語', '其他'],
  user: ['違禁品或不允許的食品', '疑似詐騙或轉賣', '內容與實物不符', '騷擾或不當言語', '其他'],
  want: ['想要違禁品或不允許的物品', '疑似詐騙或廣告', '重複張貼', '騷擾或不當言語', '其他'],
};

export function ReportButton({ targetType, targetId }: { targetType: keyof typeof NOUN; targetId: string }) {
  const d = useDB()!;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const reasons = REASONS[targetType];
  const [reason, setReason] = useState(reasons[0]);
  const [detail, setDetail] = useState('');

  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const text = reason === '其他' ? detail : detail ? `${reason}：${detail}` : reason;
    setBusy(true);
    const r = await actions.report(targetType, targetId, text);
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    setOpen(false);
    toast(r.value ? `已收到檢舉，這則${NOUN[targetType]}先暫時隱藏等待審核` : '已收到檢舉，管理員會盡快處理');
  };

  return (
    <>
      <button
        className="btn btn-ghost px-2 text-slate-500"
        onClick={() => (currentUser(d) ? setOpen(true) : router.push('/login'))}
      >
        <Flag className="size-4" />
        檢舉
      </button>
      <Modal
        open={open}
        title={targetType === 'user' ? '檢舉這位使用者' : `檢舉這則${NOUN[targetType]}`}
        onClose={() => setOpen(false)}
      >
        <div className="space-y-2">
          {reasons.map((r) => (
            <label key={r} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm">
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="accent-brand" />
              {r}
            </label>
          ))}
        </div>
        <textarea
          className="input mt-3"
          rows={3}
          maxLength={200}
          placeholder="補充說明（選填）"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
        <p className="mt-2 text-xs text-slate-500">
          同一則刊登或徵求被 {d.settings.reportHideThreshold} 位以上使用者檢舉，會先自動隱藏，等管理團隊確認。
        </p>
        <button className="btn btn-primary mt-4 w-full" disabled={busy} onClick={submit}>
          送出檢舉
        </button>
      </Modal>
    </>
  );
}

export function BlockButton({ userId }: { userId: string }) {
  const d = useDB()!;
  const toast = useToast();
  const me = currentUser(d);
  if (!me || me.id === userId) return null;
  const blocked = me.blocked.includes(userId);
  return (
    <button
      className="btn btn-ghost px-2 text-slate-500"
      onClick={async () => {
        if (!blocked && !confirm('封鎖後，你們彼此看不到刊登，也不能索取或聊天；你們之間還沒開始的交易會自動取消。確定封鎖？')) return;
        const r = await actions.toggleBlock(userId);
        if (!r.ok) return toast(r.error, 'error');
        toast(r.value ? '已封鎖' : '已解除封鎖');
      }}
    >
      <Ban className="size-4" />
      {blocked ? '解除封鎖' : '封鎖'}
    </button>
  );
}
