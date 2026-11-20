-- Improvements from the 2026-11-19 review, part 2.
-- Logic fixes (numbers follow the review report):
--    5. A suspended member's listings are hidden and cannot be requested, and their
--       unanswered requests are cancelled.
--    6. A provider can accept only while the listing is listed (not hidden by reports).
--    7. Blocking someone cancels the deals between the two that have not started.
--    8. Listing photos must be uploaded to Myrs storage (settings.photo_url_prefix).
--    9. Approving a listing clears its flagged words and dismisses its open reports.
--   10. A requester sees the exact spot only while the request is accepted, disputed
--       or completed, not after it was cancelled.
--   11. The fee never takes the whole price, so a 1-point deal still pays the provider.
--   12. Free requests that someone else declined or cancelled do not count toward the
--       daily limit.
--   13. Only listings waiting for review can be approved.
--   14. Timeouts and the report threshold must be at least 1.
-- New features:
--   - profiles.completed_deals, for the trust score shown in the app.
--   - Favorites (public.favorites) and keyword alerts (public.saved_searches): a new
--     listing that matches a saved keyword nearby queues an e-mail.
--   - update_listing_location: the owner moves the meeting spot before any deal is accepted.

-- ============================================================ columns

alter table public.settings add column if not exists photo_url_prefix text not null default '';
-- Public URL of the listing-photos bucket. Another project: replace the project ref.
-- An empty prefix turns the check off.
update public.settings
  set photo_url_prefix = 'https://mpswtcvwxuhtmwmbwocu.supabase.co/storage/v1/object/public/listing-photos/'
  where id = 1 and photo_url_prefix = '';

alter table public.orders add column if not exists cancelled_by uuid;

alter table public.profiles add column if not exists completed_deals int not null default 0;
update public.profiles p set completed_deals = (
  select count(*) from public.orders o
  where o.status = 'completed' and (o.requester_id = p.id or o.provider_id = p.id)
) where true;

-- Listings from before keyword alerts never send them; new listings start at false.
alter table public.listings add column if not exists alerts_sent boolean not null default true;
alter table public.listings alter column alerts_sent set default false;

-- ============================================================ helpers

create or replace function private.is_active_member(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and status = 'active')
$$;

create or replace function private.distance_km(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision
) returns double precision
language sql immutable as $$
  select 6371 * 2 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  )))
$$;

-- ============================================================ 10. exact spot

