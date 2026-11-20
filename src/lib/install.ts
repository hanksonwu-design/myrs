'use client';

/**
 * Adding Myrs to the home screen (PWA): registers the service worker, keeps the
 * browser's install offer (Chrome and Edge on Android and computers), and tells
 * which instructions fit the phone (iPhone Safari has no install button).
 */
import { useSyncExternalStore } from 'react';
import { BASE_PATH } from './links';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** inapp: LINE, Facebook or Instagram's own browser, which cannot install sites. */
export type InstallPlatform = 'ios' | 'android' | 'inapp' | 'desktop';

export interface InstallState {
  /** Already opened from the home screen, or just installed. */
  standalone: boolean;
  /** The browser offered to install, so our button can open its dialog. */
  canPrompt: boolean;
  platform: InstallPlatform;
  /** e.g. LINE, for 'inapp'. */
  appName: string;
}

let offer: InstallPromptEvent | null = null;
let installed = false;
let started = false;
let snap: InstallState | null = null;
const listeners = new Set<() => void>();

function compute(): InstallState {
  const ua = navigator.userAgent;
  const app = / Line\//i.test(ua) ? 'LINE' : /FBAN|FBAV/.test(ua) ? 'Facebook' : /Instagram/.test(ua) ? 'Instagram' : '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const platform: InstallPlatform = app ? 'inapp' : ios ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop';
  const standalone =
    installed ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { standalone, canPrompt: !!offer, platform, appName: app };
}

function emit() {
  snap = compute();
  listeners.forEach((l) => l());
}

/** Call once when the app starts. */
export function startInstall() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button instead of the browser's banner
    offer = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    offer = null;
    emit();
  });
  // Not while developing: the worker would get in the way of hot reload.
  if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch(() => {});
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnap = () => (snap ??= compute());

/** null while the page is pre-rendered. */
export function useInstall(): InstallState | null {
  return useSyncExternalStore(subscribe, getSnap, () => null);
}

/** Opens the browser's install dialog; true when the member installed. */
export async function promptInstall(): Promise<boolean> {
  const e = offer;
  if (!e) return false;
  offer = null; // the browser offers once
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}
