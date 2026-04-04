'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase, type JobPosting } from '@/lib/supabase'
import { StatusChip, FitBadge } from '@/components/score-badge'
import { timeAgo, STATUSES_CLEARING_APPLIED_AT } from '@/lib/utils'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIsDemo } from '@/lib/demo-mode'

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 }

const PAGE_SIZE = 50

function JobCard({ job, deletingId, confirmDeleteId, onStatusChange, onDeleteRequest, onDeleteConfirm, onDeleteCancel, onNavigate, isDemo }: {
  job: JobPosting
  deletingId: string | null
  confirmDeleteId: string | null
  onStatusChange: (s: string) => void
  onDeleteRequest: () => void
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
  onNavigate: () => void
  isDemo: boolean
}) {
  const router = useRouter()
  const [swipeX, setSwipeX] = useState(0)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const swiping = useRef(false)
  const DELETE_THRESHOLD = 80

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    swiping.current = false
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current)
    if (!swiping.current && Math.abs(dx) > 10 && Math.abs(dx) > dy) swiping.current = true
    if (swiping.current && dx < 0) setSwipeX(Math.max(dx, -DELETE_THRESHOLD - 20))
  }
  const onTouchEnd = () => {
    if (isDemo) { setSwipeX(0); return }
    if (swipeX <= -DELETE_THRESHOLD) {
      setSwipeX(-DELETE_THRESHOLD)
      onDeleteRequest()
    } else {
      setSwipeX(0)
    }
    swiping.current = false
  }

  const isConfirming = confirmDeleteId === job.id

  return (
    <div className={`relative overflow-hidden rounded-lg ${deletingId === job.id ? 'opacity-50' : ''}`}>
      {/* Swipe delete background (mobile) */}
      <div className="absolute inset-y-0 right-0 flex items-center sm:hidden">
        {isConfirming ? (
          <div className="flex items-center gap-2 pr-3">
            <button type="button" onClick={onDeleteConfirm} className="text-xs text-white bg-destructive px-3 py-1.5 rounded-md">Delete</button>
            <button type="button" onClick={() => { onDeleteCancel(); setSwipeX(0) }} className="text-xs text-muted-foreground px-2 py-1.5">Cancel</button>
          </div>
        ) : (
          <div className="bg-destructive/10 text-destructive text-xs font-medium px-4 h-full flex items-center" style={{ width: Math.abs(swipeX) }}>
            {Math.abs(swipeX) >= DELETE_THRESHOLD && 'Delete'}
          </div>
        )}
      </div>

      {/* Card content */}
      <div
        className="bg-card border px-4 py-3 rounded-lg relative cursor-pointer"
        style={{ transform: `translateX(${swipeX}px)`, transition: swiping.current ? 'none' : 'transform 0.2s ease-out' }}
        onClick={() => { if (!swiping.current && swipeX === 0) { onNavigate(); router.push(`/jobs/${job.id}`) } }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Row 1: Title + Status/Delete */}
        <div className="flex items-center justify-between gap-2">
          <Link href={`/jobs/${job.id}`} className="hover:underline font-medium text-sm text-foreground sm:truncate" onClick={onNavigate}>
            {job.title ?? 'Untitled'}
          </Link>
          <div className="shrink-0 flex items-center gap-3 relative z-10">
            {/* Desktop: interactive status chip */}
            <div className="hidden sm:block">
              <StatusChip status={job.status} onChange={isDemo ? undefined : onStatusChange} />
            </div>
            {/* Mobile: read-only status chip */}
            <div className="sm:hidden">
              <StatusChip status={job.status} />
            </div>
            {/* Desktop delete */}
            {!isDemo && (
            <div className="hidden sm:flex items-center">
              {deletingId === job.id ? (
                <span className="w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-destructive rounded-full animate-spin" />
              ) : isConfirming ? (
                <span className="flex items-center gap-2">
                  <button type="button" aria-label="Confirm delete" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteConfirm() }} className="text-destructive hover:text-destructive/80 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                  <button type="button" aria-label="Cancel delete" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteCancel() }} className="text-muted-foreground/40 hover:text-foreground transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </span>
              ) : (
                <button type="button" aria-label="Delete" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteRequest() }} className="text-muted-foreground/40 hover:text-destructive transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
              )}
            </div>
            )}
          </div>
        </div>
        {/* Row 2: Fit · Company · Location */}
        <div className="text-xs mt-0.5 sm:truncate">
          <FitBadge fit={job.resume_fit} />
          <span className="text-muted-foreground mx-1">·</span>
          <span className="text-foreground">{job.company ?? '—'}</span>
          {job.location && <><span className="text-muted-foreground mx-1">·</span><span className="text-foreground">{job.location}</span></>}
          {job.firehose_rule && <><span className="text-muted-foreground mx-1 hidden sm:inline">·</span><span className="text-muted-foreground hidden sm:inline">{job.firehose_rule}</span></>}
        </div>
        {/* Row 3: Applied / Rejected dates */}
        {job.status === 'rejected' && job.applied_at ? (
          <div className="text-xs text-muted-foreground mt-0.5">
            Applied {new Date(job.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {job.rejected_at && <> · Rejected {new Date(job.rejected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
          </div>
        ) : job.applied_at ? (
          <div className="text-xs text-muted-foreground mt-0.5">
            Applied {new Date(job.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const isDemo = useIsDemo()

  // ── Stats ──────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ total: 0, high: 0, medium: 0, low: 0, growthHigh: 0, growthMedium: 0, growthLow: 0 })
  const [newCount, setNewCount] = useState(0)
  const [todayApplied, setTodayApplied] = useState(0)
  const [polling, setPolling] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number>(0)

  // Fetch last poll time + today applied count on mount
  useEffect(() => {
    fetch('/api/jobs/import?page=0&limit=1').then(r => r.json()).then(data => {
      if (data.todayCount !== undefined) setTodayApplied(data.todayCount)
    }).catch(() => {})
    fetch('/api/sources').then(r => r.json()).then(data => {
      const ats = data.sources?.find((s: any) => s.id === 'ats')
      if (ats?.health?.lastPollAt) setLastUpdated(ats.health.lastPollAt)
    }).catch(() => {})
  }, [])
  const [pollProgress, setPollProgress] = useState({ current: 0, total: 0 })
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastRefreshRef = useRef(0)
  const [pullDistance, setPullDistance] = useState(0)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)

  // ── Jobs table ─────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<JobPosting[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)   // initial load only
  const [fetching, setFetching] = useState(false) // subsequent fetches (progress bar)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Pending rejections ────────────────────────────────────────────────────
  const [pendingRejections, setPendingRejections] = useState<{ id: string; job_id: string; job_title: string | null; job_company: string | null; rejection_company: string; rejection_role: string | null; rejection_date: string | null; email_snippet: string | null; email_body: string | null }[]>([])
  const [rejectingIds, setRejectingIds] = useState<Set<string>>(new Set())
  const [expandedRejection, setExpandedRejection] = useState<string | null>(null)
  const [confirmAllPending, setConfirmAllPending] = useState<'confirm' | 'dismiss' | null>(null)

  useEffect(() => {
    fetch('/api/jobs/detect-rejections').then(r => r.json()).then(data => {
      if (data.pending) setPendingRejections(data.pending)
    }).catch(() => {})
  }, [])

  async function handleRejection(id: string, action: 'confirm' | 'dismiss') {
    setExpandedRejection(null)
    setRejectingIds(prev => new Set(prev).add(id))
    await fetch('/api/jobs/detect-rejections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: [{ id, action }] }),
    })
    setPendingRejections(prev => prev.filter(r => r.id !== id))
    setRejectingIds(prev => { const next = new Set(prev); next.delete(id); return next })
    if (action === 'confirm') loadStats()
  }

  async function handleAllRejections(action: 'confirm' | 'dismiss') {
    const ids = pendingRejections.map(r => r.id)
    setRejectingIds(new Set(ids))
    await fetch('/api/jobs/detect-rejections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: ids.map(id => ({ id, action })) }),
    })
    setPendingRejections([])
    setRejectingIds(new Set())
    if (action === 'confirm') loadStats()
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  const [priority, setPriority] = useState('high')
  const [since, setSince] = useState('24h')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const preSearchFilters = useRef<{ priority: string; since: string; status: string } | null>(null)

  function toggleSearch() {
    if (!searchOpen) {
      preSearchFilters.current = { priority, since, status }
      setPriority('all')
      setSince('all')
      setStatus('all')
      setSearchOpen(true)
    } else {
      setSearchOpen(false)
      setSearch('')
      if (preSearchFilters.current) {
        setPriority(preSearchFilters.current.priority)
        setSince(preSearchFilters.current.since)
        setStatus(preSearchFilters.current.status)
        preSearchFilters.current = null
      }
    }
  }

  // ── Sort ────────────────────────────────────────────────────────────────────
  const fitOrder = null
  const seenOrder = null

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
  const loadingMore = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchJobs = useCallback(async (pageNum = 0, append = false) => {
    if (append) loadingMore.current = true
    else setFetching(true)
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
      setJobs(prev => {
        if (!append) return data ?? []
        const existing = new Set(prev.map((j: any) => j.id))
        return [...prev, ...(data ?? []).filter((j: any) => !existing.has(j.id))]
      })
      setTotal(t ?? 0)
      if (!append && data?.length) sessionStorage.setItem('jobIds', JSON.stringify(data.map((j: any) => j.id)))
      if (append && data?.length) sessionStorage.setItem('jobIds', JSON.stringify([...JSON.parse(sessionStorage.getItem('jobIds') ?? '[]'), ...data.map((j: any) => j.id)]))
    } catch (err) {
      console.error('fetchJobs failed:', err)
      if (!append) setJobs([])
    } finally {
      setFetching(false)
      setLoading(false)
      loadingMore.current = false
    }
  }, [priority, status, since, search, fitOrder, seenOrder])

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { setPage(0); fetchJobs(0) }, [fetchJobs])

  // Infinite scroll
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMore.current && jobs.length < total) {
        const nextPage = page + 1
        setPage(nextPage)
        fetchJobs(nextPage, true)
      }
    }, { rootMargin: '300px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [jobs.length, total, page, fetchJobs])

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

  // Pull-to-refresh
  useEffect(() => {
    const THRESHOLD = 80
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0 && !polling) {
        touchStartY.current = e.touches[0].clientY
        isPulling.current = true
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!isPulling.current) return
      const delta = e.touches[0].clientY - touchStartY.current
      if (delta > 0) {
        setPullDistance(Math.min(delta, THRESHOLD + 40))
      } else {
        isPulling.current = false
        setPullDistance(0)
      }
    }
    const onTouchEnd = () => {
      if (isPulling.current && pullDistance >= THRESHOLD && !polling) {
        handleUpdate()
      }
      isPulling.current = false
      setPullDistance(0)
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [polling, pullDistance])

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
      // Check if backend is already running — resume watching instead of duplicate POST
      const status = await fetch('/api/poll').then((r) => r.json())
      if (status.running) {
        setPollProgress({ current: status.current, total: status.total })
      } else {
        const res = await fetch('/api/poll', { method: 'POST' })
        if (!res.ok) { setPolling(false); return }
      }
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
          setLastUpdated(Date.now())
          setTimeout(() => { loadStats(); fetchJobs(page) }, 30_000)
        }
      } catch {
        clearInterval(pollIntervalRef.current!)
        pollIntervalRef.current = null
        setPolling(false)
      }
    }, 500)
  }

  async function deleteJob(id: string) {
    setDeletingId(id)
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
    setJobs((prev) => prev.filter((j) => j.id !== id))
    setTotal((t) => t - 1)
    setDeletingId(null)
  }

  async function stopPolling() {
    await fetch('/api/poll', { method: 'DELETE' }).catch(() => {})
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setPolling(false)
    loadStats()
    fetchJobs(page)
  }

  async function updateStatus(id: string, newStatus: string) {
    setJobs((prev) => prev.map((j) => {
      if (j.id !== id) return j
      const wasApplied = j.status === 'applied'
      const applied_at =
        newStatus === 'applied' ? (j.applied_at ?? new Date().toISOString()) :
        STATUSES_CLEARING_APPLIED_AT.includes(newStatus) ? null :
        j.applied_at
      if (newStatus === 'applied' && !wasApplied) setTodayApplied((n) => n + 1)
      if (newStatus !== 'applied' && wasApplied) setTodayApplied((n) => Math.max(0, n - 1))
      return { ...j, status: newStatus as any, applied_at }
    }))
    await fetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
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
    if (growth > 0) return 'text-emerald-700'
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
    {/* Pull-to-refresh indicator */}
    {pullDistance > 0 && (
      <div className="flex items-center justify-center py-2 text-xs text-muted-foreground transition-all" style={{ height: pullDistance * 0.5 }}>
        <span className={`transition-opacity ${pullDistance >= 80 ? 'opacity-100' : 'opacity-50'}`}>
          {pullDistance >= 80 ? '↻ Release to update' : '↓ Pull to update'}
        </span>
      </div>
    )}
    {(fetching || polling) && <div className="nav-progress-bar" />}
    <div className="space-y-4">
      {/* Stat cards — compact row on mobile, 3-column grid on sm+ */}
      <div ref={cardsRef}>
        {/* Mobile: compact inline row */}
        <div className="flex sm:hidden gap-2">
          {[
            { label: 'High', key: 'high' as const, value: stats.high, growth: stats.growthHigh },
            { label: 'Med', key: 'medium' as const, value: stats.medium, growth: stats.growthMedium },
            { label: 'Low', key: 'low' as const, value: stats.low, growth: stats.growthLow },
          ].map((s) => (
            <button key={s.key} type="button" onClick={() => togglePriority(s.key)}
              className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${priority === s.key ? 'border-[1.5px] border-primary bg-card' : 'bg-card'}`}
            >
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
              <div className={`text-2xl font-semibold font-mono tabular-nums ${priority === s.key ? 'text-primary' : 'text-foreground'}`}>
                {s.value}
              </div>
              {growthLabel(s.growth) ? <div className={`text-[10px] tabular-nums ${growthColor(s.growth)}`}>{growthLabel(s.growth)}</div> : <div className="text-[10px]">&nbsp;</div>}
            </button>
          ))}
        </div>
        {/* Desktop: full stat cards */}
        <div className="hidden sm:grid grid-cols-3 gap-4">
          <StatCard label="High Priority" value={stats.high} active={priority === 'high'} change={growthLabel(stats.growthHigh)} changeColor={growthColor(stats.growthHigh)} onClick={() => togglePriority('high')} />
          <StatCard label="Medium Priority" value={stats.medium} active={priority === 'medium'} change={growthLabel(stats.growthMedium)} changeColor={growthColor(stats.growthMedium)} onClick={() => togglePriority('medium')} />
          <StatCard label="Low Priority" value={stats.low} active={priority === 'low'} change={growthLabel(stats.growthLow)} changeColor={growthColor(stats.growthLow)} onClick={() => togglePriority('low')} />
        </div>
      </div>

      {/* Pending rejections banner */}
      {!isDemo && pendingRejections.length > 0 && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="text-sm font-medium text-rose-800">{pendingRejections.length} potential rejection{pendingRejections.length > 1 ? 's' : ''} detected</span>
            <div className="flex items-center gap-2 shrink-0">
              {confirmAllPending ? (
                <>
                  <button type="button" onClick={() => { handleAllRejections(confirmAllPending); setConfirmAllPending(null) }} className="text-xs font-medium text-rose-700 hover:text-rose-900 px-2 py-1 rounded-md hover:bg-rose-100/40 transition-colors">{confirmAllPending === 'confirm' ? `Confirm all ${pendingRejections.length}?` : `Dismiss all ${pendingRejections.length}?`}</button>
                  <button type="button" onClick={() => setConfirmAllPending(null)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 transition-colors">Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setConfirmAllPending('confirm')} className="text-xs font-medium text-rose-700 hover:text-rose-900 px-2 py-1 transition-colors">Confirm all</button>
                  <button type="button" onClick={() => setConfirmAllPending('dismiss')} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 transition-colors">Dismiss all</button>
                </>
              )}
            </div>
          </div>
          <div className="divide-y divide-border">
            {pendingRejections.map((r) => {
              const isExpanded = expandedRejection === r.id
              const emailContent = r.email_body || r.email_snippet
              return (
                <motion.div key={r.id} layout transition={spring} className={`${rejectingIds.has(r.id) ? 'opacity-50' : ''}`}>
                  <div
                    className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                    onClick={() => setExpandedRejection(isExpanded ? null : r.id)}
                    role="button"
                    aria-expanded={isExpanded ? 'true' : 'false'}
                    aria-label={isExpanded ? 'Collapse email content' : 'Expand email content'}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-foreground truncate">{r.job_company ?? r.rejection_company}{r.rejection_role ? ` · ${r.rejection_role}` : r.job_title ? ` · ${r.job_title}` : ''}</div>
                      {r.rejection_date && <div className="text-xs text-muted-foreground">{new Date(r.rejection_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); handleRejection(r.id, 'dismiss') }} disabled={rejectingIds.has(r.id)} className="text-muted-foreground/40 hover:text-foreground transition-colors p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                      <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </div>
                  </div>
                  <AnimatePresence>
                    {isExpanded && emailContent && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={spring}
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="px-4 pb-3">
                          <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line max-h-[200px] overflow-y-auto">{emailContent}</div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters row */}
      <div className={`flex items-center gap-2 ${scrolled ? 'hidden' : ''}`}>
        {/* Desktop: full buttons */}
        <div className="hidden sm:contents">
          {dateTabs.map((tab) => (
            <button key={tab.value} type="button" onClick={() => setSince(tab.value)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${since === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >{tab.label}</button>
          ))}
          <span className="text-muted-foreground/20">|</span>
          <button type="button" onClick={() => setStatus(status === 'new' ? 'all' : 'new')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${status === 'new' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >New</button>
          <button type="button" onClick={() => setStatus(status === 'applied' ? 'all' : 'applied')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${status === 'applied' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >Applied</button>
          <span className="text-muted-foreground/20">|</span>
          <button type="button" aria-label="Search" onClick={toggleSearch}
            className={`text-xs py-1.5 rounded-md transition-colors ${searchOpen || search ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </button>
        </div>

        {/* Mobile: filter icon + search icon */}
        <div className="flex items-center gap-2 sm:hidden">
          <button type="button" aria-label="Filters" onClick={() => setFiltersOpen(!filtersOpen)}
            className={`text-xs py-1.5 rounded-md transition-colors ${filtersOpen || since !== '24h' || status !== 'all' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/></svg>
          </button>
          <button type="button" aria-label="Search" onClick={toggleSearch}
            className={`text-xs py-1.5 rounded-md transition-colors ${searchOpen || search ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </button>
        </div>

        {/* Today count + Update button — far right */}
        <div className="flex items-center gap-2 ml-auto">
          {todayApplied > 0 && (
            <span className="hidden sm:inline text-xs font-medium text-muted-foreground tabular-nums">{todayApplied} applied today</span>
          )}
          {newCount > 0 && (
            <button type="button" onClick={() => { setNewCount(0); loadStats(); fetchJobs(0) }}
              className="text-xs text-primary font-medium hover:underline"
            >{newCount} new ↑</button>
          )}
          {polling ? (
            <button type="button" onClick={stopPolling}
              className="text-xs text-destructive border border-destructive/30 rounded-md px-3 py-1.5 hover:bg-destructive/10 transition-colors"
            ><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 bg-destructive rounded-sm" />{pollProgress.total > 0 ? `Stop (${pollProgress.current}/${pollProgress.total})` : 'Stop'}</span></button>
          ) : (
            <button type="button" onClick={handleUpdate} disabled={isDemo}
              className={`text-xs text-muted-foreground border border-border rounded-md px-3 py-1.5 hover:text-foreground transition-colors inline-flex items-center gap-1.5 ${isDemo ? 'opacity-50 cursor-not-allowed' : ''}`}
            ><svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>{lastUpdated ? timeAgo(new Date(lastUpdated).toISOString()) : 'Update'}</button>
          )}
        </div>
      </div>

      {/* Mobile filter dropdown */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            key="mobile-filters"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden sm:hidden"
          >
            <div className="flex items-center gap-2 pb-2">
              <select
                aria-label="Time range"
                value={since}
                onChange={(e) => { setSince(e.target.value); e.currentTarget.blur() }}
                className="text-xs px-3 pr-7 py-1.5 rounded-md bg-transparent text-muted-foreground appearance-none bg-no-repeat cursor-pointer border border-border select-chevron focus:outline-none"
              >
                {dateTabs.map((tab) => <option key={tab.value} value={tab.value}>{tab.label}</option>)}
              </select>
              <select
                aria-label="Status filter"
                value={status}
                onChange={(e) => { setStatus(e.target.value); e.currentTarget.blur() }}
                className="text-xs px-3 pr-7 py-1.5 rounded-md bg-transparent text-muted-foreground appearance-none bg-no-repeat cursor-pointer border border-border select-chevron focus:outline-none"
              >
                <option value="all">All</option>
                <option value="new">New</option>
                <option value="applied">Applied</option>
              </select>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sticky minimized bar — visible when cards scroll out ─────────── */}
      <div className={scrolled ? 'sticky top-12 z-40 bg-background/95 backdrop-blur-sm border-b' : 'hidden'} style={{ width: '100vw', marginLeft: 'calc(-50vw + 50%)' }}>
          <div className="max-w-[1128px] mx-auto px-6 pt-3 pb-2.5 flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {/* Priority chips */}
            {[
              { label: 'H', key: 'high' as const, value: stats.high, growth: stats.growthHigh },
              { label: 'M', key: 'medium' as const, value: stats.medium, growth: stats.growthMedium },
              { label: 'L', key: 'low' as const, value: stats.low, growth: stats.growthLow },
            ].map((s) => (
              <button key={s.key} type="button" onClick={() => togglePriority(s.key)}
                className={`text-xs px-2 py-1.5 rounded-md transition-colors tabular-nums ${priority === s.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >{s.label}:{s.value}{growthLabel(s.growth) && <span className={`ml-0.5 ${growthColor(s.growth)}`}>{growthLabel(s.growth)}</span>}</button>
            ))}
            <span className="text-muted-foreground/20">|</span>
            {/* Date dropdown */}
            <select
              aria-label="Time range"
              value={since}
              onChange={(e) => { setSince(e.target.value); e.currentTarget.blur() }}
              className="text-xs px-2 pr-6 py-1.5 rounded-md bg-transparent text-muted-foreground appearance-none bg-no-repeat cursor-pointer border border-border select-chevron focus:outline-none"
            >
              {dateTabs.map((tab) => <option key={tab.value} value={tab.value}>{tab.label}</option>)}
            </select>
            {/* Status dropdown */}
            <select
              aria-label="Status filter"
              value={status}
              onChange={(e) => { setStatus(e.target.value); e.currentTarget.blur() }}
              className="text-xs px-2 pr-6 py-1.5 rounded-md bg-transparent text-muted-foreground appearance-none bg-no-repeat cursor-pointer border border-border select-chevron focus:outline-none"
            >
              <option value="all">All</option>
              <option value="new">New</option>
              <option value="applied">Applied</option>
            </select>
            <span className="text-muted-foreground/20">|</span>
            {/* Search */}
            <button type="button" aria-label="Search" onClick={toggleSearch}
              className={`text-xs py-1.5 rounded-md transition-colors ${searchOpen || search ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
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
                  className="text-xs text-destructive border border-destructive/30 rounded-md px-2 py-1.5 hover:bg-destructive/10 transition-colors"
                ><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 bg-destructive rounded-sm" />{pollProgress.total > 0 ? `Stop (${pollProgress.current}/${pollProgress.total})` : 'Stop'}</span></button>
              ) : (
                <button type="button" onClick={handleUpdate}
                  className="text-xs text-muted-foreground border border-border rounded-md px-2 py-1.5 hover:text-foreground transition-colors"
                >↻ {lastUpdated ? timeAgo(new Date(lastUpdated).toISOString()) : 'Update'}</button>
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

      {/* Jobs list */}
      <div className="min-h-[400px]">
        {loading && jobs.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <span className="w-5 h-5 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
          </div>
        ) : !loading && jobs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            {hasActiveFilters || priority !== 'all' || since !== 'all'
              ? 'No jobs match your filters.'
              : 'No jobs yet. The listener will populate this as it finds matches.'}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  deletingId={deletingId}
                  confirmDeleteId={confirmDeleteId}
                  onStatusChange={(s) => updateStatus(job.id, s)}
                  onDeleteRequest={() => setConfirmDeleteId(job.id)}
                  onDeleteConfirm={() => { deleteJob(job.id); setConfirmDeleteId(null) }}
                  onDeleteCancel={() => setConfirmDeleteId(null)}
                  onNavigate={() => { if (job.status === 'new') updateStatus(job.id, 'reviewed') }}
                  isDemo={isDemo}
                />
              ))}
              {/* Infinite scroll sentinel */}
              <div ref={bottomRef} className="h-1" />
              {loadingMore.current && <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2"><span className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />Loading more...</div>}
              {jobs.length > 0 && jobs.length >= total && <div className="text-center text-xs text-muted-foreground py-1">End of list</div>}
            </div>
          </>
        )}
      </div>
    </div>
    </>
  )
}


