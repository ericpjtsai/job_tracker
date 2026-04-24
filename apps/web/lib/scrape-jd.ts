import { parse, type HTMLElement } from 'node-html-parser'
import dns from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import net from 'node:net'

export interface ScrapedJD {
  title: string
  company: string
  location: string
  description: string
  warning?: string
}

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 3 * 1024 * 1024 // 3 MB
const MIN_DESCRIPTION_CHARS = 400
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export class ScrapeError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// ── SSRF guard ────────────────────────────────────────────────────────────

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true // link-local incl. AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 0) return true
  if (a >= 224) return true // multicast / reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true
  if (normalized.startsWith('fe80:')) return true // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // unique-local
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice(7)
    if (net.isIPv4(v4)) return isPrivateIPv4(v4)
  }
  return false
}

async function assertSafeHost(urlStr: string): Promise<void> {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    throw new ScrapeError(400, 'Invalid URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ScrapeError(400, 'Only http and https URLs are supported')
  }
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new ScrapeError(400, 'Refusing to fetch localhost')
  }
  // If the hostname is itself an IP literal, check it directly.
  if (net.isIPv4(host) && isPrivateIPv4(host)) throw new ScrapeError(400, 'Refusing to fetch private IP')
  if (net.isIPv6(host) && isPrivateIPv6(host)) throw new ScrapeError(400, 'Refusing to fetch private IP')
  // Otherwise resolve and verify every returned address.
  if (!net.isIP(host)) {
    let addrs: LookupAddress[]
    try {
      addrs = await dns.lookup(host, { all: true })
    } catch {
      throw new ScrapeError(400, `Could not resolve host: ${host}`)
    }
    for (const a of addrs) {
      const bad = a.family === 4 ? isPrivateIPv4(a.address) : isPrivateIPv6(a.address)
      if (bad) throw new ScrapeError(400, 'URL resolves to a private address')
    }
  }
}

// ── Fetch with size cap ───────────────────────────────────────────────────

async function fetchCapped(urlStr: string): Promise<string> {
  const res = await fetch(urlStr, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) throw new ScrapeError(res.status === 404 ? 404 : 502, `Upstream returned ${res.status}`)
  // Re-check the final URL after redirects.
  if (res.url && res.url !== urlStr) await assertSafeHost(res.url)

  const contentLength = Number(res.headers.get('content-length') ?? 0)
  if (contentLength && contentLength > MAX_BYTES) {
    throw new ScrapeError(413, `Page too large (${Math.round(contentLength / 1024)} KB)`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new ScrapeError(502, 'Empty response body')
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > MAX_BYTES) {
        try { await reader.cancel() } catch {}
        throw new ScrapeError(413, 'Page exceeded 3 MB cap')
      }
      chunks.push(value)
    }
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf)
}

// ── Parsing ───────────────────────────────────────────────────────────────

const ALLOWED_HTML_TAGS = new Set([
  'h1','h2','h3','h4','h5','h6',
  'p','br','hr',
  'ul','ol','li',
  'strong','b','em','i','u',
  'blockquote','pre','code',
  'a','span','div','section','article',
])

// Keeps structural tags, strips everything else. Safe to inject as innerHTML.
function sanitizeHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<(\/?)(\w[\w-]*)([^>]*)>/g, (_, slash, rawTag, attrs) => {
      const tag = rawTag.toLowerCase()
      if (!ALLOWED_HTML_TAGS.has(tag)) return ''
      if (tag === 'a' && !slash) {
        const hrefMatch = attrs.match(/href=["']([^"']*)["']/)
        const href = hrefMatch?.[1] ?? ''
        if (href && /^https?:\/\//i.test(href)) {
          return `<a href="${href}" target="_blank" rel="noopener noreferrer">`
        }
        return ''
      }
      return `<${slash}${tag}>`
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2019;/gi, "'")
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .trim()
}

// Strips all tags to plain text — used only for length/thinness checks.
function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// Converts plain text (e.g. puppeteer innerText) to basic HTML paragraphs.
function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim().replace(/\n/g, '<br>'))
    .filter(Boolean)
    .map((para) => `<p>${para}</p>`)
    .join('')
}

