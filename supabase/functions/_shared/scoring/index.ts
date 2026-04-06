// Re-exports for the scoring sub-package.
// VENDORED from packages/scoring/src/ — keep in sync with that package.
// Edge Functions cannot import workspace bare specifiers.

export { scorePosting, computeResumeFit, extractResumeKeywords, recompileKeywords } from './score.ts'
export type { ScoreResult, ScoreBreakdown, ScoreInput, Priority } from './score.ts'
export { extractSalary } from './salary.ts'
export type { SalaryRange } from './salary.ts'
export { companyFromDomain, normalizeCompanyName } from './companies.ts'
export {
  isRoleExcluded,
  isSeniorityExcluded,
  getSeniorityBonus,
  setSeniorityConfig,
  resetSeniorityConfig,
} from './seniority.ts'
export type { SeniorityConfig } from './seniority.ts'
export {
  KEYWORD_GROUPS,
  ALL_TERMS,
  getKeywordGroups,
  setKeywordGroups,
  getActiveTerms,
  resetKeywordGroups,
  DEFAULT_KEYWORD_GROUPS,
} from './keywords.ts'
export type { KeywordGroup } from './keywords.ts'
