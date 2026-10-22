/*
 * PLATFORMKIT GENERATE — a new piece, written in the shape the checks accept, and registered (openspec: kit-generate).
 *
 *   platformkit generate <kind> <name> [--level site|core] [--module <key>] [--dry-run]
 *
 * KINDS: module, page, content-type, function, test, step.
 *
 * TWO LEVELS. `site` (the default) writes into the site's own repository and registers through its
 * platformkit.config.js — the same registrations the demo's stockists uses, so nothing in PlatformKit opens up
 * for it. `core` writes into PlatformKit itself, in its own form (the module list, the steps' and models'
 * indexes, App.vue for a page, the test list), with a stub docs page naming every new file, since the docs
 * check refuses an undocumented one. Core is refused unless PlatformKit is a checkout: a site that installed
 * it from npm never edits node_modules.
 *
 * TEMPLATES are files under build/generators/<level>/<kind>/ with @@name@@-style placeholders (Vue templates
 * already use {{ }}); a file named _*.tmpl is a fragment inserted into an existing file, never written alone.
 * A site's generators/<kind>/ replaces the kit's site templates for that kind, whole.
 *
 * EDITS ARE INSERTIONS. A config, a manifest or an index is parsed (Rollup's parser, which Vite brings) only to
 * find WHERE; the new entry is inserted as text at that offset, so every comment and every line already there
 * is untouched. A config that is not an object literal it can find is left alone, and the lines to add are
 * printed instead. Nothing is overwritten: a file that exists, or a module name already declared, writes nothing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const KIT_ROOT = path.resolve(HERE, '..')
export const KINDS = ['module', 'page', 'content-type', 'function', 'test', 'step']

/* ---- names ---- */
const words = (n) => n.split('-')
export const namesOf = (name, extra = {}) => ({
  name,
  Name: words(name).map((w) => w[0].toUpperCase() + w.slice(1)).join(''),
  camel: words(name).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join(''),
  title: words(name).join(' '),
  Title: (([f, ...r]) => [f[0].toUpperCase() + f.slice(1), ...r].join(' '))(words(name)),
  today: new Date().toLocaleDateString('en-CA'),
  ...extra,
})
const fill = (text, v) => text.replace(/@@(\w+)@@/g, (m, k) => (k in v ? String(v[k]) : m))

