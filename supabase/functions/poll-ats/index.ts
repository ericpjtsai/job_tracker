// poll-ats — direct ATS API polling for ~237 companies (Greenhouse, Lever, Ashby, SmartRecruiters)
// PORTED from apps/listener/src/ats-poller.ts
//
// CRITICAL: Edge Functions cap at ~150s wall-clock. The full company list × ~3s avg HTTP
// is ~700s — too long for one invocation. We split into 4 batches via index modulo 4 and
// schedule them 15 min apart.
//
// Body: { "batch": 0..3 }  (also accepts ?batch=N query param)

import { runPollHandler, emptyResult, tally, tallyError, type PollResult } from '../_shared/handler.ts'
import { insertJobPosting, extractLocation, type ProcessorContext } from '../_shared/processor.ts'
import { isAbortRequested, updateProgress } from '../_shared/health.ts'
import { ATS_COMPANIES, type AtsCompany, type StandardAtsCompany, type WorkdayCompany } from './companies.ts'

const NUM_BATCHES = 8

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'JobTracker/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.json()
}

// ─── Design role filter ───────────────────────────────────────────────────────

const DESIGN_PATTERNS = [
  /product designer/i, /ux designer/i, /ui\/ux/i, /ux\/ui/i,
  /interaction designer/i, /experience designer/i, /design engineer/i,
  /ui designer/i, /associate designer/i, /junior designer/i,
  /senior designer/i, /design technologist/i, /ux researcher/i,
  /user researcher/i, /design lead/i, /ux lead/i,
  /product design/i, /\bux design\b/i, /user experience designer/i,
]

const FP_PATTERNS = [
  /graphic designer/i, /interior designer/i, /fashion designer/i,
  /instructional designer/i, /game designer/i, /industrial designer/i,
]

function isDesignRole(title: string): boolean {
  if (FP_PATTERNS.some((p) => p.test(title))) return false
  return DESIGN_PATTERNS.some((p) => p.test(title))
}

// ─── Per-ATS handlers ─────────────────────────────────────────────────────────

async function pollGreenhouse(ctx: ProcessorContext, company: StandardAtsCompany, result: PollResult): Promise<void> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.slug)}/jobs?content=true`
  const data = (await fetchJson(url)) as {
    jobs: Array<{
      id: number
      title: string
      location: { name: string }
      content: string
      absolute_url: string
      updated_at: string
      first_published?: string
    }>
  }

  for (const job of data.jobs) {
    if (!isDesignRole(job.title)) continue
    const rawHtml = job.content ?? ''
    const plainText = stripHtml(rawHtml)
    const location = job.location?.name ?? extractLocation(plainText)
    const r = await insertJobPosting(ctx, {
      url: job.absolute_url,
      title: job.title,
      company: company.name,
      location,
      description: rawHtml,
      source: 'greenhouse',
      publishedAt: job.first_published ?? job.updated_at,
    })
    tally(result, r.status)
  }
}

async function pollLever(ctx: ProcessorContext, company: StandardAtsCompany, result: PollResult): Promise<void> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company.slug)}?mode=json`
  const postings = (await fetchJson(url)) as Array<{
    id: string
    text: string
    categories: { location?: string; team?: string }
    descriptionPlain?: string
    description?: string
    hostedUrl: string
    createdAt: number
  }>

  for (const p of postings) {
    if (!isDesignRole(p.text)) continue
    const rawHtml = p.description ?? ''
    const plainText = p.descriptionPlain ?? stripHtml(rawHtml)
    const location = p.categories?.location ?? extractLocation(plainText)
    const r = await insertJobPosting(ctx, {
      url: p.hostedUrl,
      title: p.text,
      company: company.name,
      location,
      description: rawHtml || plainText,
      source: 'lever',
      publishedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
    })
    tally(result, r.status)
  }
}

