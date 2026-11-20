-- Admin levels, suspension reasons and periods, and removing any listing.
--
-- Levels (profiles.admin_level; only staff, i.e. role = 'admin', have one):
--   owner      everything, including appointing staff, settings and point adjustments
--   admin      listing review, reports, dispute rulings, suspending members, merchants
--   moderator  listing review and reports (dismiss them or remove the listing) only
-- Moderators do not get the private reads (chats, point ledgers, exact meeting spots):
-- private.is_admin() now means admin or owner, and private.is_staff() means any level.
-- Every write checks the level in the database, so hiding buttons is not the only guard.
--
-- Suspensions now carry a reason and an optional end date (public.suspensions). The
-- member is told by e-mail, sees the reason when signing in, and is restored by
-- run_maintenance when the period ends.

-- ============================================================ levels

alter table public.profiles add column if not exists admin_level text
  check (admin_level is null or admin_level in ('owner', 'admin', 'moderator'));
-- Everyone who was an admin before levels existed is an owner.
update public.profiles set admin_level = 'owner' where role = 'admin' and admin_level is null;

create or replace function private.level_rank(p_level text) returns int
language sql immutable as $$
  select case p_level when 'owner' then 3 when 'admin' then 2 when 'moderator' then 1 else 0 end
$$;

create or replace function private.level_label(p_level text) returns text
language sql immutable as $$
  select case p_level when 'owner' then '擁有者' when 'admin' then '管理員' when 'moderator' then '審核員'
    else '一般會員' end
$$;

-- Keeps role and admin_level in step, and never lets the last owner go.
create or replace function private.on_profile_level() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.role = 'admin' and old.admin_level = 'owner' and old.status = 'active'
    and (new.status <> 'active' or new.role <> 'admin' or new.admin_level is distinct from 'owner')
    and not exists (
      select 1 from public.profiles
      where id <> old.id and role = 'admin' and admin_level = 'owner' and status = 'active'
    )
  then
    raise exception '至少要留一位擁有者，請先指派另一位擁有者';
  end if;
  if new.status = 'deleted' then
    new.role := 'member';
  end if;
  -- A bare role = 'admin' (the first admin, set in the SQL editor) means owner.
  if new.role = 'admin' and new.admin_level is null then
    new.admin_level := 'owner';
  elsif new.role <> 'admin' then
    new.admin_level := null;
  end if;
  return new;
end $$;

drop trigger if exists profiles_level on public.profiles;
create trigger profiles_level before insert or update of role, admin_level, status on public.profiles
  for each row execute function private.on_profile_level();

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and admin_level in ('owner', 'admin') and status = 'active'
  )
$$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active')
$$;

create or replace function private.require_level(p_min text) returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  u public.profiles := private.me();
begin
  if u.role <> 'admin' or private.level_rank(u.admin_level) < private.level_rank(p_min) then
    if p_min = 'owner' then
      raise exception '這個操作只有「擁有者」可以執行';
    end if;
    raise exception '這個操作需要「%」以上的權限', private.level_label(p_min);
  end if;
  return u;
end $$;

-- Functions not rewritten below (dispute rulings, merchants) now need 管理員 or 擁有者.
create or replace function private.require_admin() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
begin
  return private.require_level('admin');
end $$;

-- Moderators review pending listings and reports, so they read those rows too.
drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select using (
  (status in ('active', 'reserved') and not private.is_blocked(auth.uid(), owner_id)
    and private.is_active_member(owner_id))
  or owner_id = auth.uid()
  or private.is_staff()
  or private.has_requested(id)
);
drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select using (reporter_id = auth.uid() or private.is_staff());

