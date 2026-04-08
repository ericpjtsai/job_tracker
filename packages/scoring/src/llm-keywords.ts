// LLM-powered keyword extraction — Gemini Flash via fetch (Deno-compatible).
// Gemini REST API is fetch-based and works in both Node and Deno without any SDK.
// Designed to match enterprise ATS extraction quality (Workday, Greenhouse, Ashby, Indeed, Glassdoor)

export interface LLMKeywordResult {
  matched: string[]
  missing: string[]
  role_fit: number  // 0-100 LLM-assessed fit score
}

const PROMPT = `You are an AI recruiting agent screening a job description against a candidate's resume. Your job is EXHAUSTIVE keyword extraction followed by classification. You will be graded on thoroughness — returning fewer than 40 keywords is a failure.

## Step 1 — Extract (target 40-70 keywords, MINIMUM 40)

Read the JD line-by-line and extract EVERY meaningful keyword. Include verbatim phrases from the JD, not just canonical terms. Use these categories as extraction hints (the output is flat, not grouped):

### Domain, Industry & Product
B2B, SaaS, enterprise, fintech, healthtech, ecommerce, marketplace, CRM, dashboard, analytics, workflow automation, developer tools, platform, API, data visualization, internal tools, complex systems, multi-product.
Extract company-specific product vocab verbatim: "conversational AI platform", "AI-first products", "agent UX", "interaction patterns", "AI-native interactions".
Infer from company context (Stripe → fintech/payments; Decagon → conversational AI/AI agents; Salesforce → CRM/enterprise).

### Communication Channels & Modalities
voice, chat, email, SMS, web, mobile, desktop, in-app, notifications, multimodal, phone, messaging

### AI & Emerging Technology
AI-powered, generative AI, LLM, agentic, AI agents, conversational UI, copilot, prompt engineering, RAG, human-in-the-loop, multi-agent, machine learning, AI-native, agent-based systems, automation workflows, AI product design

### Core Design Competencies
product design, UX design, UI design, interaction design, visual design, design systems, prototyping, wireframing, information architecture, responsive design, accessibility, WCAG, mobile design, design critique, craft, component library, design tokens, high-fidelity, pixel-perfect, 0-to-1, end-to-end design, usability, visual polish, intuitive interfaces, concept to launch
Deliverables: wireframes, prototypes, mockups, user flows, design specs, style guides

### Research & Methods
user research, usability testing, A/B testing, design thinking, user interviews, journey mapping, personas, competitive analysis, data-driven design, design sprint, rapid prototyping, heuristic evaluation, lean UX, jobs to be done, live feedback loops, Agile, Scrum, OKRs, DesignOps

### Tools & Technologies
Figma, Sketch, Framer, Adobe Creative Cloud, Miro, FigJam, HTML, CSS, React, JavaScript, Git, GitHub, Jira, Notion, Cursor, Claude, Claude Code, Maze, UserTesting, Hotjar, Amplitude, Mixpanel. Include any AI tool or framework mentioned by name.

### Collaboration, Culture & Velocity Signals
cross-functional, stakeholder management, mentorship, storytelling, presenting to executives, ambiguity, ambiguous environments, strategic thinking, systems thinking, facilitation, coaching.
Velocity/culture signals (extract verbatim when present): fast-paced, high-ownership, ownership mindset, ship quickly, iterate often, in-office, hybrid, remote, velocity, high-visibility, just get it done, polymath, high-growth, startup.
Misfit/seniority signals: people management, team lead, managing designers, hiring, principal, staff, director.

### Explicit Requirements (extract atomically, one keyword each)
Years of experience: "4+ years", "5+ years", "7+ years" — extract the exact phrase.
Portfolio: "portfolio", "case studies", "strong portfolio".
Role-type: "designer who codes", "prototyping with code", "builder mindset".
Any specific framework, language, platform, or certification mentioned.

## Step 2 — Classify every extracted keyword

For EACH keyword you extracted in Step 1, put it into exactly one of:
- **"matched"**: keyword is in BOTH the JD AND the candidate's resume keywords. Use SEMANTIC matching — synonyms count:
  - "user-centered design" ↔ "user-centered" = MATCHED
  - "UI/UX" ↔ "UX design" = MATCHED
  - "cross-team collaboration" ↔ "cross-functional collaboration" = MATCHED
  - "data-driven decisions" ↔ "data-driven design" = MATCHED
- **"missing"**: keyword is in the JD but NOT in the resume (even accounting for synonyms)

Every extracted keyword MUST end up in one of the two lists. Do not drop keywords because you're unsure.

## Hard Rules
- **MINIMUM 40 keywords total (matched + missing combined). Target 40-70. Fewer than 40 = failure — re-scan the JD for missed channels, culture signals, tools, and verbatim product phrases.**
- Only extract keywords ACTUALLY PRESENT in the JD (or directly inferable from company context)
- Lowercase, 1-4 words each, deduplicated
- Prefer verbatim JD phrases over canonical rewrites when the JD uses specific language

## DO NOT extract
- Generic filler: "team", "work", "experience" (alone), "role", "opportunity", "responsibilities"
- Salary/benefits, legal/EEO boilerplate, location names
- Resume keywords that don't appear in the JD

Resume keywords: {RESUME_KEYWORDS}

Job description:
{JOB_DESCRIPTION}

## Step 3 — Score role_fit (0-100) for this SPECIFIC candidate
- B2B Product Designer (mid-level, 3-5 years), ex-Salesforce
- Strengths: enterprise SaaS, design systems, interaction design, AI/emerging tech, prototyping with code
- Target: Product Designer, UX Designer at B2B/enterprise/SaaS companies
- NOT targeting: management/lead, visual-only, service design, content design, engineering, research-only

Scoring rubric (STRICT — most jobs should score 40-70):
- 90-100: Perfect — B2B/enterprise Product Designer + AI + design systems. VERY rare.
- 75-89: Strong — Product/UX Designer at B2B/SaaS with meaningful domain overlap
- 60-74: Good — Product/UX design role, some domain overlap
- 45-59: Partial — related but different specialty or level mismatch
- 30-44: Weak — adjacent role (design engineer, content designer, UX researcher)
- 15-29: Poor — mostly unrelated (graphic designer, PM, engineer, analyst)
- 0-14: No match — completely different field

HARD OVERRIDES (these are FLOORS/CEILINGS — apply them after your initial scoring, then use the higher/lower bound):
- Title contains "engineer"/"developer"/"analyst"/"scientist"/"manager"(non-design)/"coordinator"/"specialist"/"therapist"/"fellowship": score ≤ 15
- Primarily graphic/brand/print design, no UX/product: score ≤ 30
- Primarily service design, content design, or research-only: score ≤ 45
- Requires 7+ years AND lead/principal/staff level: score ≤ 55
- B2B/enterprise/SaaS company AND core Product/UX Designer role: score ≥ 72
- Mentions design systems AND (AI/ML OR agentic AI OR conversational UI OR AI agents): score ≥ 82
- B2B/SaaS + AI product (conversational, agentic, AI-powered, AI-native) + core Product/UX Designer role: score ≥ 88 (this is the Decagon-class profile — near-perfect fit)
- High-growth AI startup + core Product Designer role: additional +3 boost (cap at 95)

Respond with ONLY valid JSON, no markdown fences:
{"matched": ["keyword1", "keyword2"], "missing": ["keyword3", "keyword4"], "role_fit": 85}`

