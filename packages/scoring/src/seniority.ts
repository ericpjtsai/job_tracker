// Seniority filters — dynamic, configurable at runtime

// ─── Default patterns (hardcoded fallbacks) ──────────────────────────────────

const DEFAULT_EXCLUDE = ['staff', 'principal', 'director', 'vp', 'vice president', 'head of', 'manager']
const DEFAULT_NEWGRAD = ['new grad', 'early career', '2026', 'associate', 'junior', 'entry.?level', 'university', 'recent graduate', 'graduate']
const DEFAULT_NON_DESIGN = ['lead', 'intern', 'internship', 'scholarship', 'researcher', 'strategist', 'motion designer', 'content designer', 'graphic designer', 'interior designer', 'multimedia designer', 'packaging designer', 'engineer', 'ai trainer', 'job trends', 'salaries', 'data scientist', 'business analyst', 'client associate', 'product specialist', 'professor', 'nurse', 'licensed practical nurse', "founder.s office", 'growth marketing', 'creative producer', 'model kit', 'data entry', 'cybersecurity', 'solutions architect', 'solutions consultant', 'civil designer', 'mechanical designer', 'structural designer', 'landscape designer', 'cad designer', 'cad drafter', 'drafter', 'architectural designer', 'electrical designer']

// ─── Compiled state ──────────────────────────────────────────────────────────

let excludePatterns: RegExp[] = compilePatterns(DEFAULT_EXCLUDE)
let newgradPatterns: RegExp[] = compilePatterns(DEFAULT_NEWGRAD)
let nonDesignRegex: RegExp = buildNonDesignRegex(DEFAULT_NON_DESIGN)

// These are not user-editable (complex regex with lookaheads/combined logic)
const EXCLUDE_COMBINED_PATTERNS = [
  /\blead\b.*\b(7|8|9|10)\+?\s*years?\b/i,
  /\b(8|9|10)\+\s*years?\b/i,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((p) => {
    try { return new RegExp(`\\b${p}\\b`, 'i') }
    catch { return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
  })
}

function buildNonDesignRegex(terms: string[]): RegExp {
  // Build a single alternation regex: \b(term1|term2|...)\b/i
  // Handle terms with special regex chars (like "founder.s office") by keeping them as-is
  // since they're stored as regex-compatible strings
  const escaped = terms.map((t) => {
    // If it looks like it has intentional regex (. ? + etc.), keep as-is
    if (/[.?+*\\()\[\]]/.test(t)) return t
    return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  try {
    return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i')
  } catch {
    // Fallback: escape everything
    const safe = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return new RegExp(`\\b(${safe.join('|')})\\b`, 'i')
  }
}

// ─── Dynamic setters ─────────────────────────────────────────────────────────

export interface SeniorityConfig {
  exclude?: string[]
  newgrad?: string[]
  nonDesign?: string[]
}

export function setSeniorityConfig(config: SeniorityConfig): void {
  if (config.exclude) excludePatterns = compilePatterns(config.exclude)
  if (config.newgrad) newgradPatterns = compilePatterns(config.newgrad)
  if (config.nonDesign) nonDesignRegex = buildNonDesignRegex(config.nonDesign)
}

export function getSeniorityConfig(): { exclude: string[]; newgrad: string[]; nonDesign: string[] } {
  return {
    exclude: DEFAULT_EXCLUDE,
    newgrad: DEFAULT_NEWGRAD,
    nonDesign: DEFAULT_NON_DESIGN,
  }
}

export function resetSeniorityConfig(): void {
  excludePatterns = compilePatterns(DEFAULT_EXCLUDE)
  newgradPatterns = compilePatterns(DEFAULT_NEWGRAD)
  nonDesignRegex = buildNonDesignRegex(DEFAULT_NON_DESIGN)
}

// ─── Public API (same signatures as before) ──────────────────────────────────

export function isRoleExcluded(title: string): boolean {
  return nonDesignRegex.test(title)
}

export function isSeniorityExcluded(title: string, text: string): boolean {
  if (excludePatterns.some((p) => p.test(title))) return true
  const combined = `${title} ${text}`
  return EXCLUDE_COMBINED_PATTERNS.some((p) => p.test(combined))
}

export function getSeniorityBonus(title: string, text: string): number {
  const combined = `${title} ${text}`
  if (newgradPatterns.some((p) => p.test(combined))) return 10
  if (SENIOR_NO_LEVEL_PATTERNS.some((p) => p.test(title))) return 5
  if (SENIOR_OVERQUALIFIED_PATTERNS.some((p) => p.test(combined))) return -10
  return 0
}
