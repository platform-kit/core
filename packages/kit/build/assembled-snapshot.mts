/*
 * The assembled backend, file by file: what a site's supabase/ tree holds with its modules as configured,
 * and how that changes with each of its modules switched off in turn (openspec: modules-as-packages).
 *
 * Moving a module's files into its folder must not change a byte of what a site receives. The record in
 * build/fixtures/assembled-tree.json holds, per site, every assembled file's hash with the modules as
 * configured, and for each module off, which files go and which change. build/assembled-identical.test.mts
 * assembles again and compares. `node build/assembled-snapshot.mts --write` records it again, which is only
 * right when what a site receives is meant to change.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE = path.resolve(KIT, '../..')
export const SNAPSHOT_SITES = ['demo', 'club']
export const SNAPSHOT_FILE = path.join(KIT, 'build/fixtures/assembled-tree.json')

type Files = Record<string, string>
export type Variant = { refused: string } | { gone: string[], changed: Files, added: Files }
export type SiteSnapshot = { all: Files, off: Record<string, Variant> }

const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []
const sha = (f: string) => createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 16)

/* one assembly into a throwaway folder: every file and its hash, or the reason it was refused */
function assemble(site: string, off: string[]): Files | { refused: string } {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-assembled-'))
  try {
    const args = [path.join(KIT, 'build/assemble.mts'), '--out', out, ...(off.length ? ['--off', off.join(',')] : [])]
    const r = spawnSync(process.execPath, args, { cwd: path.join(WORKSPACE, 'sites', site), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import=${path.join(KIT, 'build/workspace-ts.mjs')}` } })
    if (r.status !== 0) return { refused: (r.stderr || r.stdout).split('\n').filter((l) => /requires|refuse|✖|Error/.test(l))[0]?.trim() || `exit ${r.status}` }
    const files: Files = {}
    for (const f of walk(out).sort()) files[path.relative(out, f).split(path.sep).join('/')] = sha(f)
    return files
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
}

/* every module the site knows (the kit's, its theme's and its own), and which of them it has on */
async function modulesOf(site: string): Promise<{ all: any[], on: string[] }> {
  const root = path.join(WORKSPACE, 'sites', site)
  const { loadSite } = await import('./site.mjs')
  const { moduleSet } = await import('./steps.mjs')
  const cfg = await loadSite(root)
  const all = [...(await moduleSet(cfg)).values()]
  return { all, on: all.map((m: any) => m.key).filter((k: string) => (cfg.modules || {})[k] !== false).sort() }
}

export async function snapshotOf(site: string): Promise<SiteSnapshot> {
  const all = assemble(site, [])
  if ('refused' in all) throw new Error(`${site}: the assembly with its modules as configured was refused — ${all.refused}`)
  const off: Record<string, Variant> = {}
  const { all: MODULES, on } = await modulesOf(site)
  /* a module off takes with it every module on that requires it, as a site switching it off would have to */
  const needs = (m: any) => (m.requires || []).map((r: any) => typeof r === 'string' ? r : r.module)
  const closure = (k: string): string[] => { const out = new Set([k]); let grew = true; while (grew) { grew = false; for (const m of MODULES) if (on.includes(m.key) && !out.has(m.key) && needs(m).some((n: string) => out.has(n))) { out.add(m.key); grew = true } } return [...out].sort() }
  for (const k of on) {
    const v = assemble(site, closure(k))
    if ('refused' in v) { off[k] = { refused: String(v.refused) }; continue }
    const gone = Object.keys(all).filter((f) => !(f in v))
    const changed: Files = {}, added: Files = {}
    for (const [f, h] of Object.entries(v)) { if (!(f in all)) added[f] = h; else if (all[f] !== h) changed[f] = h }
    off[k] = { gone, changed, added }
  }
  return { all, off }
}

export async function snapshot(): Promise<Record<string, SiteSnapshot>> {
  const out: Record<string, SiteSnapshot> = {}
  for (const s of SNAPSHOT_SITES) out[s] = await snapshotOf(s)
  return out
}

if (process.argv.includes('--write')) {
  const s = await snapshot()
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true })
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(s, null, 1) + '\n')
  console.log('assembled tree recorded: ' + Object.entries(s).map(([k, v]) => `${k} ${Object.keys(v.all).length} files, ${Object.keys(v.off).length} variants`).join('; '))
  process.exit(0)
}
