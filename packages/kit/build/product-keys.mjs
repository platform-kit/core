/*
 * Every offer carries a `key`: eight hex characters of a UUID, unique across the
 * product files, assigned once and never edited — what a purchase, a subscription
 * and a credit are attributed by, so the human `sku` (the slug in URLs, in
 * pricing.md, in Stripe's product name) can be renamed freely after something
 * has sold. The admin's writer gives a new product its key on save; this keys any
 * hand-written file that lacks one, and refuses a duplicate.
 *
 *   node build/product-keys.mjs          key every file that has none
 *   node build/product-keys.mjs --check  say which lack one or share one; exit 1 if any
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const DIR = join(process.cwd(), 'content/store/products')
const BOOKS = join(process.cwd(), 'content/books')
export const KEY = /^[0-9a-f]{8}$/
export const newKey = (used = new Set()) => { let k; do { k = randomUUID().replace(/-/g, '').slice(0, 8) } while (used.has(k)); return k }

/* the frontmatter's `key:` line, read or written after `sku:` without disturbing the rest */
const keyOf = (raw) => { const m = /^key:\s*['"]?([0-9a-f]{8})['"]?\s*$/m.exec(raw); return m ? m[1] : null }
const withKey = (raw, key) => /^sku:.*$/m.test(raw) ? raw.replace(/^(sku:.*)$/m, `$1\nkey: ${key}`) : raw.replace(/^---\n/, `---\nkey: ${key}\n`)

/* a book's print block: its `key:` line, read or written under `print:` */
const hcBlock = (raw) => /^print:\n((?:[ \t]+.*\n?)+)/m.exec(raw)
const hcKeyOf = (raw) => { const b = hcBlock(raw); if (!b) return undefined; const m = /^[ \t]+key:\s*['"]?([0-9a-f]{8})['"]?\s*$/m.exec(b[1]); return m ? m[1] : null }
const withHcKey = (raw, key) => raw.replace(/^(print:\n)/m, `$1  key: ${key}\n`)

/* every key in use — the products' and the hardcovers' — for a writer giving a new one */
/* the same through the store (or a root), for the pipe */
export async function usedKeysOf(store) {
  const { asStore } = await import('./store/index.mjs'); const st = asStore(store)
  const used = new Set()
  for (const n of await st.list('content/store/products')) { const k = keyOf(await st.read('content/store/products/' + n + '.md')); if (k) used.add(k) }
  for (const n of await st.list('content/books')) { const k = hcKeyOf(await st.read('content/books/' + n + '.md')); if (k) used.add(k) }
  return used
}
export function usedKeys() {
  const used = new Set()
  for (const n of readdirSync(DIR).filter((n) => n.endsWith('.md'))) { const k = keyOf(readFileSync(join(DIR, n), 'utf8')); if (k) used.add(k) }
  for (const n of readdirSync(BOOKS).filter((n) => n.endsWith('.md'))) { const k = hcKeyOf(readFileSync(join(BOOKS, n), 'utf8')); if (k) used.add(k) }
  return used
}

export function productKeys({ write = true } = {}) {
  const files = readdirSync(DIR).filter((n) => n.endsWith('.md')).sort()
  const books = readdirSync(BOOKS).filter((n) => n.endsWith('.md')).sort()
  const used = new Map(), missing = [], dup = []
  const note = (k, n) => { if (used.has(k)) dup.push(`${n} and ${used.get(k)} share ${k}`); else used.set(k, n) }
  for (const n of files) { const k = keyOf(readFileSync(join(DIR, n), 'utf8')); if (!k) missing.push({ dir: DIR, n, hc: false }); else note(k, n) }
  for (const n of books) { const k = hcKeyOf(readFileSync(join(BOOKS, n), 'utf8')); if (k === undefined) continue; if (!k) missing.push({ dir: BOOKS, n, hc: true }); else note(k, 'books/' + n) }
  if (write) for (const m of missing) {
    const k = newKey(new Set(used.keys())); used.set(k, m.n)
    const raw = readFileSync(join(m.dir, m.n), 'utf8')
    writeFileSync(join(m.dir, m.n), m.hc ? withHcKey(raw, k) : withKey(raw, k), 'utf8')
    console.log(`keyed ${m.hc ? 'books/' + m.n + ' (hardcover)' : m.n} → ${k}`)
  }
  return { missing: write ? [] : missing.map((m) => (m.hc ? 'books/' : '') + m.n), dup }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check')
  const { missing, dup } = productKeys({ write: !check })
  for (const m of missing) console.error(`✗ ${m}: no key (node build/product-keys.mjs)`)
  for (const d of dup) console.error(`✗ ${d}`)
  if (missing.length || dup.length) process.exit(1)
  if (check) console.log('✔ product keys: every offer keyed, none shared')
}
