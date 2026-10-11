/*
 * WHAT A GOOGLE FAMILY IS, from the catalogue's own record of it. Pure — no imports, no fs, no
 * environment — because the admin's picker reads this in the browser and the build reads it under
 * Node, and a catalogue helper that could only run on one of them would need writing twice.
 *
 * The catalogue itself is google-fonts.json, compiled from Google's metadata by
 * build/google-fonts.mjs. See that file for why it is committed rather than fetched.
 */

/*
 * THE AXIS STRING FOR A FAMILY, from what it actually has.
 *
 * Only the weights the theme can use are asked for — 300 to 800 — because requesting every weight
 * a family offers can be a megabyte for a page that shows three of them. Italic is asked for only
 * where the family has one, since `ital,wght@1,400` on a family with no italic is a request Google
 * answers with nothing and the browser then slants by hand.
 */
const WANTED = [300, 400, 500, 600, 700, 800]
export function specOf(f) {
  const weights = (f.w || []).filter((w) => WANTED.includes(w))
  const use = weights.length ? weights : [(f.w || [400])[0]]
  if (!f.i) return `wght@${use.join(';')}`
  return `ital,wght@${use.map((w) => `0,${w}`).join(';')};${use.map((w) => `1,${w}`).join(';')}`
}

/* what a family falls back TO, by what kind of face it is — the same species, so a page whose font
   has not arrived is not also a page laid out to different proportions */
const FALLBACK = {
  f: 'Georgia, serif',
  s: 'system-ui, -apple-system, sans-serif',
  m: 'ui-monospace, Menlo, monospace',
  d: 'Georgia, serif',
  h: 'cursive',
}
export const stackOf = (f) => `'${f.n}', ${FALLBACK[f.c] || 'sans-serif'}`

/* which slots a family may fill: a display or handwriting face is a heading, never body text */
export const slotsOf = (f) => (f.c === 'm' ? ['mono'] : f.c === 'd' || f.c === 'h' ? ['heading'] : ['heading', 'body'])

/* the kind word the picker and the refusals use */
export const kindOf = (f) => ({ m: 'mono', f: 'serif', s: 'sans', d: 'display', h: 'handwriting' })[f.c] || 'sans'
