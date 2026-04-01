import { NextRequest, NextResponse } from 'next/server'

/**
 * Gate all /api/* routes with SECRET_API_TOKEN.
 *
 * The token is checked in this order:
 *   1. Authorization: Bearer <token> header
 *   2. ?token=<token> query param
 *   3. x-api-token cookie (set by the app layout)
 *
 * If SECRET_API_TOKEN is not set (local dev), all requests pass through.
 */
export function middleware(req: NextRequest) {
  const secret = process.env.SECRET_API_TOKEN
  if (!secret) return NextResponse.next() // dev mode — no gate

  const bearerToken = req.headers.get('authorization')?.replace('Bearer ', '')
  const queryToken = req.nextUrl.searchParams.get('token')
  const cookieToken = req.cookies.get('api-token')?.value

  if (bearerToken === secret || queryToken === secret || cookieToken === secret) {
    return NextResponse.next()
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export const config = {
  matcher: '/api/:path*',
}
