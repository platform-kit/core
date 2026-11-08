#!/usr/bin/env node
/*
 * THE KIT'S DATABASE AS TYPES (openspec: typescript-throughout).
 *
 * supabase/functions/_shared/database.types.ts is generated, never written: a throwaway Postgres (the Supabase image,
 * in Docker, removed afterwards) is given every kit schema file with every module on, and Supabase's own generator
 * (postgres-meta, the one `supabase gen types` runs) writes the types from it. No stack is involved, so it is the
 * same whichever site is at hand, and it holds every table a module could put there.
 *
 * Two rules are added to what the generator writes. An argument of a database function may be null: Postgres passes
 * null to any argument of a function that is not STRICT, the kit declares none STRICT, and its callers pass null on
 * purpose, while the generator types every argument as required-or-undefined. And a column a trigger fills before the
 * row is written is optional to insert (FILLED_ON_INSERT): the generator sees only NOT NULL with no default.
 *
 *   platformkit db-types           write the file
 *   platformkit db-types --check   fail when the file is not what the schema gives (the end-to-end run's E2E_ALSO)
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isMain } from './is-main.mjs'

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(KIT, 'supabase', 'functions', '_shared', 'database.types.ts')
/* pinned, so the same schema always gives the same file */
const PG_IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.006'
const META_IMAGE = 'public.ecr.aws/supabase/postgres-meta:v0.99.0'

/* what the platform provides, only as far as the kit's schema names it: this database exists to be read, not used */
const PLATFORM = `
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz);
create or replace function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;
create or replace function storage.filename(text) returns text language sql as $$ select $1 $$;
create schema if not exists realtime;
create table if not exists realtime.messages (id uuid default gen_random_uuid(), topic text, extension text, payload jsonb, event text, private boolean default false, inserted_at timestamp default now());
create or replace function realtime.topic() returns text language sql as $$ select ''::text $$;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$ select $$;
create or replace function realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text default 'ROW') returns void language plpgsql as $$ begin end $$;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;
`

const docker = (args: string[], input?: string) => spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 1 << 28 })
const must = (r: ReturnType<typeof docker>, what: string) => {
  if (r.error || r.status !== 0) throw new Error(`db-types: ${what} failed — ${(r.error?.message || r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`)
  return r.stdout
}
/* where a published port answers: this machine, or inside the end-to-end run the daemon's own container */
const HOST = process.env.DOCKER_HOST?.includes('/var/run/platformkit/') ? 'platformkit-docker' : '127.0.0.1'
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* every kit schema file, core and every module, then the glue between them, in the order assemble uses */
async function schemaSql(): Promise<string> {
  const { backendFor } = await import('./modules/backend.mjs')
  const { moduleSet } = await import('./steps.mjs')
  const modules = await moduleSet({ modules: {} })
  const on = Object.fromEntries([...modules.keys()].map((k) => [k, true]))
  const b = backendFor(modules, on, path.join(KIT, 'supabase'))
  const files = [...b.schema.map((f) => path.join(KIT, 'supabase', 'schemas', f)), ...b.glue.map((f) => path.join(KIT, 'supabase', 'schemas', 'glue', f))]
  return files.map((f) => `\n-- ${path.basename(f)}\n` + fs.readFileSync(f, 'utf8')).join('')
}

/* the columns a BEFORE INSERT trigger sets, which no insert gives: a message's seq is its channel's next (90-spaces.sql) */
export const FILLED_ON_INSERT: Record<string, string[]> = { space_messages: ['seq'] }

