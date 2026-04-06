// rescore — chunked rescore of all jobs against the active resume.
// PORTED from apps/listener/src/index.ts:runRescore() but split into chunks
// because the listener's monolithic loop would exceed Edge Function timeouts.
//
// SELF-CHAINING: after each chunk, if more rows remain, the function fires a
// fire-and-forget fetch to itself with the next offset. EdgeRuntime.waitUntil()
// keeps the runtime alive long enough for the chained request to leave the box.
// The web /api/jobs/rescore POST only needs to fire the first chunk.
//
// Body: { offset?: number, limit?: number }   (default offset=0, limit=50)
// Response: { ok, processed, updated, errors, next?: number, done: boolean }
//
// Progress is written to source_health row 'rescore':
//   progress_current, progress_total, status (polling | healthy | error)
//   meta.offset for the next chunk

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined

import { getServiceClient, jsonResponse, requireServiceAuth } from '../_shared/supabase.ts'
import { extractKeywordsLLM, validateKeywords } from '../_shared/llm.ts'
import { computeResumeFit } from '../_shared/scoring/index.ts'
import { markHealthy, markError, markPolling, updateProgress } from '../_shared/health.ts'

const DEFAULT_LIMIT = 50

interface JobRow {
  id: string
  page_content: string | null
  keywords_matched: string[] | null
}

Deno.serve(async (req) => {
  const authError = requireServiceAuth(req)
  if (authError) return authError

  const supabase = getServiceClient()

  try {
    const body = (await req.json().catch(() => ({}))) as { offset?: number; limit?: number }
    const offset = Math.max(0, body.offset ?? 0)
    const limit = Math.max(1, Math.min(200, body.limit ?? DEFAULT_LIMIT))

    // On first chunk, initialize progress
    if (offset === 0) {
      const { count } = await supabase
        .from('job_postings')
        .select('*', { count: 'estimated', head: true })
      await markPolling(supabase, 'rescore', count ?? 0)
    }

    // Load active resume keywords once for this chunk
    const { data: resume } = await supabase
      .from('resume_versions')
      .select('keywords_extracted')
      .eq('is_active', true)
      .eq('resume_type', 'ats')
      .maybeSingle()
    const resumeKeywords: string[] =
      ((resume as { keywords_extracted?: string[] } | null)?.keywords_extracted) ?? []

    if (resumeKeywords.length === 0) {
      await markError(supabase, 'rescore', new Error('No active resume'))
      return jsonResponse({ ok: false, error: 'No active resume' }, 400)
    }

    const hasAnthropic = Boolean(Deno.env.get('ANTHROPIC_API_KEY'))

    // Fetch this chunk
    const { data: jobs, error: selectError } = await supabase
      .from('job_postings')
      .select('id, page_content, keywords_matched')
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1)

    if (selectError) {
      throw new Error(`select chunk failed: ${selectError.message}`)
    }

    const rows = (jobs ?? []) as JobRow[]
    let updated = 0
    let errors = 0

    for (const job of rows) {
      try {
        const desc = job.page_content ?? ''
        if (hasAnthropic && desc.length > 100) {
          const raw = await extractKeywordsLLM(desc, resumeKeywords)
          const llm = raw ? validateKeywords(raw, desc, resumeKeywords) : null
          if (llm) {
            const allKeywords = [...llm.matched, ...llm.missing]
            const fit = llm.role_fit
            const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'
            await supabase
              .from('job_postings')
              .update({ keywords_matched: allKeywords, resume_fit: fit, priority })
              .eq('id', job.id)
            updated++
            await new Promise((r) => setTimeout(r, 200)) // throttle Claude calls
            continue
          }
        }
        // Fallback: regex-only resume fit recomputation
        const fit = computeResumeFit(job.keywords_matched ?? [], resumeKeywords)
        const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'
        await supabase
          .from('job_postings')
          .update({ resume_fit: fit, priority })
          .eq('id', job.id)
        updated++
      } catch (err) {
        errors++
        console.error(`[rescore] ${job.id} failed:`, err instanceof Error ? err.message : err)
      }
    }

    const newCurrent = offset + rows.length
    const isDone = rows.length < limit

    await updateProgress(supabase, 'rescore', newCurrent, undefined, {
      offset: newCurrent,
      done: isDone,
    })

    if (isDone) {
      await markHealthy(supabase, 'rescore', updated)
      return jsonResponse({
        ok: true,
        processed: rows.length,
        updated,
        errors,
        offset: newCurrent,
        done: true,
      })
    }

    // Self-chain: fire the next chunk in the background and return immediately.
    // EdgeRuntime.waitUntil keeps the worker alive long enough for the request to leave.
    const nextChunk = (async () => {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        if (!supabaseUrl || !serviceKey) return
        await fetch(`${supabaseUrl}/functions/v1/rescore`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ offset: newCurrent, limit }),
        })
      } catch (e) {
        console.error('[rescore] self-chain failed:', e)
      }
    })()

    if (typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil(nextChunk)
    } else {
      // Local dev: just await
      await nextChunk
    }

    return jsonResponse({
      ok: true,
      processed: rows.length,
      updated,
      errors,
      next: newCurrent,
      done: false,
    })
  } catch (err) {
    console.error('[rescore] fatal:', err)
    await markError(supabase, 'rescore', err)
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
