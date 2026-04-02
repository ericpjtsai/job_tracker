// Per-event processor: score, dedup, upsert to Supabase

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import {
  scorePosting,
  computeResumeFit,
  isRoleExcluded,
  extractKeywordsWithGemini,
  validateKeywords,
} from '@job-tracker/scoring'

// ─── Supabase client (service role — full write access) ───────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

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
  return crypto.createHash('sha256').update(str).digest('hex')
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

// ─── Active resume keywords ───────────────────────────────────────────────────

let cachedResumeKeywords: string[] | null = null
let lastResumeFetch = 0

export function invalidateResumeCache() {
  cachedResumeKeywords = null
  lastResumeFetch = 0
}

async function getActiveResumeKeywords(supabase: ReturnType<typeof createClient>): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (cachedResumeKeywords && Date.now() - lastResumeFetch < 5 * 60 * 1000) {
    return cachedResumeKeywords
  }
  const { data } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
    .eq('resume_type', 'ats')
    .single()
  cachedResumeKeywords = (data as any)?.keywords_extracted ?? []
  lastResumeFetch = Date.now()
  return cachedResumeKeywords!
}

// ─── Shared insert (used by both Firehose processor and ATS poller) ───────────

export interface InsertJobOpts {
  url: string
  title: string
  company: string       // known company name (ATS) or derived from domain (Firehose)
  location: string
  description: string   // plain text page content
  source: string        // firehose rule tag or ats source name
  publishedAt?: string  // ISO string; defaults to now
}

// ─── Processor stats (in-memory, reset on restart) ──────────────────────────

export const processorStats = {
  received: 0,
  titleBlocked: 0,
  locationBlocked: 0,
  companyBlocked: 0,
  articleBlocked: 0,
  deduplicated: 0,
  seniorityExcluded: 0,
  resumeFitZero: 0,
  inserted: 0,
  nonJobBoard: 0,
}

export function getProcessorStats() {
  return { ...processorStats }
}

// ─── Pre-insert filters ───────────────────────────────────────────────────────

// Role exclusion now handled by isRoleExcluded() from @job-tracker/scoring

let blockedCompanies = new Set(['lensa', 'itjobswatch'])

export function setBlockedCompanies(companies: string[]): void {
  blockedCompanies = new Set(companies.map((c) => c.toLowerCase().trim()))
}

export function getBlockedCompanies(): string[] {
  return [...blockedCompanies]
}

function isCompanyBlocked(company: string): boolean {
  return blockedCompanies.has(company.toLowerCase().trim())
}

// Article/blog post title detection — blocks Firehose content marketing noise
const ARTICLE_TITLE_START = /^(\d+\s+[\w\s]+(?:for|to|that|you|every|in\s+\d{4})|how\s+to\b|what\s+is\b|what\s+are\b|why\s+\w|the\s+(best|complete|definitive|ultimate|top)\b|best\s+practices|tips\s+for\b|guide\s+to\b|empowering\b|smarter\b|\d{4}:\s)/i

const ARTICLE_PHRASES = /\b(business model|revenue explained|\+\d+%|open source\s+(ai\s+)?tools|agile methodology|best practices|definitive guide|complete (guide|framework)|deep dive|what.s next for you|step-by-step|cheat sheet|case study)\b/i

function isArticleTitle(title: string): boolean {
  if (!title) return false
  return ARTICLE_TITLE_START.test(title) || ARTICLE_PHRASES.test(title)
}

// Explicit non-US country/city signals — only block when clearly non-US.
// Empty or ambiguous locations are allowed through.
const DEFAULT_BLOCKED_LOCATIONS = ['UK','United Kingdom','England','Scotland','Wales','Ireland','Canada','Australia','New Zealand','Germany','France','Spain','Italy','Netherlands','Sweden','Norway','Denmark','Finland','Switzerland','Austria','Belgium','Poland','Portugal','Czech','Romania','Hungary','Singapore','Japan','South Korea','Korea','China','Hong Kong','India','Brazil','Mexico','Argentina','Colombia','Chile','Israel','UAE','Dubai','Qatar','Saudi Arabia','South Africa','Nigeria','Kenya','Amsterdam','Berlin','Munich','Hamburg','London','Manchester','Edinburgh','Dublin','Paris','Lyon','Madrid','Barcelona','Rome','Milan','Stockholm','Gothenburg','Oslo','Copenhagen','Helsinki','Zurich','Geneva','Vienna','Brussels','Warsaw','Prague','Budapest','Toronto','Vancouver','Montreal','Calgary','Sydney','Melbourne','Brisbane','Auckland','Tel Aviv','Bangalore','Mumbai','Delhi','Hyderabad','Chennai','São Paulo','Rio de Janeiro','Mexico City','Buenos Aires','Bogotá','Santiago']
let NON_US_LOCATION = buildLocationRegex(DEFAULT_BLOCKED_LOCATIONS)

