// Per-event processor: score, dedup, upsert to Supabase

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import {
  scorePosting,
  computeResumeFit,
  companyFromDomain,
  getCompanyBonus,
} from '@job-tracker/scoring'

// ─── Supabase client (service role — full write access) ───────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

// ─── Firehose event types ─────────────────────────────────────────────────────

interface DiffChunk {
  typ: 'ins' | 'del'
  text: string
}

interface FirehoseDocument {
  url: string
  title?: string
  publish_time?: string
  diff?: { chunks: DiffChunk[] }
  page_category?: string[]
  page_types?: string[]
  language?: string
  markdown?: string
}

export interface FirehoseUpdateEvent {
  query_id: string
  matched_at: string
  tap_id: string
  document: FirehoseDocument
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

// ─── Company extraction ───────────────────────────────────────────────────────

function extractCompany(url: string): string {
  try {
    const domain = new URL(url).hostname
    return companyFromDomain(domain)
  } catch {
    return ''
  }
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

async function getActiveResumeKeywords(supabase: ReturnType<typeof createClient>): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (cachedResumeKeywords && Date.now() - lastResumeFetch < 5 * 60 * 1000) {
    return cachedResumeKeywords
  }
  const { data } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
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

const BLOCKED_TITLE_WORDS = /\b(principal|lead|head|staff|intern(ship)?|scholarship|researcher|strategist|motion designer)\b/i

const BLOCKED_COMPANIES = new Set(['lensa'])

function isCompanyBlocked(company: string): boolean {
  return BLOCKED_COMPANIES.has(company.toLowerCase().trim())
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
const NON_US_LOCATION = /\b(UK|United Kingdom|England|Scotland|Wales|Ireland|Canada|Australia|New Zealand|Germany|France|Spain|Italy|Netherlands|Sweden|Norway|Denmark|Finland|Switzerland|Austria|Belgium|Poland|Portugal|Czech|Romania|Hungary|Singapore|Japan|South Korea|Korea|China|Hong Kong|India|Brazil|Mexico|Argentina|Colombia|Chile|Israel|UAE|Dubai|Qatar|Saudi Arabia|South Africa|Nigeria|Kenya|Amsterdam|Berlin|Munich|Hamburg|London|Manchester|Edinburgh|Dublin|Paris|Lyon|Madrid|Barcelona|Rome|Milan|Stockholm|Gothenburg|Oslo|Copenhagen|Helsinki|Zurich|Geneva|Vienna|Brussels|Warsaw|Prague|Budapest|Toronto|Vancouver|Montreal|Calgary|Sydney|Melbourne|Brisbane|Auckland|Tel Aviv|Bangalore|Mumbai|Delhi|Hyderabad|Chennai|São Paulo|Rio de Janeiro|Mexico City|Buenos Aires|Bogotá|Santiago)\b/i

function isTitleBlocked(title: string): boolean {
  return BLOCKED_TITLE_WORDS.test(title)
}

function isLocationBlocked(location: string): boolean {
  if (!location) return false  // unknown location → allow
  if (/\b(remote|hybrid|united states|usa|u\.s\.a?\.?)\b/i.test(location)) return false
  // Allow if it contains a US state abbreviation (e.g. "NY", "CA", "TX")
  if (/,\s*[A-Z]{2}$/.test(location.trim())) return false
  return NON_US_LOCATION.test(location)
}

export async function insertJobPosting(opts: InsertJobOpts): Promise<void> {
  const supabase = getSupabase()
  const normalizedUrl = normalizeUrl(opts.url)
  const urlHash = sha256(normalizedUrl)
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
  const { data: existing } = await supabase
    .from('job_postings')
    .select('id')
    .eq('url_hash', urlHash)
    .maybeSingle()

  if (existing) {
    processorStats.deduplicated++
    await supabase
      .from('job_postings')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', existing.id)
    return
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
  const resumeFit =
    resumeKeywords.length > 0
      ? computeResumeFit(result.keywords_matched, resumeKeywords)
      : null

  // Skip if resume is active and this job has zero keyword overlap — it's irrelevant
  if (resumeKeywords.length > 0 && resumeFit === 0) {
    processorStats.resumeFitZero++
    console.log(`  ↷ Skipped (0% resume fit): ${opts.title || normalizedUrl}`)
    return
  }

  // ── Company tier ─────────────────────────────────────────────────────────
  const { tier } = getCompanyBonus(opts.company)

  // ── Priority (fit-based when resume active, score-based fallback) ──────
  const priority = result.excluded ? 'skip' as const
    : resumeFit !== null
      ? (resumeFit >= 60 ? 'high' as const : resumeFit >= 30 ? 'medium' as const : resumeFit >= 1 ? 'low' as const : 'skip' as const)
      : result.priority

  // ── Insert ───────────────────────────────────────────────────────────────
  const now = opts.publishedAt ?? new Date().toISOString()
  const { error } = await supabase.from('job_postings').insert({
    url: normalizedUrl,
    url_hash: urlHash,
    company: opts.company || null,
    company_tier: tier,
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
}

// ─── Job board URL allowlist (Firehose only) ──────────────────────────────────
// Drops non-job-board URLs before any scoring/DB work.
// HasData, ATS, and Mantiks call insertJobPosting() directly — not affected.

const JOB_BOARD_HOSTS = /\b(linkedin\.com|greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|icims\.com|taleo\.net|bamboohr\.com|jobvite\.com|workable\.com|wellfound\.com|dover\.com|rippling\.com|recruitee\.com|hiring\.cafe)\b/

const JOB_PATH = /\/(jobs|careers|job|career|positions|openings)\//i

const JOB_SUBDOMAIN = /^(jobs|careers|apply|work)\./i

function isJobBoardUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (JOB_BOARD_HOSTS.test(host)) return true
    if (JOB_SUBDOMAIN.test(host)) return true
    if (JOB_PATH.test(u.pathname)) return true
    return false
  } catch {
    return false
  }
}

// ─── Firehose event processor ─────────────────────────────────────────────────

export async function processEvent(event: FirehoseUpdateEvent): Promise<void> {
  const doc = event.document
  const normalizedUrl = normalizeUrl(doc.url)

  if (!isJobBoardUrl(normalizedUrl)) {
    processorStats.nonJobBoard++
    console.log(`  ↷ Non-job-board URL skipped: ${normalizedUrl}`)
    return
  }
  const pageContent = doc.markdown ?? ''
  const title = doc.title ?? ''
  const company = extractCompany(normalizedUrl)
  const location = extractLocation(`${title} ${pageContent}`)

  await insertJobPosting({
    url: normalizedUrl,
    title,
    company,
    location,
    description: pageContent,
    source: tagFromQueryId(event.query_id),
    publishedAt: event.matched_at,
  })
}

// ─── Rule tag cache ───────────────────────────────────────────────────────────

const ruleTagCache: Map<string, string> = new Map()

async function populateRuleTagCache() {
  const token = process.env.FIREHOSE_TAP_TOKEN
  if (!token || ruleTagCache.size > 0) return
  try {
    const https = await import('https')
    const raw = await new Promise<string>((resolve, reject) => {
      const req = https.default.request(
        { hostname: 'api.firehose.com', path: '/v1/rules', headers: { Authorization: `Bearer ${token}` } },
        (res) => { let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => resolve(d)) }
      )
      req.on('error', reject)
      req.end()
    })
    const { data } = JSON.parse(raw) as { data: Array<{ id: string; tag: string }> }
    for (const r of data) ruleTagCache.set(r.id, r.tag)
  } catch {
    // Non-critical — falls back to query_id
  }
}

function tagFromQueryId(queryId: string): string {
  return ruleTagCache.get(queryId) ?? queryId
}

populateRuleTagCache()
