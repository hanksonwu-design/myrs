'use client';

import { useEffect } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng } from '@/lib/types';

export interface MapMarker {
  id: string;
  position: LatLng;
  color: string;
  label?: string;
  active?: boolean;
}

export interface MapViewProps {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  radiusKm?: number;
  fuzzyCircle?: LatLng; // public "approximately here" circle
  fuzzyRadiusM?: number;
  userPosition?: LatLng | null;
  onMarkerClick?: (id: string) => void;
  onMapClick?: (p: LatLng) => void;
  className?: string;
}

function pin(color: string, active: boolean) {
  const size = active ? 34 : 28;
  return L.divIcon({
    className: 'myrs-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="10" r="2.6" fill="white"/></svg>`,
  });
}

const youIcon = L.divIcon({
  className: 'myrs-pin',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: '<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#00A8E8;border:3px solid white;box-shadow:0 0 0 2px rgba(0,168,232,.35)"></span>',
});

function Recenter({ center, zoom }: { center: LatLng; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom ?? map.getZoom(), { animate: true });
  }, [center.lat, center.lng, zoom, map]);
  return null;
}

function ClickHandler({ onMapClick }: { onMapClick?: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FixSize() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

export default function MapInner({
  center,
  zoom = 15,
  markers = [],
  radiusKm,
  fuzzyCircle,
  fuzzyRadiusM = 200,
  userPosition,
  onMarkerClick,
  onMapClick,
  className = 'h-80',
}: MapViewProps) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 ${className}`}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Recenter center={center} zoom={zoom} />
        <FixSize />
        <ClickHandler onMapClick={onMapClick} />
        {radiusKm && (
          <Circle
            center={[center.lat, center.lng]}
            radius={radiusKm * 1000}
            pathOptions={{ color: '#00A078', weight: 1.5, fillOpacity: 0.04, dashArray: '6 6' }}
          />
        )}
        {fuzzyCircle && (
          <Circle
            center={[fuzzyCircle.lat, fuzzyCircle.lng]}
            radius={fuzzyRadiusM}
            pathOptions={{ color: '#00A078', weight: 1.5, fillOpacity: 0.15 }}
          />
        )}
        {userPosition && <Marker position={[userPosition.lat, userPosition.lng]} icon={youIcon} />}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.position.lat, m.position.lng]}
            icon={pin(m.color, !!m.active)}
            zIndexOffset={m.active ? 1000 : 0}
            eventHandlers={{ click: () => onMarkerClick?.(m.id) }}
          >
            {m.label && <Tooltip direction="top" offset={[0, -26]}>{m.label}</Tooltip>}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
