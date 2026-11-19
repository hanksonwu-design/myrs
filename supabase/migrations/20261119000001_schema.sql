-- Myrs MVP schema for Supabase.
--
-- Design:
--   * Clients only SELECT, through row level security.
--   * Every write goes through a SECURITY DEFINER function below, so the point
--     rules (hold, release, transfer, fee, rewards) cannot be bypassed from the browser.
--   * Internal helpers live in the `private` schema, which PostgREST does not expose.
--   * Exact meeting locations sit in listing_secrets; `listings` only has the fuzzed point.

create schema if not exists private;

-- ============================================================ tables

create table public.settings (
  id int primary key default 1 check (id = 1),
  fee_rate double precision not null default 0.1,
  min_fee int not null default 1,
  signup_bonus int not null default 50,
  first_listing_reward int not null default 20,
  first_order_reward int not null default 30,
  monthly_reward_cap int not null default 100,
  free_daily_limit int not null default 3,
  new_account_days int not null default 7,
  new_account_points_cap int not null default 200,
  request_timeout_hours double precision not null default 24,
  auto_complete_hours double precision not null default 48,
  review_window_days double precision not null default 7,
  report_hide_threshold int not null default 3,
  reward_expiry_months int not null default 12,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- One row per auth user. No foreign key to auth.users on purpose: a deleted
-- account leaves this row behind as a tombstone so old orders still resolve.
create table public.profiles (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 20),
  bio text not null default '' check (char_length(bio) <= 100),
  role text not null default 'member' check (role in ('member', 'admin')),
  merchant boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  love_score int not null default 0,
  color text not null default '#00A078',
  created_at timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id),
  blocked_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id),
  category text not null check (category in ('food', 'clothing')),
  sub text not null default '',
  title text not null,
  description text not null default '',
  quantity int not null check (quantity between 1 and 99),
  remaining int not null check (remaining >= 0),
  mode text not null check (mode in ('free', 'points', 'swap')),
  price_points int not null default 0,
  swap_wish text not null default '',
  expires_on date,
  storage text,
  photos text[] not null default '{}',
  lat double precision not null, -- public, fuzzed 60–180 m
  lng double precision not null,
  area_label text not null,
  time_slots text not null,
  status text not null default 'active'
    check (status in ('pending_review', 'active', 'reserved', 'closed', 'expired', 'removed')),
  flagged_words text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index listings_owner_idx on public.listings (owner_id);
create index listings_status_idx on public.listings (status);

create table public.listing_secrets (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  lat double precision not null,
  lng double precision not null
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id),
  requester_id uuid not null references public.profiles (id),
  provider_id uuid not null references public.profiles (id),
  mode text not null check (mode in ('free', 'points', 'swap')),
  points int not null default 0,
  fee int not null default 0,
  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'completed', 'cancelled', 'disputed')),
  note text not null default '',
  swap_offer text not null default '',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text not null default '',
  requester_done_at timestamptz,
  provider_done_at timestamptz,
  dispute_reason text not null default '',
  dispute_by uuid,
  resolution text not null default ''
);
create index orders_listing_idx on public.orders (listing_id);
create index orders_requester_idx on public.orders (requester_id);
create index orders_provider_idx on public.orders (provider_id);
create index orders_status_idx on public.orders (status);

-- Points are never stored as a balance: balance = sum(amount) per user.
create table public.ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  order_id uuid references public.orders (id),
  type text not null check (type in ('signup_bonus', 'reward', 'hold', 'release', 'transfer_in', 'fee', 'adjust')),
  amount int not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid
);
create index ledger_user_idx on public.ledger (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  sender_id uuid references public.profiles (id), -- null = system message
  body text not null default '',
  image text, -- path in the chat-images bucket
  created_at timestamptz not null default now()
);
create index messages_order_idx on public.messages (order_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  reviewer_id uuid not null references public.profiles (id),
  reviewee_id uuid not null references public.profiles (id),
  stars int not null check (stars between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  unique (order_id, reviewer_id)
);
create index reviews_reviewee_idx on public.reviews (reviewee_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('listing', 'user')),
  target_id uuid not null,
  reporter_id uuid, -- null = automatic system flag
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  handled_by uuid
);
create index reports_target_idx on public.reports (target_id);

create table public.admin_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id),
  action text not null,
  created_at timestamptz not null default now()
);

create table public.chat_reads (
  user_id uuid not null references public.profiles (id),
  order_id uuid not null references public.orders (id),
  read_at timestamptz not null default now(),
  primary key (user_id, order_id)
);

-- Hash of each phone/email that already received the signup bonus, so deleting
-- and re-creating an account does not grant it again. Never readable by clients.
create table public.signup_grants (
  identity_hash text primary key,
  created_at timestamptz not null default now()
);

-- ============================================================ private helpers

create or replace function private.today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;

create or replace function private.settings() returns public.settings
language sql stable security definer set search_path = public as $$
  select * from public.settings where id = 1
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active'
  )
$$;

create or replace function private.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  )
$$;

create or replace function private.is_party(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders
    where id = p_order and (requester_id = auth.uid() or provider_id = auth.uid())
  )
$$;

-- Same as is_party, but takes the first folder of a storage path (text) safely.
create or replace function private.is_party_text(p_order text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders
    where id::text = p_order and (requester_id = auth.uid() or provider_id = auth.uid())
  )
$$;

