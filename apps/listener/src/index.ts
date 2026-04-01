// Firehose SSE listener — multi-tap concurrent streaming

import http from 'http'
import EventSource from 'eventsource'
import { createClient } from '@supabase/supabase-js'
import { syncAllTaps, TAP_CONFIGS, type TapInfo } from './rules'
import { processEvent, getProcessorStats, invalidateResumeCache, setBlockedCompanies, setBlockedLocations, setJobBoardHosts, type FirehoseUpdateEvent } from './processor'
import { setKeywordGroups, setSeniorityConfig, recompileKeywords } from '@job-tracker/scoring'

// ─── Import sources + their DataSource registrations ─────────────────────────
import { pollAllAts, pollStatus, stopAts, atsSource } from './ats-poller'
import { pollMantiks, lastMantikPollAt, mantikSource } from './linkedin-mantiks'
import { pollLinkedIn, scraperStatus, scraperSource } from './linkedin-scraper'
import { pollSerpApi, serpApiSource } from './serpapi-jobs'
import { pollLinkedInDirect, linkedinDirectSource } from './linkedin-direct'
import { pollIndeed, pollGlassdoor, indeedSource, glassdoorSource } from './hasdata-jobs'
import { githubSource } from './github-jobs'

// Ensure source modules are imported so registerSource() side-effects run
void atsSource; void mantikSource; void scraperSource
void serpApiSource; void linkedinDirectSource; void indeedSource; void glassdoorSource
void githubSource

import { registerSource } from './sources/registry'
import { getSource, getSourcesStatus } from './sources/registry'
import { createHealth, type DataSource } from './sources/types'
import { extractKeywordsWithGemini, validateKeywords, computeResumeFit } from '@job-tracker/scoring'

// ─── Rescore state ───────────────────────────────────────────────────────────
const rescoreState = { running: false, current: 0, total: 0, updated: 0, errors: 0 }

async function runRescore() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const geminiKey = process.env.GEMINI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  const { data: resume } = await supabase.from('resume_versions').select('keywords_extracted').eq('is_active', true).eq('resume_type', 'ats').single()
  if (!resume) { console.error('No active resume'); return }
  const resumeKeywords: string[] = resume.keywords_extracted ?? []

  const { data: jobs } = await supabase.from('job_postings').select('id, keywords_matched, page_content')
  if (!jobs) return

  rescoreState.running = true
  rescoreState.current = 0
  rescoreState.total = jobs.length
  rescoreState.updated = 0
  rescoreState.errors = 0
  console.log(`🔄 Rescore started: ${jobs.length} jobs`)

  for (const job of jobs) {
    rescoreState.current++
    try {
      if ((geminiKey || anthropicKey) && job.page_content && job.page_content.length > 100) {
        const rawLlm = await extractKeywordsWithGemini(job.page_content, resumeKeywords, geminiKey, anthropicKey)
        const llmResult = rawLlm ? validateKeywords(rawLlm, job.page_content, resumeKeywords) : null
        if (llmResult) {
          const allKeywords = [...llmResult.matched, ...llmResult.missing]
          const fit = llmResult.role_fit
          const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'
          await supabase.from('job_postings').update({ keywords_matched: allKeywords, resume_fit: fit, priority }).eq('id', job.id)
          rescoreState.updated++
          await new Promise(r => setTimeout(r, 200))
          continue
        }
      }
      // Fallback: regex
      const fit = computeResumeFit(job.keywords_matched ?? [], resumeKeywords)
      const priority = fit >= 80 ? 'high' : fit >= 50 ? 'medium' : fit >= 1 ? 'low' : 'skip'
      await supabase.from('job_postings').update({ resume_fit: fit, priority }).eq('id', job.id)
      rescoreState.updated++
    } catch (err) {
      rescoreState.errors++
      console.error(`Rescore error for ${job.id}:`, (err as Error).message)
    }
  }

  rescoreState.running = false
  console.log(`✅ Rescore done: ${rescoreState.updated} updated, ${rescoreState.errors} errors`)
}

