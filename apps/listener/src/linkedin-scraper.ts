// Source 2: linkedin-jobs-api npm scraper — runs every 12h (or 6h as fallback)
// https://github.com/VishwaGauravIn/linkedin-jobs-api

import { insertJobPosting, canonicalLinkedInUrl, extractLocation } from './processor'

const QUERIES = [
  'product designer B2B',
  'UX designer enterprise',
  'product designer AI',
  'interaction designer SaaS',
]

const LOCATIONS = ['San Francisco', 'Seattle', 'New York', 'Remote']

// ─── Health tracking ──────────────────────────────────────────────────────────

export const scraperStatus = { running: false, consecutiveFailures: 0, lastSuccess: 0 }

// ─── Poll ─────────────────────────────────────────────────────────────────────

export async function pollLinkedIn(): Promise<void> {
  if (scraperStatus.running) {
    console.log('⚠️  LinkedIn scraper already running, skipping')
    return
  }

  let linkedInAPI: any
  try {
    linkedInAPI = await import('linkedin-jobs-api')
  } catch {
    console.error('  [LinkedIn Scraper] linkedin-jobs-api not installed')
    scraperStatus.consecutiveFailures++
    return
  }

  scraperStatus.running = true
  let batchFailures = 0
  let totalInserted = 0

  for (const query of QUERIES) {
    for (const location of LOCATIONS) {
      try {
        const results = await linkedInAPI.query({
          keyword: query,
          location,
          dateSincePosted: 'past Week',
          jobType: 'full time',
          remoteFilter: location === 'Remote' ? 'remote' : '',
          salary: '',
          experienceLevel: '',
          limit: '25',
        })

        for (const job of results ?? []) {
          const url = canonicalLinkedInUrl(job.jobUrl ?? '')
          if (!url) continue

          await insertJobPosting({
            url,
            title: job.position ?? '',
            company: job.company ?? '',
            location: job.location ?? location,
            description: job.description ?? extractLocation(job.position ?? ''),
            source: 'linkedin-scraper',
            publishedAt: job.agoTime ? undefined : undefined,
          })
          totalInserted++
        }
      } catch (err) {
        batchFailures++
      }
    }
  }

  scraperStatus.running = false

  if (batchFailures > 0 && totalInserted === 0) {
    scraperStatus.consecutiveFailures++
    if (scraperStatus.consecutiveFailures >= 3) {
      console.warn(`⚠️  LinkedIn scraper: ${scraperStatus.consecutiveFailures} consecutive failures — LinkedIn may have changed its frontend`)
    }
  } else {
    scraperStatus.consecutiveFailures = 0
    scraperStatus.lastSuccess = Date.now()
    console.log(`✅ LinkedIn scraper complete (${totalInserted} jobs processed across ${QUERIES.length * LOCATIONS.length} queries)`)
  }
}

// ─── DataSource registration ──────────────────────────────────────────────────

import { registerSource } from './sources/registry'
import { createHealth, withHealthTracking, type DataSource } from './sources/types'

const scraperHealth = createHealth()

export const scraperSource: DataSource = {
  id: 'linkedin-scraper',
  name: 'LinkedIn Scraper (npm)',
  type: 'poll',
  schedule: '2x daily (6am & 6pm)',
  cost: 'Free',
  envVars: [],
  triggerPath: '/poll/linkedin',
  health: scraperHealth,
  poll: withHealthTracking(scraperHealth, pollLinkedIn),
}

registerSource(scraperSource)
