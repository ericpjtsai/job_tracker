import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const sp = req.nextUrl.searchParams

  const since = sp.get('since')
  const rule = sp.get('rule')
  const status = sp.get('status')
  const search = sp.get('search')

  const safeSearch = search ? search.replace(/[.,()"\\]/g, '') : ''

  function applySharedFilters(q: any) {
    if (rule && rule !== 'all') q = q.eq('firehose_rule', rule)
    if (status && status !== 'all') q = q.eq('status', status)
    if (safeSearch) q = q.or(`title.ilike.%${safeSearch}%,company.ilike.%${safeSearch}%`)
    return q
  }

  // Single query: fetch resume_fit + status (lightweight), count in JS — faster than 6 round-trips
  let query = supabase.from('job_postings').select('resume_fit, status')
  if (since && since !== 'all') {
    const hours = since === '24h' ? 24 : 7 * 24
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    query = query.gte('first_seen', cutoff)
  }
  query = applySharedFilters(query)

  const { data } = await query
  const rows = data ?? []

  let h = 0, m = 0, l = 0, gh = 0, gm = 0, gl = 0
  for (const r of rows) {
    const fit = r.resume_fit
    if (fit !== null && fit >= 80) { h++; if (r.status === 'new') gh++ }
    else if (fit !== null && fit >= 50) { m++; if (r.status === 'new') gm++ }
    else { l++; if (r.status === 'new') gl++ }
  }

  return NextResponse.json({
    total: h + m + l,
    high: h,
    medium: m,
    low: l,
    growthHigh: gh,
    growthMedium: gm,
    growthLow: gl,
  }, {
    headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' },
  })
}
