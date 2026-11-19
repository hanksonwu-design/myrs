'use client';

/**
 * Supabase data layer. Builds the same `DB` snapshot the pages already read,
 * from tables the signed-in user may see (row level security), and keeps it
 * fresh with realtime. Every write is a Postgres function (supabase/migrations),
 * so the point rules run on the server, not in the browser.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './backend';
import { BASE_PATH } from './links';
import { DEFAULT_SETTINGS } from './rules';
import type {
  AdminLog,
  DB,
  LatLng,
  LedgerEntry,
  Listing,
  Message,
  Order,
  Report,
  Review,
  Settings,
  User,
} from './types';
import type { NewListingInput, Result } from './store';

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      // Lets the browser console (and local tests) reach the client while developing.
      (window as unknown as { __myrs?: unknown }).__myrs = { supabase: client, refresh: () => refresh() };
    }
  }
  return client;
}

// ---------------------------------------------------------------- row mapping

type Row = Record<string, unknown>;
const ms = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : null);
const msReq = (v: unknown) => ms(v) ?? 0;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

const SETTINGS_COLUMNS: Record<keyof Settings, string> = {
  feeRate: 'fee_rate',
  minFee: 'min_fee',
  signupBonus: 'signup_bonus',
  firstListingReward: 'first_listing_reward',
  firstOrderReward: 'first_order_reward',
  monthlyRewardCap: 'monthly_reward_cap',
  freeDailyLimit: 'free_daily_limit',
  newAccountDays: 'new_account_days',
  newAccountPointsCap: 'new_account_points_cap',
  requestTimeoutHours: 'request_timeout_hours',
  autoCompleteHours: 'auto_complete_hours',
  reviewWindowDays: 'review_window_days',
  reportHideThreshold: 'report_hide_threshold',
  rewardExpiryMonths: 'reward_expiry_months',
  acceptTimeoutDays: 'accept_timeout_days',
};

function toSettings(r: Row | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (!r) return s;
  for (const [k, col] of Object.entries(SETTINGS_COLUMNS) as [keyof Settings, string][]) {
    if (r[col] !== undefined && r[col] !== null) s[k] = num(r[col]);
  }
  return s;
}

function toListing(r: Row, exact: Map<string, LatLng>): Listing {
  const id = str(r.id);
  const pub = { lat: num(r.lat), lng: num(r.lng) };
  return {
    id,
    ownerId: str(r.owner_id),
    category: r.category as Listing['category'],
    sub: str(r.sub),
    title: str(r.title),
    description: str(r.description),
    quantity: num(r.quantity),
    remaining: num(r.remaining),
    mode: r.mode as Listing['mode'],
    pricePoints: num(r.price_points),
    swapWish: str(r.swap_wish),
    expiresOn: (r.expires_on as string | null) ?? null,
    storage: (r.storage as string | null) ?? null,
    photos: (r.photos as string[] | null) ?? [],
    location: exact.get(id) ?? pub,
    publicLocation: pub,
    areaLabel: str(r.area_label),
    timeSlots: str(r.time_slots),
    status: r.status as Listing['status'],
    flaggedWords: (r.flagged_words as string[] | null) ?? [],
    createdAt: msReq(r.created_at),
  };
}

function toOrder(r: Row): Order {
  return {
    id: str(r.id),
    listingId: str(r.listing_id),
    requesterId: str(r.requester_id),
    providerId: str(r.provider_id),
    mode: r.mode as Order['mode'],
    points: num(r.points),
    fee: num(r.fee),
    status: r.status as Order['status'],
    note: str(r.note),
    swapOffer: str(r.swap_offer),
    createdAt: msReq(r.created_at),
    acceptedAt: ms(r.accepted_at),
    completedAt: ms(r.completed_at),
    cancelledAt: ms(r.cancelled_at),
    cancelReason: str(r.cancel_reason),
    requesterDoneAt: ms(r.requester_done_at),
    providerDoneAt: ms(r.provider_done_at),
    disputeReason: str(r.dispute_reason),
    disputeBy: (r.dispute_by as string | null) ?? null,
    resolution: str(r.resolution),
  };
}

const toLedger = (r: Row): LedgerEntry => ({
  id: str(r.id),
  userId: str(r.user_id),
  orderId: (r.order_id as string | null) ?? null,
  type: r.type as LedgerEntry['type'],
  amount: num(r.amount),
  note: str(r.note),
  createdAt: msReq(r.created_at),
  expiresAt: ms(r.expires_at),
  createdBy: (r.created_by as string | null) ?? null,
});

const toReview = (r: Row): Review => ({
  id: str(r.id),
  orderId: str(r.order_id),
  reviewerId: str(r.reviewer_id),
  revieweeId: str(r.reviewee_id),
  stars: num(r.stars),
  comment: str(r.comment),
  createdAt: msReq(r.created_at),
});

const toReport = (r: Row): Report => ({
  id: str(r.id),
  targetType: r.target_type as Report['targetType'],
  targetId: str(r.target_id),
  reporterId: (r.reporter_id as string | null) ?? 'system',
  reason: str(r.reason),
  status: r.status as Report['status'],
  createdAt: msReq(r.created_at),
  handledBy: (r.handled_by as string | null) ?? null,
});

const toAdminLog = (r: Row): AdminLog => ({
  id: str(r.id),
  adminId: str(r.admin_id),
  action: str(r.action),
  createdAt: msReq(r.created_at),
});

/** "886912345678" → "0912345678"; e-mail stays as is. */
function identityOf(user: { phone?: string | null; email?: string | null }): string {
  const p = user.phone ?? '';
  if (p) return p.startsWith('886') ? `0${p.slice(3)}` : p;
  return user.email ?? '';
}

