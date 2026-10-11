/*
 * The one Supabase client. Reads the public URL + anon key that Vite inlines from
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — in dev these point at the local
 * stack (`supabase start`), in a production build at the real project. The anon
 * key is public by design; every privilege boundary is enforced by RLS and the
 * service role on the server, never by this client.
 *
 * `configured` is false when the env is absent (e.g. a build with no backend),
 * so callers can degrade to the anonymous, local-only app instead of throwing.
 */
import { createClient } from '@supabase/supabase-js'

export const url = import.meta.env.VITE_SUPABASE_URL || ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const configured = Boolean(url && key)

export const supabase = configured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

/* The functions on the site's own domain. VITE_PUBLIC_FUNCTIONS_URL (https://example.com/v1,
   which the host rewrites to the project's functions/v1) makes every function call go there —
   same origin, so no CORS preflight either — instead of the supabase.co address; off by default,
   since only production has the rewrite. supabase-js builds its functions client from a field
   it sets once at construction; this points that field elsewhere. The functions themselves are
   told the same address as PUBLIC_FUNCTIONS_URL, for the links they write into emails. */
export const publicFunctionsUrl = (import.meta.env.VITE_PUBLIC_FUNCTIONS_URL || '').replace(/\/+$/, '')
if (supabase && publicFunctionsUrl) supabase.functionsUrl = new URL(publicFunctionsUrl)

/*
 * WHERE THE FUNCTIONS ARE, for the few callers that cannot use `supabase.functions.invoke`.
 *
 * `invoke` is the right way to call one and almost everything does. It cannot be used when the
 * answer is a STREAM that must be read as it arrives — it resolves the whole body — so the voice
 * reads its audio from here instead. Written once, because deriving it at a call site is how one
 * of them ends up relative and silently hits the dev server instead (a 404 that looks like a
 * missing bot rather than a missing host, which cost an hour).
 */
export const functionsBase = () =>
  publicFunctionsUrl || `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1`
