import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = req.nextUrl

  const priority = searchParams.get('priority')
  const rule = searchParams.get('rule')
  const status = searchParams.get('status')
  const since = searchParams.get('since')
  const search = searchParams.get('search')
  const page = parseInt(searchParams.get('page') ?? '0')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const fitOrder = searchParams.get('fitOrder')
  const seenOrder = searchParams.get('seenOrder')
  const newFirst = searchParams.get('newFirst') === 'true'

  const LIST_COLS = 'id,url,title,company,company_tier,location,resume_fit,firehose_rule,first_seen,last_seen,status,score,priority,salary_min,salary_max'

  function applyFilters(q: any) {
    if (priority && priority !== 'all') {
      if (priority === 'high') q = q.gte('resume_fit', 60)
      else if (priority === 'medium') q = q.gte('resume_fit', 30).lt('resume_fit', 60)
      else if (priority === 'low') q = q.or('resume_fit.is.null,resume_fit.lt.30')
    }
    if (rule && rule !== 'all') q = q.eq('firehose_rule', rule)
    if (status && status !== 'all') q = q.eq('status', status)
    if (since && since !== 'all') {
      const hours = since === '24h' ? 24 : 7 * 24
      const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
      q = q.gte('first_seen', cutoff)
    }
    if (search) q = q.or(`title.ilike.%${search}%,company.ilike.%${search}%`)
    return q
  }

  // ── New-first sort: two paginated queries ──────────────────────────────
  if (newFirst && (!status || status === 'all')) {
    // Count new jobs first to calculate pagination offsets
    let qNewCount = supabase.from('job_postings').select('id', { count: 'exact', head: true }).eq('status', 'new')
    qNewCount = applyFilters(qNewCount)
    const { count: newCount } = await qNewCount
    const totalNew = newCount ?? 0

    const offset = page * limit
    let data: any[] = []

    if (offset < totalNew) {
      // Page overlaps with new jobs
      const newNeeded = Math.min(limit, totalNew - offset)
      let qNew = supabase.from('job_postings').select(LIST_COLS).eq('status', 'new')
      qNew = applyFilters(qNew)
      qNew = qNew.order('resume_fit', { ascending: false, nullsFirst: false }).range(offset, offset + newNeeded - 1)

      const restNeeded = limit - newNeeded
      let qRest = restNeeded > 0
        ? supabase.from('job_postings').select(LIST_COLS).neq('status', 'new')
        : null
      if (qRest) {
        qRest = applyFilters(qRest)
        qRest = qRest.order('resume_fit', { ascending: false, nullsFirst: false }).range(0, restNeeded - 1)
      }

      const [resNew, resRest] = await Promise.all([qNew, qRest ?? Promise.resolve({ data: [] })])
      data = [...(resNew.data ?? []), ...(resRest as any).data ?? []]
    } else {
      // Page is entirely in non-new jobs
      const restOffset = offset - totalNew
      let qRest = supabase.from('job_postings').select(LIST_COLS).neq('status', 'new')
      qRest = applyFilters(qRest)
      qRest = qRest.order('resume_fit', { ascending: false, nullsFirst: false }).range(restOffset, restOffset + limit - 1)
      const resRest = await qRest
      data = resRest.data ?? []
    }

    // Get total count
    let qTotal = supabase.from('job_postings').select('id', { count: 'exact', head: true })
    qTotal = applyFilters(qTotal)
    const { count: total } = await qTotal

    return NextResponse.json({ data, total: total ?? 0, page, limit }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    })
  }

  // ── Standard sort ───────────────────────────────────────────────────────
  let query = supabase
    .from('job_postings')
    .select(LIST_COLS, { count: 'exact' })
    .range(page * limit, (page + 1) * limit - 1)

  if (fitOrder) query = query.order('resume_fit', { ascending: fitOrder === 'asc', nullsFirst: false })
  if (seenOrder) query = query.order('first_seen', { ascending: seenOrder === 'asc', nullsFirst: false })
  if (!fitOrder && !seenOrder) query = query.order('resume_fit', { ascending: false, nullsFirst: false })

  query = applyFilters(query)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data, total: count ?? 0, page, limit }, {
    headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
  })
}
