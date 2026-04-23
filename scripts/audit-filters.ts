// Runs every manually-imported job through the live polling filter pipeline
// and reports which ones would be blocked, by what, and surfaces ATS companies
// we're not yet polling.
//
// Usage: npx tsx --env-file=.env.local scripts/audit-filters.ts

import { createClient } from '@supabase/supabase-js'
import {
  isRoleExcluded,
  isSeniorityExcluded,
  setSeniorityConfig,
  setKeywordGroups,
  recompileKeywords,
} from '../packages/scoring/src'
import { ATS_COMPANIES } from '../supabase/functions/poll-ats/companies'

interface ImportedJob {
  id: string
  title: string | null
  company: string | null
  location: string | null
  url: string | null
  page_content: string | null
}

interface Verdict {
  job: ImportedJob
  passes: boolean
  firstBlock: string | null
  reason: string | null
}

// ─── Inline clones of processor.ts filters (Deno-only source) ────────────────

const ARTICLE_TITLE_START = /^(\d+\s+[\w\s]+(?:for|to|that|you|every|in\s+\d{4})|how\s+to\b|what\s+is\b|what\s+are\b|why\s+\w|the\s+(best|complete|definitive|ultimate|top)\b|best\s+practices|tips\s+for\b|guide\s+to\b|empowering\b|smarter\b|\d{4}:\s)/i
const ARTICLE_PHRASES = /\b(business model|revenue explained|\+\d+%|open source\s+(ai\s+)?tools|agile methodology|best practices|definitive guide|complete (guide|framework)|deep dive|what.s next for you|step-by-step|cheat sheet|case study)\b/i

function isArticleTitle(title: string): boolean {
  if (!title) return false
  return ARTICLE_TITLE_START.test(title) || ARTICLE_PHRASES.test(title)
}

function buildLocationRegex(locations: string[]): RegExp {
  const escaped = locations.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i')
}

function isLocationBlocked(location: string, regex: RegExp): boolean {
  if (!location) return false
  if (/\b(remote|hybrid|united states|usa|u\.s\.a?\.?|US)\b/i.test(location)) return false
  if (/,\s*[A-Z]{2}$/.test(location.trim())) return false
  return regex.test(location)
}

function isCompanyBlocked(company: string, blocked: Set<string>): boolean {
  return blocked.has(company.toLowerCase().trim())
}

// Must match processor.ts defaults
const DEFAULT_BLOCKED_COMPANIES = ['lensa', 'itjobswatch']
const DEFAULT_BLOCKED_LOCATIONS = [
  'UK','United Kingdom','England','Scotland','Wales','Ireland','Canada','Australia','New Zealand',
  'Germany','France','Spain','Italy','Netherlands','Sweden','Norway','Denmark','Finland','Switzerland',
  'Austria','Belgium','Poland','Portugal','Czech','Romania','Hungary','Singapore','Japan','South Korea',
  'Korea','China','Hong Kong','India','Brazil','Mexico','Argentina','Colombia','Chile','Israel','UAE',
  'Dubai','Qatar','Saudi Arabia','South Africa','Nigeria','Kenya','Amsterdam','Berlin','Munich','Hamburg',
  'London','Manchester','Edinburgh','Dublin','Paris','Lyon','Madrid','Barcelona','Rome','Milan','Stockholm',
  'Gothenburg','Oslo','Copenhagen','Helsinki','Zurich','Geneva','Vienna','Brussels','Warsaw','Prague',
  'Budapest','Toronto','Vancouver','Montreal','Calgary','Sydney','Melbourne','Brisbane','Auckland',
  'Tel Aviv','Bangalore','Mumbai','Delhi','Hyderabad','Chennai','São Paulo','Rio de Janeiro','Mexico City',
  'Buenos Aires','Bogotá','Santiago',
]

// ─── ATS platform detection from URL ─────────────────────────────────────────

type AtsType = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'icims' | 'workday' | 'unknown'

function decodeSlug(raw: string | null): string | null {
  if (!raw) return null
  try { return decodeURIComponent(raw) } catch { return raw }
}

