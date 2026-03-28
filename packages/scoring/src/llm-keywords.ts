// LLM-powered keyword extraction — Gemini 2.5 Pro (primary) + Claude Haiku (fallback)
import { GoogleGenerativeAI } from '@google/generative-ai'

export interface LLMKeywordResult {
  matched: string[]
  missing: string[]
}

const PROMPT = `You are an ATS keyword scanner for a Product/UX Designer job search.

Given a job description and a candidate's resume keywords, extract ALL relevant skills, tools, methods, and qualifications from the job description.

Classify each extracted keyword as:
- "matched": the skill/tool/method appears in both the JD and the candidate's resume (include synonyms — e.g., "user-centered design" in JD matches "user-centered" in resume)
- "missing": the skill/tool/method appears in the JD but NOT in the candidate's resume

Be thorough:
- Extract compound terms (e.g., "design systems", "cross-functional collaboration")
- Extract tools (e.g., "Figma", "Jira", "Miro")
- Extract methodologies (e.g., "design thinking", "A/B testing")
- Extract soft skills (e.g., "storytelling", "stakeholder management")
- Include implied skills (e.g., "ship alongside engineers" → "cross-functional")
- Do NOT extract generic words like "team", "work", "experience", "role"
- Keep keywords concise (1-3 words each)

Resume keywords: {RESUME_KEYWORDS}

Job description:
{JOB_DESCRIPTION}

Respond with ONLY valid JSON, no markdown:
{"matched": ["keyword1", "keyword2"], "missing": ["keyword3", "keyword4"]}`

function buildPrompt(jobDescription: string, resumeKeywords: string[]): string {
  return PROMPT
    .replace('{RESUME_KEYWORDS}', resumeKeywords.join(', '))
    .replace('{JOB_DESCRIPTION}', jobDescription.slice(0, 8000))
}

function parseResponse(text: string): LLMKeywordResult | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  const parsed = JSON.parse(jsonMatch[0])
  if (!Array.isArray(parsed.matched) || !Array.isArray(parsed.missing)) return null

  return {
    matched: [...new Set<string>(parsed.matched.map((k: string) => k.trim()).filter(Boolean))],
    missing: [...new Set<string>(parsed.missing.map((k: string) => k.trim()).filter(Boolean))],
  }
}

/**
 * Extract keywords using Gemini 2.5 Pro.
 */
async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' })
  const result = await model.generateContent(prompt)
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
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

/**
 * Extract keywords from a job description using LLM.
 * Tries Gemini first, falls back to Claude Haiku, returns null on total failure.
 */
export async function extractKeywordsWithGemini(
  jobDescription: string,
  resumeKeywords: string[],
  geminiKey?: string,
  anthropicKey?: string,
): Promise<LLMKeywordResult | null> {
  if (!jobDescription) return null

  const prompt = buildPrompt(jobDescription, resumeKeywords)

  // Try Gemini first
  if (geminiKey) {
    try {
      const text = await callGemini(prompt, geminiKey)
      const result = parseResponse(text)
      if (result) return result
    } catch (err) {
      console.error('Gemini failed, trying Claude fallback:', (err as Error).message)
    }
  }

  // Fallback to Claude Haiku
  if (anthropicKey) {
    try {
      const text = await callClaude(prompt, anthropicKey)
      const result = parseResponse(text)
      if (result) return result
    } catch (err) {
      console.error('Claude Haiku fallback also failed:', (err as Error).message)
    }
  }

  return null
}
