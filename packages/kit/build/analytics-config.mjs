#!/usr/bin/env node
/*
 * The analytics config beside the functions: platformkit.config.js's `analytics.events` (a site's own events — a key,
 * a label, whether it is a goal, the property that is its value) and `analytics.sources` (the external sites that may
 * send through the drop-in script — a key, a name, the hosts allowed to send under it) written to
 * supabase/functions/_shared/analytics.json, which the ingest function reads to admit a source and the dashboard's
 * reads never see (the browser gets the events and the sources' names alone, through #site/analytics). Refuses a
 * source without a key or hosts, an event without a key, a key that is not a name, a key used twice.
 *
 *   node build/analytics-config.mjs          # write analytics.json
 *   node build/analytics-config.mjs --check  # check only (npm test)
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { loadSite } from './site.mjs'

const ROOT = process.cwd()
const OUT = 'supabase/functions/_shared/analytics.json'
const check = process.argv.includes('--check')
const NAME = /^[A-Za-z$][A-Za-z0-9_$:. -]{0,63}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function analyticsConfig(c) {
  const a = (c && c.analytics) || {}
  const errors = []
  const events = []
  for (const [i, e] of ((a.events || [])).entries()) {
    const key = String((e && e.key) || '').trim()
    if (!NAME.test(key)) { errors.push(`analytics.events[${i}]: the key "${key}" is not an event name (letters, digits, _ $ : . and spaces; 64 characters)`); continue }
    if (events.some((x) => x.key === key)) { errors.push(`analytics.events[${i}]: the key "${key}" is registered twice`); continue }
    const value = e.value == null ? null : String(e.value).trim()
    events.push({ key, label: String(e.label || key).trim(), goal: !!e.goal, value: value || null })
  }
  const sources = []
  for (const [i, s] of ((a.sources || [])).entries()) {
    const key = String((s && s.key) || '').trim(), name = String((s && s.name) || '').trim()
    if (key.length < 12) { errors.push(`analytics.sources[${i}]: the key is the secret a page sends — twelve characters at least`); continue }
    if (!SLUG.test(name)) { errors.push(`analytics.sources[${i}]: the name "${name}" is lower-case words joined by hyphens`); continue }
    if (sources.some((x) => x.key === key || x.name === name)) { errors.push(`analytics.sources[${i}]: the key or the name is used twice`); continue }
    const hosts = (Array.isArray(s.hosts) ? s.hosts : [s.hosts]).filter(Boolean).map((h) => String(h).trim().toLowerCase())
    if (!hosts.length) { errors.push(`analytics.sources[${i}]: no hosts — the origins allowed to send under this key (or "*")`); continue }
    sources.push({ key, name, hosts })
  }
  return { events, sources, errors }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = await loadSite(ROOT)
  const { events, sources, errors } = analyticsConfig(c)
  if (errors.length) { console.error('✖ analytics config:\n  ' + errors.join('\n  ')); process.exit(1) }
  const out = JSON.stringify({ events, sources }, null, 2) + '\n'
  const file = join(ROOT, OUT)
  if (check) { const cur = existsSync(file) ? readFileSync(file, 'utf8') : ''; if (cur !== out) { console.error(`✖ ${OUT} is behind the config — node build/analytics-config.mjs`); process.exit(1) } console.log(`✔ analytics config: ${events.length} event(s), ${sources.length} source(s)`); process.exit(0) }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, out)
  console.log(`${OUT} ← ${events.length} event(s), ${sources.length} source(s)`)
}
