// One-off calibration: run Claude Opus 4.6 vs Claude Haiku 4.5 against Decagon's
// job posting using the EXACT same prompt extractKeywordsLLM uses, and print a
// side-by-side comparison so we can see which keywords Haiku is missing.
//
// Usage: ANTHROPIC_API_KEY=sk-ant-... npx tsx --env-file=.env.local scripts/calibrate-opus-decagon.ts

import { createClient } from '@supabase/supabase-js'
import { buildPrompt, validateKeywords, type LLMKeywordResult } from '../packages/scoring/src/llm-keywords'

const HAIKU = 'claude-haiku-4-5-20251001'
const OPUS = 'claude-opus-4-6'

async function callClaude(model: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`${model} ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

function parseResponse(text: string): LLMKeywordResult | null {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
    if (!Array.isArray(parsed.matched) || !Array.isArray(parsed.missing)) return null
    const matched = [...new Set<string>(parsed.matched.map((k: string) => k.trim().toLowerCase()).filter(Boolean))]
    const matchedSet = new Set(matched)
    const missing = [...new Set<string>(parsed.missing.map((k: string) => k.trim().toLowerCase()).filter(Boolean))]
      .filter(k => !matchedSet.has(k))
    const role_fit = typeof parsed.role_fit === 'number' ? Math.max(0, Math.min(100, parsed.role_fit)) : 50
    return { matched, missing, role_fit }
  } catch {
    return null
  }
}

function printList(label: string, items: string[]) {
  console.log(`  ${label} (${items.length}):`)
  if (items.length === 0) console.log('    (none)')
  else console.log('    ' + items.join(', '))
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) { console.error('No ANTHROPIC_API_KEY set'); process.exit(1) }

  // Fetch most recent Decagon job with JD content
  const { data: jobs, error: jobErr } = await supabase
    .from('job_postings')
    .select('id, title, company, page_content, keywords_matched, resume_fit')
    .ilike('company', '%decagon%')
    .not('page_content', 'is', null)
    .order('first_seen', { ascending: false })
    .limit(1)

  if (jobErr || !jobs || jobs.length === 0) {
    console.error('No Decagon job found:', jobErr?.message)
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

  console.log('Calling Haiku and Opus in parallel...')
  const [haikuRaw, opusRaw] = await Promise.all([
    callClaude(HAIKU, prompt, anthropicKey),
    callClaude(OPUS, prompt, anthropicKey),
  ])

  const haikuParsed = parseResponse(haikuRaw)
  const opusParsed = parseResponse(opusRaw)
  if (!haikuParsed || !opusParsed) {
    console.error('Failed to parse one or both responses')
    console.error('HAIKU raw:', haikuRaw)
    console.error('OPUS raw:', opusRaw)
    process.exit(1)
  }

  const haiku = validateKeywords(haikuParsed, job.page_content, resumeKeywords)
  const opus = validateKeywords(opusParsed, job.page_content, resumeKeywords)

  console.log('\n' + '='.repeat(80))
  console.log('HAIKU (claude-haiku-4-5-20251001)')
  console.log('='.repeat(80))
  console.log(`  role_fit: ${haiku.role_fit}`)
  console.log(`  total keywords: ${haiku.matched.length + haiku.missing.length}`)
  printList('matched', haiku.matched)
  printList('missing', haiku.missing)

  console.log('\n' + '='.repeat(80))
  console.log('OPUS (claude-opus-4-6)')
  console.log('='.repeat(80))
  console.log(`  role_fit: ${opus.role_fit}`)
  console.log(`  total keywords: ${opus.matched.length + opus.missing.length}`)
  printList('matched', opus.matched)
  printList('missing', opus.missing)

  // Diff: what Opus found that Haiku missed
  const haikuSet = new Set([...haiku.matched, ...haiku.missing])
  const opusOnlyMatched = opus.matched.filter(k => !haikuSet.has(k))
  const opusOnlyMissing = opus.missing.filter(k => !haikuSet.has(k))

  const opusSet = new Set([...opus.matched, ...opus.missing])
  const haikuOnlyMatched = haiku.matched.filter(k => !opusSet.has(k))
  const haikuOnlyMissing = haiku.missing.filter(k => !opusSet.has(k))

  console.log('\n' + '='.repeat(80))
  console.log('DIFF — what Opus found that Haiku missed')
  console.log('='.repeat(80))
  printList('matched (opus only)', opusOnlyMatched)
  printList('missing (opus only)', opusOnlyMissing)

  console.log('\n' + '='.repeat(80))
  console.log('DIFF — what Haiku found that Opus did not')
  console.log('='.repeat(80))
  printList('matched (haiku only)', haikuOnlyMatched)
  printList('missing (haiku only)', haikuOnlyMissing)

  console.log('\n' + '='.repeat(80))
  console.log('CURRENTLY STORED IN DB (from last enrich run)')
  console.log('='.repeat(80))
  console.log(`  resume_fit: ${job.resume_fit}`)
  printList('keywords_matched', job.keywords_matched ?? [])

  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  console.log(`  Haiku total: ${haiku.matched.length + haiku.missing.length} kw  |  role_fit ${haiku.role_fit}`)
  console.log(`  Opus  total: ${opus.matched.length + opus.missing.length} kw  |  role_fit ${opus.role_fit}`)
  console.log(`  Gap:         ${opus.matched.length + opus.missing.length - haiku.matched.length - haiku.missing.length} more keywords in Opus`)
}

main().catch(err => { console.error(err); process.exit(1) })
