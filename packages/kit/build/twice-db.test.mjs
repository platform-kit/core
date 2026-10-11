/*
 * THE SAME THING TWICE — against the running stack.
 *
 * Every scenario here is an event arriving more than once. cal.com retries a webhook; Stripe
 * retries an event and the browser's own confirmation writes the same session the webhook does;
 * pg_cron runs a job every minute over rows that may not have finished being handled. None of
 * these are unusual — they are the normal behaviour of the systems we sit behind — and all of them
 * were "NOT VERIFIED against real cal.com events" or "the mock locally (observed)".
 *
 * What a second delivery costs is specific and unpleasant: a member gets the same message from
 * their coach twice, or three credits become one, or somebody is charged attention they did not
 * spend. The defence in every case is a stamp on the row, and a stamp is easy to write and easy to
 * put in the wrong place — after the send rather than before, or outside the transaction that did
 * the work.
 *
 * So each check does the thing, does it again, and counts.
 *
 * Skipped LOUDLY when the stack is down.
 *
 *   node packages/kit/build/twice-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nTHE SAME THING TWICE\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    What a repeated delivery costs is NOT covered by this run.\n'); process.exit(0) }
let cfg = null
try { cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.API_URL || !cfg.SERVICE_ROLE_KEY) skip('the stack did not report an API url and a service-role key')
const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const who = async (email) => (await admin.from('profiles').select('id, email').eq('email', email).maybeSingle()).data
const coach = await who('admin@example.com')
const member = await who('member@example.com')
if (!coach || !member) skip('the seed\'s accounts are not there (npx supabase db reset)')

/* ─── a retried MEETING_ENDED: the coach writes first, once ─── */

const UID = 'twice-probe-' + Date.now()
const cleanup = []
{
  const { error } = await admin.from('bookings').insert({
    uid: UID, provider_id: coach.id, user_id: member.id, attendee_emails: [member.email.toLowerCase()],
    event: 'probe', status: 'accepted', start_at: new Date(Date.now() - 3600e3).toISOString(), end_at: new Date(Date.now() - 1800e3).toISOString(),
    followup_at: new Date(Date.now() - 60e3).toISOString(), followup_body: 'A probe follow-up from twice-db.test.mjs.',
  })
  if (error) note('⚠ could not write a probe booking (' + error.message + ') — the follow-up checks are skipped')
  else {
    cleanup.push(async () => { await admin.from('bookings').delete().eq('uid', UID) })
    const before = (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('body', 'A probe follow-up from twice-db.test.mjs.')).count ?? 0

    const first = await admin.rpc('send_booking_followups')
    const after1 = (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('body', 'A probe follow-up from twice-db.test.mjs.')).count ?? 0
    ok('a due follow-up is sent', !first.error && after1 === before + 1, first.error?.message || `${before} → ${after1}`)

    /* the retry: cal.com sending the ending again, or pg_cron running a minute later */
    const second = await admin.rpc('send_booking_followups')
    const after2 = (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('body', 'A probe follow-up from twice-db.test.mjs.')).count ?? 0
    ok('and running again sends nothing more', !second.error && after2 === after1, `${after1} → ${after2}`)

    const { data: row } = await admin.from('bookings').select('followup_sent_at').eq('uid', UID).maybeSingle()
    ok('the booking is stamped, which is what stops it', !!row?.followup_sent_at)

    /* and the message went into the thread between those two people, not a new one */
    const { data: msg } = await admin.from('messages').select('conversation_id, sender_id').eq('body', 'A probe follow-up from twice-db.test.mjs.').order('created_at', { ascending: false }).limit(1).maybeSingle()
    ok('it is from the coach', msg?.sender_id === coach.id)
    if (msg) {
      const { count } = await admin.from('conversations').select('id', { count: 'exact', head: true })
        .or(`and(member_id.eq.${member.id},provider_id.eq.${coach.id}),and(member_id.eq.${coach.id},provider_id.eq.${member.id})`)
      ok('and in the one thread that pair has, not a second one', count === 1, `${count} threads`)
      cleanup.push(async () => { await admin.from('messages').delete().eq('body', 'A probe follow-up from twice-db.test.mjs.') })
    }
  }
}

