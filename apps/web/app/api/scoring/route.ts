import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const VALID_KEYS = new Set([
  'keyword_groups',
  'seniority_exclude',
  'seniority_newgrad',
  'non_design_titles',
  'blocked_companies',
  'blocked_locations',
  'job_board_hosts',
])

// GET: return all scoring config as { [key]: value, _meta: { [key]: updated_at } }
export async function GET() {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('scoring_config')
    .select('key, value, updated_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config: Record<string, any> = {}
  const meta: Record<string, string> = {}
  for (const row of data ?? []) {
    config[row.key] = row.value
    meta[row.key] = row.updated_at
  }

  return NextResponse.json({ ...config, _meta: meta }, {
    headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' },
  })
}

// PATCH: update one config row { key, value }
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient()
  const { key, value } = await req.json()

  if (!key || !VALID_KEYS.has(key)) {
    return NextResponse.json({ error: `Invalid key. Valid keys: ${[...VALID_KEYS].join(', ')}` }, { status: 400 })
  }

  if (value === undefined || value === null) {
    return NextResponse.json({ error: 'Value is required' }, { status: 400 })
  }

  // Schema validation
  const validation = validateConfig(key, value)
  if (validation) {
    return NextResponse.json({ error: validation }, { status: 400 })
  }

  const { error } = await supabase
    .from('scoring_config')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify listener to reload config
  const listenerUrl = process.env.LISTENER_URL ?? 'http://localhost:3002'
  fetch(`${listenerUrl}/config/reload`, { method: 'POST' }).catch(() => {})

  return NextResponse.json({ ok: true, key })
}

function validateConfig(key: string, value: any): string | null {
  switch (key) {
    case 'keyword_groups': {
      if (!Array.isArray(value)) return 'keyword_groups must be an array'
      for (let i = 0; i < value.length; i++) {
        const g = value[i]
        if (typeof g.name !== 'string' || !g.name) return `Group ${i}: name must be a non-empty string`
        if (typeof g.weight !== 'number' || g.weight < 0) return `Group ${i}: weight must be a non-negative number`
        if (!Array.isArray(g.terms)) return `Group ${i}: terms must be an array`
        if (g.terms.some((t: any) => typeof t !== 'string')) return `Group ${i}: all terms must be strings`
      }
      return null
    }

    case 'seniority_exclude':
    case 'seniority_newgrad': {
      if (!Array.isArray(value)) return `${key} must be an array of strings`
      for (const pattern of value) {
        if (typeof pattern !== 'string') return `${key}: all items must be strings`
        try { new RegExp(`\\b${pattern}\\b`, 'i') } catch { return `${key}: invalid regex pattern "${pattern}"` }
      }
      return null
    }

    case 'non_design_titles':
    case 'blocked_companies':
    case 'blocked_locations':
    case 'job_board_hosts': {
      if (!Array.isArray(value)) return `${key} must be an array of strings`
      if (value.some((v: any) => typeof v !== 'string')) return `${key}: all items must be strings`
      return null
    }

    default:
      return `Unknown key: ${key}`
  }
}
