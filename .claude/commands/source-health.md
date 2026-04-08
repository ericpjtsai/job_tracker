Check the health of all data sources.

1. Query the `source_health` table in Supabase for the current state of all sources:
   ```sql
   SELECT source_id, status, last_success_at, last_error_at, consecutive_failures, last_error
   FROM source_health
   ORDER BY source_id;
   ```
2. For each source, display: source_id, status, last_success_at (relative time), consecutive_failures, last_error
3. Also query Supabase for historical job counts per source (group by `firehose_rule` column — legacy name, used as the generic source string)
4. Flag any sources that are in `error` status, have 3+ consecutive failures, or whose `last_success_at` is older than their expected schedule
5. To trigger a poll manually, use the Supabase CLI: `supabase functions invoke poll-{source-id}` (e.g. `poll-ats`, `poll-linkedin`, `poll-github`)
6. To inspect cron schedule status, query `cron.job_run_details` JOINed with `cron.job` (the run-details table only has `jobid`, not `jobname`)