// ---------------------------------------------------------------- chat image URLs

const CHAT_BUCKET = 'chat-images';
const PHOTO_BUCKET = 'listing-photos';
const signed = new Map<string, { url: string; at: number }>();

async function signChatImages(paths: string[]) {
  const stale = [...new Set(paths)].filter((p) => {
    const s = signed.get(p);
    return !s || Date.now() - s.at > 6 * 3_600_000;
  });
  if (!stale.length) return;
  const { data } = await supabase().storage.from(CHAT_BUCKET).createSignedUrls(stale, 12 * 3600);
  for (const x of data ?? []) {
    if (x.path && x.signedUrl) signed.set(x.path, { url: x.signedUrl, at: Date.now() });
  }
}

// ---------------------------------------------------------------- snapshot

const PAGE = 1000;

/** Reads every row the user may see, 1,000 at a time (PostgREST's default cap). */
async function selectAll(table: string, orderBy: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase()
      .from(table)
      .select('*')
      .order(orderBy)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data as Row[]) ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

async function fetchSnapshot(): Promise<DB> {
  const sb = supabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  const uid = session?.user.id ?? null;
  const signedIn = (table: string, orderBy: string) => (uid ? selectAll(table, orderBy) : Promise.resolve([]));

  const [settings, profiles, listings, reviews, secrets, blocks, orders, ledger, messages, reports, adminLog, reads] =
    await Promise.all([
      selectAll('settings', 'id'),
      selectAll('profiles', 'created_at'),
      selectAll('listings', 'created_at'),
      selectAll('reviews', 'created_at'),
      signedIn('listing_secrets', 'listing_id'),
      signedIn('blocks', 'blocked_id'),
      signedIn('orders', 'created_at'),
      signedIn('ledger', 'created_at'),
      signedIn('messages', 'created_at'),
      signedIn('reports', 'created_at'),
      signedIn('admin_log', 'created_at'),
      signedIn('chat_reads', 'order_id'),
    ]);

  const exact = new Map(secrets.map((r) => [str(r.listing_id), { lat: num(r.lat), lng: num(r.lng) }]));
  const blockedBy = new Map<string, string[]>();
  for (const b of blocks) {
    const k = str(b.blocker_id);
    blockedBy.set(k, [...(blockedBy.get(k) ?? []), str(b.blocked_id)]);
  }

  const identity = session ? identityOf(session.user) : '';
  const users: User[] = profiles.map((r) => ({
    id: str(r.id),
    phone: r.id === uid ? identity : '',
    name: str(r.name),
    bio: str(r.bio),
    role: r.role as User['role'],
    merchant: Boolean(r.merchant),
    status: r.status as User['status'],
    loveScore: num(r.love_score),
    blocked: blockedBy.get(str(r.id)) ?? [],
    color: str(r.color) || '#00A078',
    createdAt: msReq(r.created_at),
  }));

  const imagePaths = messages.map((m) => m.image).filter((p): p is string => typeof p === 'string' && p !== '');
  if (imagePaths.length) await signChatImages(imagePaths);
  const msgs: Message[] = messages.map((r) => ({
    id: str(r.id),
    orderId: str(r.order_id),
    senderId: (r.sender_id as string | null) ?? null,
    body: str(r.body),
    image: typeof r.image === 'string' && r.image ? (signed.get(r.image)?.url ?? null) : null,
    createdAt: msReq(r.created_at),
  }));

  const lastRead: Record<string, number> = {};
  for (const r of reads) lastRead[`${str(r.user_id)}:${str(r.order_id)}`] = msReq(r.read_at);

  const me = uid ? users.find((u) => u.id === uid) : undefined;
  const auth: DB['auth'] = uid
    ? { identity, state: !me ? 'needs_signup' : me.status === 'suspended' ? 'suspended' : 'ok' }
    : null;
  if (me?.status === 'deleted') {
    await sb.auth.signOut();
    return fetchSnapshot();
  }

  return {
    version: 1,
    clockOffsetMs: 0,
    sessionUserId: me && me.status === 'active' ? me.id : null,
    users,
    listings: listings.map((r) => toListing(r, exact)),
    orders: orders.map(toOrder),
    ledger: ledger.map(toLedger),
    messages: msgs,
    reviews: reviews.map(toReview),
    reports: reports.map(toReport),
    settings: toSettings(settings[0]),
    adminLog: adminLog.map(toAdminLog),
    lastRead,
    auth,
  };
}