create or replace function public.admin_set_role(p_user uuid, p_level text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('owner');
  t public.profiles;
  v_old text;
begin
  if p_level is null or p_level not in ('member', 'moderator', 'admin', 'owner') then
    raise exception '權限層級不正確';
  end if;
  select * into t from public.profiles where id = p_user for update;
  if not found or t.status = 'deleted' then raise exception '找不到這個使用者'; end if;
  if t.status <> 'active' then raise exception '停權中的帳號不能加入管理團隊，請先恢復'; end if;
  v_old := coalesce(t.admin_level, 'member');
  if v_old = p_level then raise exception '對方已經是「%」了', private.level_label(p_level); end if;
  if v_old = 'owner' and t.id <> a.id then raise exception '不能更改其他擁有者的權限'; end if;
  update public.profiles
    set role = case when p_level = 'member' then 'member' else 'admin' end,
        admin_level = nullif(p_level, 'member')
    where id = t.id;
  perform private.log_admin(a.id, format('把「%s」從%s改為%s', t.name,
    private.level_label(v_old), private.level_label(p_level)));
  if t.id <> a.id then
    perform private.notify(t.id, 'Myrs 管理權限已更新',
      case p_level
        when 'member' then '你已經不在 Myrs 管理團隊裡了，謝謝你的協助！'
        when 'moderator' then '你現在是 Myrs 的「審核員」，可以審核刊登和處理檢舉。從網站右上角的「後台」進入。'
        when 'admin' then '你現在是 Myrs 的「管理員」，可以審核刊登、處理檢舉與爭議、停權會員和設定商家。從網站右上角的「後台」進入。'
        else '你現在是 Myrs 的「擁有者」，可以使用所有後台功能，包括指派管理團隊、修改平台參數和調整點數。'
      end,
      case when p_level = 'member' then '/' else '/admin' end);
  end if;
end $$;

-- ============================================================ suspensions

create table if not exists public.suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  reason text not null,
  until timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  -- null with lifted_at set: the period ended on its own.
  lifted_by uuid references public.profiles (id)
);
create index if not exists suspensions_user_idx on public.suspensions (user_id);
alter table public.suspensions enable row level security;
drop policy if exists suspensions_read on public.suspensions;
create policy suspensions_read on public.suspensions for select using (user_id = auth.uid() or private.is_admin());

create or replace function private.suspension_note(p_reason text, p_until timestamptz) returns text
language sql stable as $$
  select '這個帳號已被停權'
    || case when coalesce(p_reason, '') <> '' then '，原因：' || p_reason else '' end
    || case when p_until is not null
         then '。將在 ' || to_char(p_until at time zone 'Asia/Taipei', 'YYYY/MM/DD HH24:MI') || ' 自動恢復。'
         else '。如需協助，請聯絡 Myrs 客服。' end
$$;

create or replace function private.me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  u public.profiles;
  s public.suspensions;
begin
  if auth.uid() is null then
    raise exception '請先登入';
  end if;
  select * into u from public.profiles where id = auth.uid();
  if not found or u.status = 'deleted' then
    raise exception '請先登入';
  end if;
  if u.status = 'suspended' then
    select * into s from public.suspensions
      where user_id = u.id and lifted_at is null order by created_at desc limit 1;
    raise exception '%', private.suspension_note(s.reason, s.until);
  end if;
  return u;
end $$;

