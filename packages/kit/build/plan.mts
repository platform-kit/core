/*
 * The plan: what brings a database to the declaration, computed in three parts and applied in that order —
 * never a migration. Run from a site's root after the assembler (platformkit migrate [--plan] [--linked]):
 *
 *   1. renames — the declaration's `-- renamed from: a, b` annotations on a table's `CREATE TABLE` line or a
 *      column's line, against what the database holds: the current name alone → nothing; a former name alone →
 *      ALTER … RENAME for the object and for every index, constraint and sequence prefixed with the old name;
 *      more than one → refused, naming them. Applied before the diff, so the diff sees an object matching its
 *      declaration and plans nothing destructive for it. A diff reads committed state only, so `--plan` shows the
 *      diff with the renamed objects' statements set aside (a rename would read as a drop and a create), and the
 *      apply commits the renames on their own — they lose nothing and are the declaration's — then computes the
 *      diff afresh over them and guards it like the rest.
 *   2. the diff — pg-delta (bundled in the Supabase CLI) from the target to a SHADOW holding the declaration,
 *      over public, storage and auth, the managed schemas contributing their policies and triggers alone. The
 *      declaration becomes a shadow through the CLI: written, in order, as the one file of a throwaway project
 *      under node_modules/.cache/platformkit/shadow (made fresh each run — a migrations folder the CLI builds a shadow
 *      from, never a migration any database the kit owns records), then either the CLI's own Docker shadow
 *      (`db diff --to migrations`) or, with PLATFORMKIT_SHADOW_DB_URL set (the deploy box has no Docker), a
 *      shadow database — any Postgres kept for nothing else: a Supabase project, or a plain one (a Render Postgres,
 *      a container), which the plan gives the platform's shape on first use (SHAPE: the roles the declaration grants
 *      to, auth and storage stubs with the one table and the functions the policies call, pgcrypto under extensions,
 *      the realtime publication) and marks as its own — brought to the declaration by the plan's own reset
 *      (resetShadow: public emptied object by object so the schema keeps its owner and grants, our policies on
 *      storage.objects and our triggers on auth.users dropped, the declaration applied whole; NEVER the CLI's
 *      `db reset --db-url`, which drops a hosted project's auth and storage schemas and nothing brings them back)
 *      and diffed by url. The reset refuses a database holding users, applied migrations, or tables in public it
 *      did not make, so it can never be pointed at production by mistake. Same engine, same schemas, same output either way.
 *   3. the data script (supabase/data.sql), verbatim — every statement idempotent.
 *
 * A MODULE SWITCHED OFF KEEPS ITS DATA (openspec: module-switch-removes-backend). Its tables are not in the
 * declaration, so the diff would drop them; a table the kit declares for a module that is off is kept instead, rows,
 * keys, indexes and all — only what the module DID goes: its triggers, its rules on the table, its functions. With
 * row level security on and no rule left, nobody but the service role reads it until the module is back.
 * `platformkit module drop <key>` is the one way to remove the tables themselves.
 *
 * Then the guard (destructive.mjs) over all three: a plan with a destructive statement is refused whole unless
 * PLATFORMKIT_ALLOW_DESTRUCTIVE=1 is set for this run, and the run then says so and lists what it allowed.
 * `--plan` prints the plan and the verdict and applies nothing (exit 1 when refused); without it the plan is
 * applied — each part in its own transaction — to the target: the local stack, or with `--linked` the
 * production connection SUPABASE_DB_URL names (the deploy's way). A shadow url that is the target's, or the
 * local stack's when the target is not it, is refused: a reset empties what it is pointed at.
 * Exports computePlan / applyPlan for the deploy and the kit's test; `--json` prints the plan as JSON.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { statements, guard, describe as describeHits, destructive as destructiveIn, digestOf } from './destructive.mjs'
import { VERBOSE, some } from './verbose.mjs'
import { platformkitRuntimePath } from './runtime-paths.mjs'
import { kitDeclaredTables, tablesIn } from './modules/backend.mjs'
import { isMain } from './is-main.mjs'

const SCHEMAS = 'public,storage,auth'
/* a statement's target: its kind and the schema of the object it makes, changes or drops — a policy's or a
   trigger's is the table it is on; anything else's the first qualified name after its kind */
const target = (text: any) => {
  const m = /^(create|alter|drop|comment\s+on|grant|revoke)\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|unique|materialized|constraint|event|all\s+privileges|usage|select|insert|update|delete|execute|all)\s+)*(policy|trigger|table|function|view|sequence|index|type|schema|publication|domain|aggregate|on)?\b/i.exec(text)
  const kind = (m && m[2] || '').toLowerCase()
  const on = /\bon\s+(?:table\s+|function\s+|sequence\s+)?"?(\w+)"?\."?(\w+)"?/i.exec(text)
  const first = /"?(\w+)"?\."?(\w+)"?/.exec(text)
  const schema = ((kind === 'policy' || kind === 'trigger') && on ? on[1] : (first || on || [])[1]) || 'public'
  return { kind, schema: schema.toLowerCase() }
}
const MANAGED = new Set(['auth', 'storage'])
/* the schemas themselves — public's comment and grants, a managed schema's anything but its policies and triggers — are
   the platform's: made by its init, differing between a local stack, a hosted project and one that grew through
   migrations, and never the declaration's to say */
const SCHEMA_ITSELF = /^(?:(?:create|drop|alter)\s+schema\b|comment\s+on\s+schema\b|(?:grant|revoke)\b[^;]*?\bon\s+schema\b|alter\s+default\s+privileges\b)/i
const leftToPlatform = (text: any) => { if (SCHEMA_ITSELF.test(text)) return true; const t = target(text); return MANAGED.has(t.schema) && t.kind !== 'policy' && t.kind !== 'trigger' }
const DECLARATION = '00000000000000_declaration.sql'

