/*
 * The docs stay true to the code, or nothing is done. Two kinds of check over the documentation — the docs
 * site's pages (sites/docs/content/docs) and the repo's docs:
 * docs/PLATFORMKIT.md, docs/COMPETITORS.md, docs/PURPOSE.md and docs/FEATURES.md.
 *
 *   1. STALENESS. Every page names the code it describes — `sources:` in its frontmatter (or a
 *      `<!-- sources: … -->` line in a repo doc): files, or directories as prefixes. A page whose source has
 *      changed while the page has not is stale, and stale fails: at a commit (the staged files), at the end
 *      of an agent's turn (the working tree), in CI (the commit against its parent). A page is current again
 *      when it is edited in the same change — or, when it was re-read and found still right, when its
 *      `reviewed:` date is set, a deliberate act that shows in the diff.
 *   2. EXACTNESS. The reference pages state facts the code also states, and those are compared outright:
 *      every environment variable the kit reads is on the environment page and every one listed is read;
 *      every CLI command is a case in bin/platformkit.mjs and vice versa; every module the kit knows is on
 *      the modules page; every string scope the theme ships is on the strings page; every frontmatter field
 *      of every shared collection is on the frontmatter page; every internal link resolves.
 *   3. COVERAGE. The docs site is the canonical documentation (PlatformKit.com), so a piece of the kit that no
 *      docs-site page names is undocumented, whatever a repo doc says. Every entry of the documented surfaces —
 *      an Edge Function, a `_shared` module, a schema file, a build script or step, a library module, a page
 *      of the theme, a deploy path — must be named by some page under sites/docs/content/docs (itself, or a
 *      directory above it) as one of its `sources:`. A new file in a surface fails until a page names it: at
 *      the commit, at the end of the turn, in npm test — and the touched hook says so the moment it is written.
 *
 * Modes:  --staged     the staged files (the pre-commit hook and the agent's commit guard)
 *         --tree       the working tree against HEAD (the agent's stop guard)
 *         --range A..B a commit range (CI)
 *         --touched F  print the pages that describe file F, for a reminder as it is edited (never fails)
 *         --message S | --message-file F   the commit's message, for the rule that a kit change writes a page
 *         (none)       exactness alone, plus every page's sources must exist (npm test)
 * Output: one line per fault, the page and the reason; exit 1 on any. --json for the hooks.
 * Run from the repository root (the monorepo) — it knows where the docs site is.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { loadEnv } from 'vite'
import { defaultSite, workspaceRoot } from './sites.mjs'
import { isReviewedForCurrentDate } from './docs-review-date.mjs'

const ROOT = workspaceRoot(process.cwd())
const DOCS = 'sites/docs/content/docs'
const REPO_DOCS = ['docs/PLATFORMKIT.md', 'docs/COMPETITORS.md', 'docs/PURPOSE.md', 'docs/FEATURES.md']
const SETTINGS = { ...loadEnv('development', ROOT, 'PLATFORMKIT_'), ...process.env }
const SITE_ROOT = (() => {
  const cwd = path.resolve(process.cwd())
  if (fs.existsSync(path.join(cwd, 'platformkit.config.js'))) return cwd
  if (fs.existsSync(path.join(ROOT, 'platformkit.config.js'))) return ROOT
  return defaultSite(ROOT, SETTINGS).directory
})()
const ENV_EXAMPLE = [
  path.join(ROOT, '.env.example'),
  path.join(ROOT, 'sites/demo/.env.example'),
].find((file) => fs.existsSync(file))
const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const after = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const json = flag('--json')

/* ---- the pages and their sources ---- */
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []) : []
const pages = [...walk(path.join(ROOT, DOCS)), ...REPO_DOCS.map((f) => path.join(ROOT, f))].filter((f) => fs.existsSync(f)).map((f) => {
  const rel = path.relative(ROOT, f)
  const text = fs.readFileSync(f, 'utf8')
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  let sources = []
  const m = fm ? /^sources:\s*\[([^\]]*)\]/m.exec(fm[1]) : /^\*\*Sources:\*\*\s*(.*?)\s*$/m.exec(text)
  if (m) sources = m[1].split(',').map((s) => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean)
  const rv = fm ? /^reviewed:\s*(\d{4}-\d{2}-\d{2})/m.exec(fm[1]) : /^\*\*Reviewed:\*\*\s*`?(\d{4}-\d{2}-\d{2})`?\s*$/m.exec(text)
  return { file: rel, text, sources, reviewed: rv ? rv[1] : '' }
})
const covers = (page, file) => page.sources.some((s) => file === s || file.startsWith(s.replace(/\/$/, '') + '/'))

