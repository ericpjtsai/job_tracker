// /api/jobs/rescore — drives the chunked rescore Edge Function.
// POST fires the first chunk; the Edge Function self-chains via fetch + EdgeRuntime.waitUntil.
// GET reads source_health row 'rescore' for progress.
//
// SECURITY: server-side only. Browser → /api/jobs/rescore → Edge Function (with service-role key).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { enforceRateLimit } from '@/lib/rate-limit'
import { checkBudget } from '@/lib/llm-budget'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, 'jobs-rescore', 2, 60 * 60 * 1000)
  if (limited) return limited

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 })
  }

  // Rescore can cost tens of dollars; refuse if the daily LLM cap is already
  // consumed. The Edge Function itself rescores in chunks; this is a best-
  // effort pre-check at the Next.js level.
  const supabase = createServerClient()
  const budget = await checkBudget(supabase, 'haiku', 50) // assume at least 50 calls
  if (!budget.allowed) {
    return NextResponse.json(
      { error: `Daily LLM budget exceeded ($${budget.spent.toFixed(2)}/$${budget.cap}). Try again tomorrow.` },
      { status: 429 },
    )
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rescore`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ offset: 0 }),
    })
    const data = await res.json().catch(() => ({ ok: false }))
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}

export async function GET() {
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('source_health')
      .select('status, progress_current, progress_total, last_error')
      .eq('source_id', 'rescore')
      .maybeSingle()

    if (!data) {
      return NextResponse.json({ running: false, current: 0, total: 0, updated: 0, errors: 0 })
    }

    const row = data as { status: string; progress_current: number; progress_total: number; last_error: string | null }
    return NextResponse.json({
      running: row.status === 'polling',
      current: row.progress_current,
      total: row.progress_total,
      updated: row.progress_current,
      errors: row.last_error ? 1 : 0,
    })
  } catch (err) {
    return NextResponse.json({ running: false, current: 0, total: 0, updated: 0, errors: 0, error: err instanceof Error ? err.message : 'unknown' })
  }
}
