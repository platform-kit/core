#!/usr/bin/env node
/*
 * THE DEMO'S PHOTOGRAPHS — Unsplash, fetched once and committed.
 *
 * The first two passes took CC0 (Openverse over Flickr, StockSnap, Rawpixel). CC0 is where the
 * licence is clean and the photography is not: the set that came out had no shared palette, three
 * colour temperatures in six pictures, another publisher's books legible in four of them, a jQuery
 * screenshot standing in for markdown and a 1930s typewriter for a press founded in 2024. Widening
 * to CC-BY buys better pictures and hands everyone who copies this demo an attribution obligation.
 *
 * Unsplash is neither: free for commercial use, no attribution required, and the photography is
 * art-directed rather than uploaded. It needs a key — a free one, unsplash.com/developers, Demo
 * tier, 50 requests an hour, and this fetches a dozen pictures once.
 *
 *   UNSPLASH_ACCESS_KEY=… node sites/demo/build/photos.mjs
 *   node sites/demo/build/photos.mjs --sheet <slot>   candidates for one slot, to choose by looking
 *   node sites/demo/build/photos.mjs --force          fetch everything again
 *   node sites/demo/build/photos.mjs --list           what is wanted and what is there
 *
 * WHY COMMITTED RATHER THAN FETCHED AT BUILD. A build that reaches the network for its pictures
 * fails when the network does, and the same query returns different photographs next month — a
 * site that quietly redecorates itself is worse than one that never changes.
 *
 * Unsplash's API guidelines require an application to hit a photo's download endpoint when it
 * actually uses the photo. `take()` does, and it is not optional.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const PUB = path.join(ROOT, 'public/img')
const LEDGER = path.join(ROOT, 'build/photos.json')
/* .env is where this machine keeps its keys; a real environment variable still wins */
function loadEnvFile(at) {
  if (!fs.existsSync(at)) return {}
  const out = {}
  for (const line of fs.readFileSync(at, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const REPO = path.resolve(ROOT, '../..')
const env = { ...loadEnvFile(path.join(REPO, '.env')), ...loadEnvFile(path.join(ROOT, '.env')), ...process.env }
const KEY = env.UNSPLASH_ACCESS_KEY || ''
const API = 'https://api.unsplash.com'
const UA = { 'User-Agent': 'platformkit-demo/1.0', 'Accept-Version': 'v1', Authorization: `Client-ID ${KEY}` }

/*
 * THE ART DIRECTION, WRITTEN DOWN, so a query can be argued with.
 *
 * Northlight's covers are the identity: cream and off-white grounds, one geometric mark, a serif
 * title, a palette of terracotta, navy, sage and ochre. The photographs have to sit beside those
 * on the same page, so:
 *
 *   — daylight, soft, neutral to slightly warm. No orange grading, no blue hour, no neon.
 *   — paper, type, ink, desks, the making of books. Not lifestyle, not laptops, not phones.
 *   — no legible title or wordmark belonging to anybody else. This is the rule three pictures have
 *     already been thrown out for: another publisher's spines, a STAEDTLER eraser, a Lucky Brand
 *     shirt. A demo whose pictures carry someone else's brand is not a demo of this press.
 *   — no faces. A stranger's face under an invented name is worse than no portrait, and the pages
 *     that wanted one (the editor, the testimonials) have been rewritten not to.
 *   — room for words. Several of these sit under a heading or behind a scrim.
 */
/* read before choosing; never typed into the search box */
const LOOK = 'daylight, soft neutral light, paper and ink, no brand marks, no faces'

/*
 * WHAT EACH PICTURE IS OF — keyed to what the PIECE IS ABOUT, never to the file's name.
 *
 * That distinction is what the earlier passes kept getting wrong. `articles/markdown` is about
 * keeping books as plain text FILES and was matched to "writing notebook pen", which returned a
 * pencil. `ten-minutes` is a chapter read aloud — audio — and got a girl reading silently. Both
 * were good photographs of the wrong thing, which is exactly what a reader notices and cannot name.
 */
const WANT = [
  /* the articles, by what each one argues */
  ['articles/reading-aloud', ['manuscript pages read aloud', 'proof pages editing', 'open book pages daylight'], 1600, 900],
  ['articles/companion', ['annotated book margin notes', 'notes beside a book', 'study notes book'], 1600, 900],
  ['articles/ten-minutes', ['studio microphone recording', 'condenser microphone'], 1600, 900],
  ['articles/autumn-list', ['printing press sheets', 'book printing press', 'printed proofs stack'], 1600, 900],
  ['articles/first-hour', ['early morning desk window light', 'morning desk notebook coffee'], 1600, 900],
  ['articles/markdown', ['plain text editor screen', 'monospace text editor', 'code editor plain text'], 1600, 900],
  /* the pages */
  ['pages/editor', ['editor desk manuscript proofs', 'publisher desk papers', 'writing desk daylight'], 1000, 1250],
  ['pages/library', ['reading room shelves daylight', 'library reading room'], 1800, 1000],
  /* the shop */
  ['store/books', ['stack of hardback books plain', 'books stacked daylight'], 1200, 1200],
  ['store/goods', ['notebook and pen on desk', 'stationery notebook flat lay'], 1200, 1200],
  ['store/notebook', ['closed notebook cover', 'hardcover notebook'], 1200, 1200],
  ['store/notebook-open', ['open blank notebook', 'notebook open pages'], 1200, 1200],
  ['store/print', ['letterpress type case', 'wood type letterpress', 'metal type printing'], 1200, 1200],
  /* the share card */
  ['share', ['bookshelf daylight', 'books on a shelf'], 1200, 630],
]

/* slot -> the exact Unsplash photo id, chosen by looking at a sheet rather than trusting a title.
   A slot with a pin always gets that photograph; a slot without one takes the best of what its
   queries return, which is fine where anything on-topic will do. */
const PINNED = {
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {}

if (args.includes('--list')) {
  for (const [slot, q] of WANT) {
    const at = path.join(PUB, slot + '.webp')
    const l = ledger[slot]
    console.log((fs.existsSync(at) ? '  have ' : '  WANT ') + slot.padEnd(26) + (l ? `${l.license}  ${l.credit}  ${l.source}` : [].concat(q).join(' / ')))
  }
  process.exit(0)
}

if (!KEY) {
  console.error('UNSPLASH_ACCESS_KEY is not set. A free key takes a minute at https://unsplash.com/developers')
  console.error('(Demo tier: 50 requests an hour. This wants about twenty.)')
  process.exit(2)
}

const get = async (url) => {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`)
  return r.json()
}

const search = async (q, orientation, per = 12) =>
  (await get(`${API}/search/photos?query=${encodeURIComponent(q)}&per_page=${per}&orientation=${orientation}&content_filter=high`)).results || []

const orient = (w, h) => (w > h * 1.15 ? 'landscape' : h > w * 1.15 ? 'portrait' : 'squarish')

/* the download endpoint Unsplash requires an application to hit when it uses a photo */
async function take(it) {
  try { await fetch(`${it.links.download_location}&client_id=${KEY}`, { headers: UA, signal: AbortSignal.timeout(20000) }) } catch {}
  const r = await fetch(it.urls.raw + '&w=2400&q=90&fm=jpg', { headers: UA, signal: AbortSignal.timeout(60000) })
  if (!r.ok) throw new Error('the file said ' + r.status)
  return Buffer.from(await r.arrayBuffer())
}

/* a numbered contact sheet for one slot, so the choice is made by LOOKING — the titles lie, and a
   search for "programming screen monitor" once returned macro photographs of flies */
if (args.includes('--sheet')) {
  const slot = args[args.indexOf('--sheet') + 1]
  const row = WANT.find((w) => w[0] === slot)
  if (!row) { console.error('no such slot: ' + slot); process.exit(1) }
  /* --q lets a query be tried without editing the want-list: the queries ARE the work, and the
     first guess is usually wrong ('plain text editor screen' returned Canon logos) */
  const ad = args.indexOf('--q')
  const [, want, w, h] = row
  const queries = ad > -1 ? args.slice(ad + 1).filter((a) => !a.startsWith('--')) : want
  const out = []
  for (const q of [].concat(queries)) for (const it of await search(q, orient(w, h), 8)) if (out.length < 24) out.push({ ...it, q })
  const CELL = 260, COLS = 6, tiles = []
  for (let i = 0; i < out.length; i++) {
    const r = await fetch(out[i].urls.small, { headers: UA, signal: AbortSignal.timeout(25000) })
    tiles.push({ input: await sharp(Buffer.from(await r.arrayBuffer())).resize(CELL, CELL, { fit: 'cover' }).toBuffer(), left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL })
  }
  const sheet = path.join(ROOT, 'build/.sheet.png')
  await sharp({ create: { width: COLS * CELL, height: Math.max(1, Math.ceil(out.length / COLS)) * CELL, channels: 3, background: '#111' } }).composite(tiles).png().toFile(sheet)
  console.log(out.map((x, i) => `${String(i).padStart(2)} [${x.q}] ${(x.description || x.alt_description || '').slice(0, 44)}  ${x.id}`).join('\n'))
  console.log(`\n${out.length} candidates → ${sheet}`)
  process.exit(0)
}

let made = 0, kept = 0
for (const [slot, queries, w, h] of WANT) {
  const out = path.join(PUB, slot + '.webp')
  if (!force && fs.existsSync(out)) { kept++; continue }
  try {
    let it = null, why = ''
    if (PINNED[slot]) { it = await get(`${API}/photos/${PINNED[slot]}`); why = 'pinned' }
    else {
      for (const q of [].concat(queries)) {
        const hits = (await search(q, orient(w, h))).filter((p) => p.width >= w && p.height >= h)
        if (hits.length) { it = hits[0]; why = q; break }
      }
    }
    if (!it) { console.log(`  ✖ ${slot}: nothing for ${[].concat(queries).join(' / ')}`); continue }
    const buf = await take(it)
    await fs.promises.mkdir(path.dirname(out), { recursive: true })
    await sharp(buf).resize(w, h, { fit: 'cover', position: sharp.strategy.entropy }).webp({ quality: 86 }).toFile(out)
    ledger[slot] = {
      query: why, license: 'Unsplash License', source: it.links.html,
      credit: (it.user && (it.user.name || it.user.username)) || null,
      creditUrl: (it.user && it.user.links && it.user.links.html) || null,
      description: it.description || it.alt_description || null, id: it.id,
    }
    made++
    console.log(`  ✔ ${slot.padEnd(26)} ${(it.description || it.alt_description || '').slice(0, 40)}  — ${ledger[slot].credit}`)
  } catch (e) {
    console.log(`  ✖ ${slot}: ${String(e.message).slice(0, 80)}`)
  }
}

fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n')
console.log(`\n${made} fetched, ${kept} already there — provenance in ${path.relative(process.cwd(), LEDGER)}`)