export function buildPrompt(jobDescription: string, resumeKeywords: string[]): string {
  return PROMPT
    .replace('{RESUME_KEYWORDS}', resumeKeywords.join(', '))
    .replace('{JOB_DESCRIPTION}', jobDescription.slice(0, 12000))
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
 * Post-process LLM results: remove hallucinated keywords from both "matched"
 * and "missing" that don't actually appear in the JD text.
 */
export function validateKeywords(
  result: LLMKeywordResult,
  jobDescription: string,
  resumeKeywords: string[]
): LLMKeywordResult {
  const jdLower = jobDescription.toLowerCase()
  const resumeSet = new Set(resumeKeywords.map(k => k.toLowerCase()))

  // Filter matched: keyword must appear in BOTH the JD and the resume
  const validMatched = result.matched.filter(k => {
    const inJD = keywordExistsInText(k, jdLower)
    const inResume = resumeSet.has(k)
    return inJD && inResume
  })

  // Filter missing: keyword must appear in the JD but NOT in the resume
  const validMissing = result.missing.filter(k => {
    if (resumeSet.has(k) && !keywordExistsInText(k, jdLower)) return false
    return keywordExistsInText(k, jdLower)
  })

  return { matched: validMatched, missing: validMissing, role_fit: result.role_fit }
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
      temperature: 0.1,
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
