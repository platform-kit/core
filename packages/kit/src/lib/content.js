/*
 * The content layer.
 *
 * Documents (articles, wiki, docs, books) are compiled at build time by Velite
 * — see velite.config.js — into the typed JSON this file imports from #content.
 * Velite validates every document's frontmatter against a schema, renders its
 * markdown with a real remark/rehype pipeline (heading anchors, syntax
 * highlighting), computes reading time and an excerpt, and manages images. So
 * this file no longer parses markdown or frontmatter for documents; it just
 * shapes Velite's output for the components, keeping the same public API those
 * components already use.
 *
 * String catalogs are the exception: content/strings/<lang>/<ns>.md are i18next
 * resources, not documents, so they keep their own light loader below.
 */
import i18next from 'i18next'
import { load as yamlLoad } from 'js-yaml'
import { articles as ARTICLES, wiki as WIKI, docs as DOCS, books as BOOKS, ui as UI } from '#content'
import { STORE_ON } from './router.js'
import { corpus } from './search-index.js'
import { OFF_PALETTE, offPalette } from './search-rows.js'
import { scoreRow } from './rank.js'
import { get as stored } from './store.js'

/* ------------------------------------------------------------- strings ---- */
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return { data: {}, body: raw }
  let data = {}
  try { data = yamlLoad(m[1]) || {} } catch (e) { data = {} }
  return { data, body: raw.slice(m[0].length) }
}

const catalogFiles = import.meta.glob('/content/strings/*/*.md', {
  query: '?raw', import: 'default', eager: true,
})

const resources = {}
for (const path in catalogFiles) {
  const [, lng, ns] = /\/content\/strings\/([^/]+)\/([^/]+)\.md$/.exec(path) || []
  if (!lng) continue
  const { data, body } = parseFrontmatter(catalogFiles[path])
  resources[lng] = resources[lng] || {}
  resources[lng][ns] = { ...data, ...(body.trim() ? { _body: body.trim() } : {}) }
}

i18next.init({
  lng: 'en', fallbackLng: 'en', resources, defaultNS: 'site',
  interpolation: { escapeValue: false }, returnNull: false,
})

/* app-UI strings (content/app/ui/*.md) — re-exported so the content-library
   components read their labels from the same place the instrument does */
export { us, ug } from './strings.js'

export const t = (key, options) => i18next.t(key, options)
export const setLanguage = (lng) => i18next.changeLanguage(lng)
export function useT(ns) {
  return ns ? (key, options) => i18next.t(ns + ':' + key, options) : t
}

/* ------------------------------------------------------------ documents ---- */
const COLLECTION = { wiki: WIKI, docs: DOCS }
const prettify = (slug) => slug.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const day = (d) => (d ? String(d).slice(0, 10) : null)

/* The tree under a hierarchical collection (wiki, docs). Ids look like
   "getting-oriented/start-here"; folders come from the path, their titles from
   the prettified directory name, their order from the earliest child. */
export function docTree(collection) {
  const entries = COLLECTION[collection] || []
  const root = { dirs: {}, docs: [] }
  for (const e of entries) {
    const parts = e.id.split('/')
    let node = root
    for (const dir of parts.slice(0, -1)) {
      node.dirs[dir] = node.dirs[dir] || { slug: dir, title: prettify(dir), order: 99, dirs: {}, docs: [] }
      node = node.dirs[dir]
    }
    node.docs.push({ id: e.id, slug: parts[parts.length - 1], title: e.title, order: e.order ?? 99,
      description: e.description || '', readingTime: (e.metadata && e.metadata.readingTime) || 0 })
  }
  const finish = (node) => {
    const dirs = Object.values(node.dirs).map(finish)
    dirs.forEach((d) => {
      const orders = d.docs.map((x) => x.order).concat(d.dirs.map((x) => x.order))
      d.order = orders.length ? Math.min(...orders) : 99
    })
    return {
      ...node,
      docs: node.docs.slice().sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
      dirs: dirs.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    }
  }
  return finish(root)
}

