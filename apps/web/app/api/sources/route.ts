// /api/sources — replaces the listener daemon's /sources control endpoint.
//
// GET reads source_health from Postgres directly + counts jobs by firehose_rule.
// POST translates a triggerPath (still used by the existing Sources page UI) into
// the corresponding Edge Function call.
//
// SECURITY: server-side only. Browser → /api/sources → Edge Function (with service-role key).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// ─── Static source registry ─────────────────────────────────────────────────
// Mirror of what the listener used to expose at /sources. Source IDs match the
// front-end Sources page. The `source_health.source_id` column may differ — see
// HEALTH_KEY below for that mapping.

interface SourceMeta {
  id: string                 // matches front-end Source.id
  healthKey: string          // matches source_health.source_id
  name: string
  type: 'poll' | 'stream'
  schedule: string
  cost: string | null
  envVars: string[]
  triggerPath: string | null
}

const SOURCES: SourceMeta[] = [
  { id: 'ats',             healthKey: 'ats',                name: 'ATS Direct Polling',     type: 'poll', schedule: 'Every hour (4 batches × 15min)', cost: 'Free (public APIs)', envVars: [],                  triggerPath: '/poll' },
  { id: 'linkedin-mantiks',healthKey: 'mantiks',            name: 'Mantiks (LinkedIn)',      type: 'poll', schedule: 'Weekly (Mon 6am UTC)',           cost: '~400 credits/month', envVars: ['MANTIKS_API_KEY'], triggerPath: '/poll/mantiks' },
  { id: 'linkedin-scraper',healthKey: 'linkedin',           name: 'LinkedIn Scraper',         type: 'poll', schedule: '2x daily (6am & 6pm)',            cost: 'Free',               envVars: [],                  triggerPath: '/poll/linkedin' },
  { id: 'serpapi',         healthKey: 'serpapi',            name: 'SerpApi (Google Jobs)',    type: 'poll', schedule: '2x daily (6:05am & 6:05pm)',      cost: 'Free tier',          envVars: ['SERPAPI_API_KEY'], triggerPath: '/poll/serpapi' },
  { id: 'indeed',          healthKey: 'hasdata-indeed',     name: 'HasData (Indeed)',         type: 'poll', schedule: '2x daily (6:10am & 6:10pm)',      cost: '15 credits/poll',    envVars: ['HASDATA_API_KEY'], triggerPath: '/poll/indeed' },
  { id: 'glassdoor',       healthKey: 'hasdata-glassdoor',  name: 'HasData (Glassdoor)',      type: 'poll', schedule: '2x daily (6:12am & 6:12pm)',      cost: '15 credits/poll',    envVars: ['HASDATA_API_KEY'], triggerPath: '/poll/glassdoor' },
  { id: 'linkedin-direct', healthKey: 'linkedin-direct',    name: 'LinkedIn Direct (Fallback)',type: 'poll',schedule: 'Emergency only (auto)',            cost: 'Free',               envVars: [],                  triggerPath: null },
  { id: 'github-jobs',     healthKey: 'github',             name: 'GitHub Jobright Repos',    type: 'poll', schedule: '2x daily (7am & 7pm UTC)',         cost: 'Free',               envVars: [],                  triggerPath: '/poll/github' },
]

// firehose_rule → source.id mapping for historicalCounts
const RULE_TO_SOURCE: Record<string, string> = {
  'linkedin-scraper':     'linkedin-scraper',
  'linkedin-mantiks':     'linkedin-mantiks',
  'linkedin-direct':      'linkedin-direct',
  'glassdoor-hasdata':    'glassdoor',
  'indeed-hasdata':       'indeed',
  'serpapi':              'serpapi',
  'github-design-newgrad':'github-jobs',
  'github-h1b-design':    'github-jobs',
  'manual-import':        'manual',
  'greenhouse':           'ats',
  'lever':                'ats',
  'ashby':                'ats',
  'smartrecruiters':      'ats',
}

