// Source 3: SerpApi Google Jobs — weekly validation layer
// Finds LinkedIn jobs via Google Jobs index; flags coverage gaps vs other sources
// Free tier: 100 searches/month → run 4 queries/week = ~17/month

import https from 'https'
import { insertJobPosting, canonicalLinkedInUrl, normalizeUrl, sha256 } from './processor'
import { createClient } from '@supabase/supabase-js'

// Target ATS job boards directly — catches jobs that Firehose/Mantiks miss
// Free tier: 100 searches/month → 4 queries/week = ~17/month
const SERPAPI_QUERIES = [
  '"product designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com "B2B" OR "enterprise"',
  '"UX designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com "B2B" OR "SaaS"',
  '"interaction designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com',
  '"design engineer" site:greenhouse.io OR site:ashbyhq.com OR site:lever.co',
]

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'JobTracker/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpsGet(res.headers.location!))
      }
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ─── SerpApi result types ─────────────────────────────────────────────────────

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

// ─── Supabase client (for coverage-gap check) ─────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

export async function pollSerpApi(): Promise<number> {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    console.log('  [SerpApi] SERPAPI_API_KEY not set — skipping')
    return 0
  }

  console.log('🔍 SerpApi Google Jobs poll starting...')
  const supabase = getSupabase()
  let totalProcessed = 0

  for (const query of SERPAPI_QUERIES) {
    try {
      const params = new URLSearchParams({
        engine: 'google_jobs',
        q: query,
        api_key: apiKey,
        num: '10',
      })
      const raw = await httpsGet(`https://serpapi.com/search?${params}`)
      const data: SerpApiResponse = JSON.parse(raw)

      if (data.error) {
        console.warn(`  [SerpApi] API error for "${query}": ${data.error}`)
        continue
      }

      for (const job of data.jobs_results ?? []) {
        // Prefer direct ATS link (greenhouse/lever/ashby), then LinkedIn, then skip
        const atsLink = job.apply_options?.find((o) =>
          o.link && /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com/.test(o.link)
        )?.link ?? ''
        const linkedinLink = job.apply_options?.find((o) =>
          o.link?.includes('linkedin.com/jobs')
        )?.link ?? ''

        const rawUrl = atsLink || linkedinLink
        if (!rawUrl) continue

        const url = linkedinLink && !atsLink ? canonicalLinkedInUrl(linkedinLink) : normalizeUrl(rawUrl)
        const urlHash = sha256(url)

        // Coverage gap check — log if this job isn't in our DB yet
        const { data: existing } = await supabase
          .from('job_postings')
          .select('id')
          .eq('url_hash', urlHash)
          .maybeSingle()

        if (!existing) {
          console.log(`🔍 [SERPAPI NEW] ${job.title} — ${job.company_name} | ${url}`)
        }

        await insertJobPosting({
          url,
          title: job.title ?? '',
          company: job.company_name ?? '',
          location: job.location ?? '',
          description: job.description ?? '',
          source: 'linkedin-serpapi',
          publishedAt: undefined,
        })
        totalProcessed++
      }
    } catch (err) {
      console.error(`  [SerpApi] Error for "${query}":`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`✅ SerpApi poll complete (${totalProcessed} jobs processed)`)
  return totalProcessed
}

// ─── DataSource registration ──────────────────────────────────────────────────

import { registerSource } from './sources/registry'
import { createHealth, withHealthTracking, type DataSource } from './sources/types'

const serpApiHealth = createHealth()

export const serpApiSource: DataSource = {
  id: 'serpapi',
  name: 'SerpApi (Google Jobs)',
  type: 'poll',
  schedule: '2x daily (6am & 6pm)',
  cost: 'Free tier (100/month)',
  envVars: ['SERPAPI_API_KEY'],
  triggerPath: '/poll/serpapi',
  health: serpApiHealth,
  poll: withHealthTracking(serpApiHealth, pollSerpApi),
}

registerSource(serpApiSource)
