'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronRight } from 'lucide-react';
import { actions, nowOf, useDB } from '@/lib/store';
import { IS_REMOTE } from '@/lib/backend';
import { timeAgo } from '@/lib/format';
import type { Notice } from '@/lib/types';
import { Empty, Loading, PageTitle } from '@/components/ui';
import { useRequireLogin } from '@/components/hooks';

const LIMIT = 100;

function Item({ n, fresh, now }: { n: Notice; fresh: boolean; now: number }) {
  const inner = (
    <div className="flex items-start gap-3">
      <span
        className={`mt-2 size-2 shrink-0 rounded-full ${fresh ? 'bg-brand' : 'bg-transparent'}`}
        aria-label={fresh ? '新通知' : undefined}
      />
      <div className="min-w-0 flex-1">
        <p className={fresh ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}>{n.subject}</p>
        <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-slate-600">
          {/* Mail bodies have blank lines between paragraphs; one line break is enough here. */}
          {n.body.replace(/\n{2,}/g, '\n')}
        </p>
        <p className="mt-1 text-xs text-slate-400">{timeAgo(n.createdAt, now)}</p>
      </div>
      {n.link && <ChevronRight className="mt-1 size-4 shrink-0 text-slate-400" />}
    </div>
  );
  const cls = `block px-4 py-3 ${fresh ? 'bg-brand-soft/50' : ''}`;
  return n.link ? (
    <Link href={n.link} className={`${cls} transition hover:bg-slate-50`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export default function NotificationsPage() {
  const d = useDB()!;
  const user = useRequireLogin(d);
  // Unread when they showed up on this page: they stay highlighted after being marked read.
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  const mine = user
    ? d.notifications
        .filter((n) => n.userId === user.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, LIMIT)
    : [];
  const unreadKey = mine
    .filter((n) => n.readAt === null)
    .map((n) => n.id)
    .join(',');

  // Opening the page reads everything on it, including ones that arrive while it is open.
  useEffect(() => {
    if (!unreadKey) return;
    const ids = unreadKey.split(',');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFresh((prev) => new Set([...prev, ...ids]));
    void actions.markNotificationsRead(ids);
  }, [unreadKey]);

  if (!user) return <Loading />;
  const now = nowOf(d);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        sub={
          IS_REMOTE
            ? `最近 ${LIMIT} 則。這些通知也會寄到你的 Email。`
            : '示範模式：交易、徵求和邀請的通知會出現在這裡，不會寄信。'
        }
      >
        通知
      </PageTitle>
      {mine.length === 0 ? (
        <Empty
          icon={<Bell className="size-6" />}
          title="還沒有通知"
          text="有人索取你的刊登、接受你的索取、回應你的徵求，或交易有新進度時，會出現在這裡。"
        />
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden">
          {mine.map((n) => (
            <Item key={n.id} n={n} fresh={fresh.has(n.id)} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
