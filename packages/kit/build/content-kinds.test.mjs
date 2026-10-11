/*
 * That every kind of content can be EDITED WITHOUT A CHECKOUT — held mechanically rather than
 * asked for politely (build/content-kinds.mjs is the registry; AGENTS.md is why).
 *
 * Four checks, and the first is the forcing function: a directory under content/ that appears in
 * neither list fails, so a new content type cannot be added without somebody answering "can a
 * cloud-only site change this?" in the same commit. The rest are consequences — a model that is
 * named must exist, a collection that is named must exist, and no build script may open a content
 * path through fs, because a script that does works on a laptop and fails in the cloud, silently,
 * in exactly the way nobody notices until a customer cannot edit their own site.
 *
 * `pending` is a gap carried on purpose. It is printed every run so the debt is loud.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, NOT_RECORDS, MAY_USE_FS, FS_DEBT, allKinds, pendingOf } from './content-kinds.mjs'
import { closure, closureResolves } from './pipe-closure.mjs'
import { DECLARED } from './declarations.mjs'
import { registry } from './models/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const KIT = join(here, '..')
const ROOT = join(KIT, '..', '..')
const SITE = process.cwd()
let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')) } }

/* every content directory of every site in this repository: the site itself and the kit's own */
const SITES = [SITE, join(ROOT, 'sites', 'demo'), join(ROOT, 'sites', 'docs')].filter((d) => existsSync(join(d, 'content')))
/*
 * A SITE'S OWN CONTENT TYPE IS DECLARED BY ITS OWN MODEL, not by a list in the kit.
 *
 * KINDS and NOT_RECORDS are the KIT's registry, and this check ran them against every site in the
 * repository — so a site with a content type of its own (the demo's content/stockists) could not
 * pass without an entry being added to the kit, which would be the kit carrying a name from one
 * site. The question the check asks is "can a cloud-only site change this?", and a site's own
 * model in platformkit.config.js admin.models is exactly the answer to it: the model names the
 * directory it edits, and the pipe serves it with no checkout. So a directory a site's own model
 * claims is classified, by that model, in that site.
 *
 * An admin SECTION is not enough and is not read here: a section is the screen, and a screen with
 * no model behind it is a page that can only save where there is a filesystem.
 */
const siteModelDirs = async (site) => {
  try {
    const m = await import(join(site, 'build', 'admin-models.mjs'))
    /* `models`, exactly as build/models/index.mjs reads it — accepting a default export here
       would pass a file the registry silently ignores, which is what it did once */
    return (m.models || []).map((x) => x && x.dir).filter(Boolean)
  } catch { return [] }
}
const dirsUnder = (site) => {
  const out = []
  const walk = (rel) => {
    const abs = join(site, rel)
    if (!existsSync(abs)) return
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      /* A SINGLE FILE COUNTS TOO. The walk took directories alone, and content/providers.md went out
         with a projection, a policy and no editor — invisible here because it was not a folder. */
      if (!e.isDirectory()) { if (rel === 'content' && e.name.endsWith('.md')) out.push(rel + '/' + e.name); continue }
      const child = rel + '/' + e.name
      out.push(child)
      /* one level down, which is as deep as any content type goes (content/store/products);
         a space's channels live under its own folder and belong to the space's own model */
      if (rel === 'content' && !['uploads', 'spaces', 'app', 'books', 'strings', 'docs', 'articles', 'wiki', 'models'].includes(e.name)) walk(child)
    }
  }
  walk('content')
  return out
}

/* ---- 1. THE FORCING FUNCTION: every directory is classified ---- */
{
  const known = allKinds()
  const missing = []
  for (const site of SITES) {
    const own = new Set(await siteModelDirs(site))
    for (const dir of dirsUnder(site)) {
      if (known[dir] || own.has(dir)) continue
      if ([...own].some((d) => dir.startsWith(d + '/'))) continue
      /* a folder holding only other folders, each of which is classified, is not itself a kind */
      if (Object.keys(known).some((k) => k.startsWith(dir + '/'))) continue
      missing.push(`${dir}  (in ${relative(ROOT, site) || 'the site'})`)
    }
  }
  ok('every content directory says how it is edited', !missing.length,
    missing.length ? 'not in build/content-kinds.mjs:\n          ' + [...new Set(missing)].join('\n          ')
      + '\n\n          The kit\'s own content goes in KINDS with the admin model that edits it, or in\n          NOT_RECORDS with the reason it is not a record. A SITE\'s own content type is declared\n          by the site: a model in its build/admin-models.mjs naming that directory (an admin\n          section is the screen, not the model, and does not count). A content type with no\n          model cannot be changed by a site that has no checkout, which is every site in cloud\n          mode.' : '')
}

