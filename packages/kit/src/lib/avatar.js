/*
 * THE FACE A PERSON HAS WHEN THEY HAVE NOT CHOSEN ONE.
 *
 * Two letters in a coloured square is what every product draws before it has thought about it, and
 * a directory of them reads as a spreadsheet rather than as a room with people in it. DiceBear draws
 * a face from the person's own seed instead: the same face every time, on every device, for as long
 * as their id does not change — and drawn HERE, in the page, never fetched from anybody's CDN, so no
 * third party is told who is looking at whom.
 *
 * WHICH COLLECTION. A person who has chosen one has it on their profile; everybody else gets the
 * site's default, which the kit ships as `patchwork` — a pattern and not a face. An assigned face
 * has a presentation, and a presentation nobody chose can be wrong about the person wearing it; a
 * pattern is theirs and says nothing. The three a person may pick from (patchwork, big smile,
 * personas) are the only collections in the bundle, so the choice is short on purpose.
 *
 * Three rules this module keeps:
 *
 *   A PICTURE SOMEBODY CHOSE ALWAYS WINS. This is the fallback and nothing else; a component asks
 *   for it only when there is no uploaded face.
 *
 *   THE SEED IS SOMETHING THEY DO NOT EDIT, AND IT IS NOT THEIR ADDRESS. Every read that draws a
 *   person carries `avatar_seed` — a digest of their address, made in the database — so the same
 *   person is the same pattern on every surface and every device, while the address itself is
 *   disclosed to nobody. Their id where a read carries no seed, and where a component genuinely
 *   has only a name (a guest, a label), the name, which is honest. Never the display name of
 *   somebody who has an id: a rename must not make somebody a different pattern.
 *
 *   THE LICENCE METADATA STAYS. DiceBear writes the collection's attribution into each SVG, and
 *   several collections are licensed on the condition that it is there. It is never stripped to
 *   save bytes; the answers are memoising (below) and drawing each face once.
 */
import { Avatar } from '@dicebear/core'
import { STYLE, STYLES, BOT_STYLE, OPTIONS, DEFS } from '#site/avatar'

/* the collections a person may choose between, by the slug a profile stores. The slug never
   changes once it has been written to somebody's row. */
export const AVATAR_STYLES = Object.keys(STYLES)
const collection = (style) => (style && STYLES[style]) || STYLE

/* drawn once per seed and per size. A page shows the same handful of people over and over — a rail,
   a feed, a thread, a directory — and rendering is not free. */
const drawn = new Map()
const KEEP = 400   /* enough for a large directory; the oldest go rather than the map growing for ever */

/* WHAT A FACE IS DRAWN FROM. An id where there is one, so a rename does not change somebody's face;
   the name where there is not (a bot, a guest, somebody who has only ever been a name). */
/*
 * WHAT A DRAWN FACE IS DRAWN FROM, and it must be the SAME answer everywhere or one person wears two
 * faces. The database resolves it — what they chose, else a digest of their address — and hands it
 * to every surface; `avatar_seed` is that answer in most reads and `seed` is its name in
 * `my_profile`, where `avatar_seed` is instead what they actually picked and is usually empty.
 * Reading only `avatar_seed` there falls through to the id, which draws a different face from the
 * one the rooms are showing — which is exactly how the header came to disagree with every room.
 */
export const seedOf = (person) => String(
  (person && (person.avatar_seed || person.seed || person.user_id || person.id)) || (person && person.name) || person || '',
).trim().toLowerCase()

/* the SVG as a data url, ready for an <img src>. utf8 rather than base64: it is a third smaller and
   every browser has read it for twenty years. */
export function avatarUrl(seed, opts = {}) {
  const key = String(seed || '')
  if (!key) return ''
  /* EVERY option is in the key. Twice now a key that named only some of them has handed back a
     face drawn for different options — first the designed face, then the isolated thumbnails —
     and both times the symptom was a picker that looked broken with nothing in it to blame. The
     whole options object is the key; it is small, and being wrong here is silent. */
  const memo = key + '|' + JSON.stringify(opts)
  const had = drawn.get(memo)
  if (had) return had
  let url = ''
  try {
    const { style, parts, ...rest } = opts
    const svg = new Avatar(collection(style), { ...OPTIONS, ...optionsFor(parts), ...rest, seed: key }).toString()
    url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
  } catch (e) { return '' }   /* a collection that will not draw is not a reason for a blank page */
  if (drawn.size >= KEEP) drawn.delete(drawn.keys().next().value)
  drawn.set(memo, url)
  return url
}

/* the whole question a component asks: what do I put in this square. A picture they chose, else a
   face drawn for them, else nothing at all — and a component that gets nothing falls back to the
   initials it drew before, which is what a browser with no JavaScript for the SVG would show too. */
export const faceOf = (person, opts = {}) =>
  (person && person.avatar) || avatarUrl(seedOf(person), { style: (person && person.avatar_style) || undefined, parts: (person && person.avatar_options) || undefined, ...opts })

/* A BOT IS NOT A PERSON. Where one carries a picture in its own markdown that is what it wears;
   where it does not, it gets an identicon — a mark, which is what a bot is. It is never given one
   of the faces, because a face on a bot invites somebody to read a person into it. */
export const botFace = (bot, opts = {}) => {
  if (bot && bot.avatar) return bot.avatar
  const seed = String((bot && (bot.slug || bot.name)) || bot || '').trim().toLowerCase()
  if (!seed) return ''
  const memo = 'bot|' + seed + '|' + (opts.size || '')
  const had = drawn.get(memo)
  if (had) return had
  let url = ''
  try {
    const svg = new Avatar(BOT_STYLE, { ...OPTIONS, ...opts, seed }).toString()
    url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
  } catch { return '' }
  if (drawn.size >= KEEP) drawn.delete(drawn.keys().next().value)
  drawn.set(memo, url)
  return url
}

