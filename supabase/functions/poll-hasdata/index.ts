// poll-hasdata — Indeed + Glassdoor via HasData scraper API
// PORTED from apps/listener/src/hasdata-jobs.ts (both pollIndeed + pollGlassdoor)
// Single function, dispatched via ?platform=indeed|glassdoor body param.
// Cost: 5 credits per request × 3 keywords × 2 platforms = 30 credits per full poll.

import { runPollHandler, emptyResult, tally, tallyError, type PollResult } from '../_shared/handler.ts'
import { insertJobPosting, normalizeUrl, type ProcessorContext } from '../_shared/processor.ts'

const HASDATA_BASE = 'https://api.hasdata.com'

const JOB_KEYWORDS = ['product designer', 'UX designer', 'interaction designer']

const DESIGN_TITLE = /\b(designer|design|UX|UI|interaction|visual|product)\b/i

interface HasDataIndeedJob {
  title?: string
  jobTitle?: string
  company?: string
  companyName?: string
  location?: string
  datePosted?: string
  date?: string
  url?: string
  jobUrl?: string
  link?: string
  description?: string
  snippet?: string
}

interface HasDataGlassdoorJob {
  jobTitle?: string
  title?: string
  employer?: { name?: string }
  company?: string
  location?: string
  listingDate?: string
  datePosted?: string
  jobListingUrl?: string
  url?: string
  jobDescription?: string
  description?: string
}

async function hasDataGet(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${HASDATA_BASE}${path}`, {
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HasData HTTP ${res.status}: ${text}`)
  }
  return await res.json()
}

async function pollIndeed(ctx: ProcessorContext, apiKey: string): Promise<PollResult> {
  const result = emptyResult()
  console.log('[HasData/Indeed] poll starting...')

  for (const keyword of JOB_KEYWORDS) {
    try {
      const params = new URLSearchParams({
        keyword,
        location: 'United States',
        sort: 'date',
        domain: 'www.indeed.com',
      })
      const data = (await hasDataGet(`/scrape/indeed/listing?${params}`, apiKey)) as {
        jobs?: HasDataIndeedJob[]
        jobResults?: HasDataIndeedJob[]
        results?: HasDataIndeedJob[]
        error?: string
      }

      if (data.error) {
        console.warn(`[HasData/Indeed] API error for "${keyword}": ${data.error}`)
        tallyError(result, new Error(data.error))
        continue
      }

      const jobs = data.jobs ?? data.jobResults ?? data.results ?? []

      for (const job of jobs) {
        const title = job.title ?? job.jobTitle ?? ''
        if (!DESIGN_TITLE.test(title)) continue

        const rawUrl = job.url ?? job.jobUrl ?? job.link ?? ''
        if (!rawUrl) continue

        const r = await insertJobPosting(ctx, {
          url: normalizeUrl(rawUrl),
          title,
          company: job.company ?? job.companyName ?? '',
          location: job.location ?? '',
          description: [keyword, job.description ?? job.snippet].filter(Boolean).join(' '),
          source: 'indeed-hasdata',
          publishedAt: job.datePosted ?? job.date,
        })
        tally(result, r.status)
      }
    } catch (err) {
      console.error(`[HasData/Indeed] Error for "${keyword}":`, err instanceof Error ? err.message : err)
      tallyError(result, err)
    }
  }

  return result
}

async function pollGlassdoor(ctx: ProcessorContext, apiKey: string): Promise<PollResult> {
  const result = emptyResult()
  console.log('[HasData/Glassdoor] poll starting...')

  for (const keyword of JOB_KEYWORDS) {
    try {
      const params = new URLSearchParams({
        keyword,
        location: 'United States',
        sort: 'recent',
        domain: 'www.glassdoor.com',
      })
      const data = (await hasDataGet(`/scrape/glassdoor/listing?${params}`, apiKey)) as {
        jobs?: HasDataGlassdoorJob[]
        jobListings?: HasDataGlassdoorJob[]
        results?: HasDataGlassdoorJob[]
        error?: string
      }

      if (data.error) {
        console.warn(`[HasData/Glassdoor] API error for "${keyword}": ${data.error}`)
        tallyError(result, new Error(data.error))
        continue
      }

      const jobs = data.jobs ?? data.jobListings ?? data.results ?? []

      for (const job of jobs) {
        const title = job.jobTitle ?? job.title ?? ''
        if (!DESIGN_TITLE.test(title)) continue

        const rawUrl = job.jobListingUrl ?? job.url ?? ''
        if (!rawUrl) continue

        const r = await insertJobPosting(ctx, {
          url: normalizeUrl(rawUrl),
          title,
          company: job.employer?.name ?? job.company ?? '',
          location: job.location ?? '',
          description: [keyword, job.jobDescription ?? job.description].filter(Boolean).join(' '),
          source: 'glassdoor-hasdata',
          publishedAt: job.listingDate ?? job.datePosted,
        })
        tally(result, r.status)
      }
    } catch (err) {
      console.error(`[HasData/Glassdoor] Error for "${keyword}":`, err instanceof Error ? err.message : err)
      tallyError(result, err)
    }
  }

  return result
}

async function pollHasData(ctx: ProcessorContext, req: Request): Promise<PollResult> {
  const apiKey = Deno.env.get('HASDATA_API_KEY')
  if (!apiKey) {
    console.log('[HasData] HASDATA_API_KEY not set — skipping')
    return emptyResult()
  }

  // Read platform from request body or URL query
  let platform: string | null = null
  try {
    const body = await req.clone().json().catch(() => null)
    if (body && typeof body.platform === 'string') platform = body.platform
  } catch { /* ignore */ }
  if (!platform) {
    const url = new URL(req.url)
    platform = url.searchParams.get('platform')
  }

  if (platform === 'indeed') return await pollIndeed(ctx, apiKey)
  if (platform === 'glassdoor') return await pollGlassdoor(ctx, apiKey)

  // No platform specified — run both
  const indeedResult = await pollIndeed(ctx, apiKey)
  const glassdoorResult = await pollGlassdoor(ctx, apiKey)
  return {
    inserted: indeedResult.inserted + glassdoorResult.inserted,
    deduped: indeedResult.deduped + glassdoorResult.deduped,
    blocked: indeedResult.blocked + glassdoorResult.blocked,
    skipped: indeedResult.skipped + glassdoorResult.skipped,
    apiErrors: indeedResult.apiErrors + glassdoorResult.apiErrors,
    lastError: glassdoorResult.lastError ?? indeedResult.lastError,
  }
}

Deno.serve(async (req) => {
  // Determine source_id from platform query/body
  let sourceId = 'hasdata-indeed'
  try {
    const cloned = req.clone()
    const body = await cloned.json().catch(() => null) as { platform?: string } | null
    if (body?.platform === 'glassdoor') sourceId = 'hasdata-glassdoor'
    else {
      const url = new URL(req.url)
      const p = url.searchParams.get('platform')
      if (p === 'glassdoor') sourceId = 'hasdata-glassdoor'
    }
  } catch { /* default to indeed */ }

  return await runPollHandler(sourceId, req, pollHasData)
})
