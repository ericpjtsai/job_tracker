// Shared Claude Messages API client for scripts. DRY replacement for the
// duplicated callClaude + parseResponse + retry logic previously in
// benchmark-today.ts and calibrate-haiku-sonnet.ts.

import type { LLMKeywordResult } from '../../packages/scoring/src/llm-keywords'

export const HAIKU = 'claude-haiku-4-5-20251001'
export const SONNET = 'claude-sonnet-4-6'
export const OPUS = 'claude-opus-4-6'

export interface CallClaudeOptions {
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  retries?: number
}

/**
 * Call the Claude Messages API with automatic retry on 429/5xx and network
 * timeouts. Retries use 1s linear backoff (retry 1: wait 1s, retry 2: 2s).
 * Throws if all retries exhausted.
 */
export async function callClaude(
  model: string,
  prompt: string,
  apiKey: string,
  opts: CallClaudeOptions = {},
): Promise<string> {
  const { maxTokens = 2500, temperature = 0.1, timeoutMs = 60_000, retries = 2 } = opts

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      // Retry on rate-limit (429), overloaded (529), or 5xx
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        const body = await res.text()
        throw new Error(`${model} ${res.status} (retryable): ${body.slice(0, 200)}`)
      }
      if (!res.ok) {
        throw new Error(`${model} ${res.status}: ${await res.text()}`)
      }
      const data = await res.json()
      return data.content?.[0]?.text ?? ''
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      // Don't retry on non-retryable HTTP errors (4xx that aren't 429)
      if (msg.includes('(retryable)') === false && msg.match(/\b4\d\d\b/) && !msg.includes('429')) {
        throw err
      }
      if (attempt < retries) {
        const backoff = 1000 * (attempt + 1)
        console.warn(`  [retry ${attempt + 1}/${retries}] ${msg.slice(0, 100)} — waiting ${backoff}ms`)
        await new Promise(r => setTimeout(r, backoff))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * Parse a Claude response into a LLMKeywordResult. Accepts responses with
 * or without markdown code fences. Returns null on malformed output.
 */
export function parseKeywordResponse(text: string): LLMKeywordResult | null {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0])
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
