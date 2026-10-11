/*
 * THE SITE'S TYPEFACES — chosen in the admin, emitted by the build, read as three tokens.
 *
 * Not to be confused with build/fonts.mjs beside it, which is older and answers a different
 * question: what face is the share-image function to DRAW in, where there is no stylesheet and no
 * DOM. This file is where a face is CHOSEN; that one carries the choice to a function. `fontsOf`
 * there resolves through this one, so the card and the page can never be set in different type.
 *
 * Every `font-family` in the theme already reads one of three custom properties, 815 of them:
 *
 *   --fd   the display face: headings, the landing's lines, a pull quote
 *   --f    the body face: prose, the reader, every control
 *   --m    the mono face: code, a key, a figure that must line up
 *
 * What was missing is that their VALUES were written in a stylesheet and the Google Fonts link was
 * hardcoded in each site's index.html — so changing a face meant editing HTML, and the two could
 * disagree silently (a token naming a family the page never loaded falls back to Georgia and looks
 * almost right).
 *
 * WHY A LIST RATHER THAN A FREE FIELD. A family name typed by hand can be one Google does not
 * serve, and the failure is quiet: the stylesheet 404s and the page renders in Times. Worse, a
 * family that exists may not have the weights the theme asks for — Google answers a request for a
 * weight a static font lacks by serving something else, and the page ends up faux-bolding. Neither
 * is visible in review.
 *
 * So the families are a list, each with the axis specification that family actually has, and the
 * admin offers the list. That is also this project's standing rule: the stack, the weights and the
 * url are a grammar for the build, and the decision an editor is making is "which face".
 *
 * Adding a family is one line here, and the pairing note is for the person choosing.
 *
 * WHY A LOOK NO LONGER SETS THEM. north.css and docs.css each set these three, which was the only
 * way to choose a face before this existed. They had to come out, and the reason is precedence
 * rather than principle: the tokens are written into the HEAD so the face is settled before the
 * first paint, and a look's stylesheet loads after it — so a look setting --f would silently win
 * over the face the site chose in its settings. Nothing stops a look carrying more than colours in
 * general; this particular thing simply cannot be in two places.
 */

/*
 * `spec` is the Google Fonts v2 axis string for that family — its own, not a guess. `stack` is what
 * follows it when the face has not loaded, and it is chosen to be of the same species so the page
 * does not reflow into something shaped differently.
 */
