/*
 * The line between a declaration and state, held mechanically rather than asked for politely
 * (build/declarations.mjs is where each table is classified; AGENTS.md is why).
 *
 * Four checks. The first is the forcing function — a table in neither list fails, so a new one
 * cannot be added without somebody answering the question in the same commit. The rest are
 * consequences: a projected table may grant no write to a signed-in role, so authoring one is
 * impossible rather than discouraged; no client code may write one; and a projection must name a
 * content path that a collection actually produces, because a projection with no source is a table
 * pretending to be a declaration.
 *
 * A `pending` entry is a declaration that is not a file yet. The checks step over it, the change
 * that will move it is named, and every run prints it — so the debt is loud.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DECLARED, STATE, pendingOf, DERIVED } from './declarations.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = join(HERE, '..')
const REPO = join(KIT, '..', '..')

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nDECLARATIONS\n')

/* ---- the tables the kit declares, read from the schemas themselves ---- */
const schemaDir = join(KIT, 'supabase', 'schemas')
const schemas = readdirSync(schemaDir).filter((f) => f.endsWith('.sql')).map((f) => ({ f, sql: readFileSync(join(schemaDir, f), 'utf8') }))
const tables = new Map()
for (const { f, sql } of schemas) {
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS "public"\."([a-z_]+)"/g)) tables.set(m[1], f)
}
ok('the schemas declare tables to classify', tables.size > 30, String(tables.size))

/* ---- 1. every table is classified, exactly once ---- */
for (const [t, f] of tables) {
  const d = Object.prototype.hasOwnProperty.call(DECLARED, t)
  const s = Object.prototype.hasOwnProperty.call(STATE, t)
  const v = Object.prototype.hasOwnProperty.call(DERIVED, t)
  ok('`' + t + '` (' + f + ') is classified', d || s || v,
    'add it to DECLARED, STATE or DERIVED in build/declarations.mjs — is it what the site IS, what people DID, or a cache of what is already here?')
  ok('`' + t + '` is in one list only', [d, s, v].filter(Boolean).length === 1)
}
for (const t of [...Object.keys(DECLARED), ...Object.keys(STATE), ...Object.keys(DERIVED)]) {
  ok('`' + t + '` is a table that exists', tables.has(t), 'it is classified but no schema declares it')
}
/* A DERIVED TABLE IS A CACHE, so it is held to the one thing that makes it safe to be one: nothing
   with a session may read or write it. A client that could would be a client depending on a table
   the site is free to empty. */
for (const t of Object.keys(DERIVED)) {
  const sql = readFileSync(join(schemaDir, tables.get(t)), 'utf8')
  const grants = [...sql.matchAll(new RegExp('GRANT[^;]+ON TABLE "public"\\."' + t + '"[^;]*;', 'gi'))].map((m) => m[0])
  ok('`' + t + '` is the service role\'s alone', grants.every((g) => !/"?(anon|authenticated)"?/.test(g)),
    'a derived table is a cache the site may empty: nothing with a session may depend on it')
}

/* ---- 2. a projected table grants no write to a signed-in role ---- */
const WRITE = /FOR\s+(INSERT|UPDATE|DELETE)\b/i
for (const t of Object.keys(DECLARED)) {
  if (pendingOf(t)) continue
  const bad = []
  for (const { sql } of schemas) {
    const re = new RegExp('CREATE POLICY\\s+"[^"]+"\\s+ON\\s+"public"\\."' + t + '"([\\s\\S]{0,120}?)(?:USING|WITH CHECK)', 'g')
    for (const m of sql.matchAll(re)) {
      const head = m[1]
      if (!/TO\s+"authenticated"/i.test(head) && !/TO\s+"anon"/i.test(head)) continue
      /* no FOR clause at all means FOR ALL, which includes every write */
      if (WRITE.test(head) || !/FOR\s+SELECT/i.test(head)) bad.push(head.replace(/\s+/g, ' ').trim().slice(0, 60))
    }
  }
  ok('`' + t + '` is projected, so no client may write it', bad.length === 0, bad.join(' | '))
}

/* ---- 3. no client code writes a projected table ---- */
const roots = [join(KIT, 'src'), join(REPO, 'packages', 'movable-types', 'src')].filter(existsSync)
const files = []
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|vue|ts)$/.test(e.name)) files.push(p) } }
for (const r of roots) walk(r)
ok('there is client code to read', files.length > 100, String(files.length))
for (const t of Object.keys(DECLARED)) {
  if (pendingOf(t)) continue
  const re = new RegExp("from\\(\\s*['\"]" + t + "['\"]\\s*\\)\\s*\\.\\s*(insert|update|upsert|delete)\\b")
  const guilty = files.filter((p) => re.test(readFileSync(p, 'utf8'))).map((p) => p.replace(REPO + '/', ''))
  ok('`' + t + '` is not written from a browser', guilty.length === 0, guilty.join(', '))
}

