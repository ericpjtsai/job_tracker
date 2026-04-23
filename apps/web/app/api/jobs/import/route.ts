import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getPTMidnightToday } from '@/lib/time'
import { scorePosting, computeResumeFit, extractKeywordsLLM, classifyLLMKeywords, applyTitleCeilings } from '@job-tracker/scoring'
import { enforceRateLimit } from '@/lib/rate-limit'
import { checkBudget, recordLlmCalls, costPerCall } from '@/lib/llm-budget'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// Cache company list — refreshes every 5 minutes instead of every page load
let companiesCache: { data: string[]; ts: number } | null = null
const COMPANIES_TTL = 5 * 60 * 1000

// GET: list manual imports with pagination
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '0')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '30')
  const source = req.nextUrl.searchParams.get('source') ?? 'import'

  // Today midnight in Pacific time. Extracted to lib/time.ts after this exact
  // logic was duplicated in 3+ files. The original inline version had a UTC-vs-PT
  // bug — see lib/time.ts for the fix.
  const todayMidnight = getPTMidnightToday()

  // Run queries in parallel
  const [listResult, todayResult] = await Promise.all([
    (() => {
      let q = supabase
        .from('job_postings')
        .select('id,title,company,status,applied_at,applied_dates,first_seen,resume_fit,source_type', { count: 'estimated' })
      if (source === 'import') q = q.eq('source_type', 'manual')
      return q.order('applied_at', { ascending: false, nullsFirst: false })
    })()
      .order('resume_fit', { ascending: false, nullsFirst: false })
      .range(page * limit, (page + 1) * limit - 1),
    supabase
      .from('job_postings')
      .select('id', { count: 'exact', head: true })
      .not('applied_at', 'is', null)
      .gte('applied_at', todayMidnight),
  ])

  if (listResult.error) return NextResponse.json({ error: listResult.error.message }, { status: 500 })

  // Company autocomplete — cached, only on page 0
  let companies: string[] | undefined
  if (page === 0) {
    if (companiesCache && Date.now() - companiesCache.ts < COMPANIES_TTL) {
      companies = companiesCache.data
    } else {
      const { data } = await supabase.from('job_postings').select('company').not('company', 'is', null)
      if (data) {
        companies = [...new Set(data.map((r: any) => r.company).filter(Boolean))].sort() as string[]
        companiesCache = { data: companies, ts: Date.now() }
      }
    }
  }

  return NextResponse.json({ jobs: listResult.data ?? [], total: listResult.count ?? 0, todayCount: todayResult.count ?? 0, companies, page, limit }, {
    headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' },
  })
}

interface ParsedJob {
  title: string
  company: string
  url: string | null
  date: string | null
  notes: string
  description: string
  status: string
  salary_min: number | null
  salary_max: number | null
}

/**
 * Parse Notion-exported markdown into job fields.
 * Format:
 *   # Job Title
 *   Company: ...
 *   Status: Applied
 *   Date: March 27, 2026
 *   Note: ...
 *   (rest is job description)
 */
