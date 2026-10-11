/*
 * CONTENT COLLECTIONS AS A SECOND ENGINE, BEHIND CONTENT_ENGINE=collections.
 *
 * velite walks the content, parses each file's front matter against a schema, renders its body and
 * writes `.velite/*.json`. Content Collections does the same job with a different engine. This
 * drives it WITHOUT a second definition of anything, which is the only way an alternative here
 * could be worth having: the thirty collections stay declared once, in `build/velite.mjs`, in
 * velite's dialect.
 *
 * WHY THAT IS POSSIBLE. velite's `s` is a patched zod, and the patch is exactly what was needed:
 * `schema.parseAsync(data, { meta })` passes `meta` through to every transform as `ctx.meta`. So
 * the context-dependent helpers — `s.path()` (23 uses), `s.raw()` (23), `s.isodate()` (7),
 * `s.excerpt()` (4), `s.metadata()` (4), `s.image()` (1), and the kit's own body renderer, which
 * reads `ctx.meta.content` — all work outside a velite build once they are handed a meta carrying
 * `path`, `config` (its root and output), `content` and `plain`. Nothing is reimplemented and no
 * schema is translated: the two engines parse the identical objects, which is also what makes a
 * timing comparison between them mean anything.
 *
 * WHAT IS NOT REUSED is velite's file walking, its caching, its output writing and its watcher —
 * which is the part being measured.
 *
 * ASSETS. The one `s.image()` (a companion's cover) and the covers the kit processes itself reach
 * velite's own `processAsset` through the same meta (`config.output` names `public/static` and the
 * `/static/` base), so the hashed files land where the site already expects them, and
 * `resolveAsset` — which every other file field goes through — is untouched.
 */
import { resolve, relative } from 'node:path'
import fs from 'node:fs'
import matter from 'gray-matter'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toHast } from 'mdast-util-to-hast'
import { toString as toText } from 'hast-util-to-string'
import { z } from 'zod'

/* CC 0.15 wants a StandardSchema; velite owns the real one, so this is a door that admits anything */
const ANY = z.looseObject ? z.looseObject({}) : z.object({}).passthrough()

/*
 * A SCHEMA ISSUE IS A DIAGNOSTIC, NOT A DROPPED DOCUMENT — which is velite's behaviour and has to be
 * this engine's too, or the two disagree on real content. One ad here has an empty body, the body
 * field raises "The content is empty", and velite writes the record with `body: ""` and reports the
 * issue as information. zod carries the value of a DIRTY parse but `safeParseAsync` throws it away
 * with the success flag, so the parse is made the way zod's own `safeParse` makes it — the meta on
 * the input as well as on the parent, which is the whole of what velite's patch threads — and a
 * dirty result is kept with its issues said out loud.
 */
async function parseKeeping(schema, data, meta, where) {
  const ctx = { common: { issues: [], async: true, contextualErrorMap: undefined }, path: [], meta, schemaErrorMap: schema._def && schema._def.errorMap, parent: null, data, parsedType: 'object' }
  const r = await schema._parseAsync({ data, path: [], meta, parent: ctx })
  if (r && r.status === 'valid') return r.value
  if (r && r.status === 'dirty' && r.value !== undefined) {
    ISSUES.push(where + ': ' + ctx.common.issues.map((i) => (i.path || []).join('.') + ' — ' + i.message).join('; '))
    return r.value
  }
  const e = new Error(where + ': ' + (ctx.common.issues.map((i) => (i.path || []).join('.') + ' — ' + i.message).join('; ') || 'the schema refused it'))
  throw e
}

/* what was reported but not fatal, said at the end of a build as velite says it */
const ISSUES = []

/* what each collection's transform produced, this run, keyed by the collection's own name */
const HELD = {}

/* the plain text of a body, as velite's own `s.plain` would have it: rendered, then stripped, so
   `s.excerpt()` and `s.metadata()`'s word count agree with velite's rather than approximating them */
/*
 * THE PLAIN TEXT, AS VELITE DERIVES IT: the markdown as mdast, that as hast, and the hast as text.
 * Nothing else matches — stripping tags out of the rendered html put a space where velite had a line
 * break, and `excerpt` is 150 characters of prose, so every record differed by whitespace that read
 * the same. Rendering is also what a second markdown pass would cost, and this is not one: it is the
 * same three libraries velite uses, over the same source.
 */