create or replace function private.can_chat_text(p_order text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders
    where id::text = p_order
      and (requester_id = auth.uid() or provider_id = auth.uid())
      and accepted_at is not null and status <> 'cancelled'
  )
$$;

create or replace function private.has_requested(p_listing uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders where listing_id = p_listing and requester_id = auth.uid())
$$;

create or replace function private.owns_listing(p_listing uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.listings where id = p_listing and owner_id = auth.uid())
$$;

-- Exact location: owner, admin, or someone whose request was accepted.
create or replace function private.can_see_exact(p_listing uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.owns_listing(p_listing) or private.is_admin() or exists (
    select 1 from public.orders
    where listing_id = p_listing and requester_id = auth.uid() and accepted_at is not null
  )
$$;

-- Reviews are blind: public once both sides reviewed, or once the review window closed.
create or replace function private.review_published(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order and o.completed_at is not null and (
      (select count(*) from public.reviews r where r.order_id = o.id) >= 2
      or now() - o.completed_at > interval '1 day' * (select review_window_days from public.settings where id = 1)
    )
  )
$$;

-- The signed-in, active member. Raises the user-facing error otherwise.
create or replace function private.me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  u public.profiles;
begin
  if auth.uid() is null then
    raise exception '請先登入';
  end if;
  select * into u from public.profiles where id = auth.uid();
  if not found or u.status = 'deleted' then
    raise exception '請先登入';
  end if;
  if u.status = 'suspended' then
    raise exception '這個帳號已被停權，請聯絡客服。';
  end if;
  return u;
end $$;

create or replace function private.require_admin() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  u public.profiles := private.me();
begin
  if u.role <> 'admin' then
    raise exception '只有管理員可以執行這個操作';
  end if;
  return u;
end $$;

create or replace function private.balance(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from public.ledger where user_id = p_user
$$;

create or replace function private.calc_fee(p_points int) returns int
language sql stable security definer set search_path = public as $$
  select case when p_points <= 0 then 0
    else greatest(s.min_fee, ceil(p_points * s.fee_rate)::int) end
  from public.settings s where s.id = 1
$$;

create or replace function private.add_ledger(
  p_user uuid, p_type text, p_amount int, p_note text,
  p_order uuid default null, p_created_by uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
begin
  insert into public.ledger (user_id, order_id, type, amount, note, expires_at, created_by)
  values (
    p_user, p_order, p_type, p_amount, p_note,
    case when p_type in ('reward', 'signup_bonus')
      then now() + interval '1 day' * (s.reward_expiry_months * 30) end,
    p_created_by
  );
end $$;

create or replace function private.sys_msg(p_order uuid, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.messages (order_id, sender_id, body) values (p_order, null, p_body)
$$;

create or replace function private.log_admin(p_admin uuid, p_action text) returns void
language sql security definer set search_path = public as $$
  insert into public.admin_log (admin_id, action) values (p_admin, p_action)
$$;

create or replace function private.rewards_this_month(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from public.ledger
  where user_id = p_user and type = 'reward'
    and date_trunc('month', created_at at time zone 'Asia/Taipei')
      = date_trunc('month', now() at time zone 'Asia/Taipei')
$$;

-- Grants up to the monthly cap; returns what was actually given.
create or replace function private.grant_reward(p_user uuid, p_amount int, p_note text) returns int
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  give int := least(p_amount, s.monthly_reward_cap - private.rewards_this_month(p_user));
begin
  if give > 0 then
    perform private.add_ledger(p_user, 'reward', give, p_note);
    return give;
  end if;
  return 0;
end $$;

create or replace function private.banned_words() returns text[]
language sql immutable as $$
  select array['香菸', '菸', '電子煙', '啤酒', '紅酒', '高粱', '酒', '藥', '處方', '保健食品', '奶粉',
    '武器', '刀械', '活體', '寵物', '仿冒', '高仿', '內衣', '內褲', '熟食', '自製']
$$;

create or replace function private.cancel_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.status in ('completed', 'cancelled') then
    return;
  end if;
  update public.orders
    set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    where id = o.id;
  if o.mode = 'points' and o.points > 0 then
    perform private.add_ledger(o.requester_id, 'release', o.points, '交易取消，退回凍結點數', o.id);
  end if;
  if o.status in ('accepted', 'disputed') then
    update public.listings
      set remaining = remaining + 1,
          status = case when status = 'reserved' then 'active' else status end
      where id = o.listing_id;
  end if;
  if o.accepted_at is not null then
    perform private.sys_msg(o.id, '交易已取消：' || p_reason);
  end if;
end $$;

create or replace function private.complete_order(p_order uuid, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  o public.orders;
  l public.listings;
  pid uuid;
  pair int;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.status not in ('accepted', 'disputed') then
    return;
  end if;
  select * into l from public.listings where id = o.listing_id for update;
  update public.orders set status = 'completed', completed_at = now() where id = o.id;

  if o.mode = 'points' and o.points > 0 then
    perform private.add_ledger(o.provider_id, 'transfer_in', o.points,
      format('「%s」點數收入', coalesce(l.title, '刊登')), o.id);
    if o.fee > 0 then
      perform private.add_ledger(o.provider_id, 'fee', -o.fee, '平台手續費', o.id);
    end if;
  end if;
  if o.mode = 'free' then
    update public.profiles set love_score = love_score + 1 where id = o.provider_id;
  end if;

  foreach pid in array array[o.requester_id, o.provider_id] loop
    if not exists (
      select 1 from public.orders x
      where x.id <> o.id and x.status = 'completed' and (x.requester_id = pid or x.provider_id = pid)
    ) then
      perform private.grant_reward(pid, s.first_order_reward, '首次完成交易獎勵');
    end if;
  end loop;

  if l.remaining <= 0 and not exists (
    select 1 from public.orders x
    where x.listing_id = l.id and x.status in ('requested', 'accepted', 'disputed')
  ) then
    update public.listings set status = 'closed' where id = l.id;
  end if;

  perform private.sys_msg(o.id, p_message);

  -- Anti-farming flag: the same pair trading points 3+ times within 7 days.
  if o.mode = 'points' then
    select count(*) into pair from public.orders x
    where x.status = 'completed' and x.mode = 'points'
      and ((x.requester_id = o.requester_id and x.provider_id = o.provider_id)
        or (x.requester_id = o.provider_id and x.provider_id = o.requester_id))
      and now() - x.completed_at < interval '7 days';
    if pair >= 3 and not exists (
      select 1 from public.reports
      where status = 'open' and reporter_id is null and target_id = o.requester_id
    ) then
      insert into public.reports (target_type, target_id, reporter_id, reason)
      values ('user', o.requester_id, null, format('與 %s 在 7 天內完成 %s 筆點數交易，疑似刷點',
        (select name from public.profiles where id = o.provider_id), pair));
    end if;
  end if;
end $$;

-- ============================================================ time-based rules

-- Request timeout, auto-complete and food expiry. Run by pg_cron (see the cron
-- migration) and also called by clients as a fallback; safe to run concurrently.
create or replace function private.run_maintenance() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  r record;
  changed boolean := false;
begin
  for r in
    select id from public.orders
    where status = 'requested' and created_at < now() - interval '1 hour' * s.request_timeout_hours
    for update skip locked
  loop
    perform private.cancel_order(r.id, format('提供者 %s 小時內未回應，自動取消', s.request_timeout_hours));
    changed := true;
  end loop;

  for r in
    select id from public.orders
    where status = 'accepted'
      and (requester_done_at is null) <> (provider_done_at is null)
      and coalesce(requester_done_at, provider_done_at) < now() - interval '1 hour' * s.auto_complete_hours
    for update skip locked
  loop
    perform private.complete_order(r.id, format('對方 %s 小時內沒有回應，交易自動完成。', s.auto_complete_hours));
    changed := true;
  end loop;

  for r in
    select id from public.listings
    where expires_on is not null and expires_on < private.today()
      and status in ('active', 'pending_review')
    for update skip locked
  loop
    update public.listings set status = 'expired' where id = r.id;
    perform private.cancel_order(o.id, '食品已過期，自動下架')
      from public.orders o where o.listing_id = r.id and o.status = 'requested';
    changed := true;
  end loop;

  return changed;
end $$;

-- ============================================================ public RPCs: account

create or replace function public.run_maintenance() returns boolean
language sql security definer set search_path = public as $$ select private.run_maintenance() $$;

create or replace function public.complete_signup(p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  v_uid uuid := auth.uid();
  v_phone text;
  v_email text;
  v_hash text;
  v_bonus int := 0;
  n text := btrim(coalesce(p_name, ''));
  colors text[] := array['#00A078', '#00A8E8', '#F0A000', '#E03050', '#00A038'];
begin
  if v_uid is null then
    raise exception '請先登入';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception '這個帳號已經註冊過';
  end if;
  if char_length(n) < 1 or char_length(n) > 20 then
    raise exception '暱稱請填 1 到 20 個字';
  end if;
  select phone, email into v_phone, v_email from auth.users where id = v_uid;
  insert into public.profiles (id, name, color)
  values (v_uid, n, colors[1 + floor(random() * 5)::int]);

  v_hash := encode(sha256(convert_to(
    coalesce(nullif(v_phone, ''), lower(nullif(v_email, '')), v_uid::text), 'UTF8')), 'hex');
  insert into public.signup_grants (identity_hash) values (v_hash) on conflict do nothing;
  if found then
    perform private.add_ledger(v_uid, 'signup_bonus', s.signup_bonus, '新手點數');
    v_bonus := s.signup_bonus;
  end if;
  return json_build_object('bonus', v_bonus);
end $$;

create or replace function public.update_profile(p_name text, p_bio text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  n text := btrim(coalesce(p_name, ''));
begin
  if char_length(n) < 1 or char_length(n) > 20 then
    raise exception '暱稱請填 1 到 20 個字';
  end if;
  if char_length(coalesce(p_bio, '')) > 100 then
    raise exception '自我介紹最多 100 個字';
  end if;
  update public.profiles set name = n, bio = btrim(coalesce(p_bio, '')) where id = u.id;
end $$;

create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  r record;
begin
  for r in
    select id from public.orders
    where (requester_id = u.id or provider_id = u.id) and status in ('requested', 'accepted')
  loop
    perform private.cancel_order(r.id, '對方已刪除帳號');
  end loop;
  update public.listings set status = 'closed'
    where owner_id = u.id and status in ('active', 'pending_review', 'reserved');
  delete from public.blocks where blocker_id = u.id;
  update public.profiles set status = 'deleted', name = '已刪除的使用者', bio = '' where id = u.id;
  -- Remove the login itself; if the role lacks the privilege, the tombstone above still applies.
  begin
    delete from auth.users where id = u.id;
  exception when others then
    null;
  end;
end $$;

create or replace function public.toggle_block(p_other uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
begin
  if p_other = u.id then
    raise exception '不能封鎖自己';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception '找不到這個使用者';
  end if;
  delete from public.blocks where blocker_id = u.id and blocked_id = p_other;
  if found then
    return false;
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (u.id, p_other);
  return true;
end $$;

-- ============================================================ public RPCs: listings

create or replace function public.create_listing(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  v_title text := btrim(coalesce(p->>'title', ''));
  v_desc text := btrim(coalesce(p->>'description', ''));
  v_category text := p->>'category';
  v_mode text := p->>'mode';
  v_qty int;
  v_price int := 0;
  v_swap text := btrim(coalesce(p->>'swapWish', ''));
  v_expires date;
  v_storage text := nullif(p->>'storage', '');
  v_area text := btrim(coalesce(p->>'areaLabel', ''));
  v_slots text := btrim(coalesce(p->>'timeSlots', ''));
  v_lat double precision;
  v_lng double precision;
  v_photos text[];
  v_flagged text[];
  v_first boolean;
  v_angle double precision := random() * 2 * pi();
  v_dist double precision := 60 + random() * 120;
  v_id uuid;
  v_status text;
  v_reward int := 0;
begin
  if v_category not in ('food', 'clothing') then raise exception '請選擇分類'; end if;
  if v_mode not in ('free', 'points', 'swap') then raise exception '請選擇交換方式'; end if;
  if char_length(v_title) < 2 then raise exception '標題至少 2 個字'; end if;
  if char_length(v_title) > 40 then raise exception '標題最多 40 個字'; end if;
  if char_length(v_desc) > 500 then raise exception '說明最多 500 個字'; end if;
  begin
    v_qty := (p->>'quantity')::int;
    v_lat := (p->'location'->>'lat')::double precision;
    v_lng := (p->'location'->>'lng')::double precision;
    if v_mode = 'points' then v_price := (p->>'pricePoints')::int; end if;
    if v_category = 'food' then v_expires := nullif(p->>'expiresOn', '')::date; end if;
  exception when others then
    raise exception '刊登資料格式不正確';
  end;
  if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception '數量要在 1 到 99 之間'; end if;
  if v_mode = 'points' and (v_price is null or v_price < 1 or v_price > 5000) then
    raise exception '點數要是 1 到 5,000 的整數';
  end if;
  if v_mode = 'swap' and v_swap = '' then raise exception '請寫下想交換的東西'; end if;
  if v_category = 'food' then
    if v_expires is null then raise exception '食品必須填到期日'; end if;
    if v_expires < private.today() then raise exception '到期日不能早於今天'; end if;
    if v_storage is null or v_storage not in ('常溫', '冷藏', '冷凍') then raise exception '請選擇保存方式'; end if;
  else
    v_storage := null;
  end if;
  if v_area = '' then raise exception '請填寫地點名稱，例如「捷運大安站附近」'; end if;
  if v_slots = '' then raise exception '請填寫可面交的時段'; end if;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception '請在地圖上選擇面交地點';
  end if;

  select coalesce(array_agg(x), '{}') into v_photos
    from jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb)) x;
  if cardinality(v_photos) > 6 then raise exception '照片最多 6 張'; end if;
  if exists (select 1 from unnest(v_photos) x where x !~ '^https?://' or char_length(x) > 500) then
    raise exception '照片網址不正確';
  end if;

  select coalesce(array_agg(w), '{}') into v_flagged
    from unnest(private.banned_words()) w
    where position(w in v_title || ' ' || v_desc || ' ' || (case when v_mode = 'swap' then v_swap else '' end)) > 0;

  v_first := not exists (select 1 from public.listings where owner_id = u.id);
  v_status := case when cardinality(v_flagged) > 0 then 'pending_review' else 'active' end;

  insert into public.listings (
    owner_id, category, sub, title, description, quantity, remaining, mode, price_points, swap_wish,
    expires_on, storage, photos, lat, lng, area_label, time_slots, status, flagged_words
  ) values (
    u.id, v_category, left(coalesce(p->>'sub', ''), 20), v_title, v_desc, v_qty, v_qty, v_mode, v_price,
    case when v_mode = 'swap' then v_swap else '' end,
    v_expires, v_storage, v_photos,
    v_lat + v_dist * cos(v_angle) / 111320,
    v_lng + v_dist * sin(v_angle) / (111320 * cos(radians(v_lat))),
    v_area, v_slots, v_status, v_flagged
  ) returning id into v_id;
  insert into public.listing_secrets (listing_id, lat, lng) values (v_id, v_lat, v_lng);

  if v_first then
    v_reward := private.grant_reward(u.id, (private.settings()).first_listing_reward, '首次刊登獎勵');
  end if;
  return json_build_object('id', v_id, 'status', v_status, 'reward', v_reward);
end $$;

create or replace function public.close_listing(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  l public.listings;
  r record;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found or l.owner_id <> u.id then raise exception '找不到這則刊登'; end if;
  if exists (select 1 from public.orders where listing_id = l.id and status in ('accepted', 'disputed')) then
    raise exception '還有進行中的交易，請先完成或取消再下架';
  end if;
  for r in select id from public.orders where listing_id = l.id and status = 'requested' loop
    perform private.cancel_order(r.id, '提供者已下架這則刊登');
  end loop;
  update public.listings set status = 'closed' where id = l.id;
end $$;

-- ============================================================ public RPCs: orders

create or replace function public.request_listing(p_listing uuid, p_note text, p_swap_offer text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  s public.settings := private.settings();
  l public.listings;
  n int;
  bal int;
  spent int;
  v_id uuid;
begin
  -- Lock the requester first so two requests cannot spend the same points.
  perform 1 from public.profiles where id = u.id for update;
  select * into l from public.listings where id = p_listing for update;
  if not found or l.status <> 'active' then raise exception '這則刊登目前無法索取'; end if;
  if l.owner_id = u.id then raise exception '不能索取自己的刊登'; end if;
  if private.is_blocked(u.id, l.owner_id) then raise exception '你和對方之間有封鎖，無法索取'; end if;
  if l.remaining <= 0 then raise exception '已經被索取完了'; end if;
  if exists (
    select 1 from public.orders
    where listing_id = l.id and requester_id = u.id and status in ('requested', 'accepted', 'disputed')
  ) then
    raise exception '你已經索取過這則刊登，請等對方回覆';
  end if;
  if l.mode = 'free' then
    select count(*) into n from public.orders
      where requester_id = u.id and mode = 'free'
        and (created_at at time zone 'Asia/Taipei')::date = private.today();
    if n >= s.free_daily_limit then
      raise exception '免費索取每天最多 % 件，明天再來吧', s.free_daily_limit;
    end if;
  end if;
  if l.mode = 'points' then
    bal := private.balance(u.id);
    if bal < l.price_points then
      raise exception '點數不足：需要 % 點，你目前可用 % 點', l.price_points, bal;
    end if;
    if now() - u.created_at < interval '1 day' * s.new_account_days then
      select coalesce(sum(points), 0) into spent from public.orders
        where requester_id = u.id and mode = 'points' and status <> 'cancelled';
      if spent + l.price_points > s.new_account_points_cap then
        raise exception '新帳號 % 天內點數交易上限 % 點', s.new_account_days, s.new_account_points_cap;
      end if;
    end if;
  end if;
  if l.mode = 'swap' and btrim(coalesce(p_swap_offer, '')) = '' then
    raise exception '請寫下你想拿來交換的東西';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception '留言最多 200 個字'; end if;

  insert into public.orders (listing_id, requester_id, provider_id, mode, points, fee, note, swap_offer)
  values (
    l.id, u.id, l.owner_id, l.mode,
    case when l.mode = 'points' then l.price_points else 0 end,
    case when l.mode = 'points' then private.calc_fee(l.price_points) else 0 end,
    btrim(coalesce(p_note, '')),
    case when l.mode = 'swap' then btrim(p_swap_offer) else '' end
  ) returning id into v_id;
  if l.mode = 'points' then
    perform private.add_ledger(u.id, 'hold', -l.price_points, format('索取「%s」', l.title), v_id);
  end if;
  return v_id;
end $$;

create or replace function public.accept_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  o public.orders;
  l public.listings;
  r record;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.provider_id <> u.id then raise exception '找不到這筆索取'; end if;
  if o.status <> 'requested' then raise exception '這筆索取已經處理過了'; end if;
  select * into l from public.listings where id = o.listing_id for update;
  if l.remaining <= 0 then raise exception '數量不足，無法接受'; end if;

  update public.orders set status = 'accepted', accepted_at = now() where id = o.id;
  update public.listings set remaining = remaining - 1 where id = l.id;
  if o.note <> '' then
    insert into public.messages (order_id, sender_id, body, created_at)
    values (o.id, o.requester_id, o.note, o.created_at);
  end if;
  perform private.sys_msg(o.id, format('%s 接受了索取，現在可以聊天約面交，精確地點已顯示在上方。', u.name));
  if l.remaining - 1 = 0 then
    update public.listings set status = 'reserved' where id = l.id;
    for r in
      select id from public.orders where listing_id = l.id and id <> o.id and status = 'requested'
    loop
      perform private.cancel_order(r.id, '物品已被其他人預約');
    end loop;
  end if;
end $$;

create or replace function public.decline_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  o public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.provider_id <> u.id then raise exception '找不到這筆索取'; end if;
  if o.status <> 'requested' then raise exception '這筆索取已經處理過了'; end if;
  perform private.cancel_order(o.id, case when v_reason <> '' then '提供者婉拒：' || v_reason else '提供者婉拒' end);
end $$;

create or replace function public.cancel_my_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  o public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into o from public.orders where id = p_order for update;
  if not found or (o.requester_id <> u.id and o.provider_id <> u.id) then
    raise exception '找不到這筆交易';
  end if;
  if o.status = 'requested' then
    if o.requester_id <> u.id then raise exception '提供者請用「婉拒」'; end if;
    perform private.cancel_order(o.id, '索取者撤回');
    return;
  end if;
  if o.status <> 'accepted' then raise exception '這筆交易現在不能取消'; end if;
  if o.requester_done_at is not null or o.provider_done_at is not null then
    raise exception '已有一方確認完成，若有問題請提出爭議';
  end if;
  if v_reason = '' then raise exception '請說明取消原因'; end if;
  perform private.cancel_order(o.id, format('%s 取消：%s', u.name, v_reason));
end $$;

-- Returns true when this confirmation completed the deal.
create or replace function public.mark_done(p_order uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  s public.settings := private.settings();
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or (o.requester_id <> u.id and o.provider_id <> u.id) then
    raise exception '找不到這筆交易';
  end if;
  if o.status <> 'accepted' then raise exception '只有進行中的交易可以確認完成'; end if;
  if o.requester_id = u.id then
    update public.orders set requester_done_at = coalesce(requester_done_at, now()) where id = o.id
      returning * into o;
  else
    update public.orders set provider_done_at = coalesce(provider_done_at, now()) where id = o.id
      returning * into o;
  end if;
  if o.requester_done_at is not null and o.provider_done_at is not null then
    perform private.complete_order(o.id, '雙方都已確認完成，交易完成。');
    return true;
  end if;
  perform private.sys_msg(o.id, format('%s 已確認完成，等待對方確認；%s 小時內沒有回應會自動完成。',
    u.name, s.auto_complete_hours));
  return false;
end $$;

create or replace function public.open_dispute(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  o public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into o from public.orders where id = p_order for update;
  if not found or (o.requester_id <> u.id and o.provider_id <> u.id) then
    raise exception '找不到這筆交易';
  end if;
  if o.status <> 'accepted' then raise exception '只有進行中的交易可以提出爭議'; end if;
  if v_reason = '' then raise exception '請說明發生了什麼事'; end if;
  if char_length(v_reason) > 300 then raise exception '說明最多 300 個字'; end if;
  update public.orders set status = 'disputed', dispute_by = u.id, dispute_reason = v_reason where id = o.id;
  perform private.sys_msg(o.id, format('%s 提出爭議：「%s」。管理員會介入處理，點數暫時維持凍結。', u.name, v_reason));
end $$;

create or replace function public.send_message(p_order uuid, p_body text, p_image text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  o public.orders;
  v_body text := btrim(coalesce(p_body, ''));
  v_image text := nullif(p_image, '');
begin
  select * into o from public.orders where id = p_order;
  if not found or (o.requester_id <> u.id and o.provider_id <> u.id) or o.accepted_at is null then
    raise exception '目前無法在這筆交易中聊天';
  end if;
  if o.status = 'cancelled' then raise exception '交易已取消，無法再傳訊息'; end if;
  if private.is_blocked(o.requester_id, o.provider_id) then raise exception '你和對方之間有封鎖'; end if;
  if v_body = '' and v_image is null then raise exception '訊息是空的'; end if;
  if char_length(v_body) > 500 then raise exception '訊息最多 500 個字'; end if;
  if v_image is not null and v_image not like o.id::text || '/%' then raise exception '照片路徑不正確'; end if;
  insert into public.messages (order_id, sender_id, body, image) values (o.id, u.id, v_body, v_image);
  insert into public.chat_reads (user_id, order_id, read_at) values (u.id, o.id, now())
    on conflict (user_id, order_id) do update set read_at = excluded.read_at;
end $$;

create or replace function public.mark_read(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
begin
  if not private.is_party(p_order) then return; end if;
  insert into public.chat_reads (user_id, order_id, read_at) values (u.id, p_order, now())
    on conflict (user_id, order_id) do update set read_at = excluded.read_at;
end $$;

create or replace function public.submit_review(p_order uuid, p_stars int, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  s public.settings := private.settings();
  o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or (o.requester_id <> u.id and o.provider_id <> u.id)
    or o.status <> 'completed' or o.completed_at is null then
    raise exception '只有完成的交易可以評價';
  end if;
  if now() - o.completed_at > interval '1 day' * s.review_window_days then
    raise exception '評價期限是完成後 % 天', s.review_window_days;
  end if;
  if exists (select 1 from public.reviews where order_id = o.id and reviewer_id = u.id) then
    raise exception '你已經評價過了';
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception '請選 1 到 5 顆星'; end if;
  if char_length(coalesce(p_comment, '')) > 200 then raise exception '評語最多 200 個字'; end if;
  insert into public.reviews (order_id, reviewer_id, reviewee_id, stars, comment)
  values (o.id, u.id, case when o.requester_id = u.id then o.provider_id else o.requester_id end,
    p_stars, btrim(coalesce(p_comment, '')));
end $$;

-- Returns true when this report hid the listing.
create or replace function public.report(p_target_type text, p_target_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  s public.settings := private.settings();
  v_reason text := btrim(coalesce(p_reason, ''));
  l public.listings;
  reporters int;
begin
  if v_reason = '' then raise exception '請選擇或填寫檢舉原因'; end if;
  if char_length(v_reason) > 250 then raise exception '檢舉原因最多 250 個字'; end if;
  if p_target_type = 'user' then
    if p_target_id = u.id then raise exception '不能檢舉自己'; end if;
    if not exists (select 1 from public.profiles where id = p_target_id) then raise exception '找不到檢舉對象'; end if;
  elsif p_target_type = 'listing' then
    select * into l from public.listings where id = p_target_id for update;
    if not found then raise exception '找不到檢舉對象'; end if;
    if l.owner_id = u.id then raise exception '不能檢舉自己的刊登'; end if;
  else
    raise exception '檢舉類型不正確';
  end if;
  if exists (
    select 1 from public.reports where target_id = p_target_id and reporter_id = u.id and status = 'open'
  ) then
    raise exception '你已經檢舉過了，管理員會盡快處理';
  end if;
  insert into public.reports (target_type, target_id, reporter_id, reason)
  values (p_target_type, p_target_id, u.id, v_reason);

  if p_target_type = 'listing' and l.status = 'active' then
    select count(distinct reporter_id) into reporters from public.reports
      where target_id = p_target_id and status = 'open' and reporter_id is not null;
    if reporters >= s.report_hide_threshold then
      update public.listings set status = 'pending_review' where id = l.id;
      return true;
    end if;
  end if;
  return false;
end $$;

-- ============================================================ public RPCs: admin

create or replace function public.admin_set_listing_status(p_listing uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_admin();
  l public.listings;
  r record;
begin
  if p_status not in ('active', 'removed') then raise exception '狀態不正確'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found then raise exception '找不到這則刊登'; end if;
  if p_status = 'removed' then
    for r in select id from public.orders where listing_id = l.id and status in ('requested', 'accepted') loop
      perform private.cancel_order(r.id, '刊登已被管理員下架');
    end loop;
  end if;
  update public.listings set status = p_status where id = l.id;
  perform private.log_admin(a.id, format('%s刊登「%s」', case when p_status = 'active' then '核准' else '下架' end, l.title));
end $$;

create or replace function public.admin_handle_report(p_report uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_admin();
  rp public.reports;
  l public.listings;
  t public.profiles;
  r record;
  v_target_user uuid;
begin
  select * into rp from public.reports where id = p_report for update;
  if not found or rp.status <> 'open' then raise exception '這筆檢舉已處理過'; end if;

  if p_action = 'dismiss' then
    update public.reports set status = 'dismissed', handled_by = a.id where target_id = rp.target_id and status = 'open';
    if rp.target_type = 'listing' then
      update public.listings set status = 'active'
        where id = rp.target_id and status = 'pending_review' and cardinality(flagged_words) = 0;
    end if;
    perform private.log_admin(a.id, '駁回檢舉：' || rp.reason);
    return;
  end if;

  if p_action = 'remove_listing' then
    if rp.target_type <> 'listing' then raise exception '檢舉對象不是刊登'; end if;
    select * into l from public.listings where id = rp.target_id for update;
    if not found then raise exception '檢舉對象不是刊登'; end if;
    for r in select id from public.orders where listing_id = l.id and status in ('requested', 'accepted') loop
      perform private.cancel_order(r.id, '刊登已被管理員下架');
    end loop;
    update public.listings set status = 'removed' where id = l.id;
    update public.reports set status = 'resolved', handled_by = a.id where target_id = rp.target_id and status = 'open';
    perform private.log_admin(a.id, format('依檢舉下架刊登「%s」', l.title));
    return;
  end if;

  if p_action = 'suspend_user' then
    v_target_user := case when rp.target_type = 'user' then rp.target_id
      else (select owner_id from public.listings where id = rp.target_id) end;
    select * into t from public.profiles where id = v_target_user for update;
    if not found or t.role = 'admin' then raise exception '無法停權這個帳號'; end if;
    update public.profiles set status = 'suspended' where id = t.id;
    update public.reports set status = 'resolved', handled_by = a.id where target_id = rp.target_id and status = 'open';
    perform private.log_admin(a.id, format('依檢舉停權「%s」', t.name));
    return;
  end if;

  raise exception '處理方式不正確';
end $$;

create or replace function public.admin_resolve_dispute(p_order uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_admin();
  o public.orders;
  v_note text := btrim(coalesce(p_note, ''));
  v_suffix text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.status <> 'disputed' then raise exception '這筆交易不在爭議中'; end if;
  if p_outcome not in ('complete', 'refund') then raise exception '裁定結果不正確'; end if;
  v_suffix := case when v_note <> '' then '：' || v_note else '' end;
  update public.orders set resolution = v_note where id = o.id;
  if p_outcome = 'complete' then
    perform private.complete_order(o.id, '管理員裁定交易成立' || v_suffix || '。');
  else
    perform private.cancel_order(o.id, '管理員裁定退回' || v_suffix);
  end if;
  perform private.log_admin(a.id, format('爭議裁定（%s）：%s',
    case when p_outcome = 'complete' then '成立' else '退回' end,
    coalesce((select title from public.listings where id = o.listing_id), o.id::text)));
end $$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_admin();
  t public.profiles;
begin
  if p_status not in ('active', 'suspended') then raise exception '狀態不正確'; end if;
  select * into t from public.profiles where id = p_user for update;
  if not found or t.status = 'deleted' then raise exception '找不到這個使用者'; end if;
  if t.role = 'admin' then raise exception '不能停權管理員'; end if;
  update public.profiles set status = p_status where id = t.id;
  perform private.log_admin(a.id, format('%s使用者「%s」', case when p_status = 'active' then '恢復' else '停權' end, t.name));
end $$;

create or replace function public.admin_set_merchant(p_user uuid, p_merchant boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_admin();
  t public.profiles;
begin
  select * into t from public.profiles where id = p_user for update;
  if not found then raise exception '找不到這個使用者'; end if;
  update public.profiles set merchant = p_merchant where id = t.id;
  perform private.log_admin(a.id, format('%s試點商家「%s」', case when p_merchant then '開通' else '取消' end, t.name));
end $$;

create or replace function public.admin_adjust_points(p_user uuid, p_amount int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_admin();
  t public.profiles;
  v_note text := btrim(coalesce(p_note, ''));
begin
  select * into t from public.profiles where id = p_user for update;
  if not found then raise exception '找不到這個使用者'; end if;
  if p_amount is null or p_amount = 0 then raise exception '調整點數要是非 0 的整數'; end if;
  if v_note = '' then raise exception '調整點數必須填寫原因'; end if;
  if private.balance(t.id) + p_amount < 0 then raise exception '調整後餘額不能小於 0'; end if;
  perform private.add_ledger(t.id, 'adjust', p_amount, '管理員調整：' || v_note, null, a.id);
  perform private.log_admin(a.id, format('調整「%s」點數 %s%s（%s）', t.name,
    case when p_amount > 0 then '+' else '' end, p_amount, v_note));
end $$;

-- p: camelCase or snake_case keys of the settings table; only given keys change.
create or replace function public.admin_update_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_admin();
  cur public.settings := private.settings();
  nxt public.settings;
  k text;
  v jsonb;
  col text;
  int_cols text[] := array['min_fee', 'signup_bonus', 'first_listing_reward', 'first_order_reward',
    'monthly_reward_cap', 'free_daily_limit', 'new_account_days', 'new_account_points_cap',
    'report_hide_threshold', 'reward_expiry_months'];
  num_cols text[] := array['fee_rate', 'request_timeout_hours', 'auto_complete_hours', 'review_window_days'];
  clean jsonb := '{}';
begin
  for k, v in select * from jsonb_each(coalesce(p, '{}')) loop
    col := lower(regexp_replace(k, '([A-Z])', '_\1', 'g'));
    if not (col = any (int_cols) or col = any (num_cols)) then
      raise exception '沒有「%」這個參數', k;
    end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 then
      raise exception '「%」必須是 0 以上的數字', k;
    end if;
    if col = any (int_cols) and (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then
      raise exception '「%」必須是整數', k;
    end if;
    clean := clean || jsonb_build_object(col, v);
  end loop;
  if (clean ? 'fee_rate') and (clean->>'fee_rate')::numeric > 0.5 then
    raise exception '手續費比例不能超過 50%%';
  end if;
  nxt := jsonb_populate_record(cur, clean);
  update public.settings set
    fee_rate = nxt.fee_rate, min_fee = nxt.min_fee, signup_bonus = nxt.signup_bonus,
    first_listing_reward = nxt.first_listing_reward, first_order_reward = nxt.first_order_reward,
    monthly_reward_cap = nxt.monthly_reward_cap, free_daily_limit = nxt.free_daily_limit,
    new_account_days = nxt.new_account_days, new_account_points_cap = nxt.new_account_points_cap,
    request_timeout_hours = nxt.request_timeout_hours, auto_complete_hours = nxt.auto_complete_hours,
    review_window_days = nxt.review_window_days, report_hide_threshold = nxt.report_hide_threshold,
    reward_expiry_months = nxt.reward_expiry_months, updated_at = now()
  where id = 1;
  perform private.log_admin(a.id, '更新平台參數');
end $$;

-- ============================================================ row level security

alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.listings enable row level security;
alter table public.listing_secrets enable row level security;
alter table public.orders enable row level security;
alter table public.ledger enable row level security;
alter table public.messages enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.admin_log enable row level security;
alter table public.chat_reads enable row level security;
alter table public.signup_grants enable row level security;

create policy settings_read on public.settings for select using (true);
create policy profiles_read on public.profiles for select using (true);
create policy blocks_read on public.blocks for select using (blocker_id = auth.uid());
create policy listings_read on public.listings for select using (
  (status in ('active', 'reserved') and not private.is_blocked(auth.uid(), owner_id))
  or owner_id = auth.uid()
  or private.is_admin()
  or private.has_requested(id)
);
create policy listing_secrets_read on public.listing_secrets for select using (private.can_see_exact(listing_id));
create policy orders_read on public.orders for select using (
  requester_id = auth.uid() or provider_id = auth.uid() or private.is_admin()
);
create policy ledger_read on public.ledger for select using (user_id = auth.uid() or private.is_admin());
create policy messages_read on public.messages for select using (private.is_party(order_id) or private.is_admin());
create policy reviews_read on public.reviews for select using (
  reviewer_id = auth.uid() or private.is_admin() or private.review_published(order_id)
);
create policy reports_read on public.reports for select using (reporter_id = auth.uid() or private.is_admin());
create policy admin_log_read on public.admin_log for select using (private.is_admin());
create policy chat_reads_read on public.chat_reads for select using (user_id = auth.uid());
-- signup_grants: no policy, so nobody but the functions above can read it.

-- ============================================================ privileges

-- Clients read through RLS and write only through the functions above.
-- Explicit grants, so this works whether or not the project auto-exposes new tables.
grant usage on schema public to anon, authenticated;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
revoke select on public.signup_grants from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

grant usage on schema private to anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_admin(), private.is_blocked(uuid, uuid), private.is_party(uuid),
  private.is_party_text(text), private.can_chat_text(text), private.has_requested(uuid),
  private.owns_listing(uuid), private.can_see_exact(uuid), private.review_published(uuid)
  to anon, authenticated;

-- ============================================================ realtime

alter publication supabase_realtime add table
  public.settings, public.profiles, public.blocks, public.listings, public.listing_secrets,
  public.orders, public.ledger, public.messages, public.reviews, public.reports,
  public.admin_log, public.chat_reads;
