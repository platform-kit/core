/*
 * The content pipe, pinned: the registry on a fixture site (the core models, keys unique, each with its parts), on
 * this site and on the demo; the admin server's route table (the pipe's endpoints and the three beside it, nothing
 * else; no retired path under the theme's src); a save through the pipe refused before the write and the hook; and,
 * with --roundtrip, every file a model owns under content/ read through its model and written back unchanged —
 * the check that the eleven ways became one without a file moving. `npm test` runs it; the round trip by hand over
 * a site (node build/pipe.test.mjs --roundtrip).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registry, byKey, read, write, list, describe, namesOf, fileOf, cleanData } from './models/index.mjs'
import { CORE } from './models/core/index.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let n = 0, bad = 0
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 4).join('\n    ')) } }
const ROOT = process.cwd()

/* ---- the round trip: every record of every model with a file, read and serialised — byte for byte where the file is
   already in its model's canonical form (every file the admin wrote is), and by meaning otherwise: the record it parses
   to again, its data and its body, deep-equal. A file that loses meaning is a fault; one that only gains its canonical
   form is counted. ---- */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
async function roundTrip(root, models) {
  const diffs = [], seen = [], canonical = []
  for (const m of models) {
    if (m.list && !m.grammar.parse) continue
    let names = []
    try { names = await namesOf(m, root) } catch { continue }
    for (const name of names) {
      let file
      try { file = path.join(root, fileOf(m, name, root)) } catch { continue }
      if (!fs.existsSync(file)) continue
      const text = fs.readFileSync(file, 'utf8')
      let rec, out
      try { rec = await m.grammar.parse(text, { root, name, file }) } catch (e) { diffs.push(`${path.relative(root, file)}: parse — ${e.message}`); continue }
      try { out = await m.grammar.serialise({ name, ...rec }, { root, name, file, current: text }) } catch (e) { if (/written by its action|not used/.test(e.message)) continue; diffs.push(`${path.relative(root, file)}: serialise — ${e.message}`); continue }
      const rel = path.relative(root, file)
      seen.push(rel)
      if (out === text) { canonical.push(rel); continue }
      let back
      try { back = await m.grammar.parse(out, { root, name, file }) } catch (e) { diffs.push(`${rel}: the file written back does not parse — ${e.message}`); continue }
      /* what the writer never writes — `published: true` (the default), an empty list, a blank — is no loss; a trailing blank line is nothing */
      const strip = (r) => ({ data: cleanData(r.data || {}), content: String(r.content || '').replace(/\s+$/, ''), parsed: r.parsed })
      if (!same(strip(back), strip(rec))) diffs.push(rel)
    }
  }
  return { diffs, seen, canonical }
}

if (process.argv.includes('--roundtrip')) {
  const models = await registry(ROOT)
  const { diffs, seen, canonical } = await roundTrip(ROOT, models.filter((m) => !['print', 'recommendations', 'policy'].includes(m.key)))
  console.log(`${seen.length} file(s) read through their models and written back: ${canonical.length} byte for byte, ${seen.length - canonical.length - diffs.length} the same in meaning (hand-written, canonical once saved)`)
  if (diffs.length) { console.log('✖ these lose meaning:\n  ' + diffs.join('\n  ')); process.exit(1) }
  console.log('✔ no file loses a key, a value or its body'); process.exit(0)
}

