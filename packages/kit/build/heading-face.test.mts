/*
 * A HEADING IS IN THE SITE'S HEADING FACE (openspec: headings-in-the-heading-face). The face is chosen in the admin
 * (content/site.md fonts.heading) and reaches the browser as one token, --fd; a heading takes it from the base rule in
 * atlas.css, so changing the font in the admin changes every heading. This fails the base rule if it stops naming the
 * token, and fails any heading rule in the kit that names a face of its own — a font by name, or the body's token —
 * since that heading would stay put when the site's choice changes. A rule may still give a heading the mono token (a
 * label set as a heading), and the exceptions below are the ones that are not the site's headings at all.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['theme/src', 'modules'].map((r) => path.join(KIT, r))
/* not the site's headings: a book's own pages printed in their print face, and the small note inside a heading */
const NOT_SITE_HEADINGS = ['.print-preview h2', '.pu-group h3 small']

function files() {
  const out: string[] = []
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) } else if (/\.(vue|css)$/.test(e.name)) out.push(p) } }
  ROOTS.forEach(walk)
  return out
}

test("the base heading rule takes the site's heading face", () => {
  const atlas = fs.readFileSync(path.join(KIT, 'theme/src/atlas.css'), 'utf8')
  const rule = /h1,\s*h2,\s*h3,\s*h4\s*\{([^}]*)\}/.exec(atlas)
  assert.ok(rule, 'atlas.css has its h1–h4 rule')
  assert.match(rule![1], /font-family:\s*var\(--fd\b/, 'the h1–h4 rule names the --fd token')
})

test('no heading in the kit names a face of its own', () => {
  const all = files()
  const classes = new Set<string>()
  for (const f of all) for (const m of fs.readFileSync(f, 'utf8').matchAll(/<h[1-4][^>]*?\sclass="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (/^[\w-]+$/.test(c)) classes.add(c)
  const wrong: string[] = []
  for (const f of all) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/([^{}]+)\{([^{}]*?font-family:\s*([^;}]+))/g)) {
      const sel = m[1].trim().split('\n').pop()!.trim(), face = m[3].trim()
      if (/var\(--fd\b/.test(face) || /var\(--m\b/.test(face) || face === 'inherit' && !/(^|[\s,>])h[1-4](?![\w-])/.test(sel)) continue
      if (NOT_SITE_HEADINGS.some((x) => sel.includes(x))) continue
      const heading = /(^|[\s,>])h[1-4](?![\w-])/.test(sel) || [...classes].some((c) => new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(sel))
      if (heading) wrong.push(`${path.relative(KIT, f)}: ${sel} → ${face}`)
    }
  }
  assert.deepEqual(wrong, [], 'a heading rule names a face that does not follow the site\'s heading font:\n' + wrong.join('\n'))
})