/* ---- the parser, for positions only ---- */
let parseAst = null
const parse = async (text) => { parseAst ||= (await import('rollup/parseAst')).parseAst; return parseAst(text, { allowReturnOutsideFunction: false }) }
const keyOf = (p) => p.key && (p.key.type === 'Identifier' ? p.key.name : p.key.value)
const propOf = (obj, key) => obj && obj.type === 'ObjectExpression' ? obj.properties.find((p) => p.type === 'Property' && keyOf(p) === key) : null
const indentAt = (text, pos) => { const s = text.lastIndexOf('\n', pos - 1) + 1; return /^[ \t]*/.exec(text.slice(s))[0] }
const lineOf = (text, pos) => text.slice(0, pos).split('\n').length
const safeKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`)

/* the object `export default` holds: a literal, a call's first argument (defineConfig({…})), or a const it names */
async function defaultObject(text) {
  const ast = await parse(text)
  const d = ast.body.find((n) => n.type === 'ExportDefaultDeclaration')
  let o = d && d.declaration
  if (o && o.type === 'CallExpression') o = o.arguments[0]
  if (o && o.type === 'Identifier') {
    const name = o.name
    for (const n of ast.body) for (const dec of (n.type === 'VariableDeclaration' ? n.declarations : [])) if (dec.id.name === name) o = dec.init
  }
  return o && o.type === 'ObjectExpression' ? o : null
}

/* past a comment that ends the line the last item is on, so a new line never takes the old line's comment */
const pastLineComment = (text, at) => { const m = /^[ \t]*(\/\*[^\n]*?\*\/|\/\/[^\n]*)[ \t]*(?=\n)/.exec(text.slice(at)); return m ? at + m[0].length : at }

/* insert after the last item of a list (an object's properties or an array's elements), on its own line when the
   list is laid out a line per item, inline when it is on one line */
function appendItem(text, container, items, itemText) {
  if (!items.length) {
    const open = container.start + 1, close = container.end - 1
    const inner = text.slice(open, close)
    if (inner.trim()) return null   /* only comments inside: leave it to a person */
    if (!inner.includes('\n')) return text.slice(0, open) + (container.type === 'ObjectExpression' ? ` ${itemText} ` : itemText) + text.slice(close)
    const ind = indentAt(text, container.start)
    return text.slice(0, open) + `\n${ind}  ${itemText},\n${ind}` + text.slice(close)
  }
  const last = items[items.length - 1]
  let at = last.end
  const after = /^\s*,/.exec(text.slice(at))
  const comma = !!after
  if (comma) at += after[0].length
  const multiline = lineOf(text, items[0].start) !== lineOf(text, container.start)
  if (multiline) {
    if (!comma) { text = text.slice(0, at) + ',' + text.slice(at); at += 1 }
    at = pastLineComment(text, at)
    return text.slice(0, at) + `\n${indentAt(text, last.start)}${itemText},` + text.slice(at)
  }
  return text.slice(0, at) + `${comma ? '' : ','} ${itemText}${comma ? ',' : ''}` + text.slice(at)
}

/* set obj.<path…>.<key> = value, making the path's objects as needed; refuses (null) a key already there */
export async function setIn(text, pathKeys, key, value, root = defaultObject) {
  let obj = await root(text)
  if (!obj) return null
  for (let i = 0; i < pathKeys.length; i++) {
    const p = propOf(obj, pathKeys[i])
    if (!p) {
      const rest = pathKeys.slice(i + 1).reduceRight((inner, k) => `{ ${safeKey(k)}: ${inner} }`, `{ ${safeKey(key)}: ${value} }`)
      return appendItem(text, obj, obj.properties, `${safeKey(pathKeys[i])}: ${rest}`)
    }
    if (p.value.type !== 'ObjectExpression') return null
    obj = p.value
  }
  if (propOf(obj, key)) return null
  return appendItem(text, obj, obj.properties, `${safeKey(key)}: ${value}`)
}

/* push a value onto obj.<path…> (an array), making it and its parents as needed */
export async function pushIn(text, pathKeys, value, root = defaultObject) {
  let obj = await root(text)
  if (!obj) return null
  for (let i = 0; i < pathKeys.length; i++) {
    const p = propOf(obj, pathKeys[i])
    const lastKey = i === pathKeys.length - 1
    if (!p) {
      const rest = pathKeys.slice(i + 1).reduceRight((inner, k) => `{ ${safeKey(k)}: ${inner} }`, `[${value}]`)
      return appendItem(text, obj, obj.properties, `${safeKey(pathKeys[i])}: ${rest}`)
    }
    if (lastKey) {
      if (p.value.type !== 'ArrayExpression') return null
      return appendItem(text, p.value, p.value.elements, value)
    }
    if (p.value.type !== 'ObjectExpression') return null
    obj = p.value
  }
  return null
}

/* append a raw fragment (its own indentation and trailing comma) after the last element of an array */
function appendRaw(text, arr, fragment) {
  const last = arr.elements[arr.elements.length - 1]
  let at = last ? last.end : arr.start + 1
  const after = last && /^\s*,/.exec(text.slice(at))
  if (after) at += after[0].length
  else if (last) { text = text.slice(0, at) + ',' + text.slice(at); at += 1 }
  at = pastLineComment(text, at)
  return text.slice(0, at) + '\n' + fragment.replace(/\s+$/, '') + text.slice(at)
}

/* the array a top-level `export const NAME = [...]` (or `const NAME = [...]`) holds */
async function namedArray(text, name) {
  const ast = await parse(text)
  for (const n of ast.body) {
    const v = n.type === 'ExportNamedDeclaration' ? n.declaration : n
    if (v && v.type === 'VariableDeclaration') for (const d of v.declarations) {
      if (d.id.name !== name || !d.init) continue
      let i = d.init
      while (i.type === 'CallExpression' && i.callee.type === 'MemberExpression') i = i.callee.object   /* [...].filter(Boolean) */
      if (i.type === 'ArrayExpression') return i
    }
  }
  return null
}

/* add `import x from './file'` after the last import */
async function addImport(text, line) {
  const ast = await parse(text)
  const imports = ast.body.filter((n) => n.type === 'ImportDeclaration')
  const at = imports.length ? imports[imports.length - 1].end : 0
  return text.slice(0, at) + '\n' + line + text.slice(at)
}

/* a row added after the last row of the markdown table holding the line the anchor matches */
export function addTableRow(text, anchor, row) {
  const lines = text.split('\n'); let i = lines.findIndex((l) => anchor.test(l))
  if (i < 0) return null
  while (i + 1 < lines.length && lines[i + 1].startsWith('|')) i++
  lines.splice(i + 1, 0, row)
  return lines.join('\n')
}

/* ---- templates ---- */
function templateDir(level, kind, siteRoot) {
  const own = siteRoot && path.join(siteRoot, 'generators', kind)
  if (level === 'site' && own && fs.existsSync(own)) return own
  return path.join(HERE, 'generators', level, kind)
}
function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name)
    return e.isDirectory() ? walk(f, base) : [path.relative(base, f)]
  })
}
/* every file a kind writes, its path filled, its text filled — fragments (_*.tmpl) left out */
function filesOf(dir, v) {
  return walk(dir).filter((r) => !path.basename(r).startsWith('_')).map((r) => ({ rel: fill(r.replace(/\.tmpl$/, ''), v), text: fill(fs.readFileSync(path.join(dir, r), 'utf8'), v) }))
}
const fragment = (dir, name, v) => fill(fs.readFileSync(path.join(dir, name), 'utf8'), v)

/* ---- is this PlatformKit's own checkout? ---- */
export function kitCheckout(kitRoot = KIT_ROOT) {
  if (kitRoot.split(path.sep).includes('node_modules')) return null
  const ws = path.resolve(kitRoot, '..', '..')
  return path.basename(path.dirname(kitRoot)) === 'packages' && fs.existsSync(path.join(ws, 'package.json')) && fs.existsSync(path.join(kitRoot, 'build', 'modules', 'kit.mjs')) ? ws : null
}

/*
 * THE PLAN for one piece: the files to write and the edits to make, each edit a function from a file's text to
 * its new text (null when it cannot be made, which turns into lines for a person). Nothing touches the disk here.
 */
export async function planFor({ kind, name, level = 'site', module: owner = null, siteRoot = process.cwd(), kitRoot = KIT_ROOT }) {
  if (!KINDS.includes(kind)) return { refused: `No generator called ${kind}. Kinds: ${KINDS.join(', ')}.` }
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name || '')) return { refused: `"${name || ''}" is not a name a ${kind} can have — lowercase words joined by hyphens, such as gift-cards.` }
  if (!['site', 'core'].includes(level)) return { refused: `--level is site or core, not ${level}.` }
  const ws = level === 'core' ? kitCheckout(kitRoot) : null
  if (level === 'core' && !ws) return { refused: '`--level core` writes into PlatformKit itself, and this isn\'t a PlatformKit checkout. Leave it off to add to your site.' }
  const root = level === 'core' ? kitRoot : siteRoot
  const dir = templateDir(level, kind, siteRoot)
  const site = level === 'site' && fs.existsSync(path.join(siteRoot, 'platformkit.config.js')) ? await (await import(path.join(kitRoot, 'build', 'site.mjs'))).loadSite(siteRoot).catch(() => null) : null
  if (level === 'site' && !site) return { refused: 'No platformkit.config.js here to register the piece in — run it from a site, or pass --site <path>.' }
  const functionsDir = (site && site.data && site.data.functions) || 'db/functions'
  const v = namesOf(name, { dir: owner || name, module: owner || '', functions: functionsDir })
  const writes = filesOf(dir, v).map((f) => ({ path: path.join(root, f.rel), text: f.text }))
  const edits = []
  const cfg = path.join(siteRoot, 'platformkit.config.js')
  const kitMods = path.join(kitRoot, 'build', 'modules', 'kit.mjs')

  /* a module name, or an owner, is checked against every module there is */
  const known = new Set()
  try { const { moduleSet } = await import(path.join(kitRoot, 'build', 'steps.mjs')); for (const k of (await moduleSet(site || { modules: {} })).keys()) known.add(k) } catch {}
  if (level === 'core') { try { for (const m of (await import(kitMods + `?t=${Date.now()}`)).MODULES) known.add(m.key) } catch {} }
  if (kind === 'module' && known.has(name)) return { refused: `A module called ${name} already exists — nothing was written.` }
  if (owner && !known.has(owner)) return { refused: `No module called ${owner} to own it.` }

  if (level === 'site') {
    if (kind === 'module') {
      edits.push({ path: cfg, what: `modules.${name}: true`, apply: (t) => setIn(t, ['modules'], name, 'true') })
      edits.push({ path: cfg, what: `build.modules += './src/${name}/module.js'`, apply: (t) => pushIn(t, ['build', 'modules'], `'./src/${name}/module.js'`) })
    }
    if (kind === 'page') {
      const route = `{ path: '/${name}', component: './src/${v.dir}/${v.Name}Page.vue'${owner ? `, module: '${owner}'` : ''} }`
      edits.push({ path: cfg, what: `routes += ${route}`, apply: (t) => pushIn(t, ['routes'], route) })
      if (owner) {
        const manifest = path.join(siteRoot, 'src', owner, 'module.js')
        if (fs.existsSync(manifest)) edits.push({ path: manifest, what: `owns.routes += '/${name}'`, apply: async (t) => (await pushIn(t, ['owns', 'routes'], `'/${name}'`)) })
      }
    }
    if (kind === 'content-type') {
      const entry = fragment(dir, '_entry.js.tmpl', v)
      const models = site.admin && site.admin.models
      if (models) {
        const file = path.join(siteRoot, models)
        edits.push({ path: file, what: `a ${name} model in ${models}`, apply: async (t) => { if (new RegExp(`key:\\s*'${name}'`).test(t)) return null; const arr = await namedArray(t, 'models'); return arr ? appendRaw(t, arr, entry) : null } })
      } else {
        writes.push({ path: path.join(siteRoot, 'build', 'admin-models.mjs'), text: fill(fragment(dir, '_models-file.mjs.tmpl', v), { entry }) })
        edits.push({ path: cfg, what: "admin.models: './build/admin-models.mjs'", apply: (t) => setIn(t, ['admin'], 'models', "'./build/admin-models.mjs'") })
      }
    }
    if (kind === 'function' || kind === 'test') edits.push({ path: cfg, what: `build.tests += './build/${name}.test.mjs'`, apply: (t) => pushIn(t, ['build', 'tests'], `'./build/${name}.test.mjs'`) })
    if (kind === 'step') edits.push({ path: cfg, what: `build.steps += './build/steps/${name}.mjs'`, apply: (t) => pushIn(t, ['build', 'steps'], `'./build/steps/${name}.mjs'`) })
  }

  if (level === 'core') {
    const B = (f) => path.join(kitRoot, 'build', f)
    const D = (f) => path.join(ws, 'sites', 'docs', 'content', 'docs', f)
    if (kind === 'module') {
      edits.push({ path: kitMods, what: `MODULES += ${name}`, apply: async (t) => { const a = await namedArray(t, 'MODULES'); return a ? appendRaw(t, a, fragment(dir, '_entry.js.tmpl', v)) : null } })
      /* the module pages list every module: the modules table and the config's modules row */
      edits.push({ path: D('building-a-site/modules.md'), what: `a ${name} row in the modules table`, apply: (t) => addTableRow(t, /^\| `translation`/, `| \`${name}\` | ${v.Title}: describe what it adds (see [${v.Title}](/content/docs/building-a-site/${name})) |`) })
      edits.push({ path: D('reference/config-keys.md'), what: `${name} in the modules row`, apply: (t) => { const m = /(the features (?:`[^`]+`, )*`[^`]+`)/.exec(t); return m ? t.slice(0, m.index) + m[1] + `, \`${name}\`` + t.slice(m.index + m[0].length) : null } })
    }
    if (kind === 'page') edits.push({ path: D('running-a-site/settings/site-settings-and-strings.md'), what: `the ${name} scope in the strings table`, apply: (t) => addTableRow(t, /^\| `auth`/, `| \`${name}\` | The ${v.title} page (\`theme/src/content/ui/${name}.md\`) |`) })
    if (kind === 'step') edits.push({ path: B('steps/index.mjs'), what: `STEPS += ${v.camel}`, apply: async (t) => { const u = await addImport(t, `import ${v.camel} from './${name}.mjs'`); const a = await namedArray(u, 'STEPS'); return a ? appendItem(u, a, a.elements, v.camel) : null } })
    if (kind === 'content-type') edits.push({ path: B('models/core/index.mjs'), what: `CORE += ${v.camel}`, apply: async (t) => { const u = await addImport(t, `import ${v.camel} from './${name}.mjs'`); const a = await namedArray(u, 'CORE'); return a ? appendItem(u, a, a.elements, v.camel) : null } })
    if (kind === 'function' || kind === 'test') edits.push({ path: B('test.mjs'), what: `the test list += ${name}.test.mjs`, apply: async (t) => { const a = await namedArray(t, 'KIT_TESTS'); return a ? appendItem(t, a, a.elements, `['${name}.test.mjs']`) : null } })
    if (kind === 'function') {
      if (!owner) return { refused: 'A core function belongs to a module: pass --module <key>.' }
      edits.push({ path: kitMods, what: `${owner}.owns.functions += ${name}`, apply: async (t) => {
        const a = await namedArray(t, 'MODULES'); const m = a && a.elements.find((e) => e && e.type === 'ObjectExpression' && propOf(e, 'key') && propOf(e, 'key').value.value === owner)
        if (!m) return null
        return pushIn(t, ['owns', 'functions'], `'${name}'`, async () => m)
      } })
    }
    if (kind === 'page') {
      const app = path.join(kitRoot, 'theme', 'src', 'App.vue')
      const gate = owner ? `moduleOn('${owner}') ? defineAsyncComponent(() => import('./pages/${v.Name}Page.vue')) : null` : `defineAsyncComponent(() => import('./pages/${v.Name}Page.vue'))`
      edits.push({ path: app, what: `App.vue routes /${name} to ${v.Name}Page`, apply: (t) => {
        const declAnchor = /\nconst EntriesPage = [^\n]*\n/.exec(t), routeAnchor = t.indexOf('  <LandingPage v-else-if="isPageRoute(route)"')
        if (!declAnchor || routeAnchor < 0) return null
        const decl = `/* ${v.title} (generated: platformkit generate page ${name} --level core) */\nconst ${v.Name}Page = ${gate}\n`
        const line = `  <${v.Name}Page v-else-if="${owner ? `${v.Name}Page && ` : ''}(route === '/${name}' || route.startsWith('/${name}/'))" :key="route" :path="route" />\n`
        const at = declAnchor.index + declAnchor[0].length
        const u = t.slice(0, at) + decl + t.slice(at)
        const r = u.indexOf('  <LandingPage v-else-if="isPageRoute(route)"')
        return u.slice(0, r) + line + u.slice(r)
      } })
    }
    /* the docs page that names every new file, or the docs check refuses them */
    const sources = writes.map((w) => path.relative(ws, w.path).split(path.sep).join('/'))
    const page = path.join(ws, 'sites', 'docs', 'content', 'docs', 'building-a-site', `${owner || name}.md`)
    if (fs.existsSync(page)) edits.push({ path: page, what: `its sources += ${sources.join(', ')}`, apply: (t) => { const m = /^sources:\s*\[([\s\S]*?)\]/m.exec(t); if (!m) return null; const inner = m[1].replace(/[\s,]+$/, ''); return t.slice(0, m.index) + `sources: [${inner}${inner.trim() ? ', ' : ''}${sources.join(', ')}]` + t.slice(m.index + m[0].length) } })
    else writes.push({ path: page, text: fill(fs.readFileSync(path.join(HERE, 'generators', 'core', '_docs', 'page.md.tmpl'), 'utf8'), { ...v, sources: sources.join(', ') }) })
  }

  const next = { module: `Next: \`platformkit dev\`, then open /admin.`, page: `Next: \`platformkit dev\`, then open /${name}.`, 'content-type': 'Next: `platformkit dev`, then open /admin.', function: 'Next: `platformkit test --e2e` runs its test.', test: 'Next: `platformkit test`.', step: `Next: \`platformkit run ${name}\`.` }[kind]
  return { writes, edits, next, root }
}

