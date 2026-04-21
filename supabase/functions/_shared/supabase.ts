// Service-role Supabase client factory for Edge Functions.
// Service role has full write access — never expose this client outside the function runtime.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.43.0'

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in Edge Function env')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Verify that the request includes a service-role bearer token.
 * Edge Functions are public by default; this enforces caller auth so only the
 * web app's server-side routes (and pg_cron via the call_edge SQL helper) can fire them.
 *
 * Accepts the Bearer against either SERVICE_AUTH_TOKEN (preferred — settable via
 * `supabase secrets set`) or the auto-injected SUPABASE_SERVICE_ROLE_KEY. The
 * dual-source check lets us rotate the caller token without Dashboard access
 * while pg_cron/Vault still uses the legacy JWT.
 */
export function requireServiceAuth(req: Request): Response | null {
  const auth = req.headers.get('Authorization') ?? ''
  const tokens = [
    Deno.env.get('SERVICE_AUTH_TOKEN'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  ].filter((t): t is string => !!t)
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: 'server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!tokens.some(t => auth === `Bearer ${t}`)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
