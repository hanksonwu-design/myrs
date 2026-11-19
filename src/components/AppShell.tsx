'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeftRight, Coins, MapPin, MessageCircle, Plus, Shield, User as UserIcon } from 'lucide-react';
import { balanceOf, currentUser, pendingActions, unreadTotal, useDB } from '@/lib/store';
import { PILOT_NAME } from '@/lib/geo';
import { Avatar, Loading } from './ui';
import { IS_REMOTE } from '@/lib/backend';
import { asset } from '@/lib/links';

const NAV = [
  { href: '/', label: '附近', icon: MapPin },
  { href: '/orders', label: '交易', icon: ArrowLeftRight },
  { href: '/post', label: '發布', icon: Plus },
  { href: '/messages', label: '訊息', icon: MessageCircle },
  { href: '/me', label: '我的', icon: UserIcon },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' || pathname.startsWith('/listings') : pathname.startsWith(href);
}

/** This page with its query (detail pages keep their id in ?id=), for the login "next" link. */
function hereWithQuery(pathname: string) {
  return pathname + (typeof window === 'undefined' ? '' : window.location.search);
}

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-m-rose px-1 text-center text-[10px] font-bold leading-4 text-white">
      {n > 9 ? '9+' : n}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const d = useDB();
  const pathname = usePathname();
  const router = useRouter();
  const user = d ? currentUser(d) : null;
  // Signed in with Supabase but no profile yet: finish sign-up (nickname) first.
  const needsSignup = d?.auth?.state === 'needs_signup';
  useEffect(() => {
    if (needsSignup && pathname !== '/login') router.replace(`/login?next=${encodeURIComponent(hereWithQuery(pathname))}`);
  }, [needsSignup, pathname, router]);
  const unread = d && user ? unreadTotal(d, user.id) : 0;
  const pending = d && user ? pendingActions(d, user.id) : 0;
  const inChatRoom = /^\/messages\/.+/.test(pathname);
  const counts: Record<string, number> = { '/messages': unread, '/orders': pending };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Myrs 首頁">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset('/myrs-logo.png')} alt="Myrs" className="h-7 w-auto" />
            <span className="hidden rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-dark sm:inline">
              {PILOT_NAME}試點
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="主要">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  href === '/post'
                    ? 'ml-1 bg-brand text-white hover:bg-brand-dark'
                    : isActive(pathname, href)
                      ? 'bg-brand-soft text-brand-dark'
                      : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="relative">
                  <Icon className="size-4" />
                  <CountBadge n={counts[href] ?? 0} />
                </span>
                {label}
              </Link>
            ))}
            {user?.role === 'admin' && (
              <Link
                href="/admin"
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold ${
                  pathname.startsWith('/admin') ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Shield className="size-4" />
                後台
              </Link>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {d && user ? (
              <>
                {user.role === 'admin' && (
                  <Link href="/admin" className="btn btn-ghost px-2 md:hidden" aria-label="管理後台">
                    <Shield className="size-5" />
                  </Link>
                )}
                <Link
                  href="/me/wallet"
                  className="flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-700"
                  title="我的點數"
                >
                  <Coins className="size-4" />
                  {balanceOf(d, user.id)} 點
                </Link>
                <Link href="/me" className="hidden md:block" aria-label="我的">
                  <Avatar user={user} size={34} />
                </Link>
              </>
            ) : d ? (
              <Link
                href={pathname === '/login' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`}
                onClick={(e) => {
                  if (pathname === '/login') return;
                  // The query (?id=) is only known in the browser, so add it on click.
                  e.preventDefault();
                  router.push(`/login?next=${encodeURIComponent(hereWithQuery(pathname))}`);
                }}
                className="btn btn-primary py-2"
              >
                登入
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {d?.loadError && (
        <div role="alert" className="bg-m-rose px-4 py-2 text-center text-sm text-white">
          無法載入資料：{d.loadError}
        </div>
      )}

      <main className={`mx-auto w-full max-w-6xl flex-1 px-4 pt-4 ${inChatRoom ? 'pb-4' : 'pb-28 md:pb-12'}`}>
        {d ? children : <Loading />}
      </main>

      <footer className="hidden border-t border-slate-200 py-6 text-center text-xs text-slate-400 md:block">
        Myrs 你的我的共享平台 · 分享吾需⇄換取所需 ·{' '}
        <Link href="/about" className="underline hover:text-brand">
          關於與規則
        </Link>
        <br />
        {IS_REMOTE ? '試點版：資料存放在 Myrs 資料庫。' : '示範版：所有資料只存在這個瀏覽器，不會上傳。'}
      </footer>

      {!inChatRoom && (
        <nav
          className="fixed inset-x-0 bottom-0 z-[1100] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
          aria-label="主要"
        >
          <div className="mx-auto grid max-w-md grid-cols-5">
            {NAV.map(({ href, label, icon: Icon }) =>
              href === '/post' ? (
                <Link key={href} href={href} className="flex flex-col items-center justify-center" aria-label="發布">
                  <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30">
                    <Plus className="size-6" />
                  </span>
                  <span className="mt-0.5 text-[11px] font-semibold text-brand-dark">{label}</span>
                </Link>
              ) : (
                <Link
                  key={href}
                  href={href}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
                    isActive(pathname, href) ? 'text-brand-dark' : 'text-slate-500'
                  }`}
                >
                  <span className="relative">
                    <Icon className="size-5" />
                    <CountBadge n={counts[href] ?? 0} />
                  </span>
                  {label}
                </Link>
              ),
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
