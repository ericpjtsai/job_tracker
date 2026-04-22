// VENDORED from packages/scoring/src/score.ts — keep in sync.
// Internal imports use .ts extensions for Deno compatibility.

import { KEYWORD_GROUPS, getKeywordGroups, type KeywordGroup } from './keywords.ts'
import { companyFromDomain } from './companies.ts'
import { isSeniorityExcluded, getSeniorityBonus } from './seniority.ts'
import { extractSalary, type SalaryRange } from './salary.ts'

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
  excluded: boolean
  salary: SalaryRange
}

const SF_BAY_AREA = [
  'san francisco', 'sf', 'bay area', 'san jose', 'sunnyvale', 'mountain view',
  'palo alto', 'redwood city', 'menlo park', 'south bay', 'east bay',
]
const SEATTLE = ['seattle', 'bellevue', 'redmond', 'kirkland']
const NYC = ['new york', 'nyc', 'brooklyn', 'manhattan']
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
  return 0
}

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

let compiledKeywords = compileKeywords(KEYWORD_GROUPS)

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

export interface ScoreInput {
  text: string
  title: string
  company: string
  location: string
  url?: string
}

export function scorePosting(opts: ScoreInput): ScoreResult {
  const { text, title, location, url } = opts
  let { company } = opts

  if (!company && url) {
    try {
      const domain = new URL(url).hostname
      company = companyFromDomain(domain)
    } catch {
      company = ''
    }
  }

  const combined = `${title} ${text} ${location}`

  const excluded = isSeniorityExcluded(title, text)

  const { groupScores, matched } = matchKeywords(combined)

  const seniorityBonus = excluded ? 0 : getSeniorityBonus(title, text)

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

// Recalibrated 2026-04-21 against 315 Haiku samples — old curve undershot
// Haiku's role_fit by mean +21 points. See packages/scoring/src/score.ts
// for the target bucket medians.
export function computeResumeFit(
  postingKeywords: string[],
  resumeKeywords: string[]
): number {
  if (postingKeywords.length === 0) return 0
  const resumeSet = new Set(resumeKeywords.map((k) => k.toLowerCase()))
  const matched = postingKeywords.filter((k) => resumeSet.has(k.toLowerCase())).length
  if (matched === 0) return 0
  if (matched <= 3) return 25 + matched                              // 26, 27, 28
  if (matched <= 6) return Math.round(55 + (matched - 4) * 3.5)      // 55, 58, 62
  if (matched <= 12) return Math.round(65 + (matched - 7) * 1.5)     // 65-72
  if (matched <= 18) return Math.round(73 + (matched - 13) * 0.6)    // 73-76
  return Math.min(80, Math.round(76 + (matched - 18) * 0.3))         // 76-80 cap
}

export function extractResumeKeywords(resumeText: string): string[] {
  const { matched } = matchKeywords(resumeText)
  return [...new Set(matched)]
}
