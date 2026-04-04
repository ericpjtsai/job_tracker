import { NextRequest, NextResponse } from 'next/server'

/**
 * API auth + cookie injection middleware.
 *
 * - /api/* routes: require SECRET_API_TOKEN via header, query param, or cookie
 * - Page routes: set the api-token cookie so client-side fetches pass auth
 * - If SECRET_API_TOKEN is not set (local dev), everything passes through
 */
export function middleware(req: NextRequest) {
  const secret = process.env.SECRET_API_TOKEN
  if (!secret) return NextResponse.next()

  const isApi = req.nextUrl.pathname.startsWith('/api/')

  const bearerToken = req.headers.get('authorization')?.replace('Bearer ', '')
  const queryToken = req.nextUrl.searchParams.get('token')
  const cookieToken = req.cookies.get('api-token')?.value
  const hasToken = bearerToken === secret || queryToken === secret || cookieToken === secret

  // API routes: require auth
  if (isApi) {
    if (!hasToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Demo mode: block write operations unless admin session cookie is present
    const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'
    const hasAdminSession = req.cookies.get('admin-session')?.value === 'true'
    if (isWrite && !hasAdminSession && process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
      return NextResponse.json({ error: 'Demo mode: write operations disabled' }, { status: 403 })
    }

    return NextResponse.next()
  }

  // Page routes: set cookie if missing so client-side fetches pass auth
  if (!cookieToken || cookieToken !== secret) {
    const res = NextResponse.next()
    res.cookies.set('api-token', secret, { httpOnly: true, sameSite: 'strict', secure: true, path: '/' })
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
