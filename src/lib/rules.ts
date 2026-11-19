import type { Category, ListingStatus, Mode, OrderStatus, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  feeRate: 0.1,
  minFee: 1,
  signupBonus: 50,
  firstListingReward: 20,
  firstOrderReward: 30,
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

export function findBannedWords(text: string): string[] {
  return BANNED_WORDS.filter((w) => text.includes(w));
}

/** Fee charged to the provider on a points deal: rate, rounded up, at least minFee. */
export function calcFee(points: number, s: Settings): number {
  if (points <= 0) return 0;
  return Math.max(s.minFee, Math.ceil(points * s.feeRate));
}

export const PHONE_RE = /^09\d{8}$/;
export const DEMO_OTP = '123456';
