// LLM-powered keyword extraction — Gemini Flash via fetch (Deno-compatible).
// Gemini REST API is fetch-based and works in both Node and Deno without any SDK.
// Designed to match enterprise ATS extraction quality (Workday, Greenhouse, Ashby, Indeed, Glassdoor)

export interface LLMKeywordResult {
  matched: string[]
  missing: string[]
  role_fit: number  // 0-100 LLM-assessed fit score
}

const PROMPT = `You are an AI recruiting agent. Your job is to extract keywords **ACTUALLY PRESENT in the job description below** and classify them against the candidate's resume.

## THE MOST IMPORTANT RULE — READ TWICE
**Every keyword you return MUST appear verbatim in the JD text (or as an obvious morphological variant: "designs" → "design", "prototyping" → "prototype").** You are NOT guessing what keywords a role might need. You are NOT listing industry-standard design terms. You are scanning the JD and extracting what is literally written there.

Forbidden behavior (examples of hallucination):
- Including "design tokens" because it's a common design concept, when the JD never mentions tokens → WRONG
- Including "Figma" because it's a standard tool, when the JD never mentions Figma → WRONG
- Including "B2B SaaS" because the company is a SaaS, when the JD text never uses those words → WRONG (unless you can infer it from a verbatim product description)
- Including "journey mapping", "personas", "competitive analysis", etc. from a checklist when none appear in the JD → WRONG

If you cannot find a word/phrase in the JD by ctrl-F, DO NOT return it.

## Step 1 — Scan the JD for keywords

Read the JD paragraph by paragraph and extract every meaningful noun phrase, tool name, channel, requirement, culture signal, and role descriptor that actually appears. Use these category HINTS to remind yourself what KINDS of things to look for — these are NOT checklists to copy from:

- **Domain / product**: industry terms, product type, company-specific vocab (copy verbatim phrases like "conversational AI platform", "digital therapy experiences", "rehabilitation care")
- **Channels**: voice, chat, email, SMS, web, mobile, etc. — only if mentioned
- **AI / emerging tech**: LLM, agents, conversational UI, etc. — only if mentioned
- **Design competencies**: product design, UX, interaction design, prototyping, design systems, etc. — only if mentioned
- **Research / methods**: user research, A/B testing, usability, etc. — only if mentioned
- **Tools**: Figma, Cursor, Claude, etc. — only if the specific tool is named
- **Culture / velocity**: fast-paced, ownership, remote, in-office, high-growth, etc. — only if mentioned
- **Explicit requirements**: years of experience ("4+ years"), portfolio, language requirements (e.g. "C1 English", "B2 German"), degree, etc.

Prefer verbatim phrases over canonical rewrites. If the JD says "digital therapy experiences", return that phrase, not "healthtech UX".

## Step 2 — Classify each extracted keyword

For each keyword you found in Step 1, put it into exactly one of:
- **"matched"**: keyword is in the JD AND semantically present in the candidate's resume keywords. Synonyms count:
  - "UI/UX" ↔ "UX design" = MATCHED
  - "cross-team collaboration" ↔ "cross-functional collaboration" = MATCHED
- **"missing"**: keyword is in the JD but NOT in the resume

## Hard Rules
- **Every keyword MUST come from the JD text.** This overrides any category or example list above.
- Target: 25-60 total keywords — but **quality over quantity**. A short, thin JD legitimately produces fewer keywords. A rich JD should produce 40+.
- Lowercase, 1-5 words each, deduplicated
- Include requirement phrases atomically: "4+ years", "strong portfolio", "C1 English", "B2 German", "remote-first"

## DO NOT extract
- Generic filler: "team", "work", "role", "opportunity", "responsibilities"
- Salary/benefits, legal/EEO boilerplate, location names (but DO extract language skill requirements)
- Any keyword that is not literally in the JD

Resume keywords: {RESUME_KEYWORDS}

Job description:
{JOB_DESCRIPTION}

## Step 3 — Score role_fit (0-100) for this SPECIFIC candidate
- B2B Product Designer (mid-level, 3-5 years), ex-Salesforce
- Strengths: enterprise SaaS, design systems, interaction design, AI/emerging tech, prototyping with code
- Target: Product Designer, UX Designer at B2B/enterprise/SaaS companies
- NOT targeting: management/lead, visual-only, service design, content design, engineering, research-only

### Method — compute additively, don't cluster

Start at 50. Adjust with the deltas below based on CONCRETE evidence literally present in the JD.
Final score must be a specific number — avoid round LLM-cluster numbers (80, 82, 85). If your math lands on one of those, shift ±1-3 based on the single strongest signal that tipped the score.

ROLE TYPE (largest lever — pick exactly one)
  +28 core "Product Designer" / "UX Designer" / "Interaction Designer" at B2B/enterprise/SaaS
  +20 core design role at consumer SaaS / productivity / developer platform
  +12 core design role at consumer/creator/entertainment / B2C company
  +6  design-adjacent role (design technologist, UX engineer, UI engineer) at decent company
  -15 content designer / service designer / UX researcher (research-only)
  -20 intern / junior / associate / new-grad-only posting
  -25 lead / principal / staff / director / manager / head-of (management)
  -40 primarily graphic / brand / print / motion / packaging / interior / game / industrial

DOMAIN / COMPANY FIT (add only if literally supported by the JD)
  +10 B2B SaaS with enterprise customers (CRM, ERP, analytics, dev tools, API-first, internal tools)
  +5  design-forward consumer tech (Stripe, Linear, Figma, Descript, Vercel, Notion tier)
  -5  unclear / generic / copy-paste boilerplate JD
  -10 requires deep domain expertise candidate lacks (medical, legal, defense, gaming)

AI / EMERGING TECH (count CONCRETE evidence, not buzzwords)
  +12 AI is the core product (agentic AI platform, conversational AI, AI copilot product)
  +6  JD names LLM / RAG / prompt engineering / multi-agent as design surfaces
  +3  vague "AI-powered features" mention
   0  no AI signal in JD

CRAFT SIGNALS (each requires a verbatim mention)
  +5 design systems / component library as core responsibility
  +4 0-to-1 / greenfield / founding product work
  +4 prototyping with code / Framer / Cursor / React named as tools
  +2 "high-fidelity" / "pixel-perfect" / "craft-driven"

MISFIT PENALTIES
  -10 requires 7+ years AND Lead/Staff/Principal
  -8  requires skill candidate lacks (C1 Mandarin, Spanish, specific clearance/certification)
  -5  5-day in-office requirement in a non-target city

Sum all applicable deltas. Clamp final score to [5, 95].

### Sanity bands (what each range looks like)
- 85-94: B2B Product Designer at AI-first company with strong craft signals. Rare.
- 70-84: Strong Product/UX Designer at B2B/SaaS, partial craft or AI signals.
- 55-69: Adjacent role or partial domain fit with mismatches.
- 40-54: Design-adjacent (design engineer, content, research) or heavily consumer.
- 20-39: Graphic/brand, PM, weak fit.
- 5-19: Engineering, management, or unrelated field.

Respond with ONLY valid JSON, no markdown fences:
{"matched": ["keyword1", "keyword2"], "missing": ["keyword3", "keyword4"], "role_fit": 83}`

