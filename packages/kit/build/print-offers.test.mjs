/* A book whose text is withheld (`fullText: false`) is in print as its summaries alone (src/lib/print-offers.js):
   the summary edition is the only contents it offers, and without one it is not in print. Pinned by npm test. */
import { printSpec, formatOffers } from '../src/lib/print-offers.js'

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail : '')) } }

const block = { key: 'a1b2c3d4', rights: 'Public domain.', contents: ['full', 'summary', 'parts'], formats: { softcover: 20, pdf: 5 } }
const book = { slug: 'probe', print: block }
const withheld = { ...book, fullText: false }

const open = printSpec(block, book)
ok('a book with its text offers every edition it lists', open && open.contents.join() === 'full,summary,parts', open && open.contents.join())
const sum = printSpec(block, withheld)
ok('a book whose text is withheld offers the summary edition alone', sum && sum.contents.join() === 'summary', sum && sum.contents.join())
ok('…and without a summary edition it is not in print', printSpec({ ...block, contents: ['full'] }, withheld) === null)
ok('…nor with the default contents, which hold the text', printSpec({ ...block, contents: undefined }, withheld) === null)
const offers = formatOffers(withheld)
ok('its offers carry the summary edition alone', offers.length === 2 && offers.every((o) => o.contents.join() === 'summary'), JSON.stringify(offers.map((o) => o.contents)))
ok('the block alone is read as before', printSpec(block).contents.join() === 'full,summary,parts')

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (a withheld book prints its summaries alone)`)
process.exit(fail ? 1 : 0)
