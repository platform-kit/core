/*
 * A DRY RUN SENDS NOTHING — against the served function, with the rows checked either side.
 *
 * `funnels-run` with `dry: true` is what somebody presses in the admin to see who would get what
 * before they commit to it. Its whole value is the promise in the name, and that promise is one
 * `if` away from being false: the send is guarded by `!dry`, the membership write is guarded by
 * `!dry`, the log row is guarded by `!dry`. A new branch added above one of those guards, or a
 * refactor that hoists the send, and pressing "see who would get this" sends a marketing email to
 * everybody who matches.
 *
 * That is not a bug you find in review — the code reads the same either way — and it is not a bug
 * you can take back once it has happened.
 *
 * So the check is blunt on purpose: count the log rows and the memberships, ask for a dry run,
 * count them again. Nothing may have moved. And a dry run must still REPORT — a function that
 * silently did nothing would also pass "nothing moved", so what it says is checked too.
 *
 * Skipped LOUDLY when the stack is down or the functions are not served.
 *
 *   node packages/kit/build/dryrun-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { statusOf, leave, notHere } from './test-stack.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nA DRY RUN SENDS NOTHING\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    That "see who would get this" sends nothing is NOT covered by this run.\n'); leave(0) }
let cfg = null
try { cfg = statusOf(); if (!cfg) throw new Error('no stack') }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.FUNCTIONS_URL) skip('the stack did not report a functions url')

const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const call = async (body) => {
  const r = await fetch(`${cfg.FUNCTIONS_URL}/funnels-run`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + cfg.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

/* is it served at all? a 404 means nobody is listening; anything else means it answered */
{
  const probe = await call({ dry: true })
  if (probe.status === 404) skip('the functions are not being served (npm run dev)')
  if (probe.status === 503 || /invalid response was received from the upstream/i.test(JSON.stringify(probe.body))) skip('the edge runtime is restarting or out of resources')
}

const counts = async () => ({
  log: (await admin.from('email_log').select('id', { count: 'exact', head: true })).count ?? -1,
  members: (await admin.from('funnel_members').select('user_id', { count: 'exact', head: true })).count ?? -1,
})

const before = await counts()
if (before.log < 0 || before.members < 0) skip('the email tables could not be counted')

/*
 * IS THERE ANYTHING TO SEND? A dry run over a site with no published email funnel moves no rows
 * whatever the guards say, so "nothing moved" would be true of a function that had lost every
 * guard it has. The compiled funnels are read first, and where none has an email step this run
 * SKIPS rather than reporting a promise it did not test.
 */
{
  let compiled = {}
  try { compiled = JSON.parse(fs.readFileSync('supabase/functions/_shared/emails/funnels.json', 'utf8')) } catch { /* none */ }
  const funnels = Object.values(compiled.funnels || {}).filter((f) => f && Array.isArray(f.steps))
  /* PUBLISHED and with an email step: the runner ignores the rest, so a dry run over them moves
     nothing whatever the guards do. welcome.md is compiled but published: false, which is exactly
     the case that made the first version of this check pass while testing nothing. */
  const live = funnels.filter((f) => f.published !== false && f.steps.length > 0)
  if (!live.length) { notHere('dryrun-db', `no PUBLISHED funnel on this site has an email step (${funnels.length} compiled; ${funnels.filter((f) => f.steps.length > 0).length} with steps, all unpublished) — a dry run here moves nothing whatever the guards do, so it would prove nothing (the demo has one)`); process.exit(0) }
}

const r = await call({ dry: true })
ok('a dry run is accepted', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`)

const after = await counts()
ok('it writes no email log row', after.log === before.log, `${before.log} → ${after.log}`)
ok('and moves nobody through a funnel', after.members === before.members, `${before.members} → ${after.members}`)

/*
 * AND IT MUST STILL SAY SOMETHING. "Nothing moved" is also true of a function that fell over
 * before it did anything, so the report is checked: it answers per funnel, with an audience and
 * a `would` list — the list being the thing that only exists on a dry run.
 */
{
  const body = r.body || {}
  const runs = Array.isArray(body) ? body : (body.funnels || body.runs || Object.values(body).filter((v) => v && typeof v === 'object'))
  const list = Array.isArray(runs) ? runs : []
  ok('it reports what it looked at', list.length > 0 || Object.keys(body).length > 0, JSON.stringify(body).slice(0, 160))
  const withWould = list.filter((x) => x && Array.isArray(x.would))
  if (!withWould.length) note('(no published funnel had anybody due, so there is no "would" list to read — the counts above are the whole of it here)')
  else {
    ok('and a dry run carries the `would` list a real run does not', withWould.every((x) => Array.isArray(x.would)))
    ok('whose length matches what it says it would send', withWould.every((x) => x.would.length === x.sent), withWould.map((x) => `${x.would.length}/${x.sent}`).join(' '))
  }
}


/* THE AUDIENCE ITSELF, every rule a funnel or a blast may name: the base it filters lacked `roles`, and because a SQL
   function's columns are found when it runs, every audience on every site failed — the dry run above answered 500 */
{
  const rules = { role: ['admin'], inactive: { min: 0 }, signed_up: { min: 0 }, since_purchase: { none: true }, subscription: ['none', 'any'], bought: ['x'], not_bought: ['x'] }
  for (const [rule, value] of Object.entries(rules)) {
    const { error } = await admin.rpc('email_audience', { rules: { [rule]: value } })
    ok(`an audience by ${rule} is answered`, !error, error && error.message)
  }
  const { data: admins } = await admin.rpc('email_audience', { rules: { role: ['admin'] } })
  ok('an audience by role finds the administrator', (admins || []).some((r) => r.email === 'admin@example.com'), JSON.stringify(admins))
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
