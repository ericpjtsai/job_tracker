// enrich-batch — polled LLM enrichment queue worker.
// Replaces the per-insert fire-and-forget pattern from the old listener
// (apps/listener/src/processor.ts:372 enrichWithLLM().catch(()=>{})).
//
// Cron'd every 2 minutes by 007_cron_schedule.sql.
// Each invocation pulls up to BATCH_SIZE pending rows, calls Claude Haiku, writes results.

import { getServiceClient, jsonResponse, requireServiceAuth } from '../_shared/supabase.ts'
import { extractKeywordsLLM, validateKeywords } from '../_shared/llm.ts'
import { markPolling, markHealthy, markError } from '../_shared/health.ts'

const BATCH_SIZE = 20

interface PendingJob {
  id: string
  page_content: string | null
  source_type: string | null
}

Deno.serve(async (req) => {
  const authError = requireServiceAuth(req)
  if (authError) return authError

  const supabase = getServiceClient()

  try {
    await markPolling(supabase, 'enrich')

    if (!Deno.env.get('ANTHROPIC_API_KEY')) {
      console.log('[enrich] ANTHROPIC_API_KEY not set — nothing to do')
      await markHealthy(supabase, 'enrich', 0)
      return jsonResponse({ ok: true, processed: 0, errors: 0, reason: 'no api key' })
    }

    // Load active resume keywords (used by validateKeywords)
    const { data: resume } = await supabase
      .from('resume_versions')
      .select('keywords_extracted')
      .eq('is_active', true)
      .eq('resume_type', 'ats')
      .maybeSingle()
    const resumeKeywords: string[] =
      ((resume as { keywords_extracted?: string[] } | null)?.keywords_extracted) ?? []

    // Pick up the oldest pending rows. Use first_seen ordering since job_postings has no created_at.
    const { data: pending, error: selectError } = await supabase
      .from('job_postings')
      .select('id, page_content, source_type')
      .eq('enrichment_status', 'pending')
      .order('first_seen', { ascending: true })
      .limit(BATCH_SIZE)

    if (selectError) {
      throw new Error(`select pending failed: ${selectError.message}`)
    }
    const jobs = (pending ?? []) as PendingJob[]

    if (jobs.length === 0) {
      console.log('[enrich] No pending jobs')
      await markHealthy(supabase, 'enrich', 0)
      return jsonResponse({ ok: true, processed: 0, errors: 0 })
    }

    // Mark them processing in a single UPDATE so concurrent runs don't double-process
    const ids = jobs.map((j) => j.id)
    const { error: lockError } = await supabase
      .from('job_postings')
      .update({ enrichment_status: 'processing' })
      .in('id', ids)
    if (lockError) {
      throw new Error(`lock failed: ${lockError.message}`)
    }

    let processed = 0
    let errors = 0

    for (const job of jobs) {
      const description = job.page_content ?? ''
      const isManual = job.source_type === 'manual'

      // Skip LLM for auto-ingested jobs with sparse descriptions — regex score is sufficient
      if (!isManual && description.length < 500) {
        await supabase
          .from('job_postings')
          .update({ enrichment_status: 'skipped' })
          .eq('id', job.id)
        continue
      }

      try {
        const raw = await extractKeywordsLLM(description, resumeKeywords)
        if (!raw) {
          await supabase
            .from('job_postings')
            .update({ enrichment_status: 'skipped' })
            .eq('id', job.id)
          continue
        }

        const llm = validateKeywords(raw, description, resumeKeywords)
        const allKeywords = [...llm.matched, ...llm.missing]
        const fit = llm.role_fit
        const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'

        await supabase
          .from('job_postings')
          .update({
            keywords_matched: allKeywords,
            resume_fit: fit,
            priority,
            enrichment_status: 'done',
          })
          .eq('id', job.id)

        processed++
        console.log(`[enrich] ${job.id}: ${allKeywords.length} kw, fit=${fit}%, priority=${priority}`)
      } catch (err) {
        errors++
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[enrich] ${job.id} failed: ${msg}`)
        await supabase
          .from('job_postings')
          .update({ enrichment_status: 'error' })
          .eq('id', job.id)
      }
    }

    await markHealthy(supabase, 'enrich', processed)
    return jsonResponse({ ok: true, processed, errors, batchSize: jobs.length })
  } catch (err) {
    console.error('[enrich] fatal:', err)
    await markError(supabase, 'enrich', err)
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
