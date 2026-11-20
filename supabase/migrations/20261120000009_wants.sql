-- Wanted posts (徵求).
--
--   1. A member posts what they need: category, a short title, an optional note and a
--      rough area. It stays up for 14 days or until they close it. Each member can
--      have 3 open at a time and post at most 5 a day. Banned words are refused.
--   2. Others answer with a listing: a new one ("刊登給他") or one already up. The
--      listing is linked to the want, and the member who asked is mailed once the
--      listing is live. Requesting it then follows the normal listing flow.
--   3. Wants can be reported. Enough reporters hide one until staff look at it; staff
--      can remove any want with a reason, and the member is told why.
--
-- Wants show only a fuzzed point, like listings. Blocked, suspended and deleted
-- members' wants are hidden from others.

-- ============================================================ 1. table

create table if not exists public.wants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  category text not null check (category in ('food', 'clothing')),
  title text not null check (char_length(title) between 2 and 30),
  description text not null default '' check (char_length(description) <= 200),
  lat double precision not null, -- public, fuzzed 60–180 m
  lng double precision not null,
  area_label text not null check (char_length(area_label) between 1 and 40),
  -- hidden: enough reports, waiting for staff. Past expires_at counts as ended.
  status text not null default 'open' check (status in ('open', 'closed', 'hidden', 'removed')),
  expires_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists wants_user_idx on public.wants (user_id);
create index if not exists wants_status_idx on public.wants (status, expires_at);
alter table public.wants enable row level security;

drop policy if exists wants_read on public.wants;
create policy wants_read on public.wants for select using (
  (status = 'open' and expires_at > now() and not private.is_blocked(auth.uid(), user_id)
    and private.is_active_member(user_id))
  or user_id = auth.uid()
  or private.is_staff()
);

-- The listing that answers a want, and whether its asker was mailed about it.
alter table public.listings add column if not exists want_id uuid references public.wants (id);
alter table public.listings add column if not exists want_notified boolean not null default false;
create index if not exists listings_want_idx on public.listings (want_id);

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('listing', 'user', 'want'));

-- ============================================================ 2. post, close, answer

