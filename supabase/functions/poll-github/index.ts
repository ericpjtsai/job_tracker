// poll-github — pulls design jobs from Jobright.ai GitHub repos
// PORTED from apps/listener/src/github-jobs.ts
// Triggered by pg_cron at 7am + 7pm UTC, or manually via web /api/sources POST.

import { runPollHandler, emptyResult, tally, type PollResult } from '../_shared/handler.ts'
import { insertJobPosting, type ProcessorContext } from '../_shared/processor.ts'

interface RepoConfig {
  owner: string
  repo: string
  source: string
  extractSection?: string
}

const REPOS: RepoConfig[] = [
  {
    owner: 'jobright-ai',
    repo: '2026-Design-New-Grad',
    source: 'github-design-newgrad',
  },
  {
    owner: 'jobright-ai',
    repo: 'Daily-H1B-Jobs-In-Tech',
    source: 'github-h1b-design',
    extractSection: 'Arts & Design',
  },
]

async function fetchReadme(owner: string, repo: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status} for ${owner}/${repo}`)
  return await res.text()
}

interface ParsedJob {
  company: string
  title: string
  url: string
  location: string
  date: string
}

const BOLD_LINK = /\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/
const BOLD_TEXT = /\*\*([^*]+)\*\*/

function parseDate(dateStr: string): string {
  const trimmed = dateStr.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(trimmed + 'T00:00:00').toISOString()
  }
  const d = new Date(`${trimmed}, ${new Date().getFullYear()}`)
  if (!isNaN(d.getTime())) return d.toISOString()
  return new Date().toISOString()
}

function extractJobrightUrl(cell: string): string | null {
  const linkMatch = cell.match(/\(https:\/\/jobright\.ai\/jobs\/info\/([a-f0-9]+)[^)]*\)/)
  if (linkMatch) return `https://jobright.ai/jobs/info/${linkMatch[1]}`

  const applyMatch = cell.match(/\[apply\]\((https:\/\/jobright\.ai\/jobs\/info\/[a-f0-9]+)[^)]*\)/)
  if (applyMatch) return applyMatch[1].replace(/\?.*$/, '')

  return null
}

function parseDesignNewGradRow(cells: string[], lastCompany: string): ParsedJob | null {
  if (cells.length < 5) return null

  let company = lastCompany
  const companyMatch = cells[0].match(BOLD_LINK) || cells[0].match(BOLD_TEXT)
  if (companyMatch) company = companyMatch[1].trim()

  const titleMatch = cells[1].match(BOLD_LINK)
  if (!titleMatch) return null
  const title = titleMatch[1].trim()
  const url = extractJobrightUrl(cells[1])
  if (!url) return null

  const location = cells[2].trim()
  const date = cells[4].trim()

  return { company, title, url, location, date }
}

function parseH1BRow(cells: string[], lastCompany: string): ParsedJob | null {
  if (cells.length < 7) return null

  let company = lastCompany
  const companyMatch = cells[0].match(BOLD_LINK) || cells[0].match(BOLD_TEXT)
  if (companyMatch) company = companyMatch[1].trim()

  const title = cells[1].trim()
  const location = cells[3].trim()
  const url = extractJobrightUrl(cells[5])
  if (!url) return null

  const date = cells[6].trim()

  return { company, title, url, location, date }
}

function extractSection(readme: string, sectionName: string): string {
  const startTag = `<summary>${sectionName}</summary>`
  const startIdx = readme.indexOf(startTag)
  if (startIdx === -1) return ''
  const endIdx = readme.indexOf('</details>', startIdx)
  if (endIdx === -1) return readme.slice(startIdx)
  return readme.slice(startIdx, endIdx)
}

function parseRepo(readme: string, config: RepoConfig): ParsedJob[] {
  let content = readme

  if (config.extractSection) {
    content = extractSection(readme, config.extractSection)
    if (!content) {
      console.warn(`  Section "${config.extractSection}" not found in ${config.repo}`)
      return []
    }
  }

  const lines = content.split('\n')
  const jobs: ParsedJob[] = []
  let lastCompany = ''
  const isH1B = config.source.includes('h1b')

  for (const line of lines) {
    if (!line.startsWith('|')) continue
    if (line.includes('-----') || line.includes('Company')) continue

    const cells = line.split('|').slice(1, -1)

    const job = isH1B
      ? parseH1BRow(cells, lastCompany)
      : parseDesignNewGradRow(cells, lastCompany)

    if (job) {
      jobs.push(job)
      lastCompany = job.company
    }
  }

  return jobs
}

async function pollGitHub(ctx: ProcessorContext): Promise<PollResult> {
  const result = emptyResult()

  for (const config of REPOS) {
    console.log(`[GitHub] Fetching ${config.owner}/${config.repo}...`)
    const readme = await fetchReadme(config.owner, config.repo)
    const jobs = parseRepo(readme, config)
    console.log(`[GitHub]   Parsed ${jobs.length} jobs from ${config.repo}`)

    for (const job of jobs) {
      const r = await insertJobPosting(ctx, {
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        description: `${job.title} at ${job.company}. Location: ${job.location}`,
        source: config.source,
        publishedAt: parseDate(job.date),
      })
      tally(result, r.status)
    }
  }

  console.log(`[GitHub] Done — inserted=${result.inserted} deduped=${result.deduped} blocked=${result.blocked} skipped=${result.skipped}`)
  return result
}

Deno.serve((req) => runPollHandler('github', req, pollGitHub))
