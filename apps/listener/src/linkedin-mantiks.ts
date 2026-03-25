// Source 1: Mantiks.io API — polling for LinkedIn job postings
// Docs: https://mantiks-api.readme.io/reference/getting-started-with-your-api
//
// Credit budget: 250 leads/month = 500 credits/month (1 lead = 2 credits)
// Strategy: poll once/week with job_age_in_days=7 → each job appears in exactly 1 poll
// No pagination — take first 50 results only → 4 polls × 50 leads × 2 = 400 credits/month

import https from 'https'
import { insertJobPosting, canonicalLinkedInUrl } from './processor'

const MANTIKS_BASE = 'api.mantiks.io'

// ─── Search config ────────────────────────────────────────────────────────────

const JOB_TITLE_KEYWORDS = [
  'product designer',
  'UX designer',
  'interaction designer',
]

// Exclude senior/management titles — simulates entry/mid-level filter (Mantiks has no native seniority param)
const JOB_TITLE_EXCLUDED = [
  'senior',
  'lead',
  'principal',
  'staff',
  'manager',
  'director',
  'head of',
  'vp',
]

// Single country-level location — covers all US jobs in one ID
const LOCATION_NAMES = ['United States']

// Cached location ID (populated on first poll, reused forever)
let locationIds: number[] = []

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function mantikGet(path: string, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: MANTIKS_BASE,
        path,
        method: 'GET',
        headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Mantiks HTTP ${res.statusCode}: ${data}`))
            return
          }
          try { resolve(JSON.parse(data)) } catch { reject(new Error(`Invalid JSON: ${data}`)) }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error('Timeout')) })
    req.end()
  })
}

// ─── Location ID resolution ───────────────────────────────────────────────────

async function resolveLocationIds(apiKey: string): Promise<number[]> {
  const ids: number[] = []
  for (const name of LOCATION_NAMES) {
    try {
      const data = await mantikGet(`/location/search?name=${encodeURIComponent(name)}`, apiKey)
      const results: Array<{ id: number; name: string; country: string; type: string }> = data.results ?? []
      // Prefer country-level entry for broader coverage
      const country = results.find((r) => r.type === 'country')
      const match = country ?? results.find((r) => r.country === 'United States') ?? results[0]
      if (match) {
        ids.push(match.id)
        console.log(`  [Mantiks] Location "${name}" → id ${match.id} (${match.type ?? 'unknown'})`)
      } else {
        console.warn(`  [Mantiks] No location found for "${name}"`)
      }
    } catch (err) {
      console.warn(`  [Mantiks] Location lookup failed for "${name}":`, err instanceof Error ? err.message : err)
    }
  }
  return ids
}

// ─── Mantiks response types ───────────────────────────────────────────────────

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

// ─── Poll ─────────────────────────────────────────────────────────────────────

export let lastMantikPollAt = 0

export async function pollMantiks(): Promise<void> {
  const apiKey = process.env.MANTIKS_API_KEY
  if (!apiKey) {
    console.log('  [Mantiks] MANTIKS_API_KEY not set — skipping')
    return
  }

  // Resolve location ID once per process lifetime
  if (locationIds.length === 0) {
    locationIds = await resolveLocationIds(apiKey)
  }
  if (locationIds.length === 0) {
    console.warn('  [Mantiks] Could not resolve location ID — aborting poll')
    return
  }

  console.log('🔵 Mantiks poll starting...')
  let totalProcessed = 0

  // Single page only — no pagination.
  // Polling every 7 days with job_age_in_days=7 means zero overlap between polls.
  // Taking 50 results max keeps us within budget (4 polls × 50 leads × 2 credits = 400/month).
  const params = new URLSearchParams()
  params.set('job_age_in_days', '7')
  params.set('job_board', 'linkedin')
  params.set('limit', '50')
  JOB_TITLE_KEYWORDS.forEach((k) => params.append('job_title', k))
  JOB_TITLE_EXCLUDED.forEach((k) => params.append('job_title_excluded', k))
  locationIds.forEach((id) => params.append('job_location_ids', String(id)))

  let data: { companies?: MantikCompany[]; credits_remaining?: number }
  try {
    data = await mantikGet(`/company/search?${params}`, apiKey)
  } catch (err) {
    console.error('  [Mantiks] Search error:', err instanceof Error ? err.message : err)
    return
  }

  if (data.credits_remaining !== undefined) {
    console.log(`  [Mantiks] Credits remaining: ${data.credits_remaining}`)
    if (data.credits_remaining < 50) {
      console.warn(`⚠️  [Mantiks] Low credits (${data.credits_remaining}) — skipping insert to preserve budget`)
      return
    }
  }

  for (const company of data.companies ?? []) {
    for (const job of company.jobs ?? []) {
      const rawUrl = job.linkedin_apply_url ?? job.job_board_url ?? ''
      if (!rawUrl) continue
      await insertJobPosting({
        url: canonicalLinkedInUrl(rawUrl),
        title: job.job_title ?? '',
        company: company.name ?? '',
        location: job.location ?? '',
        description: job.description ?? '',
        source: 'linkedin-mantiks',
        publishedAt: job.date_creation,
      })
      totalProcessed++
    }
  }

  lastMantikPollAt = Date.now()
  console.log(`✅ Mantiks poll complete (${totalProcessed} jobs processed)`)
}

// ─── DataSource registration ──────────────────────────────────────────────────

import { registerSource } from './sources/registry'
import { createHealth, withHealthTracking, type DataSource } from './sources/types'

const mantikHealth = createHealth()

export const mantikSource: DataSource = {
  id: 'linkedin-mantiks',
  name: 'Mantiks (LinkedIn)',
  type: 'poll',
  schedule: 'Weekly (every 7 days)',
  cost: '~400 credits/month',
  envVars: ['MANTIKS_API_KEY'],
  triggerPath: '/poll/mantiks',
  health: mantikHealth,
  poll: withHealthTracking(mantikHealth, pollMantiks),
}

registerSource(mantikSource)
