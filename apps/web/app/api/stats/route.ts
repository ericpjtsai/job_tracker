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

  function countQuery() {
    let q = supabase.from('job_postings').select('id', { count: 'exact', head: true })
    if (since && since !== 'all') {
      const hours = since === '24h' ? 24 : 7 * 24
      const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
      q = q.gte('first_seen', cutoff)
    }
    return applySharedFilters(q)
  }

  // Run all 6 count queries in parallel — each is a lightweight HEAD request (no rows returned)
  const [high, medium, low, newHigh, newMedium, newLow] = await Promise.all([
    countQuery().gte('resume_fit', 60),
    countQuery().gte('resume_fit', 30).lt('resume_fit', 60),
    countQuery().or('resume_fit.is.null,resume_fit.lt.30'),
    countQuery().eq('status', 'new').gte('resume_fit', 60),
    countQuery().eq('status', 'new').gte('resume_fit', 30).lt('resume_fit', 60),
    countQuery().eq('status', 'new').or('resume_fit.is.null,resume_fit.lt.30'),
  ])

  const h = high.count ?? 0, m = medium.count ?? 0, l = low.count ?? 0

  return NextResponse.json({
    total: h + m + l,
    high: h,
    medium: m,
    low: l,
    growthHigh: newHigh.count ?? 0,
    growthMedium: newMedium.count ?? 0,
    growthLow: newLow.count ?? 0,
  }, {
    headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=300' },
  })
}