-- Mails the member first: private.notify only writes to active accounts.
create or replace function private.suspend_member(p_admin uuid, p_user uuid, p_reason text, p_days int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_until timestamptz := case when p_days is null then null else now() + make_interval(days => p_days) end;
begin
  perform private.notify(p_user, 'Myrs 帳號已被停權',
    private.suspension_note(p_reason, v_until)
      || E'\n\n停權期間不能使用 Myrs，還沒回覆的索取會自動取消。', '/');
  insert into public.suspensions (user_id, reason, until, created_by) values (p_user, p_reason, v_until, p_admin);
  update public.profiles set status = 'suspended' where id = p_user;
end $$;

create or replace function private.lift_suspension(p_user uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.suspensions set lifted_at = now(), lifted_by = p_by where user_id = p_user and lifted_at is null;
  update public.profiles set status = 'active' where id = p_user and status = 'suspended';
  perform private.notify(p_user, 'Myrs 帳號已恢復',
    case when p_by is null then '停權期間已結束，你的 Myrs 帳號恢復正常，可以繼續使用了。'
      else '管理團隊已恢復你的 Myrs 帳號，可以繼續使用了。' end, '/');
end $$;

drop function if exists public.admin_set_user_status(uuid, text);
create or replace function public.admin_set_user_status(
  p_user uuid, p_status text, p_reason text default '', p_days int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('admin');
  t public.profiles;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_status not in ('active', 'suspended') then raise exception '狀態不正確'; end if;
  select * into t from public.profiles where id = p_user for update;
  if not found or t.status = 'deleted' then raise exception '找不到這個使用者'; end if;
  if t.role = 'admin' then raise exception '不能停權管理團隊成員，請先由擁有者撤銷權限'; end if;
  if p_status = 'suspended' then
    if t.status = 'suspended' then raise exception '這個帳號已經停權了'; end if;
    if v_reason = '' then raise exception '請填寫停權原因'; end if;
    if char_length(v_reason) > 200 then raise exception '停權原因最多 200 個字'; end if;
    if p_days is not null and (p_days < 1 or p_days > 365) then
      raise exception '停權天數要在 1 到 365 天之間';
    end if;
    perform private.suspend_member(a.id, t.id, v_reason, p_days);
    perform private.log_admin(a.id, format('停權使用者「%s」（%s，%s）', t.name,
      case when p_days is null then '無期限' else p_days || ' 天' end, v_reason));
  else
    if t.status <> 'suspended' then raise exception '這個帳號沒有被停權'; end if;
    perform private.lift_suspension(t.id, a.id);
    perform private.log_admin(a.id, format('恢復使用者「%s」', t.name));
  end if;
end $$;

-- ============================================================ removing listings

drop function if exists public.admin_set_listing_status(uuid, text);
create or replace function public.admin_set_listing_status(p_listing uuid, p_status text, p_reason text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('moderator');
  l public.listings;
  r record;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_status not in ('active', 'removed') then raise exception '狀態不正確'; end if;
  if char_length(v_reason) > 200 then raise exception '下架原因最多 200 個字'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found then raise exception '找不到這則刊登'; end if;
  if p_status = 'active' then
    -- Staff may not clear their own listing: someone else has to look at it.
    if l.owner_id = a.id then raise exception '不能審核自己的刊登，請由其他管理團隊成員處理'; end if;
    if l.status <> 'pending_review' then raise exception '只有待審核的刊登可以核准'; end if;
    if l.expires_on is not null and l.expires_on < private.today() then
      raise exception '這項食品已經過期，不能核准';
    end if;
    update public.listings
      set status = case when remaining > 0 then 'active' else 'reserved' end, flagged_words = '{}'
      where id = l.id;
    update public.reports set status = 'dismissed', handled_by = a.id
      where target_id = l.id and status = 'open';
    perform private.log_admin(a.id, format('核准刊登「%s」', l.title));
    return;
  end if;
  if l.status = 'removed' then raise exception '這則刊登已經下架了'; end if;
  if v_reason = '' then v_reason := '不符合刊登規則'; end if;
  for r in
    select id from public.orders where listing_id = l.id and status in ('requested', 'accepted', 'disputed')
  loop
    perform private.cancel_order(r.id, '刊登已被管理員下架：' || v_reason);
  end loop;
  update public.listings set status = 'removed' where id = l.id;
  update public.reports set status = 'resolved', handled_by = a.id where target_id = l.id and status = 'open';
  perform private.notify(l.owner_id, format('你的刊登「%s」已被下架', l.title),
    format(E'原因：%s\n\n如果有疑問，請聯絡 Myrs 客服。', v_reason), '/listings/view?id=' || l.id);
  perform private.log_admin(a.id, format('下架刊登「%s」（%s）', l.title, v_reason));
end $$;

create or replace function public.admin_handle_report(p_report uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('moderator');
  rp public.reports;
  l public.listings;
  t public.profiles;
  r record;
  v_target_user uuid;
begin
  select * into rp from public.reports where id = p_report for update;
  if not found or rp.status <> 'open' then raise exception '這筆檢舉已處理過'; end if;
  v_target_user := case when rp.target_type = 'user' then rp.target_id
    else (select owner_id from public.listings where id = rp.target_id) end;
  if v_target_user = a.id then raise exception '不能處理針對自己的檢舉，請由其他管理團隊成員處理'; end if;

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

-- ============================================================ owner only

create or replace function public.admin_adjust_points(p_user uuid, p_amount int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('owner');
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

create or replace function public.admin_update_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('owner');
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

-- ============================================================ maintenance

-- Same as migration 4, plus lifting suspensions whose period is over.
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

  if s.accept_timeout_days > 0 then
    for r in
      select id from public.orders
      where status = 'accepted' and requester_done_at is null and provider_done_at is null
        and accepted_at < now() - interval '1 day' * s.accept_timeout_days
      for update skip locked
    loop
      perform private.cancel_order(r.id, format('接受後 %s 天都沒有人確認完成，自動取消', s.accept_timeout_days));
      changed := true;
    end loop;

    for r in
      select id, accepted_at from public.orders
      where status = 'accepted' and requester_done_at is null and provider_done_at is null
        and reminded_at is null
        and accepted_at < now() - interval '1 day' * greatest(s.accept_timeout_days - 2, s.accept_timeout_days / 2)
      for update skip locked
    loop
      update public.orders set reminded_at = now() where id = r.id;
      perform private.sys_msg(r.id, format(
        '提醒：這筆交易還沒有人按「完成」。已經面交的話請記得按；%s 前仍沒有人確認，系統會自動取消並退回凍結的點數。',
        to_char((r.accepted_at + interval '1 day' * s.accept_timeout_days) at time zone 'Asia/Taipei', 'MM/DD HH24:MI')));
      changed := true;
    end loop;
  end if;

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

  for r in
    select s2.user_id from public.suspensions s2
    join public.profiles p on p.id = s2.user_id and p.status = 'suspended'
    where s2.lifted_at is null and s2.until is not null and s2.until <= now()
    for update of s2 skip locked
  loop
    perform private.lift_suspension(r.user_id, null);
    changed := true;
  end loop;

  return changed;
end $$;

-- ============================================================ dispute mail

-- Same as migration 4, except the dispute notice goes to admins and owners only.
create or replace function private.on_order_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  actor uuid := auth.uid();
  t text;
  req text;
  prov text;
  chat text := '/messages/view?id=' || new.id;
  p uuid;
begin
  select title into t from public.listings where id = new.listing_id;
  t := coalesce(t, '刊登');
  select name into req from public.profiles where id = new.requester_id;
  select name into prov from public.profiles where id = new.provider_id;

  if tg_op = 'INSERT' then
    perform private.notify(new.provider_id,
      format('%s 想索取你的「%s」', req, t),
      format(E'%s 送出了索取%s。%s\n\n請在 %s 小時內到 Myrs 接受或婉拒，逾時會自動取消。',
        req,
        case new.mode when 'points' then format('，會付 %s 點', new.points)
          when 'swap' then format('，想用「%s」交換', new.swap_offer) else '' end,
        case when new.note <> '' then format(E'\n留言：%s', new.note) else '' end,
        s.request_timeout_hours),
      '/orders?tab=provide');
    return new;
  end if;

  if new.status = 'accepted' and old.status = 'requested' then
    perform private.notify(new.requester_id,
      format('%s 接受了你的索取：「%s」', prov, t),
      '現在可以到聊天室約面交時間，精確地點也已經顯示。面交後，雙方都要到 Myrs 按「完成」。',
      chat);

  elsif new.status = 'accepted' and old.requester_done_at is null and new.requester_done_at is not null
      and new.provider_done_at is null then
    perform private.notify(new.provider_id,
      format('%s 已確認「%s」交易完成', req, t),
      format(E'已經交付的話，請到 Myrs 按「完成」。\n如果有問題，請在 %s 小時內到聊天室按「提出爭議」；沒有回應的話，交易會自動完成。',
        s.auto_complete_hours),
      chat);

  elsif new.status = 'accepted' and old.provider_done_at is null and new.provider_done_at is not null
      and new.requester_done_at is null then
    perform private.notify(new.requester_id,
      format('%s 已確認「%s」交易完成', prov, t),
      format(E'已經拿到東西的話，請到 Myrs 按「完成」。\n如果還沒拿到或有問題，請在 %s 小時內到聊天室按「提出爭議」；沒有回應的話，交易會自動完成%s。',
        s.auto_complete_hours,
        case when new.mode = 'points' then format('，凍結的 %s 點會轉給對方', new.points) else '' end),
      chat);

  elsif new.status = 'accepted' and old.reminded_at is null and new.reminded_at is not null then
    foreach p in array array[new.requester_id, new.provider_id] loop
      perform private.notify(p,
        format('「%s」的交易還沒有人按完成', t),
        format('已經面交的話，請到 Myrs 按「完成」。%s 前仍沒有人確認，系統會自動取消%s。',
          to_char((new.accepted_at + interval '1 day' * s.accept_timeout_days) at time zone 'Asia/Taipei', 'MM/DD HH24:MI'),
          case when new.mode = 'points' then '並把點數退給索取者' else '' end),
        chat);
    end loop;

  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    foreach p in array array[new.requester_id, new.provider_id] loop
      continue when p = actor;
      perform private.notify(p,
        format('「%s」的交易已取消', t),
        format('原因：%s%s', new.cancel_reason,
          case when p = new.requester_id and new.mode = 'points' and new.points > 0
            then format(E'\n凍結的 %s 點已退回你的錢包。', new.points) else '' end),
        '/orders');
    end loop;

  elsif new.status = 'completed' and old.status <> 'completed' then
    foreach p in array array[new.requester_id, new.provider_id] loop
      continue when p = actor;
      perform private.notify(p,
        format('「%s」交易完成', t),
        format(E'%s歡迎在 %s 天內到 Myrs 給對方評價。',
          case when new.mode = 'points' and p = new.requester_id then format(E'%s 點已轉給對方。\n', new.points)
            when new.mode = 'points' then format(E'你收到 %s 點（扣除手續費 %s 點）。\n', new.points - new.fee, new.fee)
            else '' end,
          s.review_window_days),
        chat);
    end loop;

  elsif new.status = 'disputed' and old.status <> 'disputed' then
    foreach p in array array[new.requester_id, new.provider_id] loop
      continue when p = actor;
      perform private.notify(p,
        format('「%s」的交易有人提出爭議', t),
        format(E'爭議說明：%s\n管理員會介入處理，點數暫時維持凍結。', new.dispute_reason),
        chat);
    end loop;
    -- Disputes are for admins and owners; moderators do not handle them.
    for p in select id from public.profiles
      where role = 'admin' and admin_level in ('owner', 'admin') and status = 'active'
    loop
      perform private.notify(p, '有新的交易爭議待處理', format('「%s」：%s', t, new.dispute_reason), '/admin');
    end loop;
  end if;
  return new;
end $$;

-- ============================================================ realtime

alter publication supabase_realtime add table public.suspensions;

-- ============================================================ privileges

revoke all on public.suspensions from anon, authenticated;
grant select on public.suspensions to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_admin(), private.is_blocked(uuid, uuid), private.is_party(uuid),
  private.is_party_text(text), private.can_chat_text(text), private.has_requested(uuid),
  private.owns_listing(uuid), private.can_see_exact(uuid), private.review_published(uuid),
  private.is_active_member(uuid), private.is_staff()
  to anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
