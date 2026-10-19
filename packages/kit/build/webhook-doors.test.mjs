/*
 * A WEBHOOK WITHOUT ITS SIGNATURE, AND AN OBJECT SOMEBODY ELSE MADE.
 *
 * Two refusals on doors that face the open internet, both of which read "NOT VERIFIED by a pinned
 * test (the SDKs verify)". The SDKs do verify — but what is being trusted there is that we CALL
 * them, on every path, before anything is written. That is a property of our code, not of theirs,
 * and it is one line away from not being true: an early return, a try/catch that swallows, a new
 * branch added above the check.
 *
 * What a miss costs: `stripe-webhook` writes purchases and entitlements, and `cal-webhook` writes
 * and cancels bookings. An unsigned body accepted by either is somebody granting themselves a
 * membership, or cancelling a stranger's session, by posting JSON.
 *
 * And the audio bucket: a reader's browser may PUT a recording it made, under a name that is the
 * hash of the words — but only where nothing is there. A reader who could overwrite could replace
 * any chapter of any book with anything, for everybody, permanently.
 *
 * These go to the functions and the storage API as they are actually served, so the check is of
 * the deployed path rather than of a reading of it.
 *
 * Skipped LOUDLY when the stack is not serving.
 *
 *   node packages/kit/build/webhook-doors.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { loadDotEnv, serviceKey, supabaseUrl } from './tts/storage.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)

console.log('\nTHE DOORS THAT FACE THE INTERNET\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    The unsigned-webhook and overwrite refusals are NOT covered by this run.\n'); process.exit(0) }
let cfg = null
loadDotEnv()
const localUrl = supabaseUrl()
const functionsUrl = process.env.PLATFORMKIT_TEST_FUNCTIONS_URL || (localUrl ? `${localUrl}/functions/v1` : '')
if (functionsUrl) {
  cfg = {
    FUNCTIONS_URL: functionsUrl.replace(/\/+$/, ''),
    API_URL: process.env.PLATFORMKIT_TEST_API_URL || localUrl,
    ANON_KEY: process.env.PLATFORMKIT_TEST_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
    SERVICE_ROLE_KEY: process.env.PLATFORMKIT_TEST_SERVICE_ROLE_KEY || serviceKey(),
  }
} else {
  try { cfg = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
  catch { skip('no local stack is up (npx supabase start)') }
}
if (!cfg || !cfg.FUNCTIONS_URL) skip('the stack did not report a functions url')

/* Is anything serving the functions? `supabase start` does not, on its own. A 503 is NOT "unserved"
   — it is stripe-webhook answering that this environment has no secret, which is itself one of the
   refusals below; only a 404 or a refused connection means nobody is listening. */
const answers = async (name) => {
  try { const r = await fetch(`${cfg.FUNCTIONS_URL}/${name}`, { method: 'POST', body: '{}' }); return r.status !== 404 }
  catch { return false }
}
if (!(await answers('cal-webhook'))) skip('the functions are not being served (npm run dev, or supabase functions serve)')

/* ─── an unsigned, misfigured or absent-signature body ─── */

const BODIES = {
  'no signature header at all': {},
  'an empty signature': { 'stripe-signature': '' },
  'a signature that is not one': { 'stripe-signature': 'nonsense' },
  'a well-shaped signature over other bytes': { 'stripe-signature': 't=1,v1=' + 'a'.repeat(64) },
}
/* a body that, if it were believed, would grant a membership and write a purchase */
const FORGED = JSON.stringify({
  id: 'evt_forged', type: 'checkout.session.completed',
  data: { object: { id: 'cs_forged_' + Date.now(), payment_status: 'paid', metadata: { user_id: '00000000-0000-0000-0000-000000000000' } } },
})

/*
 * stripe-webhook, in an environment with no STRIPE_WEBHOOK_SECRET, must refuse EVERY body rather
 * than fall through to a permissive path — a deployment that forgot the secret is the one where an
 * accepted forgery would go unnoticed longest. It answers 503 with a named code, which is the right
 * answer: not "bad request", but "this door is not open here".
 */
