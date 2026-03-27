'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, type JobPosting } from '@/lib/supabase'
import { StatusChip, FitBadge } from '@/components/score-badge'
import { DropZone } from '@/components/drop-zone'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface ImportResult {
  title: string
  company: string
  id?: string
  status: 'imported' | 'updated' | 'failed'
  resume_fit?: number
  error?: string
}

export default function ImportPage() {
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null)
  const [history, setHistory] = useState<JobPosting[]>([])

  async function loadHistory() {
    const { data } = await supabase
      .from('job_postings')
      .select('*')
      .eq('source_type', 'manual')
      .order('first_seen', { ascending: false })
    setHistory(data ?? [])
  }

  useEffect(() => { loadHistory() }, [])

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
      <h1 className="text-xl font-semibold tracking-[-0.03em]">Import</h1>

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
          <div className="text-xs font-medium tracking-[-0.02em] text-muted-foreground">
            Results — {importResults.filter(r => r.status === 'imported').length} imported, {importResults.filter(r => r.status === 'updated').length} updated{importResults.some(r => r.status === 'failed') && `, ${importResults.filter(r => r.status === 'failed').length} failed`}
          </div>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 text-xs text-muted-foreground">
                  <TableHead className="pl-3">Fit</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importResults.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-3">
                      {r.resume_fit !== undefined ? <FitBadge fit={r.resume_fit} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {r.id ? (
                        <Link href={`/jobs/${r.id}`} className="hover:underline font-medium text-foreground">
                          {r.title || 'Untitled'}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.title || 'Untitled'}</span>
                      )}
                      {r.company && <span className="text-muted-foreground text-xs block">{r.company}</span>}
                    </TableCell>
                    <TableCell>
                      {r.status === 'imported' && <span className="text-xs text-green-600">Imported</span>}
                      {r.status === 'updated' && <span className="text-xs text-blue-600">Updated</span>}
                      {r.status === 'failed' && <span className="text-xs text-destructive">{r.error ?? 'Failed'}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Import history */}
      {history.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-medium tracking-[-0.02em] text-muted-foreground">Import history ({history.length})</div>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 text-xs text-muted-foreground">
                  <TableHead className="pl-3">Fit</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((job) => (
                  <TableRow key={job.id} className={job.status === 'new' ? '' : 'bg-muted/40'}>
                    <TableCell className="pl-3"><FitBadge fit={job.resume_fit} /></TableCell>
                    <TableCell>
                      <Link href={`/jobs/${job.id}`} className="hover:underline font-medium text-foreground">
                        {job.title ?? 'Untitled'}
                      </Link>
                      <span className="text-muted-foreground text-xs block">{job.company ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {job.applied_at ? formatDate(job.applied_at) : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={job.status} />
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