create or replace function public.create_want(
  p_category text, p_title text, p_description text,
  p_lat double precision, p_lng double precision, p_area text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_area text := btrim(coalesce(p_area, ''));
  v_bad text[];
  v_angle double precision := random() * 2 * pi();
  v_dist double precision := 60 + random() * 120;
  v_id uuid;
begin
  if p_category is null or p_category not in ('food', 'clothing') then raise exception '請選擇分類'; end if;
  if char_length(v_title) < 2 then raise exception '想要的東西至少寫 2 個字'; end if;
  if char_length(v_title) > 30 then raise exception '想要的東西最多 30 個字'; end if;
  if char_length(v_desc) > 200 then raise exception '說明最多 200 個字'; end if;
  if v_area = '' then raise exception '請填寫大概的地點，例如「捷運大安站附近」'; end if;
  if char_length(v_area) > 40 then raise exception '地點名稱最多 40 個字'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception '請在地圖上選擇大概的位置';
  end if;
  select coalesce(array_agg(w), '{}') into v_bad
    from unnest(private.banned_words()) w
    where position(w in v_title || ' ' || v_desc) > 0;
  if cardinality(v_bad) > 0 then
    raise exception '徵求內容包含「%」，這類物品不能在 Myrs 交換', array_to_string(v_bad, '、');
  end if;

  perform 1 from public.profiles where id = u.id for update;
  if (
    select count(*) from public.wants
    where user_id = u.id and status in ('open', 'hidden') and expires_at > now()
  ) >= 3 then
    raise exception '同時最多 3 則徵求，請先結束已經找到或不需要的';
  end if;
  if (select count(*) from public.wants where user_id = u.id and created_at > now() - interval '1 day') >= 5 then
    raise exception '每天最多發 5 則徵求，明天再試';
  end if;

  insert into public.wants (user_id, category, title, description, lat, lng, area_label, expires_at)
  values (
    u.id, p_category, v_title, v_desc,
    p_lat + v_dist * cos(v_angle) / 111320,
    p_lng + v_dist * sin(v_angle) / (111320 * cos(radians(p_lat))),
    v_area, now() + interval '14 days'
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function public.close_want(p_want uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  w public.wants;
begin
  select * into w from public.wants where id = p_want and user_id = u.id for update;
  if not found then raise exception '找不到這則徵求'; end if;
  if w.status not in ('open', 'hidden') or w.expires_at <= now() then
    raise exception '這則徵求已經結束了';
  end if;
  update public.wants set status = 'closed', closed_at = now() where id = w.id;
end $$;

-- Links one of the caller's listings to a want. The mail goes out from the trigger
-- below, once the listing is live (a flagged listing waits for review first).
create or replace function public.respond_want(p_want uuid, p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  w public.wants;
  l public.listings;
begin
  select * into w from public.wants where id = p_want for update;
  if not found or w.status <> 'open' or w.expires_at <= now() or not private.is_active_member(w.user_id) then
    raise exception '這則徵求已經結束了';
  end if;
  if w.user_id = u.id then raise exception '不能回應自己的徵求'; end if;
  if private.is_blocked(u.id, w.user_id) then raise exception '你們之間有封鎖，無法回應'; end if;
  select * into l from public.listings where id = p_listing and owner_id = u.id for update;
  if not found then raise exception '找不到這則刊登'; end if;
  if l.status not in ('active', 'pending_review') then raise exception '只有上架中的刊登可以回應徵求'; end if;
  if l.want_id = w.id then raise exception '這則刊登已經回應過這則徵求了'; end if;
  if l.want_id is not null then raise exception '一則刊登只能回應一則徵求'; end if;
  if (select count(*) from public.listings where want_id = w.id and owner_id = u.id) >= 3 then
    raise exception '同一則徵求最多回應 3 次';
  end if;
  update public.listings set want_id = w.id where id = l.id;
end $$;

create or replace function private.on_listing_want() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  w public.wants;
  v_price text := case new.mode
    when 'free' then '免費' when 'points' then format('%s 點', new.price_points) else '以物易物' end;
begin
  if new.want_id is null or new.status <> 'active' or new.want_notified then
    return new;
  end if;
  select * into w from public.wants where id = new.want_id;
  if not found or w.status <> 'open' or w.expires_at <= now() then
    return new;
  end if;
  new.want_notified := true;
  perform private.notify(w.user_id, format('有人回應你的徵求「%s」', w.title),
    format(E'%s 刊登了「%s」（%s，%s）回應你的徵求。\n\n想要的話，到刊登頁按「索取」。已經找到了，記得到徵求頁按「已經找到了」。',
      (select name from public.profiles where id = new.owner_id), new.title, v_price, new.area_label),
    '/listings/view?id=' || new.id);
  return new;
end $$;

drop trigger if exists listings_want on public.listings;
create trigger listings_want before update of status, want_id on public.listings
  for each row execute function private.on_listing_want();

-- ============================================================ 3. reports and staff

create or replace function public.admin_remove_want(p_want uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('moderator');
  w public.wants;
  v_why text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), '不符合使用規則');
begin
  if char_length(v_why) > 200 then raise exception '移除原因最多 200 個字'; end if;
  select * into w from public.wants where id = p_want for update;
  if not found then raise exception '找不到這則徵求'; end if;
  if w.user_id = a.id then raise exception '這是你自己的徵求，請直接按「結束徵求」'; end if;
  if w.status = 'removed' then raise exception '這則徵求已經移除了'; end if;
  update public.wants set status = 'removed', closed_at = coalesce(closed_at, now()) where id = w.id;
  update public.reports set status = 'resolved', handled_by = a.id where target_id = w.id and status = 'open';
  perform private.notify(w.user_id, format('你的徵求「%s」已被移除', w.title),
    format(E'原因：%s\n\n如果有疑問，請聯絡 Myrs 客服。', v_why),
    '/wants/view?id=' || w.id);
  perform private.log_admin(a.id, format('移除徵求「%s」（%s）', w.title, v_why));
end $$;

-- Same as migration 1, plus wants.
create or replace function public.report(p_target_type text, p_target_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  s public.settings := private.settings();
  v_reason text := btrim(coalesce(p_reason, ''));
  l public.listings;
  w public.wants;
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
  elsif p_target_type = 'want' then
    select * into w from public.wants where id = p_target_id for update;
    if not found then raise exception '找不到檢舉對象'; end if;
    if w.user_id = u.id then raise exception '不能檢舉自己的徵求'; end if;
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

  if (p_target_type = 'listing' and l.status = 'active') or (p_target_type = 'want' and w.status = 'open') then
    select count(distinct reporter_id) into reporters from public.reports
      where target_id = p_target_id and status = 'open' and reporter_id is not null;
    if reporters >= s.report_hide_threshold then
      if p_target_type = 'listing' then
        update public.listings set status = 'pending_review' where id = l.id;
      else
        update public.wants set status = 'hidden' where id = w.id;
      end if;
      return true;
    end if;
  end if;
  return false;
end $$;

-- Same as migration 7, plus wants.
create or replace function public.admin_handle_report(p_report uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('moderator');
  rp public.reports;
  l public.listings;
  w public.wants;
  t public.profiles;
  r record;
  v_target_user uuid;
begin
  select * into rp from public.reports where id = p_report for update;
  if not found or rp.status <> 'open' then raise exception '這筆檢舉已處理過'; end if;
  v_target_user := case rp.target_type
    when 'user' then rp.target_id
    when 'want' then (select user_id from public.wants where id = rp.target_id)
    else (select owner_id from public.listings where id = rp.target_id) end;
  if v_target_user = a.id then raise exception '不能處理針對自己的檢舉，請由其他管理團隊成員處理'; end if;

  if p_action = 'dismiss' then
    update public.reports set status = 'dismissed', handled_by = a.id where target_id = rp.target_id and status = 'open';
    if rp.target_type = 'listing' then
      update public.listings set status = 'active'
        where id = rp.target_id and status = 'pending_review' and cardinality(flagged_words) = 0;
    elsif rp.target_type = 'want' then
      update public.wants set status = 'open' where id = rp.target_id and status = 'hidden';
    end if;
    perform private.log_admin(a.id, '駁回檢舉：' || rp.reason);
    return;
  end if;

  if p_action = 'remove_listing' then
    if rp.target_type <> 'listing' then raise exception '檢舉對象不是刊登'; end if;
    select * into l from public.listings where id = rp.target_id for update;
    if not found then raise exception '檢舉對象不是刊登'; end if;
    for r in
      select id from public.orders where listing_id = l.id and status in ('requested', 'accepted', 'disputed')
    loop
      perform private.cancel_order(r.id, '刊登已被管理員下架');
    end loop;
    update public.listings set status = 'removed' where id = l.id;
    update public.reports set status = 'resolved', handled_by = a.id where target_id = rp.target_id and status = 'open';
    -- The reporter's own words stay private: they might identify who reported.
    perform private.notify(l.owner_id, format('你的刊登「%s」已被下架', l.title),
      E'原因：有會員檢舉，經管理團隊確認不符合刊登規則。\n\n如果有疑問，請聯絡 Myrs 客服。',
      '/listings/view?id=' || l.id);
    perform private.log_admin(a.id, format('依檢舉下架刊登「%s」', l.title));
    return;
  end if;

  if p_action = 'remove_want' then
    if rp.target_type <> 'want' then raise exception '檢舉對象不是徵求'; end if;
    select * into w from public.wants where id = rp.target_id for update;
    if not found then raise exception '檢舉對象不是徵求'; end if;
    update public.wants set status = 'removed', closed_at = coalesce(closed_at, now()) where id = w.id;
    update public.reports set status = 'resolved', handled_by = a.id where target_id = rp.target_id and status = 'open';
    perform private.notify(w.user_id, format('你的徵求「%s」已被移除', w.title),
      E'原因：有會員檢舉，經管理團隊確認不符合使用規則。\n\n如果有疑問，請聯絡 Myrs 客服。',
      '/wants/view?id=' || w.id);
    perform private.log_admin(a.id, format('依檢舉移除徵求「%s」', w.title));
    return;
  end if;

  if p_action = 'suspend_user' then
    if private.level_rank(a.admin_level) < 2 then
      raise exception '停權需要「管理員」以上的權限';
    end if;
    select * into t from public.profiles where id = v_target_user for update;
    if not found or t.status <> 'active' then raise exception '無法停權這個帳號'; end if;
    if t.role = 'admin' then raise exception '不能停權管理團隊成員，請先由擁有者撤銷權限'; end if;
    perform private.suspend_member(a.id, t.id, '經檢舉確認違反使用規則', null);
    update public.reports set status = 'resolved', handled_by = a.id where target_id = rp.target_id and status = 'open';
    perform private.log_admin(a.id, format('依檢舉停權「%s」', t.name));
    return;
  end if;

  raise exception '處理方式不正確';
end $$;

-- ============================================================ realtime

alter publication supabase_realtime add table public.wants;

-- ============================================================ privileges

-- Everyone reads open wants through RLS; writes go through the functions above.
revoke all on public.wants from anon, authenticated;
grant select on public.wants to anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_admin(), private.is_blocked(uuid, uuid), private.is_party(uuid), private.is_party_text(text),
  private.can_chat_text(text), private.has_requested(uuid),
  private.owns_listing(uuid), private.can_see_exact(uuid), private.review_published(uuid),
  private.is_active_member(uuid), private.is_staff()
  to anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
