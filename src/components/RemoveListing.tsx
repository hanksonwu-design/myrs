'use client';

import { useState } from 'react';
import { Ban } from 'lucide-react';
import { IS_REMOTE } from '@/lib/backend';
import { actions } from '@/lib/store';
import type { Listing } from '@/lib/types';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/Providers';

const PRESETS = ['不符合刊登規則', '販售禁售品', '疑似詐騙或轉賣', '內容不實或重複刊登', '不當內容'];

/** Staff removal of any listing, with a reason the owner is told. */
export function RemoveListingButton({ listing, className, onDone }: { listing: Listing; className?: string; onDone?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(PRESETS[0]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const r = await actions.adminSetListingStatus(listing.id, 'removed', reason);
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    setOpen(false);
    toast(IS_REMOTE ? '已下架，並寄信通知刊登者' : '已下架');
    onDone?.();
  };

  return (
    <>
      <button
        className={className ?? 'btn btn-danger py-1.5'}
        onClick={() => {
          setReason(PRESETS[0]);
          setOpen(true);
        }}
      >
        <Ban className="size-4" />
        下架
      </button>
      <Modal open={open} title={`下架「${listing.title}」`} onClose={() => setOpen(false)}>
        <p className="mb-3 text-sm text-slate-500">
          下架後其他人就看不到這則刊登，進行中的索取會自動取消並退回凍結點數。{IS_REMOTE && '刊登者會收到 Email 通知和下架原因。'}
        </p>
        <p className="label">下架原因</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p} type="button" className={`chip ${reason === p ? 'chip-on' : 'chip-off'}`} onClick={() => setReason(p)}>
              {p}
            </button>
          ))}
        </div>
        <textarea
          className="input min-h-20"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="下架原因"
        />
        <p className="mt-1 text-right text-xs text-slate-400">{reason.length}/200</p>
        <button className="btn btn-danger mt-3 w-full" disabled={busy || !reason.trim()} onClick={submit}>
          確認下架
        </button>
      </Modal>
    </>
  );
}
