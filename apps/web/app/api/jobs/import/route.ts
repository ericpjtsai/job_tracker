import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { scorePosting, computeResumeFit, extractKeywordsWithGemini, validateKeywords } from '@job-tracker/scoring'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// GET: list manual imports with pagination
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '0')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '30')

  // Today midnight in Pacific time (consistent across local dev and Vercel/UTC)
  const todayMidnight = new Date(new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })).toISOString()

  // Run all queries in parallel
  const [listResult, todayResult, companiesResult] = await Promise.all([
    supabase
      .from('job_postings')
      .select('id,title,company,status,applied_at,first_seen,resume_fit,source_type', { count: 'estimated' })
      .eq('source_type', 'manual')
      .order('applied_at', { ascending: false, nullsFirst: false })
      .order('resume_fit', { ascending: false, nullsFirst: false })
      .range(page * limit, (page + 1) * limit - 1),
    supabase
      .from('job_postings')
      .select('id', { count: 'exact', head: true })
      .not('applied_at', 'is', null)
      .gte('applied_at', todayMidnight),
    page === 0
      ? supabase.from('job_postings').select('company').not('company', 'is', null)
      : Promise.resolve({ data: null }),
  ])

  if (listResult.error) return NextResponse.json({ error: listResult.error.message }, { status: 500 })

  const companies = companiesResult.data
    ? [...new Set(companiesResult.data.map((r: any) => r.company).filter(Boolean))].sort()
    : undefined

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

    // Dedup: check by title+company across all sources
    let dedupQuery = supabase
      .from('job_postings')
      .select('id, title, company, notes, page_content, applied_at')
      .ilike('title', parsed.title)
    if (parsed.company) dedupQuery = dedupQuery.ilike('company', parsed.company)
    const { data: dedupRows } = await dedupQuery.limit(1)
    const existing = dedupRows?.[0] ?? null

    if (existing) {
      // Update if there's new data (notes or description) — preserve original applied_at
      const updates: Record<string, any> = { last_seen: new Date().toISOString(), source_type: 'manual' }
      if (parsed.notes && parsed.notes !== existing.notes) updates.notes = parsed.notes
      if (parsed.description && parsed.description !== existing.page_content) {
        updates.page_content = parsed.description
        updates.score = scoreResult.total
        updates.priority = scoreResult.priority
        updates.keywords_matched = scoreResult.keywords_matched
        updates.resume_fit = resume_fit
      }
      const mapped = mapStatus(parsed.status)
      if (mapped.isApplied) {
        updates.status = mapped.status
        // Only set applied_at if not already set
        if (!existing.applied_at && appliedAt) updates.applied_at = appliedAt
      }
      if (parsed.salary_min) updates.salary_min = parsed.salary_min
      if (parsed.salary_max) updates.salary_max = parsed.salary_max

      await supabase.from('job_postings').update(updates).eq('id', existing.id)
      results.push({ title: parsed.title, company: parsed.company, id: existing.id, action: 'updated', jobStatus: updates.status ?? mapStatus(parsed.status).status, resume_fit })
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
        source_type: 'manual',
        firehose_rule: 'manual-import',
        score: scoreResult.total,
        priority: scoreResult.priority,
        keywords_matched: scoreResult.keywords_matched,
        resume_fit,
        salary_min: parsed.salary_min,
        salary_max: parsed.salary_max,
        is_job_posting: true,
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
      const geminiKey = process.env.GEMINI_API_KEY
      const anthropicKey = process.env.ANTHROPIC_API_KEY
      if (!geminiKey && !anthropicKey) return

      for (const jobId of jobsToEnrich) {
        const { data: job } = await supabaseAsync.from('job_postings').select('page_content, keywords_matched').eq('id', jobId).single()
        if (!job?.page_content || job.page_content.length < 100) continue

        const rawLlm = await extractKeywordsWithGemini(job.page_content, resumeKeywords, geminiKey, anthropicKey)
        const llmResult = rawLlm ? validateKeywords(rawLlm, job.page_content, resumeKeywords) : null
        if (llmResult) {
          const allKeywords = [...llmResult.matched, ...llmResult.missing]
          const fit = llmResult.role_fit
          const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'
          await supabaseAsync.from('job_postings').update({ keywords_matched: allKeywords, resume_fit: fit, priority }).eq('id', jobId)
        }
      }
    })
  }

  return NextResponse.json({ imported: results.filter(r => r.id).length, results })
}
