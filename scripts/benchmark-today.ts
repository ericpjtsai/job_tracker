// Full review + pair benchmarking for all manually-imported jobs from today.
// For each job: calls Haiku and Sonnet in parallel on the calibrated prompt,
// validates both responses, and prints a per-job row plus aggregate stats.
//
// Cost: ~20 Sonnet calls + 20 Haiku calls ≈ $$. Run sparingly.
//
// Usage: ANTHROPIC_API_KEY=sk-ant-... npx tsx --env-file=.env.local scripts/benchmark-today.ts

import { createClient } from '@supabase/supabase-js'
import { buildPrompt, classifyLLMKeywords, applyTitleCeilings } from '../packages/scoring/src/llm-keywords'
import { callClaude, parseKeywordResponse, HAIKU, SONNET } from './_shared/claude'
import { getPTMidnightToday } from './_shared/time'

interface Row {
  company: string
  title: string
  jdLen: number
  haikuTotal: number
  sonnetTotal: number
  haikuFit: number
  sonnetFit: number
  overlap: number
  agreement: number
  fitGap: number
  haikuKeywords: string[]
  sonnetKeywords: string[]
  error?: string
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) { console.error('No ANTHROPIC_API_KEY set'); process.exit(1) }

  const todayMidnight = getPTMidnightToday()
  console.log(`Querying manual jobs since ${todayMidnight}`)

  const { data: resume } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
    .eq('resume_type', 'ats')
    .single()
  const resumeKeywords: string[] = (resume as any)?.keywords_extracted ?? []

  const { data: jobs, error } = await supabase
    .from('job_postings')
    .select('id, title, company, page_content')
    .eq('source_type', 'manual')
    .gte('first_seen', todayMidnight)
    .not('page_content', 'is', null)
    .order('first_seen', { ascending: true })

  if (error) { console.error(error.message); return }
  const list = (jobs ?? []).filter((j: any) => j.page_content && j.page_content.length >= 200)
  console.log(`Jobs to benchmark: ${list.length}`)
  console.log()

  const rows: Row[] = []

  for (let i = 0; i < list.length; i++) {
    const job = list[i] as any
    const label = `[${i + 1}/${list.length}] ${job.company} — ${job.title}`
    process.stdout.write(`${label} ... `)

    try {
      const prompt = buildPrompt(job.page_content, resumeKeywords)
      const [haikuRaw, sonnetRaw] = await Promise.all([
        callClaude(HAIKU, prompt, anthropicKey, { maxTokens: 4000, timeoutMs: 90_000 }),
        callClaude(SONNET, prompt, anthropicKey, { maxTokens: 4000, timeoutMs: 90_000 }),
      ])
      const haikuParsed = parseKeywordResponse(haikuRaw)
      const sonnetParsed = parseKeywordResponse(sonnetRaw)
      if (!haikuParsed || !sonnetParsed) throw new Error('parse failed')

      const haikuClassified = classifyLLMKeywords(haikuParsed, job.page_content, resumeKeywords)
      const sonnetClassified = classifyLLMKeywords(sonnetParsed, job.page_content, resumeKeywords)
      const haiku = applyTitleCeilings(job.title ?? '', haikuClassified)
      const sonnet = applyTitleCeilings(job.title ?? '', sonnetClassified)

      const haikuSet = new Set([...haiku.matched, ...haiku.missing])
      const sonnetSet = new Set([...sonnet.matched, ...sonnet.missing])
      const overlap = [...haikuSet].filter(k => sonnetSet.has(k)).length
      const haikuTotal = haikuSet.size
      const sonnetTotal = sonnetSet.size
      const union = new Set([...haikuSet, ...sonnetSet]).size
      const agreement = union > 0 ? Math.round((overlap / union) * 100) : 0
      const fitGap = haiku.role_fit - sonnet.role_fit

      const row: Row = {
        company: job.company,
        title: job.title,
        jdLen: job.page_content.length,
        haikuTotal,
        sonnetTotal,
        haikuFit: haiku.role_fit,
        sonnetFit: sonnet.role_fit,
        overlap,
        agreement,
        fitGap,
        haikuKeywords: [...haikuSet],
        sonnetKeywords: [...sonnetSet],
      }
      rows.push(row)
      console.log(
        `H:${haikuTotal}kw/${haiku.role_fit}% · S:${sonnetTotal}kw/${sonnet.role_fit}% · ` +
        `agree ${agreement}% · gap ${fitGap > 0 ? '+' : ''}${fitGap}`
      )
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`)
      rows.push({
        company: job.company, title: job.title, jdLen: job.page_content.length,
        haikuTotal: 0, sonnetTotal: 0, haikuFit: 0, sonnetFit: 0,
        overlap: 0, agreement: 0, fitGap: 0,
        haikuKeywords: [], sonnetKeywords: [],
        error: String(err),
      })
    }
  }

  const ok = rows.filter(r => !r.error)

  console.log('\n' + '='.repeat(100))
  console.log('PER-JOB RESULTS')
  console.log('='.repeat(100))
  console.log(
    'Company/Title'.padEnd(50) +
    'Hkw '.padStart(6) +
    'Skw '.padStart(6) +
    'Hfit'.padStart(6) +
    'Sfit'.padStart(6) +
    'Agr%'.padStart(6) +
    ' Gap'.padStart(7)
  )
  console.log('-'.repeat(100))
  for (const r of rows) {
    const label = `${r.company} — ${r.title}`.slice(0, 49).padEnd(50)
    if (r.error) {
      console.log(label + '  ERROR: ' + r.error.slice(0, 40))
      continue
    }
    const gapStr = (r.fitGap > 0 ? '+' : '') + r.fitGap
    console.log(
      label +
      String(r.haikuTotal).padStart(5) + ' ' +
      String(r.sonnetTotal).padStart(5) + ' ' +
      String(r.haikuFit).padStart(5) + ' ' +
      String(r.sonnetFit).padStart(5) + ' ' +
      String(r.agreement).padStart(5) + ' ' +
      gapStr.padStart(6)
    )
  }

  console.log('\n' + '='.repeat(100))
  console.log('AGGREGATE STATS (successful runs only)')
  console.log('='.repeat(100))
  console.log(`  Runs: ${ok.length}/${rows.length}`)
  console.log(`  Haiku  kw:  mean ${mean(ok.map(r => r.haikuTotal)).toFixed(1)}  median ${median(ok.map(r => r.haikuTotal))}  min ${Math.min(...ok.map(r => r.haikuTotal))}  max ${Math.max(...ok.map(r => r.haikuTotal))}`)
  console.log(`  Sonnet kw:  mean ${mean(ok.map(r => r.sonnetTotal)).toFixed(1)}  median ${median(ok.map(r => r.sonnetTotal))}  min ${Math.min(...ok.map(r => r.sonnetTotal))}  max ${Math.max(...ok.map(r => r.sonnetTotal))}`)
  console.log(`  Haiku  fit: mean ${mean(ok.map(r => r.haikuFit)).toFixed(1)}  median ${median(ok.map(r => r.haikuFit))}`)
  console.log(`  Sonnet fit: mean ${mean(ok.map(r => r.sonnetFit)).toFixed(1)}  median ${median(ok.map(r => r.sonnetFit))}`)
  console.log(`  Agreement:  mean ${mean(ok.map(r => r.agreement)).toFixed(1)}%  median ${median(ok.map(r => r.agreement))}%`)
  console.log(`  role_fit gap (Haiku - Sonnet):`)
  console.log(`    mean bias:   ${mean(ok.map(r => r.fitGap)).toFixed(1)} (positive = Haiku generous)`)
  console.log(`    mean |gap|:  ${mean(ok.map(r => Math.abs(r.fitGap))).toFixed(1)}`)
  console.log(`    max over:    ${Math.max(...ok.map(r => r.fitGap))} (Haiku most over-scoring)`)
  console.log(`    max under:   ${Math.min(...ok.map(r => r.fitGap))} (Haiku most under-scoring)`)

  // Outliers
  const biggestGap = [...ok].sort((a, b) => Math.abs(b.fitGap) - Math.abs(a.fitGap)).slice(0, 5)
  console.log('\n  Top 5 role_fit disagreements:')
  for (const r of biggestGap) {
    const sign = r.fitGap > 0 ? '+' : ''
    console.log(`    ${sign}${r.fitGap}  ${r.company} — ${r.title}  (H ${r.haikuFit} / S ${r.sonnetFit})`)
  }

  const lowestAgreement = [...ok].sort((a, b) => a.agreement - b.agreement).slice(0, 5)
  console.log('\n  Top 5 lowest keyword agreement:')
  for (const r of lowestAgreement) {
    console.log(`    ${r.agreement}%  ${r.company} — ${r.title}  (H ${r.haikuTotal}kw / S ${r.sonnetTotal}kw, overlap ${r.overlap})`)
  }

  // Write keywords to JSON for regex calibration
  const fs = await import('node:fs')
  const outPath = 'scripts/.benchmark-keywords.json'
  fs.writeFileSync(outPath, JSON.stringify(rows.filter(r => !r.error).map(r => ({
    company: r.company,
    title: r.title,
    haiku: r.haikuKeywords,
    sonnet: r.sonnetKeywords,
  })), null, 2))
  console.log(`\n  Keywords saved to ${outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
