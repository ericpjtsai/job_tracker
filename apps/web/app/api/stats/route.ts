import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function countByFit(rows: Array<{ resume_fit: number | null }>) {
  const high = rows.filter(r => r.resume_fit !== null && r.resume_fit >= 60).length
  const medium = rows.filter(r => r.resume_fit !== null && r.resume_fit >= 30 && r.resume_fit < 60).length
  const low = rows.filter(r => r.resume_fit === null || r.resume_fit < 30).length
  return { high, medium, low }
}

function countNewByFit(rows: Array<{ resume_fit: number | null, status: string }>) {
  const high = rows.filter(r => r.status === 'new' && r.resume_fit !== null && r.resume_fit >= 60).length
  const medium = rows.filter(r => r.status === 'new' && r.resume_fit !== null && r.resume_fit >= 30 && r.resume_fit < 60).length
  const low = rows.filter(r => r.status === 'new' && (r.resume_fit === null || r.resume_fit < 30)).length
  return { high, medium, low }
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const sp = req.nextUrl.searchParams

  const since = sp.get('since')
  const rule = sp.get('rule')
  const status = sp.get('status')
  const search = sp.get('search')

  function applySharedFilters(q: any) {
    if (rule && rule !== 'all') q = q.eq('firehose_rule', rule)
    if (status && status !== 'all') q = q.eq('status', status)
    if (search) q = q.or(`title.ilike.%${search}%,company.ilike.%${search}%`)
    return q
  }

  let query = supabase.from('job_postings').select('resume_fit,first_seen,status')
  if (since && since !== 'all') {
    const hours = since === '24h' ? 24 : 7 * 24
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    query = query.gte('first_seen', cutoff)
  }
  query = applySharedFilters(query)

  const { data: currentData } = await query
  const rows = currentData ?? []

  const current = countByFit(rows)
  const total = current.high + current.medium + current.low

  // Growth = unreviewed (new) jobs in each fit bucket for the current period
  const newCounts = countNewByFit(rows as Array<{ resume_fit: number | null, status: string }>)

  return NextResponse.json({
    total,
    high: current.high,
    medium: current.medium,
    low: current.low,
    growthHigh: newCounts.high,
    growthMedium: newCounts.medium,
    growthLow: newCounts.low,
  }, {
    headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' },
  })
}
