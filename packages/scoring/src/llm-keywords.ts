// LLM-powered keyword extraction — Gemini 2.5 Flash (primary) + Claude Haiku (fallback)
// Designed to match enterprise ATS extraction quality (Workday, Greenhouse, Ashby, Indeed, Glassdoor)
import { GoogleGenerativeAI } from '@google/generative-ai'

export interface LLMKeywordResult {
  matched: string[]
  missing: string[]
  role_fit: number  // 0-100 LLM-assessed fit score
}

const PROMPT = `You are an enterprise-grade ATS (Applicant Tracking System) keyword extraction engine, matching the accuracy of Workday, Greenhouse, Ashby, Glassdoor, and Indeed's keyword scanners.

Your task: Extract ALL job-relevant keywords from a job description and classify them against a candidate's resume.

## Extraction Rules

### MUST extract (these categories are what real ATS systems scan for):

**Hard Skills & Disciplines:**
- Design disciplines: product design, UX design, UI design, interaction design, visual design, service design, content design, motion design, brand design
- Technical skills: HTML, CSS, JavaScript, React, Swift, frontend development, design-to-code
- Specializations: design systems, information architecture, responsive design, accessibility, WCAG, localization, internationalization

**Tools & Platforms:**
- Design: Figma, Sketch, Adobe XD, Framer, InVision, Principle, ProtoPie, Axure, Webflow, Storybook
- Research: Maze, UserTesting, Hotjar, FullStory, Amplitude, Mixpanel, Dovetail, Qualtrics, Lookback
- Collaboration: Miro, Mural, FigJam, Notion, Confluence, Jira, Asana, Linear, Slack
- Code: Git, GitHub, VS Code, Cursor, Claude Code

**Methodologies & Processes:**
- Research: user research, usability testing, A/B testing, heuristic evaluation, competitive analysis, card sorting, journey mapping, persona development, user interviews
- Design: design thinking, lean UX, design sprints, double diamond, jobs to be done, rapid prototyping
- Agile: Agile, Scrum, Kanban, sprint planning, OKRs, KPIs
- Operations: DesignOps, ResearchOps, design critique, design review, design handoff

**Soft Skills & Leadership:**
- Collaboration: cross-functional, stakeholder management, storytelling, presentation skills, facilitation, mentorship, coaching
- Mindset: ambiguity, problem solving, strategic thinking, systems thinking, growth mindset, curiosity, proactive, self-starter, adaptability
- Communication: written communication, verbal communication, design rationale, feedback

**Domain & Business:**
- Industry: B2B, B2C, SaaS, enterprise, fintech, healthtech, ecommerce, marketplace, media
- Product: onboarding, retention, conversion, growth, engagement, analytics, dashboard, data visualization, API, CRM, CMS
- Business: business impact, business outcomes, revenue, ROI, product strategy, go-to-market

**Deliverables & Artifacts:**
- wireframes, prototypes, mockups, user flows, sitemaps, storyboards, design specs, style guides, component libraries, design tokens

### Classification Rules:
- **"matched"**: Keyword appears in BOTH the JD AND the candidate's resume. Use SEMANTIC matching — synonyms count:
  - "user-centered design" in JD ↔ "user-centered" in resume = MATCHED
  - "UI/UX" in JD ↔ "UX design" in resume = MATCHED
  - "cross-team collaboration" in JD ↔ "cross-functional" in resume = MATCHED
  - "rapid iteration" in JD ↔ "prototyping" in resume = MATCHED
  - "data-driven decisions" in JD ↔ "data-informed" in resume = MATCHED
- **"missing"**: Keyword appears in the JD but NOT in the resume (even accounting for synonyms)

### DO NOT extract:
- Generic filler: "team", "work", "experience", "role", "position", "company", "candidate", "opportunity", "responsibilities"
- Salary/benefits text
- Legal/compliance boilerplate (EEO, accommodation notices)
- Location names (unless they're a skill like "remote collaboration")
- CRITICAL: Only extract keywords that are ACTUALLY PRESENT in the job description text
- If a resume keyword does NOT appear in the JD, do NOT include it anywhere
- The "missing" list should contain ALL skills/tools/qualifications the JD asks for that are NOT in the resume — be EXHAUSTIVE with missing keywords
- Include role-specific requirements that signal fit/misfit: years of experience level, management duties, specific technical skills, domain expertise
- Aim for 30-60 total keywords. Be thorough — extract every meaningful skill, tool, and qualification mentioned

### Scoring guidance:
- Weight DOMAIN-SPECIFIC and SPECIALIZED keywords more heavily than generic ones
- Generic design skills (e.g., "wireframes", "prototyping", "cross-functional") appear in almost every design JD — these should still be extracted but they're less differentiating
- DOMAIN keywords matter more: B2B, enterprise, SaaS, fintech, AI, design systems, etc.
- TOOL-SPECIFIC matches matter: Figma, specific frameworks, specific methodologies
- If a JD is for a role outside core product/UX design (e.g., graphic designer, design engineer, head of design), extract ALL keywords including ones that signal the role is NOT a fit (e.g., "illustration", "print design", "people management", "engineering", "coding")

### Format:
- Keep keywords concise: 1-3 words each
- Use lowercase for consistency
- Deduplicate — no repeats
- Be thorough with "missing" keywords — extract ALL skills the JD asks for that aren't in the resume

Resume keywords: {RESUME_KEYWORDS}

Job description:
{JOB_DESCRIPTION}

Also provide a role_fit score from 0-100 representing how well this job matches this SPECIFIC candidate profile:
- Ex-Salesforce B2B Product Designer (mid-level, 3-5 years)
- Core strengths: enterprise SaaS, design systems, interaction design, AI/emerging tech, prototyping with code
- Target roles: Product Designer, UX Designer at B2B/enterprise/SaaS companies
- NOT targeting: management/lead roles, visual-only roles, service design, content design, engineering, research-only

Scoring rubric (be STRICT — most jobs should score 40-70, not 80+):
- 90-100: Perfect match — B2B/enterprise Product Designer with AI + design systems focus. VERY rare.
- 75-89: Strong match — Product/UX Designer at B2B/SaaS company with meaningful domain overlap
- 60-74: Good match — Product/UX design role, some domain overlap but not core B2B/enterprise
- 45-59: Partial match — related role but different specialty or level mismatch (lead/senior+, junior, visual-only, service design)
- 30-44: Weak match — adjacent role with some transferable skills (design engineer, content designer, UX researcher, design coordinator)
- 15-29: Poor match — mostly unrelated (graphic designer, product manager, software engineer, data analyst)
- 0-14: No match — completely different field (therapist, specialist, inspector, fellowship)

HARD RULES — override the base score:
- If the job title contains "engineer", "developer", "analyst", "scientist", "manager" (non-design), "coordinator", "specialist", "therapist", "inspector", "packer", "receptionist", "admin", "aide", "leader" (shift leader), "scrum master", "fellowship": score ≤ 15
- If the job is primarily graphic/brand/print design with no UX/product work: score ≤ 30
- If the job is primarily service design, content design, or UX research only: score ≤ 45
- If the job requires 7+ years AND lead/principal/staff level: score ≤ 55
- If the job is at a B2B/enterprise/SaaS company AND is a core Product/UX Designer role: score ≥ 70
- If the job mentions design systems, AI/ML, complex workflows, OR is at a top-tier tech company (Salesforce, Google, Meta, Amazon, Microsoft, Apple, Figma, etc.): boost +5-10

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
      .filter(k => !matchedSet.has(k))
    const role_fit = typeof parsed.role_fit === 'number' ? Math.max(0, Math.min(100, parsed.role_fit)) : 50

    return { matched, missing, role_fit }
  } catch {
    return null
  }
}

/**
 * Post-process LLM results: remove hallucinated keywords from "missing"
 * that exist in the resume but NOT in the JD text.
 */
export function validateKeywords(
  result: LLMKeywordResult,
  jobDescription: string,
  resumeKeywords: string[]
): LLMKeywordResult {
  const jdLower = jobDescription.toLowerCase()
  const resumeSet = new Set(resumeKeywords.map(k => k.toLowerCase()))

  // Filter missing: only keep keywords that actually appear in the JD
  const validMissing = result.missing.filter(k => {
    // If this keyword is in the resume but NOT in the JD, it's hallucinated
    if (resumeSet.has(k) && !jdLower.includes(k)) return false
    // Verify keyword (or close variant) appears somewhere in the JD
    const words = k.split(/\s+/)
    if (words.length === 1) {
      // Single word: check with word boundary
      return new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(jdLower)
    }
    // Multi-word: check if all words appear near each other in the JD
    return words.every(w => jdLower.includes(w))
  })

  return { matched: result.matched, missing: validMissing, role_fit: result.role_fit }
}

/**
 * Extract keywords using Gemini 2.5 Flash (fast, cheap, accurate).
 */
async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.1,  // Low temp for consistent extraction
      maxOutputTokens: 1500,
    },
  })
  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini timeout (15s)')), 15_000)),
  ])
  return result.response.text()
}

/**
 * Extract keywords using Claude Haiku (fallback).
 */
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
 * Extract keywords from a job description using LLM.
 * Tries Gemini Flash first (fast + cheap), falls back to Claude Haiku, returns null on total failure.
 */
export async function extractKeywordsWithGemini(
  jobDescription: string,
  resumeKeywords: string[],
  geminiKey?: string,
  anthropicKey?: string,
): Promise<LLMKeywordResult | null> {
  if (!jobDescription || jobDescription.length < 50) return null

  const prompt = buildPrompt(jobDescription, resumeKeywords)

  // Try Gemini Flash first (faster than Pro, still accurate for extraction)
  if (geminiKey) {
    try {
      const text = await callGemini(prompt, geminiKey)
      const result = parseResponse(text)
      if (result && (result.matched.length + result.missing.length) > 0) return result
    } catch (err) {
      console.error('Gemini failed, trying Claude fallback:', (err as Error).message)
    }
  }

  // Fallback to Claude Haiku
  if (anthropicKey) {
    try {
      const text = await callClaude(prompt, anthropicKey)
      const result = parseResponse(text)
      if (result && (result.matched.length + result.missing.length) > 0) return result
    } catch (err) {
      console.error('Claude Haiku fallback also failed:', (err as Error).message)
    }
  }

  return null
}