const plainOf = (content) => {
  try {
    const plain = toText(toHast(fromMarkdown(String(content || '')), { allowDangerousHtml: true }))
    return plain
  } catch { return String(content || '') }
}


/*
 * The meta a velite schema expects of its parse. Lazy where it is dear: `plain` renders the body,
 * and a collection whose schema never asks for it should not pay for it.
 */
export function metaFor(path, content, config) {
  /*
   * EAGER, AND NEVER FROM INSIDE THE PARSE.
   *
   * The kit's renderer keeps the slugger for the document being parsed in module scope, and says in
   * its own comment why: an async parse — the syntax highlighter — would otherwise interleave two
   * documents' headings on one slugger. A lazy `plain` getter is read in the middle of the schema's
   * own async body parse, which is exactly that interleaving: every second heading of the same text
   * came out as `whats-included-1`, and every anchor and every table of contents on the site would
   * have been quietly wrong. Rendering here, before the schema is handed the meta, keeps the two
   * parses in sequence. It costs a second render of each body, which velite does not pay — it takes
   * the plain text off the hast it already has — and that cost belongs to any timing comparison.
   */
  const plain = plainOf(content)
  return { path, content, config, plain }
}

/* velite's config, as both engines read it: the collections, the output, the prepare hook */
export async function veliteConfig(root = process.cwd()) {
  const { kitConfig } = await import('./velite.mjs')
  const cfg = await kitConfig()
  return { ...cfg, root: resolve(root, cfg.root || 'content'), out: resolve(root, (cfg.output && cfg.output.data) || '.velite') }
}

/*
 * The Content Collections config, built from velite's. A collection becomes a CC collection whose
 * parser is front matter and whose transform is velite's own schema over the meta above, so what CC
 * produces is byte-for-byte what velite would have produced for the same file.
 */
export async function collectionsConfig(root = process.cwd()) {
  const cfg = await veliteConfig(root)
  const { defineCollection } = await import('@content-collections/core')
  const collections = []
  for (const [key, c] of Object.entries(cfg.collections)) {
    if (!c || !c.pattern) continue
    collections.push(defineCollection({
      name: key,
      /* RELATIVE, AND NEVER ABSOLUTE. Content Collections answers an absolute directory with zero
         documents and no error of any kind — every collection came back empty and the run looked
         four times faster for having done nothing. */
      directory: relative(root, cfg.root) || '.',
      include: c.pattern,
      /* 'frontmatter' hands over the body as well, so the transform never reads the file a second
         time — CC's own read is the only one, as velite's own read is its only one */
      parser: 'frontmatter',
      /* the shape is velite's and is checked in the transform, never declared twice; CC needs a
         StandardSchema here, so this one admits any front matter and asserts nothing */
      schema: ANY,
      transform: async (doc) => {
        /* KEPT HERE, NOT READ BACK FROM CC'S MODULES. Its generated exports are pluralised by its
           own rules (`wiki` becomes allWikis, `community` allCommunities), and mapping a
           collection's key onto that guess silently missed five of the thirty-three — including
           `ui`, whose absence meant the theme's default strings were never merged and the site
           came out 75kB short of itself. What the transform returns is what the collection holds. */
        /* CC hands over the parsed front matter as the document's own fields and the body as
           `content`; velite's schema wants the front matter alone, so the two are separated again
           here rather than re-read from disk */
        const { content, _meta, ...data } = doc
        const abs = resolve(cfg.root, _meta.filePath)
        const meta = metaFor(abs, content ?? '', { root: cfg.root, output: cfg.output })
        const out = await parseKeeping(c.schema, data, meta, key + '/' + _meta.filePath)
        /* WITH THE FILE IT CAME FROM. Content Collections walks in its own order and velite sorts by
           path; two collections came out byte-for-byte the same length and still differed, which is
           what an order difference looks like from a diff. */
        ;(HELD[key] || (HELD[key] = [])).push({ file: _meta.filePath, out })
        return out
      },
    }))
  }
  return { collections, _velite: cfg }
}

/*
 * A BUILD. CC walks and transforms; the result is written as velite writes it — one JSON per
 * collection under `.velite`, through velite's own `prepare` hook, which is where a site settles
 * its singles and drops everything unpublished. Nothing downstream can tell which engine ran:
 * `#content` still resolves to `.velite`, and `entry.js` still reads the same fields.
 */
