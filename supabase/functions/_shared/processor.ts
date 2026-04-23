// Per-event processor: filter, dedup, score, insert.
// PORTED from apps/listener/src/processor.ts with these changes:
//   - Resume keywords + scoring config are loaded once per invocation (no shared state)
//   - LLM enrichment is NOT inline — new rows are written with enrichment_status='pending'
//     and the enrich-batch Edge Function picks them up async (cron'd every 2 min)
//   - processorStats counters removed (Edge Functions are stateless; derive from job_postings)
//   - Uses node:crypto via Deno's Node compat for sha256

import { createHash } from 'node:crypto'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.43.0'
import {
  scorePosting,
  computeResumeFit,
  isRoleExcluded,
  setKeywordGroups,
  setSeniorityConfig,
  recompileKeywords,
} from './scoring/index.ts'

// ─── URL normalization & hashing ─────────────────────────────────────────────

export function canonicalLinkedInUrl(rawUrl: string): string {
  const m = rawUrl.match(/linkedin\.com\/jobs\/(?:view|collections)\/(\d+)/)
  if (m) return `https://www.linkedin.com/jobs/view/${m[1]}`
  return normalizeUrl(rawUrl)
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    const STRIP = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source']
    STRIP.forEach((p) => u.searchParams.delete(p))
    return u.toString().replace(/\/$/, '')
  } catch {
    return url.trim()
  }
}

export function sha256(str: string): string {
  return createHash('sha256').update(str).digest('hex')
}

// Return a parseable ISO string, or null if the input is missing / unparseable.
// Callers fall back to now() to avoid inserting jobs with invalid dates (CLAUDE.md rule).
export function parsePublishedAt(v: string | undefined | null): string | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// ─── Location extraction ──────────────────────────────────────────────────────

const LOCATION_PATTERNS = [
  /(?:location|based in|office(?:\s+location)?|where you.ll work)[:\s]+([A-Z][A-Za-z\s,]+?)(?:\s*[\n|•]|$)/i,
  /\b(Remote|Hybrid|Remote-first|Fully Remote)\b/i,
  /\b([A-Z][a-z]+(?:[\s,]+[A-Z]{2})?)(?=\s*(?:,\s*(?:USA?|United States)|[\n•]|$))/,
]

export function extractLocation(text: string): string {
  for (const pattern of LOCATION_PATTERNS) {
    const match = text.match(pattern)
    if (match) return match[1].trim()
  }
  return ''
}

// ─── Article/blog title detection ─────────────────────────────────────────────

const ARTICLE_TITLE_START = /^(\d+\s+[\w\s]+(?:for|to|that|you|every|in\s+\d{4})|how\s+to\b|what\s+is\b|what\s+are\b|why\s+\w|the\s+(best|complete|definitive|ultimate|top)\b|best\s+practices|tips\s+for\b|guide\s+to\b|empowering\b|smarter\b|\d{4}:\s)/i
const ARTICLE_PHRASES = /\b(business model|revenue explained|\+\d+%|open source\s+(ai\s+)?tools|agile methodology|best practices|definitive guide|complete (guide|framework)|deep dive|what.s next for you|step-by-step|cheat sheet|case study)\b/i

function isArticleTitle(title: string): boolean {
  if (!title) return false
  return ARTICLE_TITLE_START.test(title) || ARTICLE_PHRASES.test(title)
}

// ─── Per-invocation context ───────────────────────────────────────────────────
// Loaded once at the start of each Edge Function invocation, then passed to
// insertJobPosting() so the processor remains stateless.

export interface ProcessorContext {
  supabase: SupabaseClient
  resumeKeywords: string[]            // active resume keywords (or [] if none)
  blockedCompanies: Set<string>
  blockedLocationRegex: RegExp
}

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

function buildLocationRegex(locations: string[]): RegExp {
  const escaped = locations.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i')
}

/**
 * Build a ProcessorContext for the current Edge Function invocation.
 * Loads scoring config, blocked companies/locations, and active resume keywords from DB.
 */
