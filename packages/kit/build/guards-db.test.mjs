/*
 * WHAT A SIGNED-IN CLIENT MAY CHANGE, AND WHAT THE DATABASE DOES ON ITS OWN — against the running
 * stack, as the people the seed makes.
 *
 * These scenarios all had the same note: "the local stack (no pinned test)". Somebody ran each of
 * them once and it held. What they have in common is that they are all things the INTERFACE never
 * does — a client writing a column it has no business writing, a second conversation opened for a
 * pair that already has one, a cron job missing after a reset. The app will never try any of them,
 * so nothing here rots loudly: it rots the day somebody writes a new client, or a migration lands
 * a trigger in the wrong order, and by then the only thing standing between a person and a column
 * is that nobody thought to send that request.
 *
 * Every check runs as a real signed-in user through PostgREST, which is the only way to exercise a
 * policy: the service-role key would pass through all of them.
 *
 * Skipped LOUDLY when the stack is down, naming what went unchecked.
 *
 *   node packages/kit/build/guards-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { loadSite } from './site.mjs'
import { moduleSet } from './steps.mjs'
import { activeCronJobs } from './cron.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nWHAT A CLIENT MAY CHANGE\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    The guards, the pair rule and the scheduled jobs are NOT covered by this run.\n'); process.exit(0) }
let cfg = null
try { cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.API_URL || !cfg.SERVICE_ROLE_KEY) skip('the stack did not report an API url and a service-role key')

const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const asPerson = async (email, password = 'password123') => {
  const c = createClient(cfg.API_URL, cfg.ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  return error ? null : c
}

const support = await asPerson('support@example.com')
const member = await asPerson('member@example.com')
if (!support || !member) skip('the seed\'s accounts do not sign in (npx supabase db reset)')

/* ─── the support desk's guard trigger: three columns are the agent's, the rest are the record ─── */

const { data: conv } = await admin.from('support_conversations').select('*').limit(1).maybeSingle()
if (!conv) note('⚠ no support conversation in the seed — the guard checks below are skipped')
else {
  /* what an agent IS allowed to change, so a guard that refused everything would not pass */
  const { error: allowed } = await support.from('support_conversations').update({ status: 'pending' }).eq('id', conv.id)
  ok('a support agent may set the status', !allowed, allowed?.message)
  await admin.from('support_conversations').update({ status: conv.status, resolved_at: conv.resolved_at }).eq('id', conv.id)

  /* and what they are not: every one of these is a column the RECORD owns */
  /* every value here must DIFFER from the row's own, or the trigger's `is distinct from` never
     fires and the check would pass by not testing anything */
  const GUARDED = {
    contact_id: '00000000-0000-0000-0000-000000000000',
    source: conv.source === 'prompt' ? 'contact' : 'prompt',
    path: conv.path === '/somewhere-else' ? '/elsewhere' : '/somewhere-else',
    last_contact_at: new Date(0).toISOString(),
    contact_read_at: new Date(0).toISOString(),
    escalated_at: new Date(0).toISOString(),
  }
  for (const [col, val] of Object.entries(GUARDED)) {
    const { error } = await support.from('support_conversations').update({ [col]: val }).eq('id', conv.id)
    ok(`a client changing ${col} is refused`, !!error, error ? undefined : 'the update went through')
  }
  /* the guard must not have let one slip while the others were refused */
  const { data: after } = await admin.from('support_conversations').select('contact_id, source, path, escalated_at').eq('id', conv.id).maybeSingle()
  ok('and none of them moved', after && after.contact_id === conv.contact_id && after.source === conv.source && after.path === conv.path,
    after ? `now ${JSON.stringify(after)}` : 'the row is gone')

  /* resolving stamps resolved_at itself — the client never supplies it, and reopening clears it */
  await support.from('support_conversations').update({ status: 'resolved' }).eq('id', conv.id)
  const { data: r1 } = await admin.from('support_conversations').select('status, resolved_at').eq('id', conv.id).maybeSingle()
  ok('resolving stamps resolved_at in the database', r1?.status === 'resolved' && !!r1?.resolved_at)
  await support.from('support_conversations').update({ status: 'open' }).eq('id', conv.id)
  const { data: r2 } = await admin.from('support_conversations').select('status, resolved_at').eq('id', conv.id).maybeSingle()
  ok('reopening clears it again', r2?.status === 'open' && !r2?.resolved_at)
  await admin.from('support_conversations').update({ status: conv.status, resolved_at: conv.resolved_at }).eq('id', conv.id)
}

