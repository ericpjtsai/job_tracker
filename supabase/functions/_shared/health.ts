// source_health table helpers.
// Replaces the listener daemon's in-memory health tracking with persisted state.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.43.0'

export interface SourceHealthPatch {
  status?: 'idle' | 'polling' | 'healthy' | 'error' | 'disabled'
  last_poll_at?: string | null
  last_success_at?: string | null
  last_error_at?: string | null
  last_error?: string | null
  consecutive_failures?: number
  jobs_found_total?: number
  jobs_found_last?: number
  abort_requested?: boolean
  progress_current?: number
  progress_total?: number
  meta?: Record<string, unknown>
}

/**
 * Mark a source as starting a poll. Resets abort_requested and progress.
 */
export async function markPolling(
  supabase: SupabaseClient,
  sourceId: string,
  total?: number,
): Promise<void> {
  await supabase
    .from('source_health')
    .update({
      status: 'polling',
      last_poll_at: new Date().toISOString(),
      abort_requested: false,
      progress_current: 0,
      progress_total: total ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('source_id', sourceId)
}

/**
 * Mark a source as completed successfully. Increments totals.
 */
export async function markHealthy(
  supabase: SupabaseClient,
  sourceId: string,
  jobsFound: number,
): Promise<void> {
  // Read current totals so we can increment
  const { data: row } = await supabase
    .from('source_health')
    .select('jobs_found_total')
    .eq('source_id', sourceId)
    .maybeSingle()
  const currentTotal = (row?.jobs_found_total as number | undefined) ?? 0

  await supabase
    .from('source_health')
    .update({
      status: 'healthy',
      last_success_at: new Date().toISOString(),
      consecutive_failures: 0,
      jobs_found_total: currentTotal + jobsFound,
      jobs_found_last: jobsFound,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('source_id', sourceId)
}

/**
 * Mark a source as errored. Increments consecutive_failures.
 */
export async function markError(
  supabase: SupabaseClient,
  sourceId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)

  const { data: row } = await supabase
    .from('source_health')
    .select('consecutive_failures')
    .eq('source_id', sourceId)
    .maybeSingle()
  const failures = ((row?.consecutive_failures as number | undefined) ?? 0) + 1

  await supabase
    .from('source_health')
    .update({
      status: 'error',
      last_error_at: new Date().toISOString(),
      last_error: message.slice(0, 1000),
      consecutive_failures: failures,
      updated_at: new Date().toISOString(),
    })
    .eq('source_id', sourceId)
}

/**
 * Update progress counters mid-poll (used by ATS batches and rescore chunks).
 */
export async function updateProgress(
  supabase: SupabaseClient,
  sourceId: string,
  current: number,
  total?: number,
  meta?: Record<string, unknown>,
): Promise<void> {
  const update: Record<string, unknown> = {
    progress_current: current,
    updated_at: new Date().toISOString(),
  }
  if (total !== undefined) update.progress_total = total
  if (meta !== undefined) update.meta = meta
  await supabase.from('source_health').update(update).eq('source_id', sourceId)
}

/**
 * Check whether the user has requested an abort via the web Stop button.
 * Returns true if the in-flight poll should exit.
 */
export async function isAbortRequested(
  supabase: SupabaseClient,
  sourceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('source_health')
    .select('abort_requested')
    .eq('source_id', sourceId)
    .maybeSingle()
  return Boolean(data?.abort_requested)
}
