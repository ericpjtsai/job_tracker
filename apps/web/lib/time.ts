// Timezone helper for "today midnight in Pacific time" calculations.
//
// NOTE: this is a deliberate copy of scripts/_shared/time.ts. Next.js can't
// import from `scripts/` (outside the apps/web TS rootDir) and we don't want
// to add it to @job-tracker/scoring (that package has no other date logic).
// If you change this file, update scripts/_shared/time.ts to match.

/**
 * Returns the ISO string for midnight today in America/Los_Angeles (Pacific
 * Time), expressed as a UTC instant. Handles PST/PDT automatically.
 *
 * Example: called at 2026-04-08 14:30 PT (PDT) → "2026-04-08T07:00:00.000Z"
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
