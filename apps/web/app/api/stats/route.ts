import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getPTMidnightToday } from '@/lib/time'

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

  // Main query: fetch resume_fit + status for the filtered window, aggregate in JS.
  let mainQuery = supabase.from('job_postings').select('resume_fit, status')
  if (since && since !== 'all') {
    const hours = since === '24h' ? 24 : 7 * 24
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    mainQuery = mainQuery.gte('first_seen', cutoff)
  }
  mainQuery = applySharedFilters(mainQuery)

  // todayApplied: count of jobs with applied_at >= today midnight PT.
  // Folded into /api/stats so the homepage doesn't need a separate fetch
  // to /api/jobs/import?page=0&limit=1 just to read this one number.
  const todayMidnight = getPTMidnightToday()
  const todayQuery = supabase
    .from('job_postings')
    .select('id', { count: 'exact', head: true })
    .not('applied_at', 'is', null)
    .gte('applied_at', todayMidnight)

  const [{ data }, { count: todayCount }] = await Promise.all([mainQuery, todayQuery])
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
    todayApplied: todayCount ?? 0,
  }, {
    headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' },
  })
}