function detectAts(url: string | null): { ats: AtsType; slug: string | null } {
  if (!url) return { ats: 'unknown', slug: null }
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const path = u.pathname

    // Greenhouse: boards.greenhouse.io/<slug>/jobs/... OR job-boards.greenhouse.io/<slug>/jobs/...
    if (host.endsWith('greenhouse.io')) {
      const m = path.match(/^\/(?:embed\/)?([^/]+)/)
      return { ats: 'greenhouse', slug: decodeSlug(m?.[1] ?? null) }
    }
    // Lever: jobs.lever.co/<slug>/...
    if (host === 'jobs.lever.co') {
      const m = path.match(/^\/([^/]+)/)
      return { ats: 'lever', slug: decodeSlug(m?.[1] ?? null) }
    }
    // Ashby: jobs.ashbyhq.com/<slug>/...
    if (host === 'jobs.ashbyhq.com') {
      const m = path.match(/^\/([^/]+)/)
      return { ats: 'ashby', slug: decodeSlug(m?.[1] ?? null) }
    }
    // SmartRecruiters: jobs.smartrecruiters.com/<slug>/...
    if (host.endsWith('smartrecruiters.com')) {
      const m = path.match(/^\/([^/]+)/)
      return { ats: 'smartrecruiters', slug: decodeSlug(m?.[1] ?? null) }
    }
    // iCIMS: careers-<slug>.icims.com / jobs-<slug>.icims.com / <slug>.icims.com
    if (host.endsWith('.icims.com')) {
      const m = host.match(/^(?:careers-|jobs-)?([^.]+)/)
      return { ats: 'icims', slug: m?.[1] ?? null }
    }
    // Workday: <tenant>.wd<N>.myworkdayjobs.com
    if (host.includes('.myworkdayjobs.com')) {
      return { ats: 'workday', slug: host.split('.')[0] }
    }
    return { ats: 'unknown', slug: null }
  } catch {
    return { ats: 'unknown', slug: null }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Load scoring config so the filters match runtime behavior
  const { data: configRows } = await supabase.from('scoring_config').select('key, value')
  const config: Record<string, unknown> = {}
  for (const row of configRows ?? []) {
    config[(row as { key: string }).key] = (row as { value: unknown }).value
  }
  if (config.keyword_groups) {
    setKeywordGroups(config.keyword_groups as never)
    recompileKeywords()
  }
  if (config.seniority_exclude || config.seniority_newgrad || config.non_design_titles) {
    setSeniorityConfig({
      exclude: config.seniority_exclude as string[] | undefined,
      newgrad: config.seniority_newgrad as string[] | undefined,
      nonDesign: config.non_design_titles as string[] | undefined,
    })
  }
  const blockedCompaniesArr = (config.blocked_companies as string[] | undefined) ?? DEFAULT_BLOCKED_COMPANIES
  const blockedLocationsArr = (config.blocked_locations as string[] | undefined) ?? DEFAULT_BLOCKED_LOCATIONS
  const blockedCompanies = new Set(blockedCompaniesArr.map((c) => c.toLowerCase().trim()))
  const blockedLocationRegex = buildLocationRegex(blockedLocationsArr)

  // Pull all manually-imported jobs
  const { data: jobs, error } = await supabase
    .from('job_postings')
    .select('id, title, company, location, url, page_content')
    .eq('source_type', 'manual')
    .order('first_seen', { ascending: true })

  if (error) {
    console.error('DB error:', error.message)
    process.exit(1)
  }

  const list = (jobs ?? []) as ImportedJob[]
  console.log(`Auditing ${list.length} manually-imported jobs against current filter pipeline\n`)

  // ── Per-job verdicts ──────────────────────────────────────────────────────

  const verdicts: Verdict[] = list.map((job) => {
    const title = (job.title ?? '').trim()
    const company = (job.company ?? '').trim()
    const location = (job.location ?? '').trim()

    if (title && isRoleExcluded(title)) {
      return { job, passes: false, firstBlock: 'title', reason: 'non-design role' }
    }
    if (location && isLocationBlocked(location, blockedLocationRegex)) {
      return { job, passes: false, firstBlock: 'location', reason: 'blocked location' }
    }
    if (company && isCompanyBlocked(company, blockedCompanies)) {
      return { job, passes: false, firstBlock: 'company', reason: 'blocked company' }
    }
    if (title && isArticleTitle(title)) {
      return { job, passes: false, firstBlock: 'article', reason: 'article/listicle title' }
    }
    if (title && isSeniorityExcluded(title, job.page_content ?? '')) {
      return { job, passes: false, firstBlock: 'seniority', reason: 'staff/principal/director/VP/manager' }
    }
    return { job, passes: true, firstBlock: null, reason: null }
  })

  const blocked = verdicts.filter((v) => !v.passes)
  const passPct = list.length === 0 ? 0 : Math.round(((list.length - blocked.length) / list.length) * 1000) / 10

  // Per-block summary
  const byReason = new Map<string, Verdict[]>()
  for (const v of blocked) {
    const key = `${v.firstBlock}: ${v.reason}`
    if (!byReason.has(key)) byReason.set(key, [])
    byReason.get(key)!.push(v)
  }

  console.log('─── BLOCKED IMPORTS ─────────────────────────────────────────────')
  if (blocked.length === 0) {
    console.log('(none — all manual imports pass the current filter pipeline)')
  } else {
    for (const [reason, vs] of byReason) {
      console.log(`\n[${reason}]  (${vs.length})`)
      for (const v of vs) {
        console.log(`  • ${v.job.company ?? '?'} — ${v.job.title ?? '?'} @ ${v.job.location ?? '?'}`)
      }
    }
  }
  console.log()

  // ── Company gap report ────────────────────────────────────────────────────

  const knownCompanies = new Set(ATS_COMPANIES.map((c) => c.name.toLowerCase().trim()))
  const knownSlugs = new Set(
    ATS_COMPANIES.map((c: (typeof ATS_COMPANIES)[number]) => {
      if (c.ats === 'workday') return ''
      return `${c.ats}:${c.slug}`
    }).filter(Boolean),
  )

  // Aggregate unique companies from imports, with their inferred ATS + slug
  const importCompanies = new Map<
    string,
    { displayName: string; urls: string[]; ats: AtsType; slug: string | null }
  >()
  for (const job of list) {
    const displayName = (job.company ?? '').trim()
    if (!displayName) continue
    const key = displayName.toLowerCase()
    const entry = importCompanies.get(key) ?? { displayName, urls: [], ats: 'unknown' as AtsType, slug: null }
    if (job.url) entry.urls.push(job.url)
    // Prefer the first confident ATS detection
    if (entry.ats === 'unknown') {
      const detected = detectAts(job.url)
      if (detected.ats !== 'unknown') {
        entry.ats = detected.ats
        entry.slug = detected.slug
      }
    }
    importCompanies.set(key, entry)
  }

  const gaps = [...importCompanies.values()].filter((entry) => {
    if (knownCompanies.has(entry.displayName.toLowerCase())) return false
    if (entry.ats !== 'unknown' && entry.slug) {
      return !knownSlugs.has(`${entry.ats}:${entry.slug}`)
    }
    return true
  })

  console.log('─── COMPANY GAP REPORT ──────────────────────────────────────────')
  console.log(`${gaps.length} companies from your manual imports are NOT in poll-ats/companies.ts`)
  console.log()

  const byAts = new Map<AtsType, typeof gaps>()
  for (const g of gaps) {
    if (!byAts.has(g.ats)) byAts.set(g.ats, [])
    byAts.get(g.ats)!.push(g)
  }

  const order: AtsType[] = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'icims', 'workday', 'unknown']
  for (const ats of order) {
    const group = byAts.get(ats)
    if (!group || group.length === 0) continue
    console.log(`── ${ats.toUpperCase()} (${group.length}) ──`)
    for (const g of group.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
      if (ats === 'unknown') {
        console.log(`  • ${g.displayName}`)
        if (g.urls[0]) console.log(`      sample URL: ${g.urls[0]}`)
      } else if (ats === 'workday') {
        console.log(`  • ${g.displayName}  (tenant=${g.slug ?? '?'}; needs manual host/site lookup)`)
      } else {
        console.log(`  { name: '${g.displayName}', ats: '${ats}', slug: '${g.slug}' },`)
      }
    }
    console.log()
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('─── SUMMARY ─────────────────────────────────────────────────────')
  console.log(`Imports scanned     : ${list.length}`)
  console.log(`Pass all filters    : ${list.length - blocked.length}  (${passPct}%)`)
  console.log(`Blocked             : ${blocked.length}`)
  console.log(`ATS whitelist size  : ${ATS_COMPANIES.length}`)
  console.log(`Company gaps found  : ${gaps.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
