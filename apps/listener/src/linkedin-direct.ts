// Source 4: Direct LinkedIn public page scraper — emergency fallback only
// Activated by fallback logic in index.ts when Sources 1+2 are both down
// Max 10 requests/day, random delays 30–120s, rotated User-Agent

import https from 'https'
import { parse } from 'node-html-parser'
import { insertJobPosting, canonicalLinkedInUrl } from './processor'

const QUERIES = [
  'product designer B2B',
  'UX designer enterprise',
  'product designer AI',
  'interaction designer SaaS',
]

const LOCATIONS = ['San Francisco', 'Seattle', 'New York', 'Remote']

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

function randomAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function randomDelay(): Promise<void> {
  const ms = 30_000 + Math.random() * 90_000 // 30–120s
  return sleep(ms)
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': randomAgent(),
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpsGet(res.headers.location!))
      }
      if (res.statusCode === 429) {
        return reject(new Error('Rate limited (429)'))
      }
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ─── Poll (max 10 requests per invocation) ────────────────────────────────────

export async function pollLinkedInDirect(): Promise<void> {
  console.log('⚠️  [LinkedIn Direct] Emergency fallback scraper activated')
  let requestCount = 0
  const MAX_REQUESTS = 10

  for (const query of QUERIES) {
    for (const location of LOCATIONS) {
      if (requestCount >= MAX_REQUESTS) break

      const url = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&f_TPR=r86400&position=1&pageNum=0`

      try {
        const html = await httpsGet(url)
        requestCount++

        const root = parse(html)
        const cards = root.querySelectorAll('.base-card, [data-entity-urn]')

        for (const card of cards) {
          const titleEl = card.querySelector('.base-search-card__title, h3')
          const companyEl = card.querySelector('.base-search-card__subtitle, h4')
          const locationEl = card.querySelector('.job-search-card__location')
          const linkEl = card.querySelector('a[href*="linkedin.com/jobs/view"]')

          const title = titleEl?.text.trim() ?? ''
          const company = companyEl?.text.trim() ?? ''
          const jobLocation = locationEl?.text.trim() ?? location
          const href = linkEl?.getAttribute('href') ?? ''

          if (!title || !href) continue

          await insertJobPosting({
            url: canonicalLinkedInUrl(href),
            title,
            company,
            location: jobLocation,
            description: `[Incomplete — direct scrape] ${title} at ${company}`,
            source: 'linkedin-direct',
          })
        }

        console.log(`  [LinkedIn Direct] ${query} @ ${location}: ${cards.length} cards found`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`  [LinkedIn Direct] Failed for "${query}" @ ${location}: ${msg}`)
        if (msg.includes('Rate limited')) break
      }

      if (requestCount < MAX_REQUESTS) await randomDelay()
    }
    if (requestCount >= MAX_REQUESTS) break
  }

  console.log(`✅ LinkedIn Direct complete (${requestCount} requests made)`)
}

// ─── DataSource registration ──────────────────────────────────────────────────

import { registerSource } from './sources/registry'
import { createHealth, withHealthTracking, type DataSource } from './sources/types'

const directHealth = createHealth()

export const linkedinDirectSource: DataSource = {
  id: 'linkedin-direct',
  name: 'LinkedIn Direct (Fallback)',
  type: 'poll',
  schedule: 'Emergency only',
  cost: 'Free',
  envVars: [],
  triggerPath: '/poll/linkedin-direct',
  health: directHealth,
  poll: withHealthTracking(directHealth, pollLinkedInDirect),
}

registerSource(linkedinDirectSource)