await ta('the core models: keys unique, a dir and a grammar each, the parts where they belong', async () => {
  assert.equal(new Set(CORE.map((m) => m.key)).size, CORE.length)
  for (const m of CORE) { assert.ok(m.key && m.dir, m.key); if (m.grammar) { assert.equal(typeof m.grammar.parse, 'function', m.key); assert.equal(typeof m.grammar.serialise, 'function', m.key) } }
  const forms = CORE.find((m) => m.key === 'forms'); assert.equal(forms.editor, 'FormBuilder'); assert.ok(forms.actions.create && forms.after)
  const books = CORE.find((m) => m.key === 'books'); assert.ok(books.prepare && books.checks.length && books.fields)
  assert.ok(CORE.find((m) => m.key === 'print').actions.pdf)
})
/* every core model, with every module on; on this site, those of the modules it has on */
const ALL = { root: ROOT, modules: {}, admin: {} }
await ta('the registry on this site: the core, the site\'s own, every published custom model; a module off leaves its models out', async () => {
  const all = await registry(ROOT, { site: ALL })
  for (const k of ['articles', 'books', 'forms', 'funnels', 'emails', 'strings', 'models', 'print']) assert.ok(byKey(all, k), k)
  const r = await registry(ROOT)
  for (const k of ['articles', 'books', 'site']) assert.ok(byKey(r, k), k)
  const off = await registry(ROOT, { site: { root: ROOT, modules: { forms: false, print: false }, admin: {} } })
  assert.ok(!byKey(off, 'forms') && !byKey(off, 'print') && byKey(off, 'articles'))
  const d = await describe(byKey(r, 'articles'), ROOT); assert.ok(d.core && !d.custom && d.fields.length && typeof d.count === 'number')
})
await ta('the route table: the pipe\'s endpoints and the three beside it, and no retired path under the theme', async () => {
  /* the pipe's routes are admin-pipe.mjs's (the function's too); the runs are the dev server's own */
  const src = fs.readFileSync(path.join(HERE, 'admin-server.mjs'), 'utf8') + fs.readFileSync(path.join(HERE, 'admin-pipe.mjs'), 'utf8')
  const routes = [...src.matchAll(/seg === '([a-z/-]+)'/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort()
  assert.deepEqual(routes, ['action', 'asset', 'collections', 'drafts', 'file', 'images', 'keep', 'list', 'media', 'media-file', 'options', 'preview', 'publish', 'run', 'run/stop', 'upload', 'upload-image'])   /* drafts · publish · keep: cloud mode's, answered from the checkout as empty and no-ops */
  const theme = path.join(HERE, '../../movable-types/src')
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  const hits = walk(theme).filter((f) => /\.(vue|js)$/.test(f)).filter((f) => /__admin\/(forms|funnels|emails|strings|models|print|quiz|recommendations)\b/.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
  assert.deepEqual(hits.map((f) => path.relative(theme, f)), [])
})
await ta('a save through the pipe: refused before the write and the hook; a good save writes once and runs the hook once', async () => {
  const d = fs.mkdtempSync(path.join(HERE, '.pipe-'))
  try {
    fs.mkdirSync(path.join(d, 'content/funnels'), { recursive: true })
    const m = byKey(await registry(ROOT, { site: ALL }), 'funnels')
    let hooks = 0
    const test = { ...m, after: () => { hooks++ } }
    await assert.rejects(() => write(test, 'welcome', { data: { title: 'Welcome' }, parsed: { steps: [] } }, d, { create: true }), /at least one step/)
    assert.ok(!fs.existsSync(path.join(d, 'content/funnels/welcome.md')) && hooks === 0)
    await assert.rejects(() => write(test, 'Bad Name', { data: { title: 'x' }, parsed: { steps: [{ title: 'One', after: '1d', subject: 'Hi', body: 'Hello' }] } }, d, { create: true }), /lower-case words/)
    await write(test, 'welcome', { data: { title: 'Welcome', published: true }, parsed: { steps: [{ title: 'One', after: '1d', subject: 'Hi', body: 'Hello' }] } }, d, { create: true })
    assert.ok(fs.existsSync(path.join(d, 'content/funnels/welcome.md')) && hooks === 1)
    const back = await read(test, 'welcome', d)
    assert.equal(back.data.title, 'Welcome'); assert.equal(back.parsed.steps.length, 1)
    const items = await list(test, d); assert.equal(items.length, 1); assert.ok(items[0].words)
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})
await ta('the round trip over the fixtures: the models\' and the forms\' files come back byte for byte', async () => {
  const models = await registry(ROOT, { site: ALL })
  const d = fs.mkdtempSync(path.join(HERE, '.pipe-'))
  try {
    fs.cpSync(path.join(HERE, 'fixtures/models/site/content'), path.join(d, 'content'), { recursive: true })
    fs.mkdirSync(path.join(d, 'content/forms'), { recursive: true })
    fs.copyFileSync(path.join(HERE, 'fixtures/forms/every-kind.md'), path.join(d, 'content/forms/every-kind.md'))
    const { diffs, seen, canonical } = await roundTrip(d, [byKey(models, 'models'), byKey(models, 'forms')])
    assert.ok(seen.length >= 3, 'files seen: ' + seen.join(', '))
    assert.deepEqual(diffs, [])
    assert.deepEqual(canonical.sort(), seen.sort(), 'the fixtures are canonical: byte for byte')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

/*
 * EVERY BARE NAME A FUNCTION IMPORTS IS IN ITS OWN IMPORT MAP.
 *
 * Deno resolves nothing by walking node_modules: a bare specifier is either in that function's
 * deno.json or the worker does not boot — and a worker that does not boot answers 503 to every
 * request, so one missing line takes down every function that shares the code, not the one that
 * added it. Nothing else sees it: the assembler is happy (the file is there), the closure guard is
 * happy (the specifier is not relative), the suite is happy, and the first thing to notice is a
 * reader. That is exactly what adding `yaml` to the grammar did — eight functions at once.
 *
 * So it is walked rather than remembered: from each function's entry, follow the RELATIVE imports
 * it actually reaches, and collect the bare names those files ask for. Reachability matters — a
 * file sitting in the tree that nothing imports never asks the runtime for anything, and holding a
 * function to it would be inventing work.
 */
await ta('every bare name a function reaches is in its own import map', async () => {
  const fns = path.join(ROOT, 'supabase', 'functions')
  if (!fs.existsSync(fns)) return   /* not assembled here */
  const BARE = /^\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]/gm
  const PLAIN = /^\s*import\s*['"]([^'"]+)['"]/gm
  const ext = (p) => (fs.existsSync(p) ? p : ['.ts', '.js', '.mjs', '/index.ts', '/index.js', '/index.mjs'].map((e) => p + e).find((c) => fs.existsSync(c)))
  const specs = (text) => [...text.matchAll(BARE), ...text.matchAll(PLAIN)].map((m) => m[1])
  function reach(entry) {
    const seen = new Set(), names = new Set(), queue = [entry]
    while (queue.length) {
      const file = queue.pop()
      if (!file || seen.has(file)) continue
      seen.add(file)
      let text = ''
      try { text = fs.readFileSync(file, 'utf8') } catch { continue }
      for (const spec of specs(text)) {
        if (spec.startsWith('.') || spec.startsWith('/')) { const next = ext(path.resolve(path.dirname(file), spec)); if (next) queue.push(next); continue }
        if (/^(npm|node|jsr|https?|data):/.test(spec)) continue
        names.add(spec)
      }
    }
    return names
  }
  const gaps = []
  for (const dir of fs.readdirSync(fns, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_'))) {
    const entry = ext(path.join(fns, dir.name, 'index'))
    if (!entry) continue
    const cfg = path.join(fns, dir.name, 'deno.json')
    const map = fs.existsSync(cfg) ? (JSON.parse(fs.readFileSync(cfg, 'utf8')).imports || {}) : {}
    /* a subpath of a mapped package is resolved by that package's own exports (zod/v4 under
       "zod"), so the package root being mapped is what matters; a prefix key ending in / maps its
       whole subtree by the import-map spec */
    const has = (name) => map[name] != null || map[name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')] != null ||
      Object.keys(map).some((k) => k.endsWith('/') && name.startsWith(k))
    for (const name of reach(entry)) if (!has(name)) gaps.push(dir.name + ' → "' + name + '"')
  }
  assert.deepEqual(gaps.sort(), [], 'a function cannot resolve a name it imports — its worker will not boot, and every request to it is a 503')
})

/*
 * A CONDITION NOBODY READS IS NOT A CONDITION.
 *
 * The admin shows a field conditionally with `shown: { field, is, value }`. The LANDING SECTIONS
 * renderer uses `when: { field: value }` for the same idea, and writing that one in a model is
 * silently ignored — the field simply always shows. Five of them were written that way in one
 * afternoon: a promotion for the whole order asked which lines it applied to, and a product
 * that does not count stock offered to sell past zero.
 *
 * Nothing failed, which is the point of checking it here.
 */
{
  const src = fs.readFileSync(new URL('./models/core/collections.mjs', import.meta.url), 'utf8')
  const stray = [...src.matchAll(/^.*\bwhen: \{.*$/gm)].map((m) => m[0].trim().slice(0, 90))
  ta('no model uses `when:` where the admin reads `shown:`', () => assert.deepEqual(stray, [], 'these conditions are ignored:\n      ' + stray.join('\n      ')))
  /* and every `shown` names a field the model actually has. Fields come two ways — a zod key,
     and a `{ key: 'x' }` row inside a nested list — so both are collected, or the check
     invents faults for the second kind. */
  const fields = new Set([
    ...[...src.matchAll(/^\s*(\w+): z\./gm)].map((m) => m[1]),
    ...[...src.matchAll(/\{ key: '([\w-]+)'/g)].map((m) => m[1]),
  ])
  const named = [...src.matchAll(/shown: \{ field: '(\w+)'/g)].map((m) => m[1])
  /*
   * AND `is` IS THE OPERATOR, NOT THE VALUE. `shown: { field, is, value }` where `is` is one of
   * `in` · `not-in` · `is-not` · `empty` · `not-empty`, and absent means equals. Writing the
   * VALUE as `is` makes the operator a word nobody knows, which falls through to comparing
   * against an undefined `value` — so the field is hidden ALWAYS rather than conditionally, and
   * an editor silently loses a control. Got wrong immediately after getting the key wrong.
   */
  /* `is` spelt out is equals, which shownHolds falls through to; the rest are the real operators */
  const OPS = ['is', 'in', 'not-in', 'is-not', 'empty', 'not-empty']
  {
    const bad = [...src.matchAll(/shown: \{([^}]*)\}/g)].map((m) => m[1]).filter((body) => {
      const is = /\bis: '([^']*)'/.exec(body)
      if (!is) return false
      return !OPS.includes(is[1])
    })
    ta('`is` is an operator, never a value', () => assert.deepEqual(bad, [], 'these read as operators and are not:\n      ' + bad.join('\n      ')))
  }
  /* a condition that can never hold is worse than none: it hides a control for ever */
  {
    const { shownHolds } = await import('../src/lib/models/entry.js')
    const conds = [...src.matchAll(/shown: \{ field: '(\w+)', value: ([^}]+) \}/g)].map((m) => ({ field: m[1], raw: m[2].trim() }))
    ta('every equals-condition holds for at least one value of its field', () => {
      for (const c of conds) {
        const v = c.raw === 'true' ? true : c.raw === 'false' ? false : c.raw.replace(/^'|'$/g, '')
        assert.ok(shownHolds({ field: c.field, value: v }, { [c.field]: v }), `shown on ${c.field} never holds, so the control is hidden for ever`)
      }
    })
  }
  /*
   * A LIST OF ROWS MUST SAY WHAT A ROW IS.
   *
   * The zod is for validation; the DRAWER needs the shape spelt out — `kind: 'list'`, `of:
   * 'group'`, and the row's own `fields`. Without them RowsField falls through to a leaf of no
   * kind and renders each row as an empty strip with an × beside it: the editor can add and
   * remove rows it cannot see or fill. Four fields were written that way in one afternoon, and
   * nothing failed — the page simply had blank boxes on it.
   */
  {
    const bad = [...src.matchAll(/z\.array\(z\.object\(\{[\s\S]*?\}\)\)\.meta\(\{([^\n]*)\}\)/g)]
      .map((m) => m[1])
      .filter((meta) => /widget: 'rows'/.test(meta) && !/of: 'group'/.test(meta))
      .map((meta) => (/label: '([^']*)'/.exec(meta) || [,'?'])[1])
    ta('every rows-of-objects field says what a row is', () => assert.deepEqual(bad, [], 'these render as empty strips:\n      ' + bad.join('\n      ')))
  }
  /* and a group likewise */
  {
    const bad = [...src.matchAll(/z\.object\(\{[\s\S]*?\}\)\.meta\(\{([^\n]*)\}\)/g)]
      .map((m) => m[1])
      .filter((meta) => /widget: 'group'/.test(meta) && !/fields: \[/.test(meta))
      .map((meta) => (/label: '([^']*)'/.exec(meta) || [,'?'])[1])
    ta('every group field says what is in it', () => assert.deepEqual(bad, [], 'these render empty:\n      ' + bad.join('\n      ')))
  }
  ta('every shown-when names a real field', () => { for (const f of named) assert.ok(fields.has(f), `shown names "${f}", which no field is called`) })
}
console.log(`${bad ? '✖' : '✔'} pipe: ${n - bad}/${n} checks`)
if (bad) process.exit(1)
