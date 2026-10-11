/*
 * NOTHING UNPUBLISHED REACHES THE BUNDLE — held against the compiled output, not against a reading
 * of the hook that is supposed to drop it.
 *
 * `published: false` keeps a record on disk and in the admin and takes it out of everything else:
 * the site, the search index, the prerender, the sitemap, the share images. The rule is one line in
 * velite's `prepare`, and everything downstream — the routes, the palette, the recommendations —
 * simply assumes it ran. Which is the problem: if that filter ever stopped, nothing would throw.
 * A draft article would just be live, and the first evidence would be somebody reading it.
 *
 * So this checks the OUTPUT. It compiles the site's real content with one extra record per
 * collection — published false — written into the checkout, and asserts the record is absent from
 * `.velite`, from `publicRoutes()`, and from the palette's index. Then it flips the same record to
 * published and asserts it appears, because a filter that dropped everything would pass the first
 * half and nothing else.
 *
 * It restores the checkout whatever happens, including on a throw.
 *
 * Run alone:  node packages/kit/build/unpublished.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { searchRows } from '../src/lib/search-rows.js'
import { loadSite } from './site.mjs'

const ROOT = process.cwd()
let n = 0, bad = 0
const t = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }

/* one probe per enabled public collection, each with the frontmatter its schema needs */
const CANDIDATES = [
  { collection: 'articles', dir: 'content/articles', slug: 'zz-probe-unpublished', fm: 'title: A probe\ndate: "2026-01-01"\n' },
  { collection: 'wiki', dir: 'content/wiki', slug: 'zz-probe-unpublished', fm: 'title: A probe\n', route: '/content/wiki/zz-probe-unpublished' },
  { collection: 'docs', dir: 'content/docs', slug: 'zz-probe-unpublished', fm: 'title: A probe\n' },
]
const SITE = await loadSite(ROOT)
const PROBES = CANDIDATES.filter((p) => SITE.modules[p.collection] !== false)
const file = (p) => path.join(ROOT, p.dir, p.slug + '.md')
const write = (p, published) => fs.writeFileSync(file(p), `---\n${p.fm}published: ${published}\n---\n\nA probe record, written by unpublished.test.mjs. If this is in your checkout, the test did not clean up.\n`)
const remove = (p) => { try { fs.unlinkSync(file(p)) } catch { /* already gone */ } }

const velite = () => {
  const r = spawnSync('npx', ['velite', 'build'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
  if (r.status !== 0) throw new Error('velite failed: ' + String(r.stderr || r.stdout).slice(0, 400))
}
const compiled = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, '.velite', name + '.json'), 'utf8'))
/* the routes in a CHILD, because `#content` resolves to one path and the module registry caches it:
   asking twice in this process would answer from the first compile both times, which is precisely
   the mistake that would make this check agree with itself and prove nothing */
const routesNow = () => {
  const routesUrl = new URL('./routes.mjs', import.meta.url).href
  const code = `import(${JSON.stringify(routesUrl)}).then((m) => console.log(JSON.stringify(m.publicRoutes())))`
  const r = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('routes failed: ' + String(r.stderr).slice(0, 400))
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

/* the probes must not already be there — a leftover from a killed run would make this lie */
for (const p of PROBES) if (fs.existsSync(file(p))) { console.log('  a probe is already in the checkout:', file(p)); process.exit(1) }
const createdDirs = []
for (const p of PROBES) {
  const dir = path.join(ROOT, p.dir)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    createdDirs.push(dir)
  }
}

let ok = true
try {
  if (!PROBES.length) throw new Error('no enabled public content collections to probe')
  /* ── unpublished: absent from everything ── */
  for (const p of PROBES) write(p, 'false')
  velite()

  for (const p of PROBES) {
    await t(`an unpublished ${p.collection} record is not in .velite`, () => {
      const rows = compiled(p.collection)
      assert.equal(rows.some((r) => (r.id || r.slug) === p.slug), false, 'the record is in the compiled collection')
    })
  }
  /* the index is built HERE from the collections just compiled, rather than read from
     .velite/search.json: that file is written by a build step of its own, and a dev server watching
     the checkout rewrites it whenever a content file appears — so reading it would make this check
     pass or fail by whether somebody happened to have `npm run dev` open. */
  await t('an unpublished record is not in the palette\'s index', () => {
    const rows = searchRows({ articles: compiled('articles'), wiki: compiled('wiki'), docs: compiled('docs'), books: compiled('books') })
    for (const p of PROBES) assert.equal(rows.some((r) => r.id === p.slug), false, `${p.slug} is searchable`)
  })
  await t('an unpublished record has no route, so it is never prerendered or in the sitemap', () => {
    const routes = routesNow()
    for (const p of PROBES) assert.equal(routes.some((route) => route.endsWith('/' + p.slug)), false, `${p.collection}/${p.slug} would be baked`)
  })

  /* ── published: present — otherwise a filter that dropped everything would pass above ── */
  for (const p of PROBES) write(p, 'true')
  velite()

  for (const p of PROBES) {
    await t(`the same ${p.collection} record published IS in .velite`, () => {
      const rows = compiled(p.collection)
      assert.equal(rows.some((r) => (r.id || r.slug) === p.slug), true, 'the record is missing when published')
    })
  }
  await t('the same record published has a route', () => {
    const routes = routesNow()
    for (const p of PROBES) assert.equal(routes.some((route) => route.endsWith('/' + p.slug)), true, `${p.collection}/${p.slug} is missing when published`)
  })
} catch (e) {
  ok = false
  console.log('  FAIL (the run itself)', String(e.message || e).split('\n').slice(0, 4).join('\n    '))
} finally {
  /* the checkout goes back to what it was, and the compiled content with it */
  for (const p of PROBES) remove(p)
  try { velite() } catch { console.log('  NOTE: the probes are removed but .velite was not rebuilt — run `npx velite build`') }
  for (const dir of createdDirs) { try { fs.rmdirSync(dir) } catch { /* keep non-empty directories */ } }
}

if (!ok) bad++
console.log(bad ? `unpublished: ${n - bad} passed, ${bad} failed` : `unpublished: ${n} passed, 0 failed`)
process.exit(bad ? 1 : 0)
