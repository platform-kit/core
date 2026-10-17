/* The #site/* modules as files: every one that imports the site's code resolves to a file in
   .platformkit/site/, the file holds exactly what the plugin serves for it, and it imports the site's
   files relatively. All three are what Vite's dependency scan needs to see a site's own imports at
   startup — it does not follow a virtual id, and it takes an import whose specifier is already its
   resolved path for an external one. Missed, a package only the site imports is found on the first
   visit to its page and bundled mid-request. Run from a site's root; pinned by npm test. */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
globalThis.__veliteStarted = true
const { createServer } = await import('vite')
const { platformkit } = await import('../vite/index.mjs')
const plugins = await platformkit({ root: ROOT })
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, watch: null, hmr: false }, plugins })

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }
const dir = path.join(ROOT, '.platformkit', 'site')
const ids = ['#site', '#site/looks', '#site/landing', '#site/app', '#site/routes', '#site/nav', '#site/analytics', '#site/instrument', '#site/recommendations', '#site/admin', '#site/member', '#site/permissions', '#site/desk']
for (const id of ids) {
  const r = await server.pluginContainer.resolveId(id)
  const file = r && r.id
  ok(`${id}: resolves to a file in .platformkit/site/ (got ${file})`, !!file && path.dirname(file) === dir && fs.existsSync(file))
  if (!file || !fs.existsSync(file)) continue
  const served = await server.pluginContainer.load(file)
  const code = typeof served === 'string' ? served : (served && served.code) || ''
  const disk = fs.readFileSync(file, 'utf8')
  ok(`${id}: the file is what the plugin serves`, code === disk)
  const absolute = [...disk.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])(\/[^"']*)\1/g)].map((m) => m[2])
  ok(`${id}: imports the site's files relatively (absolute: ${absolute.join(', ')})`, !absolute.length)
}
/* the folder ignores itself, so it is never committed in whatever repository the site lives in */
const ignore = path.join(ROOT, '.platformkit', '.gitignore')
ok('.platformkit/ carries its own .gitignore of everything', fs.existsSync(ignore) && fs.readFileSync(ignore, 'utf8').trim() === '*')
/* the theme's strings import nothing, so they stay virtual */
const strings = await server.pluginContainer.resolveId('#site/strings-default')
ok('#site/strings-default stays virtual', !!strings && strings.id.startsWith('\0'))
await server.close()
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (${ids.length} modules as files)`)
process.exit(fail ? 1 : 0)
