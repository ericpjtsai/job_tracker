Guide for adding a new job data source to the listener.

Follow the existing pattern in `apps/listener/src/`:

1. Create a new file `apps/listener/src/{source-name}.ts`
2. Implement a `poll` function that returns the number of jobs processed
3. For each job found, call `insertJobPosting()` from `./processor` with: url, title, company, location, description, source tag, publishedAt
4. Register as a DataSource using:
   ```ts
   import { registerSource } from './sources/registry'
   import { createHealth, withHealthTracking } from './sources/types'
   const health = createHealth()
   export const mySource = { id: '...', name: '...', type: 'poll', schedule: '...', cost: null, envVars: [], triggerPath: '/poll/my-source', health, poll: withHealthTracking(health, pollFn) }
   registerSource(mySource)
   ```
5. In `index.ts`: add the import, wire to `scheduleDailyAt()` or `setInterval()`, add control server route
6. In `apps/web/app/sources/page.tsx`: add entry to the `SOURCES` array

Reference `github-jobs.ts` or `hasdata-jobs.ts` as examples.