export const FAMILIES = {
  /* ── serif, for display and for reading ── */
  Fraunces: { spec: 'ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500', stack: "'Fraunces', Georgia, serif", kind: 'serif', note: 'a soft display serif with an optical size axis — the theme’s own' },
  Bitter: { spec: 'ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,700', stack: "'Bitter', Georgia, serif", kind: 'serif', note: 'a slab serif that reads well small — the theme’s own body face' },
  Newsreader: { spec: 'ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500', stack: "'Newsreader', Georgia, serif", kind: 'serif', note: 'a newspaper serif, quiet at length' },
  Lora: { spec: 'ital,wght@0,400;0,500;0,600;0,700;1,400;1,500', stack: "'Lora', Georgia, serif", kind: 'serif', note: 'a calm book serif' },
  'Source Serif 4': { spec: 'ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400', stack: "'Source Serif 4', Georgia, serif", kind: 'serif', note: 'an even, unfussy text serif' },
  'Crimson Pro': { spec: 'ital,wght@0,400;0,500;0,600;0,700;1,400', stack: "'Crimson Pro', Georgia, serif", kind: 'serif', note: 'an old-style serif, warm at size' },
  'Libre Baskerville': { spec: 'ital,wght@0,400;0,700;1,400', stack: "'Libre Baskerville', Georgia, serif", kind: 'serif', note: 'high contrast, best for headings' },
  'Playfair Display': { spec: 'ital,wght@0,400;0,500;0,600;0,700;0,800;1,400', stack: "'Playfair Display', Georgia, serif", kind: 'serif', note: 'a sharp display serif — headings only' },
  'Instrument Serif': { spec: 'ital@0;1', stack: "'Instrument Serif', Georgia, serif", kind: 'serif', note: 'one weight, a lot of character — display only' },
  Spectral: { spec: 'ital,wght@0,400;0,500;0,600;0,700;1,400', stack: "'Spectral', Georgia, serif", kind: 'serif', note: 'a screen-first serif with a low, steady colour' },

  /* ── sans ── */
  Inter: { spec: 'ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400', stack: "'Inter', system-ui, -apple-system, sans-serif", kind: 'sans', note: 'the neutral screen sans' },
  'Plus Jakarta Sans': { spec: 'ital,wght@0,400;0,500;0,600;0,700;0,800;1,400', stack: "'Plus Jakarta Sans', system-ui, sans-serif", kind: 'sans', note: 'a friendly geometric sans' },
  Manrope: { spec: 'wght@400;500;600;700;800', stack: "'Manrope', system-ui, sans-serif", kind: 'sans', note: 'open and slightly technical' },
  'Work Sans': { spec: 'ital,wght@0,400;0,500;0,600;0,700;1,400', stack: "'Work Sans', system-ui, sans-serif", kind: 'sans', note: 'a workhorse with a little warmth' },
  'DM Sans': { spec: 'ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400', stack: "'DM Sans', system-ui, sans-serif", kind: 'sans', note: 'low contrast, very even' },
  Figtree: { spec: 'ital,wght@0,400;0,500;0,600;0,700;0,800;1,400', stack: "'Figtree', system-ui, sans-serif", kind: 'sans', note: 'rounded and approachable' },
  'Space Grotesk': { spec: 'wght@400;500;600;700', stack: "'Space Grotesk', system-ui, sans-serif", kind: 'sans', note: 'a squarish display sans' },
  Outfit: { spec: 'wght@400;500;600;700;800', stack: "'Outfit', system-ui, sans-serif", kind: 'sans', note: 'geometric, good very large' },
  Sora: { spec: 'wght@400;500;600;700;800', stack: "'Sora', system-ui, sans-serif", kind: 'sans', note: 'a modern sans with a technical edge' },

  /* ── mono ── */
  'IBM Plex Mono': { spec: 'ital,wght@0,400;0,500;0,600;1,400', stack: "'IBM Plex Mono', ui-monospace, Menlo, monospace", kind: 'mono', note: 'the theme’s own mono' },
  'JetBrains Mono': { spec: 'ital,wght@0,400;0,500;0,700;1,400', stack: "'JetBrains Mono', ui-monospace, Menlo, monospace", kind: 'mono', note: 'tall x-height, made for code' },
  'Space Mono': { spec: 'ital,wght@0,400;0,700;1,400', stack: "'Space Mono', ui-monospace, Menlo, monospace", kind: 'mono', note: 'a quirky mono with real personality' },
  'DM Mono': { spec: 'ital,wght@0,400;0,500;1,400', stack: "'DM Mono', ui-monospace, Menlo, monospace", kind: 'mono', note: 'quiet and narrow' },
  'Geist Mono': { spec: 'wght@400;500;600', stack: "'Geist Mono', ui-monospace, Menlo, monospace", kind: 'mono', note: 'clean and contemporary' },
}


/*
 * AND EVERY OTHER FAMILY GOOGLE SERVES.
 *
 * The two dozen above are the RECOMMENDED set: each was chosen, each carries a note for the person
 * picking, and each had its axis string written and checked by hand. They are not a limit. The
 * catalogue (build/google-fonts.json, refreshed by build/google-fonts.mjs) carries all 1,949
 * families with the weights and axes each one actually has, so any of them can be chosen and the
 * build can still make a request that family can answer.
 *
 * That last part is the whole reason the catalogue exists rather than a free text field. Asking
 * Google for a weight a family lacks does not fail — it serves something else and the browser fakes
 * the rest — so "any family you like" without knowing its axes is the silent fault again, wearing a
 * friendlier face.
 */
import CATALOGUE_JSON from './google-fonts.json' with { type: 'json' }
import { specOf as catalogueSpec, stackOf as catalogueStack, slotsOf as catalogueSlots, kindOf } from './google-font.mjs'

const catalogue = () => CATALOGUE_JSON
const byName = () => {
  if (!byName._m) byName._m = new Map(catalogue().map((f) => [f.n, f]))
  return byName._m
}

/* a family's record whether it is one of the recommended or one of the other nineteen hundred */
export function familyOf(name) {
  if (FAMILIES[name]) return { name, ...FAMILIES[name], recommended: true }
  const f = byName().get(name)
  if (!f) return null
  return { name, spec: catalogueSpec(f), stack: catalogueStack(f), kind: kindOf(f), note: '', recommended: false, slots: catalogueSlots(f) }
}

/* which slots a family may fill — the recommended say so by their kind, the rest by their category */
export const slotsFor = (name) => {
  const f = familyOf(name)
  if (!f) return []
  if (f.slots) return f.slots
  return Object.keys(SLOTS).filter((s) => SLOTS[s].kinds.includes(f.kind))
}

