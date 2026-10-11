/*
 * A PALETTE IS COMPLETE, OR IT IS NOT A PALETTE.
 *
 * The theme shipped no colours at all for months. A site that registered no look got every token
 * empty, and the landing's button then resolved its text and its background to the same value: a
 * solid pill with the words invisible inside it. Nobody saw it because the one fixture with no
 * palette also had no landing page.
 *
 * That is the shape of the fault this exists to catch, and the shape is worth naming: AN INCOMPLETE
 * PALETTE DOES NOT LOOK BROKEN IN REVIEW. It looks right on every page somebody opened and wrong on
 * the one they did not. No amount of care finds that; only a derivation does.
 *
 * WHAT IS DERIVED, because a hand-kept list of "the tokens a look needs" would rot the day somebody
 * adds a token to the design:
 *
 *   READ        every `var(--x)` in the theme's own stylesheets and components
 *   DEFINED     every `--x:` those same files set — the theme's own defaults
 *   SET BY HAND every `--x` a component writes from script (an index, a delay, a mouse position);
 *               these are not a palette's business and must not be demanded of one
 *   OWED        read, not defined by the theme, not set from script — what a look must supply
 *
 * AND THE OWED ARE SPLIT BY WHAT THEY ARE, from the CSS property they are used in:
 *
 *   a COLOUR token (used in color, background, border-color, fill, stroke, box-shadow …) is a
 *     look's to define, and a look that misses one is incomplete
 *   a NON-COLOUR token (a padding, a measure, a font) read and defined nowhere is the THEME's
 *     fault, not a look's — the project's rule is that a rule which is not a colour lives in the
 *     one design and never in a look, so asking a palette for a padding is the bug
 *
 * That second direction is not decoration. It found three the day it was written.
 *
 *   node packages/kit/build/theme-look.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL ' + name + '\n    ' + String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }

console.log('\nA PALETTE IS COMPLETE\n')

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(HERE, '../../..')
const THEME = path.join(REPO, 'packages/movable-types/src')
if (!fs.existsSync(THEME)) { console.log('  ⚠ SKIPPED — the theme is not in this checkout\n'); process.exit(0) }

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(node_modules|dist)$/.test(e.name) && !e.name.startsWith('.')) walk(p, out) }
    else if (/\.(css|vue|js)$/.test(e.name)) out.push(p)
  }
  return out
}
const rel = (p) => path.relative(REPO, p)
/* a palette file, as opposed to the one design every palette colours */
const isLook = (f) => /[/\\]looks[/\\]/.test(f) && !f.endsWith('design.css')

/*
 * WHICH PROPERTIES TAKE A COLOUR. Read off the property the var sits in, so nothing is listed by
 * hand about the tokens themselves — a new colour token in a new rule classifies itself.
 */
const COLOURY = /(^|-)(color|background|background-color|border|border-color|outline|outline-color|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration-color|column-rule-color|scrollbar-color)$/
const isColourProp = (prop) => COLOURY.test(prop.trim().toLowerCase())

/*
 * A FALLBACK IS AN ANSWER. `var(--qbg, transparent)` is not a hole: the token is optional on
 * purpose and the declaration works without it. Only a bare `var(--x)` — or one whose fallback is
 * itself a bare var — is owed by a palette. Counting the ones with fallbacks was the check's first
 * draft and it reported eight gaps, six of which were fine.
 *
 * Reading it needs the parens matched rather than a regex: `var(--a, var(--b))` has a comma
 * inside a nested call, and `[^)]*` stops at the wrong bracket.
 */
const varsIn = (text) => {
  const out = []
  for (let i = text.indexOf('var('); i >= 0; i = text.indexOf('var(', i + 1)) {
    let depth = 0, j = i + 3, comma = -1
    for (; j < text.length; j++) {
      const ch = text[j]
      if (ch === '(') depth++
      else if (ch === ')') { depth--; if (!depth) break }
      else if (ch === ',' && depth === 1 && comma < 0) comma = j
    }
    if (depth) continue
    const inner = text.slice(i + 4, j)
    const name = (comma < 0 ? inner : text.slice(i + 4, comma)).trim()
    if (!/^--[a-z0-9-]+$/i.test(name)) continue
    out.push({ name, bare: comma < 0 })
    /* a nested var in the fallback is found by the loop's own next iteration */
  }
  return out
}