/*
 * WHAT A PERSON MAY CHOOSE, style by style.
 *
 * A seed gives somebody a face they did not choose; this is the other half — the parts of it they
 * can. DiceBear carries the answer in the style's own definition: `components` are the shapes (the
 * hair, the eyes, the mouth, the accessories) and `colors` are the palettes (the hair's, the
 * skin's). So nothing is hard-coded here and a style that gains a part next release gains it in
 * the picker too.
 *
 * The two are named differently on the way back IN, which is DiceBear's convention and not ours:
 * a shape is its own name (`hair: ['bangs']`) and a colour is that name plus Color
 * (`hairColor: ['220f00']`), hex without the hash. `optionsFor` does that translation in one place
 * so a component never has to know it.
 */
/*
 * SHOWING ONE PART AT A TIME.
 *
 * A row of thumbnails is there to answer one question — which eyes? — and it cannot answer it
 * while the glasses somebody already chose are drawn over every one of them. The whole row looks
 * identical and the choice is unreadable.
 *
 * So a thumbnail for trait X is drawn with everything ABOVE X taken off. Which parts those are is
 * the style's own business and it says so: canvas.elements lists the components in the order they
 * are drawn, bottom to top. Nothing here is a list of "things that get in the way" — a style that
 * gains a part, or reorders one, is handled the day it ships.
 *
 * What is left standing is everything below: choosing eyes on big-smile keeps the head and the
 * mouth and drops the hair and the glasses; choosing the mouth keeps the head and the eyes.
 */
export function drawOrder(style) {
  const def = (DEFS && (DEFS[style] || DEFS.patchwork)) || null
  return (((def && def.canvas) || {}).elements || []).filter((e) => e && e.type === 'component').map((e) => e.name)
}

/* the options that take everything drawn over `trait` off the face */
export function isolate(style, trait) {
  const order = drawOrder(style)
  const at = order.indexOf(trait)
  if (at < 0) return {}
  const off = {}
  for (const name of order.slice(at + 1)) off[name + 'Probability'] = 0
  return off
}

/*
 * THE ORDER SOMEBODY BUILDS A FACE IN, which is not the order a style definition happens to list
 * its components in — and not shapes-then-colours either, which puts "what colour is the skin"
 * after four questions about shapes drawn on top of it. A face is built from the skin outward.
 *
 * A part a style has that is not named here follows, in the definition's own order, so a style that
 * gains one is handled the day it ships rather than disappearing from the form.
 */
const PART_ORDER = {
  'big-smile': ['colour:skin', 'colour:hair', 'shape:hair', 'shape:eyes', 'shape:mouth', 'shape:accessories'],
}

/* the parts of a style as ONE ordered list, each `{ kind, name }` — shapes and colours together,
   because the person filling the form is not thinking in those two categories */
export function traitRows(style, traits) {
  const t = traits || traitsOf(style)
  const all = [
    ...Object.keys(t.colours || {}).map((name) => ({ kind: 'colour', name })),
    ...Object.keys(t.shapes || {}).map((name) => ({ kind: 'shape', name })),
  ]
  const want = PART_ORDER[style] || []
  const key = (r) => r.kind + ':' + r.name
  const first = want.map((w) => all.find((r) => key(r) === w)).filter(Boolean)
  const rest = all.filter((r) => !want.includes(key(r)))
  /* the definition's own order for anything unnamed, and shapes before colours there as before */
  rest.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'shape' ? -1 : 1))
  return [...first, ...rest]
}

export function traitsOf(style) {
  const def = (DEFS && (DEFS[style] || DEFS.patchwork)) || null
  if (!def) return { shapes: {}, colours: {} }
  const shapes = {}
  for (const [name, c] of Object.entries(def.components || {})) {
    const names = Object.keys((c && c.variants) || {})
    if (names.length > 1) shapes[name] = names        /* one variant is not a choice */
  }
  const colours = {}
  for (const [name, c] of Object.entries(def.colors || {})) {
    const values = ((c && c.values) || []).filter((v) => typeof v === 'string')
    if (values.length > 1) colours[name] = values
  }
  return { shapes, colours }
}

/*
 * A person's chosen parts → the options DiceBear takes. Anything not chosen is left to the seed,
 * which is what keeps a half-finished face a face rather than a default one.
 *
 * The two names differ, and this is the one place that knows it. A SHAPE is stored under the
 * component's own name (hair) and passed as that name plus Variant (hairVariant), because that is
 * what DiceBear 10 calls it — see OptionsDescriptor, which builds `${name}Variant` for every
 * component and `${name}Color` for every palette. A COLOUR is stored as the hex the definition
 * gives (#220f00) and passed without the hash, which is the form DiceBear validates.
 *
 * Getting this wrong is silent: the options fail validation, the draw throws, the url comes back
 * empty and a picker full of broken images is the only symptom.
 */
export function optionsFor(chosen) {
  const out = {}
  for (const [k, v] of Object.entries(chosen || {})) {
    if (v == null || v === '') continue
    /* NONE. A person may want no glasses and no hair, and DiceBear's way of saying that is a
       probability of nothing — the part is simply not drawn. It passes through as the number it
       is, where a shape and a colour are both wrapped in a list. */
    if (k.endsWith('Probability')) { out[k] = Number(v) || 0; continue }
    if (k.endsWith('Color')) out[k] = [String(v).replace(/^#/, '')]
    else out[k + 'Variant'] = [String(v)]
  }
  return out
}

/* the key a part is turned off with, and the test for whether it is */
export const offKey = (trait) => trait + 'Probability'
export const isOff = (parts, trait) => !!parts && parts[offKey(trait)] === 0