/* ---- 4. a projection names a path a collection produces ---- */
const velite = readFileSync(join(KIT, 'build', 'velite.mjs'), 'utf8')
for (const [t, d] of Object.entries(DECLARED)) {
  if (pendingOf(t)) continue
  /* a projection drawn from several collections names them all, and each must exist — an index
     over the whole library is one table with five sources, not five lies about one */
  for (const one of Array.isArray(d.from) ? d.from : [d.from]) {
    const p = String(one || '').replace(/^content\//, '')
    ok('`' + t + '` comes from a collection that exists', velite.includes("'" + p + "'"),
      p + ' — no collection in build/velite.mjs produces it')
  }
}

/* ---- the debt, named and out loud ---- */
const changesDir = join(REPO, 'openspec', 'changes')
const live = existsSync(changesDir) ? readdirSync(changesDir).filter((n) => n !== 'archive') : []
const waiting = Object.entries(DECLARED).filter(([, d]) => d.pending)
for (const [t, d] of waiting) {
  ok('`' + t + '` names a change that will move it', live.includes(d.pending),
    d.pending + ' is not a live change — either it was archived without moving this, or the name is wrong')
}
if (waiting.length) {
  console.log('\n  ' + waiting.length + ' table(s) are a declaration and not yet a file:')
  for (const [t, d] of waiting) console.log('    ' + t.padEnd(16) + '→ ' + d.from + '   (' + d.pending + ')')
  console.log('')
}

/* ---------------------------------------------------------------------------------------------
 * A PROJECTION NOTHING RESTORES IS AN EMPTY TABLE, AND AN EMPTY TABLE DOES NOT FAIL.
 *
 * `platformkit migrate reset` brings the database to the declaration and then to the content that
 * is a declaration too. Every projection has to be on that line, because whatever asks a projected
 * table politely finds nothing when it is empty: the bots were missing from it, so after any reset
 * the support desk's Get an instant answer started no run and said it could not, and there was
 * nothing anywhere to say why. The search rows went the same way — a bot's search tool over an
 * empty library.
 *
 * So each projection says which script writes it, and the reset must run that script.
 */
{
  const cli = readFileSync(new URL('../bin/platformkit.mjs', import.meta.url), 'utf8')
  const line = (cli.match(/case 'migrate':[^\n]*/) || [''])[0]
  ok('the reset line was found in the CLI', !!line && line.includes('supabase'), 'the shape of bin/platformkit.mjs changed')
  const scripts = [...new Set(Object.values(DECLARED).map((d) => d.by).filter(Boolean))].sort()
  ok('every projection says which script writes it',
    Object.entries(DECLARED).every(([, d]) => !!d.by),
    Object.entries(DECLARED).filter(([, d]) => !d.by).map(([t]) => t).join(', '))
  for (const s of scripts) {
    ok('`' + s + '` runs on a reset', line.includes(`'${s}.mjs'`),
      'a projection it writes would be empty after `platformkit migrate reset`, and nothing would say so')
  }
}

/*
 * EVERY FUNCTION SAYS WHO MAY CALL IT, AND MEANS IT.
 *
 * REVOKING PUBLIC ALONE IS NOT A FENCE: Postgres grants EXECUTE to PUBLIC on every new function and
 * Supabase's ALTER DEFAULT PRIVILEGES grants anon and authenticated on top, so a file that revokes
 * PUBLIC and then grants to authenticated has been open to a signed-out visitor the whole time.
 * Sixty-five functions were in exactly that state, and forty-two more had a GRANT with no REVOKE at
 * all — decorative, every one of them. None leaked, because each gates on auth.uid() or is_admin()
 * inside; the danger is the next one, written the same way, that does not.
 *
 * So: a function that names who may call it must first take the default back BY NAME.
 */
{
  const dir = join(KIT, 'supabase', 'schemas')
  const open = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const t = readFileSync(join(dir, f), 'utf8')
    const said = new Set()
    for (const m of t.matchAll(/^REVOKE ALL ON FUNCTION (.+) FROM "anon", "authenticated";$/gm)) said.add(m[1])
    /* a function DELIBERATELY open to a visitor grants anon by name, and needs nothing taken back */
    const open_on_purpose = new Set()
    for (const m of t.matchAll(/^GRANT EXECUTE ON FUNCTION (.+) TO ([^;]+);$/gm)) if (/"anon"/.test(m[2])) open_on_purpose.add(m[1])
    for (const m of t.matchAll(/^(?:REVOKE ALL|GRANT EXECUTE) ON FUNCTION (.+?) (?:FROM PUBLIC|TO [^;]+);$/gm)) {
      if (!said.has(m[1]) && !open_on_purpose.has(m[1])) open.push(f + ': ' + m[1])
    }
  }
  ok('every function that says who may call it takes the default grant back by name first', open.length === 0, open.slice(0, 6).join('; ') + (open.length > 6 ? ` (+${open.length - 6})` : ''))
}

/*
 * A COUNT IS NEVER IN A FILE.
 *
 * The rule the whole declaration/state split rests on, applied to the one place it is most
 * tempting to break: a shop wants to type `stock: 5` into a product, and a shop that could
 * would find its counts reset to five every time the repository was redeployed. A file says a
 * variant is TRACKED and whether it may be sold past zero; the row says how many.
 *
 * Checked against the schemas themselves rather than a list anybody keeps, so a new field
 * called `stock` or `quantity` on a content collection fails the moment it is written.
 */
{
  const { kitConfig } = await import('./velite.mjs')
  const cfg = await kitConfig()
  const shapeOf = (z) => {
    for (let i = 0; z && i < 8; i++) {
      if (z.shape) return z.shape
      if (z._def && typeof z._def.shape === 'function') return z._def.shape()
      z = z._def && (z._def.schema || z._def.innerType || z._def.in || z._def.type)
    }
    return null
  }
  const COUNTS = ['stock', 'stocked', 'quantity', 'qty', 'inventory', 'on_hand', 'onHand', 'available', 'reserved', 'incoming', 'in_stock', 'inStock']
  for (const [name, col] of Object.entries(cfg.collections)) {
    const shape = col.schema && shapeOf(col.schema)
    if (!shape) continue
    for (const key of Object.keys(shape)) {
      ok(`no content collection carries a count: ${name}.${key}`, !COUNTS.includes(key),
        `${name} has a field called "${key}". How many are left is state and lives in public.inventory; a file may say \`tracked\` and \`backorder\` and nothing more.`)
    }
  }
}

console.log(`  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
