import { calcFee, DEFAULT_SETTINGS, DEFAULT_SITE } from './rules';
import { DAY, HOUR, ymdLocal } from './format';
import type { DB, LedgerEntry, Listing, Message, Order, Review, User } from './types';

export const DB_VERSION = 1;

const COLORS = ['#00A078', '#00A8E8', '#F0A000', '#E03050', '#00A038'];

/** Demo data for the 大安區 pilot. Times are relative to `now`. */
export function createSeed(now: number): DB {
  const settings = { ...DEFAULT_SETTINGS };
  const day = (n: number) => ymdLocal(now + n * DAY);

  const user = (
    id: string,
    name: string,
    phone: string,
    bio: string,
    ageDays: number,
    extra: Partial<User> = {},
  ): User => ({
    id,
    phone,
    name,
    bio,
    role: 'member',
    merchant: false,
    status: 'active',
    loveScore: 0,
    blocked: [],
    color: COLORS[id.length % COLORS.length],
    createdAt: now - ageDays * DAY,
    ...extra,
  });

  const users: User[] = [
    user('u_lin', '林媽媽', '0912345678', '大安區兩個孩子的媽，童裝常常穿不完。', 60, {
      loveScore: 4,
      color: '#E03050',
    }),
    user('u_chen', '陳先生', '0922333444', '上班族，冰箱常有吃不完的東西。', 30, { color: '#00A8E8' }),
    user('u_wang', '小王', '0933555666', '大學生，喜歡以物易物。', 20, { color: '#F0A000' }),
    user('u_huang', '黃阿姨', '0955111222', '家裡菜園自己種的菜，吃不完分大家。', 90, {
      loveScore: 9,
      color: '#00A038',
    }),
    user('u_bakery', '晨光烘焙', '0944777888', '試點商家：每天打烊前釋出當日麵包。', 45, {
      merchant: true,
      color: '#00A078',
    }),
    user('u_admin', 'Myrs 管理員', '0900000000', '平台營運團隊', 120, {
      role: 'admin',
      adminLevel: 'owner',
      color: '#334155',
    }),
  ];

  let hoursAgo = 1;
  const listing = (
    id: string,
    ownerId: string,
    data: Partial<Listing> & Pick<Listing, 'category' | 'sub' | 'title' | 'location' | 'areaLabel'>,
  ): Listing => {
    hoursAgo += 3;
    const quantity = data.quantity ?? 1;
    return {
      id,
      ownerId,
      description: '',
      quantity,
      remaining: data.remaining ?? quantity,
      mode: 'free',
      pricePoints: 0,
      swapWish: '',
      expiresOn: null,
      storage: null,
      photos: [],
      timeSlots: '平日 18:00 後、週末全天',
      status: 'active',
      flaggedWords: [],
      createdAt: now - hoursAgo * HOUR,
      ...data,
    };
  };

  const listings: Listing[] = [
    listing('l_dress', 'u_lin', {
      category: 'clothing',
      sub: '童裝',
      title: '女童洋裝 120cm 兩件',
      description: '只穿過幾次，已洗淨。適合 5–6 歲的小朋友。',
      location: { lat: 25.033, lng: 121.5297 },
      areaLabel: '永康街附近',
    }),
    listing('l_greens', 'u_huang', {
      category: 'food',
      sub: '生鮮蔬果',
      title: '自家種地瓜葉一大把',
      description: '今天早上剛採，沒有噴農藥。一人一把，帶袋子來裝。',
      quantity: 3,
      expiresOn: day(2),
      storage: '冷藏',
      location: { lat: 25.0322, lng: 121.5349 },
      areaLabel: '大安森林公園站附近',
      timeSlots: '每天 7:00–10:00',
    }),
    listing('l_bread', 'u_bakery', {
      category: 'food',
      sub: '即期品',
      title: '當日麵包（獨立包裝）',
      description: '打烊前釋出，每個獨立包裝，口味隨機。到店門口報名字即可。',
      quantity: 6,
      remaining: 5,
      mode: 'points',
      pricePoints: 15,
      expiresOn: day(1),
      storage: '常溫',
      location: { lat: 25.0331, lng: 121.5435 },
      areaLabel: '捷運大安站附近',
      timeSlots: '每天 20:00–21:30',
    }),
    listing('l_yogurt', 'u_chen', {
      category: 'food',
      sub: '即期品',
      title: '優格 6 入（明天到期）',
      description: '買太多吃不完，未開封，一直放冰箱。',
      mode: 'points',
      pricePoints: 30,
      expiresOn: day(1),
      storage: '冷藏',
      location: { lat: 25.0262, lng: 121.5435 },
      areaLabel: '捷運科技大樓站附近',
      timeSlots: '平日 19:00 後',
    }),
    listing('l_cookies', 'u_chen', {
      category: 'food',
      sub: '包裝食品',
      title: '進口餅乾禮盒（未拆封）',
      description: '公司發的禮盒，家裡不吃甜食。',
      mode: 'swap',
      swapWish: '洗衣精或衛生紙',
      expiresOn: day(90),
      storage: '常溫',
      location: { lat: 25.0268, lng: 121.5428 },
      areaLabel: '捷運科技大樓站附近',
      timeSlots: '平日 19:00 後',
    }),
    listing('l_shoes', 'u_wang', {
      category: 'clothing',
      sub: '鞋子',
      title: '運動鞋 US9（八成新）',
      description: '尺寸買錯，穿過三次。',
      mode: 'swap',
      swapWish: 'US10 的運動鞋',
      location: { lat: 25.0207, lng: 121.5285 },
      areaLabel: '捷運台電大樓站附近',
    }),
    listing('l_jacket', 'u_wang', {
      category: 'clothing',
      sub: '外套',
      title: '羽絨外套 男 L',
      description: '穿過一季，沒有破損，附收納袋。',
      mode: 'points',
      pricePoints: 300,
      location: { lat: 25.0255, lng: 121.529 },
      areaLabel: '師大路附近',
    }),
    listing('l_baby', 'u_lin', {
      category: 'clothing',
      sub: '童裝',
      title: '嬰兒連身衣 6 件（60–70cm）',
      description: '孩子長太快，幾乎全新。',
      location: { lat: 25.0339, lng: 121.5288 },
      areaLabel: '捷運東門站附近',
    }),
    listing('l_tomato', 'u_huang', {
      category: 'food',
      sub: '生鮮蔬果',
      title: '小番茄一盒',
      description: '自家陽台種的，甜度很高。',
      mode: 'points',
      pricePoints: 20,
      expiresOn: day(3),
      storage: '冷藏',
      location: { lat: 25.03, lng: 121.538 },
      areaLabel: '大安森林公園附近',
      timeSlots: '每天 7:00–10:00',
    }),
    listing('l_tote', 'u_chen', {
      category: 'clothing',
      sub: '包包配件',
      title: '帆布托特包',
      description: '容量大，可以放筆電。',
      mode: 'points',
      pricePoints: 80,
      location: { lat: 25.0333, lng: 121.5527 },
      areaLabel: '捷運信義安和站附近',
    }),
    listing('l_rice', 'u_lin', {
      category: 'food',
      sub: '包裝食品',
      title: '白米 2 公斤（未拆封）',
      description: '親戚送的，家裡還有很多。',
      mode: 'points',
      pricePoints: 60,
      expiresOn: day(120),
      storage: '常溫',
      location: { lat: 25.0326, lng: 121.5302 },
      areaLabel: '永康街附近',
    }),
    listing('l_jeans', 'u_wang', {
      category: 'clothing',
      sub: '下身',
      title: '牛仔褲 W30',
      description: '直筒版型，褲長 100cm。',
      mode: 'points',
      pricePoints: 120,
      location: { lat: 25.0212, lng: 121.5292 },
      areaLabel: '捷運台電大樓站附近',
    }),
    listing('l_toast', 'u_bakery', {
      category: 'food',
      sub: '即期品',
      title: '吐司兩條（後天到期）',
      description: '原味吐司，整條未切。',
      quantity: 2,
      mode: 'points',
      pricePoints: 25,
      expiresOn: day(2),
      storage: '常溫',
      location: { lat: 25.0331, lng: 121.5435 },
      areaLabel: '捷運大安站附近',
      timeSlots: '每天 20:00–21:30',
    }),
    listing('l_shirt', 'u_huang', {
      category: 'clothing',
      sub: '上衣',
      title: '學生制服襯衫（女 M）',
      description: '孫女畢業了，兩件都很新。',
      location: { lat: 25.029, lng: 121.5372 },
      areaLabel: '大安森林公園附近',
    }),
    listing('l_beer', 'u_wang', {
      category: 'food',
      sub: '包裝食品',
      title: '啤酒一手（未開）',
      description: '抽獎抽到的，不喝酒。',
      mode: 'points',
      pricePoints: 100,
      expiresOn: day(60),
      storage: '常溫',
      location: { lat: 25.0259, lng: 121.5296 },
      areaLabel: '師大路附近',
      status: 'pending_review',
      flaggedWords: ['啤酒', '酒'],
    }),
    // Already given away (history for the demo reviews).
    listing('l_kidcoat', 'u_lin', {
      category: 'clothing',
      sub: '童裝',
      title: '男童外套 130cm',
      location: { lat: 25.033, lng: 121.5297 },
      areaLabel: '永康街附近',
      remaining: 0,
      status: 'closed',
      createdAt: now - 6 * DAY,
    }),
    listing('l_dumpling', 'u_huang', {
      category: 'food',
      sub: '包裝食品',
      title: '冷凍水餃 1 包（未拆封）',
      mode: 'points',
      pricePoints: 40,
      expiresOn: day(30),
      storage: '冷凍',
      location: { lat: 25.0322, lng: 121.5349 },
      areaLabel: '大安森林公園站附近',
      remaining: 0,
      status: 'closed',
      createdAt: now - 5 * DAY,
    }),
  ];

  const order = (o: Partial<Order> & Pick<Order, 'id' | 'listingId' | 'requesterId' | 'providerId' | 'createdAt'>): Order => ({
    mode: 'free',
    points: 0,
    fee: 0,
    status: 'requested',
    note: '',
    swapOffer: '',
    acceptedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: '',
    requesterDoneAt: null,
    providerDoneAt: null,
    disputeReason: '',
    disputeBy: null,
    resolution: '',
    ...o,
  });

  const orders: Order[] = [
    order({
      id: 'o_kidcoat',
      listingId: 'l_kidcoat',
      requesterId: 'u_wang',
      providerId: 'u_lin',
      status: 'completed',
      createdAt: now - 4 * DAY,
      acceptedAt: now - 4 * DAY + 2 * HOUR,
      requesterDoneAt: now - 3 * DAY,
      providerDoneAt: now - 3 * DAY,
      completedAt: now - 3 * DAY,
      note: '想給弟弟穿，謝謝！',
    }),
    order({
      id: 'o_dumpling',
      listingId: 'l_dumpling',
      requesterId: 'u_chen',
      providerId: 'u_huang',
      mode: 'points',
      points: 40,
      fee: calcFee(40, settings),
      status: 'completed',
      createdAt: now - 3 * DAY,
      acceptedAt: now - 3 * DAY + HOUR,
      requesterDoneAt: now - 2 * DAY,
      providerDoneAt: now - 2 * DAY,
      completedAt: now - 2 * DAY,
    }),
    order({
      id: 'o_dress',
      listingId: 'l_dress',
      requesterId: 'u_chen',
      providerId: 'u_lin',
      createdAt: now - 2 * HOUR,
      note: '想給姪女穿，請問週六下午可以嗎？',
    }),
    order({
      id: 'o_bread',
      listingId: 'l_bread',
      requesterId: 'u_lin',
      providerId: 'u_bakery',
      mode: 'points',
      points: 15,
      fee: calcFee(15, settings),
      status: 'accepted',
      createdAt: now - 3 * HOUR,
      acceptedAt: now - 2 * HOUR,
      note: '想要一個，謝謝！',
    }),
  ];

  const msg = (id: string, orderId: string, senderId: string | null, body: string, t: number): Message => ({
    id,
    orderId,
    senderId,
    body,
    image: null,
    createdAt: t,
  });
  const messages: Message[] = [
    msg('m1', 'o_kidcoat', 'u_wang', '想給弟弟穿，謝謝！', now - 4 * DAY),
    msg('m2', 'o_kidcoat', null, '林媽媽 接受了索取，現在可以聊天約面交。', now - 4 * DAY + 2 * HOUR),
    msg('m3', 'o_kidcoat', 'u_lin', '明天晚上 7 點永康公園門口可以嗎？', now - 4 * DAY + 2 * HOUR + 60_000),
    msg('m4', 'o_kidcoat', 'u_wang', '可以，到了傳訊息給你。', now - 4 * DAY + 3 * HOUR),
    msg('m5', 'o_kidcoat', null, '雙方都已確認完成，交易完成。', now - 3 * DAY),
    msg('m6', 'o_dumpling', null, '黃阿姨 接受了索取，現在可以聊天約面交。', now - 3 * DAY + HOUR),
    msg('m7', 'o_dumpling', null, '雙方都已確認完成，交易完成。', now - 2 * DAY),
    msg('m8', 'o_bread', 'u_lin', '想要一個，謝謝！', now - 3 * HOUR),
    msg('m9', 'o_bread', null, '晨光烘焙 接受了索取，現在可以聊天約面交。', now - 2 * HOUR),
    msg('m10', 'o_bread', 'u_bakery', '晚上 9 點前到店門口報名字就可以！', now - 2 * HOUR + 120_000),
  ];

  const reviews: Review[] = [
    {
      id: 'r1',
      orderId: 'o_kidcoat',
      reviewerId: 'u_wang',
      revieweeId: 'u_lin',
      stars: 5,
      comment: '很好溝通，衣服很乾淨。',
      createdAt: now - 3 * DAY + HOUR,
    },
    {
      id: 'r2',
      orderId: 'o_kidcoat',
      reviewerId: 'u_lin',
      revieweeId: 'u_wang',
      stars: 5,
      comment: '準時到，很有禮貌。',
      createdAt: now - 3 * DAY + 2 * HOUR,
    },
    {
      id: 'r3',
      orderId: 'o_dumpling',
      reviewerId: 'u_chen',
      revieweeId: 'u_huang',
      stars: 5,
      comment: '水餃很好吃！',
      createdAt: now - 2 * DAY + HOUR,
    },
  ];

  const expiry = (t: number) => t + settings.rewardExpiryMonths * 30 * DAY;
  const entry = (
    id: string,
    userId: string,
    type: LedgerEntry['type'],
    amount: number,
    note: string,
    t: number,
    orderId: string | null = null,
  ): LedgerEntry => ({
    id,
    userId,
    orderId,
    type,
    amount,
    note,
    createdAt: t,
    expiresAt: type === 'signup_bonus' || type === 'reward' ? expiry(t) : null,
    createdBy: null,
  });

  const ledger: LedgerEntry[] = [];
  for (const u of users) {
    if (u.role === 'admin') continue;
    ledger.push(entry(`e_sign_${u.id}`, u.id, 'signup_bonus', settings.signupBonus, '新手點數', u.createdAt));
  }
  for (const id of ['u_lin', 'u_chen', 'u_wang', 'u_huang', 'u_bakery']) {
    const u = users.find((x) => x.id === id)!;
    ledger.push(entry(`e_fl_${id}`, id, 'reward', settings.firstListingReward, '首次刊登獎勵', u.createdAt + HOUR));
  }
  ledger.push(entry('e_fo_wang', 'u_wang', 'reward', settings.firstOrderReward, '首次完成交易獎勵', now - 3 * DAY));
  ledger.push(entry('e_fo_lin', 'u_lin', 'reward', settings.firstOrderReward, '首次完成交易獎勵', now - 3 * DAY));
  ledger.push(entry('e_hold_chen', 'u_chen', 'hold', -40, '索取「冷凍水餃 1 包（未拆封）」', now - 3 * DAY, 'o_dumpling'));
  ledger.push(entry('e_in_huang', 'u_huang', 'transfer_in', 40, '「冷凍水餃 1 包（未拆封）」點數收入', now - 2 * DAY, 'o_dumpling'));
  ledger.push(entry('e_fee_huang', 'u_huang', 'fee', -calcFee(40, settings), '平台手續費', now - 2 * DAY, 'o_dumpling'));
  ledger.push(entry('e_fo_chen', 'u_chen', 'reward', settings.firstOrderReward, '首次完成交易獎勵', now - 2 * DAY));
  ledger.push(entry('e_fo_huang', 'u_huang', 'reward', settings.firstOrderReward, '首次完成交易獎勵', now - 2 * DAY));
  ledger.push(entry('e_hold_lin', 'u_lin', 'hold', -15, '索取「當日麵包（獨立包裝）」', now - 3 * HOUR, 'o_bread'));

  return {
    version: DB_VERSION,
    clockOffsetMs: 0,
    sessionUserId: null,
    users,
    listings,
    orders,
    ledger,
    messages,
    reviews,
    reports: [],
    settings,
    adminLog: [],
    lastRead: {},
    favorites: [],
    savedSearches: [],
    suspensions: [],
    site: { ...DEFAULT_SITE, bannedWords: [...DEFAULT_SITE.bannedWords] },
  };
}
