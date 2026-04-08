// Pair benchmarking: run Haiku vs Sonnet against a job posting using the EXACT
// same prompt extractKeywordsLLM uses. Side-by-side comparison shows keyword
// recall, role_fit calibration, and which keywords each model catches uniquely.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... npx tsx --env-file=.env.local \
//     scripts/calibrate-haiku-sonnet.ts [company-substring]
//
//   Default company: decagon
//   Examples:
//     ... scripts/calibrate-haiku-sonnet.ts            # decagon
//     ... scripts/calibrate-haiku-sonnet.ts caspar     # Caspar Health
//     ... scripts/calibrate-haiku-sonnet.ts retool

import { createClient } from '@supabase/supabase-js'
import { buildPrompt, classifyLLMKeywords, applyTitleCeilings } from '../packages/scoring/src/llm-keywords'
import { callClaude, parseKeywordResponse, HAIKU, SONNET } from './_shared/claude'

function printList(label: string, items: string[]) {
  console.log(`  ${label} (${items.length}):`)
  if (items.length === 0) console.log('    (none)')
  else console.log('    ' + items.join(', '))
}

async function main() {
  const companyFilter = (process.argv[2] ?? 'decagon').toLowerCase()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) { console.error('No ANTHROPIC_API_KEY set'); process.exit(1) }

  const { data: jobs, error: jobErr } = await supabase
    .from('job_postings')
    .select('id, title, company, page_content, keywords_matched, resume_fit')
    .ilike('company', `%${companyFilter}%`)
    .not('page_content', 'is', null)
    .order('first_seen', { ascending: false })
    .limit(1)

  if (jobErr || !jobs || jobs.length === 0) {
    console.error(`No job found for company matching '${companyFilter}':`, jobErr?.message)
    process.exit(1)
  }
  const job = jobs[0] as any
  console.log(`Job: ${job.company} — ${job.title} (${job.id})`)
  console.log(`JD length: ${job.page_content.length} chars`)

  const { data: resume } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
    .eq('resume_type', 'ats')
    .single()
  const resumeKeywords: string[] = (resume as any)?.keywords_extracted ?? []
  console.log(`Resume keywords: ${resumeKeywords.length}`)
  console.log()

  const prompt = buildPrompt(job.page_content, resumeKeywords)
  console.log(`Prompt length: ${prompt.length} chars`)
  console.log()

  console.log('Calling Haiku and Sonnet in parallel...')
  const [haikuRaw, sonnetRaw] = await Promise.all([
    callClaude(HAIKU, prompt, anthropicKey, { maxTokens: 4000 }),
    callClaude(SONNET, prompt, anthropicKey, { maxTokens: 4000 }),
  ])

  const haikuParsed = parseKeywordResponse(haikuRaw)
  const sonnetParsed = parseKeywordResponse(sonnetRaw)
  if (!haikuParsed || !sonnetParsed) {
    console.error('Failed to parse one or both responses')
    console.error('HAIKU raw:', haikuRaw)
    console.error('SONNET raw:', sonnetRaw)
    process.exit(1)
  }

  const haikuClassified = classifyLLMKeywords(haikuParsed, job.page_content, resumeKeywords)
  const sonnetClassified = classifyLLMKeywords(sonnetParsed, job.page_content, resumeKeywords)
  const haiku = applyTitleCeilings(job.title ?? '', haikuClassified)
  const sonnet = applyTitleCeilings(job.title ?? '', sonnetClassified)

  console.log('\n' + '='.repeat(80))
  console.log(`HAIKU (${HAIKU})`)
  console.log('='.repeat(80))
  console.log(`  role_fit: ${haiku.role_fit}`)
  console.log(`  total keywords: ${haiku.matched.length + haiku.missing.length}`)
  printList('matched', haiku.matched)
  printList('missing', haiku.missing)

  console.log('\n' + '='.repeat(80))
  console.log(`SONNET (${SONNET})`)
  console.log('='.repeat(80))
  console.log(`  role_fit: ${sonnet.role_fit}`)
  console.log(`  total keywords: ${sonnet.matched.length + sonnet.missing.length}`)
  printList('matched', sonnet.matched)
  printList('missing', sonnet.missing)

  // Diff
  const haikuSet = new Set([...haiku.matched, ...haiku.missing])
  const sonnetOnlyMatched = sonnet.matched.filter(k => !haikuSet.has(k))
  const sonnetOnlyMissing = sonnet.missing.filter(k => !haikuSet.has(k))

  const sonnetSet = new Set([...sonnet.matched, ...sonnet.missing])
  const haikuOnlyMatched = haiku.matched.filter(k => !sonnetSet.has(k))
  const haikuOnlyMissing = haiku.missing.filter(k => !sonnetSet.has(k))

  // Overlap (agreement between models — the "safe" keywords)
  const overlap = [...haikuSet].filter(k => sonnetSet.has(k))

  console.log('\n' + '='.repeat(80))
  console.log('DIFF — what Sonnet found that Haiku missed')
  console.log('='.repeat(80))
  printList('matched (sonnet only)', sonnetOnlyMatched)
  printList('missing (sonnet only)', sonnetOnlyMissing)

  console.log('\n' + '='.repeat(80))
  console.log('DIFF — what Haiku found that Sonnet did not')
  console.log('='.repeat(80))
  printList('matched (haiku only)', haikuOnlyMatched)
  printList('missing (haiku only)', haikuOnlyMissing)

  console.log('\n' + '='.repeat(80))
  console.log('AGREEMENT — keywords both models returned')
  console.log('='.repeat(80))
  console.log(`  overlap count: ${overlap.length}`)
  console.log('  ' + overlap.join(', '))

  console.log('\n' + '='.repeat(80))
  console.log('CURRENTLY STORED IN DB')
  console.log('='.repeat(80))
  console.log(`  resume_fit: ${job.resume_fit}`)
  printList('keywords_matched', job.keywords_matched ?? [])

  const haikuTotal = haiku.matched.length + haiku.missing.length
  const sonnetTotal = sonnet.matched.length + sonnet.missing.length
  const agreement = haikuTotal > 0 && sonnetTotal > 0
    ? (overlap.length / Math.max(haikuTotal, sonnetTotal) * 100).toFixed(0)
    : '0'

  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  console.log(`  Haiku  total: ${haikuTotal.toString().padStart(3)} kw  |  role_fit ${haiku.role_fit}`)
  console.log(`  Sonnet total: ${sonnetTotal.toString().padStart(3)} kw  |  role_fit ${sonnet.role_fit}`)
  console.log(`  Overlap:     ${overlap.length.toString().padStart(3)} kw  |  ${agreement}% agreement`)
  console.log(`  role_fit gap: ${Math.abs(haiku.role_fit - sonnet.role_fit)} points`)
}

main().catch(err => { console.error(err); process.exit(1) })
