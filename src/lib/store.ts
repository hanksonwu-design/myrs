'use client';

/**
 * Data layer used by every page.
 *
 * Two backends share the same `DB` snapshot shape and the selectors below:
 *   - demo mode (no Supabase env vars): state lives in localStorage and the
 *     business rules from the development doc (sections 5, 6 and 10) run here;
 *   - Supabase mode: ./remote.ts loads the snapshot from Postgres and every
 *     write is a Postgres function with the same rules (supabase/migrations).
 * Pages call `actions.*`, which return a Promise<Result> in both modes.
 */
import { useSyncExternalStore } from 'react';
import { IS_REMOTE } from './backend';
import { remoteActions, remoteSnapshot, startRemote } from './remote';
import {
  calcFee,
  DEFAULT_SETTINGS,
  DEFAULT_SITE,
  findBannedWords,
  INVITE_DAYS,
  normalizeInviteCode,
  PHONE_RE,
  randomInviteCode,
  settingsChanges,
  WANT_DAILY_MAX,
  WANT_DAYS,
  WANT_MAX_ANSWERS,
  WANT_MAX_OPEN,
  wantOpen,
} from './rules';
import { createSeed, DB_VERSION, seedWants } from './seed';
import { fuzzLocation } from './geo';
import { DAY, HOUR, ymdLocal } from './format';
import { communityImpactOf } from './impact';
import type {
  AdminLevel,
  Category,
  CommunityImpact,
  DB,
  Invite,
  LatLng,
  LedgerEntry,
  Listing,
  MailStatus,
  Mode,
  Notice,
  Order,
  OrderStatus,
  Report,
  Review,
  SavedSearch,
  Settings,
  User,
  Want,
} from './types';
import { activeSuspension, formatUntil, hasLevel, LEVEL_LABEL, levelError, levelOf, suspensionNote } from './staff';

const KEY = 'myrs-demo-v1';
let db: DB | null = null;
const listeners = new Set<() => void>();

export type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const OPEN_STATUSES: OrderStatus[] = ['requested', 'accepted', 'disputed'];

export const nowOf = (d: DB) => Date.now() + d.clockOffsetMs;

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

// ---------------------------------------------------------------- persistence

function load(): DB {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      // Settings and collections added later get their defaults.
      if (parsed && parsed.version === DB_VERSION) {
        return {
          ...parsed,
          // Admins from before levels existed are owners.
          users: parsed.users
            .map((u) => (u.role === 'admin' && !u.adminLevel ? { ...u, adminLevel: 'owner' as const } : u))
            .map((u) => (u.inviteCode ? u : { ...u, inviteCode: randomInviteCode() })),
          favorites: parsed.favorites ?? [],
          savedSearches: parsed.savedSearches ?? [],
          suspensions: parsed.suspensions ?? [],
          wants: parsed.wants ?? seedWants(Date.now()),
          invites: parsed.invites ?? [],
          notifications: parsed.notifications ?? [],
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
          site: { ...DEFAULT_SITE, ...parsed.site },
        };
      }
    }
  } catch {
    /* fall through to a fresh seed */
  }
  return createSeed(Date.now());
}

function save(d: DB): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

