'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { type ResumeVersion } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 }
const collapse = { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: spring, style: { overflow: 'hidden' as const } }

const KEYWORD_CATEGORIES: Record<string, string[]> = {
  'B2B / Domain': ['B2B', 'enterprise', 'SaaS', 'CRM', 'dashboard', 'fintech', 'workflow automation', 'developer tools', 'API', 'internal tools', 'ecommerce', 'e-commerce', 'digital ecosystem', 'media', 'editorial', 'content-driven'],
  'AI & Emerging': ['AI-powered', 'LLM', 'generative AI', 'conversational UI', 'human-in-the-loop', 'agentic AI', 'RAG', 'MCP'],
  'Core Design': ['product design', 'product designer', 'interaction design', 'design system', 'design systems', 'design tokens', 'wireframes', 'prototyping', 'information architecture', 'WCAG', 'accessibility', 'UX design', 'UX principles', 'visual design', 'user-centered', 'scalable design', 'craft'],
  'Methods': ['user research', 'A/B testing', 'journey mapping', 'usability testing', 'Agile', 'design thinking', 'iteration', 'iterative', 'test-and-learn', 'design decisions', 'data-driven'],
  'Soft Skills': ['cross-functional', 'collaboration', 'storytelling', 'stakeholder alignment', 'ambiguity', 'strategic', 'business outcomes', 'fast-paced', 'feedback', 'resilience'],
  'Tools': ['Figma', 'Framer', 'Sketch', 'Cursor', 'Jira', 'Miro', 'Claude Code'],
}

function categorize(keywords: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const placed = new Set<string>()
  for (const [cat, catTerms] of Object.entries(KEYWORD_CATEGORIES)) {
    const matches = keywords.filter((k) =>
      catTerms.some((t) => t.toLowerCase() === k.toLowerCase()) && !placed.has(k)
    )
    if (matches.length > 0) {
      result[cat] = matches
      matches.forEach((m) => placed.add(m))
    }
  }
  const other = keywords.filter((k) => !placed.has(k))
  if (other.length > 0) result['Other'] = other
  return result
}


const TYPE_LABELS: Record<string, string> = { ats: 'ATS', hiring_manager: 'Hiring Manager' }