const FILES = walk(THEME)
const readIn = new Map()     /* token -> { where, colour, bare } */
const defined = new Set()
const scripted = new Set()

/*
 * A TOKEN NAMED IN A COMMENT IS NOT READ. This check flagged `--art` a second time after the
 * dead rule was removed, because the note left in its place says the token's name — the scan was
 * believing prose.
 *
 * BUT ONLY INSIDE A STYLESHEET, and the reason is worth keeping. Stripping CSS comments across a
 * whole .vue file eats the template: an attribute like accept="image/[star]" opens what looks
 * like a comment, and the next close-comment sequence anywhere below ends it. 2,927 characters
 * vanished from MarkdownEditor.vue that way, taking a `--sw` style binding with them, and the
 * token was then reported as owed by every palette in the project.
 *
 * So comments come out of .css files and out of a .vue file's <style> blocks, and nowhere else.
 * (This very comment then broke the file by containing a close-comment sequence of its own while
 * describing the fault, which is why it says [star] instead.)
 */
const CSS_COMMENT = new RegExp(String.raw`/\*[\s\S]*?\*/`, 'g')
const STYLE_BLOCK = new RegExp(String.raw`<style[^>]*>[\s\S]*?</style>`, 'gi')
const code = (text, file) => file.endsWith('.css')
  ? text.replace(CSS_COMMENT, ' ')
  : file.endsWith('.vue')
    ? text.replace(STYLE_BLOCK, (b) => b.replace(CSS_COMMENT, ' '))
    : text

