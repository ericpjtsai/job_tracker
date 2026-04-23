// Extract AI-related keywords from mid-to-high score job descriptions and
// produce a frequency analysis report.
//
// Usage: npx tsx --env-file=.env.local scripts/analyze-ai-keywords.ts
// Optional: LIMIT=20 PRIORITIES=high,medium npx tsx --env-file=.env.local scripts/analyze-ai-keywords.ts

import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { callClaude, HAIKU, OPUS, SONNET } from './_shared/claude'
import { KEYWORD_GROUPS } from '../packages/scoring/src/keywords'

const PRIORITIES = (process.env.PRIORITIES ?? 'high,medium').split(',').map(s => s.trim())
const LIMIT = Number(process.env.LIMIT ?? 1000)
const ONLY_AI_COMPANIES = process.env.ONLY_AI_COMPANIES === 'true'
const MODEL_NAME = (process.env.MODEL ?? 'haiku').toLowerCase()
const MODEL = MODEL_NAME === 'opus' ? OPUS : MODEL_NAME === 'sonnet' ? SONNET : HAIKU
const RATE_LIMIT_MS = MODEL === OPUS ? 1000 : 200
const MAX_TOKENS = MODEL === OPUS ? 1500 : 1200
// Known AI-forward companies — included regardless of priority
const AI_COMPANIES = [
  // AI labs / foundation models
  'anthropic', 'openai', 'deepmind', 'mistral', 'cohere', 'perplexity',
  'hugging face', 'huggingface', 'inflection', 'adept', 'character.ai',
  'stability', 'runway', 'midjourney', 'elevenlabs', 'eleven labs',
  // Big tech AI divisions
  'meta', 'google', 'amazon', 'microsoft', 'nvidia', 'apple', 'tiktok', 'bytedance',
  // AI-native product companies / infra
  'scale ai', 'glean', 'harvey', 'cursor', 'replit', 'vercel', 'workos',
  'langchain', 'pinecone', 'weaviate', 'chroma', 'groq', 'together',
  'replicate', 'databricks', 'snowflake', 'notion', 'linear', 'figma',
  'crusoe', 'sierra', 'decagon', 'writer', 'jasper', 'copy.ai', 'cresta',
  'tome', 'granola', 'raycast', 'arc', 'browserbase',
]
// AI-related keywords to match in page_content or title (case-insensitive)
const AI_CONTENT_PATTERNS = [
  'LLM', 'llms', 'generative ai', 'gen ai', 'genai', 'agentic', 'ai agent',
  'copilot', 'gpt', 'claude', 'anthropic', 'openai', 'transformer',
  'machine learning', 'artificial intelligence', 'ai-powered', 'ai-first',
  'ai-native', 'ai/ml', 'foundation model', 'prompt engineering',
  'conversational ai', 'chatbot', 'retrieval augmented', 'rag',
]
const MIN_JD_LENGTH = 500
const GAP_THRESHOLD = 5

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Extraction {
  ai_tools: string[]
  ai_concepts: string[]
  ai_responsibilities: string[]
  ai_required: boolean
  ai_emphasis: 'core' | 'mentioned' | 'none'
}

