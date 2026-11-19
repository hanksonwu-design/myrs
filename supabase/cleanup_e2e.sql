-- Removes everything made by the automatic tests (npm run test:e2e and the
-- browser test): every anonymous account and all of its data.
--
-- The site itself never uses anonymous sign-in (it only works while
-- "Allow anonymous sign-ins" is on, for testing), so anonymous accounts are
-- always test accounts. Real members, who sign in by email or phone, are not touched.
--
-- Run in Supabase: SQL Editor -> New query -> paste all of this -> Run.
-- Pictures the tests uploaded stay in Storage (a few small files); delete them
-- under Storage -> listing-photos / chat-images if you like.

begin;

create temp table t_users on commit drop as
  select id, phone, email from auth.users where is_anonymous;

create temp table t_listings on commit drop as
  select id from public.listings where owner_id in (select id from t_users);

create temp table t_orders on commit drop as
  select id from public.orders
  where requester_id in (select id from t_users)
     or provider_id in (select id from t_users)
     or listing_id in (select id from t_listings);

delete from public.messages
  where order_id in (select id from t_orders) or sender_id in (select id from t_users);
delete from public.chat_reads
  where order_id in (select id from t_orders) or user_id in (select id from t_users);
delete from public.reviews
  where order_id in (select id from t_orders)
     or reviewer_id in (select id from t_users) or reviewee_id in (select id from t_users);
delete from public.ledger
  where order_id in (select id from t_orders) or user_id in (select id from t_users);
delete from public.orders where id in (select id from t_orders);
delete from public.reports
  where reporter_id in (select id from t_users)
     or target_id in (select id from t_users) or target_id in (select id from t_listings);
delete from public.listings where id in (select id from t_listings); -- listing_secrets go with them
delete from public.blocks
  where blocker_id in (select id from t_users) or blocked_id in (select id from t_users);
delete from public.admin_log where admin_id in (select id from t_users);

-- Same hash complete_signup() stores, so the bonus record goes too.
delete from public.signup_grants where identity_hash in (
  select encode(sha256(convert_to(
    coalesce(nullif(phone, ''), lower(nullif(email, '')), id::text), 'UTF8')), 'hex')
  from t_users);

delete from public.profiles where id in (select id from t_users);
delete from auth.users where id in (select id from t_users);

commit;

-- Should show 0.
select count(*) as test_accounts_left from auth.users where is_anonymous;
