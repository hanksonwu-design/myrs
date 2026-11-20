'use client';

import { useEffect, useState } from 'react';
import { Copy, MessageCircle, Share2 } from 'lucide-react';
import { currentUser, useDB } from '@/lib/store';
import { lineShareUrl, shareLink } from '@/lib/invite';
import { Modal } from './ui';
import { useToast } from './Providers';

/** LINE, copy, and the phone's own share sheet when it has one. */
export function ShareActions({ url, text }: { url: string; text: string }) {
  const toast = useToast();
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast('已複製，可以貼到群組或訊息裡');
    } catch {
      toast('無法複製，請長按下方連結自己複製', 'error');
    }
  };

  const more = async () => {
    try {
      await navigator.share({ title: 'Myrs', text, url });
    } catch {
      /* closed without sharing */
    }
  };

  return (
    <div className="space-y-2">
      <a
        href={lineShareUrl(url, text)}
        target="_blank"
        rel="noopener noreferrer"
        className="btn w-full bg-[#06C755] text-white hover:bg-[#05b34c]"
      >
        <MessageCircle className="size-4" />
        分享到 LINE
      </a>
      <div className="flex gap-2">
        <button type="button" className="btn btn-outline flex-1" onClick={copy}>
          <Copy className="size-4" />
          複製文字和連結
        </button>
        {canShare && (
          <button type="button" className="btn btn-outline flex-1" onClick={more}>
            <Share2 className="size-4" />
            其他 App
          </button>
        )}
      </div>
      <input
        className="input text-xs text-slate-500"
        readOnly
        value={url}
        aria-label="分享連結"
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}

/** "分享" for a listing or want; the link carries the sharer's invite code. */
export function ShareButton({ path, text, title }: { path: string; text: string; title: string }) {
  const d = useDB()!;
  const me = currentUser(d);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const reward = d.settings.inviteReward;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost px-2 text-slate-500"
        onClick={() => {
          setUrl(shareLink(path, me?.inviteCode));
          setOpen(true);
        }}
      >
        <Share2 className="size-4" />
        分享
      </button>
      <Modal open={open} title={title} onClose={() => setOpen(false)}>
        <p className="mb-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{text}</p>
        {url && <ShareActions url={url} text={text} />}
        {me?.inviteCode && reward > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            連結會帶你的邀請碼 {me.inviteCode}：鄰居從這個連結註冊，並完成第一筆交易（對象不能是你）後，你們各得 {reward} 點。
          </p>
        )}
      </Modal>
    </>
  );
}