const PROMPT_TEMPLATE = (title: string, company: string, jd: string) => `You are analyzing a Product/UX Design job description for AI-related content.

Job title: ${title}
Company: ${company}

Job description:
"""
${jd}
"""

Extract ONLY AI/ML-related content. Ignore generic design skills, soft skills, and non-AI tooling.

Return STRICT JSON with this exact shape (no prose, no code fences):
{
  "ai_tools": [],           // named AI products/tools/models mentioned (e.g. "Figma AI", "Cursor", "ChatGPT", "Claude", "Midjourney", "GitHub Copilot", "v0", "Replit Agent"). Use official casing. Deduplicate.
  "ai_concepts": [],        // AI methodologies, paradigms, technical concepts (e.g. "LLM", "RAG", "agentic workflows", "multimodal", "prompt engineering", "fine-tuning", "embeddings", "conversational UI", "human-in-the-loop", "generative AI"). Short canonical terms.
  "ai_responsibilities": [], // what the DESIGNER is expected to DO with AI (e.g. "design AI copilots", "build agentic user experiences", "define AI interaction patterns", "use AI to accelerate design workflows"). Short phrases, lowercase, present tense.
  "ai_required": false,     // true if AI experience is listed as required/preferred qualification; false if merely mentioned in context
  "ai_emphasis": "none"     // "core" if AI is central to the role, "mentioned" if AI appears but role is not primarily AI-focused, "none" if no meaningful AI content
}

Rules:
- If no AI content, return empty arrays, ai_required=false, ai_emphasis="none".
- Do NOT invent terms not in the JD. Only extract what's actually present.
- Normalize plurals and abbreviations (LLMs → LLM, AI agents → AI agents [keep]).
- Keep responses terse: prefer short canonical terms over full sentences.
- Return ONLY the JSON object.`

function parseExtraction(text: string): Extraction | null {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const p = JSON.parse(m[0])
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : []
    const emphasis = ['core', 'mentioned', 'none'].includes(p.ai_emphasis)
      ? p.ai_emphasis
      : 'none'
    return {
      ai_tools: arr(p.ai_tools),
      ai_concepts: arr(p.ai_concepts),
      ai_responsibilities: arr(p.ai_responsibilities),
      ai_required: Boolean(p.ai_required),
      ai_emphasis: emphasis,
    }
  } catch {
    return null
  }
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

function tally(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  const displayByNorm = new Map<string, string>()
  for (const v of values) {
    const n = normalize(v)
    if (!n) continue
    counts.set(n, (counts.get(n) ?? 0) + 1)
    if (!displayByNorm.has(n)) displayByNorm.set(n, v.trim())
  }
  return counts
}

