import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME, verifyAdminCookieValue } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

/**
 * Confirm whether the current browser session is authenticated as admin.
 * The client-visible `admin-flag` cookie is just a UI hint and can be
 * forged; the authoritative answer comes from HMAC-verifying the
 * httpOnly `admin-session` cookie.
 */
export async function GET(req: NextRequest) {
  const sessionValue = req.cookies.get(ADMIN_COOKIE_NAME)?.value
  const admin = await verifyAdminCookieValue(sessionValue)
  return NextResponse.json({ admin }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
