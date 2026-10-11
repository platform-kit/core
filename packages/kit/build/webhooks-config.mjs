#!/usr/bin/env node
/*
 * The webhook subscriptions a deployment SHIPS, declared rather than clicked:
 * platformkit.config.js's `webhooks` written to supabase/functions/_shared/webhooks.json, and
 * pushed into the four subscription tables by build/webhooks-push.mjs at deploy time.
 *
 * A site that posts its form responses somewhere, or tells its own indexer when an entry is
 * published, should say so in the repository — a fresh deployment then comes up already wired,
 * which is the whole point of shipping a business as a folder. A subscription somebody makes
 * through the API is theirs (`source: 'hand'`) and the projection never touches it.
 *
 * A SECRET IS NEVER WRITTEN HERE. `secret` names an environment variable — `env:FORM_HOOK_SECRET`
 * — and a bare value is refused, so nobody can put one in the repository by accident.
 *
 *   node build/webhooks-config.mjs          # write webhooks.json
 *   node build/webhooks-config.mjs --check  # check only (platformkit test)
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { loadSite } from './site.mjs'

const ROOT = process.cwd()
const OUT = 'supabase/functions/_shared/webhooks.json'
const check = process.argv.includes('--check')

/* The four tables were written by four modules and do not agree on what a subscription looks like —
   one calls the address `subscriber_url`, two keep a secret and two do not, and each has its own
   word for what it is subscribed to. Rather than making them agree (they are each right for their
   own module), the shape each one wants is said here, once. */
export const KINDS = {
  content:    { table: 'content_webhooks',    url: 'url',           fields: ['name'],       list: 'topics',        secret: null },
  form:       { table: 'form_webhooks',       url: 'url',           fields: ['form', 'tag'], list: null,           secret: 'secret' },
  scheduling: { table: 'scheduling_webhooks', url: 'subscriber_url', fields: [],             list: 'triggers',      secret: 'secret' },
  support:    { table: 'support_webhooks',    url: 'url',           fields: [],             list: 'subscriptions', secret: null },
}
const ENV = /^env:[A-Z][A-Z0-9_]{2,63}$/

export async function webhooksConfig({ check: only = false } = {}) {
  const site = await loadSite(ROOT)
  const rows = Array.isArray(site.webhooks) ? site.webhooks : []
  const faults = []
  const out = []
  rows.forEach((w, i) => {
    const where = `webhooks[${i}]`
    const kind = String(w.kind || '')
    const K = KINDS[kind]
    if (!K) { faults.push(`${where}: kind "${kind}" is not one of ${Object.keys(KINDS).join(', ')}`); return }
    for (const k of K.fields) if (!String(w[k] || '').trim()) faults.push(`${where}: ${kind} needs ${k}`)
    const url = String(w.url || '')
    if (!url) faults.push(`${where}: ${kind} needs url`)
    else if (!/^https:\/\//.test(url)) faults.push(`${where}: url must be https`)
    if (w.secret !== undefined) {
      if (!K.secret) faults.push(`${where}: a ${kind} subscription takes no secret`)
      else if (!ENV.test(String(w.secret))) faults.push(`${where}: secret must name an environment variable (env:SOME_NAME) — a secret is never written into the repository`)
    }
    const row = { kind, url }
    for (const k of K.fields) row[k] = String(w[k] || '').trim()
    if (K.list) row[K.list] = Array.isArray(w[K.list]) ? w[K.list].map(String) : []
    if (w.secret) row.secret_env = String(w.secret).slice(4)
    out.push(row)
  })
  const seen = new Set()
  for (const r of out) {
    const key = r.kind + '|' + (r.form || '') + '|' + (r.tag || '') + '|' + r.url
    if (seen.has(key)) faults.push(`two ${r.kind} subscriptions to the same place: ${r.url}`)
    seen.add(key)
  }
  if (faults.length) { console.error('✖ webhooks:\n  ' + faults.join('\n  ')); process.exitCode = 1; return null }

  const text = JSON.stringify(out, null, 2) + '\n'
  const path = join(ROOT, OUT)
  if (only) {
    const had = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (had !== text) { console.error(`✖ webhooks: ${OUT} is not what platformkit.config.js says — run node build/webhooks-config.mjs`); process.exitCode = 1; return null }
    console.log(`✔ webhooks: ${out.length} shipped subscription(s)`)
    return out
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  console.log(`${OUT} ← ${out.length} shipped subscription(s)`)
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) await webhooksConfig({ check })