function firstText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.length) return firstText(v[0])
  return ''
}

function formatAddress(addr: any): string {
  if (!addr) return ''
  if (typeof addr === 'string') return addr
  if (Array.isArray(addr)) return addr.map(formatAddress).filter(Boolean).join(' · ')
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].map((p) =>
    typeof p === 'string' ? p : p?.name ?? '',
  )
  return parts.filter(Boolean).join(', ')
}

function extractJsonLdJobPosting(root: HTMLElement): Partial<ScrapedJD> | null {
  const scripts = root.querySelectorAll('script[type="application/ld+json"]')
  const nodes: any[] = []
  const push = (n: any) => {
    if (!n) return
    if (Array.isArray(n)) n.forEach(push)
    else if (n['@graph']) push(n['@graph'])
    else nodes.push(n)
  }
  for (const s of scripts) {
    try { push(JSON.parse(s.text.trim())) } catch { /* ignore malformed JSON-LD */ }
  }
  const job = nodes.find((n) => {
    const t = n['@type']
    return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))
  })
  if (!job) return null

  const title = firstText(job.title).trim()
  const descRaw = firstText(job.description)
  const description = sanitizeHtml(descRaw)
  const org = job.hiringOrganization
  const company = typeof org === 'string' ? org : firstText(org?.name).trim()

  let location = ''
  if (job.jobLocationType === 'TELECOMMUTE') location = 'Remote'
  const loc = job.jobLocation
  const locText = Array.isArray(loc)
    ? loc.map((l) => formatAddress(l?.address ?? l)).filter(Boolean).join(' · ')
    : formatAddress(loc?.address ?? loc)
  if (locText) location = location ? `${location} · ${locText}` : locText
  if (!location && job.applicantLocationRequirements) {
    location = formatAddress(job.applicantLocationRequirements)
  }

  return { title, company, location, description }
}

// Job-board/platform site names that should never be used as company names.
const PLATFORM_SITE_NAMES = new Set([
  'linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'monster', 'dice', 'simplyhired',
])

function extractFromMeta(root: HTMLElement): Partial<ScrapedJD> {
  const meta = (selectors: string[]): string => {
    for (const sel of selectors) {
      const el = root.querySelector(sel)
      const val = el?.getAttribute('content')?.trim()
      if (val) return val
    }
    return ''
  }
  const titleTag = root.querySelector('title')?.text.trim() ?? ''
  // Title-tag patterns used by Greenhouse ("Job Application for X at Y"),
  // LinkedIn ("X - Company | LinkedIn"), and most careers pages ("X at Y" / "X | Y").
  let titleFromTag = ''
  let companyFromTag = ''
  if (titleTag) {
    const m =
      titleTag.match(/^(?:Job Application for\s+)?(.+?)\s+at\s+(.+?)(?:\s*[-|·].*)?$/i) ||
      titleTag.match(/^(.+?)\s+[-|·]\s+(.+?)(?:\s*[-|·].*)?$/)
    if (m) {
      titleFromTag = m[1].trim()
      companyFromTag = m[2].trim()
    }
  }

  const ogTitle = meta(['meta[property="og:title"]', 'meta[name="twitter:title"]'])

  // LinkedIn og:title is "Title at Company" — extract company as extra fallback.
  let companyFromOgTitle = ''
  if (ogTitle && !companyFromTag) {
    const m = ogTitle.match(/\bat\s+(.+)$/i)
    if (m) companyFromOgTitle = m[1].trim()
  }

  // Filter out platform names (e.g. "LinkedIn") from og:site_name.
  const rawSiteName = meta(['meta[property="og:site_name"]'])
  const siteName = PLATFORM_SITE_NAMES.has(rawSiteName.toLowerCase()) ? '' : rawSiteName

  return {
    title: ogTitle || titleFromTag || titleTag || root.querySelector('h1')?.text.trim() || '',
    company: siteName || companyFromTag || companyFromOgTitle,
    description: meta(['meta[property="og:description"]', 'meta[name="description"]']),
  }
}

