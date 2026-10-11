/*
 * THE COVER, AS TYPST SOURCE.
 *
 * One function, pure, because a cover is set in two places — the build on a machine and
 * print-render in a function — and those two must produce the same bytes. An edition is a hash of
 * its source, and `print.json` says which file a printer holds; two ways of writing a cover is two
 * covers for one edition id, and nobody could say which one is on the book.
 *
 * It takes what it needs and reads nothing: no files, no store, no printer. The dimensions come
 * from the printer that will make it, the words from the site's strings, the rest from the book
 * and its block.
 *
 * ONE THING IS NOT THE SAME EITHER SIDE, and it is deliberate: `picture` is where the paperback's
 * front sits IN THAT RUNTIME'S WORKSPACE — a path under .print on a machine, a mapped shadow file
 * in a function. The bytes are the same (build/print/picture.js takes both to the same pixels) and
 * the edition hashes the picture rather than its address, so the two paths set the same edition;
 * the hardcover's source, which has no picture, is byte-identical. Verified by rendering The
 * Golden Key both ways: edition 25e674ffcaa1d9cf, and interior.typ identical to the byte.
 *
 * A PAPERBACK'S FRONT IS THE E-BOOK'S OWN PICTURE, with the mark and the edition line over it; a
 * hardcover's is set in type. `foil-only` is the same design with only what is stamped — black on
 * white, for the printer's foil file and the store's mask.
 */

/* the escaping is the typesetter's own — one rule for the whole of the print, not a second copy
   of it here, which is exactly the drift this file exists to prevent */
import { str } from './typeset.mjs'

/* the trims, in points — the printer speaks points and the block speaks inches */
export const TRIM_PT = { '6x9': { w: 432, h: 648 }, '5x8': { w: 360, h: 576 } }

/* the introduction's first paragraph, as plain words, for the back of the jacket */
export const opening = (md) => String(md || '').trim().split(/\n\s*\n/)[0]
  .replace(/==([^=]+)==(?:\{[a-z]+\})?/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(.+?)\1/g, '$2')
  .replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1').replace(/\s+/g, ' ').trim()

/*
 * @param d        the printer's dimensions: width, height, bleed, spine, flap — all in points
 * @param book     title, author, description, introduction
 * @param spec     the print block: blurb, flap
 * @param words    the print words (`## print / ### book` in the library scope)
 * @param spine    { title, edition } — what the spine and the foil say, which must agree
 */
export function coverSource({ d, trim = '6x9', cloth, foil, foilOnly = false, paperback = false, picture = '',
  book = {}, companion = null, spec = {}, words = {}, spine = {} }) {
  const W = words || {}
  const t = TRIM_PT[trim] || TRIM_PT['6x9']
  /* the source imports the template by NAME, which travels with the kit rather than the site — a
     site-rooted path broke the first deploy after the extraction */
  return `#import "cover.typ": *
#cover(width: ${d.width}pt, height: ${d.height}pt, bleed: ${d.bleed}pt, spine: ${d.spine}pt, flap: ${d.flap || 0}pt, trim-width: ${t.w}pt,
  cloth: ${str(cloth)}, foil: ${str(foil)}, foil-only: ${foilOnly ? 'true' : 'false'}, picture: ${str(paperback && picture ? picture : '')},
  title: ${str(book.title || '')}, author: ${str(book.author || '')}, insight: ${str((companion && companion.insight) || '')}, description: ${str(book.description || '')}, opening: ${str(spec.blurb || opening(book.introduction))}, about-text: ${str(spec.flap || '')},
  edition: ${str(W.edition || '')}, spine-title: ${str(spine.title || '')}, spine-edition: ${str(spine.edition || '')}, edition-line: ${str(W['edition-line'] || '')}, about: ${str(W['jacket-about'] || '')}, this-edition: ${str(W['jacket-edition'] || '')}, site: ${str(W.site || '')})
`
}

/* ---- the covers a block calls for, and what each one is filed as ----
   Shared for the same reason the source is: the build names a cover file and the function names
   it, and a cover under a name nothing looks for is a cover nobody prints. */

/* a cover's key — the format, its printer, and a linen's colours — and the file it is in */
export const coverKey = (format, provider, cloth, foil) => cloth ? `${format}-${provider}-${cloth}-${foil}` : `${format}-${provider}`
export const coverName = (key) => `cover-${key}.pdf`
export const foilName = (key) => `foil-${key}.pdf`

/* the covers one format calls for: a linen at Lulu is a jacket per cloth × foil the buyer may
   pick, and every other cover is one */
export function coversOf({ format, provider, product, combos, spec, trim, paper, options, printerOf }) {
  const linen = format === 'hardcover' && product.style === 'linen'
  const many = linen && combos.length > 1
  const variants = linen
    ? combos.map(([cloth, foil]) => ({ cloth, foil, product: printerOf({ chosen: { format, trim, paper, cloth, foil }, options }) }))
    : [{ cloth: spec.cloth, foil: spec.foil, product }]
  return variants.map((v) => ({ ...v, key: coverKey(format, provider, many || linen ? v.cloth : null, v.foil) }))
}
