import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const listenerUrl = () => process.env.LISTENER_URL ?? 'http://localhost:3002'

export async function GET() {
  try {
    const res = await fetch(`${listenerUrl()}/status`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ running: false, current: 0, total: 0, error: 'Listener not reachable' })
  }
}

export async function DELETE() {
  try {
    const res = await fetch(`${listenerUrl()}/poll/stop`, { method: 'POST' })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Listener not reachable' }, { status: 503 })
  }
}

export async function POST() {
  try {
    const url = listenerUrl()
    // Fire ATS poll (tracked for progress) + LinkedIn poll (fire-and-forget)
    const [res] = await Promise.all([
      fetch(`${url}/poll`, { method: 'POST' }),
      fetch(`${url}/poll/mantiks`, { method: 'POST' }).catch(() => {}),
      fetch(`${url}/poll/indeed`, { method: 'POST' }).catch(() => {}),
      fetch(`${url}/poll/glassdoor`, { method: 'POST' }).catch(() => {}),
    ])
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Listener not reachable' }, { status: 503 })
  }
}
