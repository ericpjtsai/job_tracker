import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { scorePosting, computeResumeFit, extractKeywordsWithGemini, validateKeywords } from '@job-tracker/scoring'

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
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()
  const body = await req.json()

  // Only allow updating status, notes, page_content, url, and title
  const updates: Record<string, string | null> = {}
  if (typeof body.title === 'string') updates.title = body.title
  if (typeof body.status === 'string') {
    updates.status = body.status
    // Track when job was applied — preserve applied_at for post-application states
    if (body.status === 'applied') {
      const { data: current } = await supabase.from('job_postings').select('applied_at').eq('id', id).single()
      if (!current?.applied_at) updates.applied_at = new Date().toISOString()
    } else if (['new', 'reviewed', 'skipped'].includes(body.status)) {
      updates.applied_at = null
    }
    // 'unavailable' = post-application (rejection) — don't touch applied_at
  }
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
    const [{ data: job }, { data: resume }] = await Promise.all([
      supabase.from('job_postings').select('title, company, location, url').eq('id', id).single(),
      supabase.from('resume_versions').select('keywords_extracted').eq('is_active', true).eq('resume_type', 'ats').single(),
    ])

    if (job) {
      const resumeKeywords = resume?.keywords_extracted ?? []
      const geminiKey = process.env.GEMINI_API_KEY
      const anthropicKey = process.env.ANTHROPIC_API_KEY

      // Try LLM extraction first, fall back to regex
      const rawLlm = (geminiKey || anthropicKey) ? await extractKeywordsWithGemini(updates.page_content, resumeKeywords, geminiKey, anthropicKey) : null
      const llmResult = rawLlm ? validateKeywords(rawLlm, updates.page_content, resumeKeywords) : null

      if (llmResult) {
        const allKeywords = [...llmResult.matched, ...llmResult.missing]
        const resume_fit = llmResult.role_fit
        const priority = resume_fit >= 80 ? 'high' : resume_fit >= 50 ? 'medium' : resume_fit >= 1 ? 'low' : 'skip'
        await supabase.from('job_postings').update({ keywords_matched: allKeywords, resume_fit, priority }).eq('id', id)
        return NextResponse.json({ ok: true, resume_fit, keywords_matched: allKeywords, matched: llmResult.matched, missing: llmResult.missing })
      }

      // Fallback: regex scoring
      const result = scorePosting({ text: updates.page_content, title: job.title ?? '', company: job.company ?? '', location: job.location ?? '', url: job.url })
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