/*
 * THE PICKER'S SEARCH. The recommended first whatever the query, because they are the ones with a
 * reason behind them; then the catalogue in Google's own popularity order, which is a better
 * default order than alphabetical for a list nobody wants to read to the end of.
 */
export function searchFamilies(slot, q = '', limit = 60) {
  const want = String(q || '').trim().toLowerCase()
  const fits = (name) => slotsFor(name).includes(slot)
  const hit = (name) => !want || name.toLowerCase().includes(want)
  const rec = Object.keys(FAMILIES).filter((n) => fits(n) && hit(n)).map((n) => ({ ...familyOf(n) }))
  const rest = []
  for (const f of catalogue()) {
    if (rest.length >= limit) break
    if (FAMILIES[f.n]) continue
    if (!hit(f.n) || !catalogueSlots(f).includes(slot)) continue
    rest.push(familyOf(f.n))
  }
  return { recommended: rec, others: rest, more: !want && rest.length >= limit }
}

/* which faces a site may choose for each slot — a mono heading is nobody's friend */
export const SLOTS = {
  heading: { token: '--fd', kinds: ['serif', 'sans'], what: 'headings, the landing’s lines, a pull quote' },
  body: { token: '--f', kinds: ['serif', 'sans'], what: 'prose, the reader, every control' },
  mono: { token: '--m', kinds: ['mono'], what: 'code, a key, a figure that must line up' },
}

/*
 * THE THEME'S OWN. A sans pair, because the default palette is a software one and a serif default
 * under it read as somebody else's brand rather than a starting point.
 *
 * Changing these re-typesets any site that names none, so the root site now names Fraunces and Bitter
 * in its own content/site.md rather than inheriting them — a site keeps its type by SAYING what it
 * is, not by the theme never changing.
 */
export const DEFAULTS = { heading: 'Plus Jakarta Sans', body: 'Inter', mono: 'JetBrains Mono' }

export const familiesFor = (slot) => Object.entries(FAMILIES)
  .filter(([, f]) => SLOTS[slot].kinds.includes(f.kind))
  .map(([name, f]) => ({ name, note: f.note, stack: f.stack }))

/* what a site actually gets: its choice where it made one, the theme's where it did not */
export function resolveFonts(fonts = {}) {
  const out = {}
  for (const slot of Object.keys(SLOTS)) {
    const want = (fonts && fonts[slot]) || null
    const f = want ? familyOf(want) : null
    const name = f ? want : DEFAULTS[slot]
    out[slot] = { name, ...(f || FAMILIES[DEFAULTS[slot]]), token: SLOTS[slot].token }
  }
  return out
}

/*
 * A NAME NOBODY SERVES IS REFUSED, not silently swapped. A site naming a family that is not on the
 * list has almost certainly mistyped one that is, and quietly giving them the default would leave
 * them staring at a page that did not change.
 */
export function faultsIn(fonts = {}) {
  const out = []
  for (const [slot, want] of Object.entries(fonts || {})) {
    if (!want) continue
    if (!SLOTS[slot]) { out.push(`\`${slot}\` is not a typeface slot (${Object.keys(SLOTS).join(' · ')})`); continue }
    const f = familyOf(want)
    if (!f) {
      const stem = String(want).toLowerCase().slice(0, 4)
      const near = [...new Set([...Object.keys(FAMILIES), ...catalogue().slice(0, 400).map((x) => x.n)])].filter((n) => n.toLowerCase().includes(stem)).slice(0, 3)
      out.push(`\`${want}\` is not a family Google serves${near.length ? ` — did you mean ${near.join(' or ')}?` : ''}`)
      continue
    }
    if (!slotsFor(want).includes(slot)) out.push(`\`${want}\` is a ${f.kind} face and \`${slot}\` takes ${SLOTS[slot].kinds.join(' or ')}`)
  }
  return out
}

/* the one stylesheet link, families in a stable order so the url is the same between builds */
export function linkFor(fonts = {}) {
  const r = resolveFonts(fonts)
  const seen = new Map()
  for (const slot of ['heading', 'body', 'mono']) if (!seen.has(r[slot].name)) seen.set(r[slot].name, r[slot].spec)
  const q = [...seen.entries()].map(([name, spec]) => `family=${name.replace(/ /g, '+')}:${spec}`).join('&')
  return `https://fonts.googleapis.com/css2?${q}&display=swap`
}

/* the three tokens, as a :root block to go in the head before anything paints */
export function tokensFor(fonts = {}) {
  const r = resolveFonts(fonts)
  return `:root{${['heading', 'body', 'mono'].map((s) => `${r[s].token}:${r[s].stack}`).join(';')}}`
}
