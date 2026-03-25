'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase, type JobPosting } from '@/lib/supabase'
import { StatusChip, FitBadge } from '@/components/score-badge'
import { formatSalary } from '@job-tracker/scoring'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

const PAGE_SIZE = 50

export default function DashboardPage() {
  // ── Stats ──────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ total: 0, high: 0, medium: 0, low: 0, growthHigh: 0, growthMedium: 0, growthLow: 0 })
  const [newCount, setNewCount] = useState(0)
  const [polling, setPolling] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now())
  const [pollProgress, setPollProgress] = useState({ current: 0, total: 0 })
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastRefreshRef = useRef(0)

  // ── Jobs table ─────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)   // initial load only
  const [fetching, setFetching] = useState(false) // subsequent fetches (progress bar)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Filters ────────────────────────────────────────────────────────────────
  const [priority, setPriority] = useState('all')
  const [since, setSince] = useState('24h')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  // ── Sort ────────────────────────────────────────────────────────────────────
  const [fitOrder, setFitOrder] = useState<'asc' | 'desc' | null>(null)
  const [seenOrder, setSeenOrder] = useState<'asc' | 'desc' | null>(null)

  function cycleOrder(current: 'asc' | 'desc' | null): 'asc' | 'desc' | null {
    if (current === null) return 'desc'
    if (current === 'desc') return 'asc'
    return null
  }

  // ── Fetch stats (respects current filters except priority) ─────────────────
  const loadStats = useCallback(async () => {
    const params = new URLSearchParams()
    if (since !== 'all') params.set('since', since)
    if (status !== 'all') params.set('status', status)
    if (search) params.set('search', search)
    const data = await fetch(`/api/stats?${params}`).then((r) => r.json())
    setStats({ total: data.total, high: data.high, medium: data.medium, low: data.low, growthHigh: data.growthHigh ?? 0, growthMedium: data.growthMedium ?? 0, growthLow: data.growthLow ?? 0 })
  }, [since, status, search])

  // ── Fetch jobs ─────────────────────────────────────────────────────────────
  const fetchJobs = useCallback(async (pageNum = 0) => {
    setFetching(true)
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: String(PAGE_SIZE) })
      if (priority !== 'all') params.set('priority', priority)
      if (status !== 'all') params.set('status', status)
      if (since !== 'all') params.set('since', since)
      if (search) params.set('search', search)
      if (fitOrder) params.set('fitOrder', fitOrder)
      if (seenOrder) params.set('seenOrder', seenOrder)
      if (!fitOrder && !seenOrder) params.set('newFirst', 'true')

      const res = await fetch(`/api/jobs?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { data, total: t } = await res.json()
      setJobs(data ?? [])
      setTotal(t ?? 0)
      setLastUpdated(Date.now())
    } catch (err) {
      console.error('fetchJobs failed:', err)
      setJobs([])
    } finally {
      setFetching(false)
      setLoading(false)
    }
  }, [priority, status, since, search, fitOrder, seenOrder])

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { setPage(0); fetchJobs(0) }, [fetchJobs])

  // Auto-refresh on tab visibility
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefreshRef.current > 5 * 60 * 1000) {
        lastRefreshRef.current = Date.now()
        loadStats()
        fetchJobs(page)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [page, fetchJobs])

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('job_postings_dashboard')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_postings' }, (payload) => {
        const newJob = payload.new as JobPosting
        if (newJob.priority === 'skip') return
        setStats((s) => ({
          ...s,
          total: s.total + 1,
          high: newJob.priority === 'high' ? s.high + 1 : s.high,
          medium: newJob.priority === 'medium' ? s.medium + 1 : s.medium,
          low: newJob.priority === 'low' ? s.low + 1 : s.low,
        }))
        setNewCount((n) => n + 1)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Poll cleanup
  useEffect(() => () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current) }, [])

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleUpdate() {
    setPolling(true)
    setPollProgress({ current: 0, total: 0 })
    try {
      const res = await fetch('/api/poll', { method: 'POST' })
      if (!res.ok) { setPolling(false); return }
    } catch { setPolling(false); return }
    pollIntervalRef.current = setInterval(async () => {
      try {
        const { running, current, total } = await fetch('/api/poll').then((r) => r.json())
        setPollProgress({ current, total })
        if (!running && total > 0) {
          clearInterval(pollIntervalRef.current!)
          pollIntervalRef.current = null
          await loadStats()
          await fetchJobs(page)
          setPolling(false)
          setTimeout(() => { loadStats(); fetchJobs(page) }, 30_000)
        }
      } catch {
        clearInterval(pollIntervalRef.current!)
        pollIntervalRef.current = null
        setPolling(false)
      }
    }, 500)
  }

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setPolling(false)
    loadStats()
    fetchJobs(page)
  }

  async function deleteJob(id: string) {
    if (!confirm('Delete this job posting? This cannot be undone.')) return
    setDeletingId(id)
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
    setJobs((prev) => prev.filter((j) => j.id !== id))
    setTotal((t) => t - 1)
    setDeletingId(null)
  }

  async function updateStatus(id: string, newStatus: string) {
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: newStatus as any } : j)))
  }

  function togglePriority(p: string) {
    setPriority((prev) => prev === p ? 'all' : p)
  }

  const hasActiveFilters = (status !== 'all' && status !== 'new') || search !== ''

  // ── Scroll tracking — minimize when cards leave viewport ─────────────────
  const [scrolled, setScrolled] = useState(false)
  const cardsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = cardsRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Period-over-period growth label
  function growthLabel(growth: number): string | undefined {
    if (since === 'all') return undefined  // no comparison for "all time"
    if (growth === 0) return undefined
    return growth > 0 ? `▲${growth}` : `▼${Math.abs(growth)}`
  }

  function growthColor(growth: number): string {
    if (growth > 0) return 'text-green-600'
    if (growth < 0) return 'text-red-500'
    return ''
  }

  const dateTabs = [
    { label: 'Today', value: '24h' },
    { label: 'Last week', value: '7d' },
    { label: 'All time', value: 'all' },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    {(fetching || polling) && <div className="nav-progress-bar" />}
    <div className="space-y-4">
      {/* Stat cards — normal flow, observed for scroll */}
      <div ref={cardsRef} className="grid grid-cols-3 gap-4">
        <StatCard label="High Priority" value={stats.high} active={priority === 'high'} change={growthLabel(stats.growthHigh)} changeColor={growthColor(stats.growthHigh)} onClick={() => togglePriority('high')} />
        <StatCard label="Medium Priority" value={stats.medium} active={priority === 'medium'} change={growthLabel(stats.growthMedium)} changeColor={growthColor(stats.growthMedium)} onClick={() => togglePriority('medium')} />
        <StatCard label="Low Priority" value={stats.low} active={priority === 'low'} change={growthLabel(stats.growthLow)} changeColor={growthColor(stats.growthLow)} onClick={() => togglePriority('low')} />
      </div>

      {/* Date tabs + New + Search + Update — all one row */}
      <div className="flex items-center gap-1">
        {dateTabs.map((tab) => (
          <button key={tab.value} type="button" onClick={() => setSince(tab.value)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${since === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >{tab.label}</button>
        ))}
        <span className="text-muted-foreground/20 mx-1">|</span>
        <button type="button" onClick={() => setStatus(status === 'new' ? 'all' : 'new')}
          className={`text-xs px-3 py-1.5 rounded-md transition-colors ${status === 'new' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >New jobs</button>
        <span className="text-muted-foreground/20 mx-1">|</span>
        <button type="button" aria-label="Search" onClick={() => setSearchOpen(!searchOpen)}
          className={`text-xs px-2 py-1.5 rounded-md transition-colors ${searchOpen || search ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </button>
        {/* Update button + last updated — far right */}
        <div className="flex items-center gap-2 ml-auto">
          {newCount > 0 && (
            <button type="button" onClick={() => { setNewCount(0); loadStats(); fetchJobs(0) }}
              className="text-xs text-primary font-medium hover:underline"
            >{newCount} new ↑</button>
          )}
          {polling ? (
            <button type="button" onClick={stopPolling}
              className="text-xs text-destructive border border-destructive/30 rounded-md px-3 py-1.5 hover:bg-destructive/10 transition-colors"
            >{pollProgress.total > 0 ? `■ Stop (${pollProgress.current}/${pollProgress.total})` : '■ Stop'}</button>
          ) : (
            <button type="button" onClick={handleUpdate}
              className="text-xs text-muted-foreground border border-border rounded-md px-3 py-1.5 hover:text-foreground transition-colors"
            >↻ Updated {timeAgo(new Date(lastUpdated).toISOString())}</button>
          )}
        </div>
      </div>

      {/* ── Sticky minimized bar — visible when cards scroll out ─────────── */}
      <div className={scrolled ? 'sticky top-[45px] z-40 -mx-6 px-6 bg-background/95 backdrop-blur-sm border-b' : 'hidden'}>
          <div className="py-2 flex items-center gap-1">
            {/* Priority chips */}
            {[
              { label: 'H', key: 'high' as const, value: stats.high, growth: stats.growthHigh },
              { label: 'M', key: 'medium' as const, value: stats.medium, growth: stats.growthMedium },
              { label: 'L', key: 'low' as const, value: stats.low, growth: stats.growthLow },
            ].map((s) => (
              <button key={s.key} type="button" onClick={() => togglePriority(s.key)}
                className={`text-xs px-2 py-1 rounded-md transition-colors tabular-nums ${priority === s.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >{s.label}:{s.value}{growthLabel(s.growth) && <span className={`ml-0.5 ${growthColor(s.growth)}`}>{growthLabel(s.growth)}</span>}</button>
            ))}
            <span className="text-muted-foreground/20 mx-1">|</span>
            {/* Date tabs */}
            {dateTabs.map((tab) => (
              <button key={tab.value} type="button" onClick={() => setSince(tab.value)}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${since === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >{tab.label}</button>
            ))}
            <span className="text-muted-foreground/20 mx-1">|</span>
            {/* New jobs */}
            <button type="button" onClick={() => setStatus(status === 'new' ? 'all' : 'new')}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${status === 'new' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >New jobs</button>
            <span className="text-muted-foreground/20 mx-0.5">|</span>
            {/* Search */}
            <button type="button" aria-label="Search" onClick={() => setSearchOpen(!searchOpen)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${searchOpen || search ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
            {/* Update — far right */}
            <div className="flex items-center gap-2 ml-auto">
              {newCount > 0 && (
                <button type="button" onClick={() => { setNewCount(0); loadStats(); fetchJobs(0) }}
                  className="text-xs text-primary font-medium hover:underline"
                >{newCount} new ↑</button>
              )}
              {polling ? (
                <button type="button" onClick={stopPolling}
                  className="text-xs text-destructive border border-destructive/30 rounded-md px-2 py-1 hover:bg-destructive/10 transition-colors"
                >{pollProgress.total > 0 ? `■ Stop (${pollProgress.current}/${pollProgress.total})` : '■ Stop'}</button>
              ) : (
                <button type="button" onClick={handleUpdate}
                  className="text-xs text-muted-foreground border border-border rounded-md px-2 py-1 hover:text-foreground transition-colors"
                >↻ {timeAgo(new Date(lastUpdated).toISOString())}</button>
              )}
            </div>
          </div>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Search title or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
            autoFocus
          />
          {search && (
            <Button variant="ghost" size="xs" onClick={() => setSearch('')}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Jobs table */}
      <div className="border rounded-lg">
        {loading && jobs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>
        ) : !loading && jobs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            {hasActiveFilters || priority !== 'all' || since !== 'all'
              ? 'No jobs match your filters.'
              : 'No jobs yet. The listener will populate this as it finds matches.'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 text-xs text-muted-foreground">
                <TableHead className="whitespace-nowrap">
                  <SortHeader label="Fit" order={fitOrder} tooltip="How closely your resume keywords match this job's requirements." onSort={() => { setFitOrder(cycleOrder(fitOrder)); setPage(0) }} />
                </TableHead>
                <TableHead>Job</TableHead>
                <TableHead className="hidden lg:table-cell">Location</TableHead>
                <TableHead className="hidden xl:table-cell">Salary</TableHead>
                <TableHead className="hidden md:table-cell">
                  <SortHeader label="Seen" order={seenOrder} onSort={() => { setSeenOrder(cycleOrder(seenOrder)); setPage(0) }} />
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id} className={job.status === 'new' ? 'bg-white' : 'bg-muted/30 text-muted-foreground'}>
                  <TableCell><FitBadge fit={job.resume_fit} /></TableCell>
                  <TableCell className="max-w-xs">
                    <Link href={`/jobs/${job.id}`} className={`hover:underline font-medium block truncate ${job.status !== 'new' ? 'text-muted-foreground' : 'text-foreground'}`} onClick={() => { if (job.status === 'new') updateStatus(job.id, 'reviewed') }}>
                      {job.title ?? 'Untitled'}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      {job.company ?? '—'}
                      {job.firehose_rule && <span className="opacity-50">・{job.firehose_rule}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell text-xs">{job.location ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground hidden xl:table-cell text-xs tabular-nums">
                    {formatSalary({ min: job.salary_min, max: job.salary_max }) ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs hidden md:table-cell whitespace-nowrap tabular-nums">
                    {timeAgo(job.first_seen)}
                  </TableCell>
                  <TableCell>
                    <StatusChip status={job.status} onChange={(s) => updateStatus(job.id, s)} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteJob(job.id)} disabled={deletingId === job.id}>
                      {deletingId === job.id
                        ? <span className="text-xs">…</span>
                        : <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                      }
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => { setPage(page - 1); fetchJobs(page - 1) }}>← Prev</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => { setPage(page + 1); fetchJobs(page + 1) }}>Next →</Button>
          </div>
        </div>
      )}
    </div>
    </>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  function show() {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const tipW = 192
    let left = rect.left + rect.width / 2 - tipW / 2
    let top = rect.bottom + 6
    if (left < 8) left = 8
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8
    if (top + 80 > window.innerHeight) top = rect.top - 80 - 6
    setPos({ top, left })
  }

  return (
    <span className="inline-block align-middle ml-0.5" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      <span ref={ref} className="text-muted-foreground/40 cursor-default text-[8px] rounded-full w-2.5 h-2.5 inline-flex items-center justify-center leading-none hover:text-muted-foreground select-none border border-border">i</span>
      {pos && (
        <span className="pointer-events-none fixed z-[9999] bg-black text-white text-xs font-normal normal-case tracking-normal whitespace-normal rounded-md px-2.5 py-2 w-48 shadow-lg leading-snug" style={{ top: pos.top, left: pos.left }}>
          {text}
        </span>
      )}
    </span>
  )
}

function SortHeader({ label, order, onSort, tooltip }: { label: string; order: 'asc' | 'desc' | null; onSort: () => void; tooltip?: string }) {
  return (
    <span onClick={onSort} className="cursor-pointer select-none whitespace-nowrap hover:text-foreground inline-flex items-center gap-0.5">
      {label}
      {tooltip && <InfoTooltip text={tooltip} />}
      <span className={order ? 'text-foreground' : 'text-muted-foreground/30'}>
        {order === 'desc' ? ' ↓' : order === 'asc' ? ' ↑' : ' ↕'}
      </span>
    </span>
  )
}

function StatCard({ label, value, active, change, changeColor, onClick }: {
  label: string; value: number; active: boolean; change?: string; changeColor?: string; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-card rounded-lg px-6 py-5 border cursor-pointer transition-all ${
        active ? 'border-[1.5px] border-primary' : 'hover:shadow-sm'
      }`}
    >
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-semibold font-mono tabular-nums tracking-tight ${active ? 'text-primary' : 'text-foreground'}`}>
            {value.toLocaleString()}
          </span>
          {change && (
            <span className={`text-xs font-medium tabular-nums ${changeColor ?? 'text-green-600'}`}>{change}</span>
          )}
        </div>
      </div>
    </div>
  )
}

