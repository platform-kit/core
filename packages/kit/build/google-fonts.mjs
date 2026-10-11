#!/usr/bin/env node
/*
 * THE WHOLE GOOGLE FONTS CATALOGUE, FETCHED ONCE AND COMMITTED.
 *
 * The picker offers a curated two dozen (build/typefaces.mjs) and, beside them, every family Google
 * serves. That second half needs to know something the first half had written by hand: which
 * weights and which variable axes a family ACTUALLY has. Asking for a weight a family lacks does
 * not fail loudly — Google serves something else and the browser fakes the rest — so a picker that
 * let anybody choose any name without knowing its axes would reintroduce exactly the silent fault
 * the curated list existed to avoid.
 *
 * WHERE IT COMES FROM. `fonts.google.com/metadata/fonts` answers 2.7 MB of JSON with no API key:
 * every family, its category, its weights, its variable axes and its popularity. The official
 * Developer API (`googleapis.com/webfonts/v1`) needs a key and answers 403 without one, which would
 * put a credential in the way of a build — so the metadata endpoint it is.
 *
 * WHY COMMITTED RATHER THAN FETCHED. A build that reaches the network to learn what a font is, is a
 * build that fails when the network does, and a picker that fetches 2.7 MB to show a list is a
 * picker nobody waits for. The catalogue is compiled to a small file, committed, and refreshed
 * deliberately by running this — the same arrangement as any other thing the build must not
 * discover at the last moment.
 *
 *   node packages/kit/build/google-fonts.mjs          refresh the catalogue
 *   node packages/kit/build/google-fonts.mjs --check  say whether it is stale, change nothing
 */
import fs from 'node:fs'
import path from 'node:path'

const SRC = 'https://fonts.google.com/metadata/fonts'
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'google-fonts.json')

/*
 * What is kept, and nothing else: the name, one letter of category, the static weights, the
 * variable axes, and the popularity rank the list is ordered by. Everything else in the metadata
 * (the glyph coverage, the designers, the sample text, the subsets) is weight the admin would
 * download for nothing.
 */
const CAT = { 'Sans Serif': 's', Serif: 'f', Monospace: 'm', Display: 'd', Handwriting: 'h' }

export function compile(meta) {
  const list = meta.familyMetadataList || []
  const out = list.map((f) => {
    const weights = Object.keys(f.fonts || {}).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b)
    const italic = Object.keys(f.fonts || {}).some((k) => /i$/.test(k))
    const axes = (f.axes || []).map((a) => (typeof a === 'string' ? a : a.tag)).filter(Boolean)
    return {
      n: f.family,
      c: CAT[f.category] || 'd',
      w: weights,
      i: italic ? 1 : 0,
      v: axes.filter((t) => t !== 'wght'),           /* wght is implied by the weights */
      p: f.popularity || 9999,
    }
  }).filter((f) => f.n && f.w.length)
  out.sort((a, b) => a.p - b.p)
  return out
}

/* the pure half lives beside this, so the browser can read it too */
export { specOf, stackOf, slotsOf, kindOf } from './google-font.mjs'

export function readCatalogue() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch { return [] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check')
  const r = await fetch(SRC, { signal: AbortSignal.timeout(60000) })
  if (!r.ok) { console.error(`the catalogue could not be fetched: ${r.status}`); process.exit(1) }
  const next = compile(await r.json())
  const now = readCatalogue()
  const same = JSON.stringify(now) === JSON.stringify(next)
  if (check) {
    console.log(same ? `the catalogue is current (${next.length} families)` : `the catalogue is STALE: ${now.length} families here, ${next.length} at Google`)
    process.exit(0)
  }
  fs.writeFileSync(OUT, JSON.stringify(next))
  const kb = Math.round(fs.statSync(OUT).size / 1024)
  console.log(`${next.length} families → ${path.relative(process.cwd(), OUT)} (${kb} KB)${same ? ', unchanged' : ''}`)
}