function emptySnapshot(error: string): DB {
  return {
    version: 1,
    clockOffsetMs: 0,
    sessionUserId: null,
    users: [],
    listings: [],
    orders: [],
    ledger: [],
    messages: [],
    reviews: [],
    reports: [],
    settings: { ...DEFAULT_SETTINGS },
    adminLog: [],
    lastRead: {},
    auth: null,
    loadError: error,
  };
}

// ---------------------------------------------------------------- sync

let current: DB | null = null;
let publish: (d: DB) => void = () => {};
let started = false;
let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export const remoteSnapshot = () => current;

/** Turns a first-load failure into a setup hint. */
function loadMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed/i.test(m)) return '連不上 Supabase，請檢查 NEXT_PUBLIC_SUPABASE_URL 和網路';
  if (/does not exist|could not find the table|schema cache/i.test(m)) {
    return '資料表還沒建立，請在 Supabase 執行 supabase/migrations 裡的 SQL';
  }
  if (/invalid api key|no api key|apikey/i.test(m)) return 'Supabase 金鑰不正確，請檢查 NEXT_PUBLIC_SUPABASE_ANON_KEY';
  return m;
}

async function load() {
  try {
    current = await fetchSnapshot();
  } catch (e) {
    console.error('[myrs] load failed', e);
    if (current && !current.loadError) return; // keep showing the last good data
    current = emptySnapshot(loadMessage(e));
  }
  publish(current);
}

/** Reloads the snapshot. Resolves after a load that started after this call. */
export function refresh(): Promise<void> {
  if (!running) {
    running = load().finally(() => {
      running = null;
    });
    return running;
  }
  if (!queued) {
    queued = running.then(() => {
      queued = null;
      return refresh();
    });
  }
  return queued;
}

function scheduleRefresh(delay = 300) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refresh();
  }, delay);
}

const REALTIME_TABLES = [
  'settings',
  'profiles',
  'blocks',
  'listings',
  'listing_secrets',
  'orders',
  'ledger',
  'messages',
  'reviews',
  'reports',
  'admin_log',
  'chat_reads',
];

let channel: RealtimeChannel | null = null;
let channelUser: string | null | undefined; // undefined until the first auth event
let channelSeq = 0;

/**
 * Opens the realtime channel for whoever is signed in. Realtime checks row
 * level security with the token the channel joined with: a channel opened
 * while signed out keeps visitor rights after sign-in (only public rows, so no
 * orders, chats or points), so a new channel is opened whenever the user
 * changes. Each (re)join triggers a refresh to catch changes made meanwhile.
 */
async function connectRealtime(userId: string | null) {
  if (channelUser === userId && channel) return;
  channelUser = userId;
  const seq = ++channelSeq;
  const sb = supabase();
  const old = channel;
  channel = null;
  if (old) await sb.removeChannel(old);
  // Join with this user's token, not the one the old channel used.
  await sb.realtime.setAuth();
  if (seq !== channelSeq) return; // the user changed again while we waited
  const ch = sb.channel(`myrs-db-${seq}`);
  for (const table of REALTIME_TABLES) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleRefresh());
  }
  ch.on('system', {}, (p: { extension?: string; status?: string }) => {
    if (p.extension === 'postgres_changes' && p.status === 'ok') scheduleRefresh(0);
  });
  ch.subscribe();
  channel = ch;
}

