/*
 * THE THREE FACES — the list, what is written, and what reaches the head.
 *
 * Five scenarios across `content-models`, `admin-cms` and `theme-contract` named this file as
 * their verifier and it did not exist, so the typefaces shipped checked by nothing: the schema
 * takes `fonts: { heading, body, mono }` as three optional STRINGS, which accepts "Comic Sans",
 * "helvetica", "" and a whole CSS stack alike. Everything needed to refuse those was already in
 * build/typefaces.mjs — the list Google serves, the slots, the defaults, the fault messages — and
 * nothing asked it anything.
 *
 * What is held here:
 *   · a family nobody serves is refused, by name, with a suggestion
 *   · a slot that is not one of the three is refused
 *   · a face left unset falls to the theme's default rather than to nothing
 *   · the link is a Google Fonts stylesheet naming exactly the chosen families
 *   · the tokens are a stack per slot, each ending in a real fallback, because a face that fails
 *     to load must not take the page's type with it
 *   · a site that names none still gets all three tokens — the fault that made this matter was a
 *     site with no palette resolving every var() to nothing, and type has the same shape
 */
import {
  FAMILIES, SLOTS, DEFAULTS, familyOf, familiesFor, resolveFonts, faultsIn, linkFor, tokensFor,
} from './typefaces.mjs'

console.log('\nTHE THREE FACES\n')
let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')) } }

/* ---- the list ------------------------------------------------------------------------------ */
ok('there are families to choose from', Object.keys(FAMILIES).length > 10, Object.keys(FAMILIES).length + ' family(ies)')
ok('and three slots, named', Object.keys(SLOTS).sort().join(' ') === 'body heading mono', Object.keys(SLOTS).join(' '))
ok('each slot has a default', ['heading', 'body', 'mono'].every((s) => DEFAULTS[s] && familyOf(DEFAULTS[s])), JSON.stringify(DEFAULTS))
for (const slot of Object.keys(SLOTS)) ok(`${slot} has families offered for it`, familiesFor(slot).length > 0)

/* every family in the list carries what the link and the tokens need of it */
{
  const bad = Object.entries(FAMILIES).filter(([, f]) => !f.spec || !f.stack || !/,/.test(f.stack))
  ok('every family declares a spec and a stack with a fallback after it', bad.length === 0,
    bad.map(([n]) => n).join(', '))
}

/* ---- what is refused ------------------------------------------------------------------------ */
ok('a family nobody serves is refused, by name', (() => {
  const f = faultsIn({ heading: 'Definitely Not A Font' })
  return f.length === 1 && f[0].includes('Definitely Not A Font')
})(), JSON.stringify(faultsIn({ heading: 'Definitely Not A Font' })))

ok('a slot that is not one of the three is refused', (() => {
  const f = faultsIn({ headline: 'Inter' })
  return f.length === 1 && /not a typeface slot/.test(f[0])
})(), JSON.stringify(faultsIn({ headline: 'Inter' })))

ok('a whole CSS stack is not a family', faultsIn({ body: "'Inter', system-ui, sans-serif" }).length === 1,
  JSON.stringify(faultsIn({ body: "'Inter', system-ui, sans-serif" })))

ok('a real family is accepted', faultsIn({ heading: 'Playfair Display', body: 'Inter' }).length === 0,
  JSON.stringify(faultsIn({ heading: 'Playfair Display', body: 'Inter' })))

ok('naming none is not a fault', faultsIn({}).length === 0)
ok('an empty string is not a fault either — it means "the theme\'s"', faultsIn({ heading: '' }).length === 0)

/* ---- what a site ends up with ---------------------------------------------------------------- */
{
  const none = resolveFonts({})
  ok('a site that names no face still resolves all three', ['heading', 'body', 'mono'].every((s) => none[s]),
    JSON.stringify(none))
  /* resolveFonts answers with the family RECORD, not its name */
  ok('and they are the theme\'s defaults', ['heading', 'body', 'mono'].every((s) => none[s].name === DEFAULTS[s]),
    ['heading', 'body', 'mono'].map((s) => s + '=' + none[s].name).join(' '))

  const one = resolveFonts({ heading: 'Playfair Display' })
  ok('a site that names one keeps the other two', one.heading.name === 'Playfair Display' && one.body.name === DEFAULTS.body && one.mono.name === DEFAULTS.mono,
    ['heading', 'body', 'mono'].map((s) => s + '=' + one[s].name).join(' '))
}

/* ---- the link and the tokens ------------------------------------------------------------------ */
{
  /* linkFor and tokensFor resolve for themselves, so they take what the SITE wrote */
  const chosen = { heading: 'Playfair Display' }
  const link = linkFor(chosen)
  ok('the link is a Google Fonts stylesheet', /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(link), link.slice(0, 70))
  ok('it names every chosen family', ['Playfair+Display', DEFAULTS.body.replace(/ /g, '+')].every((n) => link.includes(n)), link.slice(0, 140))
  ok('and asks the browser to swap rather than block', /display=swap/.test(link), link.slice(-40))

  const css = tokensFor(chosen)
  ok('the tokens are custom properties', /--[a-z]+:/.test(css), css.slice(0, 80))
  for (const want of ['Playfair Display', DEFAULTS.body, DEFAULTS.mono]) {
    ok(`the tokens carry ${want}`, css.includes(want), css.slice(0, 160))
  }
  ok('every stack ends in a generic family, so a face that never loads still sets type',
    (css.match(/--[a-z]+:\s*([^;]+);/g) || []).every((d) => /(serif|sans-serif|monospace|system-ui|cursive)\s*;?\s*$/.test(d)),
    css.slice(0, 200))

  /* a site that names nothing must still get a full set — the same shape as the palette fault */
  const bare = tokensFor({})
  ok('a site that names no face still gets all three tokens', (bare.match(/--[a-z]+:/g) || []).length >= 3, bare.slice(0, 120))
}

console.log(`\nfonts: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