for (const [what, headers] of Object.entries(BODIES)) {
  const r = await fetch(`${cfg.FUNCTIONS_URL}/stripe-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: FORGED })
  const body = await r.text()
  const refused = r.status >= 400 && r.status < 600 && r.status !== 404
  ok(`stripe-webhook refuses ${what}`, refused, `answered ${r.status} ${body.slice(0, 120)}`)
  if (r.status === 503) ok(`  and says why (${what})`, /stripe_unconfigured|not configured/.test(body), body.slice(0, 120))
  else ok(`  and does not say it succeeded (${what})`, !/"received"\s*:\s*true/.test(body), body.slice(0, 120))
}
/*
 * cal-webhook DOES verify here, because trust is an HMAC over the raw body and the refusal happens
 * before anything is read. A forged BOOKING_CREATED that got through would write a booking; a
 * forged BOOKING_CANCELLED would cancel a stranger's session.
 */
const CAL = {
  'no signature header at all': {},
  'an empty signature': { 'x-cal-signature-256': '' },
  'a signature that is not one': { 'x-cal-signature-256': 'nonsense' },
  'a well-shaped signature over other bytes': { 'x-cal-signature-256': 'b'.repeat(64) },
}
for (const [what, headers] of Object.entries(CAL)) {
  const body = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { uid: 'forged-' + Date.now() } })
  const r = await fetch(`${cfg.FUNCTIONS_URL}/cal-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
  const said = await r.text()
  ok(`cal-webhook refuses ${what}`, r.status >= 400 && r.status < 500, `answered ${r.status} ${said.slice(0, 80)}`)
  ok(`  and names the signature (${what})`, /signature/i.test(said), said.slice(0, 80))
}
/* a forged CANCELLED is the one that takes something away rather than adding it */
{
  const body = JSON.stringify({ triggerEvent: 'BOOKING_CANCELLED', payload: { uid: 'forged-cancel' } })
  const r = await fetch(`${cfg.FUNCTIONS_URL}/cal-webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  ok('cal-webhook refuses an unsigned cancellation too', r.status >= 400 && r.status < 500, `answered ${r.status}`)
}

/* and nothing was written on the way past */
{
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  /* a count that does not come back is a FAILURE, not a pass: a query with the wrong column name
     would otherwise report "nothing was written" about a table it never looked at */
  const p = await admin.from('purchases').select('id', { count: 'exact', head: true }).like('stripe_checkout_session_id', 'cs_forged_%')
  ok('and no purchase was written by any of them', p.count === 0, p.error ? p.error.message : `${p.count} purchases`)
  const b = await admin.from('bookings').select('uid', { count: 'exact', head: true }).like('uid', 'forged-%')
  ok('and no booking was written by any of them', b.count === 0, b.error ? b.error.message : `${b.count} bookings`)
  const e = await admin.from('entitlements').select('id', { count: 'exact', head: true }).like('source_id', 'cs_forged_%')
  ok('and nobody granted themselves an entitlement', e.count === 0, e.error ? e.error.message : `${e.count} entitlements`)
  /* and if any of that DID get through — which is what a broken signature check looks like — the
     forgeries are taken back out, so a failing run does not leave the database dirty for the next */
  await admin.from('bookings').delete().like('uid', 'forged-%')
  await admin.from('purchases').delete().like('stripe_checkout_session_id', 'cs_forged_%')
  await admin.from('entitlements').delete().like('source_id', 'cs_forged_%')
}

/* ─── signed, but altered, stale or replayed ─── */
/*
 * A signature over the bytes is not the whole of trust: a body changed by one byte after signing, an event
 * signed long ago and sent again, and a "created" replayed after the booking was cancelled must each change
 * nothing. Run with the stack's own CAL_WEBHOOK_SECRET (the functions' env); without it the door refuses
 * every body, which the checks above already hold.
 */
{
  const { createHmac, createHash } = await import('node:crypto')
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const secret = process.env.CAL_WEBHOOK_SECRET || ''
  const cal = async (raw, sig) => {
    const r = await fetch(`${cfg.FUNCTIONS_URL}/cal-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cal-signature-256': sig ?? createHmac('sha256', secret).update(raw).digest('hex') }, body: raw })
    return { status: r.status, body: await r.text() }
  }
  if (!secret) note('⚠ no CAL_WEBHOOK_SECRET in this environment — the altered, stale and replayed cal.com checks are skipped')
  else {
    const uid = 'forged-replay-' + Date.now()
    const created = (at) => JSON.stringify({ triggerEvent: 'BOOKING_CREATED', createdAt: at, payload: { uid, title: 'probe', startTime: new Date(Date.now() + 864e5).toISOString(), endTime: new Date(Date.now() + 9e7).toISOString(), attendees: [{ email: 'probe@example.test', name: 'Probe' }], organizer: { email: 'host@example.test' } } })
    const fresh = created(new Date().toISOString())
    const altered = fresh.replace('"probe"', '"probf"')
    const a = await cal(altered, createHmac('sha256', secret).update(fresh).digest('hex'))
    ok('cal-webhook refuses a signed body altered by one byte', a.status === 401, `answered ${a.status} ${a.body.slice(0, 80)}`)
    const old = await cal(created(new Date(Date.now() - 2 * 864e5).toISOString()))
    ok('cal-webhook refuses a correctly signed event older than a day', old.status === 400 && /stale/.test(old.body), `answered ${old.status} ${old.body.slice(0, 80)}`)
    const { count: none } = await admin.from('bookings').select('uid', { count: 'exact', head: true }).eq('uid', uid)
    ok('  and wrote nothing for either', none === 0, `${none} rows`)
    /* the booking cancelled, then its signed "created" sent again: it stays cancelled */
    await admin.from('bookings').insert({ uid, email: 'probe@example.test', status: 'cancelled', event: 'probe', start_at: new Date(Date.now() + 864e5).toISOString() })
    const again = await cal(fresh)
    const { data: row } = await admin.from('bookings').select('status').eq('uid', uid).maybeSingle()
    ok('a replayed "created" does not revive a cancelled booking', row?.status === 'cancelled', `answered ${again.status}; the row is ${row?.status}`)
    await admin.from('bookings').delete().eq('uid', uid)
  }

  /* LiveKit: with no account the development secret (which is public) signs nothing */
  if (!process.env.LIVEKIT_URL && process.env.LIVEKIT_MOCK !== '1') {
    const raw = JSON.stringify({ event: 'room_finished', room: { name: 'forged-room' } })
    const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url')
    const head = b64({ alg: 'HS256', typ: 'JWT' }), claims = b64({ iss: 'devkey', nbf: Math.floor(Date.now() / 1000) - 10, exp: Math.floor(Date.now() / 1000) + 600, sha256: createHash('sha256').update(raw).digest('base64') })
    const jwt = `${head}.${claims}.${createHmac('sha256', 'secretsecretsecretsecretsecretsecret').update(`${head}.${claims}`).digest('base64url')}`
    const r = await fetch(`${cfg.FUNCTIONS_URL}/livekit-webhook`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: jwt }, body: raw })
    const said = await r.text()
    ok('livekit-webhook refuses an event signed with the development secret when LiveKit is not configured', r.status === 400 && /not configured/.test(said), `answered ${r.status} ${said.slice(0, 80)}`)
  } else note('⚠ LiveKit is configured here — the unconfigured-secret check is skipped (meetings.test.mjs signs with the real pair)')

  /* the social platforms' door: nothing unsigned is read */
  {
    const r = await fetch(`${cfg.FUNCTIONS_URL}/social-webhook?provider=threads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'page', entry: [{ id: 'forged', changes: [] }] }) })
    ok('social-webhook refuses an unsigned body', r.status === 401 || r.status === 404, `answered ${r.status}`)
  }

  /* a printer with no keys has nobody to call it; each read of a mock job would walk it toward shipped */
  if (!process.env.LULU_CLIENT_KEY) {
    const r = await fetch(`${cfg.FUNCTIONS_URL}/print-webhook?provider=lulu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'PRINT_JOB_STATUS_CHANGED', data: { id: 123456 } }) })
    const said = await r.text()
    ok('print-webhook ignores a call to a mocked printer', r.status === 200 && /mock printer/.test(said), `answered ${r.status} ${said.slice(0, 80)}`)
  }
}

