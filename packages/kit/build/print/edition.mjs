/*
 * WHAT MAKES AN EDITION AN EDITION.
 *
 * An edition is a sixteen-character hash, and everything downstream leans on it: the bucket files
 * to `<slug>/<edition>/`, `print.json` says which edition a printer holds, a proof records the
 * edition a copy was read at, and a book already set at an edition is never set again. So the
 * hash has to be taken over the same things in the same order wherever a book is set — on a
 * machine and in print-render — or the same book would come out as two editions and nobody could
 * say which one is on the shelf.
 *
 * WHAT IS IN IT: the templates (a changed template is a changed book), the typeset source, the
 * trim and paper, the linen's colours, which formats are sold and which colours the buyer may
 * pick, who prints each and with what options, whether an EPUB is sold, the two lines the jacket
 * carries, and the paperback's picture BYTE FOR BYTE — so a sharper picture dropped beside the
 * book is a new edition and is set.
 *
 * WHAT IS NOT: anything that is a listing nicety rather than the book. The page pictures are the
 * clear case — the cloud makes none, and a book set with them and a book set without them must be
 * the same edition or the two paths could never agree.
 */
import { createHash } from 'node:crypto'

export const editionId = (parts) => createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16)

/* the picture's own identity: its bytes, not its name or its date */
export const pictureId = (bytes) => (bytes && bytes.length ? createHash('sha1').update(new Uint8Array(bytes)).digest('hex').slice(0, 16) : '')

/* the parts, in the one order both paths take them in */
export function editionParts({ templates = [], source, trim, paper, spec = {}, printed = [], combos = [], epub = false, insight = '', description = '', picture = '' }) {
  return [
    ...templates, source, trim, paper, spec.cloth, spec.foil,
    printed.join(','), combos.map((x) => x.join('-')).join(','),
    JSON.stringify(spec.printers), JSON.stringify(spec.providers),
    epub ? 'epub' : '', String(insight || ''), String(description || ''), picture,
  ]
}

export const editionFor = (parts) => editionId(editionParts(parts))

/*
 * WHY TWO EDITIONS DIFFER. The parts are a flat list by design — the hash is their join — but when
 * a book comes out as one edition on a machine and another in a function, the only useful question
 * is WHICH part moved. So the same list, labelled, each part hashed on its own: two of these side
 * by side name the difference in one line instead of leaving somebody to diff a whole typeset
 * source by eye. It is a diagnostic, never an input: `editionId` reads the flat list.
 */
export const PART_NAMES = ['book.typ', 'cover.typ', 'source', 'trim', 'paper', 'cloth', 'foil', 'formats', 'colours', 'printers', 'options', 'epub', 'insight', 'description', 'picture']
export function partsOf(parts) {
  const list = editionParts(parts)
  /* the templates are however many were given; everything after them is named in order */
  const n = (parts.templates || []).length
  const names = [...PART_NAMES.slice(0, 2).slice(0, n), ...PART_NAMES.slice(2)]
  return Object.fromEntries(list.map((v, i) => [names[i] || String(i), editionId([String(v ?? '')])]))
}
