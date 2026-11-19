-- Sends queued e-mail every minute while there is any: pg_cron calls the
-- send-notifications Edge Function through pg_net. Deploy the function first
-- (supabase/functions/send-notifications, README section 7).
-- Another project: replace the project ref in the URL below.

create extension if not exists pg_net;

select cron.unschedule('myrs-send-notifications')
  where exists (select 1 from cron.job where jobname = 'myrs-send-notifications');

select cron.schedule('myrs-send-notifications', '* * * * *', $$
  select net.http_post(
    url := 'https://mpswtcvwxuhtmwmbwocu.supabase.co/functions/v1/send-notifications',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  where exists (select 1 from public.notifications where sent_at is null and attempts < 5)
$$);
