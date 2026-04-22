// HMAC-signed admin session cookies. Runs on both Edge (middleware) and
// Node (route handlers), so this uses Web Crypto (crypto.subtle) which is
// available in both runtimes.

const COOKIE_NAME = 'admin-session'
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours — short enough to limit
// blast radius of a forgotten laptop / stolen cookie, long enough to avoid
// constant re-login. User must re-enter password daily.

function getSecret(): string | null {
  return process.env.ADMIN_SECRET ?? null
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Constant-time string comparison. Pads to the longer length and XORs
 * every position; length mismatch is folded into the diff rather than
 * causing an early return. Do not early-exit — that would leak length.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME

export async function createAdminCookieValue(ttlMs = DEFAULT_TTL_MS): Promise<string> {
  const secret = getSecret()
  if (!secret) throw new Error('ADMIN_SECRET not set')
  const expiry = Date.now() + ttlMs
  const sig = await hmacHex(secret, `admin:${expiry}`)
  return `${expiry}.${sig}`
}

export async function verifyAdminCookieValue(value: string | undefined | null): Promise<boolean> {
  if (!value) return false
  const secret = getSecret()
  if (!secret) return false
  const dot = value.indexOf('.')
  if (dot <= 0) return false
  const expiry = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expMs = Number.parseInt(expiry, 10)
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false
  const expected = await hmacHex(secret, `admin:${expiry}`)
  return timingSafeEqual(sig, expected)
}

/** Constant-time password comparison. See `timingSafeEqual` above. */
export function timingSafePasswordEqual(input: string, expected: string): boolean {
  return timingSafeEqual(input, expected)
}

export const ADMIN_COOKIE_MAX_AGE_SECONDS = Math.floor(DEFAULT_TTL_MS / 1000)
