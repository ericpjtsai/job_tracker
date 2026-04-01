// GitHub Jobs poller — pulls design job listings from Jobright.ai GitHub repos
// Sources:
//   1. jobright-ai/2026-Design-New-Grad  (all rows)
//   2. jobright-ai/Daily-H1B-Jobs-In-Tech (Arts & Design section only)

import https from 'https'
import { insertJobPosting } from './processor'
import { registerSource } from './sources/registry'
import { createHealth, withHealthTracking } from './sources/types'

// ─── Config ──────────────────────────────────────────────────────────────────

interface RepoConfig {
  owner: string
  repo: string
  source: string
  extractSection?: string // if set, extract only this <details><summary> section
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

// ─── Fetch raw README from GitHub ────────────────────────────────────────────

function fetchReadme(owner: string, repo: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub fetch failed: ${res.statusCode} for ${owner}/${repo}`))
        res.resume()
        return
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

// ─── Parse markdown table rows into job objects ──────────────────────────────

interface ParsedJob {
  company: string
  title: string
  url: string
  location: string
  date: string
}

// Matches: **[Text](url)** or just **Text**
const BOLD_LINK = /\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/
const BOLD_TEXT = /\*\*([^*]+)\*\*/

function parseDate(dateStr: string): string {
  // Convert "Mar 30" or "2026-03-30" to ISO string
  const trimmed = dateStr.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(trimmed + 'T00:00:00').toISOString()
  }
  // "Mar 30" format — use current year
  const d = new Date(`${trimmed}, ${new Date().getFullYear()}`)
  if (!isNaN(d.getTime())) return d.toISOString()
  return new Date().toISOString()
}

function extractJobrightUrl(cell: string): string | null {
  // Match jobright.ai URL and strip UTM params
  const linkMatch = cell.match(/\(https:\/\/jobright\.ai\/jobs\/info\/([a-f0-9]+)[^)]*\)/)
  if (linkMatch) return `https://jobright.ai/jobs/info/${linkMatch[1]}`

  // Also check for bare [apply](url) pattern (H1B repo)
  const applyMatch = cell.match(/\[apply\]\((https:\/\/jobright\.ai\/jobs\/info\/[a-f0-9]+)[^)]*\)/)
  if (applyMatch) return applyMatch[1].replace(/\?.*$/, '')

  return null
}

function parseDesignNewGradRow(cells: string[], lastCompany: string): ParsedJob | null {
  // Columns: Company | Job Title | Location | Work Model | Date Posted
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
  // Columns: Company | Job Title | Level | Location | H1B status | Link | Date Posted
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

  // Extract section if needed (H1B repo)
  if (config.extractSection) {
    content = extractSection(readme, config.extractSection)
    if (!content) {
      console.warn(`  ⚠ Section "${config.extractSection}" not found in ${config.repo}`)
      return []
    }
  }

  const lines = content.split('\n')
  const jobs: ParsedJob[] = []
  let lastCompany = ''
  const isH1B = config.source.includes('h1b')

  for (const line of lines) {
    // Skip non-table rows
    if (!line.startsWith('|')) continue
    // Skip header and separator rows
    if (line.includes('-----') || line.includes('Company')) continue

    const cells = line.split('|').slice(1, -1) // drop empty first/last from split

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

// ─── Poll function ───────────────────────────────────────────────────────────

async function pollGitHub(): Promise<number> {
  let totalProcessed = 0

  for (const config of REPOS) {
    console.log(`📋 [GitHub] Fetching ${config.owner}/${config.repo}...`)
    const readme = await fetchReadme(config.owner, config.repo)
    const jobs = parseRepo(readme, config)
    console.log(`  Parsed ${jobs.length} jobs from ${config.repo}`)

    for (const job of jobs) {
      await insertJobPosting({
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        description: `${job.title} at ${job.company}. Location: ${job.location}`,
        source: config.source,
        publishedAt: parseDate(job.date),
      })
    }
    totalProcessed += jobs.length
  }

  console.log(`📋 [GitHub] Done — ${totalProcessed} jobs processed`)
  return totalProcessed
}

// ─── Source registration ─────────────────────────────────────────────────────

const health = createHealth()

export const githubSource = {
  id: 'github-jobs',
  name: 'GitHub Jobright Repos',
  type: 'poll' as const,
  schedule: 'daily @ 7am, 7pm',
  cost: null,
  envVars: [] as string[],
  triggerPath: '/poll/github',
  health,
  poll: withHealthTracking(health, pollGitHub),
}

registerSource(githubSource)
