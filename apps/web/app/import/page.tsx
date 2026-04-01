'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { type JobPosting } from '@/lib/supabase'
import { StatusChip, FitBadge } from '@/components/score-badge'
import { DropZone } from '@/components/drop-zone'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ImportResult {
  title: string
  company: string
  id?: string
  action: 'imported' | 'updated' | 'failed'
  jobStatus: string
  resume_fit?: number
  error?: string
}

export default function ImportPage() {
  // ── Import mode toggle ─────────────────────────────────────────────────────
  const [mode, setMode] = useState<'manual' | 'file'>('manual')
  const [todayCount, setTodayCount] = useState(0)

  // ── Manual form ────────────────────────────────────────────────────────────
  const [manualForm, setManualForm] = useState({ title: '', company: '', url: '', description: '', notes: '' })
  const [manualSubmitting, setManualSubmitting] = useState(false)
  const [manualResult, setManualResult] = useState<ImportResult | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const descRef = useRef<HTMLDivElement>(null)
  const notesRef = useRef<HTMLDivElement>(null)

  async function handleManualSubmit() {
    if (!manualForm.title.trim() || !manualForm.company.trim() || !manualForm.url.trim() || !manualForm.description.trim()) return
    setManualSubmitting(true)
    setManualResult(null)
    const res = await fetch('/api/jobs/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: [`# ${manualForm.title}\n\nCompany: ${manualForm.company}\nURL: ${manualForm.url || ''}\nDate: ${new Date().toISOString()}\nStatus: Applied\n${manualForm.notes ? `Note: ${manualForm.notes}\n` : ''}\n## Description\n\n${manualForm.description}`],
      }),
    })
    const data = await res.json()
    const result = data.results?.[0]
    if (result) {
      setManualResult(result)
      setTimeout(() => setManualResult(null), 2000)
    }
    setManualSubmitting(false)
    setManualForm({ title: '', company: '', url: '', description: '', notes: '' })
    if (descRef.current) descRef.current.innerHTML = ''
    if (notesRef.current) notesRef.current.innerHTML = ''
    setNotesOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    loadHistory()
  }

  // ── File import ────────────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null)
  const [history, setHistory] = useState<JobPosting[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historySearchOpen, setHistorySearchOpen] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const PAGE_SIZE = 30

  const loadHistory = useCallback(async (page = 0, append = false) => {
    if (page > 0) setLoadingMore(true)
    const res = await fetch(`/api/jobs/import?page=${page}&limit=${PAGE_SIZE}`)
    if (res.ok) {
      const data = await res.json()
      setHistory(prev => {
        if (!append) return data.jobs ?? []
        const existing = new Set(prev.map((j: any) => j.id))
        return [...prev, ...(data.jobs ?? []).filter((j: any) => !existing.has(j.id))]
      })
      setHistoryTotal(data.total ?? 0)
      setTodayCount(data.todayCount ?? 0)
      setHistoryPage(page)
    }
    setLoadingMore(false)
    setHistoryLoading(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // Poll for LLM scoring results on recently imported jobs
  const [enriching, setEnriching] = useState(false)
  useEffect(() => {
    if (!importResults) return
    const ids = importResults.filter(r => r.id).map(r => r.id!)
    if (ids.length === 0) return
    setEnriching(true)
    let attempts = 0
    const poll = setInterval(async () => {
      attempts++
      if (attempts > 20) { setEnriching(false); clearInterval(poll); return }
      let allDone = true
      for (const id of ids) {
        const res = await fetch(`/api/jobs/${id}`)
        if (!res.ok) continue
        const job = await res.json()
        if (job.resume_fit !== null) {
          setImportResults(prev => prev?.map(r => r.id === id ? { ...r, resume_fit: job.resume_fit } : r) ?? null)
        } else {
          allDone = false
        }
      }
      if (allDone) { setEnriching(false); clearInterval(poll); loadHistory() }
    }, 3000)
    return () => clearInterval(poll)
  }, [importResults?.length])

  // Infinite scroll — observe sentinel element
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMore && !historySearch && history.length < historyTotal) {
        loadHistory(historyPage + 1, true)
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [history.length, historyTotal, historyPage, loadingMore, loadHistory])

  async function handleFiles(files: FileList | File[]) {
    const mdFiles = Array.from(files).filter(f => f.name.endsWith('.md'))
    if (mdFiles.length === 0) return

    setImporting(true)
    setImportResults(null)
    setProgress({ current: 0, total: mdFiles.length })

    const entries: string[] = []
    for (let i = 0; i < mdFiles.length; i++) {
      const text = await mdFiles[i].text()
      entries.push(text)
      setProgress({ current: i + 1, total: mdFiles.length })
    }

    // Upload phase
    setProgress({ current: mdFiles.length, total: mdFiles.length })
    const res = await fetch('/api/jobs/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
    const data = await res.json()
    setImportResults(data.results ?? [])
    setImporting(false)
    setProgress({ current: 0, total: 0 })
    loadHistory()
  }

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Import</h1>
        <div className="relative inline-flex items-center bg-muted rounded-full p-[3px] text-xs">
          <button type="button" onClick={() => setMode('manual')}
            className={`relative z-10 px-3 py-1 rounded-full transition-colors duration-200 ${mode === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >Manual</button>
          <button type="button" onClick={() => setMode('file')}
            className={`relative z-10 px-3 py-1 rounded-full transition-colors duration-200 ${mode === 'file' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >File</button>
        </div>
      </div>

      {mode === 'manual' ? (
        <div className="bg-card rounded-lg border px-4 py-4 space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Input placeholder="Job title *" value={manualForm.title} onChange={(e) => setManualForm(f => ({ ...f, title: e.target.value }))} />
            <Input placeholder="Company *" value={manualForm.company} onChange={(e) => setManualForm(f => ({ ...f, company: e.target.value }))} />
            <Input placeholder="URL *" value={manualForm.url} onChange={(e) => setManualForm(f => ({ ...f, url: e.target.value }))} />
          </div>
          <div
            ref={descRef}
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => setManualForm(f => ({ ...f, description: (e.target as HTMLDivElement).innerHTML }))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleManualSubmit() } }}
            className="job-description w-full text-sm px-3 py-2 rounded-md border border-input bg-transparent min-h-[100px] focus-visible:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground"
            data-placeholder="Job description *"
          />
          {notesOpen ? (
            <div
              ref={notesRef}
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => setManualForm(f => ({ ...f, notes: (e.target as HTMLDivElement).innerHTML }))}
              className="w-full text-sm px-3 py-2 rounded-md border border-input bg-transparent min-h-[60px] focus-visible:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground"
              data-placeholder="Notes"
            />
          ) : (
            <button type="button" onClick={() => setNotesOpen(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              + Notes
            </button>
          )}
          <div className="flex justify-end">
            <Button size="sm" disabled={manualSubmitting || !manualForm.title.trim() || !manualForm.company.trim() || !manualForm.url.trim() || !manualForm.description.trim()} onClick={handleManualSubmit}>
              {manualSubmitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
          {manualResult && (
            <div className={`text-xs rounded-md px-3 py-2 ${manualResult.action === 'failed' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {manualResult.action === 'failed' ? `Failed: ${manualResult.error}` : `${manualResult.title} — ${manualResult.action}`}
            </div>
          )}
        </div>
      ) : (
        <DropZone
          accept=".md"
          multiple
          label="Drag & drop .md files here"
          sublabel="or click to browse — Notion-exported markdown"
          dragLabel="Drop .md files to import"
          uploading={importing}
          progress={progressPct}
          progressLabel={progressPct < 100 ? `Reading files... ${progress.current}/${progress.total}` : 'Importing to database...'}
          onFiles={(files) => handleFiles(files)}
        />
      )}

      {/* Import results */}
      {importResults && importResults.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground">
            Results — {importResults.filter(r => r.action === 'imported').length} imported, {importResults.filter(r => r.action === 'updated').length} updated{importResults.some(r => r.action === 'failed') && `, ${importResults.filter(r => r.action === 'failed').length} failed`}
          </div>
          <div className="space-y-2">
            {importResults.map((r, i) => (
              <div key={i} className="bg-card rounded-lg border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  {r.id ? (
                    <Link href={`/jobs/${r.id}`} className="hover:underline font-medium text-sm truncate text-foreground">
                      {r.title || 'Untitled'}
                    </Link>
                  ) : (
                    <span className="font-medium text-sm truncate">{r.title || 'Untitled'}</span>
                  )}
                  <div className="shrink-0">
                    {r.id ? (
                      <StatusChip status={r.jobStatus} onChange={async (s) => {
                        await fetch(`/api/jobs/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s }) })
                        setImportResults(prev => prev?.map((item, j) => j === i ? { ...item, jobStatus: s } : item) ?? null)
                      }} />
                    ) : (
                      <span className="text-xs text-destructive">{r.error ?? 'Failed'}</span>
                    )}
                  </div>
                </div>
                <div className="text-xs mt-0.5">
                  {enriching && r.resume_fit === undefined ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><span className="w-2.5 h-2.5 border-[1.5px] border-muted-foreground/30 border-t-primary rounded-full animate-spin" />Scoring</span>
                  ) : (
                    <FitBadge fit={r.resume_fit ?? null} />
                  )}
                  {r.company && <><span className="text-muted-foreground mx-1">·</span><span className="text-foreground">{r.company}</span></>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import history */}
      {historyLoading && (
        <div className="flex items-center justify-center py-12">
          <span className="w-5 h-5 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
        </div>
      )}
      {!historyLoading && history.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs font-medium text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Import history (<span className="tabular-nums">{historyTotal}</span>)</span>
              <button type="button" aria-label="Search" onClick={() => { setHistorySearchOpen(!historySearchOpen); if (historySearchOpen) setHistorySearch('') }}
                className={`transition-colors ${historySearchOpen || historySearch ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </button>
            </div>
            <span className="font-medium text-muted-foreground"><span className="tabular-nums">{todayCount}</span> roles applied today</span>
          </div>
          {historySearchOpen && (
            <Input
              type="text"
              placeholder="Search title or company..."
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              autoFocus
            />
          )}
          <div className="space-y-2">
            {history.filter(j => {
              if (!historySearch) return true
              const q = historySearch.toLowerCase()
              return (j.title?.toLowerCase().includes(q) || j.company?.toLowerCase().includes(q))
            }).map((job) => (
              <div key={job.id} className="bg-card rounded-lg border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/jobs/${job.id}`} className="hover:underline font-medium text-sm truncate text-foreground">
                    {job.title ?? 'Untitled'}
                  </Link>
                  <div className="shrink-0">
                    <StatusChip status={job.status} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs">
                    <FitBadge fit={job.resume_fit} />
                    <span className="text-muted-foreground mx-1">·</span>
                    <span className="text-foreground">{job.company ?? '—'}</span>
                  </span>
                  {job.applied_at && <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(job.applied_at)}</span>}
                </div>
              </div>
            ))}
          </div>
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />
          {loadingMore && <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2"><span className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />Loading more...</div>}
          {history.length >= historyTotal && historyTotal > 0 && <div className="text-center text-xs text-muted-foreground py-1">End of list</div>}
        </div>
      )}
    </div>
  )
}
