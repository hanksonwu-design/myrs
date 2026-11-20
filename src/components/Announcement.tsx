'use client';

import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { announcementOn } from '@/lib/rules';
import { nowOf } from '@/lib/store';
import type { DB } from '@/lib/types';

const CLOSED_KEY = 'myrs-announcement-closed';

/** The owner's site-wide announcement; closing it hides it until a new one is posted. */
export function Announcement({ d }: { d: DB }) {
  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => {
    // Read after mount: the page is pre-rendered without localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClosed(localStorage.getItem(CLOSED_KEY));
  }, []);

  const s = d.site;
  if (!announcementOn(s, nowOf(d))) return null;
  const id = String(s.announcementAt ?? s.announcement);
  if (closed === id) return null;

  return (
    <div role="status" className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="flex-1 whitespace-pre-line">
        <b className="mr-1">公告</b>
        {s.announcement}
      </p>
      <button
        className="-m-1 rounded-lg p-1 text-amber-700 hover:bg-amber-100"
        aria-label="關閉公告"
        onClick={() => {
          localStorage.setItem(CLOSED_KEY, id);
          setClosed(id);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
