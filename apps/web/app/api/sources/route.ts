import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const listenerUrl = () => process.env.LISTENER_URL ?? 'http://localhost:3001'

export async function GET() {
  try {
    const res = await fetch(`${listenerUrl()}/sources`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Listener not reachable', sources: [], firehoseRules: [] }, { status: 503 })
  }
}

export async function POST(request: Request) {
  try {
    const { triggerPath } = await request.json()
    if (!triggerPath) return NextResponse.json({ error: 'Missing triggerPath' }, { status: 400 })
    const res = await fetch(`${listenerUrl()}${triggerPath}`, { method: 'POST' })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Listener not reachable' }, { status: 503 })
  }
}
