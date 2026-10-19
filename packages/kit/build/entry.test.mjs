/* The one adapter against velite: every entry of every collection velite built for this site (.velite/*.json)
   is made again from its file as a row — the frontmatter, the body, the text, the collection and slug the
   store gives its path — through src/lib/entry.js with the shared renderer (no highlighter: the browser's), and
   compared field for field. The html is compared with its code blocks folded (the build colours them, the
   browser does not) and the entities read; the fields velite alone can make are those the adapter carries
   over from the bundle. Skips itself with a note where the site has no .velite. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { collectionOf } from './store/index.mjs'
import { toEntry, targetOf } from '../src/lib/entry.js'
import { renderer } from '../src/lib/markdown.js'
import { plain } from '../src/lib/markdown.js'
import { publicRow } from '../supabase/functions/_shared/gate.js'
import { parseCompanionBody, serialiseCompanionBody } from '../src/lib/companion-body.js'

const ROOT = process.cwd(), V = path.join(ROOT, '.velite')
if (!fs.existsSync(path.join(V, 'articles.json'))) { console.log('entry: skipped — no .velite here (build the content first)'); process.exit(0) }
const read = (f) => (fs.existsSync(path.join(V, f)) ? JSON.parse(fs.readFileSync(path.join(V, f), 'utf8')) : null)
const bundle = {}
for (const f of fs.readdirSync(V).filter((x) => x.endsWith('.json'))) bundle[f.replace(/\.json$/, '')] = read(f)

const R = renderer()
const ctx = { render: (md) => R.parse(md), toc: (md) => R.toc(md), bundle, models: bundle.models || [] }
const fold = (h) => String(h).replace(/<pre[\s\S]*?<\/pre>/g, '<pre/>').replace(/&#x3C;/g, '&lt;').replace(/&#x26;/g, '&amp;').replace(/(<[^>]*>)|>/g, (m, t) => t || '&gt;').replace(/\s+/g, ' ').replace(/> </g, '><').replace(/ ?<pre\/> ?/g, '<pre/>').trim()
const norm = (k, v) => (k === 'body' || k === 'summary' ? fold(v) : k === 'chapters' && Array.isArray(v) ? v.map((c) => ({ ...c, summary: fold(c.summary || '') })) : k === 'excerpt' ? (/^[|#]/.test(String(v)) ? '(a table or a heading first: velite excerpts the markdown itself)' : plain(String(v)).replace(/\s+/g, ' ').trim().slice(0, 60)) : k === 'metadata' ? { readingTime: v.readingTime } : k === 'raw' ? String(v).trim() : v)

/* the file a built entry came from */
const fileOf = (target, e) => {
  if (target === 'site') return 'content/site.md'
  if (target === 'storefront') return 'content/store/storefront.md'
  if (target === 'ui') return null   /* found by scope below */
  if (target === 'forms') return `content/forms/${e.slug}.md`
  if (target === 'companions') return `content/${e.path}.md`
  if (target === 'sessions') return `content/sessions/${e.slug}.md`
  return `content/${e.path}.md`
}
/* velite writes what a guest may read (_shared/gate.js), and in cloud mode the adapter is sent rows cut the same way
   (reader-content): so each row is cut as the server cuts it before it is compared */
const COMPANION = { parseCompanionBody, serialiseCompanionBody }
const BOOKS = new Map((fs.existsSync(path.join(ROOT, 'content/books')) ? fs.readdirSync(path.join(ROOT, 'content/books')) : []).filter((f) => f.endsWith('.md')).map((f) => [f.replace(/\.md$/, ''), matter(fs.readFileSync(path.join(ROOT, 'content/books', f), 'utf8')).data]))
const IGNORE = new Set(['coverSource'])   /* the build's own note for the adapter */
let n = 0, bad = 0, seen = 0, stale = 0
for (const [target, built] of Object.entries(bundle)) {
  if (['search', 'icons', 'icon-names', 'sales', 'teachings', 'support-prompts', 'models', 'print'].includes(target)) continue
  const list = Array.isArray(built) ? built : built && typeof built === 'object' && Object.keys(built).length ? [built] : []
  for (const e of list) {
    let file = fileOf(target, e)
    if (target === 'ui') { const dir = 'content/app/ui'; file = fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).map((f) => dir + '/' + f).find((f) => /^scope:\s*(.+)$/m.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'))?.[1].trim() === e.scope) : null }
    if (!file || !fs.existsSync(path.join(ROOT, file))) continue   /* a theme default with no site file (a ui scope), or a collection the site's own velite made */
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const { data, content } = matter(text)
    const { collection, slug } = collectionOf(file)
    const row = publicRow({ path: file, collection, slug, published: data.published !== false, data: JSON.parse(JSON.stringify(data)), body: content, text }, BOOKS, COMPANION)
    /* a file edited since the content was built is not the entry's source any more: left out, and said */
    if (typeof e.raw === 'string' && e.raw.trim() !== String(row.body || '').trim()) { stale++; continue }
    const t = targetOf(row)
    n++
    if (t !== target) { bad++; console.log(`  FAIL ${file}: the row targets ${t}, velite built it under ${target}`); continue }
    const mine = toEntry(t, row, ctx)
    if (!mine) { bad++; console.log(`  FAIL ${file}: the adapter made nothing`); continue }
    const faults = []
    for (const k of Object.keys(e)) {
      if (IGNORE.has(k)) continue
      if (k === 'excerpt' && /^[|#]/.test(String(e[k]))) continue   /* a table or a heading first: velite excerpts the markdown itself, a quirk not carried */
      const a = norm(k, e[k]), b = norm(k, mine[k])
      /* a value neither side has is not a fault, and JSON.stringify(undefined) is undefined —
         which used to throw out of the reporter and hide whatever the real difference was */
      const say = (v) => (v === undefined ? String(v) : String(JSON.stringify(v)).slice(0, 120))
      try { assert.deepEqual(b, a) } catch { faults.push(`${k}: velite ${say(a)} / adapter ${say(b)}`) }
    }
    for (const k of Object.keys(mine)) if (!(k in e) && mine[k] !== undefined && mine[k] !== null) faults.push(`${k}: the adapter adds ${JSON.stringify(mine[k]).slice(0, 80)}`)
    if (faults.length) { bad++; console.log(`  FAIL ${file}\n    ` + faults.join('\n    ')) } else seen++
  }
}
console.log(`${bad ? '✖' : '✔'} entry: ${n - bad}/${n} entries the same either side${stale ? ` (${stale} edited since the content was built, left out — build it to compare them)` : ''}`)
process.exit(bad ? 1 : 0)