export function startRemote(onSnapshot: (d: DB) => void) {
  publish = onSnapshot;
  if (started) {
    if (current) onSnapshot(current);
    return;
  }
  started = true;
  const sb = supabase();
  sb.auth.onAuthStateChange((event, session) => {
    if (event !== 'INITIAL_SESSION' && event !== 'TOKEN_REFRESHED') scheduleRefresh(0);
    // Supabase warns against awaiting its own calls inside this callback.
    const userId = session?.user.id ?? null;
    setTimeout(() => void connectRealtime(userId), 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh(0);
  });
  void refresh();
}

// ---------------------------------------------------------------- writes

interface RpcError {
  message?: string;
  code?: string;
}

function friendly(e: RpcError): string {
  const m = e.message ?? '';
  if (e.code === 'P0001' && m) return m; // our own messages from RAISE EXCEPTION
  if (/failed to fetch|networkerror|load failed/i.test(m)) return '連不上伺服器，請檢查網路後再試';
  if (/jwt|permission denied|not authenticated/i.test(m)) return '請先登入';
  console.warn('[myrs] rpc error', e);
  return '系統忙碌中，請稍後再試';
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) return fail(friendly(error));
  await refresh();
  return ok(data as T);
}

async function currentUid(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}

/** Uploads a data URL (from compressImage) and returns the stored path. */
async function uploadDataUrl(bucket: string, path: string, dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const { error } = await supabase()
    .storage.from(bucket)
    .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  if (error) throw new Error(`照片上傳失敗：${error.message}`);
  return path;
}

let lastTick = 0;
const demoOnly = async () => fail('這是示範模式的功能，正式版請用手機或 Email 登入');

