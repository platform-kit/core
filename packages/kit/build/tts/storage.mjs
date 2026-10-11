/*
 * The Supabase project the spoken books and the weights are written to, and
 * the key that may write there — resolved once, for build/tts.mjs (the audio
 * bucket) and build/tts/setup.mjs --mirror (the models bucket) alike. Read
 * lazily, after the repository's .env has been loaded (here, if no one has),
 * because an import is evaluated before the importer's own top level runs.
 *
 * The local stack signs every key with the CLI's fixed demo secret, so its
 * service role key is the same on every machine and public by design; against
 * the local URL it is the default, and only a real remote needs one set.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()   /* the site: its .env */
let loaded = false
export function loadDotEnv() {
  if (loaded) return
  loaded = true
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (!m || process.env[m[1]]) continue
      /* a quoted value as written; a bare one up to a trailing comment */
      const q = /^(["'])(.*?)\1/.exec(m[2])
      process.env[m[1]] = q ? q[2] : m[2].replace(/\s+#.*$/, '')
    }
  } catch { /* no .env */ }
}

const LOCAL_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
/* THE STACK THIS RUN MEANS. `SUPABASE_URL` first, then the Vite name — and `loadDotEnv` must
   never overwrite either, because in a checkout holding several sites the shared `.env` names
   one of them and the run names the right one. */
export function supabaseUrl() { loadDotEnv(); return (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '') }
export function isLocalSupabaseUrl(url) { return /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/.test(String(url || '').replace(/\/+$/, '')) }
export function localStack() { return isLocalSupabaseUrl(supabaseUrl()) }
export function serviceKey() { loadDotEnv(); return process.env.SUPABASE_SERVICE_ROLE_KEY || (localStack() ? LOCAL_SERVICE_KEY : '') }

let client = null
/* a storage client for one bucket, or a clear reason there is none */
export async function bucket(name) {
  const url = supabaseUrl(), key = serviceKey()
  if (!url) throw new Error('no Supabase url: set VITE_SUPABASE_URL')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is unset and ' + url + ' is not the local stack: set the project\'s service role key')
  if (!client) { const { createClient } = await import('@supabase/supabase-js'); client = createClient(url, key, { auth: { persistSession: false } }) }
  return client.storage.from(name)
}
/* every object name under a prefix (the API pages at a thousand) */
export async function listAll(st, prefix) {
  const names = new Set()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await st.list(prefix, { limit: 1000, offset })
    if (error) throw new Error('storage list ' + prefix + ': ' + error.message)
    for (const f of data || []) names.add(f.name)
    if (!data || data.length < 1000) break
  }
  return names
}