/* refuse before writing anything; then write, then edit; an edit that cannot be made becomes a line to add by hand */
export async function generate(opts) {
  const plan = await planFor(opts)
  if (plan.refused) return { ok: false, message: plan.refused }
  const taken = plan.writes.find((w) => fs.existsSync(w.path))
  if (taken) return { ok: false, message: `${path.relative(process.cwd(), taken.path)} already exists — nothing was written.` }
  const results = []
  for (const e of plan.edits) {
    const before = fs.existsSync(e.path) ? fs.readFileSync(e.path, 'utf8') : null
    const after = before === null ? null : await e.apply(before)
    results.push({ ...e, before, after })
  }
  const rel = (p) => path.relative(process.cwd(), p) || p
  const lines = []
  if (opts.dryRun) {
    lines.push('Would write:', ...plan.writes.map((w) => '  ' + rel(w.path)), 'Would add:', ...results.map((r) => `  ${rel(r.path)}: ${r.what}${r.after === null ? ' (by hand: the file could not be edited)' : ''}`))
    return { ok: true, message: lines.join('\n') }
  }
  for (const w of plan.writes) { fs.mkdirSync(path.dirname(w.path), { recursive: true }); fs.writeFileSync(w.path, w.text) }
  /* edits to one file chain: each applies to the text the last left */
  const byFile = new Map()
  for (const r of results) {
    const cur = byFile.has(r.path) ? byFile.get(r.path) : r.before
    const next = cur === null ? null : (cur === r.before ? r.after : await r.apply(cur))
    if (next === null) { lines.push(`Add by hand to ${rel(r.path)}: ${r.what}`); continue }
    byFile.set(r.path, next)
  }
  for (const [f, t] of byFile) fs.writeFileSync(f, t)
  const done = results.filter((r) => byFile.has(r.path)).map((r) => r.what)
  lines.unshift(`Wrote ${opts.kind} \`${opts.name}\`: ${plan.writes.map((w) => rel(w.path)).join(', ')}.${done.length ? ` Registered: ${done.join('; ')}.` : ''}`)
  lines.push(plan.next)
  return { ok: true, message: lines.join('\n') }
}

/* run directly: compared as real paths, since /var on macOS is /private/var and a symlinked path would never match */
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2)
  const flag = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null }
  const pos = a.filter((x, i) => !x.startsWith('--') && !['--level', '--module'].includes(a[i - 1]))
  if (!pos[0]) { console.log(`platformkit generate <kind> <name> [--level site|core] [--module <key>] [--dry-run]\nKinds: ${KINDS.join(', ')}.`); process.exit(0) }
  const r = await generate({ kind: pos[0], name: pos[1], level: flag('--level') || 'site', module: flag('--module'), dryRun: a.includes('--dry-run'), siteRoot: process.cwd() })
  console.log(r.message)
  process.exit(r.ok ? 0 : 1)
}