export const remoteActions = {
  loginWithPhone: demoOnly as (phone: string) => Promise<Result<User>>,
  register: demoOnly as (phone: string, name: string) => Promise<Result<User>>,
  loginAs: demoOnly as (userId: string) => Promise<Result>,
  fastForward: demoOnly as (hours: number) => Promise<Result<boolean>>,
  resetDemo: demoOnly as () => Promise<Result>,

  async logout(): Promise<Result> {
    await supabase().auth.signOut();
    await refresh();
    return ok(null);
  },

  updateProfile: (name: string, bio: string) => rpc<null>('update_profile', { p_name: name, p_bio: bio }),

  async deleteAccount(): Promise<Result> {
    const r = await rpc<null>('delete_account');
    if (!r.ok) return r;
    await supabase().auth.signOut();
    await refresh();
    return ok(null);
  },

  toggleBlock: (otherId: string) => rpc<boolean>('toggle_block', { p_other: otherId }),

  async createListing(input: NewListingInput): Promise<Result<{ id: string; status: Listing['status']; reward: number }>> {
    const uid = await currentUid();
    if (!uid) return fail('請先登入');
    let photos: string[];
    try {
      photos = await Promise.all(
        input.photos.map(async (p) => {
          if (/^https?:\/\//.test(p)) return p;
          const path = await uploadDataUrl(PHOTO_BUCKET, `${uid}/${crypto.randomUUID()}.jpg`, p);
          return supabase().storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
        }),
      );
    } catch (e) {
      return fail(e instanceof Error ? e.message : '照片上傳失敗');
    }
    return rpc('create_listing', { p: { ...input, photos } });
  },

  closeListing: (listingId: string) => rpc<null>('close_listing', { p_listing: listingId }),

  requestListing: (listingId: string, opts: { note: string; swapOffer: string }) =>
    rpc<string>('request_listing', { p_listing: listingId, p_note: opts.note, p_swap_offer: opts.swapOffer }),

  acceptOrder: (orderId: string) => rpc<null>('accept_order', { p_order: orderId }),
  declineOrder: (orderId: string, reason: string) => rpc<null>('decline_order', { p_order: orderId, p_reason: reason }),
  cancelMyOrder: (orderId: string, reason: string) =>
    rpc<null>('cancel_my_order', { p_order: orderId, p_reason: reason }),
  markDone: (orderId: string) => rpc<boolean>('mark_done', { p_order: orderId }),
  openDispute: (orderId: string, reason: string) => rpc<null>('open_dispute', { p_order: orderId, p_reason: reason }),

  async sendMessage(orderId: string, body: string, image: string | null): Promise<Result> {
    let path: string | null = null;
    if (image) {
      try {
        path = await uploadDataUrl(CHAT_BUCKET, `${orderId}/${crypto.randomUUID()}.jpg`, image);
      } catch (e) {
        return fail(e instanceof Error ? e.message : '照片上傳失敗');
      }
    }
    return rpc<null>('send_message', { p_order: orderId, p_body: body, p_image: path });
  },

  markRead: (orderId: string) => rpc<null>('mark_read', { p_order: orderId }),

  submitReview: (orderId: string, stars: number, comment: string) =>
    rpc<null>('submit_review', { p_order: orderId, p_stars: stars, p_comment: comment }),

  report: (targetType: 'listing' | 'user', targetId: string, reason: string) =>
    rpc<boolean>('report', { p_target_type: targetType, p_target_id: targetId, p_reason: reason }),

  adminSetListingStatus: (listingId: string, status: 'active' | 'removed') =>
    rpc<null>('admin_set_listing_status', { p_listing: listingId, p_status: status }),
  adminHandleReport: (reportId: string, action: 'dismiss' | 'remove_listing' | 'suspend_user') =>
    rpc<null>('admin_handle_report', { p_report: reportId, p_action: action }),
  adminResolveDispute: (orderId: string, outcome: 'complete' | 'refund', note: string) =>
    rpc<null>('admin_resolve_dispute', { p_order: orderId, p_outcome: outcome, p_note: note }),
  adminSetUserStatus: (userId: string, status: 'active' | 'suspended') =>
    rpc<null>('admin_set_user_status', { p_user: userId, p_status: status }),
  adminSetMerchant: (userId: string, merchant: boolean) =>
    rpc<null>('admin_set_merchant', { p_user: userId, p_merchant: merchant }),
  adminAdjustPoints: (userId: string, amount: number, note: string) =>
    rpc<null>('admin_adjust_points', { p_user: userId, p_amount: amount, p_note: note }),
  adminUpdateSettings: (patch: Partial<Settings>) => rpc<null>('admin_update_settings', { p: patch }),

  /** Time-based rules; pg_cron runs them too, this keeps them moving if cron is off. */
  async tick(): Promise<void> {
    if (!current?.sessionUserId || Date.now() - lastTick < 55_000) return;
    lastTick = Date.now();
    const { data, error } = await supabase().rpc('run_maintenance');
    if (!error && data === true) await refresh();
  },
};

// ---------------------------------------------------------------- sign-in

export type LoginMethod = 'phone' | 'email';

function authMessage(e: { message?: string; status?: number; code?: string }): string {
  const m = e.message ?? '';
  if (e.status === 429 || /rate limit|only request this after|too many/i.test(m)) {
    return '寄送太頻繁，請等一分鐘後再試';
  }
  if (/expired|invalid.*(otp|token)|token.*invalid/i.test(m) || e.code === 'otp_expired') return '驗證碼不正確或已過期';
  if (/phone provider|sms|twilio|unsupported phone/i.test(m)) return '簡訊登入還沒設定好，請先改用 Email 登入';
  if (/invalid.*phone|phone.*invalid/i.test(m)) return '手機號碼格式不正確';
  if (/email.*invalid|invalid.*email/i.test(m)) return 'Email 格式不正確';
  if (/signups not allowed/i.test(m)) return '目前暫停開放註冊';
  if (/failed to fetch|network/i.test(m)) return '連不上伺服器，請檢查網路後再試';
  return m || '登入失敗，請稍後再試';
}

/** Taiwan mobile "0912345678" → E.164 "+886912345678". */
export const toE164 = (phone: string) => `+886${phone.slice(1)}`;

export const remoteAuth = {
  async sendCode(method: LoginMethod, id: string): Promise<Result> {
    const sb = supabase();
    const { error } =
      method === 'phone'
        ? await sb.auth.signInWithOtp({ phone: toE164(id) })
        : await sb.auth.signInWithOtp({
            email: id,
            options: { emailRedirectTo: `${window.location.origin}${BASE_PATH}/login` },
          });
    return error ? fail(authMessage(error)) : ok(null);
  },

  /** Verifies the code, then reports whether this login still needs a nickname. */
  async verifyCode(method: LoginMethod, id: string, code: string): Promise<Result<DB['auth']>> {
    const sb = supabase();
    const { error } =
      method === 'phone'
        ? await sb.auth.verifyOtp({ phone: toE164(id), token: code, type: 'sms' })
        : await sb.auth.verifyOtp({ email: id, token: code, type: 'email' });
    if (error) return fail(authMessage(error));
    await refresh();
    const state = current?.auth ?? null;
    if (state?.state === 'suspended') {
      await sb.auth.signOut();
      await refresh();
      return fail('這個帳號已被停權，請聯絡客服。');
    }
    return ok(state);
  },

  completeSignup: (name: string) => rpc<{ bonus: number }>('complete_signup', { p_name: name }),

  async cancelSignup(): Promise<void> {
    await supabase().auth.signOut();
    await refresh();
  },
};
