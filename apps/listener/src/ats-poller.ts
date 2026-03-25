// ATS direct polling — Greenhouse, Lever, Ashby, SmartRecruiters
// Runs on startup + every hour to fetch structured job data directly from company ATSs

import https from 'https'
import { ATS_COMPANIES, type AtsCompany } from './ats-companies'
import { insertJobPosting, extractLocation } from './processor'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'JobTracker/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpsGet(res.headers.location!))
      }
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)) })
  })
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

// ─── Greenhouse ───────────────────────────────────────────────────────────────

async function pollGreenhouse(company: AtsCompany): Promise<number> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`
  const raw = await httpsGet(url)
  const { jobs } = JSON.parse(raw) as {
    jobs: Array<{
      id: number
      title: string
      location: { name: string }
      content: string
      absolute_url: string
      updated_at: string
    }>
  }

  let inserted = 0
  for (const job of jobs) {
    if (!isDesignRole(job.title)) continue
    const rawHtml = job.content ?? ''
    const plainText = stripHtml(rawHtml)
    const location = job.location?.name ?? extractLocation(plainText)
    await insertJobPosting({
      url: job.absolute_url,
      title: job.title,
      company: company.name,
      location,
      description: rawHtml, // store raw HTML for rich rendering
      source: `greenhouse`,
      publishedAt: job.updated_at,
    })
    inserted++
  }
  return inserted
}

// ─── Lever ────────────────────────────────────────────────────────────────────

async function pollLever(company: AtsCompany): Promise<number> {
  const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json`
  const raw = await httpsGet(url)
  const postings = JSON.parse(raw) as Array<{
    id: string
    text: string
    categories: { location?: string; team?: string }
    descriptionPlain?: string
    description?: string
    hostedUrl: string
    createdAt: number
  }>

  let inserted = 0
  for (const p of postings) {
    if (!isDesignRole(p.text)) continue
    const rawHtml = p.description ?? ''
    const plainText = p.descriptionPlain ?? stripHtml(rawHtml)
    const location = p.categories?.location ?? extractLocation(plainText)
    await insertJobPosting({
      url: p.hostedUrl,
      title: p.text,
      company: company.name,
      location,
      description: rawHtml || plainText, // prefer HTML for rich rendering
      source: `lever`,
      publishedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
    })
    inserted++
  }
  return inserted
}

// ─── Ashby ────────────────────────────────────────────────────────────────────

async function pollAshby(company: AtsCompany): Promise<number> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${company.slug}`
  const raw = await httpsGet(url)
  const { jobPostings } = JSON.parse(raw) as {
    jobPostings: Array<{
      id: string
      title: string
      locationName?: string
      descriptionHtml?: string
      jobUrl: string
      publishedAt?: string
    }>
  }

  let inserted = 0
  for (const job of jobPostings ?? []) {
    if (!isDesignRole(job.title)) continue
    const rawHtml = job.descriptionHtml ?? ''
    const location = job.locationName ?? extractLocation(stripHtml(rawHtml))
    await insertJobPosting({
      url: job.jobUrl,
      title: job.title,
      company: company.name,
      location,
      description: rawHtml,
      source: `ashby`,
      publishedAt: job.publishedAt,
    })
    inserted++
  }
  return inserted
}

// ─── SmartRecruiters ──────────────────────────────────────────────────────────

async function pollSmartRecruiters(company: AtsCompany): Promise<number> {
  const url = `https://api.smartrecruiters.com/v1/companies/${company.slug}/postings?status=PUBLIC&limit=100`
  const raw = await httpsGet(url)
  const { content } = JSON.parse(raw) as {
    content: Array<{
      id: string
      name: string
      location: { city?: string; country?: string; remote?: boolean }
      ref: string
      releasedDate?: string
    }>
  }

  let inserted = 0
  for (const p of content ?? []) {
    if (!isDesignRole(p.name)) continue
    const loc = p.location?.remote
      ? 'Remote'
      : [p.location?.city, p.location?.country].filter(Boolean).join(', ')

    // Fetch full description (store raw HTML)
    let description = ''
    try {
      const detailRaw = await httpsGet(`https://api.smartrecruiters.com/v1/companies/${company.slug}/postings/${p.id}`)
      const detail = JSON.parse(detailRaw) as { jobAd?: { sections?: { jobDescription?: { text?: string } } } }
      description = detail.jobAd?.sections?.jobDescription?.text ?? ''
    } catch { /* skip description */ }

    await insertJobPosting({
      url: p.ref,
      title: p.name,
      company: company.name,
      location: loc,
      description,
      source: `smartrecruiters`,
      publishedAt: p.releasedDate,
    })
    inserted++
  }
  return inserted
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function pollCompany(company: AtsCompany): Promise<number> {
  let count = 0
  switch (company.ats) {
    case 'greenhouse':    count = await pollGreenhouse(company); break
    case 'lever':         count = await pollLever(company); break
    case 'ashby':         count = await pollAshby(company); break
    case 'smartrecruiters': count = await pollSmartRecruiters(company); break
  }
  if (count > 0) {
    console.log(`  [ATS] ${company.name} (${company.ats}): ${count} design role(s) processed`)
  }
  return count
}

// ─── Poll progress (read by control server) ──────────────────────────────────
// Use a const object and mutate properties — ensures the imported reference in
// index.ts always points to the same object (avoids CJS live-binding issues).

export const pollStatus = { running: false, current: 0, total: 0 }

export async function pollAllAts(): Promise<number> {
  if (pollStatus.running) {
    console.log('⚠️  ATS poll already in progress, skipping')
    return 0
  }
  console.log('🔄 ATS poll starting...')
  pollStatus.running = true
  pollStatus.current = 0
  pollStatus.total = ATS_COMPANIES.length
  let totalFound = 0
  for (const company of ATS_COMPANIES) {
    try {
      totalFound += await pollCompany(company)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 404 = company not on this ATS slug, skip silently
      if (!msg.includes('404') && !msg.includes('Timeout')) {
        console.error(`  [ATS] Error polling ${company.name}: ${msg}`)
      }
    }
    await sleep(400) // 400ms between companies
    pollStatus.current++
  }
  pollStatus.running = false
  console.log(`✅ ATS poll complete (${ATS_COMPANIES.length} companies checked, ${totalFound} jobs found)`)
  return totalFound
}

// ─── DataSource registration ──────────────────────────────────────────────────

import { registerSource } from './sources/registry'
import { createHealth, withHealthTracking, type DataSource } from './sources/types'

const atsHealth = createHealth()

export const atsSource: DataSource = {
  id: 'ats',
  name: 'ATS Direct Polling',
  type: 'poll',
  schedule: 'Every hour',
  cost: 'Free (public APIs)',
  envVars: [],
  triggerPath: '/poll',
  health: atsHealth,
  poll: withHealthTracking(atsHealth, pollAllAts),
}

registerSource(atsSource)
