-- Fixes from the 2026-11-19 logic review.
--   1. One-time rewards (signup bonus, first listing, first completed deal) once per
--      person: e-mail aliases such as name+1@gmail.com or n.a.m.e@gmail.com count as one.
--   2. Accepted deals that nobody confirms: reminder first, then cancel and refund
--      after settings.accept_timeout_days (0 turns it off).
--   3. E-mail notifications: order changes queue mail in public.notifications; the
--      send-notifications Edge Function sends it (see migration 5 and README).
--   4. Disputed deals are refunded when the listing is removed or a party deletes
--      the account, instead of staying frozen.

-- ============================================================ 1. one reward per person

-- Hash of the login identity. Phone as is; e-mail lower-cased, "+tag" dropped, and
-- dots dropped for Gmail, so aliases of one inbox share a hash.
create or replace function private.identity_hash(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text;
  v_email text;
  v_local text;
  v_domain text;
  v_key text;
begin
  select phone, lower(btrim(email)) into v_phone, v_email from auth.users where id = p_user;
  if coalesce(v_phone, '') <> '' then
    v_key := v_phone;
  elsif coalesce(v_email, '') <> '' and position('@' in v_email) > 1 then
    v_local := split_part(split_part(v_email, '@', 1), '+', 1);
    v_domain := split_part(v_email, '@', 2);
    if v_domain in ('gmail.com', 'googlemail.com') then
      v_local := replace(v_local, '.', '');
      v_domain := 'gmail.com';
    end if;
    v_key := v_local || '@' || v_domain;
  else
    v_key := p_user::text;
  end if;
  return encode(sha256(convert_to(v_key, 'UTF8')), 'hex');
end $$;

-- One row per person and one-time reward. Never readable by clients.
create table if not exists public.reward_grants (
  identity_hash text not null,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key (identity_hash, kind)
);
alter table public.reward_grants enable row level security;
revoke all on public.reward_grants from anon, authenticated;

-- People who already got a reward or the signup bonus keep counting as having had it.
insert into public.signup_grants (identity_hash)
  select private.identity_hash(u.id) from auth.users u join public.profiles p on p.id = u.id
  on conflict do nothing;
insert into public.reward_grants (identity_hash, kind)
  select distinct private.identity_hash(e.user_id), e.note
  from public.ledger e join auth.users u on u.id = e.user_id
  where e.type = 'reward'
  on conflict do nothing;

-- Rewards are one-time: each kind (named by its note, e.g. 首次刊登獎勵) is given
-- once per person, and only up to the monthly cap. Returns what was given.
create or replace function private.grant_reward(p_user uuid, p_amount int, p_note text) returns int
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  give int := least(p_amount, s.monthly_reward_cap - private.rewards_this_month(p_user));
begin
  if give <= 0 then
    return 0;
  end if;
  insert into public.reward_grants (identity_hash, kind)
    values (private.identity_hash(p_user), p_note)
    on conflict do nothing;
  if not found then
    return 0;
  end if;
  perform private.add_ledger(p_user, 'reward', give, p_note);
  return give;
end $$;

create or replace function public.complete_signup(p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  v_uid uuid := auth.uid();
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
  insert into public.profiles (id, name, color)
  values (v_uid, n, colors[1 + floor(random() * 5)::int]);

  insert into public.signup_grants (identity_hash) values (private.identity_hash(v_uid))
    on conflict do nothing;
  if found then
    perform private.add_ledger(v_uid, 'signup_bonus', s.signup_bonus, '新手點數');
    v_bonus := s.signup_bonus;
  end if;
  return json_build_object('bonus', v_bonus);
end $$;

-- ============================================================ 2. accepted deals nobody confirms

alter table public.settings add column if not exists accept_timeout_days double precision not null default 7;
alter table public.orders add column if not exists reminded_at timestamptz;

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
    reward_expiry_months = nxt.reward_expiry_months, accept_timeout_days = nxt.accept_timeout_days,
    updated_at = now()
  where id = 1;
  perform private.log_admin(a.id, '更新平台參數');
end $$;

-- Request timeout, auto-complete, unconfirmed deals and food expiry. Run by pg_cron
-- and also called by clients as a fallback; safe to run concurrently.
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
    -- Nobody pressed "完成": cancel and refund once the window is over.
    for r in
      select id from public.orders
      where status = 'accepted' and requester_done_at is null and provider_done_at is null
        and accepted_at < now() - interval '1 day' * s.accept_timeout_days
      for update skip locked
    loop
      perform private.cancel_order(r.id, format('接受後 %s 天都沒有人確認完成，自動取消', s.accept_timeout_days));
      changed := true;
    end loop;

    -- Remind both sides two days before (or halfway, for short windows).
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

  return changed;
end $$;

-- ============================================================ 3. e-mail notifications

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  subject text not null,
  body text not null,
  link text not null default '', -- path on the site, e.g. /orders?tab=provide
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text not null default ''
);
create index if not exists notifications_pending_idx on public.notifications (created_at) where sent_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

-- Queues one e-mail. Only active members get mail.
create or replace function private.notify(p_user uuid, p_subject text, p_body text, p_link text default '')
returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, subject, body, link)
  select p_user, left(p_subject, 200), p_body, coalesce(p_link, '')
  where exists (select 1 from public.profiles where id = p_user and status = 'active')
