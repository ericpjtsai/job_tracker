// Seniority filters from CLAUDE.md §5

const EXCLUDE_TITLE_PATTERNS = [
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\bdirector\b/i,
  /\bvp\b/i,
  /\bvice president\b/i,
  /\bhead of\b/i,
  /\bmanager\b/i,
]

const EXCLUDE_COMBINED_PATTERNS = [
  /\blead\b.*\b(7|8|9|10)\+?\s*years?\b/i,
  /\b(8|9|10)\+\s*years?\b/i,
]

const NEWGRAD_PATTERNS = [
  /\bnew grad\b/i,
  /\bearly career\b/i,
  /\b2026\b/,
  /\bassociate\b/i,
  /\bjunior\b/i,
  /\bentry.?level\b/i,
  /\buniversity\b/i,
  /\brecent graduate\b/i,
  /\bgraduate\b/i,
]

const SENIOR_NO_LEVEL_PATTERNS = [
  /^product designer$/i,
  /^ux designer$/i,
  /^interaction designer$/i,
  /^experience designer$/i,
  /^design engineer$/i,
  /product designer\s+(i|ii|1|2)\b/i,
]

const SENIOR_OVERQUALIFIED_PATTERNS = [
  /\bsenior\b.*\b(7|8|9|10)\+?\s*years?\b/i,
  /\b(7|8)\+\s*years?\b/i,
]

// Non-design roles — hard block (job is dropped entirely, never inserted)
const NON_DESIGN_TITLE = /\b(intern(ship)?|scholarship|researcher|strategist|motion designer|engineer|ai trainer|job trends|salaries)\b/i

/**
 * Returns true if the title indicates a non-design role.
 * These jobs are dropped entirely (not inserted into the DB).
 */
export function isRoleExcluded(title: string): boolean {
  return NON_DESIGN_TITLE.test(title)
}

/**
 * Returns true if the posting should be excluded by seniority.
 * Job is inserted with priority = 'skip' (soft block — visible but deprioritized).
 */
export function isSeniorityExcluded(title: string, text: string): boolean {
  if (EXCLUDE_TITLE_PATTERNS.some((p) => p.test(title))) return true
  const combined = `${title} ${text}`
  return EXCLUDE_COMBINED_PATTERNS.some((p) => p.test(combined))
}

/**
 * Returns the seniority score bonus per CLAUDE.md §4.
 *   new grad / early career / associate = +10
 *   product designer (no level) / I / II = +5
 *   senior with 5+ yrs = +0
 *   senior with 7+ yrs = -10
 *   staff / principal / director = excluded (isSeniorityExcluded handles this)
 */
export function getSeniorityBonus(title: string, text: string): number {
  const combined = `${title} ${text}`

  if (NEWGRAD_PATTERNS.some((p) => p.test(combined))) return 10
  if (SENIOR_NO_LEVEL_PATTERNS.some((p) => p.test(title))) return 5
  if (SENIOR_OVERQUALIFIED_PATTERNS.some((p) => p.test(combined))) return -10

  return 0
}
