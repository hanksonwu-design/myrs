'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Flag } from 'lucide-react';
import { actions, currentUser, useDB } from '@/lib/store';
import { Modal } from './ui';
import { useToast } from './Providers';

const REASONS = ['違禁品或不允許的食品', '疑似詐騙或轉賣', '內容與實物不符', '騷擾或不當言語', '其他'];

export function ReportButton({ targetType, targetId }: { targetType: 'listing' | 'user'; targetId: string }) {
  const d = useDB()!;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState('');

  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const text = reason === '其他' ? detail : detail ? `${reason}：${detail}` : reason;
    setBusy(true);
    const r = await actions.report(targetType, targetId, text);
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    setOpen(false);
    toast(r.value ? '已收到檢舉，這則刊登先暫時下架等待審核' : '已收到檢舉，管理員會盡快處理');
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
      <Modal open={open} title={targetType === 'listing' ? '檢舉這則刊登' : '檢舉這位使用者'} onClose={() => setOpen(false)}>
        <div className="space-y-2">
          {REASONS.map((r) => (
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
        <p className="mt-2 text-xs text-slate-500">同一則刊登被 {d.settings.reportHideThreshold} 位以上使用者檢舉會自動下架待審。</p>
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