function buildLocationRegex(locations: string[]): RegExp {
  const escaped = locations.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i')
}

export function setBlockedLocations(locations: string[]): void {
  NON_US_LOCATION = buildLocationRegex(locations)
}

export function getBlockedLocations(): string[] {
  return DEFAULT_BLOCKED_LOCATIONS
}

function isTitleBlocked(title: string): boolean {
  return isRoleExcluded(title)
}

function isLocationBlocked(location: string): boolean {
  if (!location) return false  // unknown location → allow
  if (/\b(remote|hybrid|united states|usa|u\.s\.a?\.?|US)\b/i.test(location)) return false
  // Allow if it contains a US state abbreviation (e.g. "NY", "CA", "TX")
  if (/,\s*[A-Z]{2}$/.test(location.trim())) return false
  return NON_US_LOCATION.test(location)
}

function cleanTitle(title: string): string {
  return title.replace(/^apply\s*now\s*/i, '').trim()
}

export async function insertJobPosting(opts: InsertJobOpts): Promise<void> {
  const supabase = getSupabase()
  const normalizedUrl = canonicalLinkedInUrl(opts.url)
  const urlHash = sha256(normalizedUrl)
  opts.title = cleanTitle(opts.title)
  processorStats.received++

  // ── Title & location pre-filters (before dedup to save DB calls) ──────────
  if (isTitleBlocked(opts.title)) {
    processorStats.titleBlocked++
    console.log(`  ↷ Title blocked: ${opts.title}`)
    return
  }
  if (isLocationBlocked(opts.location)) {
    processorStats.locationBlocked++
    console.log(`  ↷ Location blocked (${opts.location}): ${opts.title}`)
    return
  }
  if (isCompanyBlocked(opts.company)) {
    processorStats.companyBlocked++
    console.log(`  ↷ Company blocked: ${opts.company}`)
    return
  }
  if (isArticleTitle(opts.title)) {
    processorStats.articleBlocked++
    console.log(`  ↷ Article/blog blocked: ${opts.title}`)
    return
  }

  // ── Dedup check ──────────────────────────────────────────────────────────
  const { data: existingRows } = await supabase
    .from('job_postings')
    .select('id')
    .eq('url_hash', urlHash)
    .limit(1)
  const existing = existingRows?.[0] ?? null

  if (existing) {
    processorStats.deduplicated++
    console.log(`  ↷ Dedup (url): ${opts.title || normalizedUrl}`)
    await supabase
      .from('job_postings')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', existing.id)
    return
  }

  // ── Title+company+location dedup (catches cross-source duplicates) ──────
  // Skip dedup if existing row is manual import — never overwrite manual data
  if (opts.title) {
    let q = supabase.from('job_postings').select('id, page_content, source_type').ilike('title', opts.title)
    if (opts.company) q = q.ilike('company', opts.company)
    if (opts.location) q = q.ilike('location', opts.location)
    const { data: titleMatches } = await q.limit(1)
    const titleMatch = titleMatches?.[0] ?? null

    if (titleMatch) {
      if (titleMatch.source_type === 'manual') {
        processorStats.deduplicated++
        console.log(`  ↷ Dedup (manual): ${opts.title} — ${opts.company}`)
        return
      }
      processorStats.deduplicated++
      console.log(`  ↷ Dedup (title+co): ${opts.title} — ${opts.company}`)
      // Merge: update last_seen + keep the longer description
      const updates: Record<string, any> = { last_seen: new Date().toISOString() }
      const contentUpgraded = opts.description && opts.description.length > (titleMatch.page_content || '').length
      if (contentUpgraded) {
        updates.page_content = opts.description
      }
      await supabase.from('job_postings').update(updates).eq('id', titleMatch.id)
      // Re-score via LLM when description was upgraded to a longer version
      if (contentUpgraded && opts.description.length > 100) {
        const geminiKey = process.env.GEMINI_API_KEY
        const anthropicKey = process.env.ANTHROPIC_API_KEY
        if (geminiKey || anthropicKey) {
          const resumeKeywords = await getActiveResumeKeywords(supabase as any)
          console.log(`  🤖 Re-scoring dedup (longer JD): ${opts.title}`)
          enrichWithLLM(supabase, titleMatch.id, opts.description, resumeKeywords, geminiKey, anthropicKey).catch(() => {})
        }
      }
      return
    }
  }

  // ── Fuzzy dedup for scrapers: title+company match with partial JD overlap + low fit ──
  if (opts.title && (opts.source.includes('scraper') || opts.source.includes('hasdata') || opts.source.includes('glassdoor') || opts.source.includes('indeed') || opts.source.includes('serpapi') || opts.source.includes('mantiks'))) {
    let fq = supabase.from('job_postings').select('id, page_content, resume_fit').ilike('title', opts.title)
    if (opts.company) fq = fq.ilike('company', opts.company)
    const { data: fuzzyMatches } = await fq
    if (fuzzyMatches && fuzzyMatches.length > 0) {
      for (const match of fuzzyMatches) {
        // Check partial description overlap
        const existingContent = (match.page_content || '').toLowerCase()
        const newContent = (opts.description || '').toLowerCase()
        const hasDescOverlap = existingContent.length > 100 && newContent.length > 100 &&
          (existingContent.includes(newContent.substring(0, 100)) || newContent.includes(existingContent.substring(0, 100)))

        if (hasDescOverlap && match.resume_fit !== null && match.resume_fit < 50) {
          processorStats.deduplicated++
          console.log(`  ↷ Dedup (fuzzy scraper, fit:${match.resume_fit}): ${opts.title} — ${opts.company}`)
          await supabase.from('job_postings').update({ last_seen: new Date().toISOString() }).eq('id', match.id)
          return
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
    processorStats.seniorityExcluded++
    console.log(`  ↷ Skipped (seniority excluded): ${opts.title || normalizedUrl}`)
    return
  }

  // ── Resume fit ───────────────────────────────────────────────────────────
  const resumeKeywords = await getActiveResumeKeywords(supabase as any)
  const hasContent = opts.description && opts.description.length > 100
  const resumeFit =
    resumeKeywords.length > 0 && hasContent
      ? computeResumeFit(result.keywords_matched, resumeKeywords)
      : null

  // Skip if no keyword matches at all (title + description have zero design relevance)
  if (result.keywords_matched.length === 0) {
    processorStats.resumeFitZero++
    console.log(`  ↷ Skipped (0 keywords): ${opts.title || normalizedUrl}`)
    return
  }

  // Skip if resume is active and this job has zero keyword overlap — it's irrelevant
  if (resumeKeywords.length > 0 && resumeFit === 0) {
    processorStats.resumeFitZero++
    console.log(`  ↷ Skipped (0% resume fit): ${opts.title || normalizedUrl}`)
    return
  }

  // ── Priority (fit-based when resume active, score-based fallback) ──────
  const priority = result.excluded ? 'skip' as const
    : resumeFit !== null
      ? (resumeFit >= 80 ? 'high' as const : resumeFit >= 50 ? 'medium' as const : resumeFit >= 1 ? 'low' as const : 'skip' as const)
      : result.priority

  // ── Insert ───────────────────────────────────────────────────────────────
  let now = new Date().toISOString()
  if (opts.publishedAt) {
    const d = new Date(opts.publishedAt)
    now = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  }
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
    first_seen: now,
    last_seen: now,
    status: 'new',
  })

  if (error) {
    if (!error.message.includes('unique')) {
      console.error(`DB insert error for ${normalizedUrl}:`, error.message)
    }
    return
  }

  processorStats.inserted++
  const emoji = priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '⚪'
  console.log(`${emoji} [${priority.toUpperCase()} fit:${resumeFit ?? '-'}% score:${result.total}] ${opts.title} — ${opts.company} | ${normalizedUrl}`)

  // ── Async LLM enrichment (non-blocking) ─────────────────────────────────
  const geminiKey = process.env.GEMINI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if ((geminiKey || anthropicKey) && opts.description && opts.description.length > 100) {
    enrichWithLLM(supabase, normalizedUrl, opts.description, resumeKeywords, geminiKey, anthropicKey).catch(() => {})
  }
}

async function enrichWithLLM(supabase: any, matchValue: string, description: string, resumeKeywords: string[], geminiKey?: string, anthropicKey?: string) {
  const rawResult = await extractKeywordsWithGemini(description, resumeKeywords, geminiKey, anthropicKey)
  const llmResult = rawResult ? validateKeywords(rawResult, description, resumeKeywords) : null
  if (!llmResult) return

  const allKeywords = [...llmResult.matched, ...llmResult.missing]
  const resumeFit = llmResult.role_fit

  const priority = resumeFit >= 80 ? 'high' : resumeFit >= 50 ? 'medium' : resumeFit >= 1 ? 'low' : 'skip'

  const updates: Record<string, any> = { keywords_matched: allKeywords }
  if (resumeFit !== null) { updates.resume_fit = resumeFit; updates.priority = priority }

  // Match by id (UUID) or url
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(matchValue)
  await supabase.from('job_postings').update(updates).eq(isUuid ? 'id' : 'url', matchValue)
  console.log(`  🤖 LLM enriched: ${allKeywords.length} keywords (${llmResult.matched.length} matched, ${llmResult.missing.length} missing)`)
}

