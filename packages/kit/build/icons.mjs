/*
 * The icons a site's pages name, as SVG: a landing section's glyph is a name — one of the theme's own
 * few, or any of Lucide's — and the page carries the name, never the drawing. This writes
 * `.velite/icons.json` (name → the icon's inner SVG, on Lucide's 24-grid) for every Lucide name a
 * page under content/pages names in an `icon` field, reading the drawings from the lucide-vue-next
 * package the theme already carries (its icon modules are plain node arrays) — so the site's bundle
 * holds the icons it draws and nothing else, and `icon-names.json` (every name, for the admin's
 * picker). In dev every icon is written, so a name picked in the builder draws at once.
 *
 *   node build/icons.mjs [--all]     --all: every icon, as the dev server runs it
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import matter from 'gray-matter'

const ROOT = process.cwd()
const require = createRequire(path.join(ROOT, 'package.json'))
const DIR = path.dirname(require.resolve('lucide-vue-next/package.json')) + '/dist/esm/icons'
/* THE THEME'S OWN FEW, so a name it draws is not reported as one nothing can draw. The theme is
   found the way everything else here is found — through the site's own resolution — and a theme
   with no glyphs of its own simply has none. */
function themeGlyphs(theme) {
  const own = new Set()
  /* the theme's own few, drawn by glyph() — its package exports its source as ./*, so this is the
     same path the app imports */
  for (const spec of [theme && theme + '/components/landing/glyphs.js', '@platform-kit/movable-types/components/landing/glyphs.js']) {
    if (!spec) continue
    try {
      const src = fs.readFileSync(require.resolve(spec), 'utf8')
      for (const m of src.matchAll(/^\s{2}'?([a-z][a-z0-9-]*)'?:/gm)) own.add(m[1])
      break
    } catch { /* not this one */ }
  }
  /*
   * AND THE NAMES A SECTION DRAWS ITSELF. Not every glyph goes through glyph(): a section may own a
   * small vocabulary and draw each one inline — LandingLibrary does, with lines · highlight · note ·
   * place and the rest, each compared by name in its template. Those are as real as Lucide's, and a
   * check that did not know them called four working icons broken and had them "fixed" into a
   * fallback dot. So the names a component compares against are read from the components.
   */
  for (const spec of [theme && theme + '/components/landing/index.js', '@platform-kit/movable-types/components/landing/index.js']) {
    if (!spec) continue
    try {
      const home = path.dirname(require.resolve(spec))
      for (const file of fs.readdirSync(home).filter((x) => x.endsWith('.vue'))) {
        const src = fs.readFileSync(path.join(home, file), 'utf8')
        for (const line of src.split('\n')) {
          if (!/\bicon\b/.test(line)) continue
          for (const m of line.matchAll(/===\s*'([a-z][a-z0-9-]*)'/g)) own.add(m[1])
        }
      }
      break
    } catch { /* not this one */ }
  }
  /* and the site's own sections, where it has them */
  try {
    const home = path.join(ROOT, 'src', 'components', 'landing')
    for (const file of fs.readdirSync(home).filter((x) => x.endsWith('.vue'))) {
      const src = fs.readFileSync(path.join(home, file), 'utf8')
      for (const line of src.split('\n')) {
        if (!/\bicon\b/.test(line)) continue
        for (const m of line.matchAll(/===\s*'([a-z][a-z0-9-]*)'/g)) own.add(m[1])
      }
    }
  } catch { /* a site with no sections of its own */ }
  return own
}

const ALL = process.argv.includes('--all') || process.env.PLATFORMKIT_ICONS_ALL === '1'

/* the node array in an icon module — `createLucideIcon("name", [ ... ])` — read as data, never run */
function nodes(file) {
  const src = fs.readFileSync(file, 'utf8')
  const a = src.indexOf('createLucideIcon('); if (a < 0) return null
  const b = src.indexOf(', [', a), e = src.lastIndexOf(']);')
  if (b < 0 || e < 0) return null
  return new Function('return ' + src.slice(b + 2, e + 1))()
}
const attrs = (o) => Object.entries(o).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')
const inner = (list) => list.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('')

/* every `icon` a page names, wherever it sits in its props */
function named() {
  const out = new Set()
  const dir = path.join(ROOT, 'content/pages'); if (!fs.existsSync(dir)) return out
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'icon' && typeof x === 'string') out.add(x); else walk(x) } }
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) walk(matter(fs.readFileSync(path.join(dir, f), 'utf8')).data.sections || [])
  return out
}

export function buildIcons({ all = ALL, theme = null } = {}) {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.map'))
  const names = files.map((f) => f.slice(0, -3))
  const want = all ? new Set(names) : named()
  const icons = {}
  /* A NAME NOTHING CAN DRAW IS WORTH SAYING. It used to be skipped in silence, and a page naming a
     glyph that is not Lucide's drew a hole — no warning at build, no error at runtime, and only a
     screenshot would ever have shown it. */
  const own = themeGlyphs(theme)
  const unknown = []
  for (const n of want) {
    const f = path.join(DIR, n + '.js')
    /* `own` only silences the report: an icon Lucide has is still drawn, because a name a section
       owns may ALSO be one a page draws through glyph() somewhere else */
    if (!fs.existsSync(f)) { if (!own.has(n)) unknown.push(n); continue }
    const list = nodes(f); if (list) icons[n] = inner(list); else if (!own.has(n)) unknown.push(n)
  }
  const out = path.join(ROOT, '.velite'); fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'icons.json'), JSON.stringify(icons))
  fs.writeFileSync(path.join(out, 'icon-names.json'), JSON.stringify(names))
  return { icons: Object.keys(icons).length, names: names.length, unknown }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const check = process.argv.includes('--check')
  const r = buildIcons()
  if (r.unknown.length) {
    for (const n of r.unknown) console.log(`  ! no icon called "${n}" — a page names it and nothing can draw it`)
    if (check) { console.error(`✖ icons: ${r.unknown.length} name(s) nothing can draw`); process.exit(1) }
  }
  console.log(`✔ icons: ${r.icons} drawn into .velite/icons.json (${r.names} names for the picker)`)
}
