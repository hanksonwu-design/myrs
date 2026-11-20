'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleX, Info } from 'lucide-react';
import { actions } from '@/lib/store';
import { rememberInvite } from '@/lib/invite';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const show = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = next.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  // A shared link's invite code, kept until the visitor signs up.
  useEffect(() => rememberInvite(), []);

  // Time-based rules (request timeout, auto-complete, food expiry).
  useEffect(() => {
    const t = setInterval(() => actions.tick(), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-[3000] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex max-w-md items-start gap-2 rounded-xl bg-slate-900/95 px-4 py-3 text-sm text-white shadow-lg"
          >
            {t.kind === 'success' && <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />}
            {t.kind === 'error' && <CircleX className="mt-0.5 size-4 shrink-0 text-rose-300" />}
            {t.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-sky-300" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