/**
 * Strip HTML tags, inline styles, and entities from a job description so the
 * LLM sees actual text, not bloated CSS. Critical for JDs posted via Ashby/
 * Greenhouse where a 34k-char payload can be 90% inline style attributes.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildPrompt(jobDescription: string, resumeKeywords: string[]): string {
  const cleaned = stripHtml(jobDescription)
  return PROMPT
    .replace('{RESUME_KEYWORDS}', resumeKeywords.join(', '))
    .replace('{JOB_DESCRIPTION}', cleaned.slice(0, 12000))
}

function parseResponse(text: string): LLMKeywordResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed.matched) || !Array.isArray(parsed.missing)) return null

    const matched = [...new Set<string>(parsed.matched.map((k: string) => k.trim().toLowerCase()).filter(Boolean))]
    const matchedSet = new Set(matched)
    const missing = [...new Set<string>(parsed.missing.map((k: string) => k.trim().toLowerCase()).filter(Boolean))]
      .filter(k => !matchedSet.has(k))
    const role_fit = typeof parsed.role_fit === 'number' ? Math.max(0, Math.min(100, parsed.role_fit)) : 50

    return { matched, missing, role_fit }
  } catch {
    return null
  }
}

/**
 * Check if a keyword actually appears in the text (exact or close variant).
 */