/* the documented surfaces (coverage, check 3): every entry must be named by a docs-site page — itself or a directory above it */
const SURFACES = [
  ['packages/kit/supabase/functions', (e) => e.isDirectory() && e.name !== '_shared'],
  ['packages/kit/supabase/functions/_shared', (e) => e.name !== 'vendor' && e.name !== 'pipe' && !e.name.endsWith('.json')],
  ['packages/kit/supabase/schemas', (e) => e.isFile() && e.name.endsWith('.sql')],
  ['packages/kit/build', (e) => e.isFile() && e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs') && !/^site(-[a-z-]+)?-node\.mjs$/.test(e.name)],
  ['packages/kit/build/steps', (e) => e.isFile() && e.name.endsWith('.mjs') && e.name !== 'index.mjs'],
  ['packages/kit/src/lib', (e) => true],
  ['packages/kit/src/sdk', (e) => true],
  ['packages/kit/theme/src/pages', (e) => e.isFile()],
  ['deploy', (e) => true],
]
/* a source covers an entry when it names it, something inside it, or a directory below the surface's root — the surface root
   itself (`packages/kit/supabase/functions`) is the page that lists every function, and listing is not documenting one */
const ROOTS = new Set(SURFACES.map(([d]) => d).filter((d) => !['packages/kit/build/steps', 'packages/kit/src/sdk'].includes(d)))   /* the steps and the sdk are documented as a whole, on purpose */
const covered = (rel) => pages.some((p) => p.file.startsWith(DOCS + '/') && p.sources.some((s) => { const src = s.replace(/\/$/, ''); if (ROOTS.has(src) || [...ROOTS].some((r) => r.startsWith(src + '/'))) return false; return rel === src || rel.startsWith(src + '/') || src.startsWith(rel + '/') }))
function uncovered(only = null) {
  const out = []
  for (const [dir, pick] of SURFACES) { if (!fs.existsSync(path.join(ROOT, dir))) continue; for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) { if (!pick(e)) continue; const rel = dir + '/' + e.name; if (only && !only.some((f) => f === rel || f.startsWith(rel + '/'))) continue; if (!covered(rel)) out.push(rel) } }
  return out
}

/* THE COMMIT'S OWN MESSAGE, for the one rule that reads it (1b below). It arrives three ways: from
   --message (the agent's commit guard, which has the command in hand and so the message before the
   commit exists), from --message-file (git's own COMMIT_EDITMSG, which the pre-commit hook has), or
   from the range's commits (CI). A check that cannot see a message treats it as empty, which fails
   closed: the rule then asks for a page rather than accepting an escape it cannot read. */
const MESSAGE = (() => {
  const m = after('--message')
  if (m) return m
  const f = after('--message-file')
  if (f && fs.existsSync(path.resolve(ROOT, f))) return fs.readFileSync(path.resolve(ROOT, f), 'utf8')
  const r = after('--range')
  if (r) { try { return execSync(`git log --format=%B ${r}`, { cwd: ROOT, encoding: 'utf8' }) } catch { return '' } }
  return ''
})()

const faults = []
const fault = (page, why) => faults.push({ page, why })