export async function buildCollections({ root = process.cwd(), log = () => {} } = {}) {
  const began = Date.now()
  for (const k of Object.keys(HELD)) delete HELD[k]
  ISSUES.length = 0
  const { createBuilder } = await import('@content-collections/core')
  const cfgPath = resolve(root, 'content-collections.ts')
  if (!fs.existsSync(cfgPath)) throw new Error('CONTENT_ENGINE=collections needs content-collections.ts in the site root (three lines; see docs)')
  const builder = await createBuilder(cfgPath)
  await builder.build()
  const cfg = await veliteConfig(root)
  /* CC's generated modules hold the transformed documents; they are read back and written in
     velite's shape so the rest of the build, the app and every test see no difference */
  const data = {}
  for (const [key, c] of Object.entries(cfg.collections)) {
    const rows = (HELD[key] || []).slice().sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : 0)).map((r) => r.out)
    /* A SINGLE IS A RECORD AND NOT A LIST OF ONE, which is velite's own answer for the site's
       settings, its providers' policy and its storefront: `#content` imports an object there and a
       component reads its fields. The prepare hook settles three of them by hand; the rest are
       settled by the collection saying `single`, which is velite's flag and has to be honoured here
       too or four files come out as arrays the app cannot read. */
    data[key] = c && c.single ? (rows[0] ?? null) : rows
  }
  if (typeof cfg.prepare === 'function') await cfg.prepare(data, { config: cfg })
  fs.mkdirSync(cfg.out, { recursive: true })
  for (const [key, rows] of Object.entries(data)) fs.writeFileSync(resolve(cfg.out, key + '.json'), JSON.stringify(rows, null, 2))
  if (ISSUES.length) log('[collections] issues:\n  ' + ISSUES.join('\n  '))
  log(`[collections] ${Object.keys(data).length} collection(s) in ${Date.now() - began}ms`)
  return { ms: Date.now() - began, collections: Object.keys(data).length }
}

/*
 * WHICH ENGINE COMPILES THE CONTENT, and a site may bring its own.
 *
 * Three answers, in the order they are asked:
 *
 *   CONTENT_ENGINE           the run's own say, for trying one against the other: `velite` (the
 *                            default and the tested path) or `collections`.
 *   content.engine           the site's, in platformkit.config.js — either of those names, or a path
 *                            to a module of its own.
 *   nothing                  velite.
 *
 * A SITE'S OWN ENGINE is a module exporting `build({ root, config, log })`, where `config` is the
 * velite configuration it is being asked to realise — the collections, their schemas, the output and
 * the prepare hook. It is the whole seam: a site that wants its markdown rendered by something else,
 * its images processed differently, or its content read from somewhere the store does not reach
 * writes that module and registers it, and nothing in the kit is edited. What it must produce is
 * what both engines here produce — one JSON per collection under the configured output, through the
 * prepare hook — because that is what `#content` imports and `entry.js` reads.
 *
 * Nobody has to think about any of this: absent a registration and a variable, velite compiles the
 * content exactly as it always has.
 */
export const engine = (env = process.env, site = null) => {
  const named = String(env.CONTENT_ENGINE || '').toLowerCase()
  if (named === 'collections' || named === 'velite') return named
  const own = site && site.content && site.content.engine
  if (own) return String(own).toLowerCase() === 'velite' ? 'velite' : String(own).toLowerCase() === 'collections' ? 'collections' : 'site'
  return 'velite'
}

/*
 * The engine this run should use, resolved and ready to run: `{ name, build }`. A site's own module
 * is imported by the path it registered, relative to its root, and is handed the same arguments the
 * kit's own engines take.
 */
export async function engineFor(root = process.cwd(), env = process.env) {
  const { loadSite } = await import('./site.mjs')
  const site = await loadSite(root)
  const name = engine(env, site)
  if (name === 'collections') return { name, build: (opts) => buildCollections(opts) }
  if (name === 'site') {
    const { pathToFileURL } = await import('node:url')
    const { resolve } = await import('node:path')
    const mod = await import(/* @vite-ignore */ pathToFileURL(resolve(root, site.content.engine)).href)
    const build = mod.build || mod.default
    if (typeof build !== 'function') throw new Error(`content.engine (${site.content.engine}) exports no build({ root, config, log })`)
    return { name: 'site:' + site.content.engine, build: async ({ root: r = root, log = () => {} } = {}) => build({ root: r, config: await veliteConfig(r), log }) }
  }
  return { name: 'velite', build: async () => { const { build } = await import('velite'); await build({ clean: true }) } }
}
