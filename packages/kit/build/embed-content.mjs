/*
 * Build-time semantic index. After Velite compiles the content, this reads the
 * collection JSON, builds one search row per document, and embeds each with
 * ternlight — the same 7 MB on-device model the browser uses at query time.
 * The 384-dim vectors are written into .velite/search.json, so the browser only
 * ever embeds the query (~5 ms) and cosine-compares against these.
 *
 * Runs inside the Vite build (see vite.config.js), on whatever node Vite uses.
 */
import fs from 'node:fs'
import path from 'node:path'
import { searchRows } from '../src/lib/search-rows.js'

const DIR = '.velite'
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

export async function embedContent() {
  if (!fs.existsSync(path.join(DIR, 'articles.json'))) return
  const { embed } = await import('@ternlight/base')

  /* the rows themselves are the shared module's, so the browser makes the same ones from the live content */
  const B = read('books.json')
  const rows = searchRows({ articles: read('articles.json'), wiki: read('wiki.json'), docs: read('docs.json'), books: B, products: fs.existsSync(path.join(DIR, 'products.json')) ? read('products.json') : [] })

  for (const r of rows) {
    const v = embed((r.title + '. ' + (r.sub || '') + '. ' + r.text).slice(0, 2000))
    /* unit vectors round cleanly, and it halves the file */
    r.vec = Array.from(v, (x) => Math.round(x * 10000) / 10000)
  }
  fs.writeFileSync(path.join(DIR, 'search.json'), JSON.stringify(rows))
  console.log('[embed] ' + rows.length + ' documents embedded → .velite/search.json')

  /* the teachings: what each book would do for a reader, in pieces — the companion's
     insight, premise and description as one; each chapter's essence (and the head of
     its summary) as another — so a reader's own words ("the thing that frustrates me
     most is …") can be matched against the teaching itself rather than the opening
     pages of the text. Read by the library's find-your-book round (src/lib/finding.js). */
  const C = fs.existsSync(path.join(DIR, 'companions.json')) ? read('companions.json') : []
  const teachings = []
  for (const c of C) {
    const b = B.find((x) => x.slug === c.book); if (!b) continue
    const head = [b.title, c.insight, c.statement, b.description].filter(Boolean).join('. ')
    teachings.push({ book: b.slug, key: 'insight', text: head })
    ;(c.chapters || []).forEach((ch, i) => {
      const ess = (ch.essence || []).join(' ')
      const sum = stripHtml(ch.summary || '').slice(0, 600)
      if (ess || sum) teachings.push({ book: b.slug, key: 'ch:' + i, text: [ch.title, ess, sum].filter(Boolean).join('. ') })
    })
  }
  for (const t of teachings) {
    const v = embed(t.text.slice(0, 2000))
    t.vec = Array.from(v, (x) => Math.round(x * 10000) / 10000)
    delete t.text
  }
  fs.writeFileSync(path.join(DIR, 'teachings.json'), JSON.stringify(teachings))
  console.log('[embed] ' + teachings.length + ' teaching pieces embedded → .velite/teachings.json')
}
