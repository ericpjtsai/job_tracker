// Shared timezone helper. The "today midnight in Pacific time" calculation
// previously lived in 3+ places (import/route.ts, re-enrich-today.ts,
// benchmark-today.ts) — a recipe for drift. Single source of truth here.

/**
 * Returns the ISO string for midnight today in America/Los_Angeles (Pacific
 * Time), expressed as a UTC instant. Handles PST/PDT automatically via
 * `Intl.DateTimeFormat` with the timezone option.
 *
 * Example: called at 2026-04-08 14:30 PT → "2026-04-08T07:00:00.000Z" (PDT)
 */
export function getPTMidnightToday(): string {
  const now = new Date()
  const ptDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now) // e.g. "2026-04-08"
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value ?? 'GMT-8'
  const offsetH = parseInt(tzName.match(/GMT([+-]\d+)/)?.[1] ?? '-8')
  const sign = offsetH < 0 ? '-' : '+'
  const absH = String(Math.abs(offsetH)).padStart(2, '0')
  return new Date(`${ptDate}T00:00:00${sign}${absH}:00`).toISOString()
}