/* a database function's arguments, each of which Postgres will take as null */
export function nullableArgs(source: string): string {   /* and FILLED_ON_INSERT, which the same pass applies */
  const ts = createRequire(import.meta.url)('typescript')
  const sf = ts.createSourceFile('database.types.ts', source, ts.ScriptTarget.Latest, true)
  const edits: Array<{ at: number, end: number, text: string }> = []
  const visit = (n: any) => {
    if (ts.isPropertySignature(n) && n.name.getText(sf) === 'Args' && n.type && ts.isTypeLiteralNode(n.type)) {
      for (const m of n.type.members) if (ts.isPropertySignature(m) && m.type && !/\|\s*null$/.test(m.type.getText(sf))) {
        edits.push({ at: m.type.getStart(sf), end: m.type.getEnd(), text: `${m.type.getText(sf)} | null` })
      }
    }
    /* Tables: { <table>: { Insert: { <column>: T } } }: the trigger's column becomes <column>?: T */
    if (ts.isPropertySignature(n) && n.name.getText(sf) === 'Insert' && n.type && ts.isTypeLiteralNode(n.type)) {
      const table = n.parent?.parent?.name?.getText?.(sf)
      for (const m of n.type.members) if (ts.isPropertySignature(m) && !m.questionToken && (FILLED_ON_INSERT[table] || []).includes(m.name.getText(sf))) edits.push({ at: m.name.getEnd(), end: m.name.getEnd(), text: '?' })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  let out = source
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end)
  return out
}

export async function generate(): Promise<string> {
  const id = `pk-db-types-${process.pid}`
  try {
    must(docker(['network', 'create', id]), 'docker network create')
    must(docker(['run', '-d', '--name', `${id}-pg`, '--network', id, '-e', 'POSTGRES_PASSWORD=postgres', PG_IMAGE]), 'starting Postgres')
    /* the image's own init has run once its auth schema answers */
    for (let i = 0; ; i++) {
      if (docker(['exec', `${id}-pg`, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-tAc', 'select count(*) from auth.users']).status === 0) break
      if (i > 60) throw new Error('db-types: Postgres did not come up')
      await pause(1000)
    }
    const psql = (sql: string, what: string) => must(docker(['exec', '-i', `${id}-pg`, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], sql), what)
    psql(PLATFORM, 'the platform schemas')
    psql(await schemaSql(), 'the kit schema')
    must(docker(['run', '-d', '--name', `${id}-meta`, '--network', id, '-p', `${HOST === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0'}::8080`,
      '-e', `PG_META_DB_HOST=${id}-pg`, '-e', 'PG_META_DB_PORT=5432', '-e', 'PG_META_DB_NAME=postgres',
      '-e', 'PG_META_DB_USER=supabase_admin', '-e', 'PG_META_DB_PASSWORD=postgres', META_IMAGE]), 'starting postgres-meta')
    const port = must(docker(['port', `${id}-meta`, '8080/tcp']), 'reading the generator\'s port').trim().split('\n')[0].split(':').pop()
    for (let i = 0; ; i++) {
      try { const r = await fetch(`http://${HOST}:${port}/health`); if (r.ok) break } catch { /* not up yet */ }
      if (i > 60) throw new Error('db-types: postgres-meta did not come up')
      await pause(1000)
    }
    const r = await fetch(`http://${HOST}:${port}/generators/typescript?included_schemas=public&detect_one_to_one_relationships=true`)
    if (!r.ok) throw new Error(`db-types: the generator answered ${r.status}`)
    const head = `/*\n * THE KIT'S DATABASE, AS TYPES — generated by \`platformkit db-types\` (build/db-types.mjs) from every kit schema file\n * with every module on. Never edited by hand: change the schema and run it again.\n */\n`
    return head + nullableArgs(await r.text())
  } finally {
    docker(['rm', '-f', `${id}-meta`, `${id}-pg`])
    docker(['network', 'rm', id])
  }
}

if (isMain(import.meta.url)) {
  const out = await generate()
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (now !== out) { console.error(`✖ db-types: ${path.relative(process.cwd(), OUT)} is not what the schema gives — run platformkit db-types`); process.exit(1) }
    console.log('✔ db-types: the database types are the schema\'s')
  } else {
    fs.writeFileSync(OUT, out)
    console.log(`✔ db-types: wrote ${path.relative(process.cwd(), OUT)}`)
  }
}