/* ─── a booking that is not due, and one already stamped, are both left alone ─── */
{
  const LATER = 'twice-probe-later-' + Date.now()
  const { error } = await admin.from('bookings').insert({
    uid: LATER, provider_id: coach.id, user_id: member.id, attendee_emails: [member.email.toLowerCase()],
    event: 'probe', status: 'accepted', start_at: new Date(Date.now() + 3600e3).toISOString(), end_at: new Date(Date.now() + 5400e3).toISOString(),
    followup_at: new Date(Date.now() + 86400e3).toISOString(), followup_body: 'A probe that is not due yet.',
  })
  if (!error) {
    cleanup.push(async () => { await admin.from('bookings').delete().eq('uid', LATER) })
    await admin.rpc('send_booking_followups')
    const { count } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('body', 'A probe that is not due yet.')
    ok('a follow-up that is not due is not sent early', count === 0, `${count} sent`)
    const { data: r } = await admin.from('bookings').select('followup_sent_at').eq('uid', LATER).maybeSingle()
    ok('and it is not stamped, so it will still go when it is due', !r?.followup_sent_at)
  }
}

/* ─── the week of chat: read from the booking, with that session's coach, and never a membership ───
   (openspec: community-access-by-entitlement) */
{
  const buyer = await who('buyer@example.com')
  const giver = await who('coach@example.com')
  const as = createClient(cfg.API_URL, cfg.ANON_KEY, { auth: { persistSession: false } })
  const { error: signErr } = buyer && giver ? await as.auth.signInWithPassword({ email: 'buyer@example.com', password: 'password123' }) : { error: { message: 'no buyer or coach in the seed' } }
  if (signErr) note('⚠ could not sign in as the buyer (' + signErr.message + ') — the chat week is skipped')
  else {
    const WK = 'twice-week-' + Date.now()
    const { data: credit } = await admin.from('entitlements').insert({ user_id: buyer.id, kind: 'product', key: 'session:twice-probe', source: 'grant', source_id: WK, active: false }).select('id').single()
    const at = (h) => new Date(Date.now() + h * 3600e3).toISOString()
    await admin.from('bookings').insert({ uid: WK, user_id: buyer.id, provider_id: giver.id, start_at: at(48), end_at: at(49), status: 'accepted', credit_id: credit.id, title: 'probe' })
    cleanup.push(async () => { await admin.from('bookings').delete().eq('uid', WK); await admin.from('entitlements').delete().eq('source_id', WK) })
    const coaches = async () => ((await as.rpc('chat_session_coaches')).data || [])
    ok('a paid session opens the chat with its coach', (await coaches()).includes(giver.id))
    const other = await as.rpc('chat_session_with', { p_member: buyer.id, p_coach: coach.id })
    ok('and with no other coach', (await coaches()).length === 1 && other.data === false, JSON.stringify({ c: await coaches(), other }))
    ok('and it is not a membership', (await as.rpc('is_subscribed')).data === false)
    ok('and nothing was written to the entitlements for it', ((await admin.from('entitlements').select('id').eq('user_id', buyer.id).eq('key', 'subscribed').eq('active', true)).data || []).length === 0)
    /* the week runs from the session's END: six days after it ended it is still open, eight days after it is shut */
    const moved = await admin.from('bookings').update({ start_at: at(-6 * 24 - 1), end_at: at(-6 * 24) }).eq('uid', WK).select('uid, start_at, end_at, status, credit_id')
    ok('six days after the session ends the chat is still open', (await coaches()).length === 1, JSON.stringify(moved))
    await admin.from('bookings').update({ start_at: at(-8 * 24 - 1), end_at: at(-8 * 24) }).eq('uid', WK)
    ok('a week after it ends the chat is shut, with nothing deleting anything', (await coaches()).length === 0)
    /* a move re-dates it; a cancel ends it */
    await admin.from('bookings').update({ start_at: at(24), end_at: at(25) }).eq('uid', WK)
    ok('a move re-dates the week', (await coaches()).length === 1)
    await admin.from('bookings').update({ status: 'cancelled' }).eq('uid', WK)
    ok('a cancel ends it', (await coaches()).length === 0)
  }
}

for (const c of cleanup.reverse()) { try { await c() } catch { /* best effort */ } }

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
