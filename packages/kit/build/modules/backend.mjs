/*
 * WHAT A SWITCH TAKES AWAY ON THE SERVER (openspec: module-switch-removes-backend).
 *
 * Every schema file, every Edge Function, every file of rows and of seed under packages/kit/supabase is owned by
 * exactly one module, or by `core` — what every site has and nothing switches off: accounts, content, the ledger,
 * the admin, comments, analytics. A module's own are named in its manifest (`owns.schema`, `owns.functions`, in
 * kit.mjs); core's are named here. Whatever joins two modules is owned by both and is there only while both are on:
 *
 *   supabase/schemas/glue/<a>+<b>.sql   a trigger on the other's table, a key across the two, the reading of one
 *                                       module's tables that another module's function asks for. `core` may be one
 *                                       of the two — glue a module shares with every site — and the glue loads after
 *                                       every module's file, so what it declares again replaces the answer-nothing
 *                                       version the asking module declares for a site without the other.
 *   supabase/data/<owner>.sql           a module's rows (or a glue's, named <a>+<b>), after the kit's data.sql
 *   supabase/seed/<owner>.sql           a module's part of the local seed, after the kit's seed.sql
 *   GLUE_FUNCTIONS below                a function that needs two modules to have anything to serve
 *
 * `backendFor` is what `assemble` copies for a site: core, every module that is on, and every glue whose owners
 * are all on. `ownership` is what the manifests check holds the tree to: a file nobody owns, or two modules both
 * claim, is refused by name, so a module switched off can never leave something of itself behind.
 *
 * Switching a module off removes its behaviour, never its data: a database that holds a disabled module's tables
 * keeps them (plan.mjs reads `kitTables` for which tables those are), and `platformkit module drop <key>` is the one
 * way to remove them.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isOn } from './manifest.mjs'

export const KIT_SUPABASE = fileURLToPath(new URL('../../supabase/', import.meta.url))

/* what every site has */
export const CORE = {
  schema: [
    '10-foundation.sql', '12-compiled.sql', '12-content.sql', '13-search.sql', '14-audience.sql', '15-library.sql',
    '30-analytics.sql', '40-commerce.sql', '87-api-rate.sql', '97-comments.sql', '98-achievements.sql', '99-reactions.sql',
  ],
  functions: [
    'admin', 'confirm-checkout', 'content', 'create-checkout-session', 'images', 'ingest', 'payment-provider-webhook',
    'push-catalog', 'reader-content', 'share-image', 'stripe-webhook',
  ],
}

/* a function with nothing to serve unless every module named is on */
export const GLUE_FUNCTIONS = {
  /* the store served as Shopify's Storefront API: the store's offers, behind the api module's keys and its carts */
  'storefront-api': ['api', 'store'],
}

const sqlIn = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : []
/* the owners a glue's name says, or null where it is not a glue's name */
export const glueOwners = (name) => { const parts = name.replace(/\.sql$/, '').split('+'); return parts.length > 1 ? parts : null }

/* every file of the kit's backend, as names */
export function kitBackend(kit = KIT_SUPABASE) {
  const fnDir = path.join(kit, 'functions')
  return {
    schema: sqlIn(path.join(kit, 'schemas')),
    glue: sqlIn(path.join(kit, 'schemas', 'glue')),
    rows: sqlIn(path.join(kit, 'data')),
    seed: sqlIn(path.join(kit, 'seed')),
    functions: fs.existsSync(fnDir) ? fs.readdirSync(fnDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name).sort() : [],
  }
}

/*
 * WHO OWNS WHAT, and every way that can be wrong: a file nobody claims, a file two claim, a glue or a rows file
 * naming a module nobody declares, a claim on a file that is not there. `modules` is the manifests as moduleSet
 * reads them (a Map of key → manifest).
 */