function ensure(): DB {
  if (!db) {
    const d = load();
    runMaintenance(d);
    db = d;
    save(d);
  }
  return db;
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      db = null;
      emit();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

function subscribeRemote(l: () => void) {
  listeners.add(l);
  startRemote((d) => {
    db = d;
    emit();
  });
  return () => {
    listeners.delete(l);
  };
}

const remoteDB = () => db;

export function useDB(): DB | null {
  return useSyncExternalStore(IS_REMOTE ? subscribeRemote : subscribe, IS_REMOTE ? remoteDB : ensure, () => null);
}

function mutate<T>(fn: (d: DB) => Result<T>): Result<T> {
  const draft = structuredClone(ensure());
  const r = fn(draft);
  if (!r.ok) return r;
  if (!save(draft)) {
    return fail('瀏覽器儲存空間不足：請少放幾張照片，或到「我的 → 示範工具」重設資料。');
  }
  db = draft;
  emit();
  return r;
}

// ---------------------------------------------------------------- selectors

export function currentUser(d: DB): User | null {
  const u = d.users.find((x) => x.id === d.sessionUserId);
  return u && u.status === 'active' ? u : null;
}

export const userById = (d: DB, id: string | null) => d.users.find((u) => u.id === id) ?? null;
export const listingById = (d: DB, id: string) => d.listings.find((l) => l.id === id) ?? null;
export const orderById = (d: DB, id: string) => d.orders.find((o) => o.id === id) ?? null;
export const wantById = (d: DB, id: string) => d.wants.find((w) => w.id === id) ?? null;

/** The bell's number. */
export const unreadNotices = (d: DB, userId: string) =>
  d.notifications.filter((n) => n.userId === userId && n.readAt === null).length;

export function balanceOf(d: DB, userId: string): number {
  return d.ledger.filter((e) => e.userId === userId).reduce((s, e) => s + e.amount, 0);
}

export function heldOf(d: DB, userId: string): number {
  return d.orders
    .filter((o) => o.requesterId === userId && o.mode === 'points' && OPEN_STATUSES.includes(o.status))
    .reduce((s, o) => s + o.points, 0);
}

export function reviewPublished(d: DB, r: Review): boolean {
  const o = orderById(d, r.orderId);
  if (!o?.completedAt) return false;
  const both = d.reviews.filter((x) => x.orderId === r.orderId).length >= 2;
  return both || nowOf(d) - o.completedAt > d.settings.reviewWindowDays * DAY;
}

export function ratingOf(d: DB, userId: string): { avg: number; count: number } {
  const rs = d.reviews.filter((r) => r.revieweeId === userId && reviewPublished(d, r));
  if (!rs.length) return { avg: 0, count: 0 };
  return { avg: rs.reduce((s, r) => s + r.stars, 0) / rs.length, count: rs.length };
}

export const isParty = (o: Order, userId: string) => o.requesterId === userId || o.providerId === userId;
export const counterpartId = (o: Order, userId: string) =>
  o.requesterId === userId ? o.providerId : o.requesterId;

/** Chat opens once the provider accepts (doc section 5). */
export const chatOpen = (o: Order) => o.acceptedAt !== null;

export function unreadIn(d: DB, userId: string, orderId: string): number {
  const since = d.lastRead[`${userId}:${orderId}`] ?? 0;
  return d.messages.filter(
    (m) => m.orderId === orderId && m.createdAt > since && m.senderId !== userId,
  ).length;
}

export function unreadTotal(d: DB, userId: string): number {
  return d.orders
    .filter((o) => isParty(o, userId) && chatOpen(o))
    .reduce((s, o) => s + unreadIn(d, userId, o.id), 0);
}

/** Orders waiting for this user to act. */
export function pendingActions(d: DB, userId: string): number {
  return d.orders.filter(
    (o) =>
      (o.providerId === userId && o.status === 'requested') ||
      (isParty(o, userId) &&
        o.status === 'accepted' &&
        (o.requesterId === userId ? !o.requesterDoneAt : !o.providerDoneAt) &&
        (o.requesterDoneAt || o.providerDoneAt)),
  ).length;
}

function monthKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function rewardsThisMonth(d: DB, userId: string): number {
  const k = monthKey(nowOf(d));
  return d.ledger
    .filter((e) => e.userId === userId && e.type === 'reward' && monthKey(e.createdAt) === k)
    .reduce((s, e) => s + e.amount, 0);
}

export function isBlockedBetween(d: DB, a: string, b: string): boolean {
  const ua = userById(d, a);
  const ub = userById(d, b);
  return !!(ua?.blocked.includes(b) || ub?.blocked.includes(a));
}

/** Who may see the exact meeting spot: owner, admin or owner level staff, or a requester whose deal is on. */
export function canSeeExact(d: DB, l: Listing, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (l.ownerId === userId || hasLevel(userById(d, userId), 'admin')) return true;
  return d.orders.some(
    (o) =>
      o.listingId === l.id &&
      o.requesterId === userId &&
      (o.status === 'accepted' || o.status === 'disputed' || o.status === 'completed'),
  );
}

export const isFavorite = (d: DB, userId: string | null | undefined, listingId: string) =>
  !!userId && d.favorites.some((f) => f.userId === userId && f.listingId === listingId);

/** Completed deals: counted by the server in Supabase mode, from the orders in demo mode. */
export function completedDealsOf(d: DB, userId: string): number {
  const u = userById(d, userId);
  if (u?.completedDeals !== undefined) return u.completedDeals;
  return d.orders.filter((o) => o.status === 'completed' && isParty(o, userId)).length;
}

export type TrustTone = 'new' | 'high' | 'good' | 'ok' | 'low';
export interface Trust {
  score: number;
  label: string;
  tone: TrustTone;
  deals: number;
}

/**
 * Trust score 0–100 shown next to members. Starts at 50; completed deals add up to
 * 30 (2 each), the average rating moves it up to ±15 around 3 stars, and an
 * account older than 30 days adds 5.
 */
export function trustOf(d: DB, userId: string): Trust {
  const u = userById(d, userId);
  const deals = completedDealsOf(d, userId);
  const rating = ratingOf(d, userId);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const age = u ? (nowOf(d) - u.createdAt) / DAY : 0;
  const score = Math.round(
    clamp(
      50 + Math.min(30, deals * 2) + (rating.count ? clamp((rating.avg - 3) * 7.5, -15, 15) : 0) + (age >= 30 ? 5 : 0),
      0,
      100,
    ),
  );
  if (deals === 0) return { score, label: '新朋友', tone: 'new', deals };
  if (score >= 85) return { score, label: '非常可信', tone: 'high', deals };
  if (score >= 70) return { score, label: '可信', tone: 'good', deals };
  // Only low ratings can take the score under the starting 50, so 請留意 means
  // "people rated this member badly", never just "new here".
  if (score >= 50) return { score, label: '普通', tone: 'ok', deals };
  return { score, label: '請留意', tone: 'low', deals };
}

// ---------------------------------------------------------------- internal helpers

function addLedger(
  d: DB,
  e: Pick<LedgerEntry, 'userId' | 'type' | 'amount' | 'note'> & Partial<LedgerEntry>,
) {
  const t = nowOf(d);
  d.ledger.push({
    id: uid('e'),
    orderId: null,
    createdAt: t,
    expiresAt:
      e.type === 'reward' || e.type === 'signup_bonus'
        ? t + d.settings.rewardExpiryMonths * 30 * DAY
        : null,
    createdBy: null,
    ...e,
  });
}

function sysMsg(d: DB, orderId: string, body: string) {
  d.messages.push({ id: uid('m'), orderId, senderId: null, body, image: null, createdAt: nowOf(d) });
}

/** Same as private.notify: only active members get one. Supabase also e-mails it. */
function notify(d: DB, userId: string, subject: string, body: string, link = '') {
  if (userById(d, userId)?.status !== 'active') return;
  const n: Notice = { id: uid('n'), userId, subject: subject.slice(0, 200), body, link, createdAt: nowOf(d), readAt: null };
  d.notifications.push(n);
}

const chatLink = (o: Order) => `/messages/view?id=${o.id}`;
const titleOf = (d: DB, o: Order) => listingById(d, o.listingId)?.title ?? '刊登';

/** A listing answering a want went live: tell the member who wants it (private.on_listing_want). */
function notifyWantAnswer(d: DB, l: Listing) {
  const w = l.wantId ? wantById(d, l.wantId) : undefined;
  if (!w || l.status !== 'active' || !wantOpen(w, nowOf(d))) return;
  const price = l.mode === 'free' ? '免費' : l.mode === 'points' ? `${l.pricePoints} 點` : '以物易物';
  notify(
    d,
    w.userId,
    `有人回應你的徵求「${w.title}」`,
    `${nameOf(d, l.ownerId)} 刊登了「${l.title}」（${price}，${l.areaLabel}）回應你的徵求。\n\n想要的話，到刊登頁按「索取」。已經找到了，記得到徵求頁按「已經找到了」。`,
    `/listings/view?id=${l.id}`,
  );
}

function grantReward(d: DB, userId: string, amount: number, note: string): number {
  const give = Math.min(amount, d.settings.monthlyRewardCap - rewardsThisMonth(d, userId));
  if (give > 0) addLedger(d, { userId, type: 'reward', amount: give, note });
  return Math.max(0, give);
}

/**
 * userId just completed a deal with otherId. An invited member's first deal with
 * someone other than the inviter rewards both sides (same as private.settle_invite;
 * the demo has no e-mail aliases to check).
 */
function settleInvite(d: DB, userId: string, otherId: string) {
  const i = d.invites.find((x) => x.inviteeId === userId && x.rewardedAt === null);
  if (!i || i.inviterId === otherId) return;
  const amount = d.settings.inviteReward;
  if (amount > 0) {
    i.inviteePoints = grantReward(d, userId, amount, `受 ${nameOf(d, i.inviterId)} 邀請加入的獎勵`);
    if (userById(d, i.inviterId)?.status === 'active') {
      i.inviterPoints = grantReward(d, i.inviterId, amount, `邀請 ${nameOf(d, userId)} 加入的獎勵`);
    }
  }
  i.rewardedAt = nowOf(d);
  if (i.inviterPoints > 0) {
    notify(
      d,
      i.inviterId,
      `你邀請的 ${nameOf(d, userId)} 完成了第一筆交易`,
      `謝謝你邀請鄰居加入 Myrs！你得到 ${i.inviterPoints} 點邀請獎勵，可以在「我的點數」查看。`,
      '/me/wallet',
    );
  }
}

function nameOf(d: DB, id: string) {
  return userById(d, id)?.name ?? '使用者';
}

/** actor: the member whose action cancelled it; they are not notified. Null for time-based and staff changes. */
function cancelOrder(d: DB, o: Order, reason: string, actor: string | null = null) {
  const restock = o.status === 'accepted' || o.status === 'disputed';
  o.status = 'cancelled';
  o.cancelledAt = nowOf(d);
  o.cancelReason = reason;
  o.cancelledBy = d.sessionUserId;
  if (o.mode === 'points' && o.points > 0) {
    addLedger(d, {
      userId: o.requesterId,
      orderId: o.id,
      type: 'release',
      amount: o.points,
      note: '交易取消，退回凍結點數',
    });
  }
  const l = listingById(d, o.listingId);
  if (restock && l) {
    l.remaining += 1;
    if (l.status === 'reserved') l.status = 'active';
  }
  if (chatOpen(o)) sysMsg(d, o.id, `交易已取消：${reason}`);
  for (const p of [o.requesterId, o.providerId]) {
    if (p === actor) continue;
    const refund = p === o.requesterId && o.mode === 'points' && o.points > 0 ? `\n凍結的 ${o.points} 點已退回你的錢包。` : '';
    notify(d, p, `「${titleOf(d, o)}」的交易已取消`, `原因：${reason}${refund}`, '/orders');
  }
}

function completeOrder(d: DB, o: Order, message: string, actor: string | null = null) {
  const t = nowOf(d);
  const l = listingById(d, o.listingId);
  o.status = 'completed';
  o.completedAt = t;
  if (o.mode === 'points' && o.points > 0) {
    addLedger(d, {
      userId: o.providerId,
      orderId: o.id,
      type: 'transfer_in',
      amount: o.points,
      note: `「${l?.title ?? '刊登'}」點數收入`,
    });
    if (o.fee > 0) {
      addLedger(d, { userId: o.providerId, orderId: o.id, type: 'fee', amount: -o.fee, note: '平台手續費' });
    }
  }
  if (o.mode === 'free') {
    const p = userById(d, o.providerId);
    if (p) p.loveScore += 1;
  }
  for (const pid of [o.requesterId, o.providerId]) {
    const prior = d.orders.some(
      (x) => x.id !== o.id && x.status === 'completed' && isParty(x, pid),
    );
    if (!prior) grantReward(d, pid, d.settings.firstOrderReward, '首次完成交易獎勵');
  }
  settleInvite(d, o.requesterId, o.providerId);
  settleInvite(d, o.providerId, o.requesterId);
  if (l && l.remaining <= 0 && !d.orders.some((x) => x.listingId === l.id && OPEN_STATUSES.includes(x.status))) {
    l.status = 'closed';
  }
  sysMsg(d, o.id, message);
  for (const p of [o.requesterId, o.providerId]) {
    if (p === actor) continue;
    const points =
      o.mode !== 'points' ? '' : p === o.requesterId ? `${o.points} 點已轉給對方。\n` : `你收到 ${o.points - o.fee} 點（扣除手續費 ${o.fee} 點）。\n`;
    notify(d, p, `「${l?.title ?? '刊登'}」交易完成`, `${points}歡迎在 ${d.settings.reviewWindowDays} 天內到 Myrs 給對方評價。`, chatLink(o));
  }

  // Anti-farming flag: the same pair trading points repeatedly within 7 days.
  if (o.mode === 'points') {
    const pair = d.orders.filter(
      (x) =>
        x.status === 'completed' &&
        x.mode === 'points' &&
        isParty(x, o.requesterId) &&
        isParty(x, o.providerId) &&
        t - (x.completedAt ?? 0) < 7 * DAY,
    ).length;
    const already = d.reports.some(
      (r) => r.status === 'open' && r.reporterId === 'system' && r.targetId === o.requesterId,
    );
    if (pair >= 3 && !already) {
      d.reports.push({
        id: uid('rp'),
        targetType: 'user',
        targetId: o.requesterId,
        reporterId: 'system',
        reason: `與 ${nameOf(d, o.providerId)} 在 7 天內完成 ${pair} 筆點數交易，疑似刷點`,
        status: 'open',
        createdAt: t,
        handledBy: null,
      });
    }
  }
}

/** Time-based rules: request timeout, auto-complete, food expiry. */
function runMaintenance(d: DB): boolean {
  const t = nowOf(d);
  const s = d.settings;
  let changed = false;
  for (const o of d.orders) {
    if (o.status === 'requested' && t - o.createdAt > s.requestTimeoutHours * HOUR) {
      cancelOrder(d, o, `提供者 ${s.requestTimeoutHours} 小時內未回應，自動取消`);
      changed = true;
    } else if (o.status === 'accepted') {
      const one = o.requesterDoneAt ?? o.providerDoneAt;
      const both = o.requesterDoneAt && o.providerDoneAt;
      if (one && !both && t - one > s.autoCompleteHours * HOUR) {
        completeOrder(d, o, `對方 ${s.autoCompleteHours} 小時內沒有回應，交易自動完成。`);
        changed = true;
      } else if (!one && s.acceptTimeoutDays > 0 && t - (o.acceptedAt ?? t) > s.acceptTimeoutDays * DAY) {
        cancelOrder(d, o, `接受後 ${s.acceptTimeoutDays} 天都沒有人確認完成，自動取消`);
        changed = true;
      }
    }
  }
  const today = ymdLocal(t);
  for (const l of d.listings) {
    if (l.expiresOn && l.expiresOn < today && (l.status === 'active' || l.status === 'pending_review')) {
      l.status = 'expired';
      changed = true;
      for (const o of d.orders) {
        if (o.listingId === l.id && o.status === 'requested') cancelOrder(d, o, '食品已過期，自動下架');
      }
    }
  }
  for (const s of d.suspensions) {
    const u = userById(d, s.userId);
    if (!s.liftedAt && s.until !== null && s.until <= t && u?.status === 'suspended') {
      liftSuspension(d, u, null);
      changed = true;
    }
  }
  return changed;
}

function suspendMember(d: DB, admin: User, user: User, reason: string, days: number | null) {
  const t = nowOf(d);
  d.suspensions.push({
    id: uid('sp'),
    userId: user.id,
    reason,
    until: days ? t + days * DAY : null,
    createdBy: admin.id,
    createdAt: t,
    liftedAt: null,
    liftedBy: null,
  });
  user.status = 'suspended';
  cancelRequestsOf(d, user.id);
}

function liftSuspension(d: DB, user: User, by: string | null) {
  for (const s of d.suspensions) {
    if (s.userId === user.id && !s.liftedAt) {
      s.liftedAt = nowOf(d);
      s.liftedBy = by;
    }
  }
  user.status = 'active';
}

/** True when `u` is the only active owner left. */
function lastOwner(d: DB, u: User) {
  return levelOf(u) === 'owner' && !d.users.some((x) => x.id !== u.id && x.status === 'active' && levelOf(x) === 'owner');
}

/** A suspended member's unanswered requests, both ways, end now. */
function cancelRequestsOf(d: DB, userId: string) {
  for (const o of d.orders) {
    if (o.status === 'requested' && isParty(o, userId)) cancelOrder(d, o, '對方帳號目前無法使用，系統已自動取消');
  }
}

function requireUser(d: DB): User | { error: string } {
  const u = currentUser(d);
  return u ?? { error: '請先登入' };
}

function requireLevel(d: DB, min: AdminLevel): User | { error: string } {
  const u = currentUser(d);
  if (!u) return { error: '請先登入' };
  if (!hasLevel(u, min)) return { error: levelError(min) };
  return u;
}

function logAdmin(d: DB, admin: User, action: string) {
  d.adminLog.push({ id: uid('al'), adminId: admin.id, action, createdAt: nowOf(d) });
}

// ---------------------------------------------------------------- inputs

export interface NewListingInput {
  category: Category;
  sub: string;
  title: string;
  description: string;
  quantity: number;
  mode: Mode;
  pricePoints: number;
  swapWish: string;
  expiresOn: string | null;
  storage: string | null;
  photos: string[];
  location: LatLng;
  areaLabel: string;
  timeSlots: string;
}

export function validateListing(input: NewListingInput, today: string): string | null {
  if (input.title.trim().length < 2) return '標題至少 2 個字';
  if (input.title.trim().length > 40) return '標題最多 40 個字';
  if (input.description.length > 500) return '說明最多 500 個字';
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) return '數量要在 1 到 99 之間';
  if (input.mode === 'points' && (!Number.isInteger(input.pricePoints) || input.pricePoints < 1 || input.pricePoints > 5000)) {
    return '點數要是 1 到 5,000 的整數';
  }
  if (input.mode === 'swap' && !input.swapWish.trim()) return '請寫下想交換的東西';
  if (input.category === 'food') {
    if (!input.expiresOn) return '食品必須填到期日';
    if (input.expiresOn < today) return '到期日不能早於今天';
    if (!input.storage) return '請選擇保存方式';
  }
  if (input.photos.length > 6) return '照片最多 6 張';
  if (!input.areaLabel.trim()) return '請填寫地點名稱，例如「捷運大安站附近」';
  if (input.areaLabel.trim().length > 40) return '地點名稱最多 40 個字';
  if (!input.timeSlots.trim()) return '請填寫可面交的時段';
  return null;
}

