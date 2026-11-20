'use client';

import { useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import { MapView } from '@/components/map/MapView';
import { reverseLabel, searchPlaces, type Place } from '@/lib/geocode';
import type { LatLng } from '@/lib/types';

interface Props {
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  label: string;
  /** True while the label is the one the map filled in, so moving the pin may replace it. */
  labelAuto: boolean;
  onLabel: (label: string, auto: boolean) => void;
  /** Where the map starts before anything is chosen. */
  fallback: LatLng;
  mapClassName?: string;
  /** Shown on the map before a spot is picked. */
  hint?: string;
}

/**
 * Picks the meeting spot and its public name together: search a place, use the
 * current location, tap the map or drag the pin. The name follows the pin until
 * the user types their own.
 */
export function LocationPicker({
  value,
  onChange,
  label,
  labelAuto,
  onLabel,
  fallback,
  mapClassName = 'h-64',
  hint = '點地圖選擇面交地點',
}: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [naming, setNaming] = useState(false);
  const [msg, setMsg] = useState('');
  const [view, setView] = useState<LatLng>(value ?? fallback);
  const [zoom, setZoom] = useState(value ? 17 : 15);
  const seq = useRef(0);
  const auto = useRef(labelAuto);
  useEffect(() => {
    auto.current = labelAuto;
  }, [labelAuto]);

  const pick = (p: LatLng, knownLabel?: string) => {
    onChange(p);
    setMsg('');
    const n = ++seq.current;
    if (!auto.current) return;
    if (knownLabel) {
      onLabel(knownLabel, true);
      setNaming(false);
      return;
    }
    setNaming(true);
    reverseLabel(p)
      .then((s) => {
        if (n === seq.current && auto.current && s) onLabel(s, true);
      })
      .catch(() => {})
      .finally(() => {
        if (n === seq.current) setNaming(false);
      });
  };

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setMsg('');
    try {
      const found = await searchPlaces(q, value ?? fallback);
      setResults(found);
      if (!found.length) setMsg('找不到這個地點，換個說法試試，或直接點地圖選擇。');
    } catch {
      setResults(null);
      setMsg('地點搜尋暫時無法使用，請直接點地圖選擇。');
    } finally {
      setSearching(false);
    }
  };

  const choose = (pl: Place) => {
    setResults(null);
    setView(pl.point);
    setZoom(17);
    pick(pl.point, pl.label || undefined);
  };

  const locate = () => {
    if (!navigator.geolocation) return setMsg('這個瀏覽器不支援定位，請搜尋地點或直接點地圖。');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (g) => {
        setLocating(false);
        const p = { lat: g.coords.latitude, lng: g.coords.longitude };
        setView(p);
        setZoom(17);
        pick(p);
      },
      () => {
        setLocating(false);
        setMsg('無法取得你的位置，請搜尋地點或直接點地圖。');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            value={q}
            maxLength={60}
            aria-label="搜尋地點"
            placeholder="搜尋地點，例如：捷運大安站"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-outline" disabled={searching || !q.trim()}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : '搜尋'}
        </button>
      </form>

      {results && results.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50" onClick={() => choose(r)}>
                <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{r.label || r.detail}</span>
                  <span className="block truncate text-xs text-slate-500">{r.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn btn-ghost -ml-2 px-2 text-sm" onClick={locate} disabled={locating}>
        {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
        使用我目前的位置
      </button>

      <div className="relative">
        <MapView
          center={view}
          zoom={zoom}
          markers={value ? [{ id: 'pick', position: value, color: '#00A078', active: true, draggable: true }] : []}
          onMapClick={(p) => pick(p)}
          onMarkerDrag={(_, p) => pick(p)}
          className={mapClassName}
        />
        {!value && (
          <p className="pointer-events-none absolute inset-x-0 top-2 z-[500] mx-auto w-fit rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-slate-700 shadow">
            {hint}
          </p>
        )}
      </div>
      <p className={`text-xs ${value ? 'text-brand-dark' : 'text-slate-500'}`}>
        {value ? '已選好位置，可以拖曳圖釘微調。' : '還沒選擇位置：搜尋地點、使用目前位置，或直接點地圖。'}
        {msg && <span className="ml-1 font-semibold text-m-rose">{msg}</span>}
      </p>

      <div>
        <label className="label" htmlFor="area">
          地點名稱（公開顯示）
        </label>
        <div className="relative">
          <input
            id="area"
            className="input"
            maxLength={30}
            placeholder="例如：捷運大安站附近"
            value={label}
            onChange={(e) => onLabel(e.target.value, e.target.value === '')}
          />
          {naming && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-400" />}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          選好位置會自動帶入附近的路名或地標（不含門牌），也可以自己改。
          {!labelAuto && value && (
            <button
              type="button"
              className="ml-1 font-semibold text-brand-dark underline"
              onClick={() => {
                auto.current = true;
                onLabel(label, true);
                pick(value);
              }}
            >
              依地圖重新帶入
            </button>
          )}
        </p>
        <p className="mt-1 text-[11px] text-slate-400">地點搜尋：OpenStreetMap Nominatim</p>
      </div>
    </div>
  );
}