function parseNotionMarkdown(md: string): ParsedJob {
  const lines = md.split('\n')
  let title = ''
  let company = ''
  let url: string | null = null
  let date: string | null = null
  let status = 'applied'
  let notes = ''
  let descStart = -1
  let salary_min: number | null = null
  let salary_max: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Title from first H1
    if (!title && line.startsWith('# ')) {
      title = line.replace(/^#\s+/, '')
      continue
    }

    // Metadata fields
    if (line.startsWith('Company:')) {
      const val = line.replace(/^Company:\s*/, '')
      if (val.startsWith('http')) url = val
      else company = val
      continue
    }
    if (line.startsWith('URL:')) {
      const val = line.replace(/^URL:\s*/, '').trim()
      if (val) url = val
      continue
    }
    if (line.startsWith('Status:')) {
      status = line.replace(/^Status:\s*/, '').toLowerCase()
      continue
    }
    if (line.startsWith('Date:') || line.startsWith('Date Applied:')) {
      date = line.replace(/^Date(?:\s+Applied)?:\s*/, '')
      continue
    }
    if (line.startsWith('Note:')) {
      notes = line.replace(/^Note:\s*/, '')
      // Collect multi-line notes until next metadata or section
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim()
        if (nextLine.startsWith('#') || nextLine.startsWith('Company:') || nextLine.startsWith('Status:') || nextLine.startsWith('Date:')) break
        if (nextLine === '') { notes += '\n'; continue }
        notes += '\n' + nextLine
        i = j
      }
      continue
    }

    // Salary detection
    const salaryMatch = line.match(/\$([0-9,]+(?:\.\d+)?)\s*[-–\/]\s*\$([0-9,]+(?:\.\d+)?)/)
    if (salaryMatch) {
      const parse = (s: string) => parseFloat(s.replace(/,/g, ''))
      salary_min = parse(salaryMatch[1])
      salary_max = parse(salaryMatch[2])
      // Normalize to annual if looks like it's in thousands (e.g., $175K)
      if (salary_min < 1000) salary_min *= 1000
      if (salary_max < 1000) salary_max *= 1000
    }

    // Detect start of job description: any content line after metadata
    // Matches ## headings, # **bold headings**, **bold sections**, --- separators, or any non-empty line
    if (descStart === -1 && title && line.length > 0) {
      descStart = i
    }
  }

  const description = descStart >= 0 ? lines.slice(descStart).join('\n').trim() : ''

  // Try to extract company name from LinkedIn URL
  if (!company && url?.includes('linkedin.com/company/')) {
    const match = url.match(/linkedin\.com\/company\/([^/?]+)/)
    if (match) company = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  return { title, company, url, date, notes: notes.trim(), description, status, salary_min, salary_max }
}

// Map Notion statuses to our system statuses
function mapStatus(notionStatus: string): { status: string; isApplied: boolean } {
  switch (notionStatus.toLowerCase()) {
    case 'applied':
    case 'interview':
    case 'in progress':
      return { status: 'applied', isApplied: true }
    case 'offer':
      return { status: 'applied', isApplied: true }
    case 'rejected':
    case 'complete':
      return { status: 'unavailable', isApplied: true }
    case 'wishlist':
    case 'to-do':
    case 'todo':
      return { status: 'reviewed', isApplied: false }
    case 'skipped':
      return { status: 'skipped', isApplied: false }
    default:
      return { status: 'applied', isApplied: true }
  }
}

