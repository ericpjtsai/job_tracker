import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { computeResumeFit } from '@job-tracker/scoring'

export async function POST() {
  const supabase = createServerClient()

  // Get active resume keywords
  const { data: resume, error: resumeError } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
    .single()

  if (resumeError || !resume) {
    return NextResponse.json({ error: 'No active resume found' }, { status: 404 })
  }

  const resumeKeywords: string[] = resume.keywords_extracted ?? []

  // Fetch all job postings with their keywords
  const { data: jobs, error: jobsError } = await supabase
    .from('job_postings')
    .select('id, keywords_matched')

  if (jobsError || !jobs) {
    return NextResponse.json({ error: jobsError?.message ?? 'Failed to fetch jobs' }, { status: 500 })
  }

  // Compute resume_fit and priority for each and batch update
  const updates = jobs.map((job) => {
    const fit = computeResumeFit(job.keywords_matched ?? [], resumeKeywords)
    const priority = fit >= 60 ? 'high' : fit >= 30 ? 'medium' : fit >= 1 ? 'low' : 'skip'
    return { id: job.id, resume_fit: fit, priority }
  })

  // Upsert in batches of 500
  const BATCH = 500
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    const { error } = await supabase
      .from('job_postings')
      .upsert(batch, { onConflict: 'id' })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ updated: updates.length })
}
