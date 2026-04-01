// Scoring engine — implements CLAUDE.md §4 formula exactly

import { KEYWORD_GROUPS, getKeywordGroups, type KeywordGroup } from './keywords'
import { companyFromDomain } from './companies'
import { isSeniorityExcluded, getSeniorityBonus } from './seniority'
import { extractSalary, type SalaryRange } from './salary'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  b2b_domain: number
  ai_emerging: number
  core_design: number
  methods: number
  soft_skills: number
  tools: number
  seniority_bonus: number
  location_bonus: number
}

export type Priority = 'high' | 'medium' | 'low' | 'skip'

export interface ScoreResult {
  total: number
  breakdown: ScoreBreakdown
  keywords_matched: string[]
  priority: Priority
  excluded: boolean           // true if seniority excludes this posting
  salary: SalaryRange
}

// ─── Location matching ────────────────────────────────────────────────────────

const SF_BAY_AREA = [
  'san francisco', 'sf', 'bay area', 'san jose', 'sunnyvale', 'mountain view',
  'palo alto', 'redwood city', 'menlo park', 'south bay', 'east bay',
]
const SEATTLE = ['seattle', 'bellevue', 'redmond', 'kirkland']
const NYC = ['new york', 'nyc', 'brooklyn', 'manhattan']
// Non-US locations — apply -20 penalty
const NON_US = [
  'london', 'united kingdom', ' uk ', 'england', 'scotland', 'wales',
  'berlin', 'munich', 'hamburg', 'germany', 'deutschland',
  'paris', 'lyon', 'france',
  'tokyo', 'osaka', 'japan',
  'singapore',
  'sydney', 'melbourne', 'brisbane', 'australia',
  'toronto', 'vancouver', 'montreal', 'calgary', 'canada',
  'mumbai', 'bangalore', 'bengaluru', 'hyderabad', 'india',
  'dublin', 'ireland',
  'amsterdam', 'netherlands',
  'stockholm', 'sweden',
  'beijing', 'shanghai', 'shenzhen', 'china',
  'seoul', 'south korea',
  'tel aviv', 'israel',
  'são paulo', 'brazil',
  'mexico city', 'mexico',
  'madrid', 'barcelona', 'spain',
  'milan', 'rome', 'italy',
  'zurich', 'switzerland',
]

function getLocationBonus(locationText: string): number {
  const l = locationText.toLowerCase()
  if (l.includes('remote') || l.includes('hybrid')) return 5
  if (SF_BAY_AREA.some((s) => l.includes(s))) return 5
  if (SEATTLE.some((s) => l.includes(s))) return 5
  if (NYC.some((s) => l.includes(s))) return 3
  if (NON_US.some((s) => l.includes(s))) return -20
  // All other locations assumed US — no bonus, no penalty
  return 0
}

// ─── Keyword matching ─────────────────────────────────────────────────────────

type CompiledKeyword = { group: KeywordGroup; term: string; re: RegExp }

function compileKeywords(groups: KeywordGroup[]): CompiledKeyword[] {
  const result: CompiledKeyword[] = []
  for (const group of groups) {
    for (const term of group.terms) {
      const termLower = term.toLowerCase()
      const pattern = termLower.includes(' ')
        ? termLower
        : `\\b${termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
      result.push({ group, term, re: new RegExp(pattern, 'gi') })
    }
  }
  return result
}

// Initial compilation from defaults; rebuilt when setKeywordGroups() is called
let compiledKeywords = compileKeywords(KEYWORD_GROUPS)

/** Rebuild compiled keywords from current active groups. Call after setKeywordGroups(). */
export function recompileKeywords(): void {
  compiledKeywords = compileKeywords(getKeywordGroups())
}

function matchKeywords(text: string): {
  groupScores: Record<string, number>
  matched: string[]
} {
  const lower = text.toLowerCase()
  const groupScores: Record<string, number> = {}
  const matched: string[] = []

  for (const { group, term, re } of compiledKeywords) {
    re.lastIndex = 0
    const hits = (lower.match(re) ?? []).length
    if (hits > 0) {
      groupScores[group.name] = (groupScores[group.name] ?? 0) + group.weight * Math.min(hits, 3)
      matched.push(term)
    }
  }

  return { groupScores, matched }
}

// ─── Main scoring function ────────────────────────────────────────────────────

export interface ScoreInput {
  text: string        // full page content
  title: string       // job title
  company: string     // company name or domain
  location: string    // location string from page
  url?: string        // used to derive company from domain if company is empty
}

export function scorePosting(opts: ScoreInput): ScoreResult {
  const { text, title, location, url } = opts
  let { company } = opts

  // Derive company name from domain if not provided
  if (!company && url) {
    try {
      const domain = new URL(url).hostname
      company = companyFromDomain(domain)
    } catch {
      company = ''
    }
  }

  const combined = `${title} ${text} ${location}`

  // Seniority exclusion check
  const excluded = isSeniorityExcluded(title, text)

  // Keyword scoring
  const { groupScores, matched } = matchKeywords(combined)

  // Seniority bonus
  const seniorityBonus = excluded ? 0 : getSeniorityBonus(title, text)

  // Location bonus
  const locationBonus = getLocationBonus(`${location} ${text}`)

  const breakdown: ScoreBreakdown = {
    b2b_domain: groupScores['b2b_domain'] ?? 0,
    ai_emerging: groupScores['ai_emerging'] ?? 0,
    core_design: groupScores['core_design'] ?? 0,
    methods: groupScores['methods'] ?? 0,
    soft_skills: groupScores['soft_skills'] ?? 0,
    tools: groupScores['tools'] ?? 0,
    seniority_bonus: seniorityBonus,
    location_bonus: locationBonus,
  }

  const total = excluded
    ? 0
    : Object.values(breakdown).reduce((a, b) => a + b, 0)

  const priority: Priority = excluded
    ? 'skip'
    : total >= 50
    ? 'high'
    : total >= 30
    ? 'medium'
    : total >= 15
    ? 'low'
    : 'skip'

  const salary = extractSalary(text)

  return {
    total,
    breakdown,
    keywords_matched: [...new Set(matched)],
    priority,
    excluded,
    salary,
  }
}

// ─── Resume fit ───────────────────────────────────────────────────────────────

/**
 * Quick resume fit score based on matched keyword count.
 * Calibrated against LLM role_fit scores from 672 training samples:
 *   0 matched → 0 (skip)
 *   1-9 matched → scale 10-40 (low, LLM avg ~32)
 *   10-19 matched → scale 40-65 (medium, LLM avg ~66)
 *   20+ matched → scale 65-85 (high, LLM avg ~86)
 * This is a fast pre-filter; LLM enrichment overwrites with accurate role_fit.
 */
export function computeResumeFit(
  postingKeywords: string[],
  resumeKeywords: string[]
): number {
  if (postingKeywords.length === 0) return 0
  const resumeSet = new Set(resumeKeywords.map((k) => k.toLowerCase()))
  const matched = postingKeywords.filter((k) => resumeSet.has(k.toLowerCase())).length
  if (matched === 0) return 0
  if (matched < 10) return Math.round(10 + (matched / 9) * 30)  // 10-40
  if (matched < 20) return Math.round(40 + ((matched - 10) / 10) * 25)  // 40-65
  return Math.min(85, Math.round(65 + ((matched - 20) / 20) * 20))  // 65-85, cap at 85
}

/**
 * Extract keywords from resume text by matching against the full taxonomy.
 */
export function extractResumeKeywords(resumeText: string): string[] {
  const { matched } = matchKeywords(resumeText)
  return [...new Set(matched)]
}
