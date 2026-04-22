// Compare regex computeResumeFit against Haiku's role_fit across all
// enrichment_status='done' rows. Surfaces the gap so we can recalibrate
// packages/scoring/src/score.ts and keyword weights.
//
// Usage: npx tsx --env-file=.env.local scripts/analyze-fit-gap.ts

import { createClient } from '@supabase/supabase-js'
import {
  scorePosting,
  computeResumeFit,
  setKeywordGroups,
  setSeniorityConfig,
  recompileKeywords,
} from '../packages/scoring/src/index'

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n === 0) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  const denom = Math.sqrt(dx * dy)
  return denom === 0 ? 0 : num / denom
}

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Load scoring config (so regex re-score matches prod behavior)
  const { data: cfg } = await s.from('scoring_config').select('key, value')
  const config: Record<string, any> = {}
  for (const r of cfg ?? []) config[(r as any).key] = (r as any).value
  if (config.keyword_groups) { setKeywordGroups(config.keyword_groups); recompileKeywords() }
  if (config.seniority_exclude || config.seniority_newgrad || config.non_design_titles) {
    setSeniorityConfig({
      exclude: config.seniority_exclude,
      newgrad: config.seniority_newgrad,
      nonDesign: config.non_design_titles,
    })
  }

  // Load active ATS resume keywords
  const { data: resume } = await s.from('resume_versions')
    .select('keywords_extracted').eq('is_active', true).eq('resume_type', 'ats').single()
  const resumeKeywords: string[] = (resume as any)?.keywords_extracted ?? []
  console.log(`Resume keywords: ${resumeKeywords.length}`)

  // Pull all Haiku-enriched jobs with content
  const { data: jobs } = await s.from('job_postings')
    .select('id, title, company, location, url, page_content, resume_fit, score_breakdown')
    .eq('enrichment_status', 'done')
    .not('resume_fit', 'is', null)
    .not('page_content', 'is', null)

  const rows = (jobs ?? []).filter((j: any) => (j.page_content ?? '').length > 200) as any[]
  console.log(`Haiku-enriched rows: ${rows.length}`)

  type Sample = {
    id: string; title: string; company: string
    haiku_fit: number; regex_fit: number; delta: number
    total: number; matched_count: number; intersection: number
    breakdown: Record<string, number>
  }
  const samples: Sample[] = []

  for (const job of rows) {
    const text = stripHtml(job.page_content || '')
    if (text.length < 50) continue
    const result = scorePosting({
      text,
      title: job.title ?? '',
      company: job.company ?? '',
      location: job.location ?? '',
      url: job.url,
    })
    const regex_fit = computeResumeFit(result.keywords_matched, resumeKeywords)
    const haiku_fit = job.resume_fit as number
    const resumeSet = new Set(resumeKeywords.map(k => k.toLowerCase()))
    const intersection = result.keywords_matched.filter(k => resumeSet.has(k.toLowerCase())).length
    samples.push({
      id: job.id, title: job.title, company: job.company,
      haiku_fit, regex_fit, delta: haiku_fit - regex_fit,
      total: result.total, matched_count: result.keywords_matched.length,
      intersection,
      breakdown: result.breakdown as any,
    })
  }

  const N = samples.length
  const deltas = samples.map(s => s.delta)
  const mean = deltas.reduce((a, b) => a + b, 0) / N
  const sorted = [...deltas].sort((a, b) => a - b)
  const median = sorted[Math.floor(N / 2)]
  const stdev = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / N)

  console.log(`\n=== Delta = haiku_fit − regex_fit (N=${N}) ===`)
  console.log(`  mean:   ${mean.toFixed(1)}`)
  console.log(`  median: ${median.toFixed(1)}`)
  console.log(`  stdev:  ${stdev.toFixed(1)}`)
  console.log(`  range:  ${sorted[0].toFixed(0)} to ${sorted[N - 1].toFixed(0)}`)

  // Histogram
  console.log(`\n  histogram (buckets of 10):`)
  const buckets = new Map<number, number>()
  for (const d of deltas) {
    const b = Math.floor(d / 10) * 10
    buckets.set(b, (buckets.get(b) ?? 0) + 1)
  }
  const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  const maxCount = Math.max(...sortedBuckets.map(([, c]) => c))
  for (const [b, c] of sortedBuckets) {
    const bar = '█'.repeat(Math.round((c / maxCount) * 30))
    const label = `${b >= 0 ? '+' : ''}${b}`.padStart(4)
    console.log(`    ${label}..${(b + 9)}: ${bar} ${c}`)
  }

  // Worst underscoring (regex way below haiku — missing signals)
  console.log(`\n=== TOP 15 UNDERSCORING (regex too low, we're missing things) ===`)
  const under = [...samples].sort((a, b) => b.delta - a.delta).slice(0, 15)
  for (const s of under) {
    console.log(`  Δ+${s.delta.toFixed(0).padStart(3)} | haiku=${s.haiku_fit}% regex=${s.regex_fit}% | total=${s.total} kw=${s.matched_count} | ${s.company} — ${s.title?.slice(0, 55)}`)
  }

  // Worst overscoring (regex way above haiku — crediting noise)
  console.log(`\n=== TOP 15 OVERSCORING (regex too high, we're crediting noise) ===`)
  const over = [...samples].sort((a, b) => a.delta - b.delta).slice(0, 15)
  for (const s of over) {
    console.log(`  Δ${s.delta.toFixed(0).padStart(4)} | haiku=${s.haiku_fit}% regex=${s.regex_fit}% | total=${s.total} kw=${s.matched_count} | ${s.company} — ${s.title?.slice(0, 55)}`)
  }

  // Per-category correlation with haiku_fit
  console.log(`\n=== Pearson correlation of regex category → haiku_fit ===`)
  const cats = ['b2b_domain', 'ai_emerging', 'core_design', 'methods', 'soft_skills', 'tools', 'seniority_bonus', 'location_bonus'] as const
  const haikuVals = samples.map(s => s.haiku_fit)
  for (const c of cats) {
    const vals = samples.map(s => s.breakdown[c] ?? 0)
    const r = pearson(vals, haikuVals)
    const mean = vals.reduce((a, b) => a + b, 0) / N
    console.log(`  ${c.padEnd(16)} r=${r.toFixed(3).padStart(6)}   mean=${mean.toFixed(1)}`)
  }

  // Matched-keyword-count vs haiku_fit
  const mcr = pearson(samples.map(s => s.matched_count), haikuVals)
  const tr = pearson(samples.map(s => s.total), haikuVals)
  console.log(`  matched_count    r=${mcr.toFixed(3).padStart(6)}`)
  console.log(`  total (regex)    r=${tr.toFixed(3).padStart(6)}`)

  // Bucket by intersection count (direct input to computeResumeFit)
  console.log(`\n=== Mean haiku_fit by INTERSECTION count (posting∩resume keywords) ===`)
  console.log(`  this is what computeResumeFit actually consumes — use to recalibrate its curve`)
  const ibuckets = new Map<number, number[]>()
  for (const s of samples) {
    const b = Math.min(s.intersection, 25)
    if (!ibuckets.has(b)) ibuckets.set(b, [])
    ibuckets.get(b)!.push(s.haiku_fit)
  }
  const sortedInt = [...ibuckets.entries()].sort((a, b) => a[0] - b[0])
  console.log(`  ${'int'.padStart(4)}  n   mean   median   p25   p75   range`)
  for (const [k, arr] of sortedInt) {
    arr.sort((a, b) => a - b)
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length
    const median = arr[Math.floor(arr.length / 2)]
    const p25 = arr[Math.floor(arr.length * 0.25)]
    const p75 = arr[Math.floor(arr.length * 0.75)]
    const label = k === 25 ? '25+' : String(k)
    console.log(`  ${label.padStart(4)}  ${String(arr.length).padStart(3)}  ${mean.toFixed(1).padStart(5)}  ${String(median).padStart(6)}  ${String(p25).padStart(4)}  ${String(p75).padStart(4)}  ${arr[0]}-${arr[arr.length - 1]}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
