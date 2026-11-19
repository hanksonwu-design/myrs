'use client';

import dynamic from 'next/dynamic';
import type { MapViewProps } from './MapInner';

// Leaflet touches `window`, so it only renders in the browser.
const MapInner = dynamic(() => import('./MapInner'), {
  ssr: false,
  loading: () => <div className="h-full min-h-48 w-full animate-pulse rounded-2xl bg-slate-200" />,
});

export function MapView(props: MapViewProps) {
  return <MapInner {...props} />;
}

export type { MapMarker, MapViewProps } from './MapInner';
