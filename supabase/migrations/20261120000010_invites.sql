-- Inviting neighbours (邀請鄰居).
--
--   1. Every member has a 6-character invite code. Links shared from Myrs carry it,
--      so someone who signs up from a shared listing or want is invited by the sharer.
--   2. A new member can use one code within 7 days of joining, before their first
--      completed deal. Two members cannot invite each other.
--   3. When the invited member completes a deal with someone other than the inviter,
--      both get settings.invite_reward points (0 turns it off). The points are normal
--      rewards: they count toward the monthly cap and expire like other rewards.
--   4. One person (phone or e-mail, aliases included) gets the invited reward once,
--      even after deleting the account and joining again.
--
-- Codes are readable only by their owner; invites only by the two members and admins.

-- ============================================================ settings

alter table public.settings add column if not exists invite_reward int not null default 20;

-- ============================================================ tables

create table if not exists public.invite_codes (
  user_id uuid primary key references public.profiles (id),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$')
);
alter table public.invite_codes enable row level security;
drop policy if exists invite_codes_read on public.invite_codes;
create policy invite_codes_read on public.invite_codes for select using (user_id = auth.uid());

create table if not exists public.invites (
  invitee_id uuid primary key references public.profiles (id),
  inviter_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  invitee_points int not null default 0,
  inviter_points int not null default 0
);
create index if not exists invites_inviter_idx on public.invites (inviter_id);
alter table public.invites enable row level security;
drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites for select using (
  inviter_id = auth.uid() or invitee_id = auth.uid() or private.is_admin()
);

-- ============================================================ codes

-- No 0/O or 1/I, so a code read aloud or copied by hand still works.
create or replace function private.new_invite_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(chars, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.invite_codes where code = c);
  end loop;
  return c;
end $$;

create or replace function private.on_profile_invite_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.invite_codes (user_id, code) values (new.id, private.new_invite_code())
    on conflict do nothing;
  return new;
end $$;

drop trigger if exists profiles_invite_code on public.profiles;
create trigger profiles_invite_code after insert on public.profiles
  for each row execute function private.on_profile_invite_code();

-- Members who joined before this migration.
do $$
declare
  r record;
begin
  for r in select id from public.profiles p
    where p.status <> 'deleted' and not exists (select 1 from public.invite_codes c where c.user_id = p.id)
  loop
    insert into public.invite_codes (user_id, code) values (r.id, private.new_invite_code());
  end loop;
end $$;

-- ============================================================ using a code

