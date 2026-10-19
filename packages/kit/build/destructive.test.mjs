/* The destructive guard's shapes: each caught with its object, the harmless drops passing, a comment or a
   literal holding "drop table" ignored, a dollar-quoted body scanned. Run by npm test. */
import { destructive, guard, statements, digestOf, readAllowance } from './destructive.mjs'

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }
const hit = (sql) => destructive(sql).map((h) => h.kind + ' ' + h.object)

ok('drop table', hit('DROP TABLE "public"."bookings";').join() === 'drop table public.bookings')
ok('drop table if exists', hit('drop table if exists public.bookings cascade;').join() === 'drop table public.bookings')
ok('drop schema', hit('DROP SCHEMA "site" CASCADE;').join() === 'drop schema site')
ok('truncate', hit('truncate table public.events;').join() === 'truncate public.events')
ok('truncate only', hit('TRUNCATE ONLY "public"."events" RESTART IDENTITY;').join() === 'truncate public.events')
ok('a grant that names truncate truncates nothing', hit('GRANT DELETE, SELECT, TRUNCATE ON TABLE "public"."comments" TO "authenticated";').length === 0)
ok('nor does a revoke', hit('REVOKE TRUNCATE ON TABLE public.events FROM anon;').length === 0)
ok('drop column', hit('ALTER TABLE "public"."profiles"\n  DROP COLUMN "scratch_col";').join() === 'drop column public.profiles.scratch_col')
ok('drop column bare', hit('alter table public.profiles drop scratch_col;').join() === 'drop column public.profiles.scratch_col')
ok('drop not null is not a dropped column', hit('ALTER TABLE "public"."content"\n  ALTER COLUMN "text" DROP NOT NULL;').length === 0)
ok('drop default is not a dropped column', hit('alter table public.content alter column pending drop default;').length === 0)
ok('drop column if exists', hit('alter table only public.profiles drop column if exists scratch_col;').join() === 'drop column public.profiles.scratch_col')
ok('type change', hit('ALTER TABLE "public"."answers"\n  ALTER COLUMN "value" SET DATA TYPE integer USING value::integer;').join() === 'type change public.answers.value')
ok('type change short', hit('alter table public.answers alter value type text;').join() === 'type change public.answers.value')
ok('drop constraint passes', hit('alter table public.profiles drop constraint profiles_email_key;').length === 0)
ok('drop policy passes', hit('DROP POLICY "support staff read files" ON "storage"."objects";').length === 0)
ok('drop function passes', hit('drop function if exists public.chat_open(uuid);').length === 0)
ok('drop index passes', hit('drop index if exists public.events_type_idx;').length === 0)
ok('drop trigger passes', hit('drop trigger if exists trg on public.bookings;').length === 0)
ok('drop view passes', hit('drop view public.sessions;').length === 0)
ok('add column passes', hit('alter table public.profiles add column nick text;').length === 0)
ok('set default passes', hit('alter table public.profiles alter column nick set default \'x\';').length === 0)
ok('a comment is ignored', hit('-- drop table public.profiles\nselect 1;').length === 0)
ok('a block comment is ignored', hit('/* drop table public.profiles; */\nselect 1;').length === 0)
ok('a literal is ignored', hit("insert into public.app_settings values ('note', 'drop table public.profiles');").length === 0)
ok('an escaped literal is ignored', hit("select 'it''s a drop table public.x';").length === 0)
ok('a do block is scanned', hit('do $$ begin execute \'x\'; drop table public.old; end $$;').join() === 'drop table public.old')
ok('a tagged body is scanned', hit('create function f() returns void language plpgsql as $fn$ begin truncate public.events; end $fn$;').join() === 'truncate public.events')
ok('several statements, several hits', hit('drop table a; alter table b drop column c; drop policy p on d;').length === 2)
const many = statements('select 1;\n-- x\nselect 2;\nselect $$a;b$$;')
ok('statements split outside bodies', many.length === 3 && many[2].line === 4)
ok('a hit carries its line', destructive('select 1;\n\nDROP TABLE public.old;')[0].line === 3)
ok('guard refuses', guard('drop table public.old;', {}).ok === false)
ok('guard allows with the variable', guard('drop table public.old;', { PLATFORMKIT_ALLOW_DESTRUCTIVE: '1' }).ok === true)
ok('guard passes a clean plan', guard('alter table public.profiles add column nick text;', {}).ok === true)

/* --- a generated column is not data ---
   Its value is a function of its own row, so dropping one loses no more than dropping an index
   does; and postgres cannot alter such a column's expression in place, so CHANGING one is a drop
   and a re-add and nothing else. The guard cannot read that off the SQL, so it is told. */
const FTS = 'public.space_messages.fts'
const changedExpression = `DROP INDEX "public"."space_messages_fts_idx";
ALTER TABLE "public"."space_messages"
  DROP COLUMN "fts";
ALTER TABLE "public"."space_messages"
  ADD COLUMN "fts" tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED;
CREATE INDEX space_messages_fts_idx ON public.space_messages USING gin (fts);`
ok('told nothing, a generated column reads as a column', destructive(changedExpression).length === 1)
ok('told which columns are derived, changing one loses nothing',
  destructive(changedExpression, { generated: [FTS] }).length === 0)
ok('…and the guard lets that plan through without the variable',
  guard(changedExpression, {}, { generated: [FTS] }).ok === true)
ok('a kept column of the same table still stops it',
  destructive('alter table public.space_messages drop column body;', { generated: [FTS] })
    .map((h) => h.kind + ' ' + h.object).join() === 'drop column public.space_messages.body')