/* ─── one coaching thread per pair, whichever way round it is asked ─── */

const { data: coach } = await admin.from('profiles').select('id, email').contains('roles', ['admin']).limit(1).maybeSingle()
const { data: me } = await admin.from('profiles').select('id').eq('email', 'member@example.com').maybeSingle()
if (!coach || !me) note('⚠ no coach or member in the seed — the pair rule is skipped')
else {
  const a = await member.rpc('chat_open', { peer: coach.id })
  const b = await member.rpc('chat_open', { peer: coach.id })
  ok('chat_open gives a member the same thread twice', !a.error && !b.error && a.data && a.data === b.data, a.error?.message || b.error?.message)
  /* and from the coach's side: the pair is unordered, so asking the other way round must not make
     a second thread — two threads for one pair is two inboxes, and a message in the wrong one */
  const coachClient = await asPerson(coach.email)
  if (coachClient) {
    const c = await coachClient.rpc('chat_open', { peer: me.id })
    ok('and the coach asking the other way round gets that same thread', !c.error && c.data === a.data, c.error?.message || `${c.data} ≠ ${a.data}`)
  } else note('⚠ the coach does not sign in with the seed password — the reverse direction is unchecked')

  const { count } = await admin.from('conversations').select('id', { count: 'exact', head: true })
    .or(`and(member_id.eq.${me.id},provider_id.eq.${coach.id}),and(member_id.eq.${coach.id},provider_id.eq.${me.id})`)
  /* NOT `if (count != null)`: this check was written that way first, with the wrong column name,
     and so passed every run by never running. A count that does not come back is a failure. */
  ok('exactly one row exists for the pair', count === 1, count == null ? 'the count did not come back — the query is wrong' : `${count} rows`)
}

/* ─── a person's own profile: the columns the app derives are not theirs to set ─── */

const PROFILE_GUARDED = { role: 'admin', roles: ['admin'], email_verified_at: new Date().toISOString() }
for (const [col, val] of Object.entries(PROFILE_GUARDED)) {
  const { error } = await member.from('profiles').update({ [col]: val }).eq('id', me?.id ?? '00000000-0000-0000-0000-000000000000')
  const { data: back } = await admin.from('profiles').select('role, roles, email_verified_at').eq('id', me?.id ?? '00000000-0000-0000-0000-000000000000').maybeSingle()
  const moved = back && JSON.stringify(back[col]) === JSON.stringify(val)
  ok(`a member cannot grant themselves ${col}`, !!error || !moved, 'the update went through and the column moved')
}

/* ─── the scheduled jobs: after a reset, every one the data script declares is there ─── */

/*
 * THE SCHEDULED JOBS. `supabase db reset` applies the declaration, the rows and the seed — and the
 * cron jobs are ROWS, in data.sql, not schema. A reset that silently dropped them would leave a
 * site that looks entirely healthy and quietly stops doing everything on a timer: no follow-up
 * after a session, no funnel email, no escalation, no content push. Nothing would fail; things
 * would just never happen.
 *
 * cron.job is not in PostgREST's exposed schemas, so this goes to Postgres directly.
 */
let names = null
try {
  const { Client } = await import('pg')
  const c = new Client({ connectionString: cfg.DB_URL })
  await c.connect()
  const r = await c.query('select jobname from cron.job')
  names = r.rows.map((x) => x.jobname)
  await c.end()
} catch (e) { note('⚠ could not reach Postgres for cron.job (' + String(e.message || e).slice(0, 80) + ')') }

if (!names) note('⚠ the scheduled jobs are NOT covered by this run')
else {
  const site = await loadSite()
  const modules = await moduleSet(site)
  const expected = activeCronJobs(modules, site.modules || {})
  for (const job of expected) ok(`the ${job.name} job is scheduled after a reset`, names.includes(job.name), `scheduled: ${names.join(', ') || 'none'}`)
  ok('and no job is scheduled twice', new Set(names).size === names.length, names.join(', '))
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
