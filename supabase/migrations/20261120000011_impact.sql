-- Community impact board (社區成果).
--
--   1. public.community_impact() counts completed deals for everyone to see, visitors
--      who have not signed in included. It returns counts only: no names, listings,
--      places or times of single deals (except the date of the very first one).
--   2. A deal counts once it is completed (both sides confirmed, the automatic
--      completion, or staff ruling it done). Each deal is one item, because every
--      request takes one from a listing.
--   3. A want (徵求) is "found" when a listing answering it was completed with the
--      member who posted the want.
--   4. Months are Taipei time, like the monthly reward cap.
--
-- Members' own numbers are counted in the browser from their own deals, which row
-- level security already lets them read.
--
-- Note for later migrations: the privileges block below grants this one function to
-- anon. A migration that repeats "revoke execute on all functions in schema public
-- from public, anon" must grant it again.

-- ============================================================ function

create or replace function public.community_impact() returns jsonb
language sql stable security definer set search_path = public as $$
  with done as (
    select o.requester_id, o.provider_id, o.mode, o.completed_at, l.category,
      case when w.user_id = o.requester_id then w.id end as want_found,
      date_trunc('month', o.completed_at at time zone 'Asia/Taipei') as m
    from public.orders o
    join public.listings l on l.id = o.listing_id
    left join public.wants w on w.id = l.want_id
    where o.status = 'completed' and o.completed_at is not null
  ),
  cur as (select date_trunc('month', now() at time zone 'Asia/Taipei') as m),
  people as (
    select d.m, v.uid from done d cross join lateral (values (d.requester_id), (d.provider_id)) v(uid)
  )
  select jsonb_build_object(
    'month', (
      select jsonb_build_object(
        'food', count(*) filter (where d.category = 'food'),
        'clothing', count(*) filter (where d.category = 'clothing'),
        'free', count(*) filter (where d.mode = 'free'),
        'neighbours', (select count(distinct p.uid) from people p, cur c where p.m = c.m)
      )
      from done d, cur c where d.m = c.m
    ),
    'total', (
      select jsonb_build_object(
        'food', count(*) filter (where d.category = 'food'),
        'clothing', count(*) filter (where d.category = 'clothing'),
        'free', count(*) filter (where d.mode = 'free'),
        'neighbours', (select count(distinct p.uid) from people p)
      )
      from done d
    ),
    'wantsFound', (select count(distinct want_found) from done),
    'since', (select min(completed_at) from done),
    'months', (
      select jsonb_agg(
        jsonb_build_object(
          'month', to_char(s.m, 'YYYY-MM'),
          'food', (select count(*) from done d where d.m = s.m and d.category = 'food'),
          'clothing', (select count(*) from done d where d.m = s.m and d.category = 'clothing')
        )
        order by s.m
      )
      from cur c, generate_series(c.m - interval '5 months', c.m, interval '1 month') s(m)
    )
  )
$$;

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
-- Counts only, so visitors can see what the neighbourhood has done before joining.
grant execute on function public.community_impact() to anon;
