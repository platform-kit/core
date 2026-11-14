/*
 * An edit in a module's folder reaches the running dev site (openspec: modules-as-packages).
 *
 * Every module file is edited where it lives; the site's supabase/ tree is assembled from those files and never edited.
 * Browser code (ui/, lib/, strings/, the front door) is Vite's: it is served from the module's folder and hot-reloaded
 * there. What Vite cannot reach is this watcher's:
 *
 *   functions/, build/            assembled again; `supabase functions serve` reloads what changed on its next request
 *   schema/, data.sql, seed.sql   assembled again, then `platformkit migrate` on the dev database: a plan that drops or
 *   integrations/*                rewrites nothing is applied, one that would is refused by the destructive guard and
 *                                 the watcher says what to run instead
 *   module.ts                     assembled again (a function's settings are written into config.toml, which the function
 *                                 server reads only at start, so the watcher says to restart it); Vite restarts itself
 *   supabase/ (the assembled tree) an edit there is put back from its source, and the watcher names the file to edit
 *
 * The kit's old layout (packages/kit/supabase/functions, schemas, data, seed) is watched the same way until every
 * module has moved.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export type ChangeKind = 'function' | 'schema' | 'manifest' | 'generated' | 'browser' | null

export interface WatchRoots {
  /* each module folder: the kit's (packages/kit/modules/<key>) and the site's (src/modules/<key>) */
  moduleDirs: string[]
  /* the kit's old layout, packages/kit/supabase, while modules are still moving out of it */
  kitSupabase?: string | null
  /* the site's assembled tree, <site>/supabase */
  siteSupabase: string
}

/* what a changed file is, from where it sits */
export function classify(file: string, roots: WatchRoots): ChangeKind {
  const f = path.resolve(file)
  const under = (dir: string) => { const r = path.relative(dir, f); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : null }
  for (const d of roots.moduleDirs) {
    const r = under(d)
    if (r === null) continue
    if (r === 'module.ts') return 'manifest'
    if (r.startsWith('functions/') || r.startsWith('build/')) return 'function'
    if (r.startsWith('schema/') || r === 'data.sql' || r === 'seed.sql' || /^integrations\/[^/]+\/(schema|data|seed)\.sql$/.test(r)) return 'schema'
    return 'browser'
  }
  if (roots.kitSupabase) {
    const r = under(roots.kitSupabase)
    if (r !== null) return r.startsWith('functions/') ? 'function' : /^(schemas\/|data\/|seed\/|data\.sql$|seed\.sql$)/.test(r) ? 'schema' : null
  }
  const g = under(roots.siteSupabase)
  if (g !== null && !g.startsWith('.temp/') && !g.startsWith('.branches/') && g !== '.assembled.json') return 'generated'
  return null
}

export interface WatchActions {
  /* assemble the site's supabase/ tree again; true when it succeeded */
  assemble: () => boolean
  /* apply the plan to the dev database: { ok } when it was applied, { ok: false, output } when the guard refused it */
  migrate: () => { ok: boolean, output?: string }
  /* where an assembled file came from, for the message when it is edited by hand */
  sourceOf: (relInTree: string) => string | null
  log: (line: string) => void
}

/* what one batch of changes does, in order: the generated tree first (put back), then functions, then the schema */
export function handle(changes: Array<{ file: string, kind: ChangeKind }>, roots: WatchRoots, act: WatchActions): string[] {
  const done: string[] = []
  const kinds = new Set(changes.map((c) => c.kind))
  for (const c of changes.filter((x) => x.kind === 'generated')) {
    const rel = path.relative(roots.siteSupabase, c.file).split(path.sep).join('/')
    const from = act.sourceOf(rel)
    act.log(`supabase/${rel} is assembled, not edited: it was put back${from ? ` — edit ${from} instead` : ''}`)
    done.push('restore')
  }
  if (kinds.has('generated') || kinds.has('function') || kinds.has('schema') || kinds.has('manifest')) {
    if (!act.assemble()) { act.log('supabase/ could not be assembled — the error is above'); return [...done, 'assemble-failed'] }
    done.push('assemble')
  }
  if (kinds.has('manifest')) { act.log('a module manifest changed: restart the function server if a function\'s settings changed (it reads config.toml only at start)'); done.push('manifest') }
  if (kinds.has('schema')) {
    const r = act.migrate()
    if (r.ok) { act.log('the dev database has the change'); done.push('migrate') }
    else { act.log('the change would drop or rewrite data, so the dev database was left as it is. To apply it: PLATFORMKIT_ALLOW_DESTRUCTIVE=1 platformkit migrate' + (r.output ? '\n' + r.output : '')); done.push('migrate-refused') }
  }
  return done
}

/*
 * Watch the roots and act on each batch of changes. Writes the assembly itself makes into supabase/ are not edits: the
 * generated tree is ignored while an assembly runs and briefly after.
 */
export function startDevWatch(roots: WatchRoots, act: WatchActions, { debounceMs = 150 } = {}): () => void {
  const pending = new Map<string, ChangeKind>()
  /* what each file held when it was last acted on: one save can arrive as several events, and acting on it once is enough */
  const held = new Map<string, string>()
  const hashOf = (f: string) => { try { return createHash('sha1').update(fs.readFileSync(f)).digest('hex') } catch { return '(gone)' } }
  let timer: NodeJS.Timeout | null = null
  let quietUntil = 0
  /* after an assembly, what every file of the tree holds is what the assembly wrote: an event for one of them is its own */
  const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []
  const wrapped: WatchActions = { ...act, assemble: () => { quietUntil = Date.now() + 2000; const ok = act.assemble(); for (const f of walk(roots.siteSupabase)) held.set(f, hashOf(f)); quietUntil = Date.now() + 1000; return ok } }
  const flush = () => {
    timer = null
    const batch = [...pending].map(([file, kind]) => ({ file, kind })).filter(({ file }) => { const h = hashOf(file); if (held.get(file) === h) return false; held.set(file, h); return true })
    pending.clear()
    if (batch.length) handle(batch, roots, wrapped)
  }
  /* a watch that starts is first told what happened just before it (macOS replays recent events, the watched folder
     itself among them): nothing in that first moment is an edit, and the tree as it stands is the assembly's */
  const startedAt = Date.now()
  for (const f of walk(roots.siteSupabase)) held.set(f, hashOf(f))
  const seen = (file: string) => {
    if (Date.now() - startedAt < 500) return
    try { if (fs.statSync(file).isDirectory()) return } catch { /* gone: a removal is a change */ }
    const kind = classify(file, roots)
    if (!kind || kind === 'browser') return
    if (kind === 'generated' && Date.now() < quietUntil) return
    pending.set(file, kind)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
  }
  const watchers = [...roots.moduleDirs, ...(roots.kitSupabase ? [roots.kitSupabase] : []), roots.siteSupabase]
    .filter((d) => fs.existsSync(d))
    .map((d) => fs.watch(d, { recursive: true }, (_e, name) => { if (name) seen(path.join(d, String(name))) }))
  return () => { if (timer) clearTimeout(timer); for (const w of watchers) w.close() }
}
