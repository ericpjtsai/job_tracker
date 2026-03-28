import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { scorePosting, computeResumeFit } from '@job-tracker/scoring'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// GET: list manual imports with pagination
export async function GET(req: NextRequest) {
  const supabase = createServerClient()
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '0')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '30')

  const { data, error, count } = await supabase
    .from('job_postings')
    .select('id,title,company,status,applied_at,first_seen,resume_fit,source_type', { count: 'exact' })
    .eq('source_type', 'manual')
    .order('applied_at', { ascending: false, nullsFirst: false })
    .order('first_seen', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data ?? [], total: count ?? 0, page, limit })
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
      // Could be a URL or a name
      if (val.startsWith('http')) url = val
      else company = val
      continue
    }
    if (line.startsWith('Status:')) {
      status = line.replace(/^Status:\s*/, '').toLowerCase()
      continue
    }
    if (line.startsWith('Date:')) {
      date = line.replace(/^Date:\s*/, '')
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

    // Detect start of job description (first ## or **About** section)
    if (descStart === -1 && (line.startsWith('## ') || line.startsWith('**About'))) {
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

    // Parse date
    let appliedAt: string | null = null
    let firstSeen: string
    if (parsed.date) {
      try {
        const d = new Date(parsed.date)
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

    const urlHash = crypto.createHash('sha256').update(parsed.url || `manual-${parsed.title}-${parsed.company}`).digest('hex')

    // Dedup: check by title+company among manual imports only
    const { data: existing } = await supabase
      .from('job_postings')
      .select('id, title, company, notes, page_content')
      .eq('source_type', 'manual')
      .ilike('title', parsed.title)
      .ilike('company', parsed.company || '')
      .maybeSingle()

    if (existing) {
      // Update if there's new data (notes or description)
      const updates: Record<string, any> = { last_seen: new Date().toISOString() }
      if (parsed.notes && parsed.notes !== existing.notes) updates.notes = parsed.notes
      if (parsed.description && parsed.description !== existing.page_content) {
        updates.page_content = parsed.description
        updates.score = scoreResult.total
        updates.priority = scoreResult.priority
        updates.keywords_matched = scoreResult.keywords_matched
        updates.resume_fit = resume_fit
      }
      if (parsed.status === 'applied' && appliedAt) {
        updates.status = 'applied'
        updates.applied_at = appliedAt
      }
      if (parsed.salary_min) updates.salary_min = parsed.salary_min
      if (parsed.salary_max) updates.salary_max = parsed.salary_max

      await supabase.from('job_postings').update(updates).eq('id', existing.id)
      results.push({ title: parsed.title, company: parsed.company, id: existing.id, action: 'updated', jobStatus: updates.status ?? parsed.status, resume_fit })
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
        status: parsed.status === 'applied' ? 'applied' : 'new',
        applied_at: parsed.status === 'applied' ? appliedAt : null,
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

    results.push({ title: parsed.title, company: parsed.company, id: data?.id, action: 'imported', jobStatus: parsed.status === 'applied' ? 'applied' : 'new', resume_fit, error: error?.message })
  }

  return NextResponse.json({ imported: results.filter(r => r.id).length, results })
}
