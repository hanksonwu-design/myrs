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

/** Staff levels, highest first. Only users with role 'admin' (the staff) have one. */
export type AdminLevel = 'owner' | 'admin' | 'moderator';

export interface User {
  id: string;
  phone: string;
  name: string;
  bio: string;
  /** 'admin' means staff of any level; see adminLevel. */
  role: 'member' | 'admin';
  adminLevel?: AdminLevel | null;
  merchant: boolean;
  status: 'active' | 'suspended' | 'deleted';
  loveScore: number;
  blocked: string[];
  color: string;
  createdAt: number;
  /** Supabase mode: completed deals counted by the server (others' orders are not visible). */
  completedDeals?: number;
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
  /** Who cancelled it (null for automatic cancellations). Demo mode only. */
  cancelledBy?: string | null;
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
  /** Accepted deals nobody confirms are cancelled after this many days (0 = never). */
  acceptTimeoutDays: number;
}

export interface Favorite {
  userId: string;
  listingId: string;
  createdAt: number;
}
/** A keyword alert: new listings matching it within radiusKm of (lat, lng) send an e-mail. */
export interface SavedSearch {
  id: string;
  userId: string;
  keyword: string;
  category: Category | null;
  radiusKm: number;
  lat: number;
  lng: number;
  createdAt: number;
}
export interface AdminLog {
  id: string;
  adminId: string;
  action: string;
  createdAt: number;
}

export interface Suspension {
  id: string;
  userId: string;
  reason: string;
  /** null: no end date. */
  until: number | null;
  createdBy: string | null;
  createdAt: number;
  liftedAt: number | null;
  /** null with liftedAt set: the period ended on its own. */
  liftedBy: string | null;
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
  favorites: Favorite[];
  savedSearches: SavedSearch[];
  suspensions: Suspension[];
  /** Supabase mode only: who is signed in, and whether they still need a profile. */
  auth?: { identity: string; state: 'needs_signup' | 'ok' | 'suspended' } | null;
  /** Supabase mode only: set when the first load failed (e.g. migrations not applied). */
  loadError?: string;
}
