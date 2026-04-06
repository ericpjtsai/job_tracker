// poll-linkedin — replacement for the linkedin-jobs-api npm scraper
// PORTED from apps/listener/src/linkedin-scraper.ts but rewritten without the npm package.
//
// The original `linkedin-jobs-api` package is pure HTTP (axios + cheerio) — it queries
// the public `seeMoreJobPostings` endpoint and parses the returned HTML cards. This
// function does the same thing using `fetch` + `node-html-parser`.
//
// The endpoint is unauthenticated but rate-limited and occasionally requires UA rotation.
// We mirror the UA list from poll-linkedin-direct.

import { parse } from 'npm:node-html-parser@7.1.0'
import { runPollHandler, emptyResult, tally, tallyError, type PollResult } from '../_shared/handler.ts'
import { insertJobPosting, canonicalLinkedInUrl, type ProcessorContext } from '../_shared/processor.ts'

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

interface ScrapedJob {
  title: string
  company: string
  location: string
  url: string
}

/**
 * Build the LinkedIn public guest API URL.
 * Same endpoint the linkedin-jobs-api package hits internally.
 */
function buildSearchUrl(keyword: string, location: string, dateFilter: string): string {
  // f_TPR=r604800 = posted in the last week (matches dateSincePosted='past Week')
  const params = new URLSearchParams({
    keywords: keyword,
    location,
    f_TPR: dateFilter,
    position: '1',
    pageNum: '0',
  })
  if (location === 'Remote') {
    params.set('f_WT', '2') // remote work-type filter
  }
  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`
}

async function fetchSearchResults(url: string): Promise<ScrapedJob[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })

  if (res.status === 429) throw new Error('Rate limited (429)')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const html = await res.text()
  const root = parse(html)

  // The seeMoreJobPostings endpoint returns a list of <li> elements wrapping job cards.
  const cards = root.querySelectorAll('li, .base-card, [data-entity-urn]')
  const jobs: ScrapedJob[] = []
  const seen = new Set<string>()

  for (const card of cards) {
    const titleEl = card.querySelector('.base-search-card__title, h3.base-search-card__title')
    const companyEl = card.querySelector('.base-search-card__subtitle, h4.base-search-card__subtitle, a.hidden-nested-link')
    const locationEl = card.querySelector('.job-search-card__location')
    const linkEl = card.querySelector('a.base-card__full-link, a[href*="linkedin.com/jobs/view"]')

    const title = titleEl?.text.trim() ?? ''
    const company = companyEl?.text.trim() ?? ''
    const location = locationEl?.text.trim() ?? ''
    const href = linkEl?.getAttribute('href') ?? ''

    if (!title || !href) continue
    if (seen.has(href)) continue
    seen.add(href)

    jobs.push({ title, company, location, url: href })
  }

  return jobs
}

async function pollLinkedIn(ctx: ProcessorContext): Promise<PollResult> {
  const result = emptyResult()
  console.log('[LinkedIn] poll starting...')

  let consecutiveBlocks = 0

  for (const query of QUERIES) {
    for (const location of LOCATIONS) {
      const url = buildSearchUrl(query, location, 'r604800')

      try {
        const jobs = await fetchSearchResults(url)
        console.log(`[LinkedIn] ${query} @ ${location}: ${jobs.length} cards`)
        consecutiveBlocks = 0

        for (const job of jobs) {
          const r = await insertJobPosting(ctx, {
            url: canonicalLinkedInUrl(job.url),
            title: job.title,
            company: job.company,
            location: job.location || location,
            description: `${job.title} at ${job.company}. ${job.location || location}`,
            source: 'linkedin-scraper',
          })
          tally(result, r.status)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[LinkedIn] Failed for "${query}" @ ${location}: ${msg}`)
        tallyError(result, err)
        if (msg.includes('Rate limited') || msg.includes('429')) {
          consecutiveBlocks++
          // Bail out completely if LinkedIn is actively blocking us
          if (consecutiveBlocks >= 3) {
            console.error('[LinkedIn] Multiple rate limits — aborting')
            return result
          }
        }
      }

      // Small delay between requests to avoid hammering — Edge Function budget allows ~16 reqs × 2s
      await sleep(2_000)
    }
  }

  console.log(`[LinkedIn] Done — inserted=${result.inserted} deduped=${result.deduped}`)
  return result
}

Deno.serve((req) => runPollHandler('linkedin', req, pollLinkedIn))
