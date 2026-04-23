import { NextRequest, NextResponse } from 'next/server'
import {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_MAX_AGE_SECONDS,
  createAdminCookieValue,
  timingSafePasswordEqual,
} from '@/lib/admin-auth'
import { enforceRateLimit, getClientIp, peekLimit, rateLimit } from '@/lib/rate-limit'

const GLOBAL_FAIL_KEY = 'login-fail:global'
const GLOBAL_FAIL_LIMIT = 50
const GLOBAL_FAIL_WINDOW_MS = 10 * 60 * 1000

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Per-IP brute-force guard — 5 attempts per 10 min.
  const limited = enforceRateLimit(req, 'auth-login', 5, 10 * 60 * 1000)
  if (limited) return limited

  // Global failure guard — defense against distributed (IP-rotating) attackers.
  // Tripped when 50+ wrong-password attempts land across all IPs in 10 min.
  const globalPeek = peekLimit(GLOBAL_FAIL_KEY, GLOBAL_FAIL_LIMIT)
  if (globalPeek.exceeded) {
    const retry = Math.max(1, Math.ceil((globalPeek.resetAt - Date.now()) / 1000))
    return NextResponse.json(
      { error: 'Too many failed logins across all clients. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(retry) } },
    )
  }

  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 })
  }
  if (!process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 })
  }

  let body: { password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const password = body.password
  if (typeof password !== 'string' || password.length === 0 || password.length > 200) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 400 })
  }

  if (!timingSafePasswordEqual(password, expected)) {
    // Record + log — feeds the global guard and gives us forensic signal.
    rateLimit(GLOBAL_FAIL_KEY, GLOBAL_FAIL_LIMIT, GLOBAL_FAIL_WINDOW_MS)
    console.warn(`[auth] failed login ip=${getClientIp(req)}`)
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  const value = await createAdminCookieValue()
  const res = NextResponse.json({ ok: true })
  const secure = process.env.NODE_ENV === 'production'
  res.cookies.set(ADMIN_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
  })
  // UI hint only — client reads this to flip out of demo mode. Forging it
  // does nothing: middleware + routes trust only the signed ADMIN_COOKIE_NAME.
  res.cookies.set('admin-flag', '1', {
    httpOnly: false,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
  })
  return res
}
