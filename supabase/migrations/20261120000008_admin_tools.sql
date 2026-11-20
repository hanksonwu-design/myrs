-- Admin tools.
--
--   1. Banned words live in settings, and the owner edits them in the backend. A new
--      listing that contains one waits for review, as before.
--   2. A site-wide announcement with an optional end time, shown on the home page.
--   3. Mail delivery status for admins and owners: counts and the latest problem mail,
--      without e-mail addresses or message bodies. Failed mail can be sent again.
--   4. The settings log says what changed, e.g. 「手續費比例 10% → 8%」.
--
-- Banned words, the announcement and the settings stay owner only.

-- ============================================================ 1. banned words

alter table public.settings add column if not exists banned_words text[] not null default array[
  '香菸', '菸', '電子煙', '啤酒', '紅酒', '高粱', '酒', '藥', '處方', '保健食品', '奶粉',
  '武器', '刀械', '活體', '寵物', '仿冒', '高仿', '內衣', '內褲', '熟食', '自製'];

-- Was a fixed list; create_listing reads it from here.
create or replace function private.banned_words() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select banned_words from public.settings where id = 1), '{}')
$$;

create or replace function public.admin_set_banned_words(p_words text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('owner');
  v_old text[] := private.banned_words();
  v_new text[] := '{}';
  w text;
  v_added text[];
  v_removed text[];
begin
  foreach w in array coalesce(p_words, '{}'::text[]) loop
    w := btrim(coalesce(w, ''));
    continue when w = '' or w = any (v_new);
    if char_length(w) > 10 then raise exception '禁售詞「%」太長，每個最多 10 個字', w; end if;
    v_new := v_new || w;
  end loop;
  if cardinality(v_new) > 100 then raise exception '禁售詞最多 100 個'; end if;
  select coalesce(array_agg(x), '{}') into v_added from unnest(v_new) x where not (x = any (v_old));
  select coalesce(array_agg(x), '{}') into v_removed from unnest(v_old) x where not (x = any (v_new));
  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    raise exception '禁售詞沒有變更';
  end if;
  update public.settings set banned_words = v_new, updated_at = now() where id = 1;
  perform private.log_admin(a.id, left('更新禁售詞：' || concat_ws('；',
    case when cardinality(v_added) > 0 then '新增「' || array_to_string(v_added, '」「') || '」' end,
    case when cardinality(v_removed) > 0 then '移除「' || array_to_string(v_removed, '」「') || '」' end), 1000));
end $$;

-- ============================================================ 2. announcement

alter table public.settings add column if not exists announcement text not null default '';
alter table public.settings add column if not exists announcement_until timestamptz;
-- When it was posted; the site uses it to remember who closed which announcement.
alter table public.settings add column if not exists announcement_at timestamptz;

-- An empty text takes the announcement down. p_until null: no end time.
create or replace function public.admin_set_announcement(p_text text, p_until timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('owner');
  v text := btrim(coalesce(p_text, ''));
begin
  if char_length(v) > 200 then raise exception '公告最多 200 個字'; end if;
  if v = '' then
    if (select announcement from public.settings where id = 1) = '' then
      raise exception '目前沒有公告';
    end if;
    update public.settings
      set announcement = '', announcement_until = null, announcement_at = null, updated_at = now()
      where id = 1;
    perform private.log_admin(a.id, '取消全站公告');
    return;
  end if;
  if p_until is not null and p_until <= now() then raise exception '結束時間要在現在之後'; end if;
  update public.settings
    set announcement = v, announcement_until = p_until, announcement_at = now(), updated_at = now()
    where id = 1;
  perform private.log_admin(a.id, format('發布全站公告：%s（%s）', v,
    case when p_until is null then '沒有結束時間'
      else '到 ' || to_char(p_until at time zone 'Asia/Taipei', 'YYYY/MM/DD HH24:MI') end));
end $$;

-- ============================================================ 3. mail status

-- Counts and the latest mail (problem mail only, unless p_filter = 'all'). E-mail
-- addresses stay in Supabase Auth: none is returned, and any in an error is masked.
create or replace function public.admin_mail_status(p_filter text default 'problem', p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('admin');
begin
  if p_filter is null or p_filter not in ('problem', 'all') then raise exception '篩選條件不正確'; end if;
  return jsonb_build_object(
    'pending', (select count(*) from public.notifications where sent_at is null and attempts < 5),
    'failed', (select count(*) from public.notifications where sent_at is null and attempts >= 5),
    'sent24h', (select count(*) from public.notifications
      where sent_at > now() - interval '24 hours' and last_error = ''),
    'noAddress', (select count(*) from public.notifications where sent_at is not null and last_error <> ''),
    'oldestPending', (select min(created_at) from public.notifications where sent_at is null and attempts < 5),
    'items', coalesce((
      select jsonb_agg(to_jsonb(x) order by x."createdAt" desc) from (
        select n.id, n.user_id as "userId", coalesce(p.name, '') as name, n.subject,
          n.created_at as "createdAt", n.sent_at as "sentAt", n.attempts,
          regexp_replace(n.last_error, '[^[:space:]<>"''(),;:]+@[^[:space:]<>"''(),;:]+', '（信箱）', 'g') as error,
          case
            when n.sent_at is null and n.attempts >= 5 then 'failed'
            when n.sent_at is null then 'pending'
            when n.last_error <> '' then 'no_address'
            else 'sent'
          end as state
        from public.notifications n
        left join public.profiles p on p.id = n.user_id
        where p_filter = 'all' or n.sent_at is null or n.last_error <> ''
        order by n.created_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
      ) x), '[]'::jsonb)
  );
end $$;

-- Sends failed mail again (p_id null: all of it); pg_cron picks it up within a minute.
create or replace function public.admin_retry_mail(p_id uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  a public.profiles := private.require_level('admin');
  n int;
begin
  update public.notifications
    set attempts = 0, claimed_at = null, last_error = ''
    where sent_at is null and attempts >= 5 and (p_id is null or id = p_id);
  get diagnostics n = row_count;
  if n = 0 then raise exception '沒有需要重寄的通知信'; end if;
  perform private.log_admin(a.id, format('重新寄出 %s 封失敗的通知信', n));
  return n;
end $$;

-- ============================================================ 4. settings log

-- Same as migration 7, except the log lists each change and an unchanged save is refused.
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
      (6, 'monthly_reward_cap', '每月獎勵上限', ' 點'),
      (7, 'reward_expiry_months', '獎勵點數有效期', ' 個月'),
      (8, 'free_daily_limit', '免費索取每日上限', ' 件'),
      (9, 'new_account_days', '新帳號觀察期', ' 天'),
      (10, 'new_account_points_cap', '新帳號點數交易上限', ' 點'),
      (11, 'request_timeout_hours', '索取逾時自動取消', ' 小時'),
      (12, 'auto_complete_hours', '單方確認後自動完成', ' 小時'),
      (13, 'accept_timeout_days', '接受後都沒人確認，自動取消', ' 天'),
      (14, 'review_window_days', '評價期限', ' 天'),
      (15, 'report_hide_threshold', '檢舉幾人自動隱藏', ' 人')
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
    monthly_reward_cap = nxt.monthly_reward_cap, free_daily_limit = nxt.free_daily_limit,
    new_account_days = nxt.new_account_days, new_account_points_cap = nxt.new_account_points_cap,
    request_timeout_hours = nxt.request_timeout_hours, auto_complete_hours = nxt.auto_complete_hours,
    review_window_days = nxt.review_window_days, report_hide_threshold = nxt.report_hide_threshold,
    reward_expiry_months = nxt.reward_expiry_months, accept_timeout_days = nxt.accept_timeout_days,
    updated_at = now()
  where id = 1;
  perform private.log_admin(a.id, '更新平台參數：' || array_to_string(v_changes, '、'));
end $$;

-- ============================================================ privileges

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_admin(), private.is_blocked(uuid, uuid), private.is_party(uuid), private.is_party_text(text),
  private.can_chat_text(text), private.has_requested(uuid),
  private.owns_listing(uuid), private.can_see_exact(uuid), private.review_published(uuid),
  private.is_active_member(uuid), private.is_staff()
  to anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