/* ---- articles ---- */
/* one compiled article, in the shape the article page and the index read */
export const articleView = (a) => ({
  id: a.id, title: a.title, description: a.description || '', date: day(a.date),
  html: a.body, excerpt: a.excerpt, tags: a.tags || [],
  readingTime: a.metadata && a.metadata.readingTime,
  data: { media: a.media || null, image: a.image || null, author: a.author || null,
    tags: a.tags || [], date: day(a.date), canAccess: a.canAccess },
})
export function articleIndex() {
  return ARTICLES.slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .map(articleView)
}
export const article = (id) => articleIndex().find((a) => a.id === id) || null

/* ---- books ---- */
/* Generated covers: a small set of on-brand gradients (the five elements plus a
   plum), assigned to a coverless book by a stable hash of its slug — so a book
   with no cover always looks the same, but the shelf is never a wall of identical
   tiles. Kept as fixed hex (not theme tokens): a cover is its own object and its
   pale title reads on either site theme. */
const GEN_COVERS = [
  'linear-gradient(165deg, #1785A0, #0B4A5C)',  /* ocean  */
  'linear-gradient(165deg, #DD802F, #8A3E12)',  /* ember  */
  'linear-gradient(165deg, #4CA646, #1F5E2C)',  /* leaf   */
  'linear-gradient(165deg, #E1A200, #8A5A00)',  /* sun    */
  'linear-gradient(165deg, #0E8C8C, #0B4B4B)',  /* teal   */
  'linear-gradient(165deg, #7B5EA7, #3B2A57)',  /* plum   */
]
export function coverTint(slug) {
  let h = 0
  for (let i = 0; i < (slug || '').length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return GEN_COVERS[h % GEN_COVERS.length]
}

export const bookCard = (b) => ({ slug: b.slug, title: b.title, author: b.author || '', cover: b.cover || null,
  words: (b.metadata && b.metadata.wordCount) || 0, chapters: b.chapters || 0 })
export function bookShelf() {
  return BOOKS.slice().sort((a, b) => a.title.localeCompare(b.title)).map(bookCard)
}

/* How far a reader has got in a book, read from the same per-book state the
   reader keeps (through Loro). `ch` is the chapter they last had open, zero-based;
   progress is chapters reached over the count velite baked in, so a book can show
   its bar anywhere it is listed. A book never opened returns opened:false and no
   bar is drawn. */
const CHAPTERS = {}
for (const b of BOOKS) CHAPTERS[b.slug] = b.chapters || 0
export function bookProgress(slug) {
  let ch = 0, opened = false
  try {
    const s = JSON.parse(stored('dl.book.' + slug) || 'null')
    if (s) { opened = true; ch = s.ch || 0 }
  } catch (e) { /* no state yet */ }
  const chN = CHAPTERS[slug] || 0
  const frac = opened && chN > 0 ? Math.min(1, (ch + 1) / chN) : 0
  return { opened, frac, pct: Math.round(frac * 100), ch, chapters: chN }
}

/* Keep a recommendation list feeling fresh: drop the books a reader has already
   finished — but only while at least `min` unfinished ones remain, so a shelf is
   never left too sparse, and a reader who has finished everything still sees it.
   Order is preserved, so any priority or shortest-first sort survives. */
export function dropFinished(list, min = 3) {
  const unfinished = list.filter((b) => bookProgress(b.slug).pct < 100)
  return unfinished.length >= min ? unfinished : list
}

/* ---- concepts: the coarse browse themes (app/ui/concepts.md) ---- */
export function concepts() {
  const scope = (UI || []).find((x) => x.scope === 'concepts')
  const list = scope ? scope.groups.list || {} : {}
  return Object.keys(list).map((slug) => ({ slug, name: list[slug].name || slug }))
}
export function booksForConcept(slug) {
  return BOOKS.filter((b) => (b.concepts || []).indexOf(slug) >= 0)
    .sort((a, b) => a.title.localeCompare(b.title)).map(bookCard)
}

/* ---- one document ---- */
export async function loadDoc(collection, id) {
  if (collection === 'books') {
    const b = BOOKS.find((x) => x.slug === id)
    return b ? { data: b, body: b.raw, readingTime: b.metadata && b.metadata.readingTime } : null
  }
  const e = (COLLECTION[collection] || []).find((x) => x.id === id)
  return e ? { data: e, html: e.body, toc: e.toc } : null
}

/* ---- per-collection search corpus, for the docs page's own search box ---- */
export async function docsCorpus(collection) {
  return (COLLECTION[collection] || []).map((e) => ({ id: e.id, title: e.title, text: stripHtml(e.body) }))
}

export function searchDocs(corpusRows, query) {
  const toks = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!toks.length) return []
  return corpusRows.map((row) => {
    const title = row.title.toLowerCase(), text = row.text.toLowerCase()
    let score = 0, first = -1
    for (const tk of toks) {
      const inTitle = title.indexOf(tk), inText = text.indexOf(tk)
      if (inTitle < 0 && inText < 0) return null
      score += (inTitle >= 0 ? 2 : 0) + (inText >= 0 ? 1 : 0)
      if (first < 0) first = inText
    }
    const at = Math.max(0, (first < 0 ? 0 : first) - 40)
    return { ...row, score, excerpt: (at > 0 ? '…' : '') + row.text.slice(at, at + 140) + '…' }
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12)
}

/* ---- the one corpus across every kind, for the command palette; with the store
   off (VITE_STORE=false) its products are not in it at all ---- */
/* The index is fetched, not bundled. Its \`text\` is the whole library over again — 1.5 MB of the
   6 MB chunk every reader of any page was loading — and the palette is the one thing that reads it.
   This function was already async, so no caller changed. */
export async function contentCorpus() {
  const rows = await corpus()
  return STORE_ON ? rows : rows.filter((r) => r.kind !== 'product')
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

/* The query understands operators alongside plain words:
     type:article|wiki|doc|book  ·  after:2026-01  ·  before:2026-09  ·  tag:practice
   The palette's dropdowns pass the same filters as options. */
export function parseQuery(query) {
  const out = { toks: [], kind: null, after: null, before: null, tags: [] }
  for (const raw of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const op = /^(type|kind|after|before|tag):(.+)$/.exec(raw)
    if (!op) { out.toks.push(raw); continue }
    if (op[1] === 'after') out.after = op[2]
    else if (op[1] === 'before') out.before = op[2]
    else if (op[1] === 'tag') out.tags.push(op[2])
    else out.kind = { articles: 'article', docs: 'doc', books: 'book' }[op[2]] || op[2]
  }
  return out
}

export function allTags(rows) {
  const freq = {}
  rows.forEach((r) => (r.tags || []).forEach((tag) => { freq[tag] = (freq[tag] || 0) + 1 }))
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, n }))
}

