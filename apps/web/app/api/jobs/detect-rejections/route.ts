import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — return pending rejections for homepage banner
export async function GET() {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('pending_rejections')
    .select('id, job_id, rejection_company, rejection_role, rejection_date, email_snippet, email_body, confidence, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich with job title + company
  const jobIds = [...new Set((data ?? []).map((r) => r.job_id).filter(Boolean))]
  let jobMap: Record<string, { title: string | null; company: string | null }> = {}
  if (jobIds.length > 0) {
    const { data: jobs } = await supabase
      .from('job_postings')
      .select('id, title, company')
      .in('id', jobIds)
    if (jobs) {
      jobMap = Object.fromEntries(jobs.map((j) => [j.id, { title: j.title, company: j.company }]))
    }
  }

  const pending = (data ?? []).map((r) => ({
    ...r,
    job_title: jobMap[r.job_id]?.title ?? null,
    job_company: jobMap[r.job_id]?.company ?? null,
  }))

  return NextResponse.json({ pending }, {
    headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' },
  })
}

// POST — receive scanned rejection data, match to applied jobs, write to pending_rejections
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const body = await req.json()
  const rejections: { company: string; role?: string; date?: string; snippet?: string; email_body?: string }[] = body.rejections ?? []

  if (rejections.length === 0) {
    return NextResponse.json({ error: 'No rejections provided' }, { status: 400 })
  }

  // Fetch all applied jobs
  const { data: appliedJobs, error } = await supabase
    .from('job_postings')
    .select('id, title, company, location')
    .eq('status', 'applied')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const jobs = appliedJobs ?? []
  const matched: { job_id: string; rejection_company: string; rejection_role?: string; rejection_date?: string; snippet?: string; email_body?: string }[] = []
  const unmatched: { company: string; role?: string }[] = []

  for (const rej of rejections) {
    const normRej = normalize(rej.company)
    // Try company name match first
    let match = jobs.find((j) => {
      if (!j.company) return false
      const normJob = normalize(j.company)
      return normJob === normRej || normJob.includes(normRej) || normRej.includes(normJob)
    })

    // Fallback: match by role title if company didn't match (handles parent company aliases like World/Tools For Humanity)
    if (!match && rej.role) {
      const normRole = rej.role.toLowerCase()
      match = jobs.find((j) => {
        if (!j.title) return false
        return j.title.toLowerCase() === normRole || j.title.toLowerCase().includes(normRole) || normRole.includes(j.title.toLowerCase())
      })
    }

    if (match) {
      matched.push({
        job_id: match.id,
        rejection_company: rej.company,
        rejection_role: rej.role,
        rejection_date: rej.date,
        snippet: rej.snippet,
        email_body: rej.email_body,
      })
    } else {
      unmatched.push({ company: rej.company, role: rej.role })
    }
  }

  // Insert matched into pending_rejections (skip duplicates by job_id)
  if (matched.length > 0) {
    // Check for existing pending rejections to avoid duplicates
    const matchedJobIds = matched.map((m) => m.job_id)
    const { data: existing } = await supabase
      .from('pending_rejections')
      .select('job_id')
      .in('job_id', matchedJobIds)
      .eq('status', 'pending')

    const existingJobIds = new Set((existing ?? []).map((e) => e.job_id))
    const newMatches = matched.filter((m) => !existingJobIds.has(m.job_id))

    if (newMatches.length > 0) {
      const rows = newMatches.map((m) => ({
        job_id: m.job_id,
        rejection_company: m.rejection_company,
        rejection_role: m.rejection_role ?? null,
        rejection_date: m.rejection_date ?? null,
        email_snippet: m.snippet ?? null,
        email_body: m.email_body ?? null,
      }))
      await supabase.from('pending_rejections').insert(rows)
    }
  }

  return NextResponse.json({ matched: matched.length, unmatched })
}

// PATCH — confirm or dismiss pending rejections
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient()
  const body = await req.json()
  const actions: { id: string; action: 'confirm' | 'dismiss' }[] = body.actions ?? []

  if (actions.length === 0) {
    return NextResponse.json({ error: 'No actions provided' }, { status: 400 })
  }

  const confirms = actions.filter((a) => a.action === 'confirm').map((a) => a.id)
  const dismisses = actions.filter((a) => a.action === 'dismiss').map((a) => a.id)

  // Confirm: update job status to rejected with rejection date, mark pending as confirmed
  if (confirms.length > 0) {
    const { data: pendingRows } = await supabase
      .from('pending_rejections')
      .select('id, job_id, rejection_date')
      .in('id', confirms)

    if (pendingRows) {
      for (const row of pendingRows) {
        if (row.job_id) {
          await supabase.from('job_postings').update({
            status: 'rejected',
            rejected_at: row.rejection_date ?? new Date().toISOString(),
          }).eq('id', row.job_id)
        }
      }
      await supabase.from('pending_rejections').update({ status: 'confirmed' }).in('id', confirms)
    }
  }

  // Dismiss: mark as dismissed
  if (dismisses.length > 0) {
    await supabase.from('pending_rejections').update({ status: 'dismissed' }).in('id', dismisses)
  }

  return NextResponse.json({ ok: true, confirmed: confirms.length, dismissed: dismisses.length })
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]|inc|llc|corp|corporation|ltd|co\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