// triggerPath → Edge Function dispatch
function dispatchTrigger(triggerPath: string): { fn: string; body?: unknown } | null {
  switch (triggerPath) {
    case '/poll':                return { fn: 'poll-ats',             body: { batch: 0 } }
    case '/poll/mantiks':        return { fn: 'poll-mantiks' }
    case '/poll/linkedin':       return { fn: 'poll-linkedin' }
    case '/poll/linkedin-direct':return { fn: 'poll-linkedin-direct' }
    case '/poll/serpapi':        return { fn: 'poll-serpapi' }
    case '/poll/indeed':         return { fn: 'poll-hasdata',         body: { platform: 'indeed' } }
    case '/poll/glassdoor':      return { fn: 'poll-hasdata',         body: { platform: 'glassdoor' } }
    case '/poll/github':         return { fn: 'poll-github' }
    default:                     return null
  }
}

// ─── GET ────────────────────────────────────────────────────────────────────

interface SourceHealthRow {
  source_id: string
  status: string
  last_poll_at: string | null
  last_error_at: string | null
  last_error: string | null
  consecutive_failures: number
  jobs_found_total: number
  jobs_found_last: number
}

async function getHistoricalCounts(): Promise<Record<string, number>> {
  try {
    const supabase = createServerClient()
    const { data } = await supabase.from('job_postings').select('firehose_rule')
    if (!data) return {}
    const counts: Record<string, number> = {}
    for (const row of data as { firehose_rule: string | null }[]) {
      const rule = row.firehose_rule || ''
      const sourceId = RULE_TO_SOURCE[rule] || 'other'
      counts[sourceId] = (counts[sourceId] || 0) + 1
    }
    return counts
  } catch {
    return {}
  }
}

export async function GET(req: NextRequest) {
  // ?light=1 — homepage variant. Skips getHistoricalCounts() (a full table
  // scan of every job_postings row) and only returns the source health array.
  // The full /sources page omits ?light=1 to get historicalCounts.
  const light = req.nextUrl.searchParams.get('light') === '1'

  try {
    const supabase = createServerClient()
    const [healthRes, historicalCounts] = await Promise.all([
      supabase
        .from('source_health')
        .select('source_id, status, last_poll_at, last_error_at, last_error, consecutive_failures, jobs_found_total, jobs_found_last'),
      light ? Promise.resolve({} as Record<string, number>) : getHistoricalCounts(),
    ])

    const healthBySource: Record<string, SourceHealthRow> = {}
    for (const row of (healthRes.data ?? []) as SourceHealthRow[]) {
      healthBySource[row.source_id] = row
    }

    // Merge static metadata with live health into the shape the front-end expects.
    // The page expects `health.lastPollAt` as a number (timestamp ms) so we convert.
    const sources = SOURCES.map((meta) => {
      const h = healthBySource[meta.healthKey]
      return {
        id: meta.id,
        name: meta.name,
        type: meta.type,
        schedule: meta.schedule,
        cost: meta.cost,
        envVars: meta.envVars,
        triggerPath: meta.triggerPath,
        health: {
          status: h?.status ?? 'idle',
          lastPollAt: h?.last_poll_at ? new Date(h.last_poll_at).getTime() : null,
          lastErrorAt: h?.last_error_at ? new Date(h.last_error_at).getTime() : null,
          lastError: h?.last_error ?? null,
          jobsFound: h?.jobs_found_total ?? 0,
          consecutiveFailures: h?.consecutive_failures ?? 0,
        },
      }
    })

    // Light variant changes only when polls run (~hourly) — long cache is safe.
    // Heavy variant has historicalCounts which can change every minute as new
    // jobs are ingested, so keep its TTL short.
    const cacheControl = light
      ? 'private, max-age=60, stale-while-revalidate=300'
      : 'private, max-age=5, stale-while-revalidate=15'

    return NextResponse.json(
      { sources, historicalCounts },
      { headers: { 'Cache-Control': cacheControl } },
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown', sources: [], historicalCounts: {} },
      { status: 500 },
    )
  }
}

// ─── POST ───────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 })
  }
  try {
    const { triggerPath } = await request.json()
    if (!triggerPath) return NextResponse.json({ error: 'Missing triggerPath' }, { status: 400 })

    const target = dispatchTrigger(triggerPath)
    if (!target) {
      return NextResponse.json({ error: `Unknown triggerPath: ${triggerPath}` }, { status: 400 })
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${target.fn}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(target.body ?? {}),
    })
    const data = await res.json().catch(() => ({ ok: false }))
    return NextResponse.json(data, { status: res.ok ? 200 : 502 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}