ok('a generated column of another table is not this one',
  destructive('alter table public.other drop column fts;', { generated: [FTS] }).length === 1)
ok('the names are compared without regard to case',
  destructive('ALTER TABLE PUBLIC.SPACE_MESSAGES DROP COLUMN FTS;', { generated: [FTS] }).length === 0)
ok('a set is taken as readily as a list',
  destructive(changedExpression, { generated: new Set([FTS]) }).length === 0)
/* and a type change on a derived column is still a type change: it is the same drop and re-add,
   but nothing here can tell that the new column keeps the old one's meaning */
ok('dropping a table that holds a generated column is still dropping a table',
  destructive('drop table public.space_messages;', { generated: [FTS] }).length === 1)


/* ---- WHAT IT WOULD COST, and therefore whether it is destructive at all ---- */
/*
 * The guard can see a column being dropped; only the database knows whether anybody would miss
 * what is in it. The costs are handed in exactly as the generated columns are, and the verdict is
 * the arithmetic over them — which is what is checked here, with no database anywhere.
 */
const DROP = 'alter table public.space_members drop column role;'
const cost = (c) => ({ costs: { 'public.space_members.role': c } })

ok('a drop that would lose nothing needs no consent at all',
  guard(DROP, {}, cost({ rows: 47, kept: 0, unknown: false })).ok === true)
ok('and says so as a statement that was applied, not one that was allowed',
  guard(DROP, {}, cost({ rows: 47, kept: 0, unknown: false })).free.length === 1)
ok('a drop that would lose values refuses',
  guard(DROP, {}, cost({ rows: 47, kept: 12, unknown: false })).ok === false)
ok('a cost that could not be taken refuses — never read as nothing',
  guard(DROP, {}, cost({ rows: null, kept: null, unknown: true })).ok === false)
ok('told no costs at all, the answer is the blunt one this guard always gave',
  guard(DROP, {}).ok === false)
ok('an empty table is not data',
  guard('drop table public.old;', {}, { costs: { 'public.old': { rows: 0, kept: 0, unknown: false } } }).ok === true)

/* ---- the digest names the statements ---- */
const A = 'alter table public.a drop column x;', B = 'drop table public.b;'
ok('the same statements in another order are the same digest',
  digestOf(destructive(A + '\n' + B)) === digestOf(destructive(B + '\n' + A)))
ok('reformatting is not a new digest',
  digestOf(destructive(A)) === digestOf(destructive('alter  table   public.a\n  drop column x;')))
ok('another object is another digest', digestOf(destructive(A)) !== digestOf(destructive(B)))
ok('nothing destructive has no digest', digestOf(destructive('select 1;')) === '')
ok('a digest is short enough to retype', digestOf(destructive(A)).length === 8)

/* ---- what an allowance names ---- */
const d8 = digestOf(destructive(DROP))
const SHA = '9f1c4b7a2e3d5068a1b2c3d4e5f60718293a4b5c'
ok('the digest of this plan allows it',
  guard(DROP, { PLATFORMKIT_ALLOW_DESTRUCTIVE: d8 }, { ...cost({ rows: 5, kept: 5, unknown: false }) }).ok === true)
ok('a digest from another plan is stale and allows nothing',
  guard(DROP, { PLATFORMKIT_ALLOW_DESTRUCTIVE: 'deadbeef' }, cost({ rows: 5, kept: 5, unknown: false })).ok === false)
ok('and the verdict says what the stale allowance named',
  guard(DROP, { PLATFORMKIT_ALLOW_DESTRUCTIVE: 'deadbeef' }, cost({ rows: 5, kept: 5, unknown: false })).allowance.named === 'deadbeef')
ok('the commit being deployed allows it, short or long',
  guard(DROP, { PLATFORMKIT_ALLOW_DESTRUCTIVE: SHA.slice(0, 7) }, { ...cost({ rows: 5, kept: 5, unknown: false }), commit: SHA }).ok === true)
ok('a sha naming another commit allows nothing',
  guard(DROP, { PLATFORMKIT_ALLOW_DESTRUCTIVE: 'abcdef1' }, { ...cost({ rows: 5, kept: 5, unknown: false }), commit: SHA }).ok === false)
ok('the blanket permission still allows everything',
  guard(DROP, { PLATFORMKIT_ALLOW_DESTRUCTIVE: '1' }, cost({ rows: 5, kept: 5, unknown: false })).ok === true)
ok('and is reported as the standing permission it is',
  guard(DROP, { PLATFORMKIT_ALLOW_DESTRUCTIVE: '1' }, cost({ rows: 5, kept: 5, unknown: false })).allowance.kind === 'blanket')
/* an allowance may name the objects it is for, so the drop nobody read still stops */
const TWO = DROP + '\ndrop table public.surprise;'
const twoCosts = { costs: { 'public.space_members.role': { rows: 5, kept: 5, unknown: false }, 'public.surprise': { rows: 9, kept: 9, unknown: false } } }
ok('an allowance scoped to one object does not admit another',
  guard(TWO, { PLATFORMKIT_ALLOW_DESTRUCTIVE: digestOf(destructive(TWO)) + ':public.space_members.role' }, twoCosts).refused
    .map((h) => h.object).join() === 'public.surprise')
ok('and admits the one it names', guard(TWO, { PLATFORMKIT_ALLOW_DESTRUCTIVE: digestOf(destructive(TWO)) + ':public.space_members.role' }, twoCosts)
  .refused.length === 1)
ok('an unset variable names nothing', readAllowance('', {}).kind === 'none')

console.log(`destructive: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