async function pollAshby(ctx: ProcessorContext, company: StandardAtsCompany, result: PollResult): Promise<void> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.slug)}`
  const data = (await fetchJson(url)) as {
    jobPostings: Array<{
      id: string
      title: string
      locationName?: string
      descriptionHtml?: string
      jobUrl: string
      publishedAt?: string
    }>
  }

  for (const job of data.jobPostings ?? []) {
    if (!isDesignRole(job.title)) continue
    const rawHtml = job.descriptionHtml ?? ''
    const location = job.locationName ?? extractLocation(stripHtml(rawHtml))
    const r = await insertJobPosting(ctx, {
      url: job.jobUrl,
      title: job.title,
      company: company.name,
      location,
      description: rawHtml,
      source: 'ashby',
      publishedAt: job.publishedAt,
    })
    tally(result, r.status)
  }
}

async function pollSmartRecruiters(ctx: ProcessorContext, company: StandardAtsCompany, result: PollResult): Promise<void> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.slug)}/postings?status=PUBLIC&limit=100`
  const data = (await fetchJson(url)) as {
    content: Array<{
      id: string
      name: string
      location: { city?: string; country?: string; remote?: boolean }
      ref: string
      releasedDate?: string
    }>
  }

  for (const p of data.content ?? []) {
    if (!isDesignRole(p.name)) continue
    const loc = p.location?.remote
      ? 'Remote'
      : [p.location?.city, p.location?.country].filter(Boolean).join(', ')

    let description = ''
    try {
      const detail = (await fetchJson(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.slug)}/postings/${encodeURIComponent(p.id)}`,
      )) as { jobAd?: { sections?: { jobDescription?: { text?: string } } } }
      description = detail.jobAd?.sections?.jobDescription?.text ?? ''
    } catch { /* skip description */ }

    const r = await insertJobPosting(ctx, {
      url: p.ref,
      title: p.name,
      company: company.name,
      location: loc,
      description,
      source: 'smartrecruiters',
      publishedAt: p.releasedDate,
    })
    tally(result, r.status)
  }
}

// ─── Workday ──────────────────────────────────────────────────────────────────
// Workday exposes its public career-site JSON at /wday/cxs/[locale/]{site}.
// No API key — just POST /jobs with a search body and spoofed Origin/Referer headers.

function workdayBases(company: WorkdayCompany): string[] {
  const bases: string[] = []
  if (company.locale) bases.push(`https://${company.host}/wday/cxs/${company.locale}/${company.site}`)
  bases.push(`https://${company.host}/wday/cxs/${company.site}`)
  return Array.from(new Set(bases))
}

function workdayHeaders(company: WorkdayCompany): Record<string, string> {
  const boardUrl = company.boardUrl ?? `https://${company.host}/`
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'Origin': `https://${company.host}`,
    'Referer': boardUrl,
  }
}

function workdayApplyUrl(company: WorkdayCompany, externalPath: string): string {
  if (company.locale) return `https://${company.host}/${company.locale}/${company.site}/job/${externalPath}`
  return `https://${company.host}/${company.site}/job/${externalPath}`
}

