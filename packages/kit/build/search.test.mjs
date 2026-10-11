/*
 * The search index's grammar — the rows the reader's palette searches and the rows the server's
 * search_content is built from, which are the same rows by construction (src/lib/search-rows.js).
 *
 * The two things worth pinning are the two that were wrong. A landing page's words live inside its
 * sections' props and nowhere else, so a page indexed from its body alone is a page with nothing in
 * it — and the landing pages are where a site says what it offers, which is the single most common
 * thing anybody asks a support bot. And a kind that belongs in the SERVER's index is not therefore
 * wanted in a reader's palette, where "Home" matching every other word helps nobody.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchRows, pageWords, OFF_PALETTE, offPalette, quotable, FREE_TO_QUOTE } from '../src/lib/search-rows.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nSEARCH\n')

/* ---- a page's words are harvested from its sections ---- */
{
  const sections = [
    { component: 'Hero', props: { lines: ['One big idea away', 'from your breakthrough'], cta: 'Take the quiz', href: '/app' } },
    { component: 'Pricing', props: { rows: [{ title: 'Membership', body: 'Every book, every chapter' }], tone: 'dusk', width: 'wide' } },
  ]
  const w = pageWords(sections)
  ok('a section’s copy is indexed', w.includes('One big idea away') && w.includes('Every book, every chapter'), w)
  ok('…down through lists and objects alike', w.includes('Membership'))
  ok('a path is not words', !w.includes('/app'))
  /* a one-word lower-case value is a setting (tone, width, a component name), not prose. Indexing
     them makes every page match "wide" and "dusk", which is noise in every result. */
  ok('a setting is not words', !/\bdusk\b/.test(w) && !/\bwide\b/.test(w), w)
  ok('nothing of nothing', pageWords() === '' && pageWords([{ component: 'X' }]) === '')
}

/* ---- the row a page becomes ---- */
{
  const rows = searchRows({ pages: [{ id: 'pricing', title: 'Pricing', description: 'What it costs', route: '/pricing',
    sections: [{ component: 'Pricing', props: { note: 'A membership opens every book' } }], body: '' }] })
  ok('one row per page', rows.length === 1 && rows[0].kind === 'page')
  ok('…at the route it is served from', rows[0].href === '/pricing')
  ok('…carrying its sections’ words', rows[0].text.includes('A membership opens every book'))
  ok('and a site with no pages has no page rows', searchRows({}).length === 0)
}

/* ---- what the palette leaves out ---- */
{
  const rows = [
    { kind: 'article', id: 'a', title: 'Money', sub: '', text: 'money money', tags: [], href: '/a' },
    { kind: 'page', id: 'p', title: 'Money', sub: '', text: 'money money', tags: [], href: '/p' },
    { kind: 'product', id: 'q', title: 'Money', sub: '', text: 'money money', tags: [], href: '/q' },
  ]
  const kinds = (kind) => offPalette(rows, kind).map((r) => r.kind)
  ok('a page is in the index', rows.some((r) => r.kind === 'page'))
  ok('…and out of an ordinary search', !kinds().includes('page'), kinds().join(','))
  ok('…unless the search asks for pages', kinds('page').includes('page'))
  ok('a product still behaves the same way', !kinds().includes('product'))
  ok('and an article is always there', kinds().includes('article') && kinds('page').includes('article'))
  ok('the two kinds are named in one place', OFF_PALETTE.includes('page') && OFF_PALETTE.includes('product'))
}

/* ---- WHAT MAY BE QUOTED IS NOT WHAT MAY BE SEARCHED ----

   The index matches on the full text of every book so that "money" finds the books about money.
   That is the whole value of it, and it is also how the library gets given away: a search that
   returns forty words of any book for any phrase is a way of reading the lot, one query at a time,
   by anybody, with no account — and a bot that quotes from it hands a free reader exactly what a
   paying one bought. Two columns, and the excerpt comes from the safe one. */
{
  const rows = searchRows({
    books: [{ slug: 'kybalion', title: 'The Kybalion', description: 'Seven principles.', raw: 'THE ALL IS MIND. The universe is mental.' }],
    articles: [{ id: 'a', title: 'A', description: 'd', body: '<p>free to read</p>' }],
  })
  const book = rows.find((r) => r.kind === 'book')
  const art = rows.find((r) => r.kind === 'article')
  ok('a book matches on the whole of itself', book.text.includes('universe is mental'))
  ok('…and quotes only what is on its cover', book.quote === 'Seven principles.', book.quote)
  ok('…so no paywalled line can be quoted back', !book.quote.includes('universe is mental'))
  ok('a free document quotes what it matches on', art.quote === art.text)
  ok('every row says which it is', rows.every((r) => typeof r.quote === 'string'))
  ok('a book is not free to quote', quotable('book') === false)
  ok('an article is', quotable('article') === true)
  /* a kind nobody has classified is treated as free, which is the forgiving default — so a NEW
     paywalled kind must be added to FREE_TO_QUOTE, and this is the line that says so out loud */
  ok('the kinds are named in one place', Object.keys(FREE_TO_QUOTE).length >= 6 && 'book' in FREE_TO_QUOTE)
}

/* ---- and the database agrees, which is where it actually matters ---- */
{
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'schemas', '13-search.sql'), 'utf8')
  ok('the excerpt is drawn from the quotable column', /ts_headline\('english', s\.quote,/.test(sql))
  ok('…and never from the matched one', !/ts_headline\('english', s\.body,/.test(sql))
  /* SECURITY DEFINER over the full text of every book: Postgres gives PUBLIC execute on a new
     function, and Supabase's default privileges give anon and authenticated theirs, so all three
     have to be taken back by name or the search is a scraper on the public API */
  /* by NAME, not by signature: an argument added later is not a reason for a security assertion to
     fail, and a signature baked into a regex is how a check quietly stops checking its own subject */
  const sig = '"public"\\."search_content"\\([^)]*\\)'
  ok('the search is revoked from PUBLIC', new RegExp('REVOKE ALL ON FUNCTION ' + sig + ' FROM PUBLIC;').test(sql))
  ok('\u2026and from anon and authenticated by name', new RegExp('REVOKE ALL ON FUNCTION ' + sig + ' FROM "anon", "authenticated";').test(sql))
  ok('\u2026leaving the server alone with it', new RegExp('GRANT EXECUTE ON FUNCTION ' + sig + ' TO "service_role";').test(sql))
  /* and the two narrowings added later are not droppable either */
  ok('a search is narrowed to the kinds the caller may see', /p_kinds is null or s\.kind = any\(p_kinds\)/.test(sql))
  ok('\u2026and to what their class may be shown', /access_allows\(s\.access, p_class\)/.test(sql))
  ok('and the table itself has no policy for a reader', !/CREATE POLICY[^;]*ON "public"\."content_search"/.test(sql))
}

console.log('\nsearch: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
