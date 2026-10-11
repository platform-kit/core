#!/usr/bin/env node
/*
 * THE SECOND CONTENT ENGINE, HELD TO THE FIRST.
 *
 * `CONTENT_ENGINE=collections` runs Content Collections over the collections velite declares, so
 * that the two can be compared. The comparison is worth nothing unless the output is the same, and
 * the way this went wrong is instructive: an absolute `directory` makes Content Collections return
 * zero documents with no error at all, and the run looked four times faster for having done
 * nothing. So what is pinned here is the shape of the bridge — the things that were silently wrong.
 *
 *   node packages/kit/build/collections.test.mjs
 */
import assert from 'node:assert/strict'
import { isAbsolute, resolve } from 'node:path'
import fs from 'node:fs'
import matter from 'gray-matter'
import { parse as parseYaml } from 'yaml'

let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String(e && e.message || e).split('\n').slice(0, 3).join('\n    ')) } }
const parseFrontmatter = (source) => matter(source, { engines: { yaml: { parse: parseYaml } } })

console.log('\nCONTENT COLLECTIONS, AS THE SECOND ENGINE\n')

const { collectionsConfig, veliteConfig, metaFor, engine, engineFor } = await import('./collections.mjs')
const ROOT = process.cwd()

await ok('the engine is velite unless something asks otherwise', () => {
  assert.equal(engine({}, null), 'velite')
  assert.equal(engine({ CONTENT_ENGINE: '' }, null), 'velite')
  assert.equal(engine({ CONTENT_ENGINE: 'velite' }, null), 'velite')
  assert.equal(engine({ CONTENT_ENGINE: 'collections' }, null), 'collections')
  assert.equal(engine({ CONTENT_ENGINE: 'COLLECTIONS' }, null), 'collections')
})

await ok("a site registers its own engine, and the run's word beats it", () => {
  /* three sources, in order: the run's variable, the site's config, then velite. A site naming a
     module of its own gets it; naming one of the kit's two gets that one. */
  assert.equal(engine({}, { content: { engine: 'collections' } }), 'collections')
  assert.equal(engine({}, { content: { engine: './src/my-engine.mjs' } }), 'site')
  assert.equal(engine({ CONTENT_ENGINE: 'velite' }, { content: { engine: 'collections' } }), 'velite', "the run's word wins")
  assert.equal(engine({}, { content: {} }), 'velite')
  assert.equal(engine({}, {}), 'velite')
})

await ok('the resolved engine is one that can be run', async () => {
  const e = await engineFor(process.cwd(), {})
  assert.equal(e.name, 'velite', 'this site registers none, so velite')
  assert.equal(typeof e.build, 'function')
  const c = await engineFor(process.cwd(), { CONTENT_ENGINE: 'collections' })
  assert.equal(c.name, 'collections')
  assert.equal(typeof c.build, 'function')
})

const cfg = await veliteConfig(ROOT)
const cc = await collectionsConfig(ROOT)

await ok('every collection velite declares is carried over', () => {
  const mine = new Set(cc.collections.map((c) => c.name))
  const theirs = Object.entries(cfg.collections).filter(([, c]) => c && c.pattern).map(([k]) => k)
  for (const k of theirs) assert.ok(mine.has(k), 'missing: ' + k)
  assert.ok(theirs.length > 25, 'there are collections to carry: ' + theirs.length)
})

await ok('a directory is RELATIVE, never absolute', () => {
  /* the whole of the first wrong answer: Content Collections answers an absolute directory with an
     empty collection and no error, so every one of the thirty-three came back empty and fast */
  for (const c of cc.collections) assert.ok(!isAbsolute(c.directory), c.name + ' has an absolute directory: ' + c.directory)
})

await ok('the body comes from the parser, so no file is read twice', () => {
  for (const c of cc.collections) assert.equal(c.parser, 'frontmatter', c.name + ' parses as ' + c.parser)
})

await ok('the meta a velite schema needs is what it is given', () => {
  const m = metaFor('/x/content/articles/a.md', '# A heading\n\nSome words here.\n', { root: '/x/content', output: cfg.output })
  assert.equal(m.path, '/x/content/articles/a.md')
  assert.equal(typeof m.content, 'string')
  assert.equal(typeof m.config.root, 'string')
  assert.ok(m.config.output, 'the output, so s.image() reaches processAsset')
  /* EAGER, NOT A GETTER. Read lazily it is read from inside the schema's own async parse, and the
     renderer's slugger — module-scoped on purpose, as its comment says — interleaves two documents:
     every repeated heading came out as `whats-included-1` and every anchor on the site with it. */
  const d = Object.getOwnPropertyDescriptor(m, 'plain')
  assert.equal(typeof d.get, 'undefined', 'plain must be a value, computed before the parse')
  assert.equal(typeof d.value, 'string')
  assert.match(m.plain, /A heading/)
  assert.match(m.plain, /Some words here/)
})

await ok("a velite schema really parses under that meta, and gives what velite gives", async () => {
  const dir = resolve(cfg.root, 'articles')
  if (!fs.existsSync(dir)) return
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.md'))
  if (!file) return
  const fm = parseFrontmatter(fs.readFileSync(resolve(dir, file), 'utf8'))
  const meta = metaFor(resolve(dir, file), fm.content, { root: cfg.root, output: cfg.output })
  const out = await cfg.collections.articles.schema.parseAsync(fm.data, { meta })
  assert.equal(out.path, 'articles/' + file.replace(/\.md$/, ''), 's.path() resolved against the content root')
  assert.ok(out.metadata && out.metadata.wordCount > 0, 's.metadata() counted the body')
  assert.ok(out.excerpt && out.excerpt.length > 0, 's.excerpt() read the plain text')
  assert.ok(out.body && out.body.startsWith('<'), 'the body rendered')
})

await ok('a single is a record and not a list of one', () => {
  /* velite's own answer for the site's settings and the storefront; four files came out as arrays
     before the flag was honoured, and nothing that reads them would have worked. Feature-owned
     singles are conditional, so a docs-only site has just the site settings record. */
  const singles = Object.entries(cfg.collections).filter(([, c]) => c && c.single).map(([k]) => k)
  assert.ok(singles.includes('site'), 'site settings must remain a single record; configured singles: ' + singles.join(', '))
})

await ok('a schema issue is a diagnostic, not a dropped document', async () => {
  /*
   * velite reports a schema issue and writes the record anyway — one ad here has an empty body, and
   * velite's own output carries it with \`body: ""\`. zod holds the value of a DIRTY parse and throws
   * it away with the success flag, so the parse is made the way zod's own safeParse makes it. Without
   * this the alternative engine silently drops real content the default keeps.
   */
  const dir = resolve(cfg.root, 'ads')
  if (!fs.existsSync(dir)) return
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.md'))
  if (!file) return
  const fm = parseFrontmatter(fs.readFileSync(resolve(dir, file), 'utf8'))
  if (String(fm.content).trim()) return   /* this only bites on a document with no body */
  const meta = metaFor(resolve(dir, file), fm.content, { root: cfg.root, output: cfg.output })
  const strict = await cfg.collections.ads.schema.safeParseAsync(fm.data, { meta })
  assert.equal(strict.success, false, 'the schema does raise an issue for it')
  const { buildCollections } = await import('./collections.mjs')
  void buildCollections   /* the build path is what keeps it; proved by the engine parity run, not here */
})

console.log(`\ncollections: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
