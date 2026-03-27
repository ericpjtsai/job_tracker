'use client'

import { useEffect, useRef, useState } from 'react'
import { type ResumeVersion } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const TYPE_LABELS: Record<string, string> = { ats: 'ATS', hiring_manager: 'Hiring Manager' }

export default function ResumePage() {
  const [versions, setVersions] = useState<ResumeVersion[]>([])
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreResult, setRescoreResult] = useState<{ updated: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingActive, setSettingActive] = useState<string | null>(null)
  const atsFileRef = useRef<HTMLInputElement>(null)
  const hmFileRef = useRef<HTMLInputElement>(null)
  const [atsOpen, setAtsOpen] = useState(false)
  const [hmOpen, setHmOpen] = useState(false)

  async function loadVersions() {
    const res = await fetch('/api/resume')
    if (res.ok) {
      const data = await res.json()
      setVersions(data.versions ?? [])
    }
  }

  useEffect(() => { loadVersions() }, [])

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
    const res = await fetch('/api/jobs/rescore', { method: 'POST' })
    const data = await res.json()
    setRescoreResult({ updated: data.updated ?? 0 })
    setRescoring(false)
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
      <h1 className="text-xl font-semibold tracking-[-0.03em]">Resume</h1>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</div>
      )}

      {/* ── ATS Resume (primary) ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium tracking-[-0.02em] text-muted-foreground">ATS Resume</h2>

        {atsActive ? (
          <div className="bg-card rounded-lg overflow-hidden border">
            {/* Header — always visible, entire area toggles collapse */}
            <div className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${atsOpen ? 'bg-muted' : 'hover:bg-muted'}`} onClick={() => setAtsOpen(!atsOpen)}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{atsActive.filename ?? 'resume.pdf'}</span>
                  <Badge variant="success" className="text-[10px]">Active</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Uploaded {formatDate(atsActive.uploaded_at)} · <span className="tabular-nums">{atsActive.keywords_extracted?.length ?? 0}</span> keywords extracted
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="sm" variant="outline" aria-label="Download" onClick={(e) => { e.stopPropagation(); handleDownload(atsActive.storage_path) }}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </Button>
                <Button size="sm" onClick={(e) => { e.stopPropagation(); handleRescore() }} disabled={rescoring}>
                  {rescoring ? 'Re-scoring...' : 'Re-score all jobs'}
                </Button>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); atsFileRef.current?.click() }}>
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

            {rescoreResult && (
              <div className="mx-4 mb-3 text-xs text-green-600 bg-green-500/10 rounded-md px-3 py-2">
                Updated resume fit score for <span className="tabular-nums">{rescoreResult.updated}</span> jobs.
              </div>
            )}

            {/* Keywords — collapsible */}
            {atsOpen && Object.keys(atsCategorized).length > 0 && (
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
            )}
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
        <h2 className="text-xs font-medium tracking-[-0.02em] text-muted-foreground">Hiring Manager Resume</h2>

        {hmActive ? (
          <div className="bg-card rounded-lg overflow-hidden border">
            <div className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${hmOpen ? 'bg-muted' : 'hover:bg-muted'}`} onClick={() => setHmOpen(!hmOpen)}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{hmActive.filename ?? 'resume.pdf'}</span>
                  <Badge variant="success" className="text-[10px]">Active</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Uploaded {formatDate(hmActive.uploaded_at)}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="sm" variant="outline" aria-label="Download" onClick={(e) => { e.stopPropagation(); handleDownload(hmActive.storage_path) }}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </Button>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); hmFileRef.current?.click() }}>
                  Upload new
                </Button>
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform ${hmOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>

            {hmOpen && (
              <div className="px-4 pt-4 pb-4 bg-muted/30 text-xs text-muted-foreground">
                No keyword analysis — this resume is for sending directly to hiring managers.
              </div>
            )}
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
          <h2 className="text-xs font-medium tracking-[-0.02em] text-muted-foreground mb-3">Upload History</h2>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="text-xs text-muted-foreground">
                  <TableHead>File</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Keywords</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id} className={v.is_active ? 'bg-primary/5' : ''}>
                    <TableCell className="font-medium text-sm">{v.filename ?? 'resume.pdf'}</TableCell>
                    <TableCell className="text-xs">{TYPE_LABELS[v.resume_type] ?? 'ATS'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(v.uploaded_at)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{v.keywords_extracted?.length ?? 0}</TableCell>
                    <TableCell>
                      {v.is_active ? (
                        <Badge variant="success" className="text-[10px]">Active</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Inactive</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {v.storage_path && (
                          <Button size="xs" variant="ghost" aria-label="Download" onClick={() => handleDownload(v.storage_path)}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          </Button>
                        )}
                        {!v.is_active && (
                          <Button size="xs" variant="outline" disabled={settingActive === v.id} onClick={() => handleSetActive(v.id)}>
                            {settingActive === v.id ? 'Setting...' : 'Set Active'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
