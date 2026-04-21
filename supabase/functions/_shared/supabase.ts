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
 * Each function has `verify_jwt = false` in supabase/config.toml, so the gateway
 * does NOT verify the bearer is a JWT. This check is the real authorization.
 */
export function requireServiceAuth(req: Request): Response | null {
  const auth = req.headers.get('Authorization') ?? ''
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!expected) {
    return new Response(JSON.stringify({ ok: false, error: 'server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (auth !== `Bearer ${expected}`) {
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
