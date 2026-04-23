import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { scrapeJD, ScrapeError } from '@/lib/scrape-jd'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'jobs-import-from-url', 20, 60 * 60 * 1000)
  if (limited) return limited

  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  try {
    const result = await scrapeJD(url)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ScrapeError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    const msg = err instanceof Error ? err.message : 'Fetch failed'
    const isTimeout = /timeout|aborted/i.test(msg)
    return NextResponse.json(
      { error: isTimeout ? 'Fetch timed out after 15s' : `Fetch failed: ${msg}` },
      { status: isTimeout ? 504 : 502 },
    )
  }
}
