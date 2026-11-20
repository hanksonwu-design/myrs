'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { currentUser } from '@/lib/store';
import { PILOT_CENTER } from '@/lib/geo';
import type { DB, LatLng, User } from '@/lib/types';

/** The current page with its query (?id=…), which only the browser knows in a static export. */
export function hereWithQuery(pathname: string) {
  return pathname + (typeof window === 'undefined' ? '' : window.location.search);
}

/**
 * Redirects to /login when nobody is signed in, coming back to this exact page afterwards
 * (a mailed link like /messages/view?id=… keeps its id). Returns the user once known.
 */
export function useRequireLogin(d: DB | null): User | null {
  const router = useRouter();
  const pathname = usePathname();
  const user = d ? currentUser(d) : null;
  useEffect(() => {
    if (d && !user) router.replace(`/login?next=${encodeURIComponent(hereWithQuery(pathname))}`);
  }, [d, user, router, pathname]);
  return user;
}

const POS_KEY = 'myrs-my-position';

/** Where "附近" is measured from: the browser location if shared, else the pilot centre. */
export function useMyPosition() {
  const [pos, setPos] = useState<{ point: LatLng; source: 'pilot' | 'gps' }>({ point: PILOT_CENTER, source: 'pilot' });
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(POS_KEY);
      if (raw) setPos({ point: JSON.parse(raw) as LatLng, source: 'gps' });
    } catch {
      /* ignore */
    }
  }, []);

  const locate = (onError: (msg: string) => void) => {
    if (!navigator.geolocation) {
      onError('這個瀏覽器不支援定位');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const point = { lat: p.coords.latitude, lng: p.coords.longitude };
        sessionStorage.setItem(POS_KEY, JSON.stringify(point));
        setPos({ point, source: 'gps' });
        setLocating(false);
      },
      () => {
        setLocating(false);
        onError('無法取得位置，先用試點區中心（大安森林公園）');
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  const reset = () => {
    sessionStorage.removeItem(POS_KEY);
    setPos({ point: PILOT_CENTER, source: 'pilot' });
  };

  return { ...pos, locating, locate, reset };
}