function facetFilter(rows, { kind, after, before, tags }) {
  return rows.filter((r) =>
    (!kind || r.kind === kind) &&
    (!after || (r.date && String(r.date) >= after)) &&
    (!before || (r.date && String(r.date) <= before)) &&
    (!tags || !tags.length || (r.tags || []).some((t) => tags.includes(t.toLowerCase()))))
}

/* which kinds a reader's palette leaves out, and why, is a fact about the index: lib/search-rows.js.
   Imported AND re-exported, not re-exported alone: `export { x } from' forwards the name without
   binding it here, so `searchContent` below threw `offPalette is not defined` on every search. */
export { OFF_PALETTE, offPalette }

export function searchContent(rows, query, opts) {
  const parsed = parseQuery(query)
  const kind = (opts && opts.kind) || parsed.kind
  rows = offPalette(rows, kind)
  const after = (opts && opts.after) || parsed.after
  const before = (opts && opts.before) || parsed.before
  const tagSel = ((opts && opts.tags) || []).concat(parsed.tags)
  const toks = parsed.toks
  rows = facetFilter(rows, { kind, after, before, tags: tagSel })
  if (!toks.length) {
    if (!kind && !after && !before && !tagSel.length) return []
    return rows.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 20).map((r) => ({ ...r, excerpt: r.sub || r.text.slice(0, 120) + '…', titleHtml: r.title }))
  }
  const out = rows.map((row) => {
    const title = row.title.toLowerCase(), text = row.text.toLowerCase()
    let score = 0, first = -1
    for (const tk of toks) {
      const it = title.indexOf(tk), ix = text.indexOf(tk)
      if (it < 0 && ix < 0) return null
      score += (it >= 0 ? 3 : 0) + (ix >= 0 ? 1 : 0)
      if (first < 0 && ix >= 0) first = ix
    }
    const at = Math.max(0, first - 44)
    let excerpt = escapeHtml((at > 0 ? '…' : '') + row.text.slice(at, at + 150) + '…')
    let titleHtml = escapeHtml(row.title)
    for (const tk of toks) {
      const re = new RegExp('(' + tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig')
      excerpt = excerpt.replace(re, '<mark>$1</mark>')
      titleHtml = titleHtml.replace(re, '<mark>$1</mark>')
    }
    return { ...row, score, excerpt, titleHtml }
  }).filter(Boolean).sort((a, b) => b.score - a.score)
  return out.slice(0, 20)
}