function keywordExistsInText(keyword: string, textLower: string): boolean {
  const words = keyword.split(/\s+/)
  if (words.length === 1) {
    return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(textLower)
  }
  // Multi-word: check if all words appear in the text
  return words.every(w => textLower.includes(w))
}

/**
 * Post-process LLM keyword extraction into the final matched/missing lists.
 *
 * Does TWO things (neither is pure "validation" — hence the rename from
 * `validateKeywords`):
 *   1. Drops hallucinations — a keyword must actually appear in the JD text
 *   2. Re-classifies matched↔missing based on exact presence in the resume
 *      set. Example: LLM returns "wireframes" in "matched" but the resume
 *      only has "wireframing" — we demote to "missing" rather than drop,
 *      preserving the legitimate JD signal.
 */
export function classifyLLMKeywords(
  result: LLMKeywordResult,
  jobDescription: string,
  resumeKeywords: string[]
): LLMKeywordResult {
  const jdLower = jobDescription.toLowerCase()
  const resumeSet = new Set(resumeKeywords.map(k => k.toLowerCase()))

  // Union matched + missing, dedupe, keep only those that actually appear in the JD
  const allCandidates = [...new Set([...result.matched, ...result.missing])]
  const presentInJD = allCandidates.filter(k => keywordExistsInText(k, jdLower))

  // Classify by exact presence in resume keyword set
  const validMatched = presentInJD.filter(k => resumeSet.has(k))
  const validMissing = presentInJD.filter(k => !resumeSet.has(k))

  return { matched: validMatched, missing: validMissing, role_fit: result.role_fit }
}

/**
 * Backwards-compat alias. Prefer `classifyLLMKeywords`.
 * @deprecated — use classifyLLMKeywords instead
 */
export const validateKeywords = classifyLLMKeywords

/**
 * Apply deterministic title-based role_fit ceilings that the LLM prompt
 * doesn't reliably enforce. This is the post-processing safety net for
 * categories where Haiku ignores the prompt's HARD CEILING rules.
 *
 * Background: the prompt states "Title contains 'design engineer' → score
 * ≤ 35" but Haiku returns 72-87 anyway (it applies B2B/design-systems floors
 * on top). Rather than keep iterating on prompt wording, we clamp here.
 *
 * Lesson: when an LLM prompt rule doesn't fire reliably, move it to
 * post-processing code. Deterministic, testable, free.
 */
export function applyTitleCeilings(title: string, result: LLMKeywordResult): LLMKeywordResult {
  const t = (title || '').toLowerCase()
  let cap = 100

  // Pure engineering roles (non-design)
  if (/\b(software engineer|backend engineer|frontend engineer|full[- ]?stack engineer|data engineer|ml engineer|machine learning engineer)\b/.test(t)) {
    cap = Math.min(cap, 15)
  }
  // Hybrid design-eng roles — NOT core product design
  if (/\b(design engineer|product design engineer|ux engineer|ui engineer)\b/.test(t)) {
    cap = Math.min(cap, 35)
  }
  // Junior / learning roles
  if (/\b(intern|internship|student|apprentice|trainee)\b/.test(t)) {
    cap = Math.min(cap, 45)
  }
  // Other non-design roles — analyst, scientist, coordinator, etc.
  if (/\b(analyst|data scientist|research scientist|coordinator|therapist|fellowship)\b/.test(t)) {
    cap = Math.min(cap, 15)
  }
  // Associate Product Manager / Product Manager (not a designer)
  if (/\bassociate product manager\b|\bproduct manager\b/.test(t) && !/\bdesign/.test(t)) {
    cap = Math.min(cap, 20)
  }

  if (result.role_fit <= cap) return result
  return { ...result, role_fit: cap }
}

/**
 * Extract keywords using Gemini Flash via fetch.
 */
