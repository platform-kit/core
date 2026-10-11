#!/usr/bin/env node
/*
 * Give every statement of every diagnostic file its key — the trailing `{#key}`
 * its id is made from (velite.config.js): eight hex characters of a UUID, unique
 * within the topic. A line that has none gets one; with --all every line gets a
 * fresh one (which orphans every answer ever given: a new key is a new item).
 * The admin's writer does the same for new lines on save, so this is only for
 * files written by hand.
 *
 *   node build/statement-keys.mjs          # key what lacks a key
 *   node build/statement-keys.mjs --all    # rekey everything
 *   node build/statement-keys.mjs --dry    # say what would change
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const DRY = process.argv.includes('--dry'), ALL = process.argv.includes('--all')
const dir = join(process.cwd(), 'content/app/tests/diagnostics')
const LINE = /^(-\s*(?:\((?:r|b|!|d)\)\s*)*)(.+?)\s*(\{#[A-Za-z0-9._-]+\}\s*)?$/i
let total = 0
for (const name of readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'results.md')) {
  const file = join(dir, name)
  const raw = readFileSync(file, 'utf8')
  const parts = raw.split(/^---\r?\n[\s\S]*?\r?\n---\r?\n/m)   /* frontmatter off; keys live in the body */
  const fmEnd = raw.length - (parts[1] || '').length
  const head = raw.slice(0, fmEnd), body = raw.slice(fmEnd)
  const used = new Set(); if (!ALL) for (const m of body.matchAll(/\{#([A-Za-z0-9._-]+)\}/g)) used.add(m[1])
  const fresh = () => { let k; do { k = randomUUID().replace(/-/g, '').slice(0, 8) } while (used.has(k)); used.add(k); return k }
  let movement = null, tier = 0, stamped = 0
  const out = body.split('\n').map((line) => {
    if (/^##\s+(?!#)/.test(line)) { movement = line; tier = 0; return line }
    const t = /^###\s+tier\s+([123])\b/i.exec(line); if (t) { tier = Number(t[1]); return line }
    if (!movement || !tier) return line
    const b = LINE.exec(line); if (!b) return line
    if (b[3] && !ALL) return line
    stamped += 1
    return b[1] + b[2] + ' {#' + fresh() + '}'
  }).join('\n')
  total += stamped
  console.log(`${name}: ${stamped} line${stamped === 1 ? '' : 's'} ${DRY ? 'would be ' : ''}keyed`)
  if (!DRY && stamped) writeFileSync(file, head + out, 'utf8')
}
console.log(`${DRY ? 'would key' : 'keyed'} ${total} in all`)
