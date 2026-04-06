// /api/poll — proxies polling state and triggers to Supabase Edge Functions.
// Replaces the listener daemon's port 3002 control server.
//
// SECURITY: this route runs server-side and uses SUPABASE_SERVICE_ROLE_KEY.
// Never call Edge Functions directly from the browser with this key.
//
// GET    → returns ATS poll progress from source_health row 'ats'
// DELETE → flips source_health.abort_requested for 'ats' (Stop button)
// POST   → fires all sources in parallel (ATS batch 0 + mantiks/indeed/glassdoor/serpapi/github)

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function fnUrl(name: string) {
  return `${SUPABASE_URL}/functions/v1/${name}`
}

function fireFn(name: string, body?: unknown): Promise<Response> {
  return fetch(fnUrl(name), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : '{}',
  })
}

export async function GET() {
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('source_health')
      .select('status, progress_current, progress_total, abort_requested')
      .eq('source_id', 'ats')
      .maybeSingle()

    if (!data) {
      return NextResponse.json({ running: false, current: 0, total: 0 })
    }

    const row = data as { status: string; progress_current: number; progress_total: number; abort_requested: boolean }
    return NextResponse.json({
      running: row.status === 'polling',
      current: row.progress_current,
      total: row.progress_total,
      abort: row.abort_requested,
    })
  } catch (err) {
    return NextResponse.json({
      running: false,
      current: 0,
      total: 0,
      error: err instanceof Error ? err.message : 'unknown',
    })
  }
}

export async function DELETE() {
  try {
    const supabase = createServerClient()
    await supabase
      .from('source_health')
      .update({ abort_requested: true, updated_at: new Date().toISOString() })
      .eq('source_id', 'ats')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}

export async function POST() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 })
  }
  try {
    // Kick off all sources in parallel. ATS only fires batch 0 here — the cron schedule
    // handles the other 3 batches. Manual "Run All" gives users an immediate sample without
    // waiting 45 minutes for all batches to fire on schedule.
    const [atsRes] = await Promise.all([
      fireFn('poll-ats', { batch: 0 }),
      fireFn('poll-mantiks').catch(() => null),
      fireFn('poll-hasdata', { platform: 'indeed' }).catch(() => null),
      fireFn('poll-hasdata', { platform: 'glassdoor' }).catch(() => null),
      fireFn('poll-serpapi').catch(() => null),
      fireFn('poll-linkedin').catch(() => null),
      fireFn('poll-github').catch(() => null),
    ])
    const data = await atsRes.json().catch(() => ({ ok: false }))
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}
