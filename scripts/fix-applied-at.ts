import { createClient } from '@supabase/supabase-js'

// Fix applied_at for today's jobs that were stored with UTC midnight
// instead of actual application time due to date-only parsing bug
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // UTC midnight for today — the broken value that date-only parsing produced
  const todayUTC = new Date().toISOString().split('T')[0]
  const brokenTimestamp = `${todayUTC}T00:00:00.000Z`

  // Find jobs with applied_at set to exactly UTC midnight today
  const { data: jobs, error } = await supabase
    .from('job_postings')
    .select('id, title, company, applied_at, first_seen')
    .eq('applied_at', brokenTimestamp)

  if (error) { console.error('Query failed:', error.message); process.exit(1) }
  if (!jobs?.length) { console.log('No jobs found with broken applied_at'); return }

  console.log(`Found ${jobs.length} jobs with applied_at = ${brokenTimestamp}:`)
  for (const job of jobs) {
    console.log(`  - ${job.title} @ ${job.company}`)
  }

  // Update applied_at to local midnight (consistent with todayMidnight calculation)
  const localMidnight = new Date()
  localMidnight.setHours(0, 0, 0, 0)
  const fixedTimestamp = localMidnight.toISOString()

  const { error: updateError } = await supabase
    .from('job_postings')
    .update({ applied_at: fixedTimestamp })
    .eq('applied_at', brokenTimestamp)

  if (updateError) { console.error('Update failed:', updateError.message); process.exit(1) }
  console.log(`\nUpdated ${jobs.length} jobs: applied_at → ${fixedTimestamp}`)
}

main()
