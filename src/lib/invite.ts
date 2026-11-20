'use client';

/**
 * Invite codes travel in shared links: /login?invite=CODE for an invite, and
 * ?ref=CODE on a shared listing or want. The code is kept in localStorage, so a
 * visitor who looks around first and signs up later is still invited.
 */
import { BASE_PATH } from './links';
import { normalizeInviteCode } from './rules';

const KEY = 'myrs-invite';
const KEEP_DAYS = 30;
const CODE_RE = /^[A-Z0-9]{6}$/;

/** Called once per page load. */
export function rememberInvite() {
  try {
    const p = new URLSearchParams(window.location.search);
    const raw = p.get('invite') ?? p.get('ref');
    if (!raw) return;
    const code = normalizeInviteCode(raw);
    if (CODE_RE.test(code)) window.localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* storage unavailable: the code can still be typed in by hand */
  }
}

/** The remembered code, or '' when there is none or it is older than 30 days. */
export function pendingInvite(): string {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { code?: string; at?: number } | null;
    if (v?.code && CODE_RE.test(v.code) && Date.now() - (v.at ?? 0) < KEEP_DAYS * 86_400_000) return v.code;
  } catch {
    /* ignore */
  }
  return '';
}

export function clearInvite() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Full link to a page of the site, carrying the sharer's code when there is one. */
export function shareLink(path: string, code?: string, param: 'ref' | 'invite' = 'ref'): string {
  const url = new URL(`${BASE_PATH}${path}`, window.location.origin);
  if (code) url.searchParams.set(param, code);
  return url.toString();
}

export const inviteLink = (code: string) => shareLink('/login', code, 'invite');

/** LINE's share page; on phones it opens the LINE app. */
export const lineShareUrl = (url: string, text: string) =>
  `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
