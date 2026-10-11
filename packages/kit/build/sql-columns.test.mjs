/* A SQL FUNCTION MAY NOT NAME A COLUMN ITS TABLE DOES NOT DECLARE.
   The kit's schemas and the site's together are one declaration — a site's SQL reads the kit's
   tables by column name, which makes the kit's column names an API across the package boundary —
   so both are read, and a reference in either is checked against the whole.
   Run by npm test. SQL_COLUMNS=0 skips it. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkColumns, declaredColumns, referencesOf, aliasBindings, functionsOf, triggersOf } from './sql-columns.mjs'

const note = (m) => console.log('sql-columns: ' + m)
if (process.env.SQL_COLUMNS === '0') { note('skipped (SQL_COLUMNS=0)'); process.exit(0) }

const KIT = fileURLToPath(new URL('../supabase/schemas/', import.meta.url))
const SITE = path.join(process.cwd(), 'db', 'schemas')
let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }

const read = (dir, label) => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .map((f) => ({ file: `${label}/${f}`, sql: fs.readFileSync(path.join(dir, f), 'utf8') }))
  : []

/* ---- the parser itself, on text whose answer is known ---------------------------------------- */
{
  const files = [{ file: 't.sql', sql: `
CREATE TABLE IF NOT EXISTS "public"."widgets" (
    "id" "uuid" NOT NULL,
    -- a comment naming a column that does not exist: ghost
    "supplier" "text",
    "note" "text" DEFAULT 'it''s, with a comma'::"text",
    CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")
);
ALTER TABLE ONLY "public"."widgets" ADD COLUMN IF NOT EXISTS "added_later" integer;
CREATE OR REPLACE FUNCTION "public"."good"() RETURNS "trigger" AS $$
begin
  if new.supplier is null then new.added_later := 1; end if;
  return new;
end; $$;
CREATE OR REPLACE FUNCTION "public"."bad"() RETURNS "trigger" AS $$
begin return new.printer; end; $$;
CREATE TRIGGER "t1" BEFORE INSERT ON "public"."widgets"
  FOR EACH ROW EXECUTE FUNCTION "public"."good"();
CREATE TRIGGER "t2" BEFORE INSERT ON "public"."widgets"
  FOR EACH ROW EXECUTE FUNCTION "public"."bad"();
` }]
  const cols = declaredColumns(files)
  ok('a table\'s columns are read from its CREATE TABLE', cols.get('widgets')?.has('supplier'))
  ok('a comment inside the column list is not a column', !cols.get('widgets')?.has('ghost'))
  ok('a quoted literal holding a comma does not split a definition', cols.get('widgets')?.has('note'))
  ok('a table constraint is not a column', !cols.get('widgets')?.has('constraint'))
  ok('ADD COLUMN is part of the declaration', cols.get('widgets')?.has('added_later'))

  const got = checkColumns(files)
  ok('a trigger reading a column that does not exist is caught', got.problems.some((p) => p.fn === 'bad' && p.col === 'printer'))
  ok('a trigger reading columns that do exist is not blamed', !got.problems.some((p) => p.fn === 'good'))
  ok('the trigger is mapped to its table', triggersOf(files).get('bad')?.has('widgets'))
}
{
  const b = aliasBindings('select e.type from public.events e join public.purchases as p on p.id = e.id, (select 1) z')
  ok('FROM binds an alias', b.get('e') === 'events')
  ok('JOIN ... AS binds an alias', b.get('p') === 'purchases')
  ok('a subquery alias binds to nothing', !b.get('z'))
}
{
  /* a function attached to no trigger: NEW cannot be resolved, so it is counted and never blamed */
  const files = [{ file: 't.sql', sql: `
CREATE TABLE IF NOT EXISTS "public"."t" ("id" "uuid");
CREATE OR REPLACE FUNCTION "public"."loose"() RETURNS "trigger" AS $$ begin return new.whatever; end; $$;
` }]
  const got = checkColumns(files)
  ok('an unattached trigger function is counted, not blamed', got.problems.length === 0 && got.unchecked > 0)
}
{
  /* the insert and update forms */
  const files = [{ file: 't.sql', sql: `
CREATE TABLE IF NOT EXISTS "public"."t" ("id" "uuid", "good" "text");
CREATE OR REPLACE FUNCTION "public"."f"() RETURNS void AS $$
begin
  insert into public.t (id, nope) values (1, 2);
  update public.t set good = 1, alsonope = 2 where id = 1;
end; $$;
` }]
  const got = checkColumns(files)
  ok('an INSERT column list is checked', got.problems.some((p) => p.col === 'nope' && p.kind === 'insert'))
  ok('an UPDATE SET target is checked', got.problems.some((p) => p.col === 'alsonope' && p.kind === 'update'))
  ok('the columns that do exist are not blamed', !got.problems.some((p) => p.col === 'good' || p.col === 'id'))
}

/* ---- and the real declaration ---------------------------------------------------------------- */
const files = [...read(KIT, 'kit'), ...read(SITE, 'site')]
ok('there is a declaration to read', files.length > 0)
const got = checkColumns(files)
ok(`${got.tables} tables, ${got.checked} column references checked`, got.checked > 500)
if (got.problems.length) {
  for (const p of got.problems.slice(0, 40)) {
    console.log(`  FAIL  ${p.file}:${p.line} ${p.fn}() names ${p.kind === 'alias' ? '' : p.kind + '.'}${p.col}, which ${p.tables.join(' / ')} does not declare`)
  }
  fail += got.problems.length
} else pass++
note(`${got.checked} references checked, ${got.unchecked} it could not bind and did not guess`)
note(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