$$;

-- Mail for every order change. The person who made the change (auth.uid()) is not
-- mailed; time-based changes (pg_cron, no user) mail both sides.
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
    for p in select id from public.profiles where role = 'admin' and status = 'active' loop
      perform private.notify(p, '有新的交易爭議待處理', format('「%s」：%s', t, new.dispute_reason), '/admin');
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists orders_notify on public.orders;
create trigger orders_notify after insert or update on public.orders
  for each row execute function private.on_order_change();

-- Used by the send-notifications Edge Function (direct database connection).
-- Claims up to p_limit mails; a claim older than 10 minutes counts as abandoned.
create or replace function private.claim_notifications(p_limit int default 40)
returns table (id uuid, email text, subject text, body text, link text)
language sql security definer set search_path = public as $$
  with pick as (
    select x.id from public.notifications x
    where x.sent_at is null and x.attempts < 5
      and (x.claimed_at is null or x.claimed_at < now() - interval '10 minutes')
    order by x.created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
    set claimed_at = now(), attempts = n.attempts + 1
  from pick
  where n.id = pick.id
  returning n.id, (select u.email from auth.users u where u.id = n.user_id), n.subject, n.body, n.link
$$;

-- p_done: sent, or nothing to send (no e-mail address). Otherwise retried later.
create or replace function private.finish_notification(p_id uuid, p_done boolean, p_error text default '')
returns void
language sql security definer set search_path = public as $$
  update public.notifications
    set sent_at = case when p_done then now() end,
        claimed_at = case when p_done then claimed_at end,
        last_error = left(coalesce(p_error, ''), 300)
  where id = p_id
$$;

-- ============================================================ 4. disputes are not left frozen

create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  r record;
begin
  for r in
    select id from public.orders
    where (requester_id = u.id or provider_id = u.id) and status in ('requested', 'accepted', 'disputed')
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
    for r in
      select id from public.orders where listing_id = l.id and status in ('requested', 'accepted', 'disputed')
    loop
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
    for r in
      select id from public.orders where listing_id = l.id and status in ('requested', 'accepted', 'disputed')
    loop
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

-- ============================================================ privileges

-- New functions are executable by PUBLIC by default; repeat the lockdown from migration 1.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_admin(), private.is_blocked(uuid, uuid), private.is_party(uuid),
  private.is_party_text(text), private.can_chat_text(text), private.has_requested(uuid),
  private.owns_listing(uuid), private.can_see_exact(uuid), private.review_published(uuid)
  to anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
