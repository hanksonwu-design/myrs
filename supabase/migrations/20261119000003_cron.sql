-- Time-based rules every 5 minutes: request timeout (24 h), auto-complete (48 h)
-- and food expiry. The app also calls run_maintenance() while it is open, so the
-- rules still apply if this migration is skipped.

create extension if not exists pg_cron;

select cron.schedule('myrs-maintenance', '*/5 * * * *', $$select private.run_maintenance()$$);
