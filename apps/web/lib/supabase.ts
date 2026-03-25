import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side (browser) Supabase client — used for Realtime subscriptions
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Server-side client (for API routes that need service role)
export function createServerClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceKey)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JobPosting {
  id: string
  url: string
  url_hash: string
  company: string | null
  company_tier: 1 | 2 | 3 | null
  title: string | null
  location: string | null
  salary_min: number | null
  salary_max: number | null
  score: number
  resume_fit: number | null
  score_breakdown: {
    b2b_domain: number
    ai_emerging: number
    core_design: number
    methods: number
    soft_skills: number
    tools: number
    company_bonus: number
    seniority_bonus: number
    location_bonus: number
  } | null
  keywords_matched: string[] | null
  firehose_rule: string | null
  priority: 'high' | 'medium' | 'low' | 'skip' | null
  is_job_posting: boolean
  page_content: string | null
  notes: string | null
  first_seen: string
  last_seen: string
  status: 'new' | 'reviewed' | 'applied' | 'skipped'
}

export interface ResumeVersion {
  id: string
  uploaded_at: string
  filename: string | null
  storage_path: string | null
  keywords_extracted: string[] | null
  is_active: boolean
}
