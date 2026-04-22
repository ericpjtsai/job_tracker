import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { enforceRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, 'resume-download', 20, 60 * 1000)
  if (limited) return limited

  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const supabase = createServerClient()

  const { data, error } = await supabase.storage
    .from('resumes')
    .createSignedUrl(path, 60) // 60 second signed URL

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.redirect(data.signedUrl)
}
