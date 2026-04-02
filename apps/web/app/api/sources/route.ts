import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const listenerUrl = () => process.env.LISTENER_URL ?? 'http://localhost:3002'

// Map firehose_rule values in DB to source IDs on the sources page
const RULE_TO_SOURCE: Record<string, string> = {
  'linkedin-scraper': 'linkedin-scraper',
  'linkedin-mantiks': 'linkedin-mantiks',
  'linkedin-direct': 'linkedin-direct',
  'glassdoor-hasdata': 'glassdoor',
  'indeed-hasdata': 'indeed',
  'serpapi': 'serpapi',
  'github-design-newgrad': 'github-jobs',
  'github-h1b-design': 'github-jobs',
  'manual-import': 'manual',
  // ATS sources
  'greenhouse': 'ats',
  'lever': 'ats',
  'ashby': 'ats',
  'smartrecruiters': 'ats',
}

async function getHistoricalCounts(): Promise<Record<string, number>> {
  try {
    const supabase = createServerClient()
    const { data } = await supabase.from('job_postings').select('firehose_rule')
    if (!data) return {}
    const counts: Record<string, number> = {}
    for (const row of data) {
      const rule = row.firehose_rule || ''
      const sourceId = RULE_TO_SOURCE[rule] || 'other'
      counts[sourceId] = (counts[sourceId] || 0) + 1
    }
    return counts
  } catch {
    return {}
  }
}

export async function GET() {
  try {
    const [res, historicalCounts] = await Promise.all([
      fetch(`${listenerUrl()}/sources`),
      getHistoricalCounts(),
    ])
    const data = await res.json()
    return NextResponse.json({ ...data, historicalCounts }, {
      headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' },
    })
  } catch {
    return NextResponse.json({ error: 'Listener not reachable', sources: [], historicalCounts: {} }, { status: 503 })
  }
}

export async function POST(request: Request) {
  try {
    const { triggerPath } = await request.json()
    if (!triggerPath) return NextResponse.json({ error: 'Missing triggerPath' }, { status: 400 })
    const res = await fetch(`${listenerUrl()}${triggerPath}`, { method: 'POST' })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Listener not reachable' }, { status: 503 })
  }
}
