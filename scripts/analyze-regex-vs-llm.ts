// Compare regex keyword taxonomy against LLM-extracted keywords across today's
// manual imports. Surfaces: (1) high-frequency LLM terms missing from regex,
// (2) regex terms never found in any LLM result (dead weight candidates).

import { createClient } from '@supabase/supabase-js'
import { ALL_TERMS, KEYWORD_GROUPS } from '../packages/scoring/src/keywords'

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const today = '2026-04-08T07:00:00.000Z'
  const { data } = await s.from('job_postings')
    .select('keywords_matched')
    .eq('source_type', 'manual')
    .gte('first_seen', today)
  const jobs = (data ?? []) as Array<{ keywords_matched: string[] | null }>

  const freq = new Map<string, number>()
  for (const job of jobs) {
    for (const k of job.keywords_matched ?? []) {
      const norm = k.toLowerCase().trim()
      freq.set(norm, (freq.get(norm) ?? 0) + 1)
    }
  }

  const regexSet = new Set(ALL_TERMS.map(t => t.toLowerCase()))
  const llmSet = new Set(freq.keys())

  console.log(`Jobs analyzed: ${jobs.length}`)
  console.log(`Unique LLM keywords: ${freq.size}`)
  console.log(`Regex taxonomy size: ${ALL_TERMS.length}`)

  console.log('\n=== LLM keywords NOT in regex (freq ≥ 2) ===')
  const missing = [...freq.entries()]
    .filter(([k, v]) => v >= 2 && !regexSet.has(k))
    .sort((a, b) => b[1] - a[1])
  missing.forEach(([k, v]) => console.log(`  ${String(v).padStart(2)} | ${k}`))

  console.log('\n=== LLM keywords NOT in regex (freq = 1, sample of 60) ===')
  const singletons = [...freq.entries()]
    .filter(([k, v]) => v === 1 && !regexSet.has(k))
    .map(([k]) => k)
  console.log(`  total: ${singletons.length}`)
  console.log('  ' + singletons.slice(0, 60).join(', '))

  console.log('\n=== Regex terms NEVER found by LLM ===')
  const deadweight = ALL_TERMS.filter(t => !llmSet.has(t.toLowerCase()))
  console.log(`  total: ${deadweight.length} / ${ALL_TERMS.length}`)
  // Group by category
  for (const g of KEYWORD_GROUPS) {
    const dead = g.terms.filter(t => !llmSet.has(t.toLowerCase()))
    console.log(`  [${g.name}]: ${dead.length}/${g.terms.length} unused`)
    console.log(`    ${dead.join(', ')}`)
  }
}
main().catch(console.error)
