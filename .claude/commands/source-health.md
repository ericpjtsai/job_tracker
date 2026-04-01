Check the health of all data sources.

1. Fetch `http://localhost:3002/sources` from the listener control server
2. For each source, display: name, status, jobs found (session), consecutive failures, last error
3. Also query Supabase for historical counts per source (group by `firehose_rule` column)
4. Flag any sources that are in `error` status or have 3+ consecutive failures
5. If the listener is unreachable, say so and suggest running `npm run dev:listener`
