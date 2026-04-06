// VENDORED from packages/scoring/src/salary.ts — keep in sync.

export interface SalaryRange {
  min: number | null
  max: number | null
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '').toLowerCase()
  const num = parseFloat(cleaned)
  if (cleaned.endsWith('k')) return Math.round(num * 1000)
  return Math.round(num)
}

export function extractSalary(text: string): SalaryRange {
  const rangePattern =
    /(?:USD|CAD|GBP|EUR|€|£|\$)\s*([\d,]+(?:\.\d+)?k?)\s*(?:–|-|to)\s*(?:USD|CAD|GBP|EUR|€|£|\$)?\s*([\d,]+(?:\.\d+)?k?)/gi

  const singlePattern =
    /(?:USD|CAD|GBP|EUR|€|£|\$)\s*([\d,]+(?:\.\d+)?k?)\s*(?:\/yr|\/year|per year|annually)/gi

  let match: RegExpExecArray | null

  match = rangePattern.exec(text)
  if (match) {
    const min = parseAmount(match[1])
    const max = parseAmount(match[2])
    if (min >= 20000 && max >= min && max <= 1000000) {
      return { min, max }
    }
  }

  match = singlePattern.exec(text)
  if (match) {
    const val = parseAmount(match[1])
    if (val >= 20000 && val <= 1000000) {
      return { min: val, max: val }
    }
  }

  return { min: null, max: null }
}
