import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function countByFit(rows: Array<{ resume_fit: number | null }>) {
  const high = rows.filter(r => r.resume_fit !== null && r.resume_fit >= 60).length
  const medium = rows.filter(r => r.resume_fit !== null && r.resume_fit >= 30 && r.resume_fit < 60).length
  const low = rows.filter(r => r.resume_fit === null || r.resume_fit < 30).length
  return { high, medium, low }
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const sp = req.nextUrl.searchParams

  const since = sp.get('since')
  const rule = sp.get('rule')
  const status = sp.get('status')
  const search = sp.get('search')

  // Shared filters (rule, status, search) applied to both current and previous periods
  function applySharedFilters(q: any) {
    if (rule && rule !== 'all') q = q.eq('firehose_rule', rule)
    if (status && status !== 'all') q = q.eq('status', status)
    if (search) q = q.or(`title.ilike.%${search}%,company.ilike.%${search}%`)
    return q
  }

  // Current period query
  let query = supabase.from('job_postings').select('resume_fit,first_seen')
  if (since && since !== 'all') {
    const hours = since === '24h' ? 24 : 7 * 24
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    query = query.gte('first_seen', cutoff)
  }
  query = applySharedFilters(query)

  // Previous period query (for growth comparison)
  // Today (24h): previous = 48h ago to 24h ago
  // Last week (7d): previous = 14d ago to 7d ago
  // All time: no previous period
  let prevQuery: any = null
  if (since === '24h') {
    const cutoffCurrent = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const cutoffPrev = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    prevQuery = supabase.from('job_postings').select('resume_fit')
      .gte('first_seen', cutoffPrev)
      .lt('first_seen', cutoffCurrent)
    prevQuery = applySharedFilters(prevQuery)
  } else if (since === '7d') {
    const cutoffCurrent = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    const cutoffPrev = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
    prevQuery = supabase.from('job_postings').select('resume_fit')
      .gte('first_seen', cutoffPrev)
      .lt('first_seen', cutoffCurrent)
    prevQuery = applySharedFilters(prevQuery)
  }

  const [{ data: currentData }, prevResult] = await Promise.all([
    query,
    prevQuery ? prevQuery : Promise.resolve({ data: null }),
  ])
  const rows = currentData ?? []
  const prevRows = prevResult?.data ?? null

  const current = countByFit(rows)
  const total = current.high + current.medium + current.low

  // Growth = current period count - previous period count
  let growthHigh = 0, growthMedium = 0, growthLow = 0
  if (prevRows) {
    const prev = countByFit(prevRows)
    growthHigh = current.high - prev.high
    growthMedium = current.medium - prev.medium
    growthLow = current.low - prev.low
  }

  return NextResponse.json({
    total,
    high: current.high,
    medium: current.medium,
    low: current.low,
    growthHigh,
    growthMedium,
    growthLow,
  }, {
    headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' },
  })
}