/* TLS for every database that is not on this machine (a hosted pooler insists on it and its url does not say so);
   none for a local stack, or wherever the url says sslmode=disable */
const isLocal = (url: any) => /@(?:127\.0\.0\.1|localhost|\[::1\]|host\.docker\.internal)(?::\d+)?\//.test(url) ||
  /* the end-to-end run's own Docker daemon, where its stacks are (build/e2e-container.mjs) */
  (!!process.env.SUPABASE_SERVICES_HOSTNAME && url.includes('@' + process.env.SUPABASE_SERVICES_HOSTNAME.trim() + ':'))
const sql = (url: any, tls: any) => new pg.Client({ connectionString: url, ssl: tls ? { rejectUnauthorized: false } : false })
/* TLS first for a database elsewhere; a server that has none (a private-network Postgres) is met again without */
const connect = async (url: any) => {
  const tls = !(/sslmode=disable/.test(url) || isLocal(url))
  let c = sql(url, tls)
  try { await c.connect() } catch (e: any) { if (tls && /SSL|TLS/i.test(e.message)) { c = sql(url, false); await c.connect() } else throw e }
  return c
}
export const withDb = async (url: any, fn: any) => { const c = await connect(url); try { return await fn(c) } finally { await c.end() } }

/* every column the database computes for itself (GENERATED ALWAYS AS … STORED), as
   `schema.table.column`. The guard is told these so that changing one — which postgres can only do
   as a drop and a re-add — is not read as losing data, any more than rebuilding an index is. */
const generatedIn = async (db: any) => new Set((await db.query(`
  select (table_schema || '.' || table_name || '.' || column_name) as name
    from information_schema.columns
   where is_generated = 'ALWAYS' and table_schema not in ('pg_catalog', 'information_schema')`)).rows.map((r: any) => r.name.toLowerCase()))
/*
 * WHAT A DESTRUCTIVE STATEMENT WOULD ACTUALLY COST, asked of the database it is about to change.
 *
 * The guard can say a column is being dropped; only the target can say whether anybody would miss
 * what is in it. So each hit is counted here, in the connection the plan already has open for the
 * generated columns, and handed to the guard the same way: the rows the table holds, and how many
 * of them hold something that would really be lost.
 *
 * A COLUMN'S OWN DEFAULT IS NOT A LOSS. A `role text default 'member' not null` whose every row
 * says 'member' holds nothing that was ever written by anybody: dropping it loses the shape and no
 * information. So `kept` counts the rows differing from the declared default, and only where that
 * default is a literal — a `nextval`, a function call, anything computed is treated as no default
 * at all, and then every non-null value counts.
 *
 * AND A COUNT THAT CANNOT BE TAKEN IS NOT ZERO. No permission, a relation that is not there, a
 * timeout: `unknown`, which refuses. Reading an error as "nothing to lose" would turn this from a
 * net into a trap, and it is the one way this function must not fail.
 */
