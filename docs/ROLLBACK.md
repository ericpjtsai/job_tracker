# Rollback Runbook — Listener → Edge Functions Migration

This document covers how to safely undo (or partially undo) the listener-to-Supabase Edge Functions migration. Read the **important caveat** at the end before doing anything drastic.

## TL;DR

If something goes wrong and you just want polling to stop **right now**, run this single SQL query in Supabase Dashboard → SQL Editor:

```sql
SELECT cron.unschedule(jobname) FROM cron.job;
```

That's it. This is the **kill switch** — it unschedules all 16 cron jobs. The system goes silent immediately. The Edge Functions stay deployed (dormant), the database state is preserved, and you can re-enable individual jobs later with a new `cron.schedule(...)` call (or by re-applying [migration 007](../supabase/migrations/007_cron_schedule.sql)).

For most "something is wrong" scenarios, the kill switch is all you need. Read on if you actually want to revert further.

---

## What lives where

The migration introduced state in **6 different places**, only one of which is in git. Knowing where each thing lives is the key to understanding rollback.

| State | Where it lives | How to revert |
|---|---|---|
| **Web app routes** (`/api/poll`, `/api/sources`, `/api/jobs/rescore`, `/api/scoring`) | git → Vercel | `git revert <commit>` + `git push`. Vercel auto-deploys old version in ~2 min. |
| **Scoring package** (Gemini removed, function renamed) | git → npm workspace | Same git revert. The web app will rebuild with the old `extractKeywordsWithGemini` name. |
| **9 Edge Functions** | Deployed in Supabase project | `npx supabase functions delete <name>` per function. Or just leave them dormant — they cost nothing when not invoked. |
| **16 pg_cron jobs** | `cron.job` table in Postgres | `SELECT cron.unschedule(jobname) FROM cron.job;` (the kill switch above) |
| **`source_health` table + `enrichment_status` column** | Postgres schema | `DROP TABLE source_health; ALTER TABLE job_postings DROP COLUMN enrichment_status;` — only if you want a clean DB. The columns don't break anything if left in place. |
| **Vault secrets** (`project_url`, `service_role_key`) | `vault.secrets` table | `DELETE FROM vault.secrets WHERE name IN ('project_url', 'service_role_key');` |
| **Edge Function dashboard secrets** (`ANTHROPIC_API_KEY`, etc.) | Supabase dashboard → Settings → Edge Functions → Secrets | Delete via dashboard, or `npx supabase secrets unset KEY_NAME` |

---

## Pre-rollback checklist

Before doing **anything**, confirm what you actually want to roll back:

- [ ] Is polling broken, or is just **one source** broken? If one source: fix that source's function, redeploy with `npx supabase functions deploy <name> --no-verify-jwt`. Do not roll back the whole system.
- [ ] Is the cron firing too often / too rarely? Adjust the schedule in [007_cron_schedule.sql](../supabase/migrations/007_cron_schedule.sql) and re-apply (the migration is idempotent — it unschedules existing jobs before re-creating them).
- [ ] Is a function returning bad data? Check the function logs in Dashboard → Edge Functions → `<name>` → Logs before assuming the architecture is wrong.
- [ ] Are upstream API errors being mistaken for bugs? Mantiks/HasData credit exhaustion will look like "the source is broken" — it isn't, the account just needs a top-up.
- [ ] **Most "rollbacks" should just be the kill switch** at the top of this doc.

---

## Three rollback paths

### Option A — Pause cron only (recommended for "I want to stop everything but don't want to delete anything")

**Time: 30 seconds. Reversible.**

```sql
-- In Supabase Dashboard → SQL Editor
SELECT cron.unschedule(jobname) FROM cron.job;
```

That's the entire procedure. Result:
- All 16 cron jobs unscheduled, polling stops immediately
- Edge Functions stay deployed but dormant — no invocations means no API costs
- Web UI still works for manual triggers (the Sources page "Run Now" buttons fire functions on demand)
- Database state is preserved
- All your historical job rows are untouched

To re-enable later: re-apply [007_cron_schedule.sql](../supabase/migrations/007_cron_schedule.sql) via `npx supabase db push` or paste it into the SQL Editor. The migration is idempotent (it unschedules before scheduling) so this is safe even if some jobs are already registered.

### Option B — Partial revert (back to listener for polling, keep Edge Functions deployed)

**Time: 30+ minutes. You need to re-host the listener somewhere.**

Use this if you want to go back to the old daemon-based polling but don't want to wipe Supabase state.