async function pollWorkday(ctx: ProcessorContext, company: WorkdayCompany, result: PollResult): Promise<void> {
  const headers = workdayHeaders(company)
  const limit = 20
  let lastError: unknown = null

  for (const base of workdayBases(company)) {
    try {
      const postings: Array<{ externalPath: string; title: string; locationsText?: string }> = []
      let offset = 0
      while (true) {
        const res = await fetch(`${base}/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ limit, offset, searchText: '', appliedFacets: {} }),
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${base}/jobs`)
        const data = (await res.json()) as {
          jobPostings?: Array<{ externalPath: string; title: string; locationsText?: string }>
          total?: number
        }
        const page = data.jobPostings ?? []
        postings.push(...page)
        offset += page.length
        if (page.length === 0 || offset >= (data.total ?? 0)) break
      }

      for (const p of postings) {
        if (!isDesignRole(p.title)) continue
        // Workday list endpoint omits the description — fetch it from the detail endpoint.
        let description = ''
        try {
          const detailRes = await fetch(`${base}/job/${p.externalPath}`, {
            headers,
            signal: AbortSignal.timeout(15_000),
          })
          if (detailRes.ok) {
            const detail = (await detailRes.json()) as {
              jobPostingInfo?: { jobDescription?: string; title?: string }
            }
            description = detail.jobPostingInfo?.jobDescription ?? ''
          }
        } catch { /* skip description; proceed with title+location */ }

        const plainText = stripHtml(description)
        const r = await insertJobPosting(ctx, {
          url: workdayApplyUrl(company, p.externalPath),
          title: p.title,
          company: company.name,
          location: p.locationsText ?? extractLocation(plainText),
          description,
          source: 'workday',
          // Workday's postedOn is relative text ("Posted 3 Days Ago") — leave undefined
          // so insertJobPosting falls back to now() per CLAUDE.md guidance.
          publishedAt: undefined,
        })
        tally(result, r.status)
      }
      return // first base that worked — stop probing
    } catch (e) {
      lastError = e
      continue
    }
  }
  throw lastError ?? new Error(`Workday fetch failed for ${company.name}`)
}

async function pollCompany(ctx: ProcessorContext, company: AtsCompany, result: PollResult): Promise<void> {
  switch (company.ats) {
    case 'greenhouse':      await pollGreenhouse(ctx, company, result); break
    case 'lever':           await pollLever(ctx, company, result); break
    case 'ashby':           await pollAshby(ctx, company, result); break
    case 'smartrecruiters': await pollSmartRecruiters(ctx, company, result); break
    case 'workday':         await pollWorkday(ctx, company, result); break
  }
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function pollAts(ctx: ProcessorContext, req: Request): Promise<PollResult> {
  // Determine batch index from body or query param
  let batch = 0
  try {
    const body = await req.clone().json().catch(() => null) as { batch?: number } | null
    if (body && typeof body.batch === 'number') batch = body.batch
  } catch { /* ignore */ }
  if (!batch) {
    const url = new URL(req.url)
    const q = url.searchParams.get('batch')
    if (q) batch = parseInt(q, 10) || 0
  }

  if (batch < 0 || batch >= NUM_BATCHES) {
    throw new Error(`Invalid batch index ${batch} — must be 0..${NUM_BATCHES - 1}`)
  }

  // Slice companies by index modulo NUM_BATCHES
  const companies = ATS_COMPANIES.filter((_, i) => i % NUM_BATCHES === batch)
  const result = emptyResult()

  console.log(`[ATS] Batch ${batch}/${NUM_BATCHES}: polling ${companies.length} companies`)

  await updateProgress(ctx.supabase, 'ats', 0, companies.length, { batch })

  let processed = 0
  for (const company of companies) {
    // Cooperative abort check every 10 companies (matches the Stop button in the web UI)
    if (processed % 10 === 0 && processed > 0) {
      if (await isAbortRequested(ctx.supabase, 'ats')) {
        console.log(`[ATS] Aborted by user at company ${processed}/${companies.length}`)
        break
      }
    }

    try {
      await pollCompany(ctx, company, result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 404 = company not on this ATS slug (expected, many companies tested), Timeout = transient.
      // Both are noise, not real source-health issues. Anything else is a genuine error worth surfacing.
      if (!msg.includes('404') && !msg.includes('Timeout')) {
        console.error(`[ATS] Error polling ${company.name}: ${msg}`)
        tallyError(result, err)
      }
    }

    processed++
    await updateProgress(ctx.supabase, 'ats', processed, companies.length, { batch })
    await sleep(200) // 200ms between companies (down from 400ms in listener since batches are smaller)
  }

  console.log(`[ATS] Batch ${batch} done — inserted=${result.inserted} deduped=${result.deduped}`)
  return result
}

Deno.serve((req) => runPollHandler('ats', req, pollAts))