export function ownership(modules, kit = KIT_SUPABASE) {
  const files = kitBackend(kit)
  const faults = []
  const known = (k) => k === 'core' || modules.has(k)
  const schema = new Map(), functions = new Map()
  const claim = (map, what, name, owner) => {
    if (map.has(name)) faults.push(`${what} ${name} is claimed by both ${map.get(name).join('+')} and ${owner.join('+')}`)
    else map.set(name, owner)
  }
  for (const f of CORE.schema) claim(schema, 'schema file', f, ['core'])
  for (const f of CORE.functions) claim(functions, 'function', f, ['core'])
  for (const [f, owners] of Object.entries(GLUE_FUNCTIONS)) claim(functions, 'function', f, owners)
  for (const m of modules.values()) {
    for (const f of m.owns.schema || []) claim(schema, 'schema file', f, [m.key])
    for (const f of m.owns.functions || []) claim(functions, 'function', f, [m.key])
  }
  for (const f of files.schema) if (!schema.has(f)) faults.push(`schema file ${f} is owned by no module — name it in a manifest's owns.schema, or in CORE (build/modules/backend.mjs)`)
  for (const f of files.functions) if (!functions.has(f)) faults.push(`function ${f} is owned by no module — name it in a manifest's owns.functions, or in CORE (build/modules/backend.mjs)`)
  for (const [f, o] of schema) if (!files.schema.includes(f)) faults.push(`${o.join('+')} claims schema file ${f}, which is not in supabase/schemas/`)
  for (const [f, o] of functions) if (!files.functions.includes(f)) faults.push(`${o.join('+')} claims function ${f}, which is not in supabase/functions/`)
  for (const o of Object.values(GLUE_FUNCTIONS)) for (const k of o) if (!known(k)) faults.push(`GLUE_FUNCTIONS names \`${k}\`, which no manifest declares`)
  const named = (what, dir, f, { glue }) => {
    const owners = glueOwners(f) || (glue ? null : [f.replace(/\.sql$/, '')])
    if (!owners) { faults.push(`${dir}/${f} is not named for the two (or more) modules it joins: <a>+<b>.sql`); return }
    for (const k of owners) if (!known(k)) faults.push(`${dir}/${f} names \`${k}\`, which no manifest declares`)
    if (owners.length > 1 && new Set(owners).size !== owners.length) faults.push(`${dir}/${f} names one module twice`)
    if (owners.length > 1 && owners.every((k) => k === 'core')) faults.push(`${dir}/${f} joins core to itself — it belongs in a core file`)
  }
  for (const f of files.glue) named('glue', 'schemas/glue', f, { glue: true })
  for (const f of files.rows) named('rows', 'data', f, { glue: false })
  for (const f of files.seed) named('seed', 'seed', f, { glue: false })
  return { schema, functions, files, faults }
}

/*
 * WHAT A SITE'S SWITCHES ASSEMBLE: core, the modules that are on, the glue whose owners are all on. A module that
 * is on and requires one that is off has no consistent backend at all (its schema builds on the other's), so it is
 * refused here rather than written out half-made.
 */
export function backendFor(modules, switches = {}, kit = KIT_SUPABASE) {
  const own = ownership(modules, kit)
  if (own.faults.length) throw new Error('the backend has files no module owns, or owns twice:\n  ' + own.faults.join('\n  '))
  const on = (k) => k === 'core' || (modules.has(k) && isOn(k, switches))
  for (const m of modules.values()) if (on(m.key)) for (const r of m.requires) if (!on(r.module)) {
    throw new Error(`the ${m.key} module is on and requires ${r.module}, which is off — ${r.why || `${m.key} cannot work without it`}. Switch ${r.module} on, or ${m.key} off.`)
  }
  const all = (owners) => owners.every(on)
  return {
    on,
    off: [...modules.keys()].filter((k) => !on(k)),
    schema: own.files.schema.filter((f) => all(own.schema.get(f))),
    glue: own.files.glue.filter((f) => all(glueOwners(f))),
    rows: own.files.rows.filter((f) => all(glueOwners(f) || [f.replace(/\.sql$/, '')])),
    seed: own.files.seed.filter((f) => all(glueOwners(f) || [f.replace(/\.sql$/, '')])),
    functions: own.files.functions.filter((f) => all(own.functions.get(f))),
  }
}

/* the tables a schema file declares */
export const tablesIn = (sql) => [...String(sql).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?public"?\."?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1])

/*
 * EVERY TABLE THE KIT DECLARES, by owner, whether or not a site has the module on: what a plan keeps rather than
 * drops when a module is switched off, and what `module drop` takes away.
 */
export function kitTables(modules, kit = KIT_SUPABASE) {
  const own = ownership(modules, kit)
  const out = new Map()
  const add = (owners, file) => { for (const t of tablesIn(fs.readFileSync(file, 'utf8'))) out.set(t, owners) }
  for (const f of own.files.schema) add(own.schema.get(f) || [], path.join(kit, 'schemas', f))
  for (const f of own.files.glue) add(glueOwners(f), path.join(kit, 'schemas', 'glue', f))
  return out
}

/* the name of every table any kit schema or glue file declares, whatever a site has on */
export function kitDeclaredTables(kit = KIT_SUPABASE) {
  const files = kitBackend(kit)
  return new Set([...files.schema.map((f) => path.join(kit, 'schemas', f)), ...files.glue.map((f) => path.join(kit, 'schemas', 'glue', f))]
    .flatMap((f) => tablesIn(fs.readFileSync(f, 'utf8'))))
}
