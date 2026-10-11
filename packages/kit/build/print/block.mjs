/*
 * A book's print block, read from and written back to its own markdown as a block —
 * never by re-dumping the whole frontmatter, which would restyle every other field. The
 * admin's print editor saves through here, and it is the one place the block is checked:
 * every format with a price or a markup (one of the two), a spine that the foil will
 * stamp, the choices the printer offers, and a key given once (build/product-keys.mjs)
 * and never edited.
 */


import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import matter from 'gray-matter'
import { spineWords, SPINE_MAX, FORMATS, PRINTED, PRINTERS, CONTENTS, CLOTHS, FOILS, TRIMS, PAPERS, FILES, MAINS, printSpec } from '../../src/lib/print-offers.js'
import { printer } from './suppliers.mjs'
import { printWords, SPINE_EDITION } from './words.mjs'
import { newKey, usedKeysOf } from '../product-keys.mjs'
import { asStore } from '../store/index.mjs'

export const CHOICES = { contents: CONTENTS, cloth: CLOTHS, foil: FOILS, trim: TRIMS, paper: PAPERS, formats: FORMATS, includes: FILES, printers: PRINTERS }
/* the fields in the order they are written */
const ORDER = ['key', 'currency', 'ebook', 'main', 'contents', 'formats', 'printers', 'providers', 'includes', 'files', 'cloth', 'foil', 'trim', 'paper', 'spine', 'blurb', 'flap', 'note', 'rights', 'proofed']

/* the block's lines in a book's front matter: [start, end) or null */
function span(lines) {
  const start = lines.findIndex((l) => /^print:/.test(l))
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !/^\S/.test(lines[end])) end++
  return [start, end]
}

/* { title, print } for a book, the block as the file has it (null when none) */
export async function readBlock(store, slug) {
  const raw = await asStore(store).read('content/books/' + slug + '.md')
  if (raw == null) throw Object.assign(new Error('no such book: ' + slug), { code: 404 })
  const d = matter(raw).data
  return { title: d.title || slug, author: d.author || '', print: d.print && typeof d.print === 'object' ? d.print : null, published: d.published !== false }
}

/* the checks: [{ path, message }] */
export function validateBlock(root, title, pr) {
  const out = []
  const has = (v) => v != null && v !== ''
  const formats = pr.formats && typeof pr.formats === 'object' ? pr.formats : {}
  for (const [f, v] of Object.entries(formats)) {
    if (!FORMATS.includes(f)) { out.push({ path: 'formats.' + f, message: `a format is one of ${FORMATS.join(' · ')}` }); continue }
    if (v == null || v === false) continue
    const o = typeof v === 'object' ? v : { price: v }
    if (has(o.price) === has(o.markup)) out.push({ path: 'formats.' + f + '.price', message: 'a format has a price or a markup — one of the two' })
    if (has(o.price) && !(Number(o.price) > 0)) out.push({ path: 'formats.' + f + '.price', message: 'the price is dollars, above zero' })
    if (has(o.markup) && !(Number(o.markup) >= 0)) out.push({ path: 'formats.' + f + '.markup', message: 'the markup is dollars, zero or more' })
    if (f === 'hardcover') {
      for (const k of ['cloth', 'foil']) for (const x of [].concat(o[k] || [])) if (!CHOICES[k].includes(x)) out.push({ path: 'formats.hardcover.' + k, message: `${k} is one of ${CHOICES[k].join(' · ')}` })
    }
  }
  for (const k of ['cloth', 'foil', 'trim', 'paper']) if (has(pr[k]) && !CHOICES[k].includes(pr[k])) out.push({ path: k, message: `${k} is one of ${CHOICES[k].join(' · ')}` })
  /* who prints each format, and each printer's options against what it offers */
  const printers = pr.printers && typeof pr.printers === 'object' ? pr.printers : {}
  for (const [f, id] of Object.entries(printers)) {
    if (!PRINTED.includes(f)) { out.push({ path: 'printers.' + f, message: `a printed format is one of ${PRINTED.join(' · ')}` }); continue }
    if (id === 'auto' || id == null || id === '') continue
    if (!PRINTERS.includes(id)) { out.push({ path: 'printers.' + f, message: `a printer is one of ${PRINTERS.join(' · ')}, or auto` }); continue }
    if (!printer(id).formats.includes(f)) out.push({ path: 'printers.' + f, message: `${printer(id).name} does not make a ${f}` })
  }
  const providers = pr.providers && typeof pr.providers === 'object' ? pr.providers : {}
  for (const [id, opts] of Object.entries(providers)) {
    if (!PRINTERS.includes(id)) { out.push({ path: 'providers.' + id, message: `a printer is one of ${PRINTERS.join(' · ')}` }); continue }
    if (!opts || typeof opts !== 'object') continue
    const known = new Map(); for (const f of printer(id).formats) for (const o of printer(id).options(f)) known.set(o.key, o)
    for (const [k, v] of Object.entries(opts)) {
      const o = known.get(k)
      if (!o) { out.push({ path: `providers.${id}.${k}`, message: `${printer(id).name} has no option ${k}` }); continue }
      if (o.type === 'select' && !o.choices.some((c) => String(c.value) === String(v))) out.push({ path: `providers.${id}.${k}`, message: `${o.label} is one of ${o.choices.map((c) => c.label).join(' · ')}` })
    }
  }
  if (has(pr.main) && !MAINS.includes(pr.main)) out.push({ path: 'main', message: `the main offer is one of ${MAINS.join(' · ')}` })
  for (const x of [].concat(pr.contents || [])) if (!CONTENTS.includes(x)) out.push({ path: 'contents', message: `contents are of ${CONTENTS.join(' · ')}` })
  for (const x of [].concat(pr.includes || [])) if (!FILES.includes(x)) out.push({ path: 'includes', message: `includes are of ${FILES.join(' · ')}` })
  const sp = spineWords(title, pr.spine, SPINE_EDITION(printWords(root)))
  if (!sp.fits) out.push({ path: 'spine', message: `the spine's foil holds ${SPINE_MAX} characters of "${sp.title}" and "${sp.edition}" together — a spine title of ${sp.room} or fewer` })
  if (has(pr.key) && !/^[0-9a-f]{8}$/.test(String(pr.key))) out.push({ path: 'key', message: 'the key is eight hex characters, given once' })
  /* the proofs: per contents, the edition id (sixteen hex) a printed copy was read and passed at */
  if (pr.proofed != null) {
    if (typeof pr.proofed !== 'object') out.push({ path: 'proofed', message: 'proofed is a record of contents → edition id' })
    else for (const [c, v] of Object.entries(pr.proofed)) { if (!CONTENTS.includes(c)) out.push({ path: 'proofed.' + c, message: `contents are of ${CONTENTS.join(' · ')}` }); else if (!/^[0-9a-f]{16}$/.test(String(v || ''))) out.push({ path: 'proofed.' + c, message: 'an edition id is sixteen hex characters (the id print.json holds)' }) }
  }
  return out
}

