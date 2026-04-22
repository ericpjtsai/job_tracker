// In-memory per-IP rate limiter. Best-effort defense — cold starts reset
// state, but a warm serverless instance catches bursts. Pair with
// lib/llm-budget.ts for the hard $ wall.

import { NextResponse, type NextRequest } from 'next/server'

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

// Lazy eviction: on every call, prune ~1% of buckets that have expired.
function maybeEvict() {
  if (buckets.size < 100 || Math.random() > 0.01) return
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k)
  }
}

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  resetAt: number
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  maybeEvict()
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, limit, remaining: limit - 1, resetAt: now + windowMs }
  }
  if (bucket.count >= limit) {
    return { ok: false, limit, remaining: 0, resetAt: bucket.resetAt }
  }
  bucket.count++
  return { ok: true, limit, remaining: limit - bucket.count, resetAt: bucket.resetAt }
}

/**
 * Check a bucket's state without incrementing. Used by failure counters
 * where the caller decides whether to bump based on the outcome.
 */
export function peekLimit(key: string, limit: number): { exceeded: boolean; resetAt: number } {
  const bucket = buckets.get(key)
  if (!bucket || Date.now() >= bucket.resetAt) return { exceeded: false, resetAt: 0 }
  return { exceeded: bucket.count >= limit, resetAt: bucket.resetAt }
}

/**
 * Block obviously-programmatic User-Agents on read endpoints. All modern
 * browsers send a non-empty, non-curl UA. Legit API consumers can bypass
 * this by sending `Authorization: Bearer $SECRET_API_TOKEN` — checked
 * upstream of this filter in middleware.
 *
 * Returns a 403 response if the UA looks like a bot, else null.
 */
export function blockBotUA(req: Request | NextRequest): NextResponse | null {
  // Bearer-auth callers bypass the UA check.
  if (req.headers.get('authorization')?.startsWith('Bearer ')) return null
  const ua = req.headers.get('user-agent') ?? ''
  if (!ua) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const botRegex = /\b(curl|wget|python-requests|go-http-client|scrapy|httpclient|java|okhttp|libwww-perl)\b/i
  if (botRegex.test(ua)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export function getClientIp(req: Request | NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

/**
 * Convenience: apply rate limit and return a 429 response if exceeded.
 * Caller passes a scope string (e.g. "jobs-import") that namespaces the IP.
 */
export function enforceRateLimit(
  req: Request | NextRequest,
  scope: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const ip = getClientIp(req)
  const result = rateLimit(`${scope}:${ip}`, limit, windowMs)
  if (result.ok) return null
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
  return NextResponse.json(
    { error: 'Too many requests. Please slow down.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      },
    },
  )
}
