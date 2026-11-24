-- =============================================================================
-- Daily billing check, scheduled inside the database with pg_cron.
-- Runs at 17:05 UTC = 00:05 Asia/Jakarta. No secret or service-role key is
-- involved. private.billing_run() is idempotent and takes an advisory lock,
-- so it is safe alongside the optional Vercel Cron backup (/api/cron/billing).
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- Re-running this migration replaces the job instead of adding a second one.
select cron.unschedule(jobid) from cron.job where jobname = 'opervia-billing-daily';

select cron.schedule(
  'opervia-billing-daily',
  '5 17 * * *',
  $$select private.billing_run(private.jakarta_today(), 'pg_cron')$$
);
