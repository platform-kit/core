#!/usr/bin/env node
/*
 * The shipped subscriptions, made real: webhooks.json into the four subscription tables, with the
 * secrets read from the environment at the moment of the deploy and never from a file.
 *
 * It is a projection and behaves like one: a row a file owns is replaced, a row a file no longer
 * names is removed, and a row somebody made through the API (`source: 'hand'`) is never touched.
 * With no service key, or nothing declared, it says so and does nothing.
 *
 *   node build/webhooks-push.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { KINDS } from './webhooks-config.mjs'

const ROOT = process.cwd()
const FILE = join(ROOT, 'supabase/functions/_shared/webhooks.json')

/* `file`: the declaration to push — the site's, which its functions serve; a test gives its own */
export async function pushWebhooks({ file = FILE } = {}) {
  if (!existsSync(file)) { console.log('webhooks: nothing declared'); return { pushed: 0 } }
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.log('webhooks: no service key — the shipped subscriptions are not pushed'); return { pushed: 0 } }
  const db = createClient(url, key, { auth: { persistSession: false } })

  let pushed = 0, dropped = 0
  for (const [kind, K] of Object.entries(KINDS)) {
    const mine = rows.filter((r) => r.kind === kind)
    const { data: had } = await db.from(K.table).select('id, ' + K.url).eq('source', 'file')
    const seen = new Set()
    for (const r of mine) {
      const row = { [K.url]: r.url, source: 'file' }
      for (const k of K.fields) row[k] = r[k]
      if (K.list) row[K.list] = r[K.list] || []
      if (r.secret_env && K.secret) {
        const secret = process.env[r.secret_env]
        if (!secret) console.warn(`webhooks: ${kind} → ${r.url} names ${r.secret_env}, which is not set; left without a secret`)
        else row[K.secret] = secret
      }
      /* updated where it is already there, so what it has done (last_at, last_error) survives a deploy */
      const there = (had || []).find((h) => h[K.url] === r.url)
      const { error } = there
        ? await db.from(K.table).update(row).eq('id', there.id)
        : await db.from(K.table).insert(row)
      if (error) throw new Error(`${K.table}: ${error.message}`)
      if (there) seen.add(there.id)
      pushed += 1
    }
    /* what the file no longer names — and nothing anybody made by hand, which is never source: file */
    for (const h of had || []) {
      if (seen.has(h.id)) continue
      await db.from(K.table).delete().eq('id', h.id)
      dropped += 1
    }
  }
  console.log(`webhooks: ${pushed} shipped subscription(s) in place${dropped ? `, ${dropped} no longer declared removed` : ''}`)
  return { pushed, dropped }
}


if (import.meta.url === `file://${process.argv[1]}`) await pushWebhooks()
