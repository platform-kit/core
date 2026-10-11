/*
 * WHAT MAKES AN EDITION AN EDITION.
 *
 * A printed edition is a sixteen-character hash, and an unusual amount rests on it: the bucket
 * files to `<slug>/<edition>/`, `print.json` records which edition a printer holds, a proof records
 * the edition a copy was READ at, and a book already set at an edition is never set again.
 *
 * So the hash has two ways to be wrong and they cost opposite things. Too SENSITIVE — something in
 * it that is not the book — and every deploy re-sets every edition, paying a printer's setup fee
 * again and invalidating every proof anybody has read. Too BLUNT — something missing from it — and
 * a changed word ships under the old edition id: the file in the bucket is not the book the proof
 * was read at, and nobody can tell, because the id is the only thing that would have said so.
 *
 * The module's own header says what is in and what is out. This holds it to that list, item by
 * item, in both directions — and holds the ORDER too, since the hash is a join and two paths that
 * assembled the same parts differently would give one book two editions.
 *
 * Run alone:  node packages/kit/build/edition-id.test.mjs
 */
import assert from 'node:assert/strict'
import { editionId, editionParts, editionFor, pictureId, partsOf, PART_NAMES } from './print/edition.mjs'

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 5).join('\n    ')) } }

const BASE = {
  templates: ['book.typ bytes', 'cover.typ bytes'],
  source: '# A Chapter\n\nSome words.',
  trim: '6x9', paper: 'cream',
  spec: { cloth: 'black', foil: 'gold', printers: { softcover: 'lulu' }, providers: { lulu: { package: 'x' } } },
  printed: ['softcover', 'hardcover'], combos: [['black', 'gold'], ['navy', 'silver']],
  epub: true, insight: 'The insight.', description: 'The description.',
  picture: 'aaaaaaaaaaaaaaaa',
}
const id = (over = {}) => editionFor({ ...BASE, ...over })
const spec = (over) => ({ spec: { ...BASE.spec, ...over } })

t('the same book gives the same id', () => {
  assert.equal(id(), id())
  assert.match(id(), /^[0-9a-f]{16}$/)
})

/* ─── what MUST change it: each of these is the book being different ─── */

const MOVES = {
  'a changed template': { templates: ['book.typ CHANGED', 'cover.typ bytes'] },
  'a changed word in the text': { source: BASE.source + ' One more.' },
  'a different trim': { trim: '5x8' },
  'a different paper': { paper: 'white' },
  'a different cloth': spec({ cloth: 'navy' }),
  'a different foil': spec({ foil: 'silver' }),
  'a different printer': spec({ printers: { softcover: 'mixam' } }),
  "a printer's options": spec({ providers: { lulu: { package: 'y' } } }),
  'another format sold': { printed: ['softcover'] },
  'another colour the buyer may pick': { combos: [['black', 'gold']] },
  'an EPUB sold where none was': { epub: false },
  'the jacket insight': { insight: 'Something else entirely.' },
  'the jacket description': { description: 'Something else entirely.' },
  /* THE ONE THE SCENARIO NAMES: a sharper picture is a new paperback edition */
  'a sharper picture': { picture: 'bbbbbbbbbbbbbbbb' },
}
for (const [what, over] of Object.entries(MOVES)) {
  t(`${what} makes a new edition`, () => assert.notEqual(id(over), id(), 'the id did not move'))
}

/* ─── and what must NOT: a listing nicety is not the book ─── */

t('a field the hash does not take is ignored', () => {
  /* the page pictures are the clear case: the cloud makes none, and a book set with them and one
     set without them must be the same edition or the two paths could never agree */
  assert.equal(editionFor({ ...BASE, shots: ['page-1.jpg'], setAt: '2026-01-01', anythingElse: true }), id())
})
t('a picture is identified by its bytes, not its name or its date', () => {
  const a = pictureId(Buffer.from([1, 2, 3]))
  assert.equal(a, pictureId(Buffer.from([1, 2, 3])))
  assert.notEqual(a, pictureId(Buffer.from([1, 2, 4])))
  assert.match(a, /^[0-9a-f]{16}$/)
})
t('no picture at all is the empty identity, not a hash of nothing-in-particular', () => {
  assert.equal(pictureId(null), '')
  assert.equal(pictureId(Buffer.alloc(0)), '')
})

/* ─── the order, because the hash is a join ─── */

t('the parts come out in one fixed order', () => {
  const p = editionParts(BASE)
  assert.deepEqual(p.slice(0, 2), BASE.templates)
  assert.equal(p[2], BASE.source)
  assert.equal(p[3], '6x9')
  assert.equal(p[4], 'cream')
  assert.equal(p[p.length - 1], BASE.picture)
})
/* two parts swapped is the failure mode that gives one book two editions on two machines */
t('two parts swapped give a different id', () => {
  const p = editionParts(BASE)
  const swapped = [...p]; const tmp = swapped[3]; swapped[3] = swapped[4]; swapped[4] = tmp
  assert.notEqual(editionId(swapped), editionId(p))
})
t('a part that is empty is still a part, so removing one is not the same as blanking it', () => {
  const p = editionParts(BASE)
  assert.notEqual(editionId(p.filter((_, i) => i !== 3)), editionId(p.map((x, i) => (i === 3 ? '' : x))))
})

/* ─── the diagnostic, which must never become an input ─── */

t('partsOf names every part, and names them all', () => {
  const named = partsOf(BASE)
  assert.equal(Object.keys(named).length, editionParts(BASE).length, 'a part has no name')
  for (const k of Object.keys(named)) assert.ok(PART_NAMES.includes(k), `"${k}" is not in PART_NAMES`)
  for (const v of Object.values(named)) assert.match(v, /^[0-9a-f]{16}$/)
})
t('and two books side by side name which part moved', () => {
  const a = partsOf(BASE), b = partsOf({ ...BASE, paper: 'white' })
  const moved = Object.keys(a).filter((k) => a[k] !== b[k])
  assert.deepEqual(moved, ['paper'])
})
t('partsOf is a diagnostic and not an input: editionId reads the flat list', () => {
  assert.equal(editionId(editionParts(BASE)), editionFor(BASE))
})

console.log(bad ? `edition-id: ${n - bad} passed, ${bad} failed` : `edition-id: ${n} passed, 0 failed`)
process.exit(bad ? 1 : 0)