function extractDescriptionDom(root: HTMLElement): string {
  const selectors = [
    '[class*="job-description"]',
    '[class*="posting-description"]',
    '[class*="jobDescription"]',
    '[class*="description"][class*="job"]',
    '[data-ui="job-description"]',   // Workable
    '[class*="styles--description"]', // Workable
    '#content',
    'main',
    'article',
  ]
  for (const sel of selectors) {
    const el = root.querySelector(sel)
    if (!el) continue
    const html = sanitizeHtml(el.innerHTML)
    if (stripHtml(html).length >= 400) return html
  }
  // Last resort: whole body
  const body = root.querySelector('body')
  if (body) {
    const html = sanitizeHtml(body.innerHTML)
    if (stripHtml(html).length >= 400) return html
  }
  return ''
}

function cleanTitle(title: string, company: string): string {
  if (!title) return ''
  let t = title.trim()
  // "Title at Company" / "Title - Company" / "Title | Company"
  if (company) {
    const co = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(`\\s*(?:[-|·]|at)\\s*${co}.*$`, 'i'), '').trim()
  }
  return t
}

// ── Headless browser fallback (local dev / server with Chrome) ────────────

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]

async function findChrome(): Promise<{ executablePath: string; args: string[]; headless: boolean | 'shell' } | null> {
  const { existsSync } = await import('node:fs')
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return {
      executablePath: p,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    }
  }
  // Serverless fallback — @sparticuz/chromium works on Vercel/Lambda
  try {
    const chromium = await import('@sparticuz/chromium')
    const executablePath = await chromium.default.executablePath()
    return {
      executablePath,
      args: chromium.default.args,
      headless: chromium.default.headless as boolean,
    }
  } catch {
    return null
  }
}

async function scrapeWithBrowser(url: string): Promise<Partial<ScrapedJD> | null> {
  const chrome = await findChrome()
  if (!chrome) return null

  let launch: typeof import('puppeteer-core')['launch'] | null = null
  try {
    const mod = await import('puppeteer-core')
    launch = mod.launch ?? (mod as any).default?.launch
  } catch {
    return null
  }
  if (!launch) return null

  let browser: import('puppeteer-core').Browser
  try {
    browser = await launch({
      executablePath: chrome.executablePath,
      headless: chrome.headless,
      args: chrome.args,
    })
  } catch {
    // Browser failed to start (missing system libs, bad binary, etc.) — degrade gracefully.
    return null
  }
  try {
    const page = await browser.newPage()
    await page.setUserAgent(USER_AGENT)
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
    // Block images/fonts/media to load faster
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) req.abort()
      else req.continue()
    })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: FETCH_TIMEOUT_MS })

    const html = await page.content()
    const root = parse(html)

    const jsonLd = extractJsonLdJobPosting(root)
    if (jsonLd?.description && stripHtml(jsonLd.description).length >= MIN_DESCRIPTION_CHARS) {
      return jsonLd
    }

    // Extract visible text from the rendered DOM
    const extracted = await page.evaluate(() => {
      const h1 = document.querySelector('h1')?.innerText?.trim() ?? ''
      const selectors = [
        '[class*="job-description"]', '[class*="posting-description"]',
        '[class*="jobDescription"]', '[class*="description"]',
        'main', 'article', '#content',
      ]
      let description = ''
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null
        if (el) {
          const text = el.innerText?.trim() ?? ''
          if (text.length > description.length) description = text
        }
      }
      if (description.length < 400) {
        description = document.body?.innerText?.trim() ?? ''
      }
      const titleEl = document.querySelector('title')?.textContent?.trim() ?? ''
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ?? ''
      const ogSite = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ?? ''
      return { h1, description, titleEl, ogTitle, ogSite }
    })

    const meta = extractFromMeta(root)
    const title = extracted.ogTitle || extracted.h1 || extracted.titleEl || meta.title || ''
    const company = extracted.ogSite || meta.company || ''
    return { title, company, description: plainTextToHtml(extracted.description) }
  } finally {
    await browser.close()
  }
}

