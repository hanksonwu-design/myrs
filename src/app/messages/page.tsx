'use client';

import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { chatOpen, counterpartId, isParty, listingById, nowOf, unreadIn, useDB, userById } from '@/lib/store';
import { timeAgo } from '@/lib/format';
import { ListingThumb } from '@/components/ListingVisuals';
import { Avatar, Empty, Loading, OrderStatusBadge, PageTitle } from '@/components/ui';
import { useRequireLogin } from '@/components/hooks';
import { chatPath } from '@/lib/links';

export default function MessagesPage() {
  const d = useDB()!;
  const user = useRequireLogin(d);
  if (!user) return <Loading />;
  const now = nowOf(d);

  const threads = d.orders
    .filter((o) => isParty(o, user.id) && chatOpen(o))
    .map((o) => {
      const msgs = d.messages.filter((m) => m.orderId === o.id);
      const last = msgs.reduce((a, b) => (b.createdAt > a.createdAt ? b : a), msgs[0]);
      return { o, last, unread: unreadIn(d, user.id, o.id) };
    })
    .sort((a, b) => (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0));

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle sub="提供者接受索取後，聊天室才會開啟">訊息</PageTitle>
      {threads.length === 0 ? (
        <Empty icon={<MessageCircle className="size-6" />} title="還沒有對話" text="索取被接受後，就能在這裡和對方約時間地點。" />
      ) : (
        <ul className="card divide-y divide-slate-100 overflow-hidden">
          {threads.map(({ o, last, unread }) => {
            const other = userById(d, counterpartId(o, user.id));
            const l = listingById(d, o.listingId);
            return (
              <li key={o.id}>
                <Link href={chatPath(o.id)} className="flex items-center gap-3 p-3 hover:bg-slate-50">
                  <Avatar user={other} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{other?.name}</span>
                      <OrderStatusBadge status={o.status} />
                      <span className="ml-auto shrink-0 text-xs text-slate-400">{last ? timeAgo(last.createdAt, now) : ''}</span>
                    </div>
                    <p className="truncate text-xs text-slate-500">{l?.title}</p>
                    <p className={`truncate text-sm ${unread ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
                      {last ? (last.senderId === null ? `［系統］${last.body}` : last.image && !last.body ? '［照片］' : last.body) : ''}
                    </p>
                  </div>
                  {l && <ListingThumb listing={l} className="size-11 shrink-0 rounded-lg" />}
                  {unread > 0 && (
                    <span className="min-w-5 rounded-full bg-m-rose px-1.5 text-center text-xs font-bold leading-5 text-white">{unread}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
