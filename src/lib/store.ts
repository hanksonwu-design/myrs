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
import { calcFee, DEFAULT_SETTINGS, findBannedWords, PHONE_RE } from './rules';
import { createSeed, DB_VERSION } from './seed';
import { DAY, HOUR, ymdLocal } from './format';
import type {
  Category,
  DB,
  LatLng,
  LedgerEntry,
  Listing,
  Mode,
  Order,
  OrderStatus,
  Review,
  SavedSearch,
  Settings,
  User,
} from './types';

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
          favorites: parsed.favorites ?? [],
          savedSearches: parsed.savedSearches ?? [],
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
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

/** Who may see the exact meeting spot: owner, admin, or a requester whose deal is on. */
export function canSeeExact(d: DB, l: Listing, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (l.ownerId === userId || userById(d, userId)?.role === 'admin') return true;
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

function grantReward(d: DB, userId: string, amount: number, note: string): number {
  const give = Math.min(amount, d.settings.monthlyRewardCap - rewardsThisMonth(d, userId));
  if (give > 0) addLedger(d, { userId, type: 'reward', amount: give, note });
  return Math.max(0, give);
}

function nameOf(d: DB, id: string) {
  return userById(d, id)?.name ?? '使用者';
}

function cancelOrder(d: DB, o: Order, reason: string) {
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
}

function completeOrder(d: DB, o: Order, message: string) {
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
  if (l && l.remaining <= 0 && !d.orders.some((x) => x.listingId === l.id && OPEN_STATUSES.includes(x.status))) {
    l.status = 'closed';
  }
  sysMsg(d, o.id, message);

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
  return changed;
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

function requireAdmin(d: DB): User | { error: string } {
  const u = currentUser(d);
  if (!u) return { error: '請先登入' };
  if (u.role !== 'admin') return { error: '只有管理員可以執行這個操作' };
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
      if (u.status === 'suspended') return fail('這個帳號已被停權，請聯絡客服。');
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
      };
      d.users.push(u);
      addLedger(d, { userId: u.id, type: 'signup_bonus', amount: d.settings.signupBonus, note: '新手點數' });
      d.sessionUserId = u.id;
      return ok(u);
    });
  },

  loginAs(userId: string): Result {
    return mutate((d) => {
      const u = userById(d, userId);
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
      for (const o of d.orders) {
        if (isParty(o, u.id) && OPEN_STATUSES.includes(o.status)) {
          cancelOrder(d, o, '對方已刪除帳號');
        }
      }
      for (const l of d.listings) {
        if (l.ownerId === u.id && ['active', 'pending_review', 'reserved'].includes(l.status)) l.status = 'closed';
      }
      const target = userById(d, u.id)!;
      target.status = 'deleted';
      target.phone = `deleted-${target.id}`;
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
          if (between && notStarted) cancelOrder(d, o, '其中一方無法繼續這筆交易，系統已自動取消');
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
      const flagged = findBannedWords(`${input.title} ${input.description} ${input.swapWish}`);
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
        if (o.listingId === l.id && o.status === 'requested') cancelOrder(d, o, '提供者已下架這則刊登');
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
      if (l.remaining === 0) {
        l.status = 'reserved';
        for (const other of d.orders) {
          if (other.listingId === l.id && other.id !== o.id && other.status === 'requested') {
            cancelOrder(d, other, '物品已被其他人預約');
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
      cancelOrder(d, o, reason.trim() ? `提供者婉拒：${reason.trim()}` : '提供者婉拒');
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
        cancelOrder(d, o, '索取者撤回');
        return ok(null);
      }
      if (o.status !== 'accepted') return fail('這筆交易現在不能取消');
      if (o.requesterDoneAt || o.providerDoneAt) return fail('已有一方確認完成，若有問題請提出爭議');
      if (!reason.trim()) return fail('請說明取消原因');
      cancelOrder(d, o, `${u.name} 取消：${reason.trim()}`);
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
        completeOrder(d, o, '雙方都已確認完成，交易完成。');
        return ok(true);
      }
      sysMsg(d, o.id, `${u.name} 已確認完成，等待對方確認；${d.settings.autoCompleteHours} 小時內沒有回應會自動完成。`);
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

  report(targetType: 'listing' | 'user', targetId: string, reason: string): Result<boolean> {
    return mutate((d) => {
      const u = requireUser(d);
      if ('error' in u) return fail(u.error);
      if (!reason.trim()) return fail('請選擇或填寫檢舉原因');
      if (targetType === 'user' && targetId === u.id) return fail('不能檢舉自己');
      if (targetType === 'listing' && listingById(d, targetId)?.ownerId === u.id) return fail('不能檢舉自己的刊登');
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
      let hidden = false;
      if (targetType === 'listing') {
        const reporters = new Set(
          d.reports.filter((r) => r.targetId === targetId && r.status === 'open').map((r) => r.reporterId),
        );
        const l = listingById(d, targetId);
        if (l && l.status === 'active' && reporters.size >= d.settings.reportHideThreshold) {
          l.status = 'pending_review';
          hidden = true;
        }
      }
      return ok(hidden);
    });
  },

  // ---- admin
  adminSetListingStatus(listingId: string, status: 'active' | 'removed'): Result {
    return mutate((d) => {
      const a = requireAdmin(d);
      if ('error' in a) return fail(a.error);
      const l = listingById(d, listingId);
      if (!l) return fail('找不到這則刊登');
      if (status === 'active') {
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
        return ok(null);
      }
      if (l.status === 'removed') return fail('這則刊登已經下架了');
      for (const o of d.orders) {
        if (o.listingId === l.id && OPEN_STATUSES.includes(o.status)) {
          cancelOrder(d, o, '刊登已被管理員下架');
        }
      }
      l.status = 'removed';
      logAdmin(d, a, `下架刊登「${l.title}」`);
      return ok(null);
    });
  },

  adminHandleReport(reportId: string, action: 'dismiss' | 'remove_listing' | 'suspend_user'): Result {
    return mutate((d) => {
      const a = requireAdmin(d);
      if ('error' in a) return fail(a.error);
      const r = d.reports.find((x) => x.id === reportId);
      if (!r || r.status !== 'open') return fail('這筆檢舉已處理過');
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
      const targetUserId = r.targetType === 'user' ? r.targetId : listingById(d, r.targetId)?.ownerId;
      const target = targetUserId ? userById(d, targetUserId) : null;
      if (!target || target.role === 'admin') return fail('無法停權這個帳號');
      target.status = 'suspended';
      cancelRequestsOf(d, target.id);
      close('resolved');
      logAdmin(d, a, `依檢舉停權「${target.name}」`);
      return ok(null);
    });
  },

  adminResolveDispute(orderId: string, outcome: 'complete' | 'refund', note: string): Result {
    return mutate((d) => {
      const a = requireAdmin(d);
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

  adminSetUserStatus(userId: string, status: 'active' | 'suspended'): Result {
    return mutate((d) => {
      const a = requireAdmin(d);
      if ('error' in a) return fail(a.error);
      const u = userById(d, userId);
      if (!u || u.status === 'deleted') return fail('找不到這個使用者');
      if (u.role === 'admin') return fail('不能停權管理員');
      const was = u.status;
      u.status = status;
      if (status === 'suspended' && was !== 'suspended') cancelRequestsOf(d, u.id);
      logAdmin(d, a, `${status === 'active' ? '恢復' : '停權'}使用者「${u.name}」`);
      return ok(null);
    });
  },

  adminSetMerchant(userId: string, merchant: boolean): Result {
    return mutate((d) => {
      const a = requireAdmin(d);
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
      const a = requireAdmin(d);
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
      const a = requireAdmin(d);
      if ('error' in a) return fail(a.error);
      const atLeastOne = ['requestTimeoutHours', 'autoCompleteHours', 'reviewWindowDays', 'reportHideThreshold'];
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fail(`「${k}」必須是 0 以上的數字`);
        if (atLeastOne.includes(k) && v < 1) return fail(`「${k}」至少要是 1`);
        if (k === 'acceptTimeoutDays' && v > 0 && v < 1) return fail(`「${k}」要是 0（關閉）或 1 以上`);
      }
      if (patch.feeRate !== undefined && patch.feeRate > 0.5) return fail('手續費比例不能超過 50%');
      d.settings = { ...d.settings, ...patch };
      logAdmin(d, a, '更新平台參數');
      return ok(null);
    });
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