export async function costsIn(db: any, hits: any) {
  const out: any = {}
  for (const h of hits) {
    const key = h.object.toLowerCase()
    try {
      if (h.kind === 'drop schema') {
        const r = await db.query('select count(*)::int as n from information_schema.tables where table_schema = $1', [h.object.replace(/"/g, '')])
        out[key] = { rows: r.rows[0].n, kept: r.rows[0].n, unknown: false, what: 'table(s) in the schema' }
        continue
      }
      const [schema, table, column] = h.object.replace(/"/g, '').split('.')
      const rel = q(schema) + '.' + q(table)
      const rows = (await db.query(`select count(*)::int as n from ${rel}`)).rows[0].n
      if (!column) { out[key] = { rows, kept: rows, unknown: false, what: 'row(s)' }; continue }
      /* the column's declared default, and only a literal one */
      const d = await db.query(`select column_default as d from information_schema.columns
                                 where table_schema = $1 and table_name = $2 and column_name = $3`, [schema, table, column])
      const raw = d.rows.length ? d.rows[0].d : null
      const literal = raw != null && /^('(?:[^']|'')*'|-?\d+(?:\.\d+)?|true|false)(::[\w ."]+)?$/i.test(String(raw).trim())
      const kept = literal
        ? (await db.query(`select count(*)::int as n from ${rel} where ${q(column)} is distinct from ${String(raw).trim()}`)).rows[0].n
        : (await db.query(`select count(${q(column)})::int as n from ${rel}`)).rows[0].n
      out[key] = { rows, kept, unknown: false, what: literal ? `row(s) differing from the default ${String(raw).trim()}` : 'value(s)' }
    } catch (e: any) {
      out[key] = { rows: null, kept: null, unknown: true, why: String(e && e.message || e).split('\n')[0] }
    }
  }
  return out
}

/* the commit this plan is of, for an allowance that names one: git, else whatever the host says */
export function commitOf(root: any, env = process.env) {
  for (const k of ['PLATFORMKIT_COMMIT', 'RENDER_GIT_COMMIT', 'GITHUB_SHA', 'VERCEL_GIT_COMMIT_SHA', 'SOURCE_COMMIT', 'CF_PAGES_COMMIT_SHA']) {
    if (env[k] && /^[0-9a-f]{7,40}$/i.test(String(env[k]).trim())) return String(env[k]).trim().toLowerCase()
  }
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  const sha = (r.stdout || '').trim()
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : ''
}

const q = (s: any) => '"' + s.replace(/"/g, '""') + '"'
/* a database's identity for the guards and the log: user, host and database, never the password (two projects share a pooler host and differ by user) */
const bare = (url: any) => { try { const u = new URL(url); return (u.username ? u.username + '@' : '') + u.host + u.pathname } catch { return url } }

/* ---- the declaration as one text, in reset order: the kit's files, the site's, and its data script ---- */
export function readDeclaration(root: any) {
  const dir = path.join(root, 'supabase', 'schemas')
  /* the kit's files, the glue between the modules that are on (it loads after every module's), the site's */
  const files = [...list(dir), ...list(path.join(dir, 'glue')), ...list(path.join(dir, 'site'))]
  if (!files.length) throw new Error('plan: supabase/schemas/ is empty — run platformkit assemble first')
  const data = path.join(root, 'supabase', 'data.sql')
  return { files, schema: files.map((f) => `-- ${path.relative(root, f)}\n` + fs.readFileSync(f, 'utf8')).join('\n\n'), data: fs.existsSync(data) ? fs.readFileSync(data, 'utf8') : '' }
}
const list = (d: any) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(d, f)) : []

/* ---- the annotations: { table: { schema, name, former: [] }, columns: [{ schema, table, name, former }] } ---- */
export function renamesDeclared(schema: any) {
  const tables = [], columns = []
  let cur = null
  for (const line of schema.split('\n')) {
    const t = /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/i.exec(line)
    if (t) { cur = { schema: t[1] || 'public', name: t[2] }; const f = former(line); if (f) tables.push({ ...cur, former: f }); continue }
    if (!cur) continue
    if (/^\s*\)/.test(line)) { cur = null; continue }
    const c = /^\s*"?(\w+)"?\s+\S/.exec(line)
    const f = former(line)
    if (c && f && !/^(constraint|primary|unique|check|foreign|exclude)$/i.test(c[1])) columns.push({ schema: cur.schema, table: cur.name, name: c[1], former: f })
  }
  return { tables, columns }
}
const former = (line: any) => { const m = /--\s*renamed\s+from:\s*(.+)$/i.exec(line); return m ? m[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean) : null }

/* ---- the rename statements for one database: what exists decides ---- */
export async function renamesFor(db: any, declared: any) {
  const out = [], notes = []
  const renamedTable: any = {}   /* old → new, so a column lookup finds the table where it is now */
  /* AND THE COLUMNS. A column renamed on a table that was NOT itself renamed used to be invisible
     here, so the diff's drop-and-add for it was never set aside and the guard refused the whole
     plan as destructive — for a rename that loses nothing. The table's name is not enough to
     recognise those statements, because the table is unchanged; the column's is. */
  const renamedCol = []
  for (const t of declared.tables) {
    const names = [t.name, ...t.former]
    const r = await db.query('select table_name from information_schema.tables where table_schema = $1 and table_name = any($2)', [t.schema, names])
    const present = r.rows.map((x: any) => x.table_name)
    if (present.length > 1) throw new Error(`plan: ${t.schema}.${t.name} — more than one of its names exists (${present.join(', ')}); a rename cannot be chosen, and nothing is applied`)
    if (!present.length || present[0] === t.name) continue
    const old = present[0]
    renamedTable[old] = t.name
    out.push(`ALTER TABLE ${q(t.schema)}.${q(old)} RENAME TO ${q(t.name)};`)
    /* the objects named after it: indexes, constraints, sequences prefixed with the old name */
    const idx = await db.query('select indexname from pg_indexes where schemaname = $1 and tablename = $2 and indexname like $3', [t.schema, old, old + '\\_%'])
    for (const { indexname } of idx.rows) out.push(`ALTER INDEX ${q(t.schema)}.${q(indexname)} RENAME TO ${q(t.name + indexname.slice(old.length))};`)
    const con = await db.query("select c.conname from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace where n.nspname = $1 and r.relname = $2 and c.conname like $3 and c.contype <> 'p' and c.contype <> 'u' and not exists (select 1 from pg_indexes i where i.schemaname = n.nspname and i.indexname = c.conname)", [t.schema, old, old + '\\_%'])
    for (const { conname } of con.rows) out.push(`ALTER TABLE ${q(t.schema)}.${q(t.name)} RENAME CONSTRAINT ${q(conname)} TO ${q(t.name + conname.slice(old.length))};`)
    const seq = await db.query("select relname from pg_class r join pg_namespace n on n.oid = r.relnamespace where n.nspname = $1 and r.relkind = 'S' and r.relname like $2", [t.schema, old + '\\_%'])
    for (const { relname } of seq.rows) out.push(`ALTER SEQUENCE ${q(t.schema)}.${q(relname)} RENAME TO ${q(t.name + relname.slice(old.length))};`)
    notes.push(`${t.schema}.${old} → ${t.name} (${idx.rows.length} index(es), ${con.rows.length} constraint(s), ${seq.rows.length} sequence(s))`)
  }
  for (const c of declared.columns) {
    const table = Object.entries(renamedTable).find(([, n]) => n === c.table)?.[0] || c.table   /* where the column is now */
    const names = [c.name, ...c.former]
    const r = await db.query('select column_name from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = any($3)', [c.schema, table, names])
    const present = r.rows.map((x: any) => x.column_name)
    if (present.length > 1) throw new Error(`plan: ${c.schema}.${c.table}.${c.name} — more than one of its names exists (${present.join(', ')}); a rename cannot be chosen, and nothing is applied`)
    if (!present.length || present[0] === c.name) continue
    const old = present[0]
    out.push(`ALTER TABLE ${q(c.schema)}.${q(c.table)} RENAME COLUMN ${q(old)} TO ${q(c.name)};`)
    const prefix = c.table + '_' + old + '_'
    const idx = await db.query('select indexname from pg_indexes where schemaname = $1 and tablename = $2 and indexname like $3', [c.schema, table, prefix.replace(/_/g, '\\_') + '%'])
    for (const { indexname } of idx.rows) out.push(`ALTER INDEX ${q(c.schema)}.${q(indexname)} RENAME TO ${q(c.table + '_' + c.name + '_' + indexname.slice(prefix.length))};`)
    notes.push(`${c.schema}.${c.table}.${old} → ${c.name}`)
    renamedCol.push({ table: c.table, old, name: c.name })
  }
  return { sql: out.join('\n'), notes, renamed: [...Object.keys(renamedTable), ...Object.values(renamedTable)], renamedCol }
}

/* ---- the shadow: a throwaway project the CLI builds a shadow from ---- */
function shadowProject(root: any, declaration: any) {
  const dir = platformkitRuntimePath(root, 'shadow')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true })
  const site = fs.existsSync(path.join(root, 'supabase', 'config.toml')) ? fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8') : ''
  const major = (/major_version\s*=\s*(\d+)/.exec(site) || [])[1] || '17'
  const port = Number((/\[db\][\s\S]*?\nport\s*=\s*(\d+)/.exec(site) || [])[1] || 54322)
  const id = ((/project_id\s*=\s*"([^"]+)"/.exec(site) || [])[1] || 'site') + '-shadow'
  fs.writeFileSync(path.join(dir, 'supabase', 'config.toml'), `# made by plan.mjs on every run; never edited, never committed\nproject_id = "${id}"\n[db]\nport = ${port + 60}\nshadow_port = ${port + 61}\nmajor_version = ${major}\n`)
  fs.writeFileSync(path.join(dir, 'supabase', 'migrations', DECLARATION), declaration)
  return dir
}
const cli = (dir: any, args: any) => {
  const r = spawnSync('npx', ['supabase', '--workdir', dir, ...args, '--output-format', 'json'], { cwd: dir, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 })   /* --workdir: the throwaway project by name, never the site's found by walking up */
  const lines = (r.stdout + '\n' + r.stderr).split('\n').filter((l) => l.startsWith('{'))
  let json = null; for (const l of lines) { try { json = JSON.parse(l) } catch {} }
  if (json && json._tag === 'Error') throw new Error(`supabase ${args.slice(0, 2).join(' ')}: ${json.error?.message || JSON.stringify(json.error)}`)
  if (r.status !== 0) throw new Error(`supabase ${args.slice(0, 2).join(' ')} failed (${r.status}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`)
  return json
}
const disableSsl = (url: any) => /sslmode=/.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'sslmode=disable'