// ── URL-based field hints ─────────────────────────────────────────────────
// Extracts title/company from the URL itself for platforms that encode them
// in the slug (LinkedIn) or subdomain (Workday). Used as last-resort fallback
// when scraping returns nothing — keeps at least the key fields pre-filled.

function titleCase(s: string): string {
  return s.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function extractHintsFromUrl(urlStr: string): { title: string; company: string } {
  const empty = { title: '', company: '' }
  try {
    const u = new URL(urlStr)
    const host = u.hostname.toLowerCase()

    // Workday: {company}.wd{N}.myworkdayjobs.com
    const workday = host.match(/^([a-z0-9][a-z0-9-]*)\.wd\d+\.myworkdayjobs\.com$/)
    if (workday) return { title: '', company: titleCase(workday[1]) }

    // LinkedIn: /jobs/view/{title-slug}-at-{company-slug}-{numeric-id}[/]
    if (host === 'www.linkedin.com' || host === 'linkedin.com') {
      const m = u.pathname.match(/\/jobs\/view\/(.+?)\/?$/)
      if (m) {
        // Remove trailing numeric job-id, then split on last "-at-"
        const slug = m[1].replace(/-\d+$/, '')
        const atIdx = slug.lastIndexOf('-at-')
        if (atIdx > 0) {
          return {
            title: titleCase(slug.slice(0, atIdx)),
            company: titleCase(slug.slice(atIdx + 4)),
          }
        }
      }
    }

    // Workable: apply.workable.com/{company-slug}/j/{job-id}
    if (host === 'apply.workable.com') {
      const m = u.pathname.match(/^\/([^/]+)\/j\//)
      if (m) return { title: '', company: titleCase(m[1]) }
    }
  } catch {}
  return empty
}

// ── Public entrypoint ─────────────────────────────────────────────────────

export async function scrapeJD(url: string): Promise<ScrapedJD> {
  await assertSafeHost(url)

  // Static fetch first — fast and works for most ATSs
  const html = await fetchCapped(url)
  const root = parse(html)

  const jsonLd = extractJsonLdJobPosting(root)
  const meta = extractFromMeta(root)

  const urlHints = extractHintsFromUrl(url)

  let title = jsonLd?.title || meta.title || urlHints.title
  let company = jsonLd?.company || meta.company || urlHints.company
  let location = jsonLd?.location || ''
  let description = jsonLd?.description || ''

  if (!description || stripHtml(description).length < MIN_DESCRIPTION_CHARS) {
    const fromDom = extractDescriptionDom(root)
    if (stripHtml(fromDom).length > stripHtml(description).length) description = fromDom
  }
  if (!description) description = meta.description || ''

  title = cleanTitle(title, company)

  // Platforms that detect/block headless browsers — headless Chrome makes things worse
  // (returns login-wall titles that overwrite correctly scraped meta data).
  const host = new URL(url).hostname.toLowerCase()
  const skipBrowser = host === 'www.linkedin.com' || host === 'linkedin.com'

  const isThin = !title || stripHtml(description).length < MIN_DESCRIPTION_CHARS
  if (isThin && !skipBrowser) {
    // JS-rendered page — try headless Chrome
    const browser = await scrapeWithBrowser(url)
    if (browser) {
      if (browser.title) title = cleanTitle(browser.title, browser.company ?? company)
      if (browser.company) company = browser.company
      if (browser.location) location = browser.location
      if (browser.description && stripHtml(browser.description).length > stripHtml(description).length) {
        description = browser.description
      }
    }
    // Re-apply URL hints if the browser/scraping path cleared them
    if (!title && urlHints.title) title = urlHints.title
    if (!company && urlHints.company) company = urlHints.company
  }

  const result: ScrapedJD = { title, company, location, description }
  if (!title || stripHtml(description).length < MIN_DESCRIPTION_CHARS) {
    result.warning = 'Could not confidently extract the job description. Please review and paste it manually if needed.'
  }
  return result
}