export interface NewWantInput {
  category: Category;
  title: string;
  description: string;
  /** Rough point; the server keeps only a fuzzed one. */
  location: LatLng;
  areaLabel: string;
}

export function validateWant(input: NewWantInput): string | null {
  const title = input.title.trim();
  if (title.length < 2) return '想要的東西至少寫 2 個字';
  if (title.length > 30) return '想要的東西最多 30 個字';
  if (input.description.trim().length > 200) return '說明最多 200 個字';
  if (!input.areaLabel.trim()) return '請填寫大概的地點，例如「捷運大安站附近」';
  if (input.areaLabel.trim().length > 40) return '地點名稱最多 40 個字';
  return null;
}

export interface SavedSearchInput {
  keyword: string;
  category: Category | null;
  radiusKm: number;
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------- demo-mode actions

const localActions = {
  // ---- session
  loginWithPhone(phone: string): Result<User> {
    return mutate((d) => {
      const u = d.users.find((x) => x.phone === phone && x.status !== 'deleted');
      if (!u) return fail('NOT_FOUND');
      if (u.status === 'suspended') return fail(suspensionNote(activeSuspension(d, u.id)));
      d.sessionUserId = u.id;
      return ok(u);
    });
  },

  register(phone: string, name: string): Result<User> {
    return mutate((d) => {
      if (!PHONE_RE.test(phone)) return fail('手機號碼格式應為 09 開頭的 10 碼');
      if (d.users.some((x) => x.phone === phone && x.status !== 'deleted')) return fail('這個號碼已經註冊過');
      const n = name.trim();
      if (n.length < 1 || n.length > 20) return fail('暱稱請填 1 到 20 個字');
      const u: User = {
        id: uid('u'),
        phone,
        name: n,
        bio: '',
        role: 'member',
        merchant: false,
        status: 'active',
        loveScore: 0,
        blocked: [],
        color: ['#00A078', '#00A8E8', '#F0A000', '#E03050', '#00A038'][d.users.length % 5],
        createdAt: nowOf(d),
        inviteCode: randomInviteCode(),
      };
      d.users.push(u);
      addLedger(d, { userId: u.id, type: 'signup_bonus', amount: d.settings.signupBonus, note: '新手點數' });
      d.sessionUserId = u.id;
      return ok(u);
    });
  },

  /** Use a neighbour's invite code; returns the inviter's name. */
  redeemInvite(code: string): Result<string> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const c = normalizeInviteCode(code);
      if (!c) return fail('請輸入邀請碼');
      const inviter = d.users.find((x) => x.inviteCode === c && x.status !== 'deleted');
      if (!inviter) return fail('找不到這個邀請碼，請確認有沒有打錯');
      if (inviter.id === u.id) return fail('不能填自己的邀請碼');
      if (d.invites.some((x) => x.inviteeId === u.id)) return fail('你已經填過邀請碼了');
      if (u.createdAt < nowOf(d) - INVITE_DAYS * DAY) return fail(`加入 ${INVITE_DAYS} 天內才能填邀請碼`);
      if (d.orders.some((o) => o.status === 'completed' && isParty(o, u.id))) return fail('完成第一筆交易前才能填邀請碼');
      if (d.invites.some((x) => x.inviteeId === inviter.id && x.inviterId === u.id)) return fail('你們不能互相邀請');
      if (inviter.status !== 'active' || isBlockedBetween(d, u.id, inviter.id)) return fail('這個邀請碼目前不能使用');
      const invite: Invite = {
        inviteeId: u.id,
        inviterId: inviter.id,
        createdAt: nowOf(d),
        rewardedAt: null,
        inviteePoints: 0,
        inviterPoints: 0,
      };
      d.invites.push(invite);
      return ok(inviter.name);
    });
  },

  loginAs(userId: string): Result {
    return mutate((d) => {
      const u = userById(d, userId);
      if (u?.status === 'suspended') return fail(suspensionNote(activeSuspension(d, u.id)));
      if (!u || u.status !== 'active') return fail('這個帳號無法登入');
      d.sessionUserId = u.id;
      return ok(null);
    });
  },

  logout(): Result {
    return mutate((d) => {
      d.sessionUserId = null;
      return ok(null);
    });
  },

  updateProfile(name: string, bio: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const n = name.trim();
      if (n.length < 1 || n.length > 20) return fail('暱稱請填 1 到 20 個字');
      if (bio.length > 100) return fail('自我介紹最多 100 個字');
      const target = userById(d, u.id)!;
      target.name = n;
      target.bio = bio.trim();
      return ok(null);
    });
  },

  deleteAccount(): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      if (lastOwner(d, u)) return fail('至少要留一位擁有者，請先指派另一位擁有者');
      for (const o of d.orders) {
        if (isParty(o, u.id) && OPEN_STATUSES.includes(o.status)) {
          cancelOrder(d, o, '對方已刪除帳號', u.id);
        }
      }
      for (const l of d.listings) {
        if (l.ownerId === u.id && ['active', 'pending_review', 'reserved'].includes(l.status)) l.status = 'closed';
      }
      const target = userById(d, u.id)!;
      target.status = 'deleted';
      target.phone = `deleted-${target.id}`;
      target.role = 'member';
      target.adminLevel = null;
      d.sessionUserId = null;
      return ok(null);
    });
  },

  toggleBlock(otherId: string): Result<boolean> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      if (otherId === u.id) return fail('不能封鎖自己');
      const me = userById(d, u.id)!;
      const blocked = me.blocked.includes(otherId);
      me.blocked = blocked ? me.blocked.filter((x) => x !== otherId) : [...me.blocked, otherId];
      if (!blocked) {
        // Deals that have not started end now; confirmed or disputed ones run their course.
        for (const o of d.orders) {
          const between = (o.requesterId === u.id && o.providerId === otherId) || (o.requesterId === otherId && o.providerId === u.id);
          const notStarted = o.status === 'requested' || (o.status === 'accepted' && !o.requesterDoneAt && !o.providerDoneAt);
          if (between && notStarted) cancelOrder(d, o, '其中一方無法繼續這筆交易，系統已自動取消', u.id);
        }
      }
      return ok(!blocked);
    });
  },

  // ---- listings
  createListing(input: NewListingInput): Result<{ id: string; status: Listing['status']; reward: number }> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const err = validateListing(input, ymdLocal(nowOf(d)));
      if (err) return fail(err);
      const flagged = findBannedWords(`${input.title} ${input.description} ${input.swapWish}`, d.site.bannedWords);
      const first = !d.listings.some((l) => l.ownerId === u.id);
      const l: Listing = {
        id: uid('l'),
        ownerId: u.id,
        category: input.category,
        sub: input.sub,
        title: input.title.trim(),
        description: input.description.trim(),
        quantity: input.quantity,
        remaining: input.quantity,
        mode: input.mode,
        pricePoints: input.mode === 'points' ? input.pricePoints : 0,
        swapWish: input.mode === 'swap' ? input.swapWish.trim() : '',
        expiresOn: input.category === 'food' ? input.expiresOn : null,
        storage: input.category === 'food' ? input.storage : null,
        photos: input.photos,
        location: input.location,
        areaLabel: input.areaLabel.trim(),
        timeSlots: input.timeSlots.trim(),
        status: flagged.length ? 'pending_review' : 'active',
        flaggedWords: flagged,
        createdAt: nowOf(d),
      };
      d.listings.push(l);
      const reward = first ? grantReward(d, u.id, d.settings.firstListingReward, '首次刊登獎勵') : 0;
      return ok({ id: l.id, status: l.status, reward });
    });
  },

  closeListing(listingId: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const l = listingById(d, listingId);
      if (!l || l.ownerId !== u.id) return fail('找不到這則刊登');
      if (d.orders.some((o) => o.listingId === l.id && (o.status === 'accepted' || o.status === 'disputed'))) {
        return fail('還有進行中的交易，請先完成或取消再下架');
      }
      for (const o of d.orders) {
        if (o.listingId === l.id && o.status === 'requested') cancelOrder(d, o, '提供者已下架這則刊登', u.id);
      }
      l.status = 'closed';
      return ok(null);
    });
  },

  updateListingLocation(listingId: string, location: LatLng, areaLabel: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const l = listingById(d, listingId);
      if (!l || l.ownerId !== u.id) return fail('找不到這則刊登');
      if (!['active', 'pending_review', 'reserved'].includes(l.status)) return fail('這則刊登已經結束，不能修改地點');
      if (d.orders.some((o) => o.listingId === l.id && (o.status === 'accepted' || o.status === 'disputed'))) {
        return fail('已經有接受的交易，請在聊天室和對方另約地點');
      }
      const label = areaLabel.trim();
      if (!label) return fail('請填寫地點名稱，例如「捷運大安站附近」');
      if (label.length > 40) return fail('地點名稱最多 40 個字');
      l.location = location;
      l.areaLabel = label;
      return ok(null);
    });
  },

  toggleFavorite(listingId: string): Result<boolean> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const i = d.favorites.findIndex((f) => f.userId === u.id && f.listingId === listingId);
      if (i >= 0) {
        d.favorites.splice(i, 1);
        return ok(false);
      }
      const l = listingById(d, listingId);
      if (!l || !['active', 'reserved'].includes(l.status) || isBlockedBetween(d, u.id, l.ownerId)) {
        return fail('這則刊登目前無法收藏');
      }
      if (l.ownerId === u.id) return fail('不能收藏自己的刊登');
      if (d.favorites.filter((f) => f.userId === u.id).length >= 200) return fail('收藏最多 200 則，請先取消一些');
      d.favorites.push({ userId: u.id, listingId, createdAt: nowOf(d) });
      return ok(true);
    });
  },

  saveSearch(input: SavedSearchInput): Result<string> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const keyword = input.keyword.trim();
      if (!keyword) return fail('請輸入關鍵字');
      if (keyword.length > 20) return fail('關鍵字最多 20 個字');
      if (!(input.radiusKm >= 0.5 && input.radiusKm <= 20)) return fail('範圍要在 0.5 到 20 公里之間');
      const mine = d.savedSearches.filter((s) => s.userId === u.id);
      const same = mine.find((s) => s.keyword.toLowerCase() === keyword.toLowerCase() && s.category === input.category);
      if (same) {
        Object.assign(same, { radiusKm: input.radiusKm, lat: input.lat, lng: input.lng });
        return ok(same.id);
      }
      if (mine.length >= 5) return fail('關鍵字通知最多 5 個，請先刪掉不需要的');
      const s: SavedSearch = { id: uid('s'), userId: u.id, ...input, keyword, createdAt: nowOf(d) };
      d.savedSearches.push(s);
      return ok(s.id);
    });
  },

  deleteSavedSearch(id: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const i = d.savedSearches.findIndex((s) => s.id === id && s.userId === u.id);
      if (i < 0) return fail('找不到這個關鍵字通知');
      d.savedSearches.splice(i, 1);
      return ok(null);
    });
  },

  // ---- wants (徵求)
  createWant(input: NewWantInput): Result<string> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const err = validateWant(input);
      if (err) return fail(err);
      const title = input.title.trim();
      const description = input.description.trim();
      const bad = findBannedWords(`${title} ${description}`, d.site.bannedWords);
      if (bad.length) return fail(`徵求內容包含「${bad.join('、')}」，這類物品不能在 Myrs 交換`);
      const now = nowOf(d);
      const mine = d.wants.filter((w) => w.userId === u.id);
      if (mine.filter((w) => (w.status === 'open' || w.status === 'hidden') && w.expiresAt > now).length >= WANT_MAX_OPEN) {
        return fail(`同時最多 ${WANT_MAX_OPEN} 則徵求，請先結束已經找到或不需要的`);
      }
      if (mine.filter((w) => w.createdAt > now - DAY).length >= WANT_DAILY_MAX) {
        return fail(`每天最多發 ${WANT_DAILY_MAX} 則徵求，明天再試`);
      }
      const id = uid('w');
      d.wants.push({
        id,
        userId: u.id,
        category: input.category,
        title,
        description,
        location: fuzzLocation(input.location, id),
        areaLabel: input.areaLabel.trim(),
        status: 'open',
        createdAt: now,
        expiresAt: now + WANT_DAYS * DAY,
        closedAt: null,
      });
      return ok(id);
    });
  },

  closeWant(wantId: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const w = wantById(d, wantId);
      if (!w || w.userId !== u.id) return fail('找不到這則徵求');
      const now = nowOf(d);
      if ((w.status !== 'open' && w.status !== 'hidden') || w.expiresAt <= now) return fail('這則徵求已經結束了');
      w.status = 'closed';
      w.closedAt = now;
      return ok(null);
    });
  },

  /** Links one of my listings to a want; Supabase mode mails the asker once it is live. */
  respondWant(wantId: string, listingId: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const w = wantById(d, wantId);
      if (!w || !wantOpen(w, nowOf(d)) || userById(d, w.userId)?.status !== 'active') return fail('這則徵求已經結束了');
      if (w.userId === u.id) return fail('不能回應自己的徵求');
      if (isBlockedBetween(d, u.id, w.userId)) return fail('你們之間有封鎖，無法回應');
      const l = listingById(d, listingId);
      if (!l || l.ownerId !== u.id) return fail('找不到這則刊登');
      if (l.status !== 'active' && l.status !== 'pending_review') return fail('只有上架中的刊登可以回應徵求');
      if (l.wantId === w.id) return fail('這則刊登已經回應過這則徵求了');
      if (l.wantId) return fail('一則刊登只能回應一則徵求');
      if (d.listings.filter((x) => x.wantId === w.id && x.ownerId === u.id).length >= WANT_MAX_ANSWERS) {
        return fail(`同一則徵求最多回應 ${WANT_MAX_ANSWERS} 次`);
      }
      l.wantId = w.id;
      notifyWantAnswer(d, l);
      return ok(null);
    });
  },

  // ---- orders
  requestListing(listingId: string, opts: { note: string; swapOffer: string }): Result<string> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const l = listingById(d, listingId);
      if (!l || l.status !== 'active' || userById(d, l.ownerId)?.status !== 'active') return fail('這則刊登目前無法索取');
      if (l.ownerId === u.id) return fail('不能索取自己的刊登');
      if (isBlockedBetween(d, u.id, l.ownerId)) return fail('你和對方之間有封鎖，無法索取');
      if (l.remaining <= 0) return fail('已經被索取完了');
      if (d.orders.some((o) => o.listingId === l.id && o.requesterId === u.id && OPEN_STATUSES.includes(o.status))) {
        return fail('你已經索取過這則刊登，請等對方回覆');
      }
      const t = nowOf(d);
      const s = d.settings;
      if (l.mode === 'free') {
        const today = ymdLocal(t);
        // Requests someone else declined or cancelled do not use up the quota.
        const n = d.orders.filter(
          (o) =>
            o.requesterId === u.id &&
            o.mode === 'free' &&
            ymdLocal(o.createdAt) === today &&
            (o.status !== 'cancelled' || o.cancelledBy === u.id),
        ).length;
        if (n >= s.freeDailyLimit) return fail(`免費索取每天最多 ${s.freeDailyLimit} 件，明天再來吧`);
      }
      if (l.mode === 'points') {
        const bal = balanceOf(d, u.id);
        if (bal < l.pricePoints) return fail(`點數不足：需要 ${l.pricePoints} 點，你目前可用 ${bal} 點`);
        if (t - u.createdAt < s.newAccountDays * DAY) {
          const spent = d.orders
            .filter((o) => o.requesterId === u.id && o.mode === 'points' && o.status !== 'cancelled')
            .reduce((sum, o) => sum + o.points, 0);
          if (spent + l.pricePoints > s.newAccountPointsCap) {
            return fail(`新帳號 ${s.newAccountDays} 天內點數交易上限 ${s.newAccountPointsCap} 點`);
          }
        }
      }
      if (l.mode === 'swap' && !opts.swapOffer.trim()) return fail('請寫下你想拿來交換的東西');
      if (opts.note.length > 200) return fail('留言最多 200 個字');
      const o: Order = {
        id: uid('o'),
        listingId: l.id,
        requesterId: u.id,
        providerId: l.ownerId,
        mode: l.mode,
        points: l.mode === 'points' ? l.pricePoints : 0,
        fee: l.mode === 'points' ? calcFee(l.pricePoints, s) : 0,
        status: 'requested',
        note: opts.note.trim(),
        swapOffer: l.mode === 'swap' ? opts.swapOffer.trim() : '',
        createdAt: t,
        acceptedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelReason: '',
        requesterDoneAt: null,
        providerDoneAt: null,
        disputeReason: '',
        disputeBy: null,
        resolution: '',
      };
      d.orders.push(o);
      if (o.mode === 'points') {
        addLedger(d, { userId: u.id, orderId: o.id, type: 'hold', amount: -o.points, note: `索取「${l.title}」` });
      }
      const offer = o.mode === 'points' ? `，會付 ${o.points} 點` : o.mode === 'swap' ? `，想用「${o.swapOffer}」交換` : '';
      notify(
        d,
        l.ownerId,
        `${u.name} 想索取你的「${l.title}」`,
        `${u.name} 送出了索取${offer}。${o.note ? `\n留言：${o.note}` : ''}\n\n請在 ${s.requestTimeoutHours} 小時內到 Myrs 接受或婉拒，逾時會自動取消。`,
        '/orders?tab=provide',
      );
      return ok(o.id);
    });
  },

  acceptOrder(orderId: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const o = orderById(d, orderId);
      if (!o || o.providerId !== u.id) return fail('找不到這筆索取');
      if (o.status !== 'requested') return fail('這筆索取已經處理過了');
      const l = listingById(d, o.listingId);
      if (!l || l.remaining <= 0) return fail('數量不足，無法接受');
      if (l.status !== 'active') return fail('這則刊登目前暫停中，不能接受索取');
      if (isBlockedBetween(d, o.requesterId, u.id)) return fail('你和對方之間有封鎖，不能接受');
      o.status = 'accepted';
      o.acceptedAt = nowOf(d);
      l.remaining -= 1;
      if (o.note) {
        d.messages.push({ id: uid('m'), orderId: o.id, senderId: o.requesterId, body: o.note, image: null, createdAt: o.createdAt });
      }
      sysMsg(d, o.id, `${u.name} 接受了索取，現在可以聊天約面交，精確地點已顯示在上方。`);
      notify(
        d,
        o.requesterId,
        `${u.name} 接受了你的索取：「${l.title}」`,
        '現在可以到聊天室約面交時間，精確地點也已經顯示。面交後，雙方都要到 Myrs 按「完成」。',
        chatLink(o),
      );
      if (l.remaining === 0) {
        l.status = 'reserved';
        for (const other of d.orders) {
          if (other.listingId === l.id && other.id !== o.id && other.status === 'requested') {
            cancelOrder(d, other, '物品已被其他人預約', u.id);
          }
        }
      }
      return ok(null);
    });
  },

  declineOrder(orderId: string, reason: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const o = orderById(d, orderId);
      if (!o || o.providerId !== u.id) return fail('找不到這筆索取');
      if (o.status !== 'requested') return fail('這筆索取已經處理過了');
      cancelOrder(d, o, reason.trim() ? `提供者婉拒：${reason.trim()}` : '提供者婉拒', u.id);
      return ok(null);
    });
  },

  cancelMyOrder(orderId: string, reason: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const o = orderById(d, orderId);
      if (!o || !isParty(o, u.id)) return fail('找不到這筆交易');
      if (o.status === 'requested') {
        if (o.requesterId !== u.id) return fail('提供者請用「婉拒」');
        cancelOrder(d, o, '索取者撤回', u.id);
        return ok(null);
      }
      if (o.status !== 'accepted') return fail('這筆交易現在不能取消');
      if (o.requesterDoneAt || o.providerDoneAt) return fail('已有一方確認完成，若有問題請提出爭議');
      if (!reason.trim()) return fail('請說明取消原因');
      cancelOrder(d, o, `${u.name} 取消：${reason.trim()}`, u.id);
      return ok(null);
    });
  },

  markDone(orderId: string): Result<boolean> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const o = orderById(d, orderId);
      if (!o || !isParty(o, u.id)) return fail('找不到這筆交易');
      if (o.status !== 'accepted') return fail('只有進行中的交易可以確認完成');
      const t = nowOf(d);
      if (o.requesterId === u.id) o.requesterDoneAt = o.requesterDoneAt ?? t;
      else o.providerDoneAt = o.providerDoneAt ?? t;
      if (o.requesterDoneAt && o.providerDoneAt) {
        completeOrder(d, o, '雙方都已確認完成，交易完成。', u.id);
        return ok(true);
      }
      sysMsg(d, o.id, `${u.name} 已確認完成，等待對方確認；${d.settings.autoCompleteHours} 小時內沒有回應會自動完成。`);
      const h = d.settings.autoCompleteHours;
      if (o.requesterId === u.id) {
        notify(
          d,
          o.providerId,
          `${u.name} 已確認「${titleOf(d, o)}」交易完成`,
          `已經交付的話，請到 Myrs 按「完成」。\n如果有問題，請在 ${h} 小時內到聊天室按「提出爭議」；沒有回應的話，交易會自動完成。`,
          chatLink(o),
        );
      } else {
        notify(
          d,
          o.requesterId,
          `${u.name} 已確認「${titleOf(d, o)}」交易完成`,
          `已經拿到東西的話，請到 Myrs 按「完成」。\n如果還沒拿到或有問題，請在 ${h} 小時內到聊天室按「提出爭議」；沒有回應的話，交易會自動完成${o.mode === 'points' ? `，凍結的 ${o.points} 點會轉給對方` : ''}。`,
          chatLink(o),
        );
      }
      return ok(false);
    });
  },

  openDispute(orderId: string, reason: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const o = orderById(d, orderId);
      if (!o || !isParty(o, u.id)) return fail('找不到這筆交易');
      if (o.status !== 'accepted') return fail('只有進行中的交易可以提出爭議');
      if (!reason.trim()) return fail('請說明發生了什麼事');
      o.status = 'disputed';
      o.disputeBy = u.id;
      o.disputeReason = reason.trim();
      sysMsg(d, o.id, `${u.name} 提出爭議：「${reason.trim()}」。管理員會介入處理，點數暫時維持凍結。`);
      const t = titleOf(d, o);
      notify(
        d,
        o.requesterId === u.id ? o.providerId : o.requesterId,
        `「${t}」的交易有人提出爭議`,
        `爭議說明：${o.disputeReason}\n管理員會介入處理，點數暫時維持凍結。`,
        chatLink(o),
      );
      // Disputes are for admins and owners; moderators do not handle them.
      for (const a of d.users) {
        if (a.role === 'admin' && (a.adminLevel === 'owner' || a.adminLevel === 'admin')) {
          notify(d, a.id, '有新的交易爭議待處理', `「${t}」：${o.disputeReason}`, '/admin');
        }
      }
      return ok(null);
    });
  },

  sendMessage(orderId: string, body: string, image: string | null): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const o = orderById(d, orderId);
      if (!o || !isParty(o, u.id) || !chatOpen(o)) return fail('目前無法在這筆交易中聊天');
      if (o.status === 'cancelled') return fail('交易已取消，無法再傳訊息');
      if (isBlockedBetween(d, o.requesterId, o.providerId)) return fail('你和對方之間有封鎖');
      const text = body.trim();
      if (!text && !image) return fail('訊息是空的');
      if (text.length > 500) return fail('訊息最多 500 個字');
      const t = nowOf(d);
      d.messages.push({ id: uid('m'), orderId, senderId: u.id, body: text, image, createdAt: t });
      d.lastRead[`${u.id}:${orderId}`] = t;
      return ok(null);
    });
  },

  markRead(orderId: string): Result {
    const d0 = ensure();
    const u = currentUser(d0);
    if (!u || unreadIn(d0, u.id, orderId) === 0) return ok(null);
    return mutate((d) => {
      d.lastRead[`${u.id}:${orderId}`] = nowOf(d);
      return ok(null);
    });
  },

  submitReview(orderId: string, stars: number, comment: string): Result {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      const o = orderById(d, orderId);
      if (!o || !isParty(o, u.id) || o.status !== 'completed' || !o.completedAt) return fail('只有完成的交易可以評價');
      if (nowOf(d) - o.completedAt > d.settings.reviewWindowDays * DAY) return fail(`評價期限是完成後 ${d.settings.reviewWindowDays} 天`);
      if (d.reviews.some((r) => r.orderId === o.id && r.reviewerId === u.id)) return fail('你已經評價過了');
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) return fail('請選 1 到 5 顆星');
      if (comment.length > 200) return fail('評語最多 200 個字');
      d.reviews.push({
        id: uid('r'),
        orderId: o.id,
        reviewerId: u.id,
        revieweeId: counterpartId(o, u.id),
        stars,
        comment: comment.trim(),
        createdAt: nowOf(d),
      });
      return ok(null);
    });
  },

  report(targetType: Report['targetType'], targetId: string, reason: string): Result<boolean> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      if (!reason.trim()) return fail('請選擇或填寫檢舉原因');
      if (targetType === 'user' && targetId === u.id) return fail('不能檢舉自己');
      if (targetType === 'listing' && listingById(d, targetId)?.ownerId === u.id) return fail('不能檢舉自己的刊登');
      if (targetType === 'want' && wantById(d, targetId)?.userId === u.id) return fail('不能檢舉自己的徵求');
      if (d.reports.some((r) => r.targetId === targetId && r.reporterId === u.id && r.status === 'open')) {
        return fail('你已經檢舉過了，管理員會盡快處理');
      }
      d.reports.push({
        id: uid('rp'),
        targetType,
        targetId,
        reporterId: u.id,
        reason: reason.trim(),
        status: 'open',
        createdAt: nowOf(d),
        handledBy: null,
      });
      const reporters = new Set(
        d.reports.filter((r) => r.targetId === targetId && r.status === 'open').map((r) => r.reporterId),
      );
      if (reporters.size < d.settings.reportHideThreshold) return ok(false);
      const l = targetType === 'listing' ? listingById(d, targetId) : null;
      if (l && l.status === 'active') {
        l.status = 'pending_review';
        return ok(true);
      }
      const w = targetType === 'want' ? wantById(d, targetId) : null;
      if (w && w.status === 'open') {
        w.status = 'hidden';
        return ok(true);
      }
      return ok(false);
    });
  },

  // ---- admin
  adminSetListingStatus(listingId: string, status: 'active' | 'removed', reason = ''): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'moderator');
      if ('error' in a) return fail(a.error);
      if (reason.trim().length > 200) return fail('下架原因最多 200 個字');
      const l = listingById(d, listingId);
      if (!l) return fail('找不到這則刊登');
      if (status === 'active') {
        if (l.ownerId === a.id) return fail('不能審核自己的刊登，請由其他管理團隊成員處理');
        if (l.status !== 'pending_review') return fail('只有待審核的刊登可以核准');
        if (l.expiresOn && l.expiresOn < ymdLocal(nowOf(d))) return fail('這項食品已經過期，不能核准');
        // Approving means the admin checked it: flagged words and open reports are settled.
        l.status = l.remaining > 0 ? 'active' : 'reserved';
        l.flaggedWords = [];
        for (const r of d.reports) {
          if (r.targetId === l.id && r.status === 'open') {
            r.status = 'dismissed';
            r.handledBy = a.id;
          }
        }
        logAdmin(d, a, `核准刊登「${l.title}」`);
        notifyWantAnswer(d, l);
        return ok(null);
      }
      if (l.status === 'removed') return fail('這則刊登已經下架了');
      const why = reason.trim() || '不符合刊登規則';
      for (const o of d.orders) {
        if (o.listingId === l.id && OPEN_STATUSES.includes(o.status)) {
          cancelOrder(d, o, `刊登已被管理員下架：${why}`);
        }
      }
      l.status = 'removed';
      for (const r of d.reports) {
        if (r.targetId === l.id && r.status === 'open') {
          r.status = 'resolved';
          r.handledBy = a.id;
        }
      }
      logAdmin(d, a, `下架刊登「${l.title}」（${why}）`);
      return ok(null);
    });
  },

  adminHandleReport(reportId: string, action: 'dismiss' | 'remove_listing' | 'remove_want' | 'suspend_user'): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'moderator');
      if ('error' in a) return fail(a.error);
      const r = d.reports.find((x) => x.id === reportId);
      if (!r || r.status !== 'open') return fail('這筆檢舉已處理過');
      const reportedUser =
        r.targetType === 'user'
          ? r.targetId
          : r.targetType === 'want'
            ? wantById(d, r.targetId)?.userId
            : listingById(d, r.targetId)?.ownerId;
      if (reportedUser === a.id) return fail('不能處理針對自己的檢舉，請由其他管理團隊成員處理');
      const close = (status: 'resolved' | 'dismissed') => {
        for (const x of d.reports) {
          if (x.targetId === r.targetId && x.status === 'open') {
            x.status = status;
            x.handledBy = a.id;
          }
        }
      };
      if (action === 'dismiss') {
        close('dismissed');
        const l = r.targetType === 'listing' ? listingById(d, r.targetId) : null;
        if (l && l.status === 'pending_review' && !l.flaggedWords.length) l.status = 'active';
        const w = r.targetType === 'want' ? wantById(d, r.targetId) : null;
        if (w && w.status === 'hidden') w.status = 'open';
        logAdmin(d, a, `駁回檢舉：${r.reason}`);
        return ok(null);
      }
      if (action === 'remove_listing') {
        const l = r.targetType === 'listing' ? listingById(d, r.targetId) : null;
        if (!l) return fail('檢舉對象不是刊登');
        for (const o of d.orders) {
          if (o.listingId === l.id && OPEN_STATUSES.includes(o.status)) {
            cancelOrder(d, o, '刊登已被管理員下架');
          }
        }
        l.status = 'removed';
        close('resolved');
        logAdmin(d, a, `依檢舉下架刊登「${l.title}」`);
        return ok(null);
      }
      if (action === 'remove_want') {
        const w = r.targetType === 'want' ? wantById(d, r.targetId) : null;
        if (!w) return fail('檢舉對象不是徵求');
        w.status = 'removed';
        w.closedAt = w.closedAt ?? nowOf(d);
        close('resolved');
        logAdmin(d, a, `依檢舉移除徵求「${w.title}」`);
        return ok(null);
      }
      if (!hasLevel(a, 'admin')) return fail('停權需要「管理員」以上的權限');
      const target = reportedUser ? userById(d, reportedUser) : null;
      if (!target || target.status !== 'active') return fail('無法停權這個帳號');
      if (target.role === 'admin') return fail('不能停權管理團隊成員，請先由擁有者撤銷權限');
      suspendMember(d, a, target, '經檢舉確認違反使用規則', null);
      close('resolved');
      logAdmin(d, a, `依檢舉停權「${target.name}」`);
      return ok(null);
    });
  },

  adminRemoveWant(wantId: string, reason = ''): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'moderator');
      if ('error' in a) return fail(a.error);
      const why = reason.trim() || '不符合使用規則';
      if (why.length > 200) return fail('移除原因最多 200 個字');
      const w = wantById(d, wantId);
      if (!w) return fail('找不到這則徵求');
      if (w.userId === a.id) return fail('這是你自己的徵求，請直接按「結束徵求」');
      if (w.status === 'removed') return fail('這則徵求已經移除了');
      w.status = 'removed';
      w.closedAt = w.closedAt ?? nowOf(d);
      for (const r of d.reports) {
        if (r.targetId === w.id && r.status === 'open') {
          r.status = 'resolved';
          r.handledBy = a.id;
        }
      }
      logAdmin(d, a, `移除徵求「${w.title}」（${why}）`);
      return ok(null);
    });
  },

  adminResolveDispute(orderId: string, outcome: 'complete' | 'refund', note: string): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'admin');
      if ('error' in a) return fail(a.error);
      const o = orderById(d, orderId);
      if (!o || o.status !== 'disputed') return fail('這筆交易不在爭議中');
      o.resolution = note.trim();
      if (outcome === 'complete') {
        completeOrder(d, o, `管理員裁定交易成立${note.trim() ? `：${note.trim()}` : ''}。`);
      } else {
        cancelOrder(d, o, `管理員裁定退回${note.trim() ? `：${note.trim()}` : ''}`);
      }
      logAdmin(d, a, `爭議裁定（${outcome === 'complete' ? '成立' : '退回'}）：${listingById(d, o.listingId)?.title ?? o.id}`);
      return ok(null);
    });
  },

  adminSetUserStatus(userId: string, status: 'active' | 'suspended', reason = '', days: number | null = null): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'admin');
      if ('error' in a) return fail(a.error);
      const u = userById(d, userId);
      if (!u || u.status === 'deleted') return fail('找不到這個使用者');
      if (u.role === 'admin') return fail('不能停權管理團隊成員，請先由擁有者撤銷權限');
      if (status === 'suspended') {
        const why = reason.trim();
        if (u.status === 'suspended') return fail('這個帳號已經停權了');
        if (!why) return fail('請填寫停權原因');
        if (why.length > 200) return fail('停權原因最多 200 個字');
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) return fail('停權天數要在 1 到 365 天之間');
        suspendMember(d, a, u, why, days);
        logAdmin(d, a, `停權使用者「${u.name}」（${days === null ? '無期限' : `${days} 天`}，${why}）`);
        return ok(null);
      }
      if (u.status !== 'suspended') return fail('這個帳號沒有被停權');
      liftSuspension(d, u, a.id);
      logAdmin(d, a, `恢復使用者「${u.name}」`);
      return ok(null);
    });
  },

  adminSetRole(userId: string, level: AdminLevel | 'member'): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'owner');
      if ('error' in a) return fail(a.error);
      const u = userById(d, userId);
      if (!u || u.status === 'deleted') return fail('找不到這個使用者');
      if (u.status !== 'active') return fail('停權中的帳號不能加入管理團隊，請先恢復');
      const old = levelOf(u) ?? 'member';
      if (old === level) return fail(`對方已經是「${LEVEL_LABEL[level]}」了`);
      if (old === 'owner' && u.id !== a.id) return fail('不能更改其他擁有者的權限');
      if (old === 'owner' && lastOwner(d, u)) return fail('至少要留一位擁有者，請先指派另一位擁有者');
      u.role = level === 'member' ? 'member' : 'admin';
      u.adminLevel = level === 'member' ? null : level;
      logAdmin(d, a, `把「${u.name}」從${LEVEL_LABEL[old]}改為${LEVEL_LABEL[level]}`);
      return ok(null);
    });
  },

  adminSetMerchant(userId: string, merchant: boolean): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'admin');
      if ('error' in a) return fail(a.error);
      const u = userById(d, userId);
      if (!u) return fail('找不到這個使用者');
      u.merchant = merchant;
      logAdmin(d, a, `${merchant ? '開通' : '取消'}試點商家「${u.name}」`);
      return ok(null);
    });
  },

  adminAdjustPoints(userId: string, amount: number, note: string): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'owner');
      if ('error' in a) return fail(a.error);
      const u = userById(d, userId);
      if (!u) return fail('找不到這個使用者');
      if (!Number.isInteger(amount) || amount === 0) return fail('調整點數要是非 0 的整數');
      if (!note.trim()) return fail('調整點數必須填寫原因');
      if (balanceOf(d, userId) + amount < 0) return fail('調整後餘額不能小於 0');
      addLedger(d, { userId, type: 'adjust', amount, note: `管理員調整：${note.trim()}`, createdBy: a.id });
      logAdmin(d, a, `調整「${u.name}」點數 ${amount > 0 ? '+' : ''}${amount}（${note.trim()}）`);
      return ok(null);
    });
  },

  adminUpdateSettings(patch: Partial<Settings>): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'owner');
      if ('error' in a) return fail(a.error);
      const atLeastOne = ['requestTimeoutHours', 'autoCompleteHours', 'reviewWindowDays', 'reportHideThreshold'];
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fail(`「${k}」必須是 0 以上的數字`);
        if (atLeastOne.includes(k) && v < 1) return fail(`「${k}」至少要是 1`);
        if (k === 'acceptTimeoutDays' && v > 0 && v < 1) return fail(`「${k}」要是 0（關閉）或 1 以上`);
      }
      if (patch.feeRate !== undefined && patch.feeRate > 0.5) return fail('手續費比例不能超過 50%');
      const next = { ...d.settings, ...patch };
      const changes = settingsChanges(d.settings, next);
      if (!changes.length) return fail('參數沒有變更');
      d.settings = next;
      logAdmin(d, a, `更新平台參數：${changes.join('、')}`);
      return ok(null);
    });
  },

  adminSetBannedWords(words: string[]): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'owner');
      if ('error' in a) return fail(a.error);
      const next: string[] = [];
      for (const raw of words) {
        const w = raw.trim();
        if (!w || next.includes(w)) continue;
        if (w.length > 10) return fail(`禁售詞「${w}」太長，每個最多 10 個字`);
        next.push(w);
      }
      if (next.length > 100) return fail('禁售詞最多 100 個');
      const old = d.site.bannedWords;
      const added = next.filter((w) => !old.includes(w));
      const removed = old.filter((w) => !next.includes(w));
      if (!added.length && !removed.length) return fail('禁售詞沒有變更');
      d.site = { ...d.site, bannedWords: next };
      const parts = [added.length ? `新增「${added.join('」「')}」` : '', removed.length ? `移除「${removed.join('」「')}」` : ''];
      logAdmin(d, a, `更新禁售詞：${parts.filter(Boolean).join('；')}`);
      return ok(null);
    });
  },

  /** An empty text takes the announcement down; until null means no end time. */
  adminSetAnnouncement(text: string, until: number | null): Result {
    return mutate((d) => {
      const a = requireLevel(d, 'owner');
      if ('error' in a) return fail(a.error);
      const v = text.trim();
      if (v.length > 200) return fail('公告最多 200 個字');
      if (!v) {
        if (!d.site.announcement) return fail('目前沒有公告');
        d.site = { ...d.site, announcement: '', announcementUntil: null, announcementAt: null };
        logAdmin(d, a, '取消全站公告');
        return ok(null);
      }
      const t = nowOf(d);
      if (until !== null && until <= t) return fail('結束時間要在現在之後');
      d.site = { ...d.site, announcement: v, announcementUntil: until, announcementAt: t };
      logAdmin(d, a, `發布全站公告：${v}（${until === null ? '沒有結束時間' : `到 ${formatUntil(until)}`}）`);
      return ok(null);
    });
  },

  /** Marks the given notifications read, or all of them; returns how many changed. */
  markNotificationsRead(ids: string[] | null = null): Result<number> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      let n = 0;
      for (const x of d.notifications) {
        if (x.userId === u.id && x.readAt === null && (ids === null || ids.includes(x.id))) {
          x.readAt = nowOf(d);
          n++;
        }
      }
      return ok(n);
    });
  },

  /** Counts for the impact board; read only. */
  communityImpact(): Result<CommunityImpact> {
    const d = ensure();
    return ok(communityImpactOf(d, nowOf(d)));
  },

  // The demo sends no mail, so there is nothing to show or resend.
  adminMailStatus(filter: 'problem' | 'all' = 'problem'): Result<MailStatus> {
    void filter;
    return fail('示範模式不會寄出通知信，所以沒有寄送紀錄。');
  },

  adminRetryMail(id: string | null = null): Result<number> {
    void id;
    return fail('示範模式不會寄出通知信。');
  },

  // ---- demo tools
  fastForward(hours: number): Result<boolean> {
    return mutate((d) => {
      d.clockOffsetMs += hours * HOUR;
      return ok(runMaintenance(d));
    });
  },

  resetDemo(): Result {
    return mutate((d) => {
      const fresh = createSeed(Date.now());
      Object.assign(d, fresh);
      return ok(null);
    });
  },

  /** Periodic time-based rules; only writes when something changed. */
  tick() {
    const draft = structuredClone(ensure());
    if (runMaintenance(draft) && save(draft)) {
      db = draft;
      emit();
    }
  },
};

// ---------------------------------------------------------------- exported actions

type Async<T> = {
  [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
};
export type Actions = Async<typeof localActions>;

const asyncLocal = Object.fromEntries(
  Object.entries(localActions).map(([k, fn]) => [k, async (...a: unknown[]) => (fn as (...x: unknown[]) => unknown)(...a)]),
) as Actions;

const asyncRemote: Actions = {
  ...remoteActions,
  // Skip the round trip when there is nothing unread.
  async markRead(orderId: string) {
    const d = remoteSnapshot();
    const u = d ? currentUser(d) : null;
    if (!d || !u || unreadIn(d, u.id, orderId) === 0) return ok(null);
    return remoteActions.markRead(orderId);
  },
};

export const actions: Actions = IS_REMOTE ? asyncRemote : asyncLocal;
