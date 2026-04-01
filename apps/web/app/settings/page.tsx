'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ─── Types ───────────────────────────────────────────────────────────────────

interface KeywordGroup {
  name: string
  weight: number
  terms: string[]
}

type ScoringConfig = {
  keyword_groups?: KeywordGroup[]
  seniority_exclude?: string[]
  seniority_newgrad?: string[]
  non_design_titles?: string[]
  blocked_companies?: string[]
  blocked_locations?: string[]
  job_board_hosts?: string[]
  _meta?: Record<string, string>
}

// ─── Tag Editor Component ────────────────────────────────────────────────────

function TagEditor({ tags, onChange, placeholder }: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')
  const [expanded, setExpanded] = useState(tags.length <= 20)

  function addTag() {
    const trimmed = input.trim()
    if (!trimmed) return
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setInput('')
      return
    }
    onChange([...tags, trimmed])
    setInput('')
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index))
  }

  const display = expanded ? tags : tags.slice(0, 20)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {display.map((tag, i) => (
          <span key={`${tag}-${i}`} className="inline-flex items-center gap-1 text-xs bg-muted text-foreground px-2 py-1 rounded-md">
            {tag}
            <button type="button" onClick={() => removeTag(i)} className="text-muted-foreground hover:text-destructive transition-colors ml-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </span>
        ))}
        {!expanded && tags.length > 20 && (
          <button type="button" onClick={() => setExpanded(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1">
            +{tags.length - 20} more
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
          placeholder={placeholder ?? 'Add item...'}
          className="flex-1 h-8 text-xs"
        />
        <Button size="xs" variant="outline" onClick={addTag} disabled={!input.trim()}>Add</Button>
      </div>
    </div>
  )
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({ id, title, description, children, saving, onSave, onReset }: {
  id: string
  title: string
  description: string
  children: React.ReactNode
  saving: boolean
  onSave: () => void
  onReset: () => void
}) {
  return (
    <section id={id} className="bg-card rounded-lg border overflow-hidden scroll-mt-16">
      <div className="px-5 py-4 bg-muted/40">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        {children}
      </div>
      <div className="px-5 py-3 border-t flex items-center justify-between">
        <button type="button" onClick={onReset} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Reset to defaults
        </button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [config, setConfig] = useState<ScoringConfig>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadConfig = useCallback(async () => {
    const res = await fetch('/api/scoring')
    if (res.ok) setConfig(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  // Auto-scroll to hash on load
  useEffect(() => {
    if (!loading && window.location.hash) {
      const el = document.querySelector(window.location.hash)
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }, [loading])

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    if (toastTimeout.current) clearTimeout(toastTimeout.current)
    toastTimeout.current = setTimeout(() => setToast(null), 3000)
  }

  async function saveConfig(key: string, value: any) {
    setSavingKey(key)
    const res = await fetch('/api/scoring', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (res.ok) {
      setConfig((prev) => ({ ...prev, [key]: value }))
      showToast(`${key.replace(/_/g, ' ')} saved`)
    } else {
      const { error } = await res.json()
      showToast(error ?? 'Save failed', 'error')
    }
    setSavingKey(null)
  }

  // Local state for edits (so changes don't persist until Save)
  const [localKeywords, setLocalKeywords] = useState<KeywordGroup[]>([])
  const [localSeniorityExclude, setLocalSeniorityExclude] = useState<string[]>([])
  const [localSeniorityNewgrad, setLocalSeniorityNewgrad] = useState<string[]>([])
  const [localNonDesign, setLocalNonDesign] = useState<string[]>([])
  const [localBlockedCompanies, setLocalBlockedCompanies] = useState<string[]>([])
  const [localBlockedLocations, setLocalBlockedLocations] = useState<string[]>([])
  const [localJobBoards, setLocalJobBoards] = useState<string[]>([])

  // Sync local state from config when loaded
  useEffect(() => {
    if (!config.keyword_groups) return
    setLocalKeywords(config.keyword_groups)
    setLocalSeniorityExclude(config.seniority_exclude ?? [])
    setLocalSeniorityNewgrad(config.seniority_newgrad ?? [])
    setLocalNonDesign(config.non_design_titles ?? [])
    setLocalBlockedCompanies(config.blocked_companies ?? [])
    setLocalBlockedLocations(config.blocked_locations ?? [])
    setLocalJobBoards(config.job_board_hosts ?? [])
  }, [config])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="w-5 h-5 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Edit scoring keywords, filters, and blocklists. Changes take effect on the next job processed.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`text-xs rounded-md px-3 py-2 ${toast.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {toast.message}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex flex-wrap gap-2 text-xs">
        {[
          { id: 'keywords', label: 'Keywords' },
          { id: 'seniority', label: 'Seniority' },
          { id: 'title-blocklist', label: 'Title Blocklist' },
          { id: 'blocklists', label: 'Blocklists' },
          { id: 'job-boards', label: 'Job Boards' },
        ].map((s) => (
          <a key={s.id} href={`#${s.id}`} className="px-3 py-1.5 rounded-md border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            {s.label}
          </a>
        ))}
      </nav>

      {/* ── Keyword Groups ──────────────────────────────────────────────── */}
      <Section
        id="keywords"
        title="Scoring Keyword Groups"
        description={`${localKeywords.length} groups · ${localKeywords.reduce((s, g) => s + g.terms.length, 0)} total terms — matched against job descriptions for scoring`}
        saving={savingKey === 'keyword_groups'}
        onSave={() => saveConfig('keyword_groups', localKeywords)}
        onReset={() => { if (confirm('Reset keyword groups to hardcoded defaults?')) loadConfig() }}
      >
        <div className="space-y-4">
          {localKeywords.map((group, gi) => (
            <details key={group.name} className="group">
              <summary className="flex items-center justify-between cursor-pointer py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{group.name.replace(/_/g, ' ')}</span>
                  <Badge variant="secondary" className="text-[10px]">{group.terms.length}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    Weight:
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={group.weight}
                      onChange={(e) => {
                        const updated = [...localKeywords]
                        updated[gi] = { ...updated[gi], weight: Number(e.target.value) }
                        setLocalKeywords(updated)
                      }}
                      className="w-12 text-xs px-1.5 py-0.5 rounded border border-input bg-background text-center"
                    />
                  </label>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-muted-foreground/50 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </summary>
              <div className="pt-2 pb-3">
                <TagEditor
                  tags={group.terms}
                  onChange={(terms) => {
                    const updated = [...localKeywords]
                    updated[gi] = { ...updated[gi], terms }
                    setLocalKeywords(updated)
                  }}
                  placeholder={`Add ${group.name.replace(/_/g, ' ')} term...`}
                />
              </div>
            </details>
          ))}
        </div>
      </Section>

      {/* ── Seniority Filters ───────────────────────────────────────────── */}
      <Section
        id="seniority"
        title="Seniority Filters"
        description="Title patterns that exclude jobs by seniority level or boost new-grad roles"
        saving={savingKey === 'seniority_exclude' || savingKey === 'seniority_newgrad'}
        onSave={async () => {
          await saveConfig('seniority_exclude', localSeniorityExclude)
          await saveConfig('seniority_newgrad', localSeniorityNewgrad)
        }}
        onReset={() => { if (confirm('Reset seniority filters to defaults?')) loadConfig() }}
      >
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Excluded seniority levels (jobs deprioritized)</div>
          <TagEditor tags={localSeniorityExclude} onChange={setLocalSeniorityExclude} placeholder="Add pattern (e.g. staff, principal)..." />
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">New grad bonus patterns (+10 score)</div>
          <TagEditor tags={localSeniorityNewgrad} onChange={setLocalSeniorityNewgrad} placeholder="Add pattern (e.g. junior, associate)..." />
        </div>
      </Section>

      {/* ── Non-Design Title Blocklist ──────────────────────────────────── */}
      <Section
        id="title-blocklist"
        title="Non-Design Title Blocklist"
        description="Jobs with these keywords in the title are dropped entirely (hard block)"
        saving={savingKey === 'non_design_titles'}
        onSave={() => saveConfig('non_design_titles', localNonDesign)}
        onReset={() => { if (confirm('Reset title blocklist to defaults?')) loadConfig() }}
      >
        <TagEditor tags={localNonDesign} onChange={setLocalNonDesign} placeholder="Add blocked keyword (e.g. engineer, intern)..." />
      </Section>

      {/* ── Company & Location Blocklists ───────────────────────────────── */}
      <Section
        id="blocklists"
        title="Company & Location Blocklists"
        description="Companies and non-US locations to always skip"
        saving={savingKey === 'blocked_companies' || savingKey === 'blocked_locations'}
        onSave={async () => {
          await saveConfig('blocked_companies', localBlockedCompanies)
          await saveConfig('blocked_locations', localBlockedLocations)
        }}
        onReset={() => { if (confirm('Reset blocklists to defaults?')) loadConfig() }}
      >
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Blocked companies ({localBlockedCompanies.length})</div>
          <TagEditor tags={localBlockedCompanies} onChange={setLocalBlockedCompanies} placeholder="Add company name..." />
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Blocked locations ({localBlockedLocations.length})</div>
          <TagEditor tags={localBlockedLocations} onChange={setLocalBlockedLocations} placeholder="Add city or country..." />
        </div>
      </Section>

      {/* ── Job Board Allowlist ─────────────────────────────────────────── */}
      <Section
        id="job-boards"
        title="Job Board Allowlist"
        description="Only Firehose URLs from these domains are processed (other sources bypass this filter)"
        saving={savingKey === 'job_board_hosts'}
        onSave={() => saveConfig('job_board_hosts', localJobBoards)}
        onReset={() => { if (confirm('Reset job board hosts to defaults?')) loadConfig() }}
      >
        <TagEditor tags={localJobBoards} onChange={setLocalJobBoards} placeholder="Add domain (e.g. lever.co)..." />
      </Section>
    </div>
  )
}