/* ─── the audio bucket: a reader may add, and may not replace ─── */
{
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const reader = createClient(cfg.API_URL, cfg.ANON_KEY, { auth: { persistSession: false } })
  const { error: signin } = await reader.auth.signInWithPassword({ email: 'member@example.com', password: 'password123' })
  if (signin) note('⚠ the member does not sign in — the bucket checks are skipped')
  else {
    const name = `books/probe-book/${'a'.repeat(16)}.mp3`
    await admin.storage.from('audio').remove([name])
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])

    const first = await reader.storage.from('audio').upload(name, bytes, { contentType: 'audio/mpeg' })
    ok('a signed-in reader may add a recording nobody has made', !first.error, first.error?.message)

    if (!first.error) {
      const again = await reader.storage.from('audio').upload(name, new Uint8Array([0, 0, 0, 0]), { contentType: 'audio/mpeg' })
      ok('and may not add it a second time', !!again.error, 'the second upload was accepted')

      /* upsert is the one that matters: it is a single call that replaces, and a policy written
         only against insert would let it through */
      const over = await reader.storage.from('audio').upload(name, new Uint8Array([0, 0, 0, 0]), { contentType: 'audio/mpeg', upsert: true })
      ok('and may not overwrite it', !!over.error, 'the recording was replaced by a reader')

      const del = await reader.storage.from('audio').remove([name])
      const { data: still } = await admin.storage.from('audio').list('books/probe-book')
      ok('and may not delete it', (still || []).some((f) => f.name.endsWith('.mp3')), 'a reader removed a recording')
      void del
      await admin.storage.from('audio').remove([name])
    }
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
