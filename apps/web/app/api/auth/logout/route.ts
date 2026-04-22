import { NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    path: '/',
    maxAge: 0,
  })
  res.cookies.set('admin-flag', '', {
    httpOnly: false,
    sameSite: 'strict',
    secure: true,
    path: '/',
    maxAge: 0,
  })
  return res
}
