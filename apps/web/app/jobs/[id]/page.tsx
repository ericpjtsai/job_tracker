'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, type JobPosting } from '@/lib/supabase'
import { formatSalary } from '@job-tracker/scoring'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'

import { capitalize } from '@/lib/utils'

const STATUSES = ['new', 'reviewed', 'applied', 'skipped']

/**
 * Prepare page_content for display.
 * 1. If content has real HTML tags (<p>, <div>), return as-is.
 * 2. If content has stripped tags (tag names without angle brackets), reconstruct HTML.
 * 3. Otherwise return as plain text.
 */
function prepareContent(raw: string): { html: boolean; content: string } {
  // Decode HTML entities first (content may be entity-encoded from ATS APIs)
  let decoded = raw
  if (/&lt;[a-z/]/i.test(raw)) {
    decoded = raw
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  }

  // Case 1: real HTML tags present
  if (/<[a-z][\s\S]*>/i.test(decoded)) {
    return { html: true, content: decoded }
  }

  // Case 2: stripped tag names (e.g., "strong About Us /strong p At Cloudflare...")
  // Detect by checking for common closing tag patterns like " /p " or " /strong "
  const hasStrippedTags = /\s\/(?:p|div|strong|h[1-6]|ul|ol|li|span|a|em|b|i|section|article)\b/i.test(decoded)

  if (hasStrippedTags) {
    let html = decoded
      // 1. Entities first
      .replace(/\bnbsp;/g, '&nbsp;')
      .replace(/\bamp;/g, '&amp;')
      .replace(/\bmdash;/g, '&mdash;')
      // 2. Remove stray CSS numbers like "400;"
      .replace(/\b\d{3};\s*/g, '')
      // 3. Restore a href= URL text /a → <a href="URL">text</a>
      .replace(/\ba\s+href=\s*(\S+)\s*/gi, '<a href="$1">')
      // 4. Restore opening tags with attributes: div class= value → <div class="value">
      .replace(/\b(div|span|section|article|header|footer)\s+(class|style|id)=\s*(\S+)\s*/gi, '<$1 $2="$3">')
      // 5. Restore block opening tags: p, h1-h6, ul, ol, li, div etc.
      .replace(/\b(p|h[1-6]|ul|ol|li|div|section|article|header|footer|table|tr|td|th|thead|tbody)\b(?=[^<]*(?:<|$))/gim,
        (match, tag, offset, str) => {
          // Only convert if not already inside a tag (check if preceded by <)
          const before = str.slice(Math.max(0, offset - 1), offset)
          if (before === '<' || before === '/') return match
          return `<${tag}>`
        })
      // 6. Restore inline opening tags: strong, em, b, i
      .replace(/\b(strong|em)\b(?=[^<]*(?:<|$))/gim,
        (match, tag, offset, str) => {
          const before = str.slice(Math.max(0, offset - 1), offset)
          if (before === '<' || before === '/') return match
          return `<${tag}>`
        })
      // 7. Restore closing tags: /tag → </tag>
      .replace(/\s*\/(p|div|strong|em|b|i|h[1-6]|ul|ol|li|span|a|section|article|header|footer|table|tr|td|th|thead|tbody)\b/gi, '</$1>')
      // 8. Restore br
      .replace(/\bbr\b/gi, '<br>')
      // 9. Clean up double spaces
      .replace(/  +/g, ' ')

    return { html: true, content: html }
  }

  // Case 3: plain text
  return { html: false, content: decoded }
}

function highlightKeywords(text: string, keywords: string[]): string {
  if (!keywords.length || !text) return text
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text.replace(re, '<mark>$1</mark>')
}

