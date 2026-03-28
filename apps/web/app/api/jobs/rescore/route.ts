import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const LISTENER_URL = process.env.LISTENER_URL || 'http://localhost:3002'

// POST: trigger rescore on the listener (no timeout)
export async function POST() {
  try {
    const res = await fetch(`${LISTENER_URL}/rescore`, { method: 'POST' })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Listener not reachable' }, { status: 502 })
  }
}

// GET: poll rescore progress from the listener
export async function GET() {
  try {
    const res = await fetch(`${LISTENER_URL}/rescore/status`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ running: false, current: 0, total: 0, updated: 0, errors: 0 })
  }
}
