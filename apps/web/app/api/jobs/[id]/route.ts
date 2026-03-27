import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { scorePosting, computeResumeFit } from '@job-tracker/scoring'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('job_postings')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()
  const body = await req.json()

  // Only allow updating status, notes, and page_content
  const updates: Record<string, string> = {}
  if (typeof body.status === 'string') updates.status = body.status
  if (typeof body.notes === 'string') updates.notes = body.notes
  if (typeof body.page_content === 'string') updates.page_content = body.page_content
  if (typeof body.url === 'string') updates.url = body.url

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('job_postings')
    .update(updates)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Re-score if page_content changed
  if (updates.page_content) {
    const { data: job } = await supabase.from('job_postings').select('title, company, location, url').eq('id', id).single()
    const { data: resume } = await supabase.from('resume_versions').select('keywords_extracted').eq('is_active', true).eq('resume_type', 'ats').single()

    if (job) {
      const result = scorePosting({ text: updates.page_content, title: job.title ?? '', company: job.company ?? '', location: job.location ?? '', url: job.url })
      const resumeKeywords = resume?.keywords_extracted ?? []
      const resume_fit = computeResumeFit(result.keywords_matched, resumeKeywords)
      await supabase.from('job_postings').update({ score: result.total, priority: result.priority, keywords_matched: result.keywords_matched, resume_fit }).eq('id', id)
      return NextResponse.json({ ok: true, score: result.total, priority: result.priority, resume_fit, keywords_matched: result.keywords_matched })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()
  const { error } = await supabase.from('job_postings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