/* ---- 2. a named model exists ---- */
{
  const { CORE } = await import('./models/core/index.mjs')
  const site = await import(join(SITE, 'build', 'admin-models.mjs')).then((m) => m.models || [], () => [])
  const keys = new Set([...CORE, ...site].map((m) => m.key))
  const wrong = Object.entries(KINDS).filter(([, v]) => v.model && !keys.has(v.model)).map(([d, v]) => `${d} → ${v.model}`)
  ok('every model a kind names is in the registry', !wrong.length, wrong.join(', '))
  /* and it edits that directory, not another one */
  const byKey = Object.fromEntries([...CORE, ...site].map((m) => [m.key, m]))
  const elsewhere = Object.entries(KINDS)
    .filter(([dir, v]) => v.model && byKey[v.model] && byKey[v.model].dir && byKey[v.model].dir !== dir && !dir.startsWith(byKey[v.model].dir + '/'))
    .map(([dir, v]) => `${dir} is claimed by ${v.model}, which edits ${byKey[v.model].dir}`)
  ok('…and edits the directory it is named against', !elsewhere.length, elsewhere.join('\n          '))
}

/* ---- 3. a named collection exists ---- */
{
  const velite = readFileSync(join(KIT, 'build', 'velite.mjs'), 'utf8')
  const declared = new Set([...velite.matchAll(/^ {4}(\w+): \{$/gm)].map((m) => m[1]))
  const wrong = Object.entries(KINDS).filter(([, v]) => v.collection && !declared.has(v.collection)).map(([d, v]) => `${d} → ${v.collection}`)
  ok('every collection a kind names is declared in velite', !wrong.length, wrong.join(', '))
}

/* ---- 3b. THE RUNTIME CAN RESOLVE THE PIPE ----
   The edge runtime reads every literal specifier a file in the pipe names, a guarded dynamic import
   included, so one left out of the closure is a runtime that will not boot — and it does not say so
   where you are looking: it surfaces as every call to every function failing name resolution, which
   reads as a stack that is down. */
{
  const bad = closureResolves(KIT)
  ok('every literal import in the pipe names a file the pipe carries', bad.length === 0,
    bad.length ? bad.join('\n          ') + '\n\n          Either copy the file (add it to MAY_USE_FS if it touches fs and is never called\n          there) or reach it by a specifier no bundler can resolve.' : '')
}

/* ---- 4. THE OTHER HALF: nothing in the admin's pipe opens content through fs ----
   These files are copied into an Edge Function, where there is no filesystem and content is only
   ever rows. A build script outside the pipe may use fs freely: in cloud mode the deploy writes
   every row out to a file before the build, so a build always has a checkout. */
{
  const guilty = []
  for (const [rel, abs] of closure(KIT)) {
    if (MAY_USE_FS[rel]) continue
    const src = readFileSync(abs, 'utf8')
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.trimStart().startsWith('*') || l.trimStart().startsWith('//')) continue
      if (!/\bfs\.|from ['"]node:fs['"]|require\(['"]fs['"]\)/.test(l)) continue
      guilty.push(`${rel}:${i + 1}  ${l.trim().slice(0, 90)}`)
    }
  }
  ok("nothing in the admin's pipe reaches the filesystem", !guilty.length,
    guilty.length ? guilty.join('\n          ')
      + '\n\n          These files run inside an Edge Function: there is no filesystem there, and content is\n          rows rather than files. Take the store (build/store: asStore(root | store) → read ·\n          write · list · remove · rename), or add the file to MAY_USE_FS with the reason.' : '')
  console.log(`  · the pipe is ${closure(KIT).size} files, and none of them may touch a disk`)
}

/* ---- a declaration that becomes rows must be able to become them without a machine ----
 *
 * A projected table has a source under content/ and a script that makes the database agree with it.
 * Over a checkout the save runs that script. Over rows there is no machine — ctx.script() answers
 * "the deploy runs it" — and a deployment with the repository out of the cycle and no deploy hook
 * never has one, so the declaration would never reach a row at all. A model says how it projects
 * itself with `projected`, and this refuses one that does not.
 *
 * It is the check teams and providers both needed and neither had. */
{
  const models = await registry(SITE, {})
  /* the deepest directory that is a model's own, and never a single-record model (whose dir is
     content/ itself and would otherwise claim every path there is) */
  const byDepth = models.filter((m) => m.dir && !m.single).sort((x, y) => y.dir.length - x.dir.length)
  const owns = (dir) => byDepth.find((m) => m.dir === dir || dir.startsWith(m.dir + '/'))
  for (const [table, d] of Object.entries(DECLARED)) {
    const froms = (Array.isArray(d.from) ? d.from : [d.from]).filter((x) => typeof x === 'string' && x.startsWith('content/'))
    if (!froms.length) continue
    const dirs = [...new Set(froms.map((f) => f.split('/').filter((s) => !s.includes('*') && !s.endsWith('.md') && !s.endsWith('.json')).join('/')))]
    const m = dirs.map(owns).find(Boolean)
    if (!m) continue   /* a source no model owns is the other check's complaint, not this one */
    ok(table + ' can be projected with no machine (' + m.key + ')', typeof m.projected === 'function',
      'the ' + m.key + ' model needs a projected(ctx): over rows a publish is the only moment it can reach the database, and ctx.script() cannot run there')
  }
}

for (const [f, why] of Object.entries(FS_DEBT)) console.log('  ⋯ owed     ' + f + ' — ' + why)
for (const [dir, v] of pendingOf()) console.log(`  ⋯ pending  ${dir} — ${v.pending}`)
console.log('\ncontent-kinds: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
