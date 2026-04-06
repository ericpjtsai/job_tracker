// poll-serpapi — Google Jobs index search via SerpApi
// PORTED from apps/listener/src/serpapi-jobs.ts
// Free tier: 100 searches/month → 4 queries × 2x daily ≈ 240/month — well within budget.

import { runPollHandler, emptyResult, tally, tallyError, type PollResult } from '../_shared/handler.ts'
import { insertJobPosting, canonicalLinkedInUrl, normalizeUrl, type ProcessorContext } from '../_shared/processor.ts'

const SERPAPI_QUERIES = [
  '"product designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com "B2B" OR "enterprise"',
  '"UX designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com "B2B" OR "SaaS"',
  '"interaction designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com',
  '"design engineer" site:greenhouse.io OR site:ashbyhq.com OR site:lever.co',
]

interface SerpApiJob {
  title?: string
  company_name?: string
  location?: string
  description?: string
  detected_extensions?: { posted_at?: string; salary?: string }
  apply_options?: Array<{ title?: string; link?: string }>
  job_id?: string
}

interface SerpApiResponse {
  jobs_results?: SerpApiJob[]
  error?: string
}

async function pollSerpApi(ctx: ProcessorContext): Promise<PollResult> {
  const apiKey = Deno.env.get('SERPAPI_API_KEY')
  if (!apiKey) {
    console.log('[SerpApi] SERPAPI_API_KEY not set — skipping')
    return emptyResult()
  }

  const result = emptyResult()
  console.log('[SerpApi] Google Jobs poll starting...')

  for (const query of SERPAPI_QUERIES) {
    try {
      const params = new URLSearchParams({
        engine: 'google_jobs',
        q: query,
        api_key: apiKey,
        num: '10',
      })
      const res = await fetch(`https://serpapi.com/search?${params}`, {
        signal: AbortSignal.timeout(15_000),
      })
      const data: SerpApiResponse = await res.json()

      if (data.error) {
        console.warn(`[SerpApi] API error for "${query}": ${data.error}`)
        // "Google hasn't returned any results" is a successful empty response, not an upstream
        // failure — don't penalize source health. Real auth/quota failures bubble through here too.
        if (!/no results|hasn't returned/i.test(data.error)) {
          tallyError(result, new Error(data.error))
        }
        continue
      }

      for (const job of data.jobs_results ?? []) {
        const atsLink = job.apply_options?.find(
          (o) => o.link && /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com/.test(o.link),
        )?.link ?? ''
        const linkedinLink = job.apply_options?.find((o) => o.link?.includes('linkedin.com/jobs'))?.link ?? ''

        const rawUrl = atsLink || linkedinLink
        if (!rawUrl) continue

        const url = linkedinLink && !atsLink ? canonicalLinkedInUrl(linkedinLink) : normalizeUrl(rawUrl)

        const r = await insertJobPosting(ctx, {
          url,
          title: job.title ?? '',
          company: job.company_name ?? '',
          location: job.location ?? '',
          description: job.description ?? '',
          source: 'linkedin-serpapi',
        })
        tally(result, r.status)
      }
    } catch (err) {
      console.error(`[SerpApi] Error for "${query}":`, err instanceof Error ? err.message : err)
      tallyError(result, err)
    }
  }

  console.log(`[SerpApi] Done — inserted=${result.inserted} deduped=${result.deduped} apiErrors=${result.apiErrors}`)
  return result
}

Deno.serve((req) => runPollHandler('serpapi', req, pollSerpApi))