export default function JobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [job, setJob] = useState<JobPosting | null>(null)
  const [resumeKeywords, setResumeKeywords] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function load() {
      const [jobRes, resumeRes] = await Promise.all([
        fetch(`/api/jobs/${id}`),
        supabase.from('resume_versions').select('keywords_extracted').eq('is_active', true).single(),
      ])
      if (jobRes.ok) setJob(await jobRes.json())
      if (resumeRes.data?.keywords_extracted) setResumeKeywords(resumeRes.data.keywords_extracted)
      setLoading(false)
    }
    load()
  }, [id])

  async function updateStatus(newStatus: string) {
    if (!job) return
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setJob({ ...job, status: newStatus as any })
  }

  function handleNotesChange(value: string) {
    if (!job) return
    setJob({ ...job, notes: value })
    setSaveState('saving')
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(async () => {
      await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      })
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    }, 800)
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>
  if (!job) return <div className="text-sm text-muted-foreground py-12 text-center">Job not found.</div>

  const salary = formatSalary({ min: job.salary_min, max: job.salary_max })
  const keywords = job.keywords_matched ?? []

  // Keyword analysis: matched vs missing
  const resumeSet = new Set(resumeKeywords.map(k => k.toLowerCase()))
  const matched = keywords.filter(k => resumeSet.has(k.toLowerCase()))
  const missing = keywords.filter(k => !resumeSet.has(k.toLowerCase()))

  const openUrl = job.url?.includes('glassdoor.com')
    ? `https://www.google.com/search?q=${encodeURIComponent(`"${job.title}" "${job.company}" site:glassdoor.com`)}`
    : job.url
  const openLabel = job.url?.includes('glassdoor.com') ? 'Search on Google' : 'View posting'

  const prepared = job.page_content ? prepareContent(job.page_content) : null

  return (
    <div className="max-w-4xl space-y-5">
      {/* Back */}
      <button onClick={() => router.back()} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Back
      </button>

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="bg-card rounded-lg p-6 border">
        {/* Title + Fit */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold leading-tight">{job.title ?? 'Untitled'}</h1>
            <div className="text-sm font-medium mt-0.5">{job.company ?? '—'}</div>
          </div>
          {job.resume_fit !== null && (
            <span className="text-lg font-semibold tabular-nums text-green-600 shrink-0">{job.resume_fit}%</span>
          )}
        </div>

        {/* Location | Salary */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap mt-2">
          {job.location && <span>{job.location}</span>}
          {salary && (
            <>
              {job.location && <span className="text-muted-foreground/30">|</span>}
              <span className="text-green-600 tabular-nums">{salary}</span>
            </>
          )}
        </div>

        {/* Status + Open posting */}
        <div className="flex items-center gap-3 mt-3">
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center"
          >{openLabel} ↗</a>

          <select
            aria-label="Job status"
            value={job.status}
            onChange={(e) => updateStatus(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-md border border-input bg-background text-foreground appearance-none bg-no-repeat cursor-pointer hover:bg-muted transition-colors"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundSize: '12px', backgroundPosition: 'right 8px center', paddingRight: '28px' }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{capitalize(s)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Content area — 2 columns on large screens ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Main column (2/3) */}
        <div className="lg:col-span-2 space-y-5">

          {/* Job description */}
          {prepared && (
            <div className="bg-card rounded-lg p-6 border">
              {prepared.html ? (
                <div
                  className="job-description"
                  dangerouslySetInnerHTML={{
                    __html: highlightKeywords(prepared.content, keywords),
                  }}
                />
              ) : (
                <div
                  className="text-sm leading-relaxed text-foreground whitespace-pre-line"
                  dangerouslySetInnerHTML={{
                    __html: highlightKeywords(prepared.content, keywords),
                  }}
                />
              )}
            </div>
          )}

          {/* Notes */}
          <div className="bg-card rounded-lg p-5 border space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Notes</div>
              {saveState === 'saving' && <span className="text-xs text-muted-foreground">Saving...</span>}
              {saveState === 'saved' && <span className="text-xs text-green-600">Saved</span>}
            </div>
            <Textarea
              value={job.notes ?? ''}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Add notes, recruiter contact, follow-up reminders..."
              className="min-h-24 resize-none"
            />
          </div>
        </div>

        {/* Sidebar (1/3) — Keyword Analysis */}
        <div className="space-y-5">
          {keywords.length > 0 && (
            <div className="bg-card rounded-lg p-5 border space-y-4">
              <div className="text-xs font-medium text-muted-foreground">
                Fit <span className="tabular-nums text-green-600">{job.resume_fit ?? 0}%</span>
                <span> · {keywords.length} keywords</span>
              </div>

              {/* Matched keywords */}
              {matched.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Matched ({matched.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {matched.map((k) => (
                      <Badge key={k} variant="success" className="text-xs">{k}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing keywords */}
              {missing.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Missing ({missing.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.map((k) => (
                      <Badge key={k} variant="muted" className="text-xs opacity-60">{k}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* No resume uploaded */}
              {resumeKeywords.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  Upload a resume to see keyword matching.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
