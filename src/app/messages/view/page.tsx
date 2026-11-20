'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ImagePlus, MapPin, Navigation, Send } from 'lucide-react';
import { actions, chatOpen, counterpartId, isParty, listingById, orderById, useDB, userById } from '@/lib/store';
import { formatDateTime, formatTime } from '@/lib/format';
import { compressImage } from '@/lib/image';
import { MapView } from '@/components/map/MapView';
import { OrderCard } from '@/components/OrderCard';
import { Avatar, Loading, NotFound } from '@/components/ui';
import { useRequireLogin } from '@/components/hooks';
import { useToast } from '@/components/Providers';
import { userPath } from '@/lib/links';
import { directionsUrl } from '@/lib/geocode';

function ChatPage() {
  const id = useSearchParams().get('id') ?? '';
  const d = useDB()!;
  const user = useRequireLogin(d);
  const toast = useToast();
  const [text, setText] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const o = orderById(d, id);
  const msgs = d.messages.filter((m) => m.orderId === id).sort((a, b) => a.createdAt - b.createdAt);

  useEffect(() => {
    if (user && o && isParty(o, user.id)) actions.markRead(o.id);
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length, user, o]);

  if (!user) return <Loading />;
  if (!o || !isParty(o, user.id) || !chatOpen(o)) return <NotFound text="找不到這個對話。" />;
  const other = userById(d, counterpartId(o, user.id));
  const l = listingById(d, o.listingId);
  const canSend = o.status !== 'cancelled';

  const send = async (image: string | null = null) => {
    if (sending) return;
    setSending(true);
    const r = await actions.sendMessage(o.id, text, image);
    setSending(false);
    if (!r.ok) return toast(r.error, 'error');
    setText('');
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-5.5rem)] max-w-2xl flex-col">
      <div className="mb-2 flex items-center gap-2">
        <Link href="/messages" className="btn btn-ghost -ml-3 px-2" aria-label="返回訊息">
          <ChevronLeft className="size-5" />
        </Link>
        <Avatar user={other} size={32} />
        <Link href={userPath(other?.id)} className="font-bold hover:underline">
          {other?.name}
        </Link>
      </div>

      <OrderCard d={d} order={o} viewerId={user.id} inChat />

      {l && (o.status === 'accepted' || o.status === 'disputed') && (
        <div className="mt-2 rounded-2xl border border-brand/30 bg-brand-soft/60 p-3 text-sm">
          <button className="flex w-full items-center gap-2 text-left" onClick={() => setShowMap((v) => !v)}>
            <MapPin className="size-4 shrink-0 text-brand" />
            <span className="flex-1">
              <b>精確面交地點：</b>
              {l.areaLabel}・{l.timeSlots}
            </span>
            <span className="text-xs font-semibold text-brand-dark">{showMap ? '收起地圖' : '看地圖'}</span>
          </button>
          {showMap && (
            <div className="mt-2">
              <MapView center={l.location} zoom={17} markers={[{ id: 'meet', position: l.location, color: '#00A078' }]} className="h-48" />
              <a
                href={directionsUrl(l.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline mt-2 w-full bg-white"
              >
                <Navigation className="size-4" />
                用 Google 地圖導航
              </a>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-2xl bg-white p-3">
        {msgs.map((m) =>
          m.senderId === null ? (
            <p key={m.id} className="mx-auto max-w-sm rounded-full bg-slate-100 px-3 py-1 text-center text-xs text-slate-500">
              {m.body}
              <span className="ml-1 text-slate-400">{formatDateTime(m.createdAt)}</span>
            </p>
          ) : (
            <div key={m.id} className={`flex items-end gap-1.5 ${m.senderId === user.id ? 'flex-row-reverse' : ''}`}>
              {m.senderId !== user.id && <Avatar user={other} size={26} />}
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  m.senderId === user.id ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-slate-100 text-slate-800'
                }`}
              >
                {m.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.image} alt="傳送的照片" className="mb-1 max-h-60 rounded-lg" />
                )}
                {m.body && <p className="whitespace-pre-line break-words">{m.body}</p>}
              </div>
              <span className="text-[10px] text-slate-400">{formatTime(m.createdAt)}</span>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      {canSend ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <button type="button" className="btn btn-outline px-3" onClick={() => fileRef.current?.click()} aria-label="傳送照片">
            <ImagePlus className="size-4" />
          </button>
          <input
            className="input"
            placeholder="輸入訊息…"
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="訊息"
          />
          <button className="btn btn-primary px-3" disabled={!text.trim() || sending} aria-label="送出">
            <Send className="size-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                await send(await compressImage(file, 700, 0.7));
              } catch (err) {
                toast(err instanceof Error ? err.message : '照片處理失敗', 'error');
              }
            }}
          />
        </form>
      ) : (
        <p className="mt-2 text-center text-sm text-slate-400">交易已取消，無法再傳訊息。</p>
      )}
    </div>
  );
}

// useSearchParams needs a Suspense boundary in a static export.
export default function Page() {
  return (
    <Suspense>
      <ChatPage />
    </Suspense>
  );
}
