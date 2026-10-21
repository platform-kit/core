/*
 * EVERY SQL FUNCTION IN THE DECLARATION COMPILES. The stack loads the schema with `check_function_bodies` off, so a
 * function whose body names a column that is not there is created without complaint and fails only when it is
 * called — email_audience_match named `b.roles`, which its own base never selected, and every funnel and blast
 * audience on every site failed that way, behind a suite that never called it.
 *
 * So each one is created again here with the check on, inside a transaction that is rolled back: a SQL function is
 * then planned against the tables as they are, and a body that cannot be is named. (A PL/pgSQL body is parsed but not
 * planned by this check; its statements are planned when it runs.)
 *
 * Run by the end-to-end run, against the stack it built.
 */
import pg from 'pg'
import { requireStack } from './test-stack.mjs'

const S = requireStack('function-bodies')
const db = new pg.Client({ connectionString: S.db })
await db.connect()

const { rows } = await db.query(`
  select p.oid, n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args, l.lanname as lang
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and l.lanname in ('sql', 'plpgsql') and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   order by p.proname`)

const broken = []
for (const f of rows) {
  try {
    await db.query('begin')
    await db.query('set local check_function_bodies = on')
    const { rows: [{ def }] } = await db.query('select pg_get_functiondef($1) as def', [f.oid])
    await db.query(def)
  } catch (e) {
    broken.push(`${f.schema}.${f.name}(${f.args}) [${f.lang}] — ${String(e.message).split('\n')[0]}`)
  } finally {
    await db.query('rollback').catch(() => {})
  }
}
await db.end()

if (broken.length) { console.log(`  FAIL  ${broken.length} of ${rows.length} functions do not compile against the declaration:\n        ` + broken.join('\n        ')) }
console.log(broken.length ? `function-bodies: ${broken.length} failed, ${rows.length - broken.length} passed` : `function-bodies: all ${rows.length} functions compile against the declaration`)
process.exit(broken.length ? 1 : 0)
