/* The declaration's loop, end to end, on a database of its own: a scratch project holding a copy of the kit's
   declaration and a site file, its database a Supabase-shaped container the CLI starts for it (never the
   site's stack), the shadow the CLI's own. A fresh database is brought up by the plan; a column added is the
   plan's one statement; a site table with a foreign key to a kit table and a policy on is_admin() lands; a
   table renamed by annotation keeps its rows and its _pkey, and the same declaration converges from a fresh
   database, from one renamed already and from one two names behind; both names present refuses; a column
   removed is refused, then allowed with PLATFORMKIT_ALLOW_DESTRUCTIVE=1; the data script changed runs twice.
   Run by npm test when Docker is up; skipped with a note otherwise (SCHEMA_TEST=0 skips it too). */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { computePlan, applyPlan } from './plan.mjs'

const KIT = fileURLToPath(new URL('../supabase/', import.meta.url))
const ROOT = process.cwd()
const SCR = path.join(ROOT, 'node_modules', '.cache', 'platformkit', 'schema-test')
/* RESERVED: this scratch project binds PORT and PORT-1 for the length of the run, so 54381 and
   54382 are not available to a site's own base (data.ports in platformkit.config.js). A site given
   54380 took them and the whole suite went red on "port is already allocated". */
const PORT = 54382
const TARGET = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable`
const note = (m) => console.log('schema: ' + m)
if (process.env.SCHEMA_TEST === '0') { note('skipped (SCHEMA_TEST=0)'); process.exit(0) }
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) { note('skipped — Docker is not running, and the plan needs a shadow'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }
/* --workdir names the scratch project outright: the CLI walks past a node_modules directory when it looks for one, and
   from the scratch's cwd alone it would find — and stop, and start — the site's own stack */
const sb = (args, opts = {}) => spawnSync('npx', ['supabase', '--workdir', SCR, ...args], { cwd: SCR, encoding: 'utf8', env: process.env, ...opts })
let db = new pg.Client({ connectionString: TARGET })
const rows = async (s, p = []) => (await db.query(s, p)).rows
const plan = (env = {}) => computePlan({ root: SCR, target: TARGET, shadowUrl: null, env: { ...process.env, PLATFORMKIT_ALLOW_DESTRUCTIVE: '', ...env } })
const apply = async (env) => { const p = await plan(env); await applyPlan(p, TARGET, () => {}); return p }
const diffOf = (p) => p.parts.diff.replace(/^SET local[^\n]*\n/m, '').trim()
const site = (name, text) => { const d = path.join(SCR, 'supabase', 'schemas', 'site'); fs.mkdirSync(d, { recursive: true }); if (text == null) fs.rmSync(path.join(d, name), { force: true }); else fs.writeFileSync(path.join(d, name), text) }
const kitFile = (name, fn) => { const f = path.join(SCR, 'supabase', 'schemas', name); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))) }

/* ---- the scratch project: the kit's declaration copied, no migrations, a database of its own ---- */
fs.rmSync(SCR, { recursive: true, force: true })
fs.mkdirSync(path.join(SCR, 'supabase', 'migrations'), { recursive: true })
fs.cpSync(path.join(KIT, 'schemas'), path.join(SCR, 'supabase', 'schemas'), { recursive: true })
fs.copyFileSync(path.join(KIT, 'data.sql'), path.join(SCR, 'supabase', 'data.sql'))
const major = (/major_version\s*=\s*(\d+)/.exec(fs.existsSync(path.join(ROOT, 'supabase', 'config.toml')) ? fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8') : '') || [])[1] || '17'
fs.writeFileSync(path.join(SCR, 'supabase', 'config.toml'), `project_id = "pk-schema-test"\n[db]\nport = ${PORT}\nshadow_port = ${PORT - 1}\nmajor_version = ${major}\n[db.seed]\nenabled = true\nsql_paths = ["./schemas/*.sql", "./schemas/site/*.sql", "./data.sql"]\n`)
sb(['stop', '--no-backup'], { stdio: 'ignore' })
const started = sb(['db', 'start'])
if (started.status !== 0) { console.log(started.stdout, started.stderr); console.log('schema: the scratch database did not start'); process.exit(1) }
const SITE = `SET check_function_bodies = false;
CREATE TABLE IF NOT EXISTS "public"."site_notes" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "user_id" "uuid" REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
    "body" "text" NOT NULL,
    "made_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