export function cosineSim(a, b) {
  if (!a || !b) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]  /* both unit-normalized */
  return s
}

/* Given a query embedding (from ternlight, in the browser), rank the corpus by
   meaning. Same facet options as the keyword search; min cuts weak matches. */
export function semanticSearch(rows, qvec, opts = {}) {
  const min = opts.min ?? 0.3
  const parsed = parseQuery(opts.query || '')
  rows = offPalette(rows, opts.kind || parsed.kind)
  rows = facetFilter(rows, {
    kind: opts.kind || parsed.kind,
    after: opts.after || parsed.after,
    before: opts.before || parsed.before,
    tags: (opts.tags || []).concat(parsed.tags),
  })
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  return rows.map((r) => ({ ...r, sim: cosineSim(r.vec, qvec) }))
    .filter((r) => r.sim >= min)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, opts.topK || 12)
    .map((r) => ({ ...r, titleHtml: esc(r.title), excerpt: esc(r.sub || (r.text || '').slice(0, 130) + '…') }))
}

/* The lazy query embedder: dynamic-imports ternlight (its wasm is a separate
   chunk) the first time anything needs a query vector — the palette and the
   discovery hub share it. */
let _embed = null, _embedLoading = null
/* start the ternlight chunk downloading, without waiting — call it the moment
   a search becomes likely (palette opens, content page loads) so the model is
   ready before the first query, but never on a page nobody searches. */
export function warmEmbedder() {
  if (!_embed && !_embedLoading) _embedLoading = import('@ternlight/base').then((m) => { _embed = m.embed })
}
export async function embedText(text) {
  warmEmbedder()
  await _embedLoading
  return _embed(text)
}

/* Discovery ranking: score every row against the reader's profile vector.
   Semantic similarity leads; a matching theme tag and a prescribed item add a
   deliberate boost, so precise signals sit above the fuzzy long tail. The order
   is the whole message — a row carries no label saying why it surfaced.

   WEIGHTS are what the reader's own history says, subject to number (my_interests): a piece
   carrying a subject they keep reading, or have bought something under, is lifted in proportion.
   Weights and theme tags are different claims and both count — a theme tag is the SITE saying this
   matters to this reader, a weight is the reader's own behaviour saying so — and a row that gets
   both gets both. The lift is scaled by WEIGHT_LIFT so that no amount of history can outrank a
   prescription: what a site puts in front of somebody deliberately is the strongest signal there
   is, and the rest reorders underneath it. `weights` may be any object of subject → number,
   including none, in which case this ranks exactly as it did before there were any. */
export function forYou(rows, profileVec, opts = {}) {
  const at = { themeTags: opts.themeTags || [], prescribed: new Set(opts.prescribed || []), weights: opts.weights || {} }
  return rows.map((r) => ({ ...r, ...scoreRow({ sem: cosineSim(r.vec, profileVec), tags: r.tags, href: r.href }, at) }))
    .sort((a, b) => b.score - a.score)
}

export const KIND_LABEL = { article: 'Article', wiki: 'Wiki', doc: 'Docs', book: 'Book', product: 'Store' }