/* ---- the shadow database brought to the declaration: only what the declaration owns is touched ---- */
/* public emptied object by object rather than dropped: the schema itself keeps the owner (pg_database_owner), the
   grants and the default privileges the platform gave it, which a recreated schema would not have (and which the
   diff would then see) */
const KIND: any = { r: 'table', p: 'table', v: 'view', m: 'materialized view', S: 'sequence', f: 'foreign table' }
async function emptyPublic(db: any) {
  /* tables first (an identity sequence goes with its table and cannot be dropped alone), then the rest */
  const rels = await db.query("select relname, relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind in ('r','p','v','m','S','f') and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') order by case relkind when 'r' then 0 when 'p' then 0 when 'v' then 1 when 'm' then 1 else 2 end")
  for (const { relname, relkind } of rels.rows) await db.query(`drop ${KIND[relkind]} if exists public.${q(relname)} cascade`)
  const fns = await db.query("select p.oid::regprocedure::text as sig, p.prokind from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')")
  for (const { sig, prokind } of fns.rows) await db.query(`drop ${prokind === 'p' ? 'procedure' : prokind === 'a' ? 'aggregate' : 'function'} if exists ${sig} cascade`)
  const types = await db.query("select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype in ('e','d','c','r') and not exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind <> 'c') and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')")
  for (const { typname } of types.rows) await db.query(`drop type if exists public.${q(typname)} cascade`)
}
/* The shape Supabase gives a database, put onto a plain Postgres so it can hold the declaration: the roles the
   declaration grants to, the auth and storage schemas with the one table and the functions it references, the
   extensions schema with pgcrypto (a column default calls it), the realtime publication. Stubs — enough for the
   objects to exist and the policies to compile; nothing runs here. A real Supabase database has all of it and
   is left alone. Idempotent. */
