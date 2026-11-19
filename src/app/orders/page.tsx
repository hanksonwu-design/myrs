'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftRight } from 'lucide-react';
import { OPEN_STATUSES, useDB } from '@/lib/store';
import { OrderCard } from '@/components/OrderCard';
import { Empty, Loading, PageTitle } from '@/components/ui';
import { useRequireLogin } from '@/components/hooks';

function OrdersInner() {
  const d = useDB()!;
  const user = useRequireLogin(d);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get('tab') === 'provide' ? 'provide' : 'request';
  const filter = params.get('f') === 'done' ? 'done' : 'open';
  if (!user) return <Loading />;

  const mine = d.orders.filter((o) => (tab === 'provide' ? o.providerId === user.id : o.requesterId === user.id));
  const shown = mine
    .filter((o) => (filter === 'open' ? OPEN_STATUSES.includes(o.status) : !OPEN_STATUSES.includes(o.status)))
    .sort((a, b) => b.createdAt - a.createdAt);
  const count = (t: 'request' | 'provide') =>
    d.orders.filter(
      (o) => (t === 'provide' ? o.providerId === user.id : o.requesterId === user.id) && OPEN_STATUSES.includes(o.status),
    ).length;
  const go = (t: string, f: string) => router.replace(`${pathname}?tab=${t}&f=${f}`);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle sub="索取、接受、面交、完成，都在這裡處理">交易</PageTitle>
      <div className="mb-3 grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1">
        {(
          [
            ['request', '我索取的'],
            ['provide', '我提供的'],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => go(t, filter)}
            className={`rounded-xl py-2 text-sm font-bold ${tab === t ? 'bg-white text-brand-dark shadow-sm' : 'text-slate-600'}`}
          >
            {label}
            {count(t) > 0 && <span className="ml-1 text-xs text-slate-400">({count(t)})</span>}
          </button>
        ))}
      </div>
      <div className="mb-4 flex gap-2">
        <button className={`chip ${filter === 'open' ? 'chip-on' : 'chip-off'}`} onClick={() => go(tab, 'open')}>
          進行中
        </button>
        <button className={`chip ${filter === 'done' ? 'chip-on' : 'chip-off'}`} onClick={() => go(tab, 'done')}>
          已結束
        </button>
      </div>
      {shown.length === 0 ? (
        <Empty
          icon={<ArrowLeftRight className="size-6" />}
          title={filter === 'open' ? '沒有進行中的交易' : '還沒有結束的交易'}
          text={tab === 'request' ? '到附近看看有什麼需要的吧。' : '刊登多餘的東西，讓鄰居來索取。'}
          action={
            <Link href={tab === 'request' ? '/' : '/post'} className="btn btn-primary">
              {tab === 'request' ? '看看附近' : '發布分享'}
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((o) => (
            <OrderCard key={o.id} d={d} order={o} viewerId={user.id} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersInner />
    </Suspense>
  );
}
