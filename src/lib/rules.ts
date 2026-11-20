import type { Category, ListingStatus, Mode, OrderStatus, Settings, SiteInfo, Want } from './types';

export const DEFAULT_SETTINGS: Settings = {
  feeRate: 0.1,
  minFee: 1,
  signupBonus: 50,
  firstListingReward: 20,
  firstOrderReward: 30,
  inviteReward: 20,
  monthlyRewardCap: 100,
  freeDailyLimit: 3,
  newAccountDays: 7,
  newAccountPointsCap: 200,
  requestTimeoutHours: 24,
  autoCompleteHours: 48,
  reviewWindowDays: 7,
  reportHideThreshold: 3,
  rewardExpiryMonths: 12,
  acceptTimeoutDays: 7,
};

export const CATEGORIES: Record<Category, { label: string; subs: string[] }> = {
  food: { label: '食', subs: ['即期品', '包裝食品', '生鮮蔬果'] },
  clothing: { label: '衣', subs: ['上衣', '下身', '外套', '童裝', '鞋子', '包包配件'] },
};

// Best guess of a sub-category from a title, e.g. when a listing answers a want (徵求).
const SUB_HINTS: [string, RegExp][] = [
  ['外套', /外套|大衣|夾克|羽絨|風衣/],
  ['鞋子', /鞋|靴/],
  ['包包配件', /包包|背包|提袋|帽|圍巾|手套|皮帶|飾品/],
  ['下身', /褲|裙/],
  ['童裝', /童|寶寶|嬰兒|幼兒/],
  ['上衣', /衣|衫|T恤|毛衣|帽T/],
  ['即期品', /即期|快到期|鮮奶|牛奶|麵包|吐司/],
  ['生鮮蔬果', /菜|果|蔬|蛋|肉|魚|地瓜|番茄/],
  ['包裝食品', /罐頭|零食|餅乾|泡麵|米|麵|調味|飲料/],
];
export function guessSub(category: Category, title: string): string {
  const subs = CATEGORIES[category].subs;
  return SUB_HINTS.find(([sub, re]) => subs.includes(sub) && re.test(title))?.[0] ?? subs[0];
}

export const STORAGE_OPTIONS = ['常溫', '冷藏', '冷凍'];

export const MODE_LABEL: Record<Mode, string> = {
  free: '免費',
  points: '點數',
  swap: '以物易物',
};

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  pending_review: '審核中',
  active: '刊登中',
  reserved: '已被預約',
  closed: '已結束',
  expired: '已過期',
  removed: '已下架（管理員）',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  requested: '等待回覆',
  accepted: '已接受',
  completed: '已完成',
  cancelled: '已取消',
  disputed: '爭議中',
};

export const RADIUS_OPTIONS = [1, 3, 5, 10];

/** Wanted posts (徵求): the same limits the server checks (migration 9). */
export const WANT_DAYS = 14;
export const WANT_MAX_OPEN = 3;
export const WANT_DAILY_MAX = 5;
export const WANT_MAX_ANSWERS = 3;

/** A new member can use an invite code within this many days of joining. */
export const INVITE_DAYS = 7;
const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Six characters without 0/O or 1/I, like private.new_invite_code. */
export const randomInviteCode = () =>
  Array.from({ length: 6 }, () => INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)]).join('');
/** Codes ignore case and spaces, as redeem_invite does. */
export const normalizeInviteCode = (s: string) => s.replace(/\s/g, '').toUpperCase();

/** Whether others can see and answer a want now. */
export const wantOpen = (w: Want, now: number) => w.status === 'open' && w.expiresAt > now;

export function wantStatusLabel(w: Want, now: number): string {
  if (w.status === 'removed') return '已移除';
  if (w.status === 'hidden') return '審核中';
  if (w.status === 'closed') return '已結束';
  return w.expiresAt > now ? '徵求中' : '已過期';
}

// Words that send a listing to manual review (doc section 10).
export const BANNED_WORDS = [
  '香菸',
  '菸',
  '電子煙',
  '啤酒',
  '紅酒',
  '高粱',
  '酒',
  '藥',
  '處方',
  '保健食品',
  '奶粉',
  '武器',
  '刀械',
  '活體',
  '寵物',
  '仿冒',
  '高仿',
  '內衣',
  '內褲',
  '熟食',
  '自製',
];

export function findBannedWords(text: string, words: readonly string[] = BANNED_WORDS): string[] {
  return words.filter((w) => text.includes(w));
}

export const DEFAULT_SITE: SiteInfo = {
  bannedWords: BANNED_WORDS,
  announcement: '',
  announcementUntil: null,
  announcementAt: null,
};

/** Whether the announcement shows now. */
export const announcementOn = (s: SiteInfo, now: number) =>
  !!s.announcement && (s.announcementUntil === null || s.announcementUntil > now);

/** Names and units the settings log uses; the server writes the same text (migration 8). */
const SETTING_LOG: [keyof Settings, string, string][] = [
  ['feeRate', '手續費比例', '%'],
  ['minFee', '最低手續費', ' 點'],
  ['signupBonus', '新手點數', ' 點'],
  ['firstListingReward', '首次刊登獎勵', ' 點'],
  ['firstOrderReward', '首次完成交易獎勵', ' 點'],
  ['inviteReward', '邀請獎勵', ' 點'],
  ['monthlyRewardCap', '每月獎勵上限', ' 點'],
  ['rewardExpiryMonths', '獎勵點數有效期', ' 個月'],
  ['freeDailyLimit', '免費索取每日上限', ' 件'],
  ['newAccountDays', '新帳號觀察期', ' 天'],
  ['newAccountPointsCap', '新帳號點數交易上限', ' 點'],
  ['requestTimeoutHours', '索取逾時自動取消', ' 小時'],
  ['autoCompleteHours', '單方確認後自動完成', ' 小時'],
  ['acceptTimeoutDays', '接受後都沒人確認，自動取消', ' 天'],
  ['reviewWindowDays', '評價期限', ' 天'],
  ['reportHideThreshold', '檢舉幾人自動隱藏', ' 人'],
];

/** e.g. ['手續費比例 10% → 8%'] */
export function settingsChanges(a: Settings, b: Settings): string[] {
  const show = (k: keyof Settings, v: number) => `${+(k === 'feeRate' ? v * 100 : v).toFixed(4)}`;
  return SETTING_LOG.filter(([k]) => a[k] !== b[k]).map(
    ([k, label, unit]) => `${label} ${show(k, a[k])}${unit} → ${show(k, b[k])}${unit}`,
  );
}

/**
 * Fee charged to the provider on a points deal: rate, rounded up, at least minFee,
 * but never the whole price, so the provider always gets at least 1 point.
 * Same rule as private.calc_fee in Supabase.
 */
export function calcFee(points: number, s: Settings): number {
  if (points <= 1) return 0;
  return Math.min(Math.max(s.minFee, Math.ceil(points * s.feeRate)), points - 1);
}

export const PHONE_RE = /^09\d{8}$/;
export const DEMO_OTP = '123456';
