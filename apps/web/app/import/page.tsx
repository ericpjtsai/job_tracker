'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { type JobPosting } from '@/lib/supabase'
import { StatusChip, FitBadge } from '@/components/score-badge'
import { DropZone } from '@/components/drop-zone'
import { formatDate } from '@/lib/utils'

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
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null)
  const [history, setHistory] = useState<JobPosting[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
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
      setHistoryPage(page)
    }
    setLoadingMore(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // Infinite scroll — observe sentinel element
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMore && history.length < historyTotal) {
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
      <h1 className="text-xl font-semibold">Import</h1>

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
                  <FitBadge fit={r.resume_fit ?? null} />
                  {r.company && <><span className="text-muted-foreground mx-1">·</span><span className="text-foreground">{r.company}</span></>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import history */}
      {history.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground">Import history ({historyTotal})</div>
          <div className="space-y-2">
            {history.map((job) => (
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
                  {job.applied_at && <span className="text-xs text-muted-foreground shrink-0">{formatDate(job.applied_at)}</span>}
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