CREATE INDEX "site_notes_user_id_idx" ON "public"."site_notes" ("user_id");
ALTER TABLE "public"."site_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_notes_admin" ON "public"."site_notes" USING ("public"."is_admin"());
`
/* the container answers, and keeps answering, before anything is asked of it (db start returns while it settles) */
/* a reset by url of the project's own database restarts its container: the client is closed round it */
const reset = async () => { await db.end(); const r = sb(['db', 'reset', '--db-url', TARGET, '--yes']); await settled(); db = new pg.Client({ connectionString: TARGET }); await db.connect(); return r }
const settled = async () => { for (let i = 0, good = 0; i < 120 && good < 3; i++) { try { const c = new pg.Client({ connectionString: TARGET }); await c.connect(); await c.query('select 1'); await c.end(); good++ } catch { good = 0 } await new Promise((r) => setTimeout(r, 500)) } }
await settled()
/* db start seeds the declaration in; a fresh database is one the reset emptied and seeded nothing into */
const emptied = sb(['db', 'reset', '--db-url', TARGET, '--no-seed', '--yes'])
if (emptied.status !== 0) { console.log(emptied.stdout, emptied.stderr); console.log('schema: the scratch database could not be emptied'); process.exit(1) }
try {
  await db.connect()
  ok('an emptied database holds none of the kit', (await rows("select count(*)::int as n from pg_tables where schemaname = 'public'"))[0].n === 0)
  /* 1. a fresh database: the plan creates the whole declaration; then it is empty */
  let p = await apply()
  ok('a fresh database: the plan creates', diffOf(p).length > 1000 && /CREATE TABLE/.test(p.parts.diff) && p.verdict.ok)
  ok('the kit\'s tables are there', (await rows("select count(*)::int as n from pg_tables where schemaname = 'public'"))[0].n >= 26)
  const storagePolicies = new Set((await rows("select policyname from pg_policies where schemaname = 'storage'")).map((row) => row.policyname))
  const requiredStoragePolicies = [
    'social_media_publisher_read',
    'social_media_publisher_insert',
    'social_media_publisher_update',
    'social_media_publisher_delete',
  ]
  const authTriggers = await rows("select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and not t.tgisinternal")
  ok('the Social storage policies and auth trigger are there',
    requiredStoragePolicies.every((name) => storagePolicies.has(name))
      && authTriggers.some((trigger) => trigger.tgname === 'trg_on_auth_user_created'))
  const bucketIds = new Set((await rows('select id from storage.buckets')).map((row) => row.id))
  const requiredBuckets = ['audio', 'models', 'chat', 'spaces', 'print', 'support', 'social', 'forms', 'avatars', 'recordings', 'content-assets']
  ok('the data landed: required buckets are present', requiredBuckets.every((id) => bucketIds.has(id)))
  /* the platform's default privileges grant every new function to anon and authenticated as it is made, after the
     diff's revokes were computed against nothing: the apply's settling pass holds those revokes alone (grants and
     revokes, never a structural statement) and applies them in the same run, so the plan after is empty at once */
  p = await plan()
  if (!p.empty) console.log('    the plan after one apply still holds:\n' + diffOf(p).split('\n').slice(0, 12).map((l) => '      ' + l).join('\n'))
  ok('after one apply the plan is empty: the settling pass took the revokes the default privileges undid', p.empty && p.verdict.ok)
  /* 2. a kit change: a column added is the plan's one statement */
  kitFile('20-instrument.sql', (s) => s.replace('CREATE TABLE IF NOT EXISTS "public"."signals" (', 'CREATE TABLE IF NOT EXISTS "public"."signals" (\n    "scratch_note" "text",'))
  p = await plan()
  ok('a column added: the plan holds it', /ADD COLUMN "scratch_note" text/.test(p.parts.diff) && diffOf(p).split(';').filter((x) => x.trim()).length === 1)
  await applyPlan(p, TARGET, () => {})
  ok('applied, the plan is empty', (await plan()).empty)
  /* 3. a site's own table with a foreign key to a kit table and a policy on is_admin() */
  site('10-notes.sql', SITE)
  p = await plan()
  ok('a site table: the plan holds it', /CREATE TABLE "public"."site_notes"/.test(p.parts.diff) && /is_admin/.test(p.parts.diff) && p.verdict.ok)
  await applyPlan(p, TARGET, () => {})
  ok('applied: the table, its key and its policy', (await rows("select count(*)::int as n from pg_policies where tablename = 'site_notes'"))[0].n === 1)
  ok('the plan is empty after', (await plan()).empty)
  /* a reset from the declaration lands on the same state */
  const r = await reset()
  ok('a reset from the declaration', r.status === 0 && (await rows("select count(*)::int as n from pg_tables where tablename = 'site_notes'"))[0].n === 1)
  ok('and the plan is empty after it', (await plan()).empty)
  /* 4. a rename by annotation keeps the rows and the objects named after the table */
  await db.query("insert into public.site_notes (body) values ('one'), ('two'), ('three')")
  site('10-notes.sql', SITE.replace(/site_notes/g, 'site_memos').replace('CREATE TABLE IF NOT EXISTS "public"."site_memos" (', 'CREATE TABLE IF NOT EXISTS "public"."site_memos" ( -- renamed from: site_notes'))
  p = await plan()
  ok('a rename: the plan renames the table', /ALTER TABLE "public"."site_notes" RENAME TO "site_memos"/.test(p.parts.renames))
  ok('… and its key, its index and its sequence', /RENAME CONSTRAINT "site_notes_pkey"|ALTER INDEX "public"."site_notes_pkey"/.test(p.parts.renames) && /"site_notes_user_id_idx" RENAME TO "site_memos_user_id_idx"/.test(p.parts.renames) && /ALTER SEQUENCE "public"."site_notes_id_seq"/.test(p.parts.renames))
  ok('… nothing destructive, and the old table\'s drop set aside', p.verdict.ok && !/DROP TABLE/.test(p.parts.diff) && p.setAside.some((x) => /DROP TABLE "public"."site_notes"/.test(x)))
  await applyPlan(p, TARGET, () => {})
  ok('the rows are there under the new name', (await rows('select count(*)::int as n from public.site_memos'))[0].n === 3)
  ok('the policy came along and the plan is empty', (await rows("select count(*)::int as n from pg_policies where tablename = 'site_memos'"))[0].n === 1 && (await plan()).empty)
  /* the rename converges: two names behind, and a fresh database */
  await db.query('alter table public.site_memos rename to site_scribbles; alter index public.site_memos_user_id_idx rename to site_scribbles_user_id_idx')
  site('10-notes.sql', fs.readFileSync(path.join(SCR, 'supabase', 'schemas', 'site', '10-notes.sql'), 'utf8').replace('-- renamed from: site_notes', '-- renamed from: site_notes, site_scribbles'))
  p = await plan()
  ok('two names behind: renamed from the one it finds', /"site_scribbles" RENAME TO "site_memos"/.test(p.parts.renames))
  await applyPlan(p, TARGET, () => {})
  ok('… converged, rows kept', (await plan()).empty && (await rows('select count(*)::int as n from public.site_memos'))[0].n === 3)
  /* both names present: refused */
  await db.query('create table public.site_notes (id int)')
  let refused = null
  try { await plan() } catch (e) { refused = e.message }
  ok('both names present: refused, naming them', /site_notes/.test(refused || '') && /site_memos/.test(refused || ''))
  await db.query('drop table public.site_notes')
  /*
   * 5. A COLUMN REMOVED — and what it holds decides whether anybody has to say yes.
   *
   * The guard asks the target what each destructive statement would cost before it judges it, so the
   * two halves are different cases and both are here: a column no row has ever written to loses
   * nothing and is applied with no consent asked for, exactly as a generated column is; a column
   * with a value in it refuses, says how many values, and takes the plan's own digest as consent.
   */
  /* 5a. nothing in it: applied, with the count said out loud and nobody asked */
  kitFile('20-instrument.sql', (s) => s.replace('\n    "scratch_note" "text",', ''))
  p = await plan()
  ok('a column no row has written to: nothing to lose', p.verdict.ok && p.verdict.free.length === 1
    && p.verdict.free[0].object === 'public.signals.scratch_note' && p.verdict.free[0].cost.kept === 0)
  await applyPlan(p, TARGET, () => {})
  ok('… applied with no consent asked for',
    (await rows("select count(*)::int as n from information_schema.columns where table_name = 'signals' and column_name = 'scratch_note'"))[0].n === 0)

  /* 5b. a value in it: refused with what it would cost, then allowed by this plan's digest alone.
     The site's own table is used, because it has rows in it (three, from the rename above). */
  const NOTES = () => fs.readFileSync(path.join(SCR, 'supabase', 'schemas', 'site', '10-notes.sql'), 'utf8')
  site('10-notes.sql', NOTES().replace('"body" "text" NOT NULL,', '"body" "text" NOT NULL,\n    "keepsake" "text",'))
  await apply()
  await db.query("update public.site_memos set keepsake = 'kept' where id = (select min(id) from public.site_memos)")
  site('10-notes.sql', NOTES().replace('\n    "keepsake" "text",', ''))
  p = await plan()
  ok('a column with a value in it: refused', !p.verdict.ok && p.verdict.refused.length === 1
    && p.verdict.refused[0].object === 'public.site_memos.keepsake')
  ok('… and the refusal counted the rows and the values', p.verdict.refused[0].cost.rows === 3 && p.verdict.refused[0].cost.kept === 1)
  let threw = false
  try { await applyPlan(p, TARGET, () => {}) } catch { threw = true }
  ok('… and nothing applied', threw
    && (await rows("select count(*)::int as n from information_schema.columns where table_name = 'site_memos' and column_name = 'keepsake'"))[0].n === 1)
  ok('an allowance naming another plan allows nothing',
    (await plan({ PLATFORMKIT_ALLOW_DESTRUCTIVE: 'deadbeef' })).verdict.ok === false)
  const d8 = p.verdict.digest
  p = await apply({ PLATFORMKIT_ALLOW_DESTRUCTIVE: d8 })
  ok("allowed by this plan's own digest", p.verdict.allowance.kind === 'digest'
    && (await rows("select count(*)::int as n from information_schema.columns where table_name = 'site_memos' and column_name = 'keepsake'"))[0].n === 0)
  /* and the blanket permission still works, for the case it is kept for */
  ok('the blanket permission is still a way through',
    (await plan({ PLATFORMKIT_ALLOW_DESTRUCTIVE: '1' })).verdict.allowance.kind === 'blanket')

  /* 6. the data script changed: a bucket added, the script twice without error */
  fs.appendFileSync(path.join(SCR, 'supabase', 'data.sql'), "\ninsert into storage.buckets (id, name, public) values ('scratch', 'scratch', false) on conflict (id) do nothing;\n")
  await apply(); await apply()
  ok('the data script twice: the bucket once and no hand-maintained cron jobs',
    (await rows("select count(*)::int as n from storage.buckets where id = 'scratch'"))[0].n === 1
      && (await rows('select count(*)::int as n from cron.job'))[0].n === 0)
  /* a fresh database again meets the renamed table by its current name alone */
  const r2 = await reset()
  ok('a fresh database: the current name alone, the plan empty', r2.status === 0 && (await rows("select count(*)::int as n from pg_tables where tablename = 'site_memos'"))[0].n === 1 && (await plan()).empty)
} finally {
  try { await db.end() } catch {}
  sb(['stop', '--no-backup'], { stdio: 'ignore' })
}
console.log(`schema: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
