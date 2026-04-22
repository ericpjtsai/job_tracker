// Daily LLM spend cap. Uses scoring_config row keyed 'llm_budget_daily'
// to track today's approximate $ spend. Not atomic — a concurrent burst
// can exceed the cap by a handful of calls. Good enough for a single-user
// app; the cap itself is the backstop to the in-memory rate limiter.

import type { SupabaseClient } from '@supabase/supabase-js'

// Rough per-call cost estimates (input tokens × price + output tokens × price)
// Haiku 4.5: $1/MTok in, $5/MTok out. ~3k in + ~500 out = $0.0055
// Gemini 2.5 Flash: ~$0.0015 avg per call for a resume-sized document
const COST_PER_CALL: Record<CallKind, number> = {
  haiku: 0.0055,
  gemini: 0.0015,
}

export type CallKind = 'haiku' | 'gemini'

export function costPerCall(kind: CallKind): number {
  return COST_PER_CALL[kind]
}

function getCapUsd(): number {
  const env = process.env.LLM_DAILY_BUDGET_USD
  const parsed = env ? Number(env) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2.5
}

export function getBudgetCap(): number {
  return getCapUsd()
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

interface BudgetRow {
  date: string
  spent: number
  calls: number
}

async function readBudget(supabase: SupabaseClient): Promise<BudgetRow> {
  const { data } = await supabase
    .from('scoring_config')
    .select('value')
    .eq('key', 'llm_budget_daily')
    .maybeSingle()
  const today = todayKey()
  const val = (data as { value?: Partial<BudgetRow> } | null)?.value
  if (val?.date === today && typeof val.spent === 'number') {
    return { date: today, spent: val.spent, calls: val.calls ?? 0 }
  }
  return { date: today, spent: 0, calls: 0 }
}

async function writeBudget(supabase: SupabaseClient, row: BudgetRow): Promise<void> {
  await supabase
    .from('scoring_config')
    .upsert({ key: 'llm_budget_daily', value: row }, { onConflict: 'key' })
}

/**
 * Check whether making `estimatedCalls` more calls of `kind` would exceed
 * today's cap. Does NOT increment — call `recordLlmCalls` after the work
 * succeeds (or optimistically before it, depending on caller).
 */
export async function checkBudget(
  supabase: SupabaseClient,
  kind: CallKind,
  estimatedCalls = 1,
): Promise<{ allowed: boolean; spent: number; cap: number }> {
  const cap = getCapUsd()
  try {
    const row = await readBudget(supabase)
    const projected = row.spent + COST_PER_CALL[kind] * estimatedCalls
    return { allowed: projected <= cap, spent: row.spent, cap }
  } catch {
    // Fail-open on DB errors — don't brick the app when the budget-tracker
    // table is unreachable. The out-of-band monthly cap on Anthropic is
    // the true hard wall.
    return { allowed: true, spent: 0, cap }
  }
}

/**
 * Increment today's spend by `calls` calls of `kind`. Fire-and-forget
 * semantics — callers typically don't await.
 */
export async function recordLlmCalls(
  supabase: SupabaseClient,
  kind: CallKind,
  calls = 1,
): Promise<void> {
  try {
    const row = await readBudget(supabase)
    await writeBudget(supabase, {
      date: row.date,
      spent: row.spent + COST_PER_CALL[kind] * calls,
      calls: row.calls + calls,
    })
  } catch {
    // swallow — tracking failure shouldn't break the call path
  }
}