export default function ResumePage() {
  const [versions, setVersions] = useState<ResumeVersion[]>([])
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreProgress, setRescoreProgress] = useState({ current: 0, total: 0, updated: 0 })
  const [rescoreResult, setRescoreResult] = useState<{ updated: number } | null>(null)
  const rescoreInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingActive, setSettingActive] = useState<string | null>(null)
  const atsFileRef = useRef<HTMLInputElement>(null)
  const hmFileRef = useRef<HTMLInputElement>(null)
  const [atsOpen, setAtsOpen] = useState(false)
  const [hmOpen, setHmOpen] = useState(false)
  const [dragOverAts, setDragOverAts] = useState(false)
  const [dragOverHm, setDragOverHm] = useState(false)

  function dropHandlers(type: 'ats' | 'hiring_manager') {
    const setDrag = type === 'ats' ? setDragOverAts : setDragOverHm
    return {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDrag(true) },
      onDragLeave: () => setDrag(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault(); setDrag(false)
        const file = e.dataTransfer.files?.[0]
        if (file) handleFile(file, type)
      },
    }
  }

  async function loadVersions() {
    const res = await fetch('/api/resume')
    if (res.ok) {
      const data = await res.json()
      setVersions(data.versions ?? [])
    }
  }

  useEffect(() => { loadVersions() }, [])

  // Resume rescore polling if one is already running
  useEffect(() => {
    fetch('/api/jobs/rescore').then(r => r.json()).then(status => {
      if (status.running) {
        setRescoring(true)
        setRescoreProgress({ current: status.current, total: status.total, updated: status.updated })
        rescoreInterval.current = setInterval(async () => {
          const res = await fetch('/api/jobs/rescore')
          if (res.ok) {
            const s = await res.json()
            setRescoreProgress({ current: s.current, total: s.total, updated: s.updated })
            if (!s.running && s.current > 0) {
              clearInterval(rescoreInterval.current!)
              rescoreInterval.current = null
              setRescoring(false)
              setRescoreResult({ updated: s.updated })
            }
          }
        }, 2000)
      }
    }).catch(() => {})
    return () => { if (rescoreInterval.current) clearInterval(rescoreInterval.current) }
  }, [])

  const atsActive = versions.find((v) => v.is_active && v.resume_type === 'ats') ?? null
  const hmActive = versions.find((v) => v.is_active && v.resume_type === 'hiring_manager') ?? null
  const atsCategorized = atsActive?.keywords_extracted ? categorize(atsActive.keywords_extracted) : {}

  async function handleFile(file: File, resumeType: 'ats' | 'hiring_manager') {
    if (!file.name.endsWith('.pdf')) {
      setError('Please upload a PDF file.')
      return
    }
    setUploading(resumeType)
    setUploadProgress(0)
    setError(null)
    setRescoreResult(null)

    const form = new FormData()
    form.append('file', file)
    form.append('resume_type', resumeType)

    try {
      const data = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 90))
        }
        xhr.onload = () => {
          setUploadProgress(100)
          try { resolve(JSON.parse(xhr.responseText)) } catch { reject(new Error('Invalid response')) }
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.open('POST', '/api/resume')
        xhr.send(form)
      })

      if (data.error) {
        setError(data.error)
      } else {
        loadVersions()
      }
    } catch (err: any) {
      setError(err.message ?? 'Upload failed')
    }
    setUploading(null)
    setUploadProgress(0)
  }

  async function handleRescore() {
    setRescoring(true)
    setRescoreResult(null)
    setRescoreProgress({ current: 0, total: 0, updated: 0 })

    await fetch('/api/jobs/rescore', { method: 'POST' })

    // Poll progress
    rescoreInterval.current = setInterval(async () => {
      const res = await fetch('/api/jobs/rescore')
      if (res.ok) {
        const status = await res.json()
        setRescoreProgress({ current: status.current, total: status.total, updated: status.updated })
        if (!status.running && status.current > 0) {
          clearInterval(rescoreInterval.current!)
          rescoreInterval.current = null
          setRescoring(false)
          setRescoreResult({ updated: status.updated })
        }
      }
    }, 2000)
  }

  async function handleSetActive(id: string) {
    setSettingActive(id)
    await fetch('/api/resume', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setSettingActive(null)
    setRescoreResult(null)
    loadVersions()
  }

  function handleDownload(storagePath: string | null) {
    if (!storagePath) return
    window.open(`/api/resume/download?path=${encodeURIComponent(storagePath)}`, '_blank')
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Resume</h1>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</div>
      )}

      {/* ── ATS Resume (primary) ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium text-muted-foreground">ATS Resume</h2>

        {atsActive ? (
          <div className={`bg-card rounded-lg overflow-hidden border relative transition-colors ${dragOverAts ? 'border-primary border-dashed border-2' : ''}`} {...dropHandlers('ats')}>
            {dragOverAts && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 rounded-lg">
                <span className="text-sm font-medium text-primary">Drop PDF to upload</span>
              </div>
            )}
            {/* Header — always visible, entire area toggles collapse */}
            <div className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${atsOpen ? 'bg-muted' : 'hover:bg-muted'}`} onClick={() => setAtsOpen(!atsOpen)}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{atsActive.filename ?? 'resume.pdf'}</span>
                  <Badge variant="success" className="text-[10px]">Active</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Uploaded {formatDateTime(atsActive.uploaded_at)} · <span className="tabular-nums">{atsActive.keywords_extracted?.length ?? 0}</span> keywords extracted
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button size="xs" variant="ghost" aria-label="Download" onClick={(e) => { e.stopPropagation(); handleDownload(atsActive.storage_path) }}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </Button>
                <Button size="xs" onClick={(e) => { e.stopPropagation(); handleRescore() }} disabled={rescoring}>
                  {rescoring ? `Re-scoring ${rescoreProgress.current}/${rescoreProgress.total}` : 'Re-score all jobs'}
                </Button>
                <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); atsFileRef.current?.click() }}>
                  Upload new
                </Button>
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform ${atsOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>

            {uploading === 'ats' && (
              <div className="mx-4 mb-1 mt-1 space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{uploadProgress < 90 ? 'Uploading...' : 'Extracting keywords...'}</span>
                  <span className="tabular-nums">{uploadProgress}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            <AnimatePresence>
              {rescoreResult && (
                <motion.div
                  key="rescore-result"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={spring}
                  className="mx-4 mb-3 text-xs text-green-600 bg-green-500/10 rounded-md px-3 py-2"
                >
                  Updated resume fit score for <span className="tabular-nums">{rescoreResult.updated}</span> jobs.
                </motion.div>
              )}
            </AnimatePresence>

            {/* Keywords — collapsible */}
            <AnimatePresence initial={false}>
              {atsOpen && Object.keys(atsCategorized).length > 0 && (
                <motion.div key="ats-kw" {...collapse}>
                  <div className="px-4 pt-4 pb-4 bg-muted/30 space-y-4">
                    {Object.entries(atsCategorized).map(([cat, terms]) => (
                      <div key={cat}>
                        <div className="text-xs font-medium text-muted-foreground mb-2">{cat}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {terms.map((t) => (
                            <Badge key={t} variant="secondary">{t}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div
            onClick={() => atsFileRef.current?.click()}
            className="rounded-xl p-6 text-center cursor-pointer transition-colors border-2 border-dashed border-border hover:border-primary/50 bg-card"
          >
            {uploading === 'ats' ? (
              <div className="w-full max-w-xs mx-auto space-y-2">
                <div className="text-sm text-muted-foreground">{uploadProgress < 90 ? 'Uploading...' : 'Extracting keywords...'}</div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">{uploadProgress}%</div>
              </div>
            ) : (
              <>
                <div className="text-sm font-medium">Upload ATS resume</div>
                <div className="text-xs text-muted-foreground mt-1">PDF only — used for fit scoring</div>
              </>
            )}
          </div>
        )}

        <input ref={atsFileRef} type="file" accept=".pdf" aria-label="Upload ATS resume PDF" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file, 'ats')
          e.target.value = ''
        }} />
      </div>

      {/* ── Hiring Manager Resume (secondary) ────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium text-muted-foreground">Hiring Manager Resume</h2>

        {hmActive ? (
          <div className={`bg-card rounded-lg overflow-hidden border relative transition-colors ${dragOverHm ? 'border-primary border-dashed border-2' : ''}`} {...dropHandlers('hiring_manager')}>
            {dragOverHm && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 rounded-lg">
                <span className="text-sm font-medium text-primary">Drop PDF to upload</span>
              </div>
            )}
            <div className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${hmOpen ? 'bg-muted' : 'hover:bg-muted'}`} onClick={() => setHmOpen(!hmOpen)}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{hmActive.filename ?? 'resume.pdf'}</span>
                  <Badge variant="success" className="text-[10px]">Active</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Uploaded {formatDateTime(hmActive.uploaded_at)}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button size="xs" variant="ghost" aria-label="Download" onClick={(e) => { e.stopPropagation(); handleDownload(hmActive.storage_path) }}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </Button>
                <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); hmFileRef.current?.click() }}>
                  Upload new
                </Button>
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform ${hmOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {hmOpen && (
                <motion.div key="hm-kw" {...collapse}>
                  <div className="px-4 pt-4 pb-4 bg-muted/30 text-xs text-muted-foreground">
                    No keyword analysis — this resume is for sending directly to hiring managers.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div
            onClick={() => hmFileRef.current?.click()}
            className="rounded-xl p-6 text-center cursor-pointer transition-colors border-2 border-dashed border-border hover:border-primary/50 bg-card"
          >
            {uploading === 'hiring_manager' ? (
              <div className="w-full max-w-xs mx-auto space-y-2">
                <div className="text-sm text-muted-foreground">Uploading...</div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">{uploadProgress}%</div>
              </div>
            ) : (
              <>
                <div className="text-sm font-medium">Upload Hiring Manager resume</div>
                <div className="text-xs text-muted-foreground mt-1">PDF only — for sending to hiring managers</div>
              </>
            )}
          </div>
        )}

        <input ref={hmFileRef} type="file" accept=".pdf" aria-label="Upload Hiring Manager resume PDF" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file, 'hiring_manager')
          e.target.value = ''
        }} />
      </div>

      {/* ── Upload History ────────────────────────────────────────────────── */}
      {versions.length > 0 && (
        <div>
          <h2 className="text-xs font-medium text-muted-foreground mb-3">Upload History</h2>
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="bg-card rounded-lg border px-4 py-3 flex items-center justify-between gap-3">
                {/* Left: text */}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate text-foreground">{v.filename ?? 'resume.pdf'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {TYPE_LABELS[v.resume_type] ?? 'ATS'}
                    <span className="mx-1">·</span>
                    <span className="tabular-nums">{v.keywords_extracted?.length ?? 0}</span> keywords
                    <span className="mx-1">·</span>
                    {formatDateTime(v.uploaded_at)}
                  </div>
                </div>
                {/* Right: actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {v.is_active ? (
                    <Badge variant="success" className="text-[10px]">Active</Badge>
                  ) : (
                    <>
                      {v.storage_path && (
                        <Button size="xs" variant="ghost" aria-label="Download" onClick={() => handleDownload(v.storage_path)}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </Button>
                      )}
                      <Button size="xs" variant="outline" disabled={settingActive === v.id} onClick={() => handleSetActive(v.id)}>
                        {settingActive === v.id ? 'Setting...' : 'Set Active'}
                      </Button>
                    </>
                  )}
                </div>

              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
