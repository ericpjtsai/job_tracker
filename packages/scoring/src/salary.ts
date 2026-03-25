// Salary extraction from page content

export interface SalaryRange {
  min: number | null
  max: number | null
}

/**
 * Convert a raw string like "140k", "140,000", "140000" to an integer.
 */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '').toLowerCase()
  const num = parseFloat(cleaned)
  if (cleaned.endsWith('k')) return Math.round(num * 1000)
  return Math.round(num)
}

/**
 * Extract salary range from page text.
 * Handles formats like:
 *   $140k–$180k   $140,000 - $180,000   $140k to $180k
 *   USD 140,000 – 180,000   140000/yr   140k-180k/year
 *   $140,000/yr   £120k
 */
export function extractSalary(text: string): SalaryRange {
  // Pattern: two numbers with optional currency symbols, separated by range delimiter
  const rangePattern =
    /(?:USD|CAD|GBP|EUR|€|£|\$)\s*([\d,]+(?:\.\d+)?k?)\s*(?:–|-|to)\s*(?:USD|CAD|GBP|EUR|€|£|\$)?\s*([\d,]+(?:\.\d+)?k?)/gi

  // Pattern: single number with /yr or /year
  const singlePattern =
    /(?:USD|CAD|GBP|EUR|€|£|\$)\s*([\d,]+(?:\.\d+)?k?)\s*(?:\/yr|\/year|per year|annually)/gi

  let match: RegExpExecArray | null

  // Try range first
  match = rangePattern.exec(text)
  if (match) {
    const min = parseAmount(match[1])
    const max = parseAmount(match[2])
    // Sanity check: realistic salary range ($20k–$1M)
    if (min >= 20000 && max >= min && max <= 1000000) {
      return { min, max }
    }
  }

  // Try single value
  match = singlePattern.exec(text)
  if (match) {
    const val = parseAmount(match[1])
    if (val >= 20000 && val <= 1000000) {
      return { min: val, max: val }
    }
  }

  return { min: null, max: null }
}

/**
 * Format salary range for display.
 * e.g. { min: 140000, max: 180000 } → "$140k–$180k"
 */
export function formatSalary(range: SalaryRange): string | null {
  if (!range.min && !range.max) return null
  const fmt = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`)
  if (range.min && range.max && range.min !== range.max) {
    return `${fmt(range.min)}–${fmt(range.max)}`
  }
  if (range.min) return fmt(range.min)
  if (range.max) return fmt(range.max)
  return null
}
