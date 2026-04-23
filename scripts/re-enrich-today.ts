// Re-run Claude Haiku keyword extraction for all manually-imported jobs from today.
// Usage: npx tsx scripts/re-enrich-today.ts

import { createClient } from '@supabase/supabase-js'
import { extractKeywordsLLM, classifyLLMKeywords, applyTitleCeilings } from '../packages/scoring/src/llm-keywords'
import { getPTMidnightToday } from './_shared/time'

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) { console.log('No ANTHROPIC_API_KEY set'); return }

  const todayMidnight = getPTMidnightToday()

  console.log(`Querying all jobs since ${todayMidnight}`)

  const { data: resume } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
    .eq('resume_type', 'ats')
    .single()
  const resumeKeywords: string[] = (resume as any)?.keywords_extracted ?? []
  console.log(`Resume keywords: ${resumeKeywords.length}`)

  const { data: jobs, error } = await supabase
    .from('job_postings')
    .select('id, title, company, page_content')
    .gte('first_seen', todayMidnight)
    .not('page_content', 'is', null)

  if (error) { console.error('Query failed:', error.message); return }

  const toEnrich = (jobs ?? []).filter((j: any) => j.page_content && j.page_content.length >= 200)
  console.log(`Jobs to enrich: ${toEnrich.length}`)

  let done = 0, skipped = 0, failed = 0

  for (const job of toEnrich) {
    process.stdout.write(`  [${done + skipped + failed + 1}/${toEnrich.length}] ${job.company} — ${job.title} ... `)
    try {
      const raw = await extractKeywordsLLM(job.page_content, resumeKeywords, anthropicKey)
      if (!raw) {
        console.log('skipped (no result)')
        skipped++
        continue
      }

      const classified = classifyLLMKeywords(raw, job.page_content, resumeKeywords)
      const llm = applyTitleCeilings(job.title ?? '', classified)
      const allKeywords = [...llm.matched, ...llm.missing]
      const fit = llm.role_fit
      const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'

      await supabase.from('job_postings').update({
        keywords_matched: allKeywords,
        resume_fit: fit,
        priority,
        enrichment_status: 'done',
      }).eq('id', job.id)

      console.log(`fit=${fit}% priority=${priority} kw=${allKeywords.length}`)
      done++
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }

  console.log(`\nDone: ${done} enriched, ${skipped} skipped, ${failed} failed`)
}

main().catch(console.error)