/* ---- 1. staleness ---- */
const git = (cmd) => { try { return execSync('git ' + cmd, { cwd: ROOT, encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter(Boolean) } catch { return [] } }
const tracked = (file) => git(`ls-files -- "${file}"`).includes(file)
let changed = null
if (flag('--staged')) changed = git('diff --cached --name-only')
else if (flag('--tree')) changed = [...git('diff --name-only HEAD'), ...git('ls-files --others --exclude-standard')]
else if (after('--range')) changed = git(`diff --name-only ${after('--range')}`)
const touched = after('--touched')
if (touched) {
  const rel = path.relative(ROOT, path.resolve(touched)).split(path.sep).join('/')
  const hits = pages.filter((p) => covers(p, rel)).map((p) => p.file)
  const orphan = uncovered([rel]).length > 0
  if (json) console.log(JSON.stringify({ file: rel, pages: hits, orphan }))
  else if (orphan) console.log(`${rel} is in a documented surface and no docs-site page names it — the docs site is the canonical documentation: write its page under ${DOCS}/ (or add it to the page that describes it); the commit is refused until one does.`)
  else if (hits.length) console.log(`${rel} is described by:\n  ${hits.join('\n  ')}\nUpdate them in this change, or set their reviewed: date having read them.`)
  process.exit(0)
}
if (changed) {
  const set = new Set(changed)
  /* A page reviewed today has been read against today's changes already: a second change the same day
     cannot move the date. `reviewed:` is a human calendar date, so a UTC process also accepts the
     date of the reviewer in the UTC−12 to UTC+14 range around the machine's current date. */
  const now = new Date()
  for (const p of pages) {
    if (set.has(p.file)) continue
    if (isReviewedForCurrentDate(p.reviewed || '', now)) continue
    const hit = changed.filter((f) => covers(p, f))
    if (hit.length) fault(p.file, `stale — describes ${hit.slice(0, 3).join(', ')}${hit.length > 3 ? ` and ${hit.length - 3} more` : ''}, changed while the page was not (edit it, or set reviewed: having re-read it)`)
  }
}
/*
 * ---- 1b. A CHANGE TO THE KIT CHANGES THE DOCS, OR SAYS WHY NOT ----
 *
 * Staleness above is satisfied by setting a page's `reviewed:` date, which is right when the page
 * was re-read and found still true — and is also a way past the gate. Twelve commits of one
 * afternoon were measured: several touched the kit and changed the docs by exactly one line each,
 * which was the date and nothing else, and one changed a theme stylesheet with no docs change at
 * all. So the guard was holding, and the docs were not being written.
 *
 * The kit is the open-source product: what it does IS its documentation. A commit that changes it
 * must therefore change a page's WORDS — a `reviewed:` flip is not documentation — or say in its
 * own message why none was needed. The escape is deliberate and accountable: a refactor with no
 * observable change genuinely needs no page edited, and forcing one would buy noise rather than
 * documentation. Saying so in the message leaves the reason in the history, where the next person
 * looking at that commit will find it.
 *
 *   Docs: none — internal refactor, no observable behaviour
 *
 * Only the pages' own words count: a page edited only on its `reviewed:` line is a page re-read,
 * not a page written.
 */
const KIT = ['packages/kit/', 'packages/kit/theme/']
/* what this commit will hold, as text, so a page edited only on its date can be told from a page
   whose words changed. --staged reads the index; --tree reads the working tree; a range reads the
   range. Anything else (npm test with no mode) knows no commit and does not ask. */
const diffOf = (file) => {
  if (!tracked(file)) return fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').map((line) => `+${line}`) : []
  const where = flag('--staged') ? '--cached' : after('--range') ? after('--range') : 'HEAD'
  const out = git(`diff ${where} -U0 -- "${file}"`)
  return out.filter((l) => (l.startsWith('+') || l.startsWith('-')) && !/^(\+\+\+|---)/.test(l))
}
const isDoc = (f) => f.startsWith(DOCS + '/') || /^docs\/[^/]+\.md$/.test(f)
/* a page whose only changed lines are its reviewed: date has been re-read, not rewritten */
const rewritten = (f) => diffOf(f).some((l) => !/^[+-]\s*(reviewed:|<!--\s*reviewed:)/.test(l))

/* --no-message-rule: the caller cannot see the message yet (the pre-commit hook runs before the
   message is prepared), so it runs every other rule and leaves this one to the commit-msg hook,
   which IS handed the message. Without the split the documented escape could never be used. */
if (changed && !after('--touched') && !flag('--no-message-rule')) {
  const kit = changed.filter((f) => KIT.some((d) => f.startsWith(d)))
  const docs = changed.filter(isDoc)
  /* a new page has no diff against HEAD and is documentation by definition */
  const written = docs.filter((f) => !fs.existsSync(path.join(ROOT, f)) || rewritten(f) || !tracked(f))
  if (kit.length && !written.length && !/^Docs:\s*none\b/im.test(MESSAGE)) {
    fault(DOCS, `this change touches the kit (${kit.slice(0, 3).join(', ')}${kit.length > 3 ? ` and ${kit.length - 3} more` : ''}) and no docs-site page's WORDS changed${docs.length ? ` — ${docs.length} page(s) moved only their reviewed: date, which is a page re-read and not a page written` : ''}. The kit is the product and what it does is its documentation: write the page, or put a line in the commit message saying why none was needed — "Docs: none — <reason>".`)
  }
}

/* every source named must exist, so a renamed file cannot orphan a page silently */
for (const p of pages) for (const s of p.sources) if (!fs.existsSync(path.join(ROOT, s))) fault(p.file, `names a source that does not exist: ${s}`)
for (const p of pages) if (!p.sources.length) fault(p.file, 'names no sources: — add `sources: [...]` (the files or directories it describes)')

/* ---- 3. coverage (the surfaces are declared above, beside the pages) ---- */
for (const rel of uncovered(changed)) fault(rel, `no docs-site page names it in sources: — the docs site is the canonical documentation: write its page under ${DOCS}/ (or add it to the page that describes it)`)

/* The public documentation is generic. A workspace package is not the customer site at its root. */
{
  const rootConfig = path.join(ROOT, 'platformkit.config.js')
  const readName = () => {
    try {
      const cfg = fs.readFileSync(rootConfig, 'utf8')
      const m = cfg.match(/^\s*name:\s*['"`]([^'"`]+)['"`]/m)
      return m ? m[1] : null
    } catch { return null }
  }
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name || '' } catch { return '' } })()
  const names = fs.existsSync(rootConfig) ? [readName(), (pkg.match(/^@([^/]+)\//) || [])[1]].filter(Boolean) : []
  const PUBLIC = [...pages.filter((p) => p.file.startsWith(DOCS + '/')), ...pages.filter((p) => p.file === 'docs/COMPETITORS.md')]
  for (const n of new Set(names.map((x) => x.toLowerCase()))) {
    if (n.length < 4) continue
    const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\/* ---- 2. exactness ---- */'), 'i')
    for (const p of PUBLIC) {
      if (!re.test(p.text)) continue
      const line = p.text.split('\n').findIndex((l) => re.test(l)) + 1
      fault(p.file, `names the root site (line ${line}) — the docs site is PlatformKit's own documentation and a reader of it has no such site: use the demo, or say what a site does rather than which one`)
    }
  }
}

/* ---- 2. exactness ---- */
const page = (name) => pages.find((p) => p.file === `${DOCS}/${name}.md`)
/* THE NAMES A PAGE SAYS IN CODE. A tick holding a name and then its shape — `display { truth,
   mode }`, `sections[] { component, props }`, `bot:` — says that name as surely as a bare one,
   so the first identifier in a tick counts. Without that the check asked for a bare repetition
   of a word the page had already used better, which is a worse page for no gain. */
const ticks = (text) => new Set([...text.matchAll(/`([A-Za-z_][A-Za-z0-9_.-]*)[^`]*`/g)].map((m) => m[1]))
const readAll = (dirs, exts) => dirs.flatMap((d) => walk2(path.join(ROOT, d), exts)).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
const walk2 = (d, exts) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' || e.name === 'supertonic' ? [] : walk2(path.join(d, e.name), exts)) : exts.some((x) => e.name.endsWith(x)) ? [path.join(d, e.name)] : []) : []

/* environment variables: read by the kit or the theme, or demanded by the deploy check — each on the page, and each on the page read somewhere */
{
  const doc = page('reference/environment-variables')
  if (doc) {
    const codeFiles = ['packages/kit/build', 'packages/kit/src', 'packages/kit/vite', 'packages/kit/bin', 'packages/kit/agent', 'packages/kit/supabase/functions', 'packages/kit/theme/src']
      .flatMap((dir) => walk2(path.join(ROOT, dir), ['.mjs', '.js', '.ts', '.vue']))
      .filter((file) => !file.endsWith('.integration.mjs'))
    const code = codeFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
    const read = new Set([...code.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]))
    for (const m of code.matchAll(/need\('([A-Z_]+)'|has\(env, '([A-Z_]+)'\)|\['([A-Z_]{4,})', "|\benv\.([A-Z][A-Z0-9_]{3,})/g)) read.add(m[1] || m[2] || m[3] || m[4])
    for (const m of code.matchAll(/Deno\.env\.get\(['"]([A-Z_][A-Z0-9_]*)['"]\)/g)) read.add(m[1])
    for (const m of code.matchAll(/\benv\(['"]([A-Z_][A-Z0-9_]*)['"]\)/g)) read.add(m[1])
    /* names the code makes rather than writes: per-site URL variables, provider mocks, and script tokens */
    for (const v of ['PLATFORMKIT_SITE_', 'LULU_MOCK', 'MIXAM_MOCK', 'BOOKVAULT_MOCK', 'PRINT_GITHUB_TOKEN', 'TTS_GITHUB_TOKEN']) read.add(v)
    const exampleText = ENV_EXAMPLE ? fs.readFileSync(ENV_EXAMPLE, 'utf8') : ''
    const example = new Set([...exampleText.matchAll(/^#?([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]))
    if (exampleText.includes('PLATFORMKIT_SITE_<NAME>_GIT_URL=')) example.add('PLATFORMKIT_SITE_')
    const IGNORE = new Set(['NODE_ENV', 'DEV', 'PROD', 'CI', 'HOME', 'PATH', 'MODE', 'BASE_URL', 'SSR'])
    const listed = ticks(doc.text)
    for (const v of read) if (!IGNORE.has(v) && !listed.has(v)) fault(doc.file, `the kit reads ${v} and the page does not list it`)
    for (const v of read) if (!IGNORE.has(v) && !example.has(v)) fault(doc.file, `the kit reads ${v} and the root .env.example does not include it`)
    for (const v of listed) if (/^[A-Z][A-Z0-9_]{3,}$/.test(v) && v !== 'VITE_' && !read.has(v) && !example.has(v)) fault(doc.file, `lists ${v}, which nothing reads and .env.example does not name`)
  }
}
/* CLI commands: the cases of bin/platformkit.mjs */
{
  const doc = page('reference/cli')
  const bin = fs.readFileSync(path.join(ROOT, 'packages/kit/bin/platformkit.mjs'), 'utf8')
  const cases = new Set([...bin.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]))
  if (doc) for (const c of cases) if (!new RegExp('`' + c + '\\b').test(doc.text)) fault(doc.file, `platformkit ${c} is a command and the page does not list it`)
}
/* modules: every switch the sites' configs and the router know */
{
  const doc = page('building-a-site/modules')
  /*
   * THE KIT'S MODULES COME FROM THE MANIFESTS, not from scraping the sites' configs.
   *
   * This used to read `modules: { … }` out of three platformkit.config.js files and demand every
   * name it found in the kit's own reference pages. That was fine while only the kit had modules.
   * It stopped being fine the moment a SITE could add one: sites/demo declares `stockists`, which
   * is the press's own, and the check then insisted the kit's module reference document it — a
   * page about the kit listing a feature of one site that happens to live in this repository.
   *
   * A module declares itself, so the list is the manifests. A site's own is documented where it
   * belongs: the worked example in the "a site adds a module" section, checked just below.
   */
  const { MODULES } = await import('./modules/kit.mjs')
  const known = new Set(MODULES.map((m) => m.key))
  if (doc) for (const k of known) if (!ticks(doc.text).has(k)) fault(doc.file, `the module ${k} is not on the page`)
  const ref = page('reference/config-keys')
  if (ref) for (const k of known) if (!ticks(ref.text).has(k)) fault(ref.file, `the module ${k} is not in the modules row`)

  /*
   * A SITE'S OWN MODULE IS DOCUMENTED AS THE WORKED EXAMPLE. The kit's reference should not list
   * it, but the page that teaches somebody to add one has to show a real one that exists — an
   * example nobody can run is worse than none. sites/demo declares one; the page must name it.
   */
  {
    const t = fs.existsSync(path.join(ROOT, 'sites/demo/platformkit.config.js')) ? fs.readFileSync(path.join(ROOT, 'sites/demo/platformkit.config.js'), 'utf8') : ''
    const m = /modules:\s*\{([\s\S]*?)\}/.exec(t)
    const own = m ? [...m[1].matchAll(/(\w+):\s*(?:true|false)/g)].map((x) => x[1]).filter((k) => !known.has(k)) : []
    if (doc) for (const k of own) if (!ticks(doc.text).has(k)) fault(doc.file, `sites/demo adds the module ${k} and the page does not show it as the worked example`)
  }
}
/* THE PER-SHAPE TABLE IS COMPARED WITH THE MATRIX, CELL BY CELL. It is a table of what works where,
   and a table of that kind is worth nothing the moment it is a paragraph somebody remembers to
   update: build/modes.mjs is the declaration the code is already checked against, so the page is
   checked against it too. A module added there and not here is a fault, and so is a cell that
   disagrees. */
{
  const doc = page('building-a-site/modules')
  if (doc && doc.text.includes('| Module | static | git | cloud |')) {
    const { FEATURES } = await import('./modes.mjs')
    const cell = (v) => (v === true ? '✓' : v === false ? '—' : '◑')
    const rows = new Map()
    for (const line of doc.text.split('\n')) {
      const m = /^\|\s*`([a-z-]+)`\s*\|\s*(.)\s*\|\s*(.)\s*\|\s*(.)\s*\|/.exec(line.trim())
      if (m) rows.set(m[1], [m[2], m[3], m[4]])
    }
    for (const [k, f] of Object.entries(FEATURES)) {
      const r = rows.get(k)
      if (!r) { fault(doc.file, `the module ${k} is in build/modes.mjs and not in the per-shape table`); continue }
      const want = [cell(f.static), cell(f.git), cell(f.cloud)]
      for (const [i, shape] of ['static', 'git', 'cloud'].entries()) {
        if (r[i] !== want[i]) fault(doc.file, `${k} under ${shape} reads "${r[i]}" and build/modes.mjs says "${want[i]}"`)
      }
    }
    for (const k of rows.keys()) if (!FEATURES[k]) fault(doc.file, `the per-shape table names ${k}, which build/modes.mjs does not`)
  }
}
/* string scopes: the theme's defaults */
{
  const doc = page('running-a-site/settings/site-settings-and-strings')
  const dir = path.join(ROOT, 'packages/kit/theme/src/content/ui')
  if (doc && fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) { const scope = f.replace(/\.md$/, ''); if (!ticks(doc.text).has(scope)) fault(doc.file, `the theme ships the ${scope} scope and the page does not list it`) }
}
/* shared collection frontmatter fields: every schema key, on the page */
{
  const doc = page('reference/frontmatter')
  if (doc) {
    try {
      const { kitConfig } = await import(path.join(ROOT, 'packages/kit/build/velite.mjs'))
      const previousCwd = process.cwd()
      let cfg
      try {
        process.chdir(SITE_ROOT)
        cfg = await kitConfig()
      } finally {
        process.chdir(previousCwd)
      }
      const BUILT = new Set(['path', 'body', 'raw', 'toc', 'excerpt', 'metadata', 'published', 'slug', 'unit_amount'])
      /*
       * UNWRAP FIRST, AND REFUSE A COLLECTION THAT CANNOT BE READ.
       *
       * A collection with a `.transform()` or `.refine()` is a ZodEffects, whose `.shape` is on
       * the object INSIDE it — and this read `col.schema.shape`, found undefined and skipped.
       * Twenty-five of thirty-three collections are shaped that way, products among them, so
       * this check passed for years while reading eight. `continue` is what hid it: a check
       * that quietly covers nothing is worse than no check, because it is believed. It now
       * unwraps, and a schema it still cannot read is a fault by name.
       */
      const shapeOf = (z) => {
        for (let i = 0; z && i < 8; i++) {
          if (z.shape) return z.shape
          if (z._def && typeof z._def.shape === 'function') return z._def.shape()
          z = z._def && (z._def.schema || z._def.innerType || z._def.in || z._def.type)
        }
        return null
      }
      for (const [name, col] of Object.entries(cfg.collections)) {
        // Model collections are generated from each site's own content/models definitions.
        // Their fields are documented by that model grammar, not as shared collection fields.
        if (name.startsWith('models_')) continue
        const shape = col.schema && shapeOf(col.schema)
        if (!shape) { fault(doc.file, `${name}: its schema could not be read, so its fields are unchecked`); continue }
        for (const key of Object.keys(shape)) if (!BUILT.has(key) && !ticks(doc.text).has(key)) fault(doc.file, `${name}: the field ${key} is in the schema and not on the page`)
      }
    } catch (e) { fault(doc.file, 'the collections could not be read to compare (' + e.message.split('\n')[0] + ')') }
  }
}
/* the comparables: the "what it replaces" table in the overview mirrors the kit-principles spec's, row for row, in the
   first three columns (the fourth, what is left out, is prose). A difference here runs the OTHER way from drift:
   the overview is the front door for a feature — a row edited there is an instruction, and the answer is a change
   proposed against the spec, never a silent correction of the doc */
{
  /* the main spec once the platformkit change is archived; its delta before */
  const SPEC = fs.existsSync(path.join(ROOT, 'openspec/specs/kit-principles/spec.md')) ? 'openspec/specs/kit-principles/spec.md' : 'openspec/changes/platformkit/specs/kit-principles/spec.md'
  const table = (text) => { const rows = []; for (const line of text.split('\n')) { if (!/^\|/.test(line) || /^\|\s*-{3,}/.test(line)) continue; const cells = line.split('|').slice(1, -1).map((c) => c.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()); rows.push(cells) } return rows.filter((r) => r.length >= 3 && !/^instead of$/i.test(r[0])) }
  const norm = (c) => c.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
  if (fs.existsSync(path.join(ROOT, SPEC))) {
    const spec = table(fs.readFileSync(path.join(ROOT, SPEC), 'utf8'))
    const specBy = new Map(spec.map((r) => [norm(r[0]), r]))
    /* a row a live change already proposes against kit-principles is ahead of the spec on purpose, not a fault:
       the loop is doing its work (the row edited → the change proposed → the spec's table changes at archive) */
    const changes = path.join(ROOT, 'openspec', 'changes')
    const proposed = fs.existsSync(changes) ? fs.readdirSync(changes).filter((c) => c !== 'archive' && fs.existsSync(path.join(changes, c, 'specs', 'kit-principles', 'spec.md'))).map((c) => ({ change: c, text: norm(fs.readFileSync(path.join(changes, c, 'specs', 'kit-principles', 'spec.md'), 'utf8')) })) : []
    const proposedIn = (name) => { const p = proposed.find((x) => x.change !== 'platformkit' && x.text.includes(norm(name))); return p && p.change }
    for (const p of pages.filter((x) => /COMPETITORS\.md$|what-platformkit-is\.md$/.test(x.file))) {
      const rows = table(p.text)
      const seen = new Set()
      for (const r of rows) {
        const key = norm(r[0]); seen.add(key)
        const sp = specBy.get(key)
        if (proposedIn(r[0])) continue   /* proposed: the change named carries the row's new words */
        if (!sp) { fault(p.file, `the table has "${r[0]}", which kit-principles does not — an instruction? then /opsx:propose a change that adds it to the spec (${SPEC}); a slip? then remove the row`); continue }
        for (const [i, name] of [[1, 'module'], [2, 'what it does']]) if (norm(r[i]) !== norm(sp[i])) fault(p.file, `"${r[0]}" — the ${name} column reads "${r[i]}" and kit-principles says "${sp[i]}" — an instruction? then /opsx:propose a change against the spec; a slip? then match the spec`)
      }
      /* a spec row the table lacks — unless a live change proposes it under a new name (the row renamed there) */
      for (const [key, sp] of specBy) if (!seen.has(key) && !proposedIn(sp[0])) fault(p.file, `kit-principles has "${sp[0]}" and the table does not — add the row`)
    }
  }
}

/* links: every internal docs link resolves */
{
  const ids = new Set(pages.filter((p) => p.file.startsWith(DOCS + '/')).map((p) => p.file.slice(DOCS.length + 1).replace(/\.md$/, '')))
  for (const p of pages) for (const m of p.text.matchAll(/\]\(\/(?:content\/)?docs\/([^)#]+)\)/g)) if (!ids.has(m[1])) fault(p.file, `links to /docs/${m[1]}, which is not a page`)
}

/* ---- the report ---- */
if (json) { console.log(JSON.stringify({ ok: !faults.length, faults })); process.exit(faults.length ? 1 : 0) }
if (faults.length) {
  console.error(`✖ the docs disagree with the code — ${faults.length} fault(s):`)
  for (const f of faults) console.error(`  ${f.page}: ${f.why}`)
  console.error('The docs are part of the change: update the page, or set its reviewed: date having re-read it.')
  process.exit(1)
}
console.log(`✔ the docs agree with the code (${pages.length} pages${changed ? `, ${changed.length} changed file(s)` : ''})`)
