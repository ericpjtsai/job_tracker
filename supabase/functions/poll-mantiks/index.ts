// poll-mantiks — Mantiks.io LinkedIn job search API
// PORTED from apps/listener/src/linkedin-mantiks.ts
// Weekly cron. Re-resolves location ID once per invocation (cheap).
// Budget: 4 polls/month × 50 leads × 2 credits = 400/month.

import { runPollHandler, emptyResult, tally, tallyError, type PollResult } from '../_shared/handler.ts'
import { insertJobPosting, canonicalLinkedInUrl, type ProcessorContext } from '../_shared/processor.ts'

const MANTIKS_BASE = 'https://api.mantiks.io'

const JOB_TITLE_KEYWORDS = ['product designer', 'UX designer', 'interaction designer']
const JOB_TITLE_EXCLUDED = ['senior', 'lead', 'principal', 'staff', 'manager', 'director', 'head of', 'vp']
const LOCATION_NAMES = ['United States']

interface MantikJob {
  job_title?: string
  description?: string
  location?: string
  date_creation?: string
  job_board_url?: string
  linkedin_apply_url?: string
}

interface MantikCompany {
  name?: string
  jobs?: MantikJob[]
}

async function mantikGet(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${MANTIKS_BASE}${path}`, {
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Mantiks HTTP ${res.status}: ${text}`)
  }
  return await res.json()
}

async function resolveLocationIds(apiKey: string): Promise<number[]> {
  const ids: number[] = []
  for (const name of LOCATION_NAMES) {
    try {
      const data = (await mantikGet(
        `/location/search?name=${encodeURIComponent(name)}`,
        apiKey,
      )) as { results?: Array<{ id: number; name: string; country: string; type: string }> }
      const results = data.results ?? []
      const country = results.find((r) => r.type === 'country')
      const match = country ?? results.find((r) => r.country === 'United States') ?? results[0]
      if (match) {
        ids.push(match.id)
        console.log(`[Mantiks] Location "${name}" → id ${match.id} (${match.type})`)
      } else {
        console.warn(`[Mantiks] No location found for "${name}"`)
      }
    } catch (err) {
      console.warn(`[Mantiks] Location lookup failed for "${name}":`, err instanceof Error ? err.message : err)
    }
  }
  return ids
}

async function pollMantiks(ctx: ProcessorContext): Promise<PollResult> {
  const apiKey = Deno.env.get('MANTIKS_API_KEY')
  if (!apiKey) {
    console.log('[Mantiks] MANTIKS_API_KEY not set — skipping')
    return emptyResult()
  }

  const result = emptyResult()

  const locationIds = await resolveLocationIds(apiKey)
  if (locationIds.length === 0) {
    console.warn('[Mantiks] Could not resolve location ID — aborting poll')
    tallyError(result, new Error('Could not resolve location ID (likely auth/credit failure on /location/search)'))
    return result
  }

  console.log('[Mantiks] poll starting...')

  const params = new URLSearchParams()
  params.set('job_age_in_days', '7')
  params.set('job_board', 'linkedin')
  params.set('limit', '50')
  JOB_TITLE_KEYWORDS.forEach((k) => params.append('job_title', k))
  JOB_TITLE_EXCLUDED.forEach((k) => params.append('job_title_excluded', k))
  locationIds.forEach((id) => params.append('job_location_ids', String(id)))

  let data: { companies?: MantikCompany[]; credits_remaining?: number }
  try {
    data = (await mantikGet(`/company/search?${params}`, apiKey)) as typeof data
  } catch (err) {
    console.error('[Mantiks] Search error:', err instanceof Error ? err.message : err)
    tallyError(result, err)
    return result
  }

  if (data.credits_remaining !== undefined) {
    console.log(`[Mantiks] Credits remaining: ${data.credits_remaining}`)
    if (data.credits_remaining < 50) {
      console.warn(`[Mantiks] Low credits (${data.credits_remaining}) — skipping insert to preserve budget`)
      tallyError(result, new Error(`Low credits: ${data.credits_remaining} remaining`))
      return result
    }
  }

  for (const company of data.companies ?? []) {
    for (const job of company.jobs ?? []) {
      const rawUrl = job.linkedin_apply_url ?? job.job_board_url ?? ''
      if (!rawUrl) continue
      const r = await insertJobPosting(ctx, {
        url: canonicalLinkedInUrl(rawUrl),
        title: job.job_title ?? '',
        company: company.name ?? '',
        location: job.location ?? '',
        description: job.description ?? '',
        source: 'linkedin-mantiks',
        publishedAt: job.date_creation,
      })
      tally(result, r.status)
    }
  }

  console.log(`[Mantiks] Done — inserted=${result.inserted}`)
  return result
}

Deno.serve((req) => runPollHandler('mantiks', req, pollMantiks))