const FIREHOSE_STREAM_URL = 'https://api.firehose.com/v1/stream'
const RECONNECT_DELAY_MS = 5_000

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

// ─── Per-tap offset persistence ───────────────────────────────────────────────

function offsetKey(tapName: string): string {
  return `last_event_id:${tapName}`
}

async function loadOffset(tapName: string): Promise<string | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('listener_state')
    .select('value')
    .eq('key', offsetKey(tapName))
    .single()
  return data?.value ?? null
}

async function saveOffset(tapName: string, eventId: string): Promise<void> {
  const supabase = getSupabase()
  await supabase
    .from('listener_state')
    .upsert({ key: offsetKey(tapName), value: eventId })
}

// ─── Firehose SSE source registration ────────────────────────────────────────

const firehoseHealth = createHealth()

const firehoseSource: DataSource = {
  id: 'firehose',
  name: 'Firehose SSE',
  type: 'stream',
  schedule: 'Real-time',
  cost: 'Firehose subscription',
  envVars: ['FIREHOSE_MANAGEMENT_KEY'],
  triggerPath: null,
  health: firehoseHealth,
  poll: async () => {}, // no-op for stream
  stop: () => {
    for (const es of activeSources) es.close()
  },
}

registerSource(firehoseSource)

// ─── SSE connection (one per tap) ─────────────────────────────────────────────

let isShuttingDown = false
const activeSources: InstanceType<typeof EventSource>[] = []

