// LLM-powered keyword extraction — Claude Haiku via fetch.
// VENDORED from packages/scoring/src/llm-keywords.ts (Gemini path removed).
// Claude is used because the Anthropic API is fetch-based and Deno-compatible
// without any SDK. Same prompt + validation as the Node listener.

export interface LLMKeywordResult {
  matched: string[]
  missing: string[]
  role_fit: number
}

const PROMPT = `You are an AI recruiting agent that screens job descriptions against a candidate's resume using a structured rubric. Analyze this job description and classify every requirement against the candidate's resume keywords.

## Rubric — extract keywords under each category (ordered by importance for matching)

### 1. Domain & Industry Signals (highest weight)
Extract keywords showing what industry/domain this role operates in.
Look for: B2B, SaaS, enterprise, fintech, healthtech, ecommerce, marketplace, CRM, dashboard, analytics, workflow automation, developer tools, platform, API, data visualization, internal tools, complex systems.
INFER domain from company context (e.g. Stripe → "fintech", "payments", "B2B"; Salesforce → "CRM", "enterprise", "B2B SaaS").
Also extract: onboarding, retention, conversion, growth, revenue, go-to-market, product strategy, business impact.

### 2. AI & Emerging Technology
Extract: AI-powered, generative AI, LLM, agentic, conversational UI, copilot, prompt engineering, RAG, human-in-the-loop, multi-agent, machine learning.
Infer from context (e.g. "design for our AI assistant" → "conversational UI", "AI-powered").

### 3. Core Design Competencies
Extract: product design, UX design, interaction design, visual design, design systems, prototyping, wireframing, information architecture, responsive design, accessibility, WCAG, mobile design, design critique, craft, component library, design tokens, high-fidelity, pixel-perfect, 0-to-1, end-to-end design.
Extract deliverables: wireframes, prototypes, mockups, user flows, design specs, style guides.

### 4. Research & Methods
Extract: user research, usability testing, A/B testing, design thinking, user interviews, journey mapping, personas, competitive analysis, data-driven design, design sprint, rapid prototyping, heuristic evaluation, lean UX, jobs to be done, card sorting.
Also: Agile, Scrum, OKRs, DesignOps.

### 5. Soft Skills & Leadership Signals
Extract from context: cross-functional collaboration, stakeholder management, mentorship, storytelling, presenting to executives, ambiguity, strategic thinking, systems thinking, facilitation, coaching.
Also extract misfit signals: people management, team lead, managing designers, hiring (these indicate senior/management roles).

### 6. Tools & Technologies
Extract explicit mentions: Figma, Sketch, Framer, Adobe Creative Cloud, Miro, FigJam, HTML, CSS, React, JavaScript, Git, GitHub, Jira, Notion, Cursor, Claude Code, Maze, UserTesting, Hotjar, Amplitude, Mixpanel.

## Classification Rules
- **"matched"**: Keyword in BOTH the JD AND the candidate's resume. Use SEMANTIC matching — synonyms count:
  - "user-centered design" ↔ "user-centered" = MATCHED
  - "UI/UX" ↔ "UX design" = MATCHED
  - "cross-team collaboration" ↔ "cross-functional collaboration" = MATCHED
  - "data-driven decisions" ↔ "data-driven design" = MATCHED
- **"missing"**: Keyword in the JD but NOT in the resume (even accounting for synonyms)
- Only extract keywords ACTUALLY PRESENT in the job description
- "missing" must contain ALL skills/tools/qualifications the JD asks for that aren't in the resume — be EXHAUSTIVE
- Include misfit signals: years of experience, management duties, specific technical requirements
- Aim for 30-60 total keywords. Be thorough.

## DO NOT extract
- Generic filler: "team", "work", "experience", "role", "opportunity", "responsibilities"
- Salary/benefits, legal/EEO boilerplate, location names
- Resume keywords that don't appear in the JD

## Format
- Lowercase, 1-3 words each, deduplicated

Resume keywords: {RESUME_KEYWORDS}

Job description:
{JOB_DESCRIPTION}

Also provide a role_fit score (0-100) for this SPECIFIC candidate:
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

HARD OVERRIDES:
- Title contains "engineer"/"developer"/"analyst"/"scientist"/"manager"(non-design)/"coordinator"/"specialist"/"therapist"/"fellowship": score ≤ 15
- Primarily graphic/brand/print design, no UX/product: score ≤ 30
- Primarily service design, content design, or research-only: score ≤ 45
- Requires 7+ years AND lead/principal/staff level: score ≤ 55
- B2B/enterprise/SaaS company AND core Product/UX Designer role: score ≥ 70
- Mentions design systems, AI/ML, complex workflows, agentic AI: boost +5-10

Respond with ONLY valid JSON, no markdown fences:
{"matched": ["keyword1", "keyword2"], "missing": ["keyword3", "keyword4"], "role_fit": 85}`

function buildPrompt(jobDescription: string, resumeKeywords: string[]): string {
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
      .filter((k: string) => !matchedSet.has(k))
    const role_fit = typeof parsed.role_fit === 'number' ? Math.max(0, Math.min(100, parsed.role_fit)) : 50

    return { matched, missing, role_fit }
  } catch {
    return null
  }
}

function keywordExistsInText(keyword: string, textLower: string): boolean {
  const words = keyword.split(/\s+/)
  if (words.length === 1) {
    return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(textLower)
  }
  return words.every((w) => textLower.includes(w))
}

/**
 * Filter hallucinated keywords — keep only those that actually appear in the JD
 * (and, for "matched", that also exist in the resume).
 */
export function validateKeywords(
  result: LLMKeywordResult,
  jobDescription: string,
  resumeKeywords: string[],
): LLMKeywordResult {
  const jdLower = jobDescription.toLowerCase()
  const resumeSet = new Set(resumeKeywords.map((k) => k.toLowerCase()))

  const validMatched = result.matched.filter((k) => {
    const inJD = keywordExistsInText(k, jdLower)
    const inResume = resumeSet.has(k)
    return inJD && inResume
  })

  const validMissing = result.missing.filter((k) => {
    if (resumeSet.has(k) && !keywordExistsInText(k, jdLower)) return false
    return keywordExistsInText(k, jdLower)
  })

  return { matched: validMatched, missing: validMissing, role_fit: result.role_fit }
}

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

/**
 * Extract keywords from a job description using Claude Haiku.
 * Returns null if no API key, JD too short, or extraction failed.
 */
export async function extractKeywordsLLM(
  jobDescription: string,
  resumeKeywords: string[],
): Promise<LLMKeywordResult | null> {
  if (!jobDescription || jobDescription.length < 200) return null

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return null

  const prompt = buildPrompt(jobDescription, resumeKeywords)

  try {
    const text = await callClaude(prompt, apiKey)
    const result = parseResponse(text)
    if (result && (result.matched.length + result.missing.length) > 0) return result
  } catch (err) {
    console.error('Claude Haiku extraction failed:', (err as Error).message)
  }

  return null
}