export async function buildContext(supabase: SupabaseClient): Promise<ProcessorContext> {
  // Load scoring config (keyword groups, seniority, blocklists)
  const { data: configRows } = await supabase.from('scoring_config').select('key, value')
  const config: Record<string, unknown> = {}
  for (const row of configRows ?? []) config[(row as { key: string }).key] = (row as { value: unknown }).value

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

  // Load active resume keywords (one row per process)
  const { data: resume } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
    .eq('resume_type', 'ats')
    .maybeSingle()
  const resumeKeywords: string[] = ((resume as { keywords_extracted?: string[] } | null)?.keywords_extracted) ?? []

  return { supabase, resumeKeywords, blockedCompanies, blockedLocationRegex }
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function isCompanyBlocked(company: string, blocked: Set<string>): boolean {
  return blocked.has(company.toLowerCase().trim())
}

function isLocationBlocked(location: string, regex: RegExp): boolean {
  if (!location) return false
  if (/\b(remote|hybrid|united states|usa|u\.s\.a?\.?|US)\b/i.test(location)) return false
  if (/,\s*[A-Z]{2}$/.test(location.trim())) return false
  return regex.test(location)
}

function cleanTitle(title: string): string {
  return title.replace(/^apply\s*now\s*/i, '').trim()
}

// ─── Insert ───────────────────────────────────────────────────────────────────

export interface InsertJobOpts {
  url: string
  title: string
  company: string
  location: string
  description: string
  source: string
  publishedAt?: string
}

export interface InsertResult {
  status: 'inserted' | 'deduped' | 'blocked' | 'skipped'
  reason?: string
}

export async function insertJobPosting(
  ctx: ProcessorContext,
  opts: InsertJobOpts,
): Promise<InsertResult> {
  const { supabase, resumeKeywords, blockedCompanies, blockedLocationRegex } = ctx
  const normalizedUrl = canonicalLinkedInUrl(opts.url)
  const urlHash = sha256(normalizedUrl)
  opts.title = cleanTitle(opts.title)

  // ── Pre-filters (before dedup to save DB calls) ──────────────────────────
  if (isRoleExcluded(opts.title)) {
    return { status: 'blocked', reason: 'title' }
  }
  if (isLocationBlocked(opts.location, blockedLocationRegex)) {
    return { status: 'blocked', reason: 'location' }
  }
  if (isCompanyBlocked(opts.company, blockedCompanies)) {
    return { status: 'blocked', reason: 'company' }
  }
  if (isArticleTitle(opts.title)) {
    return { status: 'blocked', reason: 'article' }
  }

  // ── Exact URL dedup ──────────────────────────────────────────────────────
  const { data: existingRows } = await supabase
    .from('job_postings')
    .select('id')
    .eq('url_hash', urlHash)
    .limit(1)
  const existing = existingRows?.[0] ?? null

  if (existing) {
    await supabase
      .from('job_postings')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id)
    return { status: 'deduped', reason: 'url' }
  }

  // ── Title+company+location dedup (cross-source) ─────────────────────────
  if (opts.title) {
    let q = supabase.from('job_postings').select('id, page_content, source_type').ilike('title', opts.title)
    if (opts.company) q = q.ilike('company', opts.company)
    if (opts.location) q = q.ilike('location', opts.location)
    const { data: titleMatches } = await q.limit(1)
    const titleMatch = (titleMatches?.[0] ?? null) as { id: string; page_content: string | null; source_type: string | null } | null

    if (titleMatch) {
      if (titleMatch.source_type === 'manual') {
        return { status: 'deduped', reason: 'manual' }
      }
      const updates: Record<string, unknown> = { last_seen: new Date().toISOString() }
      const contentUpgraded = opts.description && opts.description.length > (titleMatch.page_content || '').length
      if (contentUpgraded) {
        updates.page_content = opts.description
        // Re-queue for LLM enrichment if description was upgraded
        updates.enrichment_status = 'pending'
      }
      await supabase.from('job_postings').update(updates).eq('id', titleMatch.id)
      return { status: 'deduped', reason: 'title+company' }
    }
  }

  // ── Fuzzy dedup for scrapers ────────────────────────────────────────────
  if (opts.title && (opts.source.includes('scraper') || opts.source.includes('hasdata') || opts.source.includes('glassdoor') || opts.source.includes('indeed') || opts.source.includes('serpapi') || opts.source.includes('mantiks'))) {
    let fq = supabase.from('job_postings').select('id, page_content, resume_fit').ilike('title', opts.title)
    if (opts.company) fq = fq.ilike('company', opts.company)
    const { data: fuzzyMatches } = await fq
    if (fuzzyMatches && fuzzyMatches.length > 0) {
      for (const m of fuzzyMatches) {
        const match = m as { id: string; page_content: string | null; resume_fit: number | null }
        const existingContent = (match.page_content || '').toLowerCase()
        const newContent = (opts.description || '').toLowerCase()
        const hasDescOverlap = existingContent.length > 100 && newContent.length > 100 &&
          (existingContent.includes(newContent.substring(0, 100)) || newContent.includes(existingContent.substring(0, 100)))

        if (hasDescOverlap && match.resume_fit !== null && match.resume_fit < 50) {
          await supabase.from('job_postings').update({ last_seen: new Date().toISOString() }).eq('id', match.id)
          return { status: 'deduped', reason: 'fuzzy' }
        }
      }
    }
  }

  // ── Score ────────────────────────────────────────────────────────────────
  const result = scorePosting({
    text: opts.description,
    title: opts.title,
    company: opts.company,
    location: opts.location,
    url: normalizedUrl,
  })

  if (result.excluded) {
    return { status: 'skipped', reason: 'seniority' }
  }

  // ── Resume fit ───────────────────────────────────────────────────────────
  const hasContent = opts.description && opts.description.length > 100
  const resumeFit =
    resumeKeywords.length > 0 && hasContent
      ? computeResumeFit(result.keywords_matched, resumeKeywords)
      : null

  if (result.keywords_matched.length === 0) {
    return { status: 'skipped', reason: '0 keywords' }
  }

  if (resumeKeywords.length > 0 && resumeFit === 0) {
    return { status: 'skipped', reason: '0% resume fit' }
  }

  // ── Priority ─────────────────────────────────────────────────────────────
  const priority = result.excluded
    ? 'skip' as const
    : resumeFit !== null
      ? (resumeFit >= 80 ? 'high' as const : resumeFit >= 50 ? 'medium' as const : resumeFit >= 1 ? 'low' as const : 'skip' as const)
      : result.priority

  // ── Insert ───────────────────────────────────────────────────────────────
  // first_seen/last_seen track when WE saw the row. posted_at tracks when the
  // source originally posted it (Greenhouse first_published, Ashby publishedAt,
  // etc.); if unparseable or missing, we fall back to now() per CLAUDE.md.
  const now = new Date().toISOString()
  const postedAt = parsePublishedAt(opts.publishedAt) ?? now

  // enrichment_status: pending only if we have a real description AND an API key
  // (the enrich-batch worker will skip rows where description is too short)
  const hasAnthropic = Boolean(Deno.env.get('ANTHROPIC_API_KEY'))
  const enrichmentStatus = hasAnthropic && hasContent ? 'pending' : 'skipped'

  const { error } = await supabase.from('job_postings').insert({
    url: normalizedUrl,
    url_hash: urlHash,
    company: opts.company || null,
    title: opts.title || null,
    location: opts.location || null,
    salary_min: result.salary.min,
    salary_max: result.salary.max,
    score: result.total,
    resume_fit: resumeFit,
    score_breakdown: result.breakdown,
    keywords_matched: result.keywords_matched,
    firehose_rule: opts.source,
    priority,
    is_job_posting: true,
    page_content: opts.description,
    posted_at: postedAt,
    first_seen: now,
    last_seen: now,
    status: 'new',
    enrichment_status: enrichmentStatus,
  })

  if (error) {
    if (!error.message.includes('unique')) {
      console.error(`DB insert error for ${normalizedUrl}:`, error.message)
    }
    return { status: 'skipped', reason: 'db error' }
  }

  return { status: 'inserted' }
}
