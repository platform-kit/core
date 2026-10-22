/*
 * THE STORE'S GENERAL MACHINERY MAY NOT NAME A KIND OF THING.
 *
 * A book has editions, a trim, a spine, foil and a page count. A garment has a blueprint and a
 * placement. An ordinary product has neither, and a shop selling mugs must not carry either
 * vocabulary in its database or its code. The seam that makes that possible is build/kinds —
 * two slots and an opaque artefact record — and a seam is only real if something refuses to let
 * it leak.
 *
 * So this test runs BOTH WAYS, and the second direction matters as much as the first:
 *
 *   1. the store's own machinery names no kind of thing;
 *   2. those words ARE still in print, where they belong.
 *
 * Without (2) a refactor that deleted print's vocabulary entirely would pass, which is the
 * opposite of the thing being asked for. Written before the store's tables exist, so it is a
 * constraint on the work rather than an audit of it; it passes today because none of them does.
 *
 * `npm test` runs it, and it is run again at the end of every phase of this change.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIT = path.join(HERE, '..')
let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')) } }

/* the words that belong to one kind of thing and to no shared table */
const BOOKISH = ['edition', 'spine', 'foil', 'cloth', 'trim', 'chapter', 'paperback', 'hardcover', 'casewrap', 'interior', 'typeset']
const CLOTHISH = ['blueprint', 'placement', 'garment', 'colourway', 'colorway']
/* 'book', 'cover', 'page' and 'size' are deliberately NOT here: each has an ordinary meaning in
   a store ("book a session", a cover image, a page of results, a file size), and a word list that
   cries wolf is a word list somebody switches off. The twelve above have no innocent reading. */
const FORBIDDEN = [...BOOKISH, ...CLOTHISH]

/* THE STORE'S OWN MACHINERY — what this change builds. A path here must never speak of a kind.
   Listed rather than globbed so that adding a file is a deliberate act with this rule in view. */
const GENERAL = [
  'build/kinds/index.js',
  'build/variants.mjs',
  'build/store-separation.test.mjs',   /* itself: it may NAME the words, which is why it is checked apart */
]
const SELF = 'build/store-separation.test.mjs'

/* THE ONE PLACE A SHARED TABLE STILL SPEAKS OF BOOKS, AND THE DAY IT STOPS.
   `fulfilments` carried six columns of print's own — book, edition, format, contents, cloth,
   foil — beside `chosen`, which is the slot every kind writes. Nothing reads them now, but they
   cannot be dropped in the same deploy as the backfill that empties them into `chosen`: the plan
   is renames, then the diff, then the data script, so the drop would run first.
   So the exception is DATED BY ITS OWN FAILURE rather than by a promise. The set below is exact:
   add a seventh bookish column and this fails; drop the six and it fails too, which is what makes
   somebody delete the exception instead of leaving it to become folklore — the same lesson the
   modes matrix learnt when a closed gap sat on the debt list and was read back off it as fact. */
const CARRYING = 'supabase/schemas/43-orders.sql'
const CARRIED = ['edition', 'cloth', 'foil']   /* the bookish three of the six; book/format/contents have innocent readings */
/* and the six as a row would name them. `bought.book` is an OFFER's book and perfectly fine;
   `row.book` is the dead column, and so is `new.contents` in a trigger. Nothing may read one:
   the row carries `variant` and `chosen`, and `chosenOf` is the only thing that opens them. */
const DEAD = ['book', 'edition', 'format', 'contents', 'cloth', 'foil']
const READERS = [
  'supabase/functions/_shared/print.ts',
  'supabase/functions/_shared/ledger.ts',
  'supabase/functions/print-order/index.ts',
  'supabase/functions/print-webhook/index.ts',
  'supabase/functions/lulu-webhook/index.ts',
  'supabase/schemas/90-spaces.sql',
  'supabase/schemas/96-agents.sql',
  'theme/src/components/Orders.vue',
  'theme/src/components/PrintOrders.vue',
]

/* and the files that are allowed — required — to hold them */
const PRINTS = ['build/print', 'src/lib/print-offers.js', 'supabase/functions/_shared/print.ts']
/* and the garment's, for the same reason in the other direction: a refactor that emptied the
   apparel kind would otherwise pass check (1) with flying colours */
const CLOTHES = ['build/kinds/apparel.js', 'supabase/functions/_shared/suppliers/printify.js']

const read = (rel) => { try { return fs.readFileSync(path.join(KIT, rel), 'utf8') } catch { return null } }
/* A WORD IN A COMMENT IS DOCUMENTATION; A WORD IN CODE IS THE LEAK. `build/kinds` explains
   itself by naming the kinds it exists to hold apart — "a book in print has editions, a trim, a
   spine" — and a check that refused that would be a check against saying what the code is for.
   So comments and string literals of prose come out, and what is left is identifiers, keys,
   columns and values: the places a word would actually bind the store to one kind of thing. */
