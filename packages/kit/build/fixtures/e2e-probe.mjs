/*
 * THE RUNNER TEST'S PROBE: run by `platformkit test --e2e --run` in place of the suite, against the stack the run
 * built (build/e2e-runner.test.mjs). It reports what the run gave it, as one line the runner test reads, and reads
 * what the stack holds:
 *
 *   PROBE_WRITE=1        leaves a marker row, for the next run to prove it is gone
 *   PROBE_WITHHOLD=<VAR> takes that variable away before asking for the stack, as a run that did not provide the
 *                        service would — the probe then needs it, and must fail
 *   PROBE_SLEEP=<s>      waits, so the runner test can interrupt a run mid-test
 */
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { requireStack, stackOf, skip } from '../test-stack.mjs'

if (process.env.PROBE_WITHHOLD) delete process.env[process.env.PROBE_WITHHOLD]
const s = requireStack('e2e-probe')
if (process.env.PROBE_WITHHOLD && !stackOf().mail) skip('e2e-probe', 'no mail catcher (PLATFORMKIT_TEST_MAIL_URL)')

const db = new pg.Client({ connectionString: s.db })
await db.connect()
const tables = (await db.query(`select table_name from information_schema.tables where table_schema = 'public'`)).rows.map((r) => r.table_name)
let marker = null
if (tables.includes('e2e_probe')) {
  if (process.env.PROBE_WRITE === '1') await db.query(`insert into public.e2e_probe (note) values ($1)`, [process.env.PLATFORMKIT_TEST_SITE])
  marker = (await db.query(`select count(*)::int as n from public.e2e_probe`)).rows[0].n
}
const columns = tables.includes('e2e_probe') ? (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'e2e_probe'`)).rows.map((r) => r.column_name) : []
/* each site's own seed: the demo's buyer bought something, the club sells nothing */
const purchases = (await db.query(`select count(*)::int as n from public.purchases`)).rows[0].n
await db.end()

console.log('PROBE ' + JSON.stringify({
  site: s.site, api: s.api, db: s.db.replace(/\/\/[^@]*@/, '//'), functions: s.functions, mail: s.mail, app: s.app,
  e2e: process.env.PLATFORMKIT_E2E, tables, columns, marker, purchases,
  code: fileURLToPath(import.meta.url), // where the code under test is
}))
if (process.env.PROBE_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.PROBE_SLEEP) * 1000))
