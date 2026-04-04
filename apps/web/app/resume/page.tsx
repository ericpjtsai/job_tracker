'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { type ResumeVersion } from '@/lib/supabase'
import { formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useIsDemo } from '@/lib/demo-mode'

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 }
const collapse = { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: spring, style: { overflow: 'hidden' as const } }

const KEYWORD_CATEGORIES: Record<string, string[]> = {
  'B2B / Domain': [
    'B2B', 'B2C', 'B2B2C', 'enterprise', 'SaaS', 'marketplace', 'ecommerce', 'e-commerce', 'fintech', 'healthtech', 'edtech',
    'media', 'editorial', 'content-driven', 'digital ecosystem',
    'developer tools', 'internal tools', 'admin tools', 'CRM', 'CMS', 'dashboard', 'data visualization', 'reporting', 'analytics',
    'workflow automation', 'collaboration tools', 'productivity tools', 'platform ecosystem', 'platform', 'multi-product platform', 'multi-product', 'complex systems',
    'API', 'HR technology', 'talent platform', 'agreement management', 'contract management', 'customer platform', 'go-to-market', 'GTM', 'contact center',
    'financial services', 'fraud', 'risk', 'logistics', 'B2B SaaS', 'B2B logistics SaaS', 'B2B credit card platform', 'scalable solutions',
    'mobile app', 'web application', 'native app', 'progressive web app', 'iOS', 'Android', 'omnichannel',
    'onboarding', 'user onboarding', 'engagement', 'retention', 'growth', 'conversion', 'revenue', 'business impact',
  ],
  'AI & Emerging': [
    'AI-powered', 'AI-first', 'agentic AI', 'agentic', 'AI agents', 'conversational UI', 'conversational design', 'chatbot', 'AI chatbot',
    'voice', 'voice UI', 'LLM', 'generative AI', 'gen AI', 'AI-assisted design', 'AI-assisted', 'machine learning',
    'probabilistic systems', 'AI concierge', 'digital twin', 'RAG', 'retrieval-augmented generation',
    'human-in-the-loop', 'AI design patterns', 'MCP', 'prompt engineering', 'natural language', 'personalization', 'recommendation',
    'multi-agent orchestration', 'copilot', 'AI-powered product design',
  ],
  'Core Design': [
    'product designer', 'product design', 'UX designer', 'UX design', 'UI design', 'UI designer', 'interaction design', 'visual design',
    'service design', 'content design', 'UX writing', 'UX copy', 'motion design', 'motion graphics', 'brand design',
    'user experience', 'user interface', 'UX principles', 'UX', 'end-to-end design', 'user-centered', 'human-centered',
    'user flows', 'wireframes', 'wireframing', 'prototyping', 'prototype', 'high-fidelity', 'high-fidelity prototyping', 'low-fidelity', 'mockups',
    'pixel-perfect delivery', '0-to-1 product design', 'production-ready prototypes',
    'information architecture', 'IA', 'responsive design', 'responsive', 'cross-platform', 'multi-platform', 'pixel-perfect', 'attention to detail', 'detail-oriented',
    'design system', 'design systems', 'enterprise design system', 'component library', 'pattern library',
    'design language', 'style guide', 'design tokens', 'atomic design', 'component-based', 'scalable design', 'design patterns',
    'accessibility', 'accessible design', 'WCAG', 'a11y', 'ADA compliance', 'inclusive design', 'universal design',
    'typography', 'color theory', 'iconography', 'illustration', 'microinteractions', 'empty state', 'edge cases', 'error state',
    'mobile design', 'dark mode', 'localization', 'internationalization', 'progressive disclosure',
    'craft', 'polish', 'intuitive', 'seamless', 'delightful',
  ],
  'Methods': [
    'user research', 'usability testing', 'user testing', 'user interviews', 'stakeholder interviews',
    'A/B testing', 'multivariate testing', 'experimentation', 'heuristic evaluation', 'competitive analysis', 'competitive audit',
    'card sorting', 'tree testing', 'task analysis', 'journey mapping', 'customer journey', 'experience mapping',
    'persona', 'personas', 'empathy mapping', 'contextual inquiry', 'survey', 'diary studies',
    'moderated testing', 'unmoderated testing', 'remote testing', 'quantitative research', 'qualitative research',
    'heatmap', 'click tracking', 'behavioral analytics',
    'design thinking', 'user-centered design', 'human-centered design', 'lean UX', 'design sprint', 'double diamond',
    'jobs to be done', 'JTBD', 'hypothesis-driven', 'rapid prototyping', 'rapid iteration',
    'iterative', 'iteration', 'continuous iteration', 'test-and-learn', 'continuous discovery', 'product discovery',
    'storyboards', 'storyboarding', 'co-design', 'participatory design',
    'Agile', 'Scrum', 'Kanban', 'sprint', 'sprint planning', 'OKRs', 'KPIs', 'north star metric', 'MVP', 'minimum viable product',
    'design critique', 'design review', 'design decisions', 'design rationale', 'design handoff', 'developer handoff', 'design QA',
    'development-ready specifications', 'DesignOps', 'ResearchOps',
    'data-driven', 'data-driven design', 'data-informed', 'data-informed iteration', 'metrics-driven', 'metrics-driven insights',
    'funnel analysis', 'conversion optimization', 'conversion rate', 'NPS', 'CSAT', 'task success rate',
    'scalable design patterns', '0-to-1', 'zero to one',
  ],
  'Soft Skills': [
    'cross-functional collaboration', 'cross-functional', 'collaboration', 'partner closely', 'work closely',
    'stakeholder management', 'stakeholder communication', 'stakeholder alignment', 'influencing without authority',
    'storytelling', 'presentation skills', 'communication skills', 'design rationale', 'communicate reasoning',
    'workshop facilitation', 'facilitation', 'remote collaboration',
    'mentorship', 'coaching', 'design leadership', 'design culture', 'thought leadership',
    'presenting to executives', 'leading cross-functional team',
    'navigate ambiguity', 'ambiguity', 'complex problems', 'problem solving', 'creative problem solving', 'critical thinking',
    'strategic product thinking', 'strategic thinking', 'strategic', 'systems thinking',
    'growth mindset', 'continuous learning', 'curiosity', 'curious', 'proactive', 'self-starter', 'self-directed', 'autonomous',
    'adaptability', 'flexibility', 'resilience', 'fast-paced', 'fast-paced environment',
    'business goals', 'business outcomes', 'user needs', 'balance user needs', 'user advocacy',
    'feedback', 'design feedback', 'seek feedback', 'portfolio', 'craft',
  ],
  'Tools': [
    'Figma', 'FigJam', 'Sketch', 'Adobe XD', 'Adobe Creative Cloud', 'Adobe Photoshop', 'Adobe Illustrator', 'Adobe After Effects',
    'Framer', 'Principle', 'ProtoPie', 'InVision', 'Axure', 'Balsamiq', 'Zeplin', 'Storybook', 'Webflow',
    'Maze', 'UserTesting', 'Hotjar', 'FullStory', 'Amplitude', 'Mixpanel', 'Google Analytics', 'web analytics', 'Heap',
    'Dovetail', 'Lookback', 'Optimal Workshop', 'Sprig', 'Pendo', 'LogRocket', 'Qualtrics',
    'Miro', 'Mural', 'Notion', 'Confluence', 'Airtable', 'Jira', 'Asana', 'Trello', 'Linear', 'Slack',
    'HTML', 'CSS', 'JavaScript', 'React', 'Swift', 'SwiftUI', 'Git', 'GitHub', 'VS Code', 'Cursor', 'Claude Code', 'Vercel',
    'frontend development', 'design-to-code',
    'Phenom', 'Workday', 'ServiceNow', 'Salesforce',
  ],
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
  const isDemo = useIsDemo()
  const [versions, setVersions] = useState<ResumeVersion[]>([])
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [rescoring, setRescoring] = useState(false)
  const [rescoreProgress, setRescoreProgress] = useState({ current: 0, total: 0, updated: 0 })
  const [rescoreResult, setRescoreResult] = useState<{ updated: number } | null>(null)
  const rescoreInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const [loading, setLoading] = useState(true)
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
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!isDemo) setDrag(true) },
      onDragLeave: () => setDrag(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault(); setDrag(false)
        if (isDemo) return
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

  useEffect(() => {
    // Load resume versions and check rescore status in parallel
    Promise.all([
      loadVersions(),
      fetch('/api/jobs/rescore').then(r => r.json()).catch(() => null),
    ]).then(([, status]) => {
      if (status?.running) {
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
      setLoading(false)
    })
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="w-5 h-5 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
      </div>
    )
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
            <div className={`px-4 py-3 cursor-pointer transition-colors ${atsOpen ? 'bg-muted' : 'hover:bg-muted'}`} onClick={() => setAtsOpen(!atsOpen)}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{atsActive.filename ?? 'resume.pdf'}</span>
                      <Badge variant="success" className="text-[10px]">Active</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Uploaded {formatDateTime(atsActive.uploaded_at)} · <span className="tabular-nums">{atsActive.keywords_extracted?.length ?? 0}</span> keywords extracted
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform shrink-0 sm:hidden ${atsOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="xs" variant="ghost" aria-label="Download" disabled={isDemo} onClick={(e) => { e.stopPropagation(); handleDownload(atsActive.storage_path) }}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </Button>
                  <Button size="xs" onClick={(e) => { e.stopPropagation(); handleRescore() }} disabled={isDemo || rescoring} className={isDemo ? 'opacity-50 cursor-not-allowed' : ''}>
                    {rescoring ? `Re-scoring ${rescoreProgress.current}/${rescoreProgress.total}` : 'Re-score all jobs'}
                  </Button>
                  <Button size="xs" variant="outline" disabled={isDemo} className={isDemo ? 'opacity-50 cursor-not-allowed' : ''} onClick={(e) => { e.stopPropagation(); if (!isDemo) atsFileRef.current?.click() }}>
                    Upload new
                  </Button>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform shrink-0 hidden sm:block ${atsOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
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
            onClick={() => { if (!isDemo) atsFileRef.current?.click() }}
            className={`rounded-xl p-6 text-center transition-colors border-2 border-dashed border-border bg-card ${isDemo ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/50'}`}
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

        <input ref={atsFileRef} type="file" accept=".pdf" aria-label="Upload ATS resume PDF" className="hidden" disabled={isDemo} onChange={(e) => {
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
            <div className={`px-4 py-3 cursor-pointer transition-colors ${hmOpen ? 'bg-muted' : 'hover:bg-muted'}`} onClick={() => setHmOpen(!hmOpen)}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{hmActive.filename ?? 'resume.pdf'}</span>
                      <Badge variant="success" className="text-[10px]">Active</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Uploaded {formatDateTime(hmActive.uploaded_at)}
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform shrink-0 sm:hidden ${hmOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="xs" variant="ghost" aria-label="Download" disabled={isDemo} onClick={(e) => { e.stopPropagation(); handleDownload(hmActive.storage_path) }}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </Button>
                  <Button size="xs" variant="outline" disabled={isDemo} className={isDemo ? 'opacity-50 cursor-not-allowed' : ''} onClick={(e) => { e.stopPropagation(); if (!isDemo) hmFileRef.current?.click() }}>
                    Upload new
                  </Button>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-muted-foreground/50 transition-transform shrink-0 hidden sm:block ${hmOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
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
            onClick={() => { if (!isDemo) hmFileRef.current?.click() }}
            className={`rounded-xl p-6 text-center transition-colors border-2 border-dashed border-border bg-card ${isDemo ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/50'}`}
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

        <input ref={hmFileRef} type="file" accept=".pdf" aria-label="Upload Hiring Manager resume PDF" className="hidden" disabled={isDemo} onChange={(e) => {
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
              <div key={v.id} className="bg-card rounded-lg border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
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
                  <div className="flex items-center gap-1 shrink-0">
                    {v.is_active ? (
                      <Badge variant="success" className="text-[10px]">Active</Badge>
                    ) : (
                      <>
                        {v.storage_path && (
                          <Button size="xs" variant="ghost" aria-label="Download" disabled={isDemo} onClick={() => handleDownload(v.storage_path)}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          </Button>
                        )}
                        <Button size="xs" variant="outline" disabled={isDemo || settingActive === v.id} className={isDemo ? 'opacity-50 cursor-not-allowed' : ''} onClick={() => handleSetActive(v.id)}>
                          {settingActive === v.id ? 'Setting...' : 'Set Active'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
