// Shared handler wrapper for poll Edge Functions.
// Each poll function calls runPollHandler() with its source_id and a poll callback.
// This handles auth, health tracking, error capture, and JSON response shaping.

import { getServiceClient, jsonResponse, requireServiceAuth } from './supabase.ts'
import { buildContext, type ProcessorContext } from './processor.ts'
import { markPolling, markHealthy, markError } from './health.ts'

export interface PollResult {
  inserted: number
  deduped: number
  blocked: number
  skipped: number
  /** Per-call API errors caught inside the poll loop (not exceptions that escape to the wrapper). */
  apiErrors: number
  /** Most recent error message from the inner loop, surfaced to source_health.last_error. */
  lastError: string | null
}

export type PollFn = (ctx: ProcessorContext, req: Request) => Promise<PollResult>

export async function runPollHandler(
  sourceId: string,
  req: Request,
  pollFn: PollFn,
): Promise<Response> {
  const authError = requireServiceAuth(req)
  if (authError) return authError

  const supabase = getServiceClient()

  try {
    const ctx = await buildContext(supabase)
    await markPolling(supabase, sourceId)

    const result = await pollFn(ctx, req)

    // A source is only "healthy" if it actually exchanged data with the upstream API
    // without all calls failing. If apiErrors > 0 and we got nothing back (no inserts,
    // no dedups), every upstream call failed — mark as error so the Sources page reflects
    // the real state instead of showing green for credit-exhausted/auth-broken accounts.
    const allCallsFailed = result.apiErrors > 0 && result.inserted === 0 && result.deduped === 0
    if (allCallsFailed) {
      await markError(
        supabase,
        sourceId,
        new Error(result.lastError ?? `${result.apiErrors} API call(s) failed, no data fetched`),
      )
    } else {
      await markHealthy(supabase, sourceId, result.inserted)
    }

    return jsonResponse({
      ok: true,
      sourceId,
      ...result,
    })
  } catch (err) {
    console.error(`[${sourceId}] poll error:`, err)
    await markError(supabase, sourceId, err)
    return jsonResponse(
      { ok: false, sourceId, error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
}

/**
 * Helper for sources that may yield many results — accumulates a PollResult
 * by classifying each insertJobPosting call.
 */
export function emptyResult(): PollResult {
  return { inserted: 0, deduped: 0, blocked: 0, skipped: 0, apiErrors: 0, lastError: null }
}

export function tally(result: PollResult, status: 'inserted' | 'deduped' | 'blocked' | 'skipped') {
  result[status]++
}

/**
 * Record a per-call API error from inside a poll loop without escaping to the wrapper.
 * Increments the counter and remembers the most recent message for source_health.
 */
export function tallyError(result: PollResult, err: unknown): void {
  result.apiErrors++
  result.lastError = err instanceof Error ? err.message : String(err)
}