const SHAPE_ROLES = `
do $$ declare r text; begin
  foreach r in array array['postgres', 'anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
  end loop;
end $$;
`
const SHAPE = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, created_at timestamptz default now());
create table if not exists auth.identities (id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default extensions.gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$ declare p text[]; begin select string_to_array(name, '/') into p; return p[1:array_length(p, 1) - 1]; end $$;
do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role, postgres;
create schema if not exists platformkit;
create table if not exists platformkit.shadow (made_at timestamptz not null default now());
`
/* what the platform sets for the postgres role, said as postgres (a role may set its own default privileges alone) */
const SHAPE_AS_POSTGRES = `
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public;
`
export async function resetShadow(url: any, declaration: any) {
  await withDb(url, async (db: any) => {
    const one = async (q: any) => { try { return Number((await db.query(q)).rows[0].n) } catch { return 0 } }
    /* a real Supabase database (the platform's roles and schemas) or a plain Postgres the plan has shaped and marked;
       anything else with objects in public is somebody's — never a shadow */
    const supabase = await one("select count(*)::int as n from pg_roles where rolname = 'supabase_admin'")
    const marked = await one("select count(*)::int as n from pg_tables where schemaname = 'platformkit' and tablename = 'shadow'")
    const tables = await one("select count(*)::int as n from pg_tables where schemaname = 'public'")
    if (!supabase && !marked && tables) throw new Error(`plan: refusing to reset ${bare(url)} as the shadow — it holds ${tables} table(s) in public and is not a shadow the plan made; a shadow is a database kept for nothing else (an empty one is shaped on first use)`)
    /* the tripwires: a database with people in it, or a migration history, is somebody's */
    const users = await one('select count(*)::int as n from auth.users')
    const applied = await one('select count(*)::int as n from supabase_migrations.schema_migrations')
    if (users || applied) throw new Error(`plan: refusing to reset ${bare(url)} as the shadow — it holds ${users} user(s) and ${applied} applied migration(s); a shadow is a database kept for nothing else`)
    /* a plain Postgres is given the platform's shape (a Supabase database has it), and everything the declaration
       makes is owned by postgres as it is on production — the diff compares owners — so the plan becomes postgres:
       the role made if it is missing (the connecting user must be allowed to create roles) and granted to the user */
    if (!supabase) {
      try { await db.query(SHAPE_ROLES) } catch (e: any) { throw new Error('plan: the shadow could not be shaped as a Supabase database (the roles) — ' + e.message) }
      const me = (await db.query('select current_user as u')).rows[0].u
      if (me !== 'postgres') {
        /* what the database's owner must give postgres before handing over: the database, and public (owned by the owner) */
        try { await db.query('grant postgres to current_user'); await db.query('grant create on database ' + q((await db.query('select current_database() as d')).rows[0].d) + ' to postgres; grant usage, create on schema public to postgres; grant usage on schema public to anon, authenticated, service_role'); await db.query('set role postgres') }
        catch (e: any) { throw new Error(`plan: the shadow's user "${me}" cannot become postgres (${e.message}) — production's objects are owned by postgres and the diff compares owners, so a plain Postgres shadow needs its user named postgres, or able to create that role (a managed Postgres whose cluster already owns postgres, like Render's, cannot); a Supabase project, whose user is postgres, works as it is — set PLATFORMKIT_SHADOW_DB_URL to its session-pooler url`) }
      }
      try { await db.query(SHAPE); await db.query(SHAPE_AS_POSTGRES) } catch (e: any) { throw new Error('plan: the shadow could not be shaped as a Supabase database — ' + e.message) }
    }
    /* what the declaration owns, gone: everything in public (its policies elsewhere and its triggers on auth.users go
       with the functions they depend on), every policy on storage.objects (a shadow has none but ours) */
    const pol = await db.query("select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'")
    await db.query('begin')
    try {
      for (const { policyname } of pol.rows) await db.query(`drop policy if exists ${q(policyname)} on storage.objects`)
      await emptyPublic(db)
      await db.query('commit')
    } catch (e: any) { await db.query('rollback'); throw new Error('plan: the shadow could not be emptied — ' + e.message) }
    /* the declaration, whole */
    await db.query('begin')
    try { await db.query(declaration); await db.query('commit') } catch (e: any) { await db.query('rollback'); throw new Error('plan: the declaration failed on the shadow — ' + e.message) }
  })
}

/* the local stack's url, from the CLI (the site's own project) */
export function localUrl(root: any) {
  const r = spawnSync('npx', ['supabase', 'status', '-o', 'env'], { cwd: root, encoding: 'utf8', env: process.env })
  const m = /^DB_URL="?([^"\n]+)"?/m.exec(r.stdout || '')
  if (!m) throw new Error('plan: the local stack is not up (supabase status gave no DB_URL) — platformkit dev, or supabase start')
  return disableSsl(m[1])
}

/* ---- the diff from the target to the declaration ---- */
export async function diffAgainst(root: any, target: any, declaration: any, shadowUrl: any) {
  const dir = shadowProject(root, declaration)
  let to
  if (shadowUrl) { await resetShadow(shadowUrl, declaration); to = isLocal(shadowUrl) ? disableSsl(shadowUrl) : shadowUrl } else to = 'migrations'
  const j = cli(dir, ['db', 'diff', '--from', target, '--to', to, '--use-pg-delta', '-s', SCHEMAS])
  const raw = (j && j.diff) || ''
  /* the managed schemas: their policies and triggers alone (Supabase's own rule for them); the rest is theirs */
  const kept = [], left = []
  for (const s of statements(raw)) { if (!/^set\s/i.test(s.text) && leftToPlatform(s.text)) left.push(s.raw); else kept.push(s.raw) }
  const body = kept.filter((s) => !/^set\s+local\s+check_function_bodies/i.test(s))
  return { sql: body.length ? ['SET local check_function_bodies = off;', ...body].join('\n\n') + '\n' : '', left, dropStatements: (j && j.dropStatements) || [] }
}

