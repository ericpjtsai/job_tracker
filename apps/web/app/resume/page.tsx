'use client'

import { useEffect, useRef, useState } from 'react'
import { type ResumeVersion } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const KEYWORD_CATEGORIES: Record<string, string[]> = {
  'B2B / Domain': ['B2B', 'enterprise', 'SaaS', 'CRM', 'dashboard', 'fintech', 'workflow automation', 'developer tools', 'API', 'internal tools'],
  'AI & Emerging': ['AI-powered', 'LLM', 'generative AI', 'conversational UI', 'human-in-the-loop', 'agentic AI', 'RAG', 'MCP'],
  'Core Design': ['interaction design', 'design systems', 'design tokens', 'wireframes', 'prototyping', 'information architecture', 'WCAG', 'accessibility'],
  'Methods': ['user research', 'A/B testing', 'journey mapping', 'usability testing', 'Agile', 'design thinking'],
  'Soft Skills': ['cross-functional', 'storytelling', 'stakeholder alignment', 'ambiguity', 'strategic'],
  'Tools': ['Figma', 'Framer', 'Sketch', 'Cursor', 'Jira', 'Miro'],
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

export default function ResumePage() {
  const [versions, setVersions] = useState<ResumeVersion[]>([])
  const [uploading, setUploading] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreResult, setRescoreResult] = useState<{ updated: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingActive, setSettingActive] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  async function loadVersions() {
    const res = await fetch('/api/resume')
    if (res.ok) {
      const data = await res.json()
      setVersions(data.versions ?? [])
    }
  }

  useEffect(() => { loadVersions() }, [])

  const active = versions.find((v) => v.is_active) ?? null
  const categorized = active?.keywords_extracted ? categorize(active.keywords_extracted) : {}

  async function handleFile(file: File) {
    if (!file.name.endsWith('.pdf')) {
      setError('Please upload a PDF file.')
      return
    }
    setUploading(true)
    setError(null)
    setRescoreResult(null)

    const form = new FormData()
    form.append('file', file)

    const res = await fetch('/api/resume', { method: 'POST', body: form })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Upload failed')
      setUploading(false)
      return
    }

    setUploading(false)
    loadVersions()
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
    <div className="max-w-3xl space-y-8">
      <h1 className="text-xl font-semibold tracking-[-0.03em]">Resume</h1>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) handleFile(file)
        }}
        onClick={() => fileRef.current?.click()}
        className={`rounded-xl p-8 text-center cursor-pointer transition-colors border-2 border-dashed ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 bg-card'
        }`}
      >
        <input ref={fileRef} type="file" accept=".pdf" aria-label="Upload resume PDF" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }} />
        {uploading ? (
          <div className="text-sm text-muted-foreground">Uploading and extracting keywords...</div>
        ) : (
          <>
            <div className="text-3xl mb-2">📄</div>
            <div className="text-sm font-medium">{active ? 'Upload new resume' : 'Upload your resume'}</div>
            <div className="text-xs text-muted-foreground mt-1">PDF only — drag & drop or click</div>
          </>
        )}
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</div>
      )}

      {/* Active resume details */}
      {active && (
        <div className="bg-card rounded-lg overflow-hidden border">
          <button
            type="button"
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-muted transition-colors"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{active.filename ?? 'resume.pdf'}</span>
                <Badge variant="success" className="text-[10px]">Active</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Uploaded {formatDate(active.uploaded_at)} ·{' '}
                <span className="tabular-nums">{active.keywords_extracted?.length ?? 0}</span> keywords extracted
              </div>
            </div>
            <span className="text-muted-foreground/50 text-sm mt-1">{detailsOpen ? '\u2212' : '+'}</span>
          </button>

          {detailsOpen && (
            <div className="px-4 pb-4 bg-muted/30 space-y-5">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" aria-label="Download" onClick={() => handleDownload(active.storage_path)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </Button>
                <Button size="sm" onClick={handleRescore} disabled={rescoring}>
                  {rescoring ? 'Re-scoring...' : 'Re-score all jobs'}
                </Button>
              </div>

              {rescoreResult && (
                <div className="text-xs text-green-600 bg-green-500/10 rounded-md px-3 py-2">
                  Updated resume fit score for <span className="tabular-nums">{rescoreResult.updated}</span> jobs.
                </div>
              )}

              {/* Keywords by category */}
              <div className="space-y-4">
                {Object.entries(categorized).map(([cat, terms]) => (
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
            </div>
          )}
        </div>
      )}

      {/* Upload history */}
      {versions.length > 0 && (
        <div>
          <h2 className="text-xs font-medium tracking-[-0.02em] text-muted-foreground mb-3">Upload History</h2>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="text-xs text-muted-foreground">
                  <TableHead>File</TableHead>
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
