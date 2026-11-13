/*
 * Modules as folders (openspec: modules-as-packages).
 *
 * A module folder is a directory holding a `module.ts` manifest: the kit's own under packages/kit/modules/<key>/,
 * a site's under its src/modules/<key>/. What the folder holds is the module's: its schema files, its rows and seed,
 * its functions and their shared code, its integrations with other modules. The manifest names none of them;
 * `owns.schema` and `owns.functions` are filled in here from the folder, so every reader of a manifest sees one
 * shape whichever layout a module is in.
 *
 *   <key>/schema/*.sql                     schema files, assembled under their own names
 *   <key>/data.sql, <key>/seed.sql         the module's rows and seed, assembled as data/<key>.sql and seed/<key>.sql
 *   <key>/functions/<name>/                an edge function, assembled as functions/<name>/
 *   <key>/functions/_shared/               code only this module's functions use, assembled as functions/_shared/<key>/
 *   <key>/integrations/<other>/schema.sql  what this module adds when <other> is on, assembled as the glue file
 *                                          named for both, in alphabetical order (courses+spaces.sql)
 *   <key>/integrations/<other>/data.sql    its rows, assembled as data/<a>+<b>.sql
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ModuleDeclaration } from './manifest.mjs'

export const KIT_MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url))

/* where each folder module lives, by key */
export const MODULE_DIRS = new Map<string, string>()

export interface FolderBackend {
  schema: Record<string, string>
  glue: Record<string, string>
  rows: Record<string, string>
  seed: Record<string, string>
  functions: Record<string, string>
  shared: string | null
}

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory()
const sqlIn = (dir: string): string[] => isDir(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : []
const subdirs = (dir: string): string[] => isDir(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort() : []

/* a manifest file: Node strips TypeScript's types, but never inside node_modules, where the compiled copy is read */
function manifestFile(dir: string): string | null {
  const ts = path.join(dir, 'module.ts'), js = path.join(dir, 'module.mjs')
  if (fs.existsSync(ts)) return ts.includes(`${path.sep}node_modules${path.sep}`) && fs.existsSync(js) ? js : ts
  return fs.existsSync(js) ? js : null
}

/* the module folders under a root, each a directory with a manifest */
export function moduleDirs(root: string): string[] {
  return subdirs(root).map((n) => path.join(root, n)).filter((d) => manifestFile(d))
}

/* what a module folder holds for the backend, by the name each file is assembled under */
export function folderBackend(dir: string, key: string): FolderBackend {
  const out: FolderBackend = { schema: {}, glue: {}, rows: {}, seed: {}, functions: {}, shared: null }
  for (const f of sqlIn(path.join(dir, 'schema'))) out.schema[f] = path.join(dir, 'schema', f)
  if (fs.existsSync(path.join(dir, 'data.sql'))) out.rows[key + '.sql'] = path.join(dir, 'data.sql')
  if (fs.existsSync(path.join(dir, 'seed.sql'))) out.seed[key + '.sql'] = path.join(dir, 'seed.sql')
  const fns = path.join(dir, 'functions')
  for (const n of subdirs(fns)) { if (n === '_shared') out.shared = path.join(fns, n); else out.functions[n] = path.join(fns, n) }
  for (const other of subdirs(path.join(dir, 'integrations'))) {
    const name = [key, other].sort().join('+') + '.sql'
    const at = path.join(dir, 'integrations', other)
    if (fs.existsSync(path.join(at, 'schema.sql'))) out.glue[name] = path.join(at, 'schema.sql')
    if (fs.existsSync(path.join(at, 'data.sql'))) out.rows[name] = path.join(at, 'data.sql')
    if (fs.existsSync(path.join(at, 'seed.sql'))) out.seed[name] = path.join(at, 'seed.sql')
  }
  return out
}

/* the manifests of every module folder under a root, with what the folder holds filled in as theirs */
export async function folderManifests(root: string): Promise<ModuleDeclaration[]> {
  const out: ModuleDeclaration[] = []
  for (const dir of moduleDirs(root)) {
    const mod = await import(pathToFileURL(manifestFile(dir)!).href)
    const m: ModuleDeclaration = mod.default || mod
    const key = m && typeof m === 'object' && typeof m.key === 'string' ? m.key : path.basename(dir)
    if (path.basename(dir) !== key) throw new Error(`the module folder ${dir} declares \`${key}\`: a module's folder is named for its key`)
    const b = folderBackend(dir, key)
    if (m.owns && (m.owns.schema || m.owns.functions)) throw new Error(`the ${key} module lists owns.schema or owns.functions, which its folder already says — remove them from ${path.join(dir, 'module.ts')}`)
    MODULE_DIRS.set(key, dir)
    out.push({ ...m, owns: { ...(m.owns || {}), ...(Object.keys(b.schema).length ? { schema: Object.keys(b.schema) } : {}), ...(Object.keys(b.functions).length ? { functions: Object.keys(b.functions) } : {}) } })
  }
  return out
}

/* the backend of every folder module the kit holds, merged: name → source */
export function kitFolderBackend(): FolderBackend & { sharedByModule: Record<string, string> } {
  const all = { schema: {}, glue: {}, rows: {}, seed: {}, functions: {}, shared: null, sharedByModule: {} } as FolderBackend & { sharedByModule: Record<string, string> }
  for (const [key, dir] of MODULE_DIRS) {
    if (!dir.startsWith(KIT_MODULES_DIR)) continue
    const b = folderBackend(dir, key)
    for (const kind of ['schema', 'glue', 'rows', 'seed', 'functions'] as const) {
      for (const [name, src] of Object.entries(b[kind])) {
        if ((all[kind] as Record<string, string>)[name]) throw new Error(`${kind} ${name} comes from two module folders: ${(all[kind] as Record<string, string>)[name]} and ${src}`)
        ;(all[kind] as Record<string, string>)[name] = src
      }
    }
    if (b.shared) all.sharedByModule[key] = b.shared
  }
  return all
}
