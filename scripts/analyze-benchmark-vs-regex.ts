// Analyze benchmark keywords (from .benchmark-keywords.json) against the
// regex taxonomy. Surfaces keywords that Sonnet found that neither Haiku
// nor the regex covers — these are the biggest regex gaps.

import { readFileSync } from 'node:fs'
import { ALL_TERMS } from '../packages/scoring/src/keywords'

interface BenchmarkRow {
  company: string
  title: string
  haiku: string[]
  sonnet: string[]
}

function main() {
  const data = JSON.parse(readFileSync('scripts/.benchmark-keywords.json', 'utf8')) as BenchmarkRow[]
  const regexSet = new Set(ALL_TERMS.map(t => t.toLowerCase()))

  const haikuFreq = new Map<string, number>()
  const sonnetFreq = new Map<string, number>()
  const unionFreq = new Map<string, number>()

  for (const row of data) {
    const seen = new Set<string>()
    for (const k of row.haiku) {
      const norm = k.toLowerCase().trim()
      haikuFreq.set(norm, (haikuFreq.get(norm) ?? 0) + 1)
      seen.add(norm)
    }
    for (const k of row.sonnet) {
      const norm = k.toLowerCase().trim()
      sonnetFreq.set(norm, (sonnetFreq.get(norm) ?? 0) + 1)
      seen.add(norm)
    }
    for (const k of seen) unionFreq.set(k, (unionFreq.get(k) ?? 0) + 1)
  }

  console.log(`Jobs: ${data.length}`)
  console.log(`Haiku unique kw: ${haikuFreq.size}`)
  console.log(`Sonnet unique kw: ${sonnetFreq.size}`)
  console.log(`Union unique kw: ${unionFreq.size}`)
  console.log(`Regex terms: ${ALL_TERMS.length}`)

  // Union freq ≥ 2, not in regex — highest value additions
  const gaps = [...unionFreq.entries()]
    .filter(([k, v]) => v >= 2 && !regexSet.has(k))
    .sort((a, b) => b[1] - a[1])
  console.log(`\n=== UNION (Haiku + Sonnet) keywords with freq ≥ 2, NOT in regex ===`)
  console.log(`Total: ${gaps.length}`)
  gaps.forEach(([k, v]) => console.log(`  ${String(v).padStart(2)} | ${k}`))

  // Sonnet-only keywords with freq ≥ 2 (Haiku never returned them, not in regex)
  const sonnetOnly = [...sonnetFreq.entries()]
    .filter(([k, v]) => v >= 2 && !haikuFreq.has(k) && !regexSet.has(k))
    .sort((a, b) => b[1] - a[1])
  console.log(`\n=== SONNET-ONLY keywords with freq ≥ 2, NOT in regex ===`)
  console.log(`(these are what Haiku misses that Sonnet catches)`)
  console.log(`Total: ${sonnetOnly.length}`)
  sonnetOnly.forEach(([k, v]) => console.log(`  ${String(v).padStart(2)} | ${k}`))

  // Haiku-only keywords with freq ≥ 2 (Sonnet never returned them)
  const haikuOnly = [...haikuFreq.entries()]
    .filter(([k, v]) => v >= 2 && !sonnetFreq.has(k) && !regexSet.has(k))
    .sort((a, b) => b[1] - a[1])
  console.log(`\n=== HAIKU-ONLY keywords with freq ≥ 2, NOT in regex ===`)
  console.log(`(Haiku found these, Sonnet didn't — may be more verbose/noisy)`)
  console.log(`Total: ${haikuOnly.length}`)
  haikuOnly.forEach(([k, v]) => console.log(`  ${String(v).padStart(2)} | ${k}`))
}
main()