const code = (src) => src
  .replace(/\/\*[^]*?\*\//g, ' ')       /* block comments */
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  /* line comments, leaving a url's // alone */
  /* and SQL's own, which a declaration is mostly made of: without this a column's reason for
     existing counts as the column, and the comment explaining that editions are NOT columns here
     reads as an edition column — a false positive that would have blocked the very drop the
     carried-over check exists to force */
  .replace(/--[^\n]*/g, ' ')
const walk = (rel, out = []) => {
  const abs = path.join(KIT, rel)
  let st; try { st = fs.statSync(abs) } catch { return out }
  if (st.isFile()) { out.push(rel); return out }
  for (const e of fs.readdirSync(abs)) walk(path.join(rel, e), out)
  return out
}

/* ---- the carried-over six, held to exactly themselves ---- */
{
  const src = read(CARRYING)
  ok('the orders declaration is there to be checked', !!src, CARRYING)
  if (src) {
    const body = code(src)
    const found = FORBIDDEN.filter((w) => new RegExp('\\b' + w, 'i').test(body)).sort()
    const want = [...CARRIED].sort()
    ok('the shared orders table speaks of books in exactly the six columns being carried over, and nowhere else',
      found.join(',') === want.join(','),
      found.join(',') === want.join(',') ? '' :
        'expected ' + (want.join(', ') || '(none)') + ' — found ' + (found.join(', ') || '(none)') +
        '.\n          If the six have been dropped: delete CARRYING, CARRIED and this check — the exception is over.' +
        '\n          If something new was added: a shared table may not name a kind of thing.')
  }
}

/* ---- and nothing reads the dead six off a row ---- */
{
  const bad = []
  for (const rel of READERS) {
    const src = read(rel)
    if (src === null) { bad.push(rel + ' (missing — the list is stale)'); continue }
    const body = code(src)
    for (const m of body.matchAll(new RegExp('(?:\\b(row|new|old)\\s*\\.\\s*(' + DEAD.join('|') + ')|\\b(f|ful)\\s*\\.\\s*(' + DEAD.filter((d) => d !== 'format').join('|') + '))\\b', 'gi'))) {
      bad.push(rel + ': ' + m[0])
    }
  }
  ok('nothing reads a fulfilment\'s dead print columns off the row', bad.length === 0,
    bad.length ? bad.join('\n          ') + '\n          A row carries variant and chosen; chosenOf() is the only reader of what a kind derived.' : '')
}

console.log('\nTHE STORE NAMES NO KIND OF THING\n')

/* ---- 1. the general machinery is clean ---- */
for (const rel of GENERAL) {
  if (rel === SELF) continue
  const src = read(rel)
  if (src === null) continue   /* not built yet — the point is that it is clean WHEN it exists */
  const found = FORBIDDEN.filter((w) => new RegExp('(^|[^.\\w])' + w + '\\b', 'i').test(code(src)))
  ok(`${rel} names no kind of thing`, found.length === 0, found.length ? 'found: ' + found.join(', ') : '')
}
ok('the general machinery is listed, so adding a file is deliberate', GENERAL.length > 0)

/* ---- 2. the words ARE still in print ----
   the other direction: a refactor that deleted print's vocabulary would otherwise pass */
{
  let printed = ''
  for (const p of PRINTS) for (const rel of walk(p)) { const s = read(rel); if (s) printed += s }
  ok('print still exists to be checked against', printed.length > 1000, printed.length + ' bytes read')
  const absent = BOOKISH.filter((w) => !new RegExp('\\b' + w, 'i').test(printed))
  ok('a book\'s words are still in print, where they belong', absent.length === 0, absent.length ? 'missing from print: ' + absent.join(', ') : '')
}

/* ---- 2b. and a garment's words ARE in the garment's kind ---- */
{
  let cloth = ''
  for (const p of CLOTHES) for (const rel of walk(p)) { const s = read(rel); if (s) cloth += s }
  ok('the apparel kind exists to be checked against', cloth.length > 1000, cloth.length + ' bytes read')
  const absent = CLOTHISH.filter((w) => !new RegExp('\\b' + w, 'i').test(cloth))
  ok('a garment\'s words are in its own kind, where they belong', absent.length === 0, absent.length ? 'missing: ' + absent.join(', ') : '')
}

/* ---- 3. the seam itself: a kind reaches the store through two slots and no more ---- */
{
  const { checkKind } = await import('./kinds/index.js')
  const good = { key: 'book', produces: ['interior'], options: async () => [], artefacts: async () => ({}) }
  ok('a kind keeping the shape is accepted', checkKind(good).length === 0)
  ok('a kind reaching past its two slots is refused', checkKind({ ...good, query: () => {} }).some((m) => /nothing else/.test(m)))
  ok('a kind with no key is refused', checkKind({ ...good, key: '' }).length > 0)
  ok('a kind that does not say what it produces is refused', checkKind({ ...good, produces: undefined }).length > 0)
  ok('nonsense is refused rather than thrown at', Array.isArray(checkKind(null)) && checkKind(null).length > 0)
}

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