create or replace function public.redeem_invite(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  v_code text := upper(replace(btrim(coalesce(p_code, '')), ' ', ''));
  inviter public.profiles;
begin
  if v_code = '' then
    raise exception '請輸入邀請碼';
  end if;
  select p.* into inviter from public.invite_codes c join public.profiles p on p.id = c.user_id
    where c.code = v_code;
  if not found then
    raise exception '找不到這個邀請碼，請確認有沒有打錯';
  end if;
  if inviter.id = u.id then
    raise exception '不能填自己的邀請碼';
  end if;
  perform 1 from public.profiles where id = u.id for update;
  if exists (select 1 from public.invites where invitee_id = u.id) then
    raise exception '你已經填過邀請碼了';
  end if;
  if u.created_at < now() - interval '7 days' then
    raise exception '加入 7 天內才能填邀請碼';
  end if;
  if exists (
    select 1 from public.orders where status = 'completed' and (requester_id = u.id or provider_id = u.id)
  ) then
    raise exception '完成第一筆交易前才能填邀請碼';
  end if;
  if exists (select 1 from public.invites where invitee_id = inviter.id and inviter_id = u.id) then
    raise exception '你們不能互相邀請';
  end if;
  if inviter.status <> 'active' or private.is_blocked(u.id, inviter.id) then
    raise exception '這個邀請碼目前不能使用';
  end if;
  insert into public.invites (invitee_id, inviter_id) values (u.id, inviter.id);
  return inviter.name;
end $$;

-- ============================================================ rewards

-- A reward up to the monthly cap, without the once-per-kind rule of grant_reward
-- (an inviter can be rewarded for several neighbours).
create or replace function private.give_reward(p_user uuid, p_amount int, p_note text) returns int
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  give int := least(p_amount, s.monthly_reward_cap - private.rewards_this_month(p_user));
begin
  if give <= 0 then
    return 0;
  end if;
  perform private.add_ledger(p_user, 'reward', give, p_note);
  return give;
end $$;

-- p_user just completed a deal with p_other.
create or replace function private.settle_invite(p_user uuid, p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := private.settings();
  i public.invites;
  invitee public.profiles;
  inviter public.profiles;
  v_me int := 0;
  v_them int := 0;
begin
  select * into i from public.invites where invitee_id = p_user and rewarded_at is null for update;
  if not found or i.inviter_id = p_other then
    return;
  end if;
  select * into invitee from public.profiles where id = p_user;
  select * into inviter from public.profiles where id = i.inviter_id;
  if s.invite_reward > 0 then
    insert into public.reward_grants (identity_hash, kind)
      values (private.identity_hash(p_user), '受邀加入獎勵')
      on conflict do nothing;
    if found then
      v_me := private.give_reward(p_user, s.invite_reward, format('受 %s 邀請加入的獎勵', inviter.name));
      if inviter.status = 'active' then
        v_them := private.give_reward(inviter.id, s.invite_reward, format('邀請 %s 加入的獎勵', invitee.name));
      end if;
    end if;
  end if;
  update public.invites set rewarded_at = now(), invitee_points = v_me, inviter_points = v_them
    where invitee_id = p_user;
  if v_them > 0 then
    perform private.notify(
      inviter.id,
      format('你邀請的 %s 完成了第一筆交易', invitee.name),
      format('謝謝你邀請鄰居加入 Myrs！你得到 %s 點邀請獎勵，可以在「我的點數」查看。', v_them),
      '/me/wallet'
    );
  end if;
end $$;

create or replace function private.on_order_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform private.settle_invite(new.requester_id, new.provider_id);
    perform private.settle_invite(new.provider_id, new.requester_id);
  end if;
  return new;
end $$;

drop trigger if exists orders_invite on public.orders;
create trigger orders_invite after update of status on public.orders
  for each row execute function private.on_order_invite();

-- ============================================================ settings

-- Same as migration 8, plus invite_reward.
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
    'invite_reward', 'monthly_reward_cap', 'free_daily_limit', 'new_account_days', 'new_account_points_cap',
    'report_hide_threshold', 'reward_expiry_months'];
  num_cols text[] := array['fee_rate', 'request_timeout_hours', 'auto_complete_hours', 'review_window_days',
    'accept_timeout_days'];
  at_least_one text[] := array['request_timeout_hours', 'auto_complete_hours', 'review_window_days',
    'report_hide_threshold'];
  clean jsonb := '{}';
  r record;
  o numeric;
  nw numeric;
  v_changes text[] := '{}';
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

  for r in select * from (values
      (1, 'fee_rate', '手續費比例', '%'),
      (2, 'min_fee', '最低手續費', ' 點'),
      (3, 'signup_bonus', '新手點數', ' 點'),
      (4, 'first_listing_reward', '首次刊登獎勵', ' 點'),
      (5, 'first_order_reward', '首次完成交易獎勵', ' 點'),
      (6, 'invite_reward', '邀請獎勵', ' 點'),
      (7, 'monthly_reward_cap', '每月獎勵上限', ' 點'),
      (8, 'reward_expiry_months', '獎勵點數有效期', ' 個月'),
      (9, 'free_daily_limit', '免費索取每日上限', ' 件'),
      (10, 'new_account_days', '新帳號觀察期', ' 天'),
      (11, 'new_account_points_cap', '新帳號點數交易上限', ' 點'),
      (12, 'request_timeout_hours', '索取逾時自動取消', ' 小時'),
      (13, 'auto_complete_hours', '單方確認後自動完成', ' 小時'),
      (14, 'accept_timeout_days', '接受後都沒人確認，自動取消', ' 天'),
      (15, 'review_window_days', '評價期限', ' 天'),
      (16, 'report_hide_threshold', '檢舉幾人自動隱藏', ' 人')
    ) as t(ord, col, label, unit) order by ord
  loop
    o := (to_jsonb(cur)->>r.col)::numeric;
    nw := (to_jsonb(nxt)->>r.col)::numeric;
    if o is distinct from nw then
      if r.col = 'fee_rate' then
        o := o * 100;
        nw := nw * 100;
      end if;
      v_changes := v_changes || format('%s %s%s → %s%s', r.label, trim_scale(o), r.unit, trim_scale(nw), r.unit);
    end if;
  end loop;
  if cardinality(v_changes) = 0 then raise exception '參數沒有變更'; end if;

  update public.settings set
    fee_rate = nxt.fee_rate, min_fee = nxt.min_fee, signup_bonus = nxt.signup_bonus,
    first_listing_reward = nxt.first_listing_reward, first_order_reward = nxt.first_order_reward,
    invite_reward = nxt.invite_reward,
    monthly_reward_cap = nxt.monthly_reward_cap, free_daily_limit = nxt.free_daily_limit,
    new_account_days = nxt.new_account_days, new_account_points_cap = nxt.new_account_points_cap,
    request_timeout_hours = nxt.request_timeout_hours, auto_complete_hours = nxt.auto_complete_hours,
    review_window_days = nxt.review_window_days, report_hide_threshold = nxt.report_hide_threshold,
    reward_expiry_months = nxt.reward_expiry_months, accept_timeout_days = nxt.accept_timeout_days,
    updated_at = now()
  where id = 1;
  perform private.log_admin(a.id, '更新平台參數：' || array_to_string(v_changes, '、'));
end $$;

-- ============================================================ realtime

alter publication supabase_realtime add table public.invites;

-- ============================================================ privileges

revoke all on public.invite_codes, public.invites from anon, authenticated;
grant select on public.invite_codes, public.invites to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_admin(), private.is_blocked(uuid, uuid), private.is_party(uuid), private.is_party_text(text),
  private.can_chat_text(text), private.has_requested(uuid),
  private.owns_listing(uuid), private.can_see_exact(uuid), private.review_published(uuid),
  private.is_active_member(uuid), private.is_staff()
  to anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
