'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Star, X } from 'lucide-react';
import type { Listing, Mode, OrderStatus, User } from '@/lib/types';
import { MODE_LABEL, ORDER_STATUS_LABEL } from '@/lib/rules';
import { asset } from '@/lib/links';

export function Avatar({ user, size = 40 }: { user: Pick<User, 'name' | 'color'> | null; size?: number }) {
  const name = user?.name ?? '?';
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: user?.color ?? '#94a3b8', fontSize: size * 0.42 }}
      aria-hidden
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center" aria-label={`${value.toFixed(1)} 顆星`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= Math.round(value) ? 'fill-m-amber text-m-amber' : 'text-slate-300'}
        />
      ))}
    </span>
  );
}

export function ModeBadge({ listing, large }: { listing: Pick<Listing, 'mode' | 'pricePoints'>; large?: boolean }) {
  const cls = large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  const map: Record<Mode, string> = {
    free: 'bg-brand-soft text-brand-dark',
    points: 'bg-amber-50 text-amber-700',
    swap: 'bg-sky-50 text-sky-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full font-bold ${cls} ${map[listing.mode]}`}>
      {listing.mode === 'points' ? `${listing.pricePoints} 點` : MODE_LABEL[listing.mode]}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, string> = {
    requested: 'bg-amber-50 text-amber-700',
    accepted: 'bg-sky-50 text-sky-700',
    completed: 'bg-brand-soft text-brand-dark',
    cancelled: 'bg-slate-100 text-slate-500',
    disputed: 'bg-rose-50 text-m-rose',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${map[status]}`}>
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn btn-ghost -mr-2 px-2" onClick={onClose} aria-label="關閉">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">{icon}</div>
      <p className="font-bold text-slate-800">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset('/myrs-logo.png')} alt="Myrs" className="h-10 w-auto animate-pulse" />
      <span className="text-sm">載入中…</span>
    </div>
  );
}

export function NotFound({ text }: { text: string }) {
  return (
    <div className="py-16 text-center">
      <p className="text-slate-500">{text}</p>
      <Link href="/" className="btn btn-outline mt-4">
        回到附近
      </Link>
    </div>
  );
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-xl font-bold sm:text-2xl">{children}</h1>
      {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
    </div>
  );
}