for (const f of FILES) {
  const s = code(fs.readFileSync(f, 'utf8'), f)
  /* a declaration: `prop: … var(--x) …` — the property tells us what the token is for */
  for (const m of s.matchAll(/(^|[;{\n])\s*([a-z-]+)\s*:\s*([^;{}]*)/gi)) {
    const prop = m[2], value = m[3]
    for (const v of varsIn(value)) {
      const prev = readIn.get(v.name)
      const colour = isColourProp(prop)
      /* a token is owed if it is EVER used bare; a colour anywhere makes it a colour */
      if (!prev) readIn.set(v.name, { where: rel(f), prop, colour, bare: v.bare })
      else readIn.set(v.name, { where: v.bare && !prev.bare ? rel(f) : prev.where, prop: colour && !prev.colour ? prop : prev.prop, colour: colour || prev.colour, bare: v.bare || prev.bare })
    }
  }
  /* any var() the declaration split missed still counts as read */
  for (const v of varsIn(s)) if (!readIn.has(v.name)) readIn.set(v.name, { where: rel(f), prop: '?', colour: false, bare: v.bare })
  /*
   * A LOOK IS NOT THE THEME DEFINING A TOKEN.
   *
   * The theme's own default palette lives under src/looks/, and the moment it did, every token it
   * defines started counting as "the theme defines this" — the owed set emptied and every
   * per-look check below became true of nothing. The count printed at the end went from 2 to 0
   * and that is the only reason it was noticed.
   *
   * So a look's definitions do not count as the theme's. design.css is the exception and is not a
   * look: it is the one design every palette colours, and what it defines really is the theme's.
   */
  if (!isLook(f)) for (const m of s.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1])
  /* written from script: a style binding, a template literal, setProperty */
  for (const m of s.matchAll(/['"`](--[a-z0-9-]+)['"`]\s*[,:)]/g)) scripted.add(m[1])
  for (const m of s.matchAll(/setProperty\(\s*['"`](--[a-z0-9-]+)/g)) scripted.add(m[1])
}

/* the scan must actually be finding things, or every check below passes for the wrong reason */
t('the scan reads the theme', () => {
  assert.ok(FILES.length > 100, `only ${FILES.length} files — the walk is not reaching the theme`)
  assert.ok(readIn.size > 80, `only ${readIn.size} tokens read — the scan has stopped matching and every check below is vacuous`)
  assert.ok(defined.size > 80, `only ${defined.size} tokens defined — same`)
})

const owed = [...readIn.entries()].filter(([tok, v]) => v.bare && !defined.has(tok) && !scripted.has(tok))
const owedColour = owed.filter(([, v]) => v.colour).map(([k]) => k).sort()
const owedOther = owed.filter(([, v]) => !v.colour)

/*
 * THE THEME'S OWN SIDE OF IT. A token that is not a colour and that nothing defines is the theme
 * asking a palette for a padding, which the project's rule forbids in the other direction ("a rule
 * that is not a colour goes in the design, never in a look").
 */
t('the theme defines every non-colour token it reads', () => {
  const said = owedOther.map(([k, v]) => `${k} (${v.prop} in ${v.where})`)
  assert.deepEqual(said, [], `these are not colours and no look should carry them — the theme should define them itself:\n    ${said.join('\n    ')}`)
})

/* ─── every look, held to the colours ─── */

const LOOKS = [
  ['the theme’s default', 'packages/movable-types/src/looks'],
  ['the demo', 'sites/demo/src/looks'],
  ['the docs site', 'sites/docs/src/looks'],
]

const tokensOf = (file) => {
  const s = fs.readFileSync(file, 'utf8')
  return new Set([...s.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
}

let looksFound = 0
for (const [who, dir] of LOOKS) {
  const abs = path.join(REPO, dir)
  if (!fs.existsSync(abs)) continue
  for (const name of fs.readdirSync(abs)) {
    if (!name.endsWith('.css') || name === 'design.css') continue
    looksFound++
    const file = path.join(abs, name)
    const has = tokensOf(file)
    t(`${who}: ${name} defines every colour the theme reads`, () => {
      const missing = owedColour.filter((tok) => !has.has(tok))
      assert.deepEqual(missing, [], `${rel(file)} is missing ${missing.length}:\n    ${missing.join(' ')}\n    (each is read as a colour somewhere in the theme and defined nowhere)`)
    })
  }
}
t('there are looks to check', () => {
  assert.ok(looksFound >= 1, `only ${looksFound} look(s) found — the theme default palette must always be checked`)
})

/* ---- #site/looks falls back to the theme's, and a site's own does not --------------------- */
/*
 * A site that registers no look used to import no palette at all: `data-look` was stamped, every
 * var(--x) fell through to an undefined custom property, and the landing's button drew its text in
 * the colour of its own background. sites/brochure had that fault for months and escaped notice
 * only by having no landing page. So the plugin falls back to the theme's — and the fallback is
 * worth a check of its own, because it is invisible when it works and silent when it breaks.
 */
{
  globalThis.__veliteStarted = true
  const { createServer } = await import('vite')
  const { platformkit } = await import('../vite/index.mjs')
  const { loadSite: loadSiteCfg } = await import('./site.mjs')
  const cfg = await loadSiteCfg()
  const emitted = async (looks) => {
    const plugins = await platformkit({ root: process.cwd(), config: { ...cfg, looks, defaultLook: Object.keys(looks)[0] || '' } })
    const server = await createServer({ root: process.cwd(), configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null, hmr: false }, plugins })
    const r = await server.pluginContainer.resolveId('#site/looks')
    const out = await server.pluginContainer.load(r.id)
    await server.close()
    return typeof out === 'string' ? out : (out && out.code) || ''
  }

  const none = await emitted({})
  t('a site with no look imports the theme’s palette', () => {
    if (!/looks[/\\]default\.css/.test(none)) throw new Error('no import of the theme’s default: ' + none.slice(0, 200))
  })
  t('and names it as the default look', () => {
    if (!/DEFAULT_LOOK\s*=\s*["']default["']/.test(none)) throw new Error(none.slice(0, 200))
  })
  t('and offers no switcher, because LOOKS is what the SITE declared', () => {
    if (!/LOOKS\s*=\s*\[\s*\]/.test(none)) throw new Error('LOOKS should be empty: ' + none.slice(0, 200))
  })

  const own = await emitted(cfg.looks && Object.keys(cfg.looks).length ? cfg.looks : {})
  if (cfg.looks && Object.keys(cfg.looks).length) {
    t('a site with its own look imports that and not the theme’s', () => {
      if (/looks[/\\]default\.css/.test(own)) throw new Error('the theme’s default is imported beside the site’s own')
      if (!/LOOKS\s*=\s*\[[^\]]+\]/.test(own)) throw new Error('LOOKS should name the site’s: ' + own.slice(0, 200))
    })
  }
}

console.log(`\n  ${readIn.size} tokens read, ${defined.size} defined by the theme, ${scripted.size} set from script, ${[...readIn.values()].filter((v) => !v.bare).length} always given a fallback, ${owedColour.length} colours owed by a look`)
console.log(bad ? `\npalette: ${n - bad} passed, ${bad} failed\n` : `\npalette: ${n} passed, 0 failed\n`)
process.exit(bad ? 1 : 0)
