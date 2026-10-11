/* The sections test: the theme's landing catalogue holds together and carries no site-specific content.
   Every registered section has a schema and every schema a component, both ways (the registry read as
   text: the components are .vue, never loaded under Node); every theme schema's defaults validate against
   its schema; no theme landing component, default, label or description carries site-specific vocabulary; and the
   embed patterns (lib/embed.js) turn a YouTube, Vimeo and Loom address into the provider's iframe, a file
   into a <video>, and refuse anything else. Run from a site's root; pinned by npm test. */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadSite } from './site.mjs'
import { loadTheme } from './theme.mjs'

const ROOT = process.cwd()
const c = await loadSite(ROOT)
const theme = await loadTheme(c)
const dir = path.dirname(theme.schemas)
let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg) } }

/* the registry and the schemas agree, both ways */
const { SECTION_SCHEMAS } = await import(pathToFileURL(theme.schemas).href)
const registry = fs.readFileSync(path.join(dir, 'index.js'), 'utf8')
const between = registry.slice(registry.indexOf('export const SECTIONS = {'), registry.indexOf('export const SECTION_NAMES'))
const registered = [...between.matchAll(/^\s+(\w+): (?:Landing\w+|defineAsyncComponent)/gm)].map((m) => m[1])
const conditional = [...between.matchAll(/[{,] (\w+): (?:Landing\w+|defineAsyncComponent)/g)].map((m) => m[1])   /* the module-switched ones: every key inside a `{ … }` spread */
const site = c.landing && c.landing.schemas ? Object.keys((await import(pathToFileURL(path.resolve(ROOT, c.landing.schemas)).href)).SECTION_SCHEMAS || {}) : []
for (const k of [...registered, ...conditional]) ok(SECTION_SCHEMAS[k] || (conditional.includes(k)), `section without a schema: ${k}`)
for (const k of Object.keys(SECTION_SCHEMAS)) if (!site.includes(k)) ok(registered.includes(k) || conditional.includes(k), `schema without a section: ${k}`)

/* every theme schema's defaults validate; the entry is whole */
for (const k of Object.keys(SECTION_SCHEMAS)) {
  if (site.includes(k)) continue
  const d = SECTION_SCHEMAS[k]
  ok(d.label && d.description && typeof d.summary === 'function' && d.schema && d.defaults, `${k}: a schema entry is label, description, summary, defaults, schema`)
  const r = d.schema.safeParse(d.defaults)
  ok(r.success, `${k}: its defaults do not validate: ${r.success ? '' : r.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`)
  ok(d.group, `${k}: no group for the picker`)
}

/* no site's vocabulary belongs in the theme's landing components, defaults or labels */
const WORDS = /kybalion|neville|circumstance|realization|autopilot|co-creation|rising agency|self-mastery|diagnostic|recommendation|\blevels?\b/i
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.vue') || f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/https?:\/\/\S+/g, '')
  const hit = text.match(WORDS)
  ok(!hit, `${f} carries site-specific vocabulary: "${hit && hit[0]}"`)
}

/* the embed patterns */
const { embedOf, loopSrc } = await import(pathToFileURL(path.join(dir, '../../lib/embed.js')).href)
const cases = [
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'embed', 'youtube', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
  ['https://youtu.be/dQw4w9WgXcQ?t=4', 'embed', 'youtube', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
  ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'embed', 'youtube', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
  ['https://vimeo.com/76979871', 'embed', 'vimeo', 'https://player.vimeo.com/video/76979871?dnt=1'],
  ['https://player.vimeo.com/video/76979871', 'embed', 'vimeo', 'https://player.vimeo.com/video/76979871?dnt=1'],
  ['https://www.loom.com/share/0123456789abcdef0123456789abcdef', 'embed', 'loom', 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef'],
  ['/media/clip.mp4', 'file', undefined, '/media/clip.mp4'],
  ['https://cdn.example.com/clip.webm?x=1', 'file', undefined, 'https://cdn.example.com/clip.webm?x=1'],
]
for (const [url, kind, provider, src] of cases) {
  const e = embedOf(url)
  ok(e && e.kind === kind && e.provider === provider && e.src === src, `embed: ${url} → ${JSON.stringify(e)}`)
}
for (const bad of ['https://example.com/watch?v=abc', 'https://evil.example.com/embed/x', 'javascript:alert(1)', 'https://www.youtube.com/', '', 'not a url', 'https://www.loom.com/share/short'])
  ok(embedOf(bad) === null, `embed refused: ${bad}`)
ok(loopSrc(embedOf('https://youtu.be/dQw4w9WgXcQ')).includes('autoplay=1&mute=1&loop=1&playlist=dQw4w9WgXcQ'), 'a YouTube loop carries its flags')
ok(loopSrc(embedOf('https://vimeo.com/1')).includes('background=1'), 'a Vimeo loop is a background player')

/*
 * A SECTION THE REGISTRY DOES NOT KNOW. The page builder never offers one — but the file is the
 * truth, and a page can arrive from a hand edit, a git merge, a content API write, or a theme
 * that used to ship a section and no longer does. The save is where that is caught, and the cost
 * of missing it is a landing page that builds and renders a blank where a section should be.
 */
{
  const { validateSections } = await import('../../movable-types/src/components/landing/schemas.js')
  const known = Object.keys(SECTION_SCHEMAS)[0]
  ok(validateSections([{ component: known, props: SECTION_SCHEMAS[known].defaults }]).length === 0, 'a known section with its own defaults is accepted')
  const unknown = validateSections([{ component: 'LandingNoSuchThing', props: {} }])
  ok(unknown.length > 0 && /unknown section/.test(unknown[0].message), 'a section with no schema is refused: ' + JSON.stringify(unknown))
  ok(/LandingNoSuchThing/.test(unknown[0].message), 'and the refusal names it')
  ok(validateSections([{ component: known, props: SECTION_SCHEMAS[known].defaults }, { component: 'LandingNoSuchThing', props: {} }]).length > 0,
    'one bad section among good ones still refuses the save')
  ok(validateSections('not a list').length > 0, 'a sections value that is not a list is refused')
  ok(validateSections([null]).length > 0, 'and a hole in the list is refused')
  ok(validateSections(null).length === 0, 'a page with no sections at all is not an error')
}

console.log(`sections: ${pass} passed${fail ? `, ${fail} failed` : ''}`)
if (fail) process.exit(1)