// POST: import one or more jobs from Notion markdown
export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'jobs-import', 5, 60 * 60 * 1000)
  if (limited) return limited

  const supabase = createServerClient()
  const body = await req.json()
  const entries: string[] = Array.isArray(body.entries) ? body.entries : [body.markdown]

  // Get active resume for fit scoring
  const { data: resume } = await supabase
    .from('resume_versions')
    .select('keywords_extracted')
    .eq('is_active', true)
    .eq('resume_type', 'ats')
    .single()
  const resumeKeywords = resume?.keywords_extracted ?? []

  const results = []

  for (const md of entries) {
    const parsed = parseNotionMarkdown(md)
    if (!parsed.title) continue

    // Score the job description
    const scoreResult = scorePosting({
      text: parsed.description || parsed.title,
      title: parsed.title,
      company: parsed.company,
      location: '',
    })
    const resume_fit = computeResumeFit(scoreResult.keywords_matched, resumeKeywords)

    // Parse date — date-only ISO strings ("2026-03-31") are parsed as UTC midnight by JS spec,
    // so append T00:00:00 to parse as local time for consistency with todayMidnight
    let appliedAt: string | null = null
    let firstSeen: string
    if (parsed.date) {
      try {
        const dateStr = parsed.date.trim()
        const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr + 'T00:00:00' : dateStr)
        if (!isNaN(d.getTime())) {
          appliedAt = d.toISOString()
          firstSeen = d.toISOString()
        } else {
          firstSeen = new Date().toISOString()
        }
      } catch {
        firstSeen = new Date().toISOString()
      }
    } else {
      firstSeen = new Date().toISOString()
    }

    // Default appliedAt to now when status is applied but no date was provided
    if (!appliedAt && mapStatus(parsed.status).isApplied) {
      appliedAt = new Date().toISOString()
    }

    const urlHash = crypto.createHash('sha256').update(parsed.url || `manual-${parsed.title}-${parsed.company}`).digest('hex')

    // Dedup: check by URL first, then title+company (case-insensitive, strip company suffixes)
    let existing: any = null
    const DEDUP_COLS = 'id, title, company, notes, page_content, applied_at, applied_dates, status'

    // 1. Exact URL match
    if (parsed.url) {
      const { data: urlRows } = await supabase.from('job_postings')
        .select(DEDUP_COLS)
        .eq('url', parsed.url).limit(1)
      existing = urlRows?.[0] ?? null
    }

    // 2. Title + company match (strip Inc/LLC/Corp/Ltd suffixes)
    if (!existing) {
      const normalizeCompany = (c: string) => c.replace(/[,.]?\s*(Inc\.?|LLC|Corp\.?|Ltd\.?|Co\.?|Corporation|Incorporated)$/i, '').trim()
      const companyNorm = normalizeCompany(parsed.company || '')
      let dedupQuery = supabase.from('job_postings')
        .select(DEDUP_COLS)
        .ilike('title', parsed.title)
      if (companyNorm) dedupQuery = dedupQuery.ilike('company', `${companyNorm}%`)
      const { data: dedupRows } = await dedupQuery.limit(5)
      // Filter client-side: normalized company must match
      existing = dedupRows?.find(r => normalizeCompany(r.company || '').toLowerCase() === companyNorm.toLowerCase()) ?? null
    }

    if (existing) {
      const newDesc = parsed.description || ''
      const oldDesc = existing.page_content || ''
      const hasMoreContent = newDesc.length > oldDesc.length
      const isApplied = mapStatus(parsed.status).isApplied

      // Detect whether this import represents a new application date we haven't seen
      const existingDates: string[] = Array.isArray(existing.applied_dates) ? existing.applied_dates : []
      const importedDate = appliedAt ?? (isApplied ? new Date().toISOString() : null)
      const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()
      const isNewApplication = !!(isApplied && importedDate && !existingDates.some(d => sameDay(d, importedDate)))

      const updates: Record<string, any> = {}
      let changed = false

      if (isNewApplication) {
        const nextDates = [...existingDates, importedDate!].sort()
        updates.applied_dates = nextDates
        // applied_at stays as the latest application date for sort/filter continuity
        const latest = nextDates[nextDates.length - 1]
        updates.applied_at = latest
        updates.status = 'applied'
        changed = true
      }

      // Only overwrite description/score if the existing job hasn't been applied yet —
      // prevents re-imports from clobbering user-edited content on applied jobs.
      const notYetApplied = existing.status !== 'applied'
      if (hasMoreContent && notYetApplied) {
        updates.page_content = newDesc
        updates.score = scoreResult.total
        updates.priority = scoreResult.priority
        updates.keywords_matched = scoreResult.keywords_matched
        updates.resume_fit = resume_fit
        changed = true
      }

      if (parsed.notes && parsed.notes !== existing.notes) {
        updates.notes = parsed.notes
        changed = true
      }

      if (changed) {
        updates.source_type = 'manual'
        updates.last_seen = new Date().toISOString()
        await supabase.from('job_postings').update(updates).eq('id', existing.id)
        results.push({ title: parsed.title, company: parsed.company, id: existing.id, action: 'updated', jobStatus: updates.status ?? existing.status ?? 'new', resume_fit })
        continue
      }

      results.push({ title: parsed.title, company: parsed.company, id: existing.id, action: 'duplicate', jobStatus: existing.status ?? 'new', resume_fit })
      continue
    }

    const { data, error } = await supabase
      .from('job_postings')
      .insert({
        url: parsed.url || `manual://${parsed.company}/${parsed.title}`.replace(/\s+/g, '-').toLowerCase(),
        url_hash: urlHash,
        title: parsed.title,
        company: parsed.company,
        location: '',
        page_content: parsed.description || null,
        notes: parsed.notes || null,
        status: mapStatus(parsed.status).status,
        applied_at: mapStatus(parsed.status).isApplied ? appliedAt : null,
        applied_dates: mapStatus(parsed.status).isApplied && appliedAt ? [appliedAt] : [],
        source_type: 'manual',
        firehose_rule: 'manual-import',
        score: scoreResult.total,
        priority: scoreResult.priority,
        keywords_matched: scoreResult.keywords_matched,
        resume_fit,
        salary_min: parsed.salary_min,
        salary_max: parsed.salary_max,
        is_job_posting: true,
        posted_at: firstSeen,
        first_seen: firstSeen,
        last_seen: firstSeen,
      })
      .select('id')
      .single()

    results.push({ title: parsed.title, company: parsed.company, id: data?.id, action: 'imported', jobStatus: mapStatus(parsed.status).status, resume_fit, error: error?.message })
  }

  // Trigger LLM enrichment for all imported/updated jobs with JD content (non-blocking)
  const jobsToEnrich = results.filter(r => r.id).map(r => r.id!)
  if (jobsToEnrich.length > 0) {
    after(async () => {
      const supabaseAsync = createServerClient()
      const anthropicKey = process.env.ANTHROPIC_API_KEY
      if (!anthropicKey) return

      // Read budget once up front, then project spend in-memory across the loop
      // to avoid N+1 DB roundtrips (and to sidestep the intra-loop check-then-
      // write race in checkBudget). Flush once at the end.
      const initial = await checkBudget(supabaseAsync, 'haiku', 0)
      let projectedSpent = initial.spent
      let callsMade = 0
      const perCall = costPerCall('haiku')

      for (let i = 0; i < jobsToEnrich.length; i++) {
        const jobId = jobsToEnrich[i]
        if (projectedSpent + perCall > initial.cap) {
          console.warn(`[import] daily LLM budget exceeded ($${projectedSpent.toFixed(2)}/$${initial.cap}); skipping enrichment for ${jobsToEnrich.length - i} remaining jobs`)
          break
        }
        const { data: job } = await supabaseAsync.from('job_postings').select('title, page_content, keywords_matched').eq('id', jobId).single()
        if (!job?.page_content) continue
        // Manual imports always get LLM — even sparse descriptions benefit from role_fit scoring

        const rawLlm = await extractKeywordsLLM(job.page_content, resumeKeywords, anthropicKey)
        projectedSpent += perCall
        callsMade++
        const classified = rawLlm ? classifyLLMKeywords(rawLlm, job.page_content, resumeKeywords) : null
        const llmResult = classified ? applyTitleCeilings(job.title ?? '', classified) : null
        if (llmResult) {
          const allKeywords = [...llmResult.matched, ...llmResult.missing]
          const fit = llmResult.role_fit
          const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'
          // Mark enrichment_status='done' so the every-2-min enrich-batch cron
          // doesn't pick this row up again and double-bill Haiku.
          await supabaseAsync.from('job_postings')
            .update({ keywords_matched: allKeywords, resume_fit: fit, priority, enrichment_status: 'done' })
            .eq('id', jobId)
        } else {
          // LLM failed or returned nothing — mark as 'error' so cron doesn't retry
          // the same broken JD forever. Regex score from the insert stays.
          await supabaseAsync.from('job_postings')
            .update({ enrichment_status: 'error' })
            .eq('id', jobId)
        }
      }

      // Single DB write to record today's spend delta.
      if (callsMade > 0) {
        await recordLlmCalls(supabaseAsync, 'haiku', callsMade)
      }
    })
  }

  return NextResponse.json({ imported: results.filter(r => r.id).length, results })
}
