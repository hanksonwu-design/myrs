-- In-app notifications (站內通知).
--
--   1. Everything Myrs e-mails (public.notifications) also shows on the site, under
--      the bell in the header. Members read only their own rows. Staff still see
--      only what the mail status page shows (who and the subject, no body).
--   2. public.mark_notifications_read(p_ids) marks some of them read, or all of them
--      when p_ids is null.
--   3. Notifications from before this migration were already e-mailed, so they start
--      read; otherwise every member would open the site to a pile of old news.
--   4. Realtime, so the bell updates while the site is open.

-- ============================================================ table

alter table public.notifications add column if not exists read_at timestamptz;
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
update public.notifications set read_at = coalesce(sent_at, created_at) where read_at is null;

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select using (user_id = auth.uid());

-- ============================================================ function

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  u public.profiles := private.me();
  n int;
begin
  update public.notifications set read_at = now()
  where user_id = u.id and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ============================================================ realtime

alter publication supabase_realtime add table public.notifications;

-- ============================================================ privileges

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_admin(), private.is_blocked(uuid, uuid), private.is_party(uuid), private.is_party_text(text),
  private.can_chat_text(text), private.has_requested(uuid),
  private.owns_listing(uuid), private.can_see_exact(uuid), private.review_published(uuid),
  private.is_active_member(uuid), private.is_staff()
  to anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- From migration 11: visitors may read the community counts.
grant execute on function public.community_impact() to anon;
