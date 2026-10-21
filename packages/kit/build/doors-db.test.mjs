/*
 * WHO GETS IN — the doors, asked as the people the seed makes.
 *
 * Every scenario here had the same note: the local stack, or Playwright, once. What they have in
 * common is that they are all REFUSALS to somebody who is nearly allowed — a member who signed in
 * with a password rather than a link, an analyst who has the figures but not the desk, a reader
 * whose membership lapsed yesterday, a forged tracking token. None of these people are attackers;
 * most of them are ordinary users one state away from being allowed, which is exactly the boundary
 * a change quietly moves.
 *
 * Asked through PostgREST as a real signed-in user, because the service-role key passes through
 * every policy and would make all of this agree with itself.
 *
 * Skipped LOUDLY when the stack is down.
 *
 *   node packages/kit/build/doors-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { statusOf, leave, moduleOn, notHere } from './test-stack.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nWHO GETS IN\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    The doors are NOT covered by this run.\n'); leave(0) }
let cfg = null
try { cfg = statusOf(); if (!cfg) throw new Error('no stack') }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.API_URL || !cfg.SERVICE_ROLE_KEY) skip('the stack did not report an API url and a service-role key')

const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const asPerson = async (email, password = 'password123') => {
  const c = createClient(cfg.API_URL, cfg.ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  return error ? null : c
}
const guest = createClient(cfg.API_URL, cfg.ANON_KEY, { auth: { persistSession: false } })

const member = await asPerson('member@example.com')
const administrator = await asPerson('admin@example.com')
if (!member || !administrator) skip('the seed\'s accounts do not sign in (npx supabase db reset)')
const analyst = await asPerson('analyst@example.com')
if (!analyst) note('⚠ no analyst account signs in — the figures-only checks are skipped')

/* ─── the figures are an administrator's, not everybody's ─── */

const FIGURES = ['admin_kpis', 'admin_events', 'admin_retention']
for (const fn of FIGURES) {
  const g = await guest.rpc(fn, {})
  ok(`a guest calling ${fn} gets nothing`, !!g.error || g.data == null || (Array.isArray(g.data) && g.data.length === 0), 'the figures came back')
  const m = await member.rpc(fn, {})
  ok(`a member calling ${fn} gets nothing`, !!m.error || m.data == null || (Array.isArray(m.data) && m.data.length === 0), 'the figures came back')
}
/* and an administrator does get an answer, so a function that refused everybody would not pass */
{
  const a = await administrator.rpc('admin_kpis', {})
  ok('an administrator does get the figures', !a.error && a.data != null, a.error?.message || 'nothing came back')
}

/* ─── the confirmed address: a password session may not claim one ─── */
{
  const { data: me } = await admin.from('profiles').select('id, email_verified_at').eq('email', 'member@example.com').maybeSingle()
  const was = me?.email_verified_at ?? null
  await admin.from('profiles').update({ email_verified_at: null }).eq('id', me.id)

  /* signed in with a password: the JWT's amr says so, and the claim must be refused */
  const fresh = await asPerson('member@example.com')
  const r = await fresh.rpc('mark_email_verified')
  const { data: after } = await admin.from('profiles').select('email_verified_at').eq('id', me.id).maybeSingle()
  ok('a password session cannot claim the address is confirmed', r.data === false && !after?.email_verified_at,
    `returned ${JSON.stringify(r.data)}, column ${after?.email_verified_at ?? 'null'}`)

  /* an address already confirmed reads back as confirmed even from a password session — the
     function reports the truth, it just may not WRITE it */
  await admin.from('profiles').update({ email_verified_at: new Date().toISOString() }).eq('id', me.id)
  const r2 = await (await asPerson('member@example.com')).rpc('mark_email_verified')
  ok('and an address already confirmed still reads as confirmed', r2.data === true, JSON.stringify(r2.data))

  await admin.from('profiles').update({ email_verified_at: was }).eq('id', me.id)
}

/* ─── a lapsed member reads and does not write ─── */
{
  const { data: me } = await admin.from('profiles').select('id').eq('email', 'member@example.com').maybeSingle()
  const { data: live } = await admin.from('entitlements').select('id, expires_at').eq('user_id', me.id).eq('key', 'subscribed')
  if (!live || !live.length) note('⚠ the member holds no subscribed entitlement — the lapse check is skipped')
  else {
    const was = live.map((e) => ({ id: e.id, expires_at: e.expires_at }))
    /* the membership ran out yesterday */
    for (const e of was) await admin.from('entitlements').update({ expires_at: new Date(Date.now() - 86400e3).toISOString() }).eq('id', e.id)
    const lapsed = await asPerson('member@example.com')
    const { data: conv } = await admin.from('conversations').select('id').eq('member_id', me.id).limit(1).maybeSingle()
    if (conv) {
      const read = await lapsed.from('messages').select('id').eq('conversation_id', conv.id).limit(1)
      ok('a lapsed member can still read their thread', !read.error, read.error?.message)
      const write = await lapsed.from('messages').insert({ conversation_id: conv.id, sender_id: me.id, kind: 'text', body: 'a probe from doors-db' })
      ok('and cannot write to it', !!write.error, 'the message went through')
      if (!write.error) await admin.from('messages').delete().eq('body', 'a probe from doors-db')
    } else if (!(await moduleOn('coaching'))) notHere('doors-db: a lapsed member\'s coaching thread', 'the coaching module is off')
    else note('⚠ the member has no coaching thread — the lapse check is skipped')
    for (const e of was) await admin.from('entitlements').update({ expires_at: e.expires_at }).eq('id', e.id)
  }
}

/* ─── a forged tracking token counts nothing ─── */
{
  const r = await admin.rpc('email_hit', { p_token: 'not-a-real-token-at-all', p_ua: 'probe' })
  const rows = Array.isArray(r.data) ? r.data : r.data ? [r.data] : []
  ok('a token that is not in email_links yields no destination', !r.error && rows.length === 0, r.error?.message || JSON.stringify(rows))
  /* nothing was invented on the way: no log row grew an open */
  const { count } = await admin.from('email_links').select('token', { count: 'exact', head: true }).eq('token', 'not-a-real-token-at-all')
  ok('and no link row was created by asking', count === 0, `${count} rows`)
}

/* ─── the push topics a support agent may hold ─── */
{
  const support = await asPerson('support@example.com')
  if (!support) note('⚠ no support account signs in — the push topics are skipped')
  else {
    const { data: me } = await admin.from('profiles').select('id').eq('email', 'support@example.com').maybeSingle()
    const { error } = await support.from('push_subscriptions').insert({
      user_id: me.id, endpoint: 'https://example.invalid/probe-' + Date.now(),
      p256dh: 'x', auth: 'y', topics: ['support-new', 'support-message'],
    })
    ok('a support agent may subscribe to the support topics', !error, error?.message)
    /* and a subscription is their own: nobody else's endpoint is readable */
    const { data: mine } = await support.from('push_subscriptions').select('user_id')
    ok('and sees only their own browsers', (mine || []).every((r) => r.user_id === me.id), 'somebody else\'s subscription is readable')
    await admin.from('push_subscriptions').delete().like('endpoint', 'https://example.invalid/probe-%')
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