/* the event triggers of the target that depend on a function the diff drops, dropped ahead of it */
async function withEventTriggers(db: any, sql: any) {
  const drops = [...sql.matchAll(/^DROP FUNCTION "?(\w+)"?\."?(\w+)"?\s*\(/gm)].map((m) => [m[1], m[2]])
  if (!drops.length) return sql
  const r = await db.query("select e.evtname, n.nspname, p.proname from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid join pg_namespace n on n.oid = p.pronamespace")
  const gone = r.rows.filter((x: any) => drops.some(([sch, fn]) => x.nspname === sch && x.proname === fn))
  if (!gone.length) return sql
  const head = gone.map((x: any) => `-- the event trigger ${x.evtname} depends on ${x.nspname}.${x.proname}(), which the declaration does not have\nDROP EVENT TRIGGER IF EXISTS ${q(x.evtname)};`).join('\n\n')
  return sql.replace(/^(SET local[^\n]*\n)?/, (m: any) => m + '\n' + head + '\n\n')
}

/* the `create extension if not exists …` statements of the data script, run ahead of the diff */
export async function ensureExtensions(db: any, data: any) {
  for (const m of String(data || '').matchAll(/^\s*create extension if not exists [^;]+;/gim)) { try { await db.query(m[0]) } catch (e) { /* a plain Postgres without the extension: the diff will say */ } }
}

/*
 * ---- a module that is off keeps its tables ----
 *
 * Of what the diff would do to a table the kit declares and this site's declaration does not (a module of its that is
 * off), only a dropped rule and a dropped trigger stand: the table, its keys and indexes, the sequences it owns, the
 * types its columns use, its grants and comments are left as they are, so switching the module back on finds every
 * row and the plan then has nothing to change in them.
 */
export async function keepOffTables(db: any, sql: any, schema: any) {
  if (!sql || !sql.trim()) return { sql, kept: [] }
  const declared = new Set(tablesIn(schema))
  const kit = kitDeclaredTables()
  const present = (await db.query("select tablename from pg_tables where schemaname = 'public'")).rows.map((r: any) => r.tablename)
  const kept = present.filter((t: any) => kit.has(t) && !declared.has(t)).sort()
  if (!kept.length) return { sql, kept }
  const names = new Set(kept)
  const more = await db.query(`
    select indexname as n from pg_indexes where schemaname = 'public' and tablename = any($1)
    union select s.relname from pg_class s join pg_depend d on d.objid = s.oid join pg_class t on t.oid = d.refobjid
     where s.relkind = 'S' and d.deptype in ('a', 'i') and t.relnamespace = 'public'::regnamespace and t.relname = any($1)
    union select distinct b.typname from pg_attribute a join pg_class t on t.oid = a.attrelid join pg_type ty on ty.oid = a.atttypid
      join pg_type b on b.oid = case when ty.typelem <> 0 then ty.typelem else ty.oid end
     where t.relnamespace = 'public'::regnamespace and t.relname = any($1) and b.typnamespace = 'public'::regnamespace`, [kept])
  for (const r of more.rows) names.add(r.n)
  const out = []
  for (const st of statements(sql)) {
    if (/^drop\s+(policy|trigger)\b/i.test(st.text) || /^set\s/i.test(st.text)) { out.push(st.raw); continue }
    const refs = [...st.text.matchAll(/"?public"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1])
    if (refs.some((r) => names.has(r)) && /^(drop\s+(table|index|sequence|type)|alter\s+(table|sequence|type|index|publication)|grant|revoke|comment\s+on)\b/i.test(st.text)) continue
    out.push(st.raw)
  }
  const body = out.filter((x) => !/^set\s/i.test(x))
  return { sql: body.length ? out.join('\n\n') + '\n' : '', kept }
}

/* ---- the whole plan for a target ---- */
export async function computePlan({ root = process.cwd(), target, shadowUrl = process.env.PLATFORMKIT_SHADOW_DB_URL, local, env = process.env }: any = {}) {
  if (shadowUrl && bare(shadowUrl) === bare(target)) throw new Error('plan: PLATFORMKIT_SHADOW_DB_URL is the target itself — the shadow is reset to the declaration, and that would empty the database the plan is for')
  if (shadowUrl && local && bare(shadowUrl) === bare(local) && bare(target) !== bare(local)) throw new Error('plan: PLATFORMKIT_SHADOW_DB_URL is the local stack while the target is not — a shadow is a database kept for nothing else')
  const d = readDeclaration(root)
  const declared = renamesDeclared(d.schema)
  const renames = await withDb(target, (db: any) => renamesFor(db, declared))
  /* an extension is a row of the data script, which runs after the diff — but an index or a constraint the declaration
     builds on one (btree_gist under an exclusion constraint) needs it on the target before the diff is computed, or the
     diff refuses the constraint as depending on nothing. So the extensions the data script names are made first: each
     statement is idempotent, and an extension is never dropped here. */
  await withDb(target, (db: any) => ensureExtensions(db, d.data))
  const diff = await diffAgainst(root, target, d.schema, shadowUrl)
  /* an event trigger lives in no schema, so the diff never sees it; one that depends on a function the diff drops
     would stop the drop — it is dropped first, and named in the plan */
  diff.sql = await withDb(target, (db: any) => withEventTriggers(db, diff.sql))
  /* a module that is off keeps its tables: the diff's drops of them, and of what is theirs, are taken out */
  const off = await withDb(target, (db: any) => keepOffTables(db, diff.sql, d.schema))
  diff.sql = off.sql
  /* a diff reads committed state: with renames pending, what it says of the renamed objects is a drop and a create,
     so those statements are set aside here and the apply computes the diff again once the renames are in */
  let setAside: any = []
  if (renames.sql) {
    const names = new Set(renames.renamed)
    const cols = renames.renamedCol || []
    /* a renamed TABLE is recognised by its name; a renamed COLUMN by its table AND either of its
       two names, since the table itself is unchanged and would otherwise match nothing */
    const touchesCol = (t: any) => cols.some((c: any) => new RegExp('"' + c.table + '"').test(t)
      && (new RegExp('"' + c.old + '"').test(t) || new RegExp('"' + c.name + '"').test(t)))
    const mentions = (t: any) => [...t.matchAll(/"?(\w+)"?\.\s*"?(\w+)"?/g)].some((m) => names.has(m[2])) || [...t.matchAll(/\b(\w+)_(pkey|idx|key|fkey|seq|id_seq)\b/g)].some((m) => names.has(m[1])) || touchesCol(t)
    const keep: any = []
    for (const st of statements(diff.sql)) (mentions(st.text) ? setAside : keep).push(st.raw)
    diff.sql = keep.filter((x: any) => !/^set\s+local/i.test(x)).length ? keep.join('\n\n') + '\n' : ''
  }
  const parts = { renames: renames.sql, diff: diff.sql, data: d.data }
  /* what the target computes for itself, and what each destructive statement would cost it — both
     read in ONE connection, since the second question is only worth asking about the first's hits */
  const sql = [parts.renames, parts.diff, parts.data].filter(Boolean).join('\n\n')
  const commit = commitOf(root, env)
  const { generated, costs } = await withDb(target, async (db: any) => {
    const generated = await generatedIn(db)
    const costs = await costsIn(db, destructiveIn(sql, { generated }))
    return { generated, costs }
  })
  const verdict = guard(sql, env, { generated, costs, commit })
  return { parts, notes: renames.notes, setAside, left: diff.left, kept: off.kept, verdict, empty: !parts.renames && !parts.diff, files: d.files.map((f) => path.relative(root, f)), _: { root, shadowUrl, schema: d.schema, env } }
}

/* apply: each part in its own transaction, in order */
export async function applyPlan(plan: any, target: any, log = console.log) {
  if (!plan.verdict.ok) throw new Error('plan: refused — ' + plan.verdict.refused.length + ' destructive statement(s) that would lose data, unallowed (PLATFORMKIT_ALLOW_DESTRUCTIVE=' + plan.verdict.digest + ')')
  const part = async (db: any, name: any, text: any) => {
    if (!text || !text.trim()) { log(`  ${name}: nothing`); return }
    await db.query('begin')
    try { await db.query(text); await db.query('commit') } catch (e: any) { await db.query('rollback'); throw new Error(`plan: the ${name} part failed and was rolled back — ${e.message}`) }
    log(`  ${name}: applied (${statements(text).length} statement(s))`)
  }
  await withDb(target, async (db: any) => {
    let diff = plan.parts.diff
    if (plan.parts.renames) {
      await part(db, 'renames', plan.parts.renames)
      /* the diff again, over the renamed objects, and the guard again over what it now says */
      const again = await diffAgainst(plan._.root, target, plan._.schema, plan._.shadowUrl)
      again.sql = (await keepOffTables(db, again.sql, plan._.schema)).sql
      const v = guard(again.sql, plan._.env)
      if (!v.ok) throw new Error('plan: the diff over the renamed objects holds a destructive statement — refused; the renames stand (they lose nothing and are the declaration\'s), nothing else applied:\n' + describeHits(v.hits))
      if (v.hits.length) log('  ! allowed by PLATFORMKIT_ALLOW_DESTRUCTIVE=1 after the renames:\n' + describeHits(v.hits))
      diff = again.sql
      if (diff) log('  the diff after the renames:\n' + diff.trim().split('\n').map((l: any) => '    ' + l).join('\n'))
    }
    await part(db, 'diff', diff)
    /* a settling pass: a privilege a statement of the diff undid on the way (a table-wide REVOKE takes the column
       grants applied beside it with it; a function's default grants) shows up in the diff computed again, and is
       applied — grants alone, never a structural statement (one would mean the shadow and the target disagree) */
    if (diff && diff.trim()) {
      const settle = await diffAgainst(plan._.root, target, plan._.schema, plan._.shadowUrl)
      settle.sql = (await keepOffTables(db, settle.sql, plan._.schema)).sql
      const rest = statements(settle.sql || '').map((x: any) => x.raw).filter((x: any) => x.trim())
      if (rest.length) {
        if (rest.some((x: any) => !/^\s*(GRANT|REVOKE)\b/i.test(x))) log('  ! the diff after applying still holds statements that are not grants — left for the next plan:\n' + rest.filter((x: any) => !/^\s*(GRANT|REVOKE)\b/i.test(x)).map((x: any) => '    ' + x.split('\n')[0]).join('\n'))
        const grants = rest.filter((x: any) => /^\s*(GRANT|REVOKE)\b/i.test(x)).join('\n')
        if (grants) await part(db, 'grants (settling)', grants)
      }
    }
    await part(db, 'data', plan.parts.data)
  })
}

/*
 * THE PLAN AS TEXT FOR A LOG.
 *
 * Summarised unless asked, because the whole of it is unreadable where it matters most. This
 * declaration holds three hundred functions and pg-delta re-emits one whenever its body differs by
 * a space — which, since the migrations were reformatted into a declaration, is nearly all of them.
 * So an ordinary no-change deploy printed thousands of lines of idempotent CREATE OR REPLACE, in
 * one burst, and a deploy host drops a burst: the failure that followed it was never readable.
 *
 * WHAT A SUMMARY MAY NEVER LEAVE OUT is the part somebody has to act on. Every destructive
 * statement is printed in full, named with its object, refused or allowed, exactly as before — the
 * deploy spec requires it and it is the one thing a person reads a plan for. The renames are few
 * and structural and are printed too. What is summarised is the body of the diff: how many
 * statements, over how many objects, of what kinds.
 */
export function printPlan(plan: any, target: any, log = console.log, { verbose = VERBOSE } = {}) {
  log(`plan for ${bare(target)} from ${plan.files.length} schema file(s)${process.env.PLATFORMKIT_SHADOW_DB_URL ? ' through the shadow database' : " through the CLI's shadow"}:`)
  for (const n of plan.notes) log('  rename ' + n)
  if (plan.parts.renames) log('\n-- 1. renames\n' + plan.parts.renames)
  if (!plan.parts.diff) log('\n-- 2. the diff: nothing — the database matches the declaration')
  else if (verbose) log('\n-- 2. the diff\n' + plan.parts.diff.trim())
  else {
    const sum = summarise(plan.parts.diff)
    log(`\n-- 2. the diff: ${sum.n} statement(s) over ${sum.objects} object(s)`)
    for (const line of sum.lines) log('--   ' + line)
    log('--   (PLATFORMKIT_VERBOSE=1 prints it whole; so does platformkit migrate --plan)')
  }
  if (plan.kept && plan.kept.length) log(`\n-- kept: ${plan.kept.length} table(s) of a module that is off, rows and all (${some(plan.kept, 8, verbose).join(', ')}) — switching it back on finds them; \`platformkit module drop <key>\` removes them`)
  if (plan.setAside.length) log(`\n-- set aside until the renames are in (${plan.setAside.length} statement(s) on the renamed objects; the apply computes the diff again over them):\n` + some(plan.setAside.map((x: any) => '--   ' + x.split('\n')[0]), 8, verbose).join('\n'))
  if (plan.left.length) log(`\n-- left to the platform (${plan.left.length} statement(s) on a schema itself, or in auth/storage but not a policy or trigger):\n` + some(plan.left.map((s: any) => '--   ' + s.split('\n')[0]), 8, verbose).join('\n'))
  log(`\n-- 3. the data script: ${statements(plan.parts.data).length} statement(s), idempotent`)
  /*
   * THE VERDICT, AND THE LINE TO PASTE. What a person does next is set one variable, so the value to
   * set is printed with the refusal rather than described in a document — and last, because a deploy
   * host drops the end of a long log and this is the part that must survive.
   */
  const { hits, ok, refused, free, digest, allowance } = plan.verdict
  if (!hits.length) log('\n✔ nothing destructive')
  else {
    if (free.length) log(`\n✔ ${free.length} destructive statement(s) would lose nothing and are applied:\n` + describeHits(free))
    if (allowance.kind === 'blanket') log('\n! PLATFORMKIT_ALLOW_DESTRUCTIVE=1 — a STANDING permission, not consent for this plan.'
      + `\n  To allow only what is here, and nothing a later deploy brings: PLATFORMKIT_ALLOW_DESTRUCTIVE=${digest}`)
    if (allowance.kind === 'stale') log(`\n! PLATFORMKIT_ALLOW_DESTRUCTIVE names "${allowance.named}", which is neither this plan (${digest}) nor the commit being deployed — ignored.`)
    const at_risk = hits.filter((h: any) => h.loses !== 'nothing')
    if (at_risk.length && ok) log(`\n! ALLOWED by PLATFORMKIT_ALLOW_DESTRUCTIVE (${allowance.kind}) — ${at_risk.length} statement(s) that would lose data:\n` + describeHits(at_risk))
    if (refused.length) log(`\n✖ REFUSED — ${refused.length} destructive statement(s) would lose data:\n` + describeHits(refused)
      + `\n\n  To allow exactly these, and nothing a later deploy brings:\n    PLATFORMKIT_ALLOW_DESTRUCTIVE=${digest}`)
  }
  return ok
}

/*
 * WHAT A DIFF IS, IN COUNTS. A statement's kind is its verb and the thing the verb takes (`create
 * function`, `alter table`, `grant`), and its object the first name in it — crude on purpose,
 * since this is a log summary and not a parser: what it is for is telling a deploy that re-declares
 * three hundred functions apart from one that drops a table, at a glance, before anybody scrolls.
 */
export function summarise(sql: any) {
  const st = statements(sql || '')
  const kinds = new Map()
  const objects = new Set<string>()
  for (const { text } of st) {
    const t = String(text).replace(/\s+/g, ' ').trim()
    const m = /^(create(?: or replace)?|alter|drop|comment on|grant|revoke|truncate|do|set|insert|update|delete|select)\s*(table|view|materialized view|function|procedure|trigger|policy|index|type|schema|sequence|extension|publication|domain|aggregate)?\b/i.exec(t)
    const verb = m ? m[1].toLowerCase().replace(' or replace', '') : 'other'
    const noun = m && m[2] ? m[2].toLowerCase() : ''
    const kind = noun ? verb + ' ' + noun : verb
    kinds.set(kind, (kinds.get(kind) || 0) + 1)
    /* the first dotted or quoted name after the verb, which is the object for all but a grant */
    const n = /(?:"[^"]+"|[a-z_][a-z0-9_]*)\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_]*)/i.exec(t.slice(m ? m[0].length : 0))
    if (n) objects.add(n[0].replace(/["\s]/g, '').toLowerCase())
  }
  const lines = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(4)}  ${k}`)
  return { n: st.length, objects: objects.size, kinds, lines }
}

/* ---- the command ---- */
if (isMain(import.meta.url)) {
  process.on('uncaughtException', (e) => { console.error('✖ ' + (e.message || e)); process.exit(1) })
  process.on('unhandledRejection', (e: any) => { console.error('✖ ' + (e.message || e)); process.exit(1) })
  const args = process.argv.slice(2)
  const only = args.includes('--plan'), linked = args.includes('--linked'), json = args.includes('--json')
  const root = process.cwd()
  const local = localUrlSafe(root)
  const target = linked ? process.env.SUPABASE_DB_URL : local
  if (linked && !target) throw new Error('plan: --linked needs SUPABASE_DB_URL, the production connection (a pooler url)')
  if (!linked && !target) throw new Error('plan: the local stack is not up — platformkit dev, or supabase start')
  const plan = await computePlan({ root, target, local })
  if (json) { console.log(JSON.stringify(plan, null, 2)); process.exit(plan.verdict.ok ? 0 : 1) }
  /* a person who typed --plan typed it to SEE the plan: whole, without being asked twice */
  const ok = printPlan(plan, target, console.log, { verbose: only || undefined })
  if (only || plan.empty && !plan.parts.data) process.exit(ok ? 0 : 1)
  if (!ok) process.exit(1)
  if (linked && !args.includes('--apply')) { console.log('\n(--linked applies only with --apply; the deploy does)'); process.exit(0) }
  console.log('\napplying:')
  await applyPlan(plan, target)
  console.log('✔ the database is at the declaration')
}
function localUrlSafe(root: any) { try { return localUrl(root) } catch { return null } }
