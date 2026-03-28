import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { computeResumeFit, extractKeywordsWithGemini } from '@job-tracker/scoring'

export async function POST() {
  const supabase = createServerClient()
  const geminiKey = process.env.GEMINI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  // Get active resume keywords
  const { data: resume, error: resumeError } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
    .eq('resume_type', 'ats')
    .single()

  if (resumeError || !resume) {
    return NextResponse.json({ error: 'No active resume found' }, { status: 404 })
  }

  const resumeKeywords: string[] = resume.keywords_extracted ?? []

  // Fetch all job postings
  const { data: jobs, error: jobsError } = await supabase
    .from('job_postings')
    .select('id, keywords_matched, page_content')

  if (jobsError || !jobs) {
    return NextResponse.json({ error: jobsError?.message ?? 'Failed to fetch jobs' }, { status: 500 })
  }

  let updated = 0

  // Process jobs — use LLM for those with page_content, regex fit for others
  for (const job of jobs) {
    // Try LLM enrichment for jobs with descriptions
    if ((geminiKey || anthropicKey) && job.page_content && job.page_content.length > 100) {
      const llmResult = await extractKeywordsWithGemini(job.page_content, resumeKeywords, geminiKey, anthropicKey)
      if (llmResult) {
        const allKeywords = [...llmResult.matched, ...llmResult.missing]
        const fit = Math.round((llmResult.matched.length / Math.max(allKeywords.length, 1)) * 100)
        const priority = fit >= 60 ? 'high' : fit >= 30 ? 'medium' : fit >= 1 ? 'low' : 'skip'
        await supabase.from('job_postings').update({ keywords_matched: allKeywords, resume_fit: fit, priority }).eq('id', job.id)
        updated++
        // Rate limit: 200ms between calls
        await new Promise(r => setTimeout(r, 200))
        continue
      }
    }

    // Fallback: regex-based fit calculation
    const fit = computeResumeFit(job.keywords_matched ?? [], resumeKeywords)
    const priority = fit >= 60 ? 'high' : fit >= 30 ? 'medium' : fit >= 1 ? 'low' : 'skip'
    await supabase.from('job_postings').update({ resume_fit: fit, priority }).eq('id', job.id)
    updated++
  }

  return NextResponse.json({ updated })
}
