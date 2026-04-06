// poll-linkedin-direct — emergency fallback scraper for LinkedIn public pages
// PORTED from apps/listener/src/linkedin-direct.ts
// Fired by the fallback-check cron only when both Mantiks + linkedin sources are dark.
// Max 10 requests per invocation, random 30-120s delays, rotated UA.

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

// Edge Functions only have ~150s wall-clock so we tighten the random delay range
// (original Node listener used 30-120s, that wouldn't fit even one request).
// Compensate by capping requests at 5 instead of 10.
function shortDelay(): Promise<void> {
  const ms = 5_000 + Math.random() * 10_000 // 5-15s
  return sleep(ms)
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomAgent(),
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 429) throw new Error('Rate limited (429)')
  return await res.text()
}

async function pollLinkedInDirect(ctx: ProcessorContext): Promise<PollResult> {
  console.log('[LinkedIn Direct] Emergency fallback scraper activated')
  const result = emptyResult()
  const MAX_REQUESTS = 5
  let requestCount = 0

  for (const query of QUERIES) {
    if (requestCount >= MAX_REQUESTS) break
    for (const location of LOCATIONS) {
      if (requestCount >= MAX_REQUESTS) break

      const url = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&f_TPR=r86400&position=1&pageNum=0`

      try {
        const html = await fetchHtml(url)
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

          const r = await insertJobPosting(ctx, {
            url: canonicalLinkedInUrl(href),
            title,
            company,
            location: jobLocation,
            description: `[Incomplete — direct scrape] ${title} at ${company}`,
            source: 'linkedin-direct',
          })
          tally(result, r.status)
        }

        console.log(`[LinkedIn Direct] ${query} @ ${location}: ${cards.length} cards`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[LinkedIn Direct] Failed for "${query}" @ ${location}: ${msg}`)
        tallyError(result, err)
        if (msg.includes('Rate limited')) return result
      }

      if (requestCount < MAX_REQUESTS) await shortDelay()
    }
  }

  console.log(`[LinkedIn Direct] Done (${requestCount} requests, ${result.inserted} inserted)`)
  return result
}

Deno.serve((req) => runPollHandler('linkedin-direct', req, pollLinkedInDirect))