function topN(counts: Map<string, number>, n: number): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  if (!anthropicKey) throw new Error('Missing ANTHROPIC_API_KEY')

  const supabase = createClient(url, key)

  // Build filter. When ONLY_AI_COMPANIES=true, narrow to AI-forward companies only.
  const companyClauses = AI_COMPANIES.map(c => `company.ilike.%${c}%`)
  const orFilter = ONLY_AI_COMPANIES
    ? companyClauses.join(',')
    : (() => {
        const priorityClause = `priority.in.(${PRIORITIES.join(',')})`
        const contentClauses = AI_CONTENT_PATTERNS.flatMap(p => [
          `page_content.ilike.%${p}%`,
          `title.ilike.%${p}%`,
        ])
        return [priorityClause, ...companyClauses, ...contentClauses].join(',')
      })()

  const { data: jobs, error } = await supabase
    .from('job_postings')
    .select('id, title, company, score, priority, resume_fit, page_content')
    .or(orFilter)
    .not('page_content', 'is', null)
    .order('resume_fit', { ascending: false, nullsFirst: false })
    .limit(LIMIT)

  if (error) throw error
  const candidates = (jobs || []).filter(
    (j: any) => j.page_content && stripHtml(j.page_content).length >= MIN_JD_LENGTH,
  )
  const aiCoCount = candidates.filter((j: any) =>
    AI_COMPANIES.some(c => (j.company ?? '').toLowerCase().includes(c)),
  ).length
  const scopeDesc = ONLY_AI_COMPANIES
    ? `AI-forward companies only (${aiCoCount})`
    : `medium+ priority OR AI company (${aiCoCount} from AI companies) OR JD mentions AI keywords`
  console.log(`Analyzing ${candidates.length} jobs — ${scopeDesc} — model: ${MODEL}`)

  const perJob: Array<{
    id: string
    title: string
    company: string
    score: number
    extraction: Extraction
  }> = []
  let ok = 0, failed = 0

  for (let i = 0; i < candidates.length; i++) {
    const job = candidates[i] as any
    const jd = stripHtml(job.page_content).slice(0, 12000)
    const prompt = PROMPT_TEMPLATE(job.title ?? '', job.company ?? '', jd)
    try {
      const raw = await callClaude(MODEL, prompt, anthropicKey, {
        maxTokens: MAX_TOKENS,
        temperature: 0.1,
      })
      const ext = parseExtraction(raw)
      if (!ext) {
        failed++
        console.log(`[${i + 1}/${candidates.length}] PARSE_FAIL ${job.title}`)
      } else {
        ok++
        perJob.push({
          id: job.id,
          title: job.title,
          company: job.company,
          score: job.score,
          extraction: ext,
        })
        console.log(
          `[${i + 1}/${candidates.length}] ${ext.ai_emphasis.padEnd(9)} tools:${ext.ai_tools.length} concepts:${ext.ai_concepts.length} — ${job.title} (${job.company})`,
        )
      }
    } catch (err: any) {
      failed++
      console.log(`[${i + 1}/${candidates.length}] ERROR ${job.title}: ${String(err.message).slice(0, 100)}`)
    }
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS))
  }

  console.log(`\nExtracted ${ok} / ${candidates.length} (${failed} failed)`)

  // Aggregate
  const allTools = perJob.flatMap(j => j.extraction.ai_tools)
  const allConcepts = perJob.flatMap(j => j.extraction.ai_concepts)
  const allResp = perJob.flatMap(j => j.extraction.ai_responsibilities)
  const toolCounts = tally(allTools)
  const conceptCounts = tally(allConcepts)
  const respCounts = tally(allResp)

  const emphasisCounts = { core: 0, mentioned: 0, none: 0 }
  let requiredCount = 0
  for (const j of perJob) {
    emphasisCounts[j.extraction.ai_emphasis]++
    if (j.extraction.ai_required) requiredCount++
  }

  // Seniority split
  const isStaffPlus = (title: string) =>
    /\b(staff|principal|lead|director|head of|vp|vice president)\b/i.test(title)
  const seniorJobs = perJob.filter(j => !isStaffPlus(j.title ?? ''))
  const staffJobs = perJob.filter(j => isStaffPlus(j.title ?? ''))
  const seniorConcepts = tally(seniorJobs.flatMap(j => j.extraction.ai_concepts))
  const staffConcepts = tally(staffJobs.flatMap(j => j.extraction.ai_concepts))

  // Gap analysis vs existing ai_emerging taxonomy
  const aiGroup = KEYWORD_GROUPS.find(g => g.name === 'ai_emerging')
  const existing = new Set((aiGroup?.terms ?? []).map(normalize))
  const combined = new Map<string, number>()
  for (const [k, v] of toolCounts) combined.set(k, (combined.get(k) ?? 0) + v)
  for (const [k, v] of conceptCounts) combined.set(k, (combined.get(k) ?? 0) + v)
  const gaps = [...combined.entries()]
    .filter(([k, v]) => v >= GAP_THRESHOLD && !existing.has(k))
    .sort((a, b) => b[1] - a[1])

  // Write reports
  const today = new Date().toISOString().slice(0, 10)
  const reportsDir = resolve(process.cwd(), 'reports')
  mkdirSync(reportsDir, { recursive: true })

  const suffix = [
    ONLY_AI_COMPANIES ? 'ai-companies' : null,
    MODEL === OPUS ? 'opus' : MODEL === SONNET ? 'sonnet' : null,
  ].filter(Boolean).join('-')
  const stem = suffix ? `ai-keywords-${today}-${suffix}` : `ai-keywords-${today}`
  const jsonPath = resolve(reportsDir, `${stem}.json`)
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        params: { priorities: PRIORITIES, ai_companies: AI_COMPANIES, limit: LIMIT },
        totals: {
          candidates: candidates.length,
          extracted: ok,
          failed,
          ai_required: requiredCount,
          emphasis: emphasisCounts,
        },
        counts: {
          tools: Object.fromEntries(toolCounts),
          concepts: Object.fromEntries(conceptCounts),
          responsibilities: Object.fromEntries(respCounts),
        },
        per_job: perJob,
      },
      null,
      2,
    ),
  )

  const mdLines: string[] = []
  mdLines.push(`# AI Keyword Analysis — ${today}`)
  mdLines.push('')
  mdLines.push(`**Scope:** ${ok} jobs — medium+ priority OR AI-forward company OR AI keyword in JD/title, JD ≥ ${MIN_JD_LENGTH} chars.`)
  mdLines.push('')
  mdLines.push('## Emphasis')
  mdLines.push('')
  mdLines.push(`- **Core AI roles:** ${emphasisCounts.core} (${pct(emphasisCounts.core, ok)})`)
  mdLines.push(`- **AI mentioned:** ${emphasisCounts.mentioned} (${pct(emphasisCounts.mentioned, ok)})`)
  mdLines.push(`- **No AI content:** ${emphasisCounts.none} (${pct(emphasisCounts.none, ok)})`)
  mdLines.push(`- **AI explicitly required/preferred:** ${requiredCount} (${pct(requiredCount, ok)})`)
  mdLines.push('')
  mdLines.push('## Top AI Tools/Products')
  mdLines.push('')
  mdLines.push(renderTable(topN(toolCounts, 30), ok))
  mdLines.push('')
  mdLines.push('## Top AI Concepts/Paradigms')
  mdLines.push('')
  mdLines.push(renderTable(topN(conceptCounts, 40), ok))
  mdLines.push('')
  mdLines.push('## Top AI Responsibilities (what designers are asked to do)')
  mdLines.push('')
  mdLines.push(renderTable(topN(respCounts, 30), ok))
  mdLines.push('')
  mdLines.push(`## Gaps vs current \`ai_emerging\` taxonomy (≥${GAP_THRESHOLD} mentions, not yet in taxonomy)`)
  mdLines.push('')
  if (gaps.length === 0) {
    mdLines.push('_No gaps — taxonomy covers all frequently-mentioned terms._')
  } else {
    mdLines.push('| term | count |')
    mdLines.push('|---|---:|')
    for (const [term, count] of gaps) mdLines.push(`| ${term} | ${count} |`)
  }
  mdLines.push('')
  mdLines.push('## Seniority Breakdown — Top Concepts')
  mdLines.push('')
  mdLines.push(`### Senior & below (n=${seniorJobs.length})`)
  mdLines.push('')
  mdLines.push(renderTable(topN(seniorConcepts, 15), seniorJobs.length))
  mdLines.push('')
  mdLines.push(`### Staff+ / Principal / Lead (n=${staffJobs.length})`)
  mdLines.push('')
  mdLines.push(renderTable(topN(staffConcepts, 15), staffJobs.length))
  mdLines.push('')
  mdLines.push('## AI-Core Roles')
  mdLines.push('')
  const coreRoles = perJob.filter(j => j.extraction.ai_emphasis === 'core')
  if (coreRoles.length === 0) {
    mdLines.push('_None._')
  } else {
    for (const j of coreRoles.slice(0, 30)) {
      mdLines.push(`- **${j.title}** — ${j.company} (score ${j.score})`)
    }
  }
  mdLines.push('')

  const mdPath = resolve(reportsDir, `${stem}.md`)
  writeFileSync(mdPath, mdLines.join('\n'))

  console.log(`\nReports written:`)
  console.log(`  ${mdPath}`)
  console.log(`  ${jsonPath}`)
}

function pct(n: number, total: number): string {
  if (!total) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

function renderTable(rows: [string, number][], total: number): string {
  if (rows.length === 0) return '_None._'
  const lines = ['| term | count | % of jobs |', '|---|---:|---:|']
  for (const [term, count] of rows) {
    lines.push(`| ${term} | ${count} | ${pct(count, total)} |`)
  }
  return lines.join('\n')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