create or replace function private.can_see_exact(p_listing uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.owns_listing(p_listing) or private.is_admin() or exists (
    select 1 from public.orders
    where listing_id = p_listing and requester_id = auth.uid()
      and status in ('accepted', 'disputed', 'completed')
  )
$$;

-- ============================================================ 11. fee

create or replace function private.calc_fee(p_points int) returns int
language sql stable security definer set search_path = public as $$
  select case when p_points <= 1 then 0
    else least(greatest(s.min_fee, ceil(p_points * s.fee_rate)::int), p_points - 1) end
  from public.settings s where s.id = 1
$$;

-- ============================================================ 12. who cancelled

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
    set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, cancelled_by = auth.uid()
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

-- ============================================================ 5. suspended members

drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select using (
  (status in ('active', 'reserved') and not private.is_blocked(auth.uid(), owner_id)
    and private.is_active_member(owner_id))
  or owner_id = auth.uid()
  or private.is_admin()
  or private.has_requested(id)
);

-- Covers both admin_set_user_status and suspending through a report.
create or replace function private.on_profile_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if new.status = 'suspended' and old.status <> 'suspended' then
    for r in
      select id from public.orders
      where (requester_id = new.id or provider_id = new.id) and status = 'requested'
    loop
      perform private.cancel_order(r.id, '對方帳號目前無法使用，系統已自動取消');
    end loop;
  end if;
  return null;
end $$;

drop trigger if exists profiles_status on public.profiles;
create trigger profiles_status after update of status on public.profiles
  for each row execute function private.on_profile_status();

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
  if not found or l.status <> 'active' or not private.is_active_member(l.owner_id) then
    raise exception '這則刊登目前無法索取';
  end if;
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
    -- Requests someone else declined or cancelled do not use up the requester's quota.
    select count(*) into n from public.orders
      where requester_id = u.id and mode = 'free'
        and (created_at at time zone 'Asia/Taipei')::date = private.today()
        and (status <> 'cancelled' or cancelled_by = u.id);
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

-- ============================================================ 6, 7. accepting

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
  if l.status <> 'active' then raise exception '這則刊登目前暫停中，不能接受索取'; end if;
  if private.is_blocked(o.requester_id, u.id) then raise exception '你和對方之間有封鎖，不能接受'; end if;

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

-- ============================================================ 7. blocking

create or replace function public.toggle_block(p_other uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  r record;
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
  -- Deals that have not started end now. Once someone confirmed, or a dispute is
  -- open, the deal runs its course (auto-complete or the admin).
  for r in
    select id from public.orders
    where ((requester_id = u.id and provider_id = p_other) or (requester_id = p_other and provider_id = u.id))
      and (status = 'requested'
        or (status = 'accepted' and requester_done_at is null and provider_done_at is null))
  loop
    perform private.cancel_order(r.id, '其中一方無法繼續這筆交易，系統已自動取消');
  end loop;
  return true;
end $$;

-- ============================================================ 8. photos

create or replace function public.create_listing(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  s public.settings := private.settings();
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
  if char_length(v_area) > 40 then raise exception '地點名稱最多 40 個字'; end if;
  if v_slots = '' then raise exception '請填寫可面交的時段'; end if;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception '請在地圖上選擇面交地點';
  end if;

  select coalesce(array_agg(x), '{}') into v_photos
    from jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb)) x;
  if cardinality(v_photos) > 6 then raise exception '照片最多 6 張'; end if;
  if exists (
    select 1 from unnest(v_photos) x
    where x !~ '^https?://' or char_length(x) > 500 or position('..' in x) > 0
      or (s.photo_url_prefix <> '' and not starts_with(x, s.photo_url_prefix || u.id::text || '/'))
  ) then
    raise exception '照片要用 Myrs 上傳，不能用外部網址';
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
    v_reward := private.grant_reward(u.id, s.first_listing_reward, '首次刊登獎勵');
  end if;
  return json_build_object('id', v_id, 'status', v_status, 'reward', v_reward);
end $$;

-- ============================================================ meeting spot

create or replace function public.update_listing_location(
  p_listing uuid, p_lat double precision, p_lng double precision, p_area_label text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  l public.listings;
  v_area text := btrim(coalesce(p_area_label, ''));
  v_angle double precision := random() * 2 * pi();
  v_dist double precision := 60 + random() * 120;
begin
  select * into l from public.listings where id = p_listing for update;
  if not found or l.owner_id <> u.id then raise exception '找不到這則刊登'; end if;
  if l.status not in ('active', 'pending_review', 'reserved') then
    raise exception '這則刊登已經結束，不能修改地點';
  end if;
  if exists (select 1 from public.orders where listing_id = l.id and status in ('accepted', 'disputed')) then
    raise exception '已經有接受的交易，請在聊天室和對方另約地點';
  end if;
  if v_area = '' then raise exception '請填寫地點名稱，例如「捷運大安站附近」'; end if;
  if char_length(v_area) > 40 then raise exception '地點名稱最多 40 個字'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception '請在地圖上選擇面交地點';
  end if;
  update public.listings set
    lat = p_lat + v_dist * cos(v_angle) / 111320,
    lng = p_lng + v_dist * sin(v_angle) / (111320 * cos(radians(p_lat))),
    area_label = v_area
  where id = l.id;
  update public.listing_secrets set lat = p_lat, lng = p_lng where listing_id = l.id;
end $$;

-- ============================================================ 9, 13. admin approval

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
  if p_status = 'active' then
    if l.status <> 'pending_review' then raise exception '只有待審核的刊登可以核准'; end if;
    if l.expires_on is not null and l.expires_on < private.today() then
      raise exception '這項食品已經過期，不能核准';
    end if;
    -- Approving means the admin checked it: the flagged words and open reports are settled.
    update public.listings
      set status = case when remaining > 0 then 'active' else 'reserved' end, flagged_words = '{}'
      where id = l.id;
    update public.reports set status = 'dismissed', handled_by = a.id
      where target_id = l.id and status = 'open';
    perform private.log_admin(a.id, format('核准刊登「%s」', l.title));
    return;
  end if;
  if l.status = 'removed' then raise exception '這則刊登已經下架了'; end if;
  for r in
    select id from public.orders where listing_id = l.id and status in ('requested', 'accepted', 'disputed')
  loop
    perform private.cancel_order(r.id, '刊登已被管理員下架');
  end loop;
  update public.listings set status = 'removed' where id = l.id;
  perform private.log_admin(a.id, format('下架刊登「%s」', l.title));
end $$;

-- ============================================================ 14. settings

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
  num_cols text[] := array['fee_rate', 'request_timeout_hours', 'auto_complete_hours', 'review_window_days',
    'accept_timeout_days'];
  at_least_one text[] := array['request_timeout_hours', 'auto_complete_hours', 'review_window_days',
    'report_hide_threshold'];
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
    if col = any (at_least_one) and (v #>> '{}')::numeric < 1 then
      raise exception '「%」至少要是 1', k;
    end if;
    if col = 'accept_timeout_days' and (v #>> '{}')::numeric > 0 and (v #>> '{}')::numeric < 1 then
      raise exception '「%」要是 0（關閉）或 1 以上', k;
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
    reward_expiry_months = nxt.reward_expiry_months, accept_timeout_days = nxt.accept_timeout_days,
    updated_at = now()
  where id = 1;
  perform private.log_admin(a.id, '更新平台參數');
end $$;

-- ============================================================ trust score

create or replace function private.on_order_stats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    update public.profiles set completed_deals = completed_deals + 1
      where id in (new.requester_id, new.provider_id);
  end if;
  return null;
end $$;

drop trigger if exists orders_stats on public.orders;
create trigger orders_stats after update of status on public.orders
  for each row execute function private.on_order_stats();

-- ============================================================ favorites

create table if not exists public.favorites (
  user_id uuid not null references public.profiles (id),
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
alter table public.favorites enable row level security;
drop policy if exists favorites_read on public.favorites;
create policy favorites_read on public.favorites for select using (user_id = auth.uid());

-- Returns true when the listing is now a favorite.
create or replace function public.toggle_favorite(p_listing uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  l public.listings;
begin
  delete from public.favorites where user_id = u.id and listing_id = p_listing;
  if found then
    return false;
  end if;
  select * into l from public.listings where id = p_listing;
  if not found or l.status not in ('active', 'reserved') or private.is_blocked(u.id, l.owner_id) then
    raise exception '這則刊登目前無法收藏';
  end if;
  if l.owner_id = u.id then raise exception '不能收藏自己的刊登'; end if;
  if (select count(*) from public.favorites where user_id = u.id) >= 200 then
    raise exception '收藏最多 200 則，請先取消一些';
  end if;
  insert into public.favorites (user_id, listing_id) values (u.id, p_listing);
  return true;
end $$;

-- ============================================================ keyword alerts

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  keyword text not null check (char_length(keyword) between 1 and 20),
  category text check (category is null or category in ('food', 'clothing')),
  radius_km double precision not null check (radius_km between 0.5 and 20),
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists saved_searches_user_idx on public.saved_searches (user_id);
alter table public.saved_searches enable row level security;
drop policy if exists saved_searches_read on public.saved_searches;
create policy saved_searches_read on public.saved_searches for select using (user_id = auth.uid());

-- Saving the same keyword and category again updates its area instead of adding one.
create or replace function public.save_search(
  p_keyword text, p_category text, p_radius_km double precision, p_lat double precision, p_lng double precision
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  v_kw text := btrim(coalesce(p_keyword, ''));
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_id uuid;
begin
  if v_kw = '' then raise exception '請輸入關鍵字'; end if;
  if char_length(v_kw) > 20 then raise exception '關鍵字最多 20 個字'; end if;
  if v_cat is not null and v_cat not in ('food', 'clothing') then raise exception '分類不正確'; end if;
  if p_radius_km is null or p_radius_km < 0.5 or p_radius_km > 20 then
    raise exception '範圍要在 0.5 到 20 公里之間';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception '位置不正確';
  end if;
  perform 1 from public.profiles where id = u.id for update;
  select id into v_id from public.saved_searches
    where user_id = u.id and lower(keyword) = lower(v_kw) and category is not distinct from v_cat;
  if found then
    update public.saved_searches set radius_km = p_radius_km, lat = p_lat, lng = p_lng where id = v_id;
    return v_id;
  end if;
  if (select count(*) from public.saved_searches where user_id = u.id) >= 5 then
    raise exception '關鍵字通知最多 5 個，請先刪掉不需要的';
  end if;
  insert into public.saved_searches (user_id, keyword, category, radius_km, lat, lng)
    values (u.id, v_kw, v_cat, p_radius_km, p_lat, p_lng)
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_saved_search(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
begin
  delete from public.saved_searches where id = p_id and user_id = u.id;
  if not found then raise exception '找不到這個關鍵字通知'; end if;
end $$;

-- When a listing first goes live, queue one e-mail per member whose saved keyword
-- matches it nearby (public, fuzzed location), at most 10 alert mails a day each.
create or replace function private.on_listing_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_text text := lower(new.title || ' ' || new.description || ' ' || new.sub);
  v_price text := case new.mode
    when 'free' then '免費' when 'points' then format('%s 點', new.price_points) else '以物易物' end;
begin
  if new.status <> 'active' or new.alerts_sent then
    return new;
  end if;
  new.alerts_sent := true;
  for r in
    select distinct on (s.user_id) s.user_id, s.keyword
    from public.saved_searches s
    join public.profiles p on p.id = s.user_id and p.status = 'active'
    where s.user_id <> new.owner_id
      and (s.category is null or s.category = new.category)
      and position(lower(s.keyword) in v_text) > 0
      and private.distance_km(s.lat, s.lng, new.lat, new.lng) <= s.radius_km
      and not private.is_blocked(s.user_id, new.owner_id)
      and (
        select count(*) from public.notifications n
        where n.user_id = s.user_id and n.subject like '附近有新刊登%'
          and n.created_at > now() - interval '1 day'
      ) < 10
    order by s.user_id, s.created_at
  loop
    perform private.notify(r.user_id, format('附近有新刊登：「%s」', new.title),
      format(E'你訂閱的關鍵字「%s」有新刊登：\n%s（%s，%s）\n\n不想再收到的話，可以到 Myrs「我的」頁面刪除這個關鍵字通知。',
        r.keyword, new.title, v_price, new.area_label),
      '/listings/view?id=' || new.id);
  end loop;
  return new;
end $$;

drop trigger if exists listings_alerts on public.listings;
create trigger listings_alerts before insert or update of status on public.listings
  for each row execute function private.on_listing_alerts();

-- ============================================================ realtime

alter publication supabase_realtime add table public.favorites, public.saved_searches;

-- ============================================================ privileges

-- Clients read the new tables through RLS and write only through the functions above.
revoke all on public.favorites, public.saved_searches from anon, authenticated;
grant select on public.favorites, public.saved_searches to authenticated;

-- New functions are executable by PUBLIC by default; repeat the lockdown from migration 1.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_admin(), private.is_blocked(uuid, uuid), private.is_party(uuid),
  private.is_party_text(text), private.can_chat_text(text), private.has_requested(uuid),
  private.owns_listing(uuid), private.can_see_exact(uuid), private.review_published(uuid),
  private.is_active_member(uuid)
  to anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
