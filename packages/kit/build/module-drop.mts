#!/usr/bin/env node
/*
 * DROPPING A SWITCHED-OFF MODULE'S DATA (openspec: module-switch-removes-backend).
 *
 * Switching a module off removes what it does — its functions, cron jobs, triggers, rules and glue — and keeps its
 * tables, rows and all, so switching it back on finds them (plan.mjs, keepOffTables). Removing the data is a second
 * act, and this is the only way to do it:
 *
 *   platformkit module drop <key>              the local stack
 *   platformkit module drop <key> --linked     the production database SUPABASE_DB_URL names
 *   platformkit module drop <key> --plan       show what would go, and drop nothing
 *
 * It refuses a module that is on, and a table the site's declaration still has. It lists every table the module
 * owns (its own schema files, and the glue it shares with another module) with how many rows each holds, and drops
 * them through the same guard every destructive plan goes through: a table with rows needs
 * PLATFORMKIT_ALLOW_DESTRUCTIVE, naming this drop's digest (or 1), for this run. An empty table goes without asking —
 * it loses nothing.
 */
import path from 'node:path'
import { loadSite } from './site.mjs'
import { moduleSet } from './steps.mjs'
import { isOn, type Switches } from './modules/manifest.mjs'
import { kitTables, tablesIn } from './modules/backend.mjs'
import { readDeclaration, localUrl, withDb, costsIn, commitOf } from './plan.mjs'
import { guard, destructive, describe } from './destructive.mjs'
import { isMain } from './is-main.mjs'

/* the drop for a module: what it would remove, and the verdict on it. `target` is a database url; `site` the site's
   config, read from `root` unless given */
export interface Drop {
  key: string
  /* every table the module owns, and those of them this database holds */
  owned: string[]
  present: string[]
  rows: Record<string, number | null>
  sql: string
  verdict: ReturnType<typeof guard>
}

export async function planDrop({ root = process.cwd(), key, target, env = process.env, site: given = null }: {
  root?: string, key: string, target: string, env?: NodeJS.ProcessEnv, site?: { root?: string, modules?: Switches, [k: string]: unknown } | null
}): Promise<Drop> {
  const site = given || await loadSite(root)
  const modules = await moduleSet(site)
  if (!modules.has(key)) throw new Error(`module drop: no module is called "${key}" — the modules are ${[...modules.keys()].sort().join(', ')}`)
  if (isOn(key, site.modules || {})) throw new Error(`module drop: ${key} is on — switch it off in platformkit.config.js (modules: { ${JSON.stringify(key)}: false }) and deploy first; dropping is for a module that is off`)
  const owned = [...kitTables(modules)].filter(([, owners]) => owners.includes(key)).map(([t]) => t)
  const declared = new Set(tablesIn(readDeclaration(root).schema))
  const still = owned.filter((t) => declared.has(t))
  if (still.length) throw new Error(`module drop: the site's declaration still has ${still.join(', ')} — run platformkit assemble, so the tree is the module-off one, and try again`)
  return withDb(target, async (db: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => {
    const present = (await db.query("select tablename from pg_tables where schemaname = 'public' and tablename = any($1)", [owned])).rows.map((r) => r.tablename).sort()
    /* one statement a table, so the guard counts each one's rows; applied together, in one transaction */
    const sql = present.map((t) => `drop table public.${t} cascade;\n`).join('')
    const costs = await costsIn(db, destructive(sql))
    const verdict = guard(sql, env, { costs, commit: commitOf(root, env) })
    const rows = Object.fromEntries(present.map((t: string) => [t, (costs as Record<string, { rows: number | null }>)[`public.${t}`]?.rows ?? null]))
    return { key, owned, present, rows, sql, verdict }
  })
}

export async function applyDrop(drop: Drop, target: string): Promise<void> {
  if (!drop.sql) return
  if (!drop.verdict.ok) throw new Error(`module drop: refused — ${drop.verdict.refused.length} table(s) hold rows; set PLATFORMKIT_ALLOW_DESTRUCTIVE=${drop.verdict.digest} for this run to drop them`)
  await withDb(target, async (db: { query: (q: string) => Promise<unknown> }) => {
    await db.query('begin')
    try { await db.query(drop.sql); await db.query('commit') } catch (e: any) { await db.query('rollback'); throw new Error('module drop: the drop failed and was rolled back — ' + e.message) }
  })
}

if (isMain(import.meta.url)) {
  process.on('uncaughtException', (e) => { console.error('✖ ' + (e.message || e)); process.exit(1) })
  process.on('unhandledRejection', (e: any) => { console.error('✖ ' + (e.message || e)); process.exit(1) })
  const args = process.argv.slice(2)
  const key = args.find((a) => !a.startsWith('--'))
  if (!key) { console.error('usage: platformkit module drop <key> [--linked] [--plan]'); process.exit(2) }
  const linked = args.includes('--linked'), only = args.includes('--plan')
  const target = linked ? process.env.SUPABASE_DB_URL : localUrl(process.cwd())
  if (!target) throw new Error('module drop: --linked needs SUPABASE_DB_URL, the production connection')
  const drop = await planDrop({ key, target })
  if (!drop.present.length) { console.log(`module drop: ${key} has no tables in this database — nothing to drop`); process.exit(0) }
  console.log(`module drop: ${key} owns ${drop.present.length} table(s) here:`)
  for (const t of drop.present) console.log(`  ${t.padEnd(36)} ${drop.rows[t] == null ? 'rows could not be counted' : drop.rows[t] + ' row(s)'}`)
  if (drop.verdict.hits.some((h) => h.loses !== 'nothing')) console.log('\n' + describe(drop.verdict.hits.filter((h) => h.loses !== 'nothing')))
  if (only) { console.log(`\n(--plan: nothing dropped${drop.verdict.ok ? '' : `; PLATFORMKIT_ALLOW_DESTRUCTIVE=${drop.verdict.digest} would allow it`})`); process.exit(0) }
  if (!drop.verdict.ok) { console.error(`\n✖ refused — these hold rows. To drop them, run again with PLATFORMKIT_ALLOW_DESTRUCTIVE=${drop.verdict.digest}`); process.exit(1) }
  await applyDrop(drop, target)
  console.log(`✔ ${key}'s ${drop.present.length} table(s) dropped`)
}
