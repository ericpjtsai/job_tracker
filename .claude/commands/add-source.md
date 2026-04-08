Guide for adding a new job data source to the Edge Functions polling system.

Follow the existing pattern in `supabase/functions/`:

1. Create a new directory `supabase/functions/poll-{source-name}/` with an `index.ts`
2. Use the shared helpers from `_shared/`:
   ```ts
   import { getServiceClient, jsonResponse, requireServiceAuth } from '../_shared/supabase.ts'
   import { insertJobPosting } from '../_shared/processor.ts'
   import { markPolling, markHealthy, markError } from '../_shared/health.ts'
   ```
3. Implement `Deno.serve(async (req) => { ... })`:
   - Call `requireServiceAuth(req)` first and return early on auth failure
   - `await markPolling(supabase, '{source-id}')` at the start
   - For each job found, call `await insertJobPosting(supabase, { url, title, company, location, description, source, publishedAt })`
   - On success: `await markHealthy(supabase, '{source-id}', jobsInserted)`
   - On error: `await markError(supabase, '{source-id}', err)`
   - Return `jsonResponse({ ok, processed, errors })`
4. Add a `cron.schedule('{source-id}', '...', $$SELECT call_edge('poll-{source-name}')$$);` entry in `supabase/migrations/007_cron_schedule.sql` and re-apply
5. In `apps/web/app/sources/page.tsx`: add entry to the `SOURCES` array so the UI shows the new source card
6. Deploy: `npm run functions:deploy`

**Reference implementations:**
- Simple polling: `supabase/functions/poll-github/index.ts`
- With batching arg: `supabase/functions/poll-ats/index.ts` (uses `batch` body param for sharding)
- With platform arg: `supabase/functions/poll-hasdata/index.ts` (uses `platform` body param for Indeed vs Glassdoor)
- Queue worker pattern: `supabase/functions/enrich-batch/index.ts`

**Secrets:** any API keys go in Supabase Dashboard → Project Settings → Edge Functions → Secrets. Access via `Deno.env.get('MY_API_KEY')`. Never hardcode.

**Health:** the `source_health` table is the source of truth — don't use in-memory state.
