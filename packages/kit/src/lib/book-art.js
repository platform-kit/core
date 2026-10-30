/*
 * A book as the store prints it, for wherever a book stands as an object: the front panel of its
 * softcover's printed cover — the e-book's picture with the mark and the edition line over it — by
 * the printer's dimensions, or null when the book is not in print (then the e-book's picture
 * stands alone). Book3D asks this by slug, so the hub, the shelves, the reader's cover page and
 * the landing all show the same object the store sells.
 */
import { books as BOOKS } from '#content'
import { printSpec, coverFor } from './print-offers.js'

/* the set editions, the bundle's copy or the live row (see print-index.js) — asked at call time */
import { editionsOf } from './print-index.js'

export function bookCoverOf(slug) {
  const book = BOOKS.find((entry) => entry.slug === slug)
  const cover = book && book.cover
  return typeof cover === 'string' ? cover : cover && cover.src ? cover.src : ''
}

export function printedArtOf(slug, format = 'softcover') {
  const b = BOOKS.find((x) => x.slug === slug); const spec = b && printSpec(b.print, b)
  const ed = spec && editionsOf(slug); const e = ed && ed.editions && ed.editions[spec.contents[0]]
  if (!e || !e.art || !e.dims) return null
  const cv = coverFor(e, format, spec.cloth, spec.foil)
  return cv ? { art: cv.art, dims: cv.dims, binding: cv.binding, trim: spec.trim, pages: e.pages, sheets: cv.sheets } : null
}
