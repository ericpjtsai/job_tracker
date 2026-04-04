import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { extractResumeKeywords, extractResumeKeywordsWithLLM } from '@job-tracker/scoring'

export const dynamic = 'force-dynamic'

// ── GET: list all resume versions ─────────────────────────────────────────────

export async function GET() {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('resume_versions')
    .select('id,filename,uploaded_at,is_active,resume_type,storage_path,keywords_extracted')
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For inactive versions, replace keywords array with just the count to reduce payload
  const versions = (data ?? []).map(v => {
    if (v.is_active) return v
    const count = v.keywords_extracted?.length ?? 0
    return { ...v, keywords_extracted: Array.from({ length: count }, (_, i) => String(i)) }
  })
  return NextResponse.json({ versions }, {
    headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' },
  })
}

// ── PATCH: set a resume version as active ─────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = createServerClient()
  const { id } = await req.json()

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Get the resume to find its type
  const { data: target } = await supabase.from('resume_versions').select('resume_type').eq('id', id).single()
  const resumeType = target?.resume_type ?? 'ats'

  // Deactivate only resumes of the same type
  await supabase.from('resume_versions').update({ is_active: false }).eq('is_active', true).eq('resume_type', resumeType)

  // Activate the selected one
  const { data: resume, error } = await supabase
    .from('resume_versions')
    .update({ is_active: true })
    .eq('id', id)
    .select()
    .single()

  if (error || !resume) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 500 })

  return NextResponse.json({ ok: true, resume })
}

// ── POST: upload new resume ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient()

  // Parse multipart form
  const form = await req.formData()
  const file = form.get('file') as File | null
  const resumeType = (form.get('resume_type') as string) || 'ats'

  if (!file || file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'A PDF file is required' }, { status: 400 })
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
  }

  // ── Extract text from PDF ────────────────────────────────────────────────
  let pdfText = ''
  try {
    // pdf-parse needs a Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    // Dynamic import to avoid Next.js edge runtime issues
    const pdfParse = (await import('pdf-parse')).default
    const parsed = await pdfParse(buffer)
    pdfText = parsed.text
  } catch (err) {
    return NextResponse.json({ error: 'Failed to parse PDF' }, { status: 422 })
  }

  // ── Extract keywords from resume text ────────────────────────────────────
  // Try Claude Opus for richer keyword extraction, fall back to regex
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const llmKeywords = anthropicKey ? await extractResumeKeywordsWithLLM(pdfText, anthropicKey) : null
  const keywords = llmKeywords ?? extractResumeKeywords(pdfText)

  // ── Store PDF in Supabase Storage ────────────────────────────────────────
  const storagePath = `resumes/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const arrayBuffer = await file.arrayBuffer()

  const { error: storageError } = await supabase.storage
    .from('resumes')
    .upload(storagePath, arrayBuffer, { contentType: 'application/pdf', upsert: false })

  if (storageError) {
    console.error('Storage error:', storageError)
    // Non-fatal — continue without storage if bucket not configured
  }

  // ── Deactivate previous active resume of same type ───────────────────────
  await supabase
    .from('resume_versions')
    .update({ is_active: false })
    .eq('is_active', true)
    .eq('resume_type', resumeType)

  // ── Insert new resume version ─────────────────────────────────────────────
  const { data: newResume, error: insertError } = await supabase
    .from('resume_versions')
    .insert({
      filename: file.name,
      storage_path: storagePath,
      keywords_extracted: keywords,
      is_active: true,
      resume_type: resumeType,
    })
    .select()
    .single()

  if (insertError || !newResume) {
    return NextResponse.json({ error: insertError?.message ?? 'DB insert failed' }, { status: 500 })
  }

  return NextResponse.json({
    id: newResume.id,
    uploaded_at: newResume.uploaded_at,
    storage_path: storagePath,
    keywords_extracted: keywords,
  })
}

