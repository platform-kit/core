/*
 * Module boundaries (openspec: modules-as-packages): a module is reached only through its front doors — index.ts for the
 * browser, build/index.mts for the build and the functions. Any other import into a module's folder from outside it is
 * refused, naming the importer and the file it reached for. Inside its own folder a module imports what it likes; the
 * generated registry (modules/registry.mts) imports each folder's models and steps by design.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WORKSPACE = path.resolve(KIT, '../..')
const MODULES = path.join(KIT, 'modules')
const DOORS = ['index.ts', 'index.js', 'build/index.mts', 'build/index.mjs']
const SOURCE = /\.(m?ts|m?js|vue)$/
const SKIP = /(^|\/)(node_modules|\.tsbuild|dist|\.velite|\.platformkit|supabase|fixtures)(\/|$)/

const walk = (d: string): string[] => !fs.existsSync(d) ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name)
  if (SKIP.test(path.relative(WORKSPACE, p).split(path.sep).join('/'))) return []
  return e.isDirectory() ? walk(p) : SOURCE.test(e.name) ? [p] : []
})

/* the files whose imports are checked: the kit's and every fixture site's own code */
export const sourceFiles = (): string[] => [...walk(KIT).filter((f) => !f.endsWith('module-boundaries.test.mts')) /* its planted imports are text */, ...['demo', 'docs', 'brochure', 'club'].flatMap((s) => walk(path.join(WORKSPACE, 'sites', s, 'src')))]

const SPECIFIERS = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/g

/* the module folder a path is in, and the path inside it */
const inModule = (abs: string): { key: string, rel: string } | null => {
  const r = path.relative(MODULES, abs)
  if (r.startsWith('..') || path.isAbsolute(r)) return null
  const [key, ...rest] = r.split(path.sep)
  return rest.length ? { key, rel: rest.join('/') } : null
}

/* where a specifier points on disk, where it can be told: a relative path, or the kit's own modules by package name */
const target = (spec: string, importer: string): string | null => {
  if (spec.startsWith('.')) return path.resolve(path.dirname(importer), spec)
  if (spec.startsWith('platformkit/modules/')) return path.join(MODULES, spec.slice('platformkit/modules/'.length))
  return null
}

/* every import that reaches past a module's front doors, as "importer → target" */
export function crossings(files: Array<{ file: string, text: string }>): string[] {
  const out: string[] = []
  for (const { file, text } of files) {
    if (path.resolve(file) === path.join(MODULES, 'registry.mts')) continue
    const from = inModule(path.resolve(file))
    for (const m of text.matchAll(SPECIFIERS)) {
      /* a test may read a module's file by its path (new URL) to check its source; importing past the doors it may not */
      if (m[3] && /\.test\.m?[jt]s$/.test(file)) continue
      const spec = m[1] || m[2] || m[3]
      const to = target(spec, path.resolve(file))
      if (!to) continue
      const at = inModule(to)
      if (!at || (from && from.key === at.key)) continue
      const door = DOORS.includes(at.rel) || DOORS.includes(at.rel.replace(/\.mjs$/, '.mts').replace(/\.js$/, '.ts'))
      if (!door) out.push(`${path.relative(WORKSPACE, file)} → ${path.relative(WORKSPACE, to)} (reach ${at.key} through modules/${at.key}/index.ts or build/index.mts)`)
    }
  }
  return out
}

export const allCrossings = (): string[] => crossings(sourceFiles().map((file) => ({ file, text: fs.readFileSync(file, 'utf8') })))

/* the source files under some folders, for `platformkit check`: a site's own src/, and the kit where it is a checkout */
export const filesUnder = (dirs: string[]): Array<{ file: string, text: string }> =>
  dirs.flatMap((d) => walk(d)).filter((f) => !f.endsWith('module-boundaries.test.mts')).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
export const KIT_DIR = KIT

/* every relative import in a module's folder that points at nothing — code, stylesheets and @import alike, since a moved
   file keeps the relative paths it had where it was, and a stylesheet's is checked by no type checker */
const RELATIVE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|@import\s+['"](\.{1,2}\/[^'"]+)['"]|new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/g
const exists = (p: string) => [p, p.replace(/\.(m?)js$/, '.$1ts'), p.replace(/\.js$/, '.vue')].some((x) => fs.existsSync(x))
export function unresolved(): string[] {
  const out: string[] = []
  for (const file of [...walk(MODULES), ...walk(path.join(KIT, 'src')), ...walk(path.join(KIT, 'theme', 'src'))]) {
    /* a page a script writes out for a browser to load (print's raster) imports what that page is served, not a file here */
    const raw = fs.readFileSync(file, 'utf8')
    const text = file.endsWith('.vue') ? raw : raw.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
    for (const m of text.matchAll(RELATIVE)) {
      const spec = (m[1] || m[2] || m[3] || m[4]).replace(/\?.*$/, '')   /* a bundler's query (?url) is not part of the file */
      if (spec.includes('…')) continue   /* a placeholder in prose */
      if (!exists(path.resolve(path.dirname(file), spec))) out.push(`${path.relative(WORKSPACE, file)} → ${spec}`)
    }
  }
  return out
}