async function connectTap(tap: TapInfo): Promise<void> {
  if (isShuttingDown) return

  const lastEventId = await loadOffset(tap.name)

  const url = new URL(FIREHOSE_STREAM_URL)
  url.searchParams.set('timeout', '300')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tap.token}`,
  }
  if (lastEventId) {
    headers['Last-Event-ID'] = lastEventId
    console.log(`[${tap.name}] Resuming from offset ${lastEventId}`)
  } else {
    console.log(`[${tap.name}] Starting live stream (no saved offset)`)
  }

  const es = new EventSource(url.toString(), { headers })
  activeSources.push(es)

  es.addEventListener('connected', () => {
    console.log(`[${tap.name}] ✅ Connected`)
    firehoseHealth.status = 'connected'
  })

  es.addEventListener('update', async (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data) as FirehoseUpdateEvent
      await processEvent(payload)
      firehoseHealth.jobsFound++
      firehoseHealth.lastPollAt = Date.now()
      if (e.lastEventId) await saveOffset(tap.name, e.lastEventId)
    } catch (err) {
      console.error(`[${tap.name}] Error processing event:`, err)
    }
  })

  es.addEventListener('error', (e: MessageEvent) => {
    const msg = e.data ? JSON.parse(e.data)?.message : 'unknown error'
    console.error(`[${tap.name}] Stream error:`, msg)
    firehoseHealth.status = 'error'
    firehoseHealth.lastError = msg
    firehoseHealth.lastErrorAt = Date.now()
  })

  es.addEventListener('end', () => {
    console.log(`[${tap.name}] Stream ended. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`)
    es.close()
    activeSources.splice(activeSources.indexOf(es), 1)
    setTimeout(() => connectTap(tap), RECONNECT_DELAY_MS)
  })

  es.onerror = (err: Event) => {
    if (isShuttingDown) return
    console.error(`[${tap.name}] SSE error, reconnecting:`, err)
    es.close()
    activeSources.splice(activeSources.indexOf(es), 1)
    setTimeout(() => connectTap(tap), RECONNECT_DELAY_MS)
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
  console.log('\nShutting down...')
  isShuttingDown = true
  for (const es of activeSources) es.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// ─── HTTP control server ──────────────────────────────────────────────────────

// ─── Scoring config loader ───────────────────────────────────────────────────

async function loadScoringConfig(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.warn('⚠ Supabase not configured — using default scoring config'); return }

  const supabase = createClient(url, key)
  const { data, error } = await supabase.from('scoring_config').select('key, value')
  if (error) { console.warn('⚠ Failed to load scoring config:', error.message); return }
  if (!data || data.length === 0) { console.log('ℹ No scoring config in DB — using defaults'); return }

  const config: Record<string, any> = {}
  for (const row of data) config[row.key] = row.value

  if (config.keyword_groups) { setKeywordGroups(config.keyword_groups); recompileKeywords() }
  if (config.seniority_exclude || config.seniority_newgrad || config.non_design_titles) {
    setSeniorityConfig({
      exclude: config.seniority_exclude,
      newgrad: config.seniority_newgrad,
      nonDesign: config.non_design_titles,
    })
  }
  if (config.blocked_companies) setBlockedCompanies(config.blocked_companies)
  if (config.blocked_locations) setBlockedLocations(config.blocked_locations)
  if (config.job_board_hosts) setJobBoardHosts(config.job_board_hosts)

  console.log(`⚙ Scoring config loaded from DB (${data.length} keys)`)
}

function startControlServer() {
  const port = process.env.CONTROL_PORT ? Number(process.env.CONTROL_PORT) : 3001
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ ok: true }))
    } else if (req.method === 'GET' && req.url === '/status') {
      res.end(JSON.stringify(pollStatus))
    } else if (req.method === 'GET' && req.url === '/sources') {
      // Return all registered sources with health + Firehose rules metadata
      const sources = getSourcesStatus()
      const rules = TAP_CONFIGS.map((t) => ({
        tapName: t.name,
        envKey: t.envKey,
        ruleCount: t.rules.length,
        rules: t.rules.map((r) => ({ tag: r.tag })),
      }))
      res.end(JSON.stringify({ sources, firehoseRules: rules, processorStats: getProcessorStats() }))
    } else if (req.method === 'POST' && req.url === '/rescore') {
      if (rescoreState.running) {
        res.end(JSON.stringify({ ok: false, message: 'Rescore already running', ...rescoreState }))
      } else {
        runRescore().catch(console.error)
        res.end(JSON.stringify({ ok: true, message: 'Rescore started' }))
      }
    } else if (req.method === 'GET' && req.url === '/rescore/status') {
      res.end(JSON.stringify(rescoreState))
    } else if (req.method === 'POST' && req.url === '/poll/stop') {
      stopAts()
      res.end(JSON.stringify({ ok: true, message: 'ATS poll abort requested' }))
    } else if (req.method === 'POST' && req.url?.startsWith('/poll')) {
      // Dynamic dispatch via registry
      const path = req.url
      let sourceId: string | null = null
      if (path === '/poll') sourceId = 'ats'
      else if (path === '/poll/linkedin') sourceId = 'linkedin-scraper'
      else if (path === '/poll/mantiks') sourceId = 'linkedin-mantiks'
      else if (path === '/poll/serpapi') sourceId = 'serpapi'
      else if (path === '/poll/indeed') sourceId = 'indeed'
      else if (path === '/poll/glassdoor') sourceId = 'glassdoor'
      else if (path === '/poll/linkedin-direct') sourceId = 'linkedin-direct'
      else if (path === '/poll/github') sourceId = 'github-jobs'

      if (sourceId) {
        const source = getSource(sourceId)
        if (source) {
          source.poll().catch(console.error)
          res.end(JSON.stringify({ ok: true, message: `${source.name} poll triggered` }))
        } else {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `Source ${sourceId} not found` }))
        }
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Unknown poll endpoint' }))
      }
    } else if (req.method === 'POST' && req.url === '/cache/invalidate') {
      invalidateResumeCache()
      res.end(JSON.stringify({ ok: true, message: 'Resume keyword cache invalidated' }))
    } else if (req.method === 'POST' && req.url === '/config/reload') {
      loadScoringConfig().then(() => {
        res.end(JSON.stringify({ ok: true, message: 'Scoring config reloaded' }))
      }).catch((err) => {
        res.statusCode = 500
        res.end(JSON.stringify({ error: err.message }))
      })
    } else {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  })
  server.listen(port, () => {
    console.log(`🎛  Control server listening on port ${port}`)
  })
}

// ─── Fixed-time daily scheduler ───────────────────────────────────────────────

function scheduleDailyAt(hours: number[], fn: () => void, label: string) {
  function scheduleNext() {
    const now = new Date()
    const delays = hours.map((h) => {
      const t = new Date(now)
      t.setHours(h, 0, 0, 0)
      if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1)
      return t.getTime() - now.getTime()
    })
    const next = Math.min(...delays)
    const nextDate = new Date(Date.now() + next)
    console.log(`⏰ ${label}: next run at ${nextDate.toLocaleTimeString()}`)
    setTimeout(() => { fn(); scheduleNext() }, next)
  }
  scheduleNext()
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const ATS_POLL_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

async function main() {
  if (!process.env.FIREHOSE_MANAGEMENT_KEY) {
    console.error('❌ FIREHOSE_MANAGEMENT_KEY is not set')
    process.exit(1)
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
    process.exit(1)
  }

  startControlServer()
  console.log('🚀 Job Tracker Listener starting...')

  // Load scoring config from DB (keywords, seniority, blocklists)
  await loadScoringConfig()

  console.log('Syncing taps and rules...')

  const taps = await syncAllTaps()

  // Use registry-wrapped polls for health tracking
  const ats = getSource('ats')!
  await ats.poll()
  setInterval(() => ats.poll().catch(console.error), ATS_POLL_INTERVAL_MS)
  console.log(`⏱  ATS polling every ${ATS_POLL_INTERVAL_MS / 60000} min`)

  const mantiks = getSource('linkedin-mantiks')!
  await mantiks.poll()
  const MANTIKS_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
  setInterval(() => mantiks.poll().catch(console.error), MANTIKS_INTERVAL_MS)
  console.log('⏱  Mantiks polling every 7 days')

  const scraper = getSource('linkedin-scraper')!
  const serpapi = getSource('serpapi')!
  const indeed = getSource('indeed')!
  const glassdoor = getSource('glassdoor')!

  scheduleDailyAt([6, 18], () => scraper.poll().catch(console.error), 'LinkedIn scraper')
  scheduleDailyAt([6, 18], () => serpapi.poll().catch(console.error), 'SerpApi')
  scheduleDailyAt([6, 18], () => Promise.all([indeed.poll(), glassdoor.poll()]).catch(console.error), 'HasData (Indeed+Glassdoor)')

  const github = getSource('github-jobs')!
  await github.poll()
  scheduleDailyAt([7, 19], () => github.poll().catch(console.error), 'GitHub jobs')

  // Fallback chain
  setInterval(() => {
    const mantiksDead = mantiks.health.lastPollAt !== null && Date.now() - mantiks.health.lastPollAt > 8 * 60 * 60 * 1000
    const scraperDead = scraper.health.consecutiveFailures >= 3

    if (mantiksDead && scraperDead) {
      console.warn('⚠️  [Fallback] Mantiks + scraper both down — running SerpApi now')
      serpapi.poll().catch(console.error)
    }

    if (mantiksDead && scraperDead && !process.env.SERPAPI_API_KEY) {
      console.warn('⚠️  [Fallback] All sources down — activating LinkedIn direct scraper')
      const direct = getSource('linkedin-direct')
      direct?.poll().catch(console.error)
    }
  }, 60 * 60 * 1000)

  console.log(`\nOpening ${taps.length} SSE streams...`)
  await Promise.all(taps.map(tap => connectTap(tap)))
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