async function callGemini(prompt: string, apiKey: string, maxTokens = 1500): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(20_000),
    }
  )
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

/**
 * Extract keywords using Claude Haiku via the Anthropic Messages API.
 */
async function callClaudeHaiku(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

/**
 * Extract keywords from a resume using Claude Opus.
 * Returns a flat array of lowercase keyword strings, or null on failure.
 */
export async function extractResumeKeywordsWithLLM(
  resumeText: string,
  geminiKey: string,
): Promise<string[] | null> {
  if (!resumeText || resumeText.length < 100) return null

  const prompt = `You are an AI recruiting agent that screens candidates using a structured rubric. Analyze this resume as if you are evaluating a candidate for B2B Product Designer / UX Designer roles.

## Rubric — extract keywords under each category

### 1. Domain & Industry Signals (highest weight)
Extract keywords showing experience in specific industries or business domains.
Look for: B2B, SaaS, enterprise, fintech, marketplace, CRM, dashboard, analytics, workflow automation, developer tools, platform, API, data visualization, internal tools, complex systems, multi-product.
Also infer domains from company context (e.g. worked at Salesforce → "CRM", "enterprise", "B2B SaaS").

### 2. AI & Emerging Technology
Extract keywords showing AI/ML, LLM, generative AI, agentic, conversational UI, prompt engineering, RAG, copilot, human-in-the-loop, AI-powered product design.
Infer from project context (e.g. "designed an AI assistant" → "conversational UI", "AI-powered").

### 3. Core Design Competencies
Extract: product design, UX design, interaction design, visual design, design systems, prototyping, wireframing, information architecture, responsive design, accessibility, WCAG, mobile design, design critique, craft.
Infer depth from descriptions (e.g. "led redesign of component library" → "design systems", "component library").

### 4. Research & Methods
Extract: user research, usability testing, A/B testing, design thinking, user interviews, surveys, journey mapping, personas, competitive analysis, data-driven design, design sprint, rapid prototyping, heuristic evaluation.

### 5. Soft Skills & Leadership Signals
Extract from context, not just buzzwords: cross-functional collaboration, stakeholder management, mentorship, presenting to executives, ambiguity, strategic thinking, storytelling.
Look for evidence: "partnered with engineering and PM" → "cross-functional collaboration".

### 6. Tools & Technologies
Extract explicit tool mentions: Figma, Sketch, Framer, Adobe Creative Cloud, Miro, FigJam, HTML, CSS, React, Git, GitHub, Jira, Notion, Maze, UserTesting, Hotjar, Mixpanel, Amplitude, Looker, Tableau.

## Rules
- Extract both EXPLICIT keywords (directly stated) and INFERRED keywords (derived from context, responsibilities, and company background)
- Lowercase all keywords
- 50-100 keywords total across all categories
- Do NOT include company names, dates, degree names, or people names
- Return ONLY a flat JSON array of strings, no grouping, no other text

Resume:
${resumeText.slice(0, 8000)}`

  try {
    const text = await callGemini(prompt, geminiKey, 2000)
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return null
    const keywords: unknown = JSON.parse(match[0])
    if (!Array.isArray(keywords)) return null
    return keywords.filter((k): k is string => typeof k === 'string').map(k => k.toLowerCase().trim()).filter(Boolean)
  } catch (err) {
    console.error('Gemini resume extraction failed:', (err as Error).message)
    return null
  }
}

/**
 * Extract keywords from a job description using Claude Haiku.
 * Returns null if no API key, JD too short, or extraction failed.
 */
export async function extractKeywordsLLM(
  jobDescription: string,
  resumeKeywords: string[],
  anthropicKey?: string,
): Promise<LLMKeywordResult | null> {
  if (!jobDescription || jobDescription.length < 200) return null
  if (!anthropicKey) return null

  const prompt = buildPrompt(jobDescription, resumeKeywords)

  try {
    const text = await callClaudeHaiku(prompt, anthropicKey)
    const result = parseResponse(text)
    if (result && (result.matched.length + result.missing.length) > 0) return result
  } catch (err) {
    console.error('Claude Haiku keyword extraction failed:', (err as Error).message)
  }

  return null
}