/* the block, cleaned to what is written: numbers as numbers, lists as lists, nothing empty */
function clean(pr) {
  const spec = printSpec(pr)
  const out = {}
  for (const k of ORDER) {
    if (k === 'ebook') { if (spec.ebook === false) out.ebook = false; continue }
    if (k === 'main') { if (pr.main && MAINS.includes(pr.main)) out.main = pr.main; continue }
    if (k === 'contents') { out.contents = spec.contents; continue }
    if (k === 'formats') {
      const fm = {}
      for (const f of FORMATS) {
        const rec = spec.formats[f]
        if (!rec) continue
        const o = {}
        if (rec.price != null) o.price = rec.price; else if (rec.markup != null) o.markup = rec.markup
        if (f === 'hardcover') { if (rec.cloth.length > 1 || rec.cloth[0] !== spec.cloth) o.cloth = rec.cloth; if (rec.foil.length > 1 || rec.foil[0] !== spec.foil) o.foil = rec.foil }
        fm[f] = o
      }
      if (Object.keys(fm).length) out.formats = fm
      continue
    }
    if (k === 'printers') { const p = {}; for (const f of PRINTED) if (spec.formats[f] && spec.printers[f]) p[f] = spec.printers[f]; if (Object.keys(p).length) out.printers = p; continue }
    if (k === 'providers') { const p = {}; for (const [id, o] of Object.entries(spec.providers)) if (o && Object.keys(o).length) p[id] = o; if (Object.keys(p).length) out.providers = p; continue }
    if (k === 'includes') { if (spec.includes.length) out.includes = spec.includes; continue }
    if (k === 'files') { if (spec.files.length) out.files = spec.files; continue }
    if (k === 'proofed') { if (Object.keys(spec.proofed).length) out.proofed = spec.proofed; continue }
    if (k === 'currency') { if (spec.currency !== 'usd') out.currency = spec.currency; continue }
    const v = pr[k]
    if (v == null || v === '') continue
    out[k] = String(v)
  }
  return out
}

/* write the block back (or remove it, pr null), the rest of the file byte for byte; a
   block with no key is given one. Returns the block as written. */
export async function writeBlock(store, slug, pr) {
  const st = asStore(store)
  const file = 'content/books/' + slug + '.md'
  const raw = await st.read(file)
  if (raw == null) throw Object.assign(new Error('no such book: ' + slug), { code: 404 })
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw)
  if (!m) throw new Error('no front matter')
  const lines = m[1].split('\n')
  const s = span(lines)
  let out = null
  if (pr) {
    out = clean(pr)
    const was = s ? yamlLoad(lines.slice(s[0], s[1]).join('\n') + '\n', { json: true }).print : null
    if (was && was.key) out.key = String(was.key)   /* the key is never edited */
    if (!out.key) out.key = newKey(await usedKeysOf(st))
    out = Object.fromEntries(ORDER.filter((k) => k in out).map((k) => [k, out[k]]))
    const dumped = yamlDump({ print: out }, { lineWidth: -1 }).trimEnd().split('\n')
    if (s) lines.splice(s[0], s[1] - s[0], ...dumped)
    else { const g = lines.findIndex((l) => /^(guestChapters|introduction):/.test(l)); lines.splice(g < 0 ? lines.length : g, 0, ...dumped) }
  } else if (s) lines.splice(s[0], s[1] - s[0])
  await st.write(file, '---\n' + lines.join('\n') + '\n---\n' + raw.slice(m[0].length), { collection: 'books', slug })
  return out
}

export const bookSlugs = (store) => asStore(store).list('content/books')
