/* The override test: the theme imported with every component overridden by a stub. For each of the
   theme's components a site override is declared, and the kit's Vite plugin — the real one, on a
   Vite server in middleware mode — is asked to resolve an import of that component the three ways
   it is written: by package specifier, by relative path from a theme file, and by the @/ alias.
   Each must land on the stub; from the stub itself, on the original (so an override can wrap).
   Run from a site's root; pinned by npm test. */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const { loadSite } = await import('./site.mjs')
const { loadTheme } = await import('./theme.mjs')
const c = await loadSite(ROOT)
const theme = await loadTheme(c)
const names = Object.keys(theme.components)

/* a stub per component, under the site's root (a package specifier resolves from where the file is: outside the site there is no node_modules) */
const dir = path.join(ROOT, 'node_modules', '.cache', 'platformkit', 'overrides-test')
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
const overrides = {}
for (const n of names) { const f = path.join(dir, n + '.vue'); fs.writeFileSync(f, `<template><div class="stub-${n}" /></template>\n`); overrides[n] = f }

/* the plugin over a config with every override — velite is not run (the guard the plugin already keeps) */
globalThis.__veliteStarted = true
const { createServer } = await import('vite')
const { platformkit } = await import('../vite/index.mjs')
const plugins = await platformkit({ root: ROOT, config: { ...c, overrides } })
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null, hmr: false }, plugins })

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }
const resolve = async (id, importer) => { const r = await server.pluginContainer.resolveId(id, importer); return r && r.id.split('?')[0] }
const rel = (f) => path.relative(theme.src, f)
const anyTheme = theme.components[names[0]]   /* a theme file, as the importer */
for (const n of names) {
  const orig = theme.components[n]
  ok(`${n}: by package specifier`, (await resolve(`${theme.package}/${rel(orig)}`, anyTheme)) === overrides[n])
  ok(`${n}: by relative path`, (await resolve('./' + path.relative(path.dirname(anyTheme), orig), anyTheme)) === overrides[n])
  ok(`${n}: by the @/ alias`, (await resolve('@/' + rel(orig), anyTheme)) === overrides[n])
  const w = await resolve(`${theme.package}/${rel(orig)}`, overrides[n])
  ok(`${n}: the override wrapping the original gets the original`, w === orig)
}
/* a name the theme has not is refused, not ignored */
let refused = false
try { await platformkit({ root: ROOT, config: { ...c, overrides: { NoSuchComponent: overrides[names[0]] } } }) } catch (e) { refused = /no component named NoSuchComponent/.test(e.message) }
ok('an override of a component the theme has not is refused', refused)
await server.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (${names.length} components, ${theme.package})`)
process.exit(fail ? 1 : 0)
