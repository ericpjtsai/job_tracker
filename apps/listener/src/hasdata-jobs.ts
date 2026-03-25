// Source: HasData API — Indeed + Glassdoor job search
// Docs: https://docs.hasdata.com/apis/indeed/listing
//       https://docs.hasdata.com/apis/glassdoor/listing
//
// Cost: 5 credits per request
// 3 keywords × 2 platforms = 6 requests per poll = 30 credits per trigger

import https from 'https'
import { insertJobPosting, normalizeUrl, sha256 } from './processor'
import { createClient } from '@supabase/supabase-js'

const HASDATA_BASE = 'api.hasdata.com'

const JOB_KEYWORDS = [
  'product designer',
  'UX designer',
  'interaction designer',
]

// Only accept titles that mention design — blocks sponsored/non-job content from listing API
const DESIGN_TITLE = /\b(designer|design|UX|UI|interaction|visual|product)\b/i

// ─── Supabase client (for coverage-gap check) ─────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

// ─── Response types ───────────────────────────────────────────────────────────

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

interface HasDataIndeedResponse {
  jobs?: HasDataIndeedJob[]
  jobResults?: HasDataIndeedJob[]
  results?: HasDataIndeedJob[]
  error?: string
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

interface HasDataGlassdoorResponse {
  jobs?: HasDataGlassdoorJob[]
  jobListings?: HasDataGlassdoorJob[]
  results?: HasDataGlassdoorJob[]
  error?: string
}

// ─── HTTP helper with x-api-key header ───────────────────────────────────────

function hasDataGet(path: string, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: HASDATA_BASE,
        path,
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HasData HTTP ${res.statusCode}: ${data}`))
            return
          }
          try { resolve(JSON.parse(data)) } catch { reject(new Error(`Invalid JSON: ${data}`)) }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Timeout')) })
    req.end()
  })
}

// ─── Indeed ───────────────────────────────────────────────────────────────────

export async function pollIndeed(): Promise<void> {
  const apiKey = process.env.HASDATA_API_KEY
  if (!apiKey) {
    console.log('  [HasData/Indeed] HASDATA_API_KEY not set — skipping')
    return
  }

  console.log('🟡 HasData Indeed poll starting...')
  const supabase = getSupabase()
  let totalNew = 0

  for (const keyword of JOB_KEYWORDS) {
    try {
      const params = new URLSearchParams({
        keyword,
        location: 'United States',
        sort: 'date',
        domain: 'www.indeed.com',
      })
      const rawData = await hasDataGet(`/scrape/indeed/listing?${params}`, apiKey)
      const data: HasDataIndeedResponse = rawData

      if (data.error) {
        console.warn(`  [HasData/Indeed] API error for "${keyword}": ${data.error}`)
        continue
      }

      const jobs = data.jobs ?? data.jobResults ?? data.results ?? []

      if (jobs.length === 0) {
        console.warn(`  [HasData/Indeed] No jobs for "${keyword}" — response keys: ${Object.keys(data).join(', ')}`)
      }

      for (const job of jobs) {
        const title = job.title ?? job.jobTitle ?? ''

        // Block non-job content (sponsored listings, product pages, etc.)
        if (!DESIGN_TITLE.test(title)) {
          console.log(`  ↷ [Indeed] Non-design title skipped: ${title}`)
          continue
        }

        const rawUrl = job.url ?? job.jobUrl ?? job.link ?? ''
        if (!rawUrl) continue

        const url = normalizeUrl(rawUrl)
        const urlHash = sha256(url)

        const { data: existing } = await supabase
          .from('job_postings')
          .select('id')
          .eq('url_hash', urlHash)
          .maybeSingle()

        if (!existing) {
          const company = job.company ?? job.companyName ?? ''
          console.log(`🟡 [INDEED NEW] ${title} — ${company} | ${url}`)
          totalNew++
        }

        await insertJobPosting({
          url,
          title,
          company: job.company ?? job.companyName ?? '',
          location: job.location ?? '',
          description: [keyword, job.description ?? job.snippet].filter(Boolean).join(' '),
          source: 'indeed-hasdata',
          publishedAt: job.datePosted ?? job.date,
        })
      }
    } catch (err) {
      console.error(`  [HasData/Indeed] Error for "${keyword}":`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`✅ HasData Indeed poll complete (${totalNew} new jobs)`)
}

// ─── Glassdoor ────────────────────────────────────────────────────────────────

export async function pollGlassdoor(): Promise<void> {
  const apiKey = process.env.HASDATA_API_KEY
  if (!apiKey) {
    console.log('  [HasData/Glassdoor] HASDATA_API_KEY not set — skipping')
    return
  }

  console.log('🟡 HasData Glassdoor poll starting...')
  const supabase = getSupabase()
  let totalNew = 0

  for (const keyword of JOB_KEYWORDS) {
    try {
      const params = new URLSearchParams({
        keyword,
        location: 'United States',
        sort: 'recent',
        domain: 'www.glassdoor.com',
      })
      const rawData = await hasDataGet(`/scrape/glassdoor/listing?${params}`, apiKey)
      const data: HasDataGlassdoorResponse = rawData

      if (data.error) {
        console.warn(`  [HasData/Glassdoor] API error for "${keyword}": ${data.error}`)
        continue
      }

      const jobs = data.jobs ?? data.jobListings ?? data.results ?? []

      if (jobs.length === 0) {
        console.warn(`  [HasData/Glassdoor] No jobs for "${keyword}" — response keys: ${Object.keys(data).join(', ')}`)
      }

      for (const job of jobs) {
        const title = job.jobTitle ?? job.title ?? ''

        // Block non-job content (sponsored listings, product pages, etc.)
        if (!DESIGN_TITLE.test(title)) {
          console.log(`  ↷ [Glassdoor] Non-design title skipped: ${title}`)
          continue
        }

        const rawUrl = job.jobListingUrl ?? job.url ?? ''
        if (!rawUrl) continue

        const url = normalizeUrl(rawUrl)
        const urlHash = sha256(url)

        const { data: existing } = await supabase
          .from('job_postings')
          .select('id')
          .eq('url_hash', urlHash)
          .maybeSingle()

        if (!existing) {
          const company = job.employer?.name ?? job.company ?? ''
          console.log(`🟡 [GLASSDOOR NEW] ${title} — ${company} | ${url}`)
          totalNew++
        }

        await insertJobPosting({
          url,
          title,
          company: job.employer?.name ?? job.company ?? '',
          location: job.location ?? '',
          description: [keyword, job.jobDescription ?? job.description].filter(Boolean).join(' '),
          source: 'glassdoor-hasdata',
          publishedAt: job.listingDate ?? job.datePosted,
        })
      }
    } catch (err) {
      console.error(`  [HasData/Glassdoor] Error for "${keyword}":`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`✅ HasData Glassdoor poll complete (${totalNew} new jobs)`)
}

// ─── DataSource registration ──────────────────────────────────────────────────

import { registerSource } from './sources/registry'
import { createHealth, withHealthTracking, type DataSource } from './sources/types'

const indeedHealth = createHealth()

export const indeedSource: DataSource = {
  id: 'indeed',
  name: 'HasData (Indeed)',
  type: 'poll',
  schedule: '2x daily (6am & 6pm)',
  cost: '15 credits/poll',
  envVars: ['HASDATA_API_KEY'],
  triggerPath: '/poll/indeed',
  health: indeedHealth,
  poll: withHealthTracking(indeedHealth, pollIndeed),
}

const glassdoorHealth = createHealth()

export const glassdoorSource: DataSource = {
  id: 'glassdoor',
  name: 'HasData (Glassdoor)',
  type: 'poll',
  schedule: '2x daily (6am & 6pm)',
  cost: '15 credits/poll',
  envVars: ['HASDATA_API_KEY'],
  triggerPath: '/poll/glassdoor',
  health: glassdoorHealth,
  poll: withHealthTracking(glassdoorHealth, pollGlassdoor),
}

registerSource(indeedSource)
registerSource(glassdoorSource)
