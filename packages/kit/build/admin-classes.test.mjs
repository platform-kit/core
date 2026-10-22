/*
 * EVERY `ui-` CLASS AN ADMIN COMPONENT WEARS IS A CLASS SOMETHING DEFINES.
 *
 * The admin's own stylesheet owns the `ui-` prefix precisely because the site's global sheet owns
 * bare names like `.wrap`, `.title` and `.warn` and would restyle anything that borrowed one. But
 * a prefix buys nothing against a TYPO or against a MODIFIER MISTAKEN FOR A CLASS, and both have
 * shipped:
 *
 *   `.ui-in` is not `.ui-input`. It is defined nowhere at all, and three field components wore it
 *   for as long as it took somebody to open the admin on the dark theme and notice a white box.
 *
 *   `.ui-wrap` is not a class either. It exists only as `.ui-row.ui-wrap` — a row that wraps —
 *   and People was wearing it alone as its page wrapper. That page had no column, no gutter and
 *   no top: its title sat a hundred and fifty-two pixels down an empty page, which is what sent
 *   somebody looking.
 *
 * So two checks. A class used at all must be defined somewhere; and a class used ON ITS OWN — its
 * element carrying no other `ui-` class — must be defined on its own somewhere, rather than only
 * as part of somebody else's compound. A modifier worn beside the thing it modifies is checked by
 * the first rule alone, which is what a modifier is for.
 *
 * Scoped is the right second home for a class a component invents: a scoped rule reaches only its
 * own component, so "defined in some other component" is not defined here.
 *
 * Run alone:  node packages/kit/build/admin-classes.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const THEME = path.resolve(HERE, '../theme/src')
const SHEET = path.join(THEME, 'components/admin/admin-ui.css')

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 8).join('\n    ')) } }

const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const f = path.join(d, e.name)
  return e.isDirectory() ? walk(f) : f.endsWith('.vue') ? [f] : []
}) : [])

/* every class name a selector mentions, anywhere in a block of css */
const defined = (css) => new Set([...css.matchAll(/\.(ui-[a-z0-9-]+)/g)].map((m) => m[1]))

/* and the ones a selector defines ON THEIR OWN: the last simple selector of a comma-part carries
   exactly one `ui-` class. `.ui-row.ui-wrap` defines neither on its own; `.ui-page` does. */
function alone(css) {
  const out = new Set()
  const noComments = css.replace(/\/\*[^]*?\*\//g, ' ')
  for (const block of noComments.split('}')) {
    const sel = block.split('{')[0]
    for (const part of sel.split(',')) {
      const last = part.trim().split(/[\s>+~]+/).pop() || ''
      const classes = [...last.matchAll(/\.(ui-[a-z0-9-]+)/g)].map((m) => m[1])
      if (classes.length === 1) out.add(classes[0])
    }
  }
  return out
}

/* what a template wears. `solo` is the classes whose element carries no other `ui-` class and no
   bound class that might add one — the set that has to stand on its own. */
function worn(src) {
  const at = src.indexOf('<template')
  if (at < 0) return { all: new Set(), solo: new Set() }
  const tpl = src.slice(at)
  const all = new Set(), solo = new Set()
  for (const m of tpl.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0]
    const stat = tag.match(/\bclass="([^"]*)"/)
    const ui = stat ? stat[1].split(/\s+/).filter((c) => /^ui-[a-z0-9-]+$/.test(c)) : []
    for (const c of ui) all.add(c)
    const bound = tag.match(/:class="([^"]*)"/)
    if (bound) for (const c of bound[1].matchAll(/'(ui-[a-z0-9-]+)'|\b(ui-[a-z0-9-]+)\b/g)) all.add(c[1] || c[2])
    if (ui.length === 1 && !bound) solo.add(ui[0])
  }
  return { all, solo }
}

const sheet = fs.readFileSync(SHEET, 'utf8')
const SHARED = defined(sheet)
const SHARED_ALONE = alone(sheet)
const FILES = [...walk(path.join(THEME, 'components/admin')), ...walk(path.join(THEME, 'pages'))]

t('the admin’s shared sheet is found and defines something', () => {
  assert.ok(SHARED.size > 50, `admin-ui.css mentions only ${SHARED.size} ui- classes`)
  assert.ok(SHARED_ALONE.has('ui-input'), 'the input class stands on its own')
  assert.ok(SHARED_ALONE.has('ui-page'), 'so does the page column')
  assert.equal(SHARED_ALONE.has('ui-wrap'), false, 'and ui-wrap is a modifier, which is the point')
})

t('no admin component wears a `ui-` class that nothing defines', () => {
  const orphans = []
  for (const f of FILES) {
    const src = fs.readFileSync(f, 'utf8')
    const own = defined(src.slice(src.indexOf('<style')))
    for (const c of worn(src).all) if (!SHARED.has(c) && !own.has(c)) orphans.push(path.relative(THEME, f) + ' → .' + c)
  }
  assert.deepEqual(orphans, [], 'a class that styles nothing:\n    ' + orphans.join('\n    '))
})

t('and none worn ON ITS OWN is defined only as somebody else’s modifier', () => {
  const wrong = []
  for (const f of FILES) {
    const src = fs.readFileSync(f, 'utf8')
    const style = src.slice(src.indexOf('<style'))
    const ownAlone = alone(style)
    for (const c of worn(src).solo) {
      if (SHARED_ALONE.has(c) || ownAlone.has(c)) continue
      wrong.push(path.relative(THEME, f) + ' → .' + c + ' — worn alone, defined only compounded')
    }
  }
  assert.deepEqual(wrong, [], 'a modifier mistaken for a class:\n    ' + wrong.join('\n    '))
})

console.log(bad ? `admin classes: ${n - bad} passed, ${bad} failed` : `admin classes: ${n} passed, 0 failed`)
process.exit(bad ? 1 : 0)
