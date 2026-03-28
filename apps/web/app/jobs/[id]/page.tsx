'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { type JobPosting } from '@/lib/supabase'
import { formatSalary } from '@job-tracker/scoring'
import { Badge } from '@/components/ui/badge'

import { capitalize } from '@/lib/utils'
import { marked } from 'marked'

const STATUSES = ['new', 'reviewed', 'applied', 'skipped', 'unavailable']

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

  // Case 1: real HTML tags present — strip inline font styles for consistency
  if (/<[a-z][\s\S]*>/i.test(decoded)) {
    const cleaned = decoded
      .replace(/font-family\s*:[^;"']*(;|(?=["']))/gi, '')
      .replace(/font-size\s*:[^;"']*(;|(?=["']))/gi, '')
      .replace(/style="\s*"/gi, '')
    return { html: true, content: cleaned }
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

  // Case 3: markdown (detect ## headings, **bold**, - lists)
  if (/^#{1,6}\s|^\*\*|^- |\*\*.+\*\*/m.test(decoded)) {
    const parsed = marked.parse(decoded, { async: false }) as string
    return { html: true, content: parsed }
  }

  // Case 4: plain text
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
  const [editingDesc, setEditingDesc] = useState(false)
  const [draftDesc, setDraftDesc] = useState('')
  const [savingDesc, setSavingDesc] = useState(false)
  const [descOpen, setDescOpen] = useState(true)
  const [notesOpen, setNotesOpen] = useState(true)
  const [editingNotes, setEditingNotes] = useState(false)
  const [draftNotes, setDraftNotes] = useState('')
  const [editingUrl, setEditingUrl] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)

  useEffect(() => {
    async function load() {
      const [jobRes, resumeRes] = await Promise.all([
        fetch(`/api/jobs/${id}`),
        fetch('/api/resume'),
      ])
      if (jobRes.ok) setJob(await jobRes.json())
      if (resumeRes.ok) {
        const { versions } = await resumeRes.json()
        const atsActive = versions?.find((v: any) => v.is_active && v.resume_type === 'ats')
        if (atsActive?.keywords_extracted) setResumeKeywords(atsActive.keywords_extracted)
      }
      setLoading(false)
    }
    load()
  }, [id])

  async function updateStatus(newStatus: string) {
    if (!job) return
    setJob({ ...job, status: newStatus as any, applied_at: newStatus === 'applied' ? new Date().toISOString() : null })
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
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

  const openUrl = job.url
  const openLabel = 'View posting'

  const prepared = job.page_content ? prepareContent(job.page_content) : null

  // Prev/next navigation from session job list
  const jobIds: string[] = typeof window !== 'undefined' ? JSON.parse(sessionStorage.getItem('jobIds') ?? '[]') : []
  const currentIndex = jobIds.indexOf(id)
  const prevId = currentIndex > 0 ? jobIds[currentIndex - 1] : null
  const nextId = currentIndex >= 0 && currentIndex < jobIds.length - 1 ? jobIds[currentIndex + 1] : null

  return (
    <div className="space-y-5">
      {/* Back + Prev/Next */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.back()} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        {jobIds.length > 0 && currentIndex >= 0 && (
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              disabled={!prevId}
              onClick={() => prevId && router.push(`/jobs/${prevId}`)}
              className={`px-2 py-1 rounded-md transition-colors ${prevId ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'text-muted-foreground/30 cursor-not-allowed'}`}
            >← Prev</button>
            <span className="text-xs text-muted-foreground tabular-nums">{currentIndex + 1}/{jobIds.length}</span>
            <button
              type="button"
              disabled={!nextId}
              onClick={() => nextId && router.push(`/jobs/${nextId}`)}
              className={`px-2 py-1 rounded-md transition-colors ${nextId ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'text-muted-foreground/30 cursor-not-allowed'}`}
            >Next →</button>
          </div>
        )}
      </div>

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

        {/* Status + Open posting + Delete */}
        <div className="flex items-center gap-3 mt-3">
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center"
            onClick={() => { if (job.status !== 'applied') updateStatus('applied') }}
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

          <div className="flex-1" />
          <button
            type="button"
            onClick={async () => {
              if (!confirm('Delete this job posting?')) return
              await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
              // Navigate to next job or go back
              if (nextId) router.push(`/jobs/${nextId}`)
              else router.back()
            }}
            className="text-muted-foreground/50 hover:text-destructive transition-colors"
            aria-label="Delete job"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>

        {job.applied_at && (
          <div className="text-xs text-muted-foreground mt-2">Applied on {new Date(job.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
        )}
      </div>

      {/* ── Content area ──────────────────────────────────────────────── */}
      <div className="space-y-5">

          {/* Job description */}
          <div className="bg-card rounded-lg border overflow-hidden">
            {/* Header — clickable to collapse */}
            <div className={`px-6 py-4 flex items-center justify-between cursor-pointer transition-colors ${descOpen ? 'bg-muted/40' : 'hover:bg-muted/30'}`} onClick={() => !editingDesc && setDescOpen(!descOpen)}>
              <div className="text-sm font-semibold tracking-[-0.02em]">Job description</div>
              <div className="flex items-center gap-2">
                {editingDesc ? (
                  <>
                    <button type="button" disabled={savingDesc} onClick={async (e) => { e.stopPropagation()
                      setSavingDesc(true)
                      const res = await fetch(`/api/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_content: draftDesc }) })
                      const result = await res.json()
                      setJob({ ...job, page_content: draftDesc, ...(result.score !== undefined ? { score: result.score, priority: result.priority, resume_fit: result.resume_fit, keywords_matched: result.keywords_matched } : {}) })
                      setEditingDesc(false)
                      setSavingDesc(false)
                    }} className="text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">{savingDesc ? 'Saving...' : 'Save'}</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setEditingDesc(false); setDraftDesc(job.page_content ?? '') }} className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-muted transition-colors">Discard</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDraftDesc(job.page_content ?? ''); setEditingDesc(true); setDescOpen(true) }} className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-muted transition-colors">Edit</button>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform ${descOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </>
                )}
              </div>
            </div>

            {/* Keywords — collapsible, merged matched/missing */}
            {descOpen && !editingDesc && keywords.length > 0 && (
              <div className="px-6 py-4 border-b space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    {resumeKeywords.length > 0
                      ? <><span className="text-green-600 font-medium">{matched.length}</span> matched · <span className="text-red-500 font-medium">{missing.length}</span> missing</>
                      : <>{keywords.length} keywords</>
                    }
                  </div>
                  {resumeKeywords.length > 0 && (
                    <div className="text-xs text-muted-foreground">Fit <span className="tabular-nums text-green-600 font-medium">{job.resume_fit ?? 0}%</span></div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {matched.map((k) => (
                    <Badge key={k} variant="success" className="text-xs">{k}</Badge>
                  ))}
                  {missing.map((k) => (
                    <Badge key={k} variant="error" className="text-xs">{k}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Content — collapsible */}
            {descOpen && <div className="px-6 py-5">

            {editingDesc ? (
              <div
                ref={(el) => { if (el && !el.innerHTML && draftDesc) el.innerHTML = prepareContent(draftDesc).content || draftDesc }}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setDraftDesc((e.target as HTMLDivElement).innerHTML)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    const el = e.target as HTMLDivElement
                    setDraftDesc(el.innerHTML)
                    // Trigger save
                    ;(async () => {
                      setSavingDesc(true)
                      const res = await fetch(`/api/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_content: el.innerHTML }) })
                      const result = await res.json()
                      setJob({ ...job!, page_content: el.innerHTML, ...(result.score !== undefined ? { score: result.score, priority: result.priority, resume_fit: result.resume_fit, keywords_matched: result.keywords_matched } : {}) })
                      setEditingDesc(false)
                      setSavingDesc(false)
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    })()
                  }
                }}
                className="job-description min-h-[300px] max-h-[600px] overflow-y-auto p-3 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                data-placeholder="Paste or edit job description..."
              />
            ) : prepared ? (
              prepared.html ? (
                <div className="job-description" dangerouslySetInnerHTML={{ __html: highlightKeywords(prepared.content, keywords) }} />
              ) : (
                <div className="text-sm leading-relaxed text-foreground whitespace-pre-line" dangerouslySetInnerHTML={{ __html: highlightKeywords(prepared.content, keywords) }} />
              )
            ) : (
              <button type="button" onClick={() => { setDraftDesc(''); setEditingDesc(true) }} className="text-sm text-muted-foreground hover:text-foreground transition-colors">+ Add job description</button>
            )}
            </div>}
          </div>

          {/* Job posting URL — only show when URL is missing */}
          {(!job.url || editingUrl) && <div className="bg-card rounded-lg p-5 border space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Posting URL</div>
              <div className="flex items-center gap-2">
                {editingUrl ? (
                  <>
                    <button type="button" disabled={savingUrl} onClick={async () => {
                      setSavingUrl(true)
                      await fetch(`/api/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: draftUrl }) })
                      setJob({ ...job, url: draftUrl })
                      setEditingUrl(false)
                      setSavingUrl(false)
                    }} className="text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">{savingUrl ? 'Saving...' : 'Save'}</button>
                    <button type="button" onClick={() => { setEditingUrl(false); setDraftUrl(job.url ?? '') }} className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-muted transition-colors">Discard</button>
                  </>
                ) : (
                  <button type="button" onClick={() => { setDraftUrl(job.url ?? ''); setEditingUrl(true) }} className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-muted transition-colors">Edit</button>
                )}
              </div>
            </div>
            {editingUrl ? (
              <input
                type="url"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="https://..."
                className="w-full text-sm px-3 py-2 rounded-md border border-input bg-background"
              />
            ) : job.url ? (
              <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">{job.url}</a>
            ) : (
              <button type="button" onClick={() => { setDraftUrl(''); setEditingUrl(true) }} className="text-sm text-muted-foreground hover:text-foreground transition-colors">+ Add URL</button>
            )}
          </div>}

          {/* Notes — same card pattern as job description */}
          <div className="bg-card rounded-lg border overflow-hidden">
            <div className={`px-6 py-4 flex items-center justify-between cursor-pointer transition-colors ${notesOpen ? 'bg-muted/40' : 'hover:bg-muted/30'}`} onClick={() => !editingNotes && setNotesOpen(!notesOpen)}>
              <div className="text-sm font-semibold tracking-[-0.02em]">Notes</div>
              <div className="flex items-center gap-2">
                {editingNotes ? (
                  <>
                    {saveState === 'saving' && <span className="text-xs text-muted-foreground">Saving...</span>}
                    <button type="button" onClick={(e) => {
                      e.stopPropagation()
                      handleNotesChange(draftNotes)
                      setEditingNotes(false)
                    }} className="text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Save</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setEditingNotes(false); setDraftNotes(job.notes ?? '') }} className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-muted transition-colors">Discard</button>
                  </>
                ) : (
                  <>
                    {saveState === 'saved' && <span className="text-xs text-green-600">Saved</span>}
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDraftNotes(job.notes ?? ''); setEditingNotes(true); setNotesOpen(true) }} className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-muted transition-colors">Edit</button>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform ${notesOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </>
                )}
              </div>
            </div>
            {notesOpen && <div className="px-6 py-5">
              {editingNotes ? (
                <div
                  ref={(el) => { if (el && !el.innerHTML && draftNotes) el.innerHTML = prepareContent(draftNotes).content || draftNotes }}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(e) => setDraftNotes((e.target as HTMLDivElement).innerHTML)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      const content = (e.target as HTMLDivElement).innerHTML
                      setDraftNotes(content)
                      handleNotesChange(content)
                      setEditingNotes(false)
                    }
                  }}
                  className="job-description min-h-[100px] max-h-[400px] overflow-y-auto p-3 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  data-placeholder="Add notes, recruiter contact, follow-up reminders..."
                />
              ) : job.notes ? (
                <div className="job-description" dangerouslySetInnerHTML={{ __html: prepareContent(job.notes).content }} />
              ) : (
                <button type="button" onClick={() => { setDraftNotes(''); setEditingNotes(true) }} className="text-sm text-muted-foreground hover:text-foreground transition-colors">+ Add notes</button>
              )}
            </div>}
          </div>
      </div>
    </div>
  )
}