1. **Kill switch** (stop the new system from polling):
   ```sql
   SELECT cron.unschedule(jobname) FROM cron.job;
   ```

2. **Revert the git commit** (web routes go back to calling `LISTENER_URL`):
   ```bash
   git revert <commit-sha>
   git push
   ```
   Vercel auto-deploys the reverted code in ~2 min.

3. **Re-host the listener somewhere.** Options:
   - **Locally**: `npm run dev:listener` from `/Users/eric/Desktop/Job Tracker`. Set up port forwarding or run `ngrok http 3002` to expose it. Set `LISTENER_URL=http://your-ngrok-url` in Vercel env.
   - **Railway**: re-deploy the listener app like before. Set `LISTENER_URL=https://your-railway-url` in Vercel env.
   - **Fly.io / Render / etc.**: same idea.

4. **Set `LISTENER_URL` in Vercel** (Settings → Environment Variables → add `LISTENER_URL` with your hosted URL) and redeploy.

5. **Verify**: hit the Sources page in the web app. Cards should populate, "Run Now" buttons should trigger the listener again.

The Edge Functions remain deployed but dormant. The `source_health` table + `enrichment_status` column also remain — they don't conflict with the listener.

### Option C — Full nuke (return to pre-migration state)

**Time: 1+ hour. Most thorough.**

Use this if you want a clean slate — no Edge Functions, no `source_health`, no Vault secrets, no migration artifacts.

1. **Kill switch**:
   ```sql
   SELECT cron.unschedule(jobname) FROM cron.job;
   ```

2. **Delete the 9 Edge Functions**:
   ```bash
   for fn in poll-github poll-serpapi poll-hasdata poll-mantiks \
             poll-linkedin-direct poll-linkedin poll-ats \
             enrich-batch rescore; do
     npx supabase functions delete "$fn"
   done
   ```

3. **Delete Vault secrets**:
   ```sql
   DELETE FROM vault.secrets WHERE name IN ('project_url', 'service_role_key');
   ```

4. **Drop new schema** (the migration adds a table + a column to `job_postings`):
   ```sql
   DROP TABLE IF EXISTS source_health;
   ALTER TABLE job_postings DROP COLUMN IF EXISTS enrichment_status;
   ```

5. **Repair migration history** (so the CLI doesn't think 006 + 007 are still applied):
   ```bash
   npx supabase migration repair --status reverted 006 007
   ```

6. **Optionally delete dashboard secrets** (Mantiks, HasData, SerpApi, Anthropic) via Dashboard → Settings → Edge Functions → Secrets. The values still exist in `apps/listener/.env.local` so this is just hygiene.

7. **Revert the git commit**:
   ```bash
   git revert <commit-sha>
   git push
   ```

8. **Re-host the listener** (see Option B step 3) and set `LISTENER_URL` in Vercel.

After step 8, you're back to where you started before this migration began.

---

## Important caveat

**The listener daemon is not currently running anywhere.** Before this migration began, you had stopped hosting it. This means:

- A pure `git revert` does NOT restore polling. It just removes the Edge Function-based code from your web app and brings back the broken old code that points at `LISTENER_URL`. With nothing listening on that URL, the Sources page will show "Backend unreachable" and polling will stay dark.
- For Options B and C above, you **must re-host the listener somewhere** (Railway / Fly / Render / local + ngrok) for polling to actually work. That's its own setup task — not a free action.
- If you're reverting because the new system is broken **and** you don't want to re-host the listener, your only viable option is **A (kill switch)** while you fix forward on the Edge Functions.

In short: this migration was a one-way door in the sense that "go back to the listener" is no longer free. The kill switch is. Use that as your default escape hatch and reach for Options B/C only if there's a fundamental architectural reason you can't fix forward.

---

## Verification queries (run after any rollback)

```sql
-- Are any cron jobs still scheduled?
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;

-- Has anything fired in the last hour?
SELECT j.jobname, d.status, d.start_time
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.start_time > now() - interval '1 hour'
  ORDER BY d.start_time DESC;

-- What does source_health look like?
SELECT source_id, status, last_error, last_poll_at
  FROM source_health
  ORDER BY source_id;

-- How many new rows landed in the last hour?
SELECT count(*) FROM job_postings
  WHERE first_seen > now() - interval '1 hour';
```

If everything went silent, the first query returns 0 rows and the count query stays flat over time. If you went with Option A, source_health rows will still be there with their last-known status. If you went with Option C, source_health doesn't exist and that query errors out — which is the expected confirmation of the drop.
