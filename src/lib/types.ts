// Myrs data model (MVP). Mirrors section 8 of the development doc.
// Demo mode keeps these in localStorage; Supabase mode builds the same shapes
// from the tables in supabase/migrations (see src/lib/remote.ts).

export type Category = 'food' | 'clothing';
export type Mode = 'free' | 'points' | 'swap';
export type ListingStatus =
  | 'pending_review'
  | 'active'
  | 'reserved'
  | 'closed'
  | 'expired'
  | 'removed';
export type OrderStatus = 'requested' | 'accepted' | 'completed' | 'cancelled' | 'disputed';
export type LedgerType =
  | 'signup_bonus'
  | 'reward'
  | 'hold'
  | 'release'
  | 'transfer_in'
  | 'fee'
  | 'adjust';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface User {
  id: string;
  phone: string;
  name: string;
  bio: string;
  role: 'member' | 'admin';
  merchant: boolean;
  status: 'active' | 'suspended' | 'deleted';
  loveScore: number;
  blocked: string[];
  color: string;
  createdAt: number;
}

export interface Listing {
  id: string;
  ownerId: string;
  category: Category;
  sub: string;
  title: string;
  description: string;
  quantity: number;
  remaining: number;
  mode: Mode;
  pricePoints: number;
  swapWish: string;
  expiresOn: string | null; // YYYY-MM-DD, food only
  storage: string | null; // 常溫 / 冷藏 / 冷凍, food only
  photos: string[]; // data URLs
  location: LatLng; // exact when the viewer may see it; otherwise the public point
  publicLocation?: LatLng; // fuzzed point shown to everyone (set by the server in Supabase mode)
  areaLabel: string;
  timeSlots: string;
  status: ListingStatus;
  flaggedWords: string[];
  createdAt: number;
}

export interface Order {
  id: string;
  listingId: string;
  requesterId: string;
  providerId: string;
  mode: Mode;
  points: number;
  fee: number;
  status: OrderStatus;
  note: string;
  swapOffer: string;
  createdAt: number;
  acceptedAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  cancelReason: string;
  requesterDoneAt: number | null;
  providerDoneAt: number | null;
  disputeReason: string;
  disputeBy: string | null;
  resolution: string;
}

export interface LedgerEntry {
  id: string;
  userId: string;
  orderId: string | null;
  type: LedgerType;
  amount: number; // + in, - out
  note: string;
  createdAt: number;
  expiresAt: number | null;
  createdBy: string | null;
}

export interface Message {
  id: string;
  orderId: string;
  senderId: string | null; // null = system message
  body: string;
  image: string | null;
  createdAt: number;
}

export interface Review {
  id: string;
  orderId: string;
  reviewerId: string;
  revieweeId: string;
  stars: number;
  comment: string;
  createdAt: number;
}

export interface Report {
  id: string;
  targetType: 'listing' | 'user';
  targetId: string;
  reporterId: string; // 'system' for automatic flags
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: number;
  handledBy: string | null;
}

export interface Settings {
  feeRate: number;
  minFee: number;
  signupBonus: number;
  firstListingReward: number;
  firstOrderReward: number;
  monthlyRewardCap: number;
  freeDailyLimit: number;
  newAccountDays: number;
  newAccountPointsCap: number;
  requestTimeoutHours: number;
  autoCompleteHours: number;
  reviewWindowDays: number;
  reportHideThreshold: number;
  rewardExpiryMonths: number;
}

export interface AdminLog {
  id: string;
  adminId: string;
  action: string;
  createdAt: number;
}

export interface DB {
  version: number;
  clockOffsetMs: number; // demo "fast forward"
  sessionUserId: string | null;
  users: User[];
  listings: Listing[];
  orders: Order[];
  ledger: LedgerEntry[];
  messages: Message[];
  reviews: Review[];
  reports: Report[];
  settings: Settings;
  adminLog: AdminLog[];
  lastRead: Record<string, number>; // `${userId}:${orderId}` -> time
  /** Supabase mode only: who is signed in, and whether they still need a profile. */
  auth?: { identity: string; state: 'needs_signup' | 'ok' | 'suspended' } | null;
  /** Supabase mode only: set when the first load failed (e.g. migrations not applied). */
  loadError?: string;
}
