/*
 * WHAT A PROVIDER MAY DO, against the local stack. Four claims, each one a thing that would be easy
 * to get wrong in a way nobody notices until it matters:
 *
 *   A VERSION SOMEBODY HAS SIGNED IS FROZEN. A signature against text that has since changed is not
 *   a signature. The database refuses the edit; the projection turns that refusal into a sentence
 *   saying to bump the version.
 *
 *   FAILING TO SIGN STOPS SELLING AND NOTHING ELSE. Nothing NEW goes on sale — and a draft stays
 *   editable, what is already live stays live, and earnings are still paid. A gate that also froze
 *   their page or held their money would be a punishment rather than a condition.
 *
 *   AN OFFERING IS THEIRS, AND IS NEVER DELETED. Its owner never moves, releasing is an act with a
 *   name on it, and a site that reads new ones first is not read by the author.
 *
 *   THE SITE'S SWITCH IS ASKED ON THE WRITE. Where a site has not turned this on, no offering can be
 *   made whatever a surface offers.
 *
 * Everything it makes is removed at the end. Skipped with a note when the stack is down.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { policyOf, POLICY, delayMinutes } from './providers-push.mjs'

const note = (m) => console.log('providers-db: ' + m)
/* IS THE SITE'S MAIL GOING TO THE LOCAL MAILPIT? Only then are the letters safe to read — and only
   then were they safe to send. A relay that delivers is a relay that delivers, whoever the address
   belongs to. */
function toMailpit() {
  let host = process.env.SMTP_HOST || ''
  if (!host) { try { host = (readFileSync('.env', 'utf8').match(/^SMTP_HOST=(.*)$/m) || [, ''])[1].trim().replace(/^["']|["']$/g, '') } catch { host = '' } }
  return /^(127\.|localhost$|0\.0\.0\.0$|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
}
let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }

console.log('\nPROVIDERS\n')

/* --- the policy, pure: the cautious answer to everything --- */
ok('nothing ships on', POLICY.offerings === 'off')
ok('a new offering ships waiting for a person', POLICY.approve === 'on')
ok('the money ships held for a month', delayMinutes(POLICY['payout-delay']) === 43200)
ok('and the processor ships holding the identity checks', POLICY.connect === 'managed')
const p = policyOf({ offerings: true, approve: false, terms: ' v3 ', 'payout-delay': '2w', connect: 'own' })
ok('a file that says so is read', p.offerings === 'on' && p.approve === 'off' && p.terms === 'v3' && p.delay === 20160 && p.connect === 'own')
ok('a connect nobody has heard of falls back to the cautious one', policyOf({ connect: 'platform' }).connect === 'managed')
ok('and a delay that is not a span falls back to the default', policyOf({ 'payout-delay': 'soon' }).delay === 43200)

if (process.env.PROVIDERS_TEST === '0') { note('the stack half skipped (PROVIDERS_TEST=0)'); console.log('\n  ' + pass + ' passed'); process.exit(fail ? 1 : 0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('the stack half skipped — no local stack in .env'); console.log('\n  ' + pass + ' passed'); process.exit(fail ? 1 : 0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('the stack half skipped — the local stack is not up'); console.log('\n  ' + pass + ' passed'); process.exit(fail ? 1 : 0) }

const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const tag = 'p' + Math.random().toString(36).slice(2, 8)
const made = { users: [], terms: [], offerings: [], bookings: [] }
const now = Date.now()
const setting = async (k, v) => { await service.from('app_settings').upsert({ key: 'provider_' + k, value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' }) }
let wasOfferings = null, wasApprove = null

try {
  const was = await service.from('app_settings').select('key, value').in('key', ['provider_offerings', 'provider_approve'])
  wasOfferings = (was.data || []).find((r) => r.key === 'provider_offerings')?.value ?? 'off'
  wasApprove = (was.data || []).find((r) => r.key === 'provider_approve')?.value ?? 'on'

  const mk = async (email, roles) => {
    const { data, error } = await service.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    if (error) throw new Error(email + ': ' + error.message)
    made.users.push(data.user.id)
    if (roles) await service.from('profiles').update({ roles }).eq('id', data.user.id)
    return data.user.id
  }
  const signIn = async (email) => {
    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
    if (error) throw new Error(email + ': ' + error.message)
    return sb
  }
  const provId = await mk(tag + '-prov@example.com', ['provider'])
  const readerId = await mk(tag + '-reader@example.com', [])
  const asProv = await signIn(tag + '-prov@example.com')
  const asReader = await signIn(tag + '-reader@example.com')

  /* --- the terms are public, and a signed version is frozen --- */
  const v1 = tag + '-v1'
  const t1 = await service.from('provider_terms').insert({ version: v1, body: 'The first wording.' })
  ok('a version is written', !t1.error, t1.error && t1.error.message)
  made.terms.push(v1)
  const anonSees = await createClient(url, anon, { auth: { persistSession: false } }).from('provider_terms').select('version').eq('version', v1)
  ok('anybody may read the terms — somebody deciding whether to become a provider reads them first', (anonSees.data || []).length === 1)

  const edited = await service.from('provider_terms').update({ body: 'A second wording.' }).eq('version', v1)
  ok('an unsigned version may still be corrected', !edited.error, edited.error && edited.error.message)

  const signed = await asProv.from('provider_terms_signed').insert({ user_id: provId, version: v1 })
  ok('a provider signs for themselves', !signed.error, signed.error && signed.error.message)
  const forgery = await asProv.from('provider_terms_signed').insert({ user_id: readerId, version: v1 })
  ok('and never for anybody else', !!forgery.error)
  const unsign = await asProv.from('provider_terms_signed').delete().eq('user_id', provId).eq('version', v1)
  const stillThere = await service.from('provider_terms_signed').select('version').eq('user_id', provId)
  ok('a signature is nobody\'s to unmake', (stillThere.data || []).length === 1, JSON.stringify(unsign))

  const frozen = await service.from('provider_terms').update({ body: 'A third wording.' }).eq('version', v1)
  ok('a signed version is frozen, whoever asks', !!frozen.error && /have been signed/.test(frozen.error.message))
  const stamp = await service.from('provider_terms').update({ published_at: new Date().toISOString() }).eq('version', v1)
  ok('and only its WORDING is — the row is not otherwise sealed', !stamp.error, stamp.error && stamp.error.message)

  /* --- the site's switch is asked on the write --- */
  await setting('offerings', 'off')
  const refusedOff = await asProv.from('provider_offerings').insert({ provider_id: provId, slug: tag + '-a', title: 'An hour' })
  ok('with offerings off, no offering can be made at all', !!refusedOff.error)

  await setting('offerings', 'on')
  await setting('approve', 'on')
  const made1 = await asProv.from('provider_offerings').insert({ provider_id: provId, slug: tag + '-a', title: 'An hour', price_cents: 8000 }).select('id').single()
  ok('with it on, a provider writes their own', !made1.error, made1.error && made1.error.message)
  if (made1.data) made.offerings.push(made1.data.id)
  const forOther = await asProv.from('provider_offerings').insert({ provider_id: readerId, slug: tag + '-b', title: 'Somebody else\'s hour' })
  ok('and only their own', !!forOther.error)
  const byReader = await asReader.from('provider_offerings').insert({ provider_id: readerId, slug: tag + '-c', title: 'Not a provider' })
  ok('somebody who is not a provider writes none', !!byReader.error)

  /* --- a draft is theirs alone; live is what a reader sees --- */
  const readerSeesDraft = await asReader.from('provider_offerings').select('id').eq('id', made1.data.id)
  ok('a draft is theirs alone', (readerSeesDraft.data || []).length === 0)
  const live = await asProv.from('provider_offerings').update({ state: 'live' }).eq('id', made1.data.id)
  ok('a site that reads new ones first is not read by their author', !!live.error && /reads a new offering/.test(live.error.message))
  const waiting = await asProv.from('provider_offerings').update({ state: 'waiting' }).eq('id', made1.data.id)
  ok('so they put it up for reading instead', !waiting.error, waiting.error && waiting.error.message)

  /* releasing is an administrator's OWN call, so the act carries their name rather than the service
     role's — which is why there is no door for it */
  const asAdmin = await signIn('admin@example.com')
  const released = await asAdmin.rpc('provider_release', { p_offering: made1.data.id })
  ok('and a person releases it', !released.error, released.error && released.error.message)
  const nowLive = await service.from('provider_offerings').select('state, released_at, released_by').eq('id', made1.data.id).maybeSingle()
  ok('which is live, with whose act it was on the row', nowLive.data && nowLive.data.state === 'live' && !!nowLive.data.released_at && !!nowLive.data.released_by)
  const byProvider = await asProv.rpc('provider_release', { p_offering: made1.data.id })
  ok('and a provider releasing anything is refused, their own included', byProvider.data && byProvider.data.error === 'not-yours')
  const readerSeesLive = await asReader.from('provider_offerings').select('id').eq('id', made1.data.id)
  ok('a live one everybody sees', (readerSeesLive.data || []).length === 1)

  const moved = await asProv.from('provider_offerings').update({ provider_id: readerId }).eq('id', made1.data.id)
  ok('whose it is never moves', !!moved.error && /belongs to one person/.test(moved.error.message))
  const faked = await asProv.from('provider_offerings').update({ released_by: provId }).eq('id', made1.data.id)
  ok('and releasing is not something a row may claim for itself', !!faked.error && /is an act/.test(faked.error.message))
  const gone = await asProv.from('provider_offerings').delete().eq('id', made1.data.id)
  const stillLive = await service.from('provider_offerings').select('id').eq('id', made1.data.id)
  ok('an offering is never deleted — somebody booked it', (stillLive.data || []).length === 1, JSON.stringify(gone))
  const retired = await asProv.from('provider_offerings').update({ state: 'retired' }).eq('id', made1.data.id)
  ok('it is retired instead, which they may do themselves', !retired.error, retired.error && retired.error.message)

  /* --- BOOKED LIKE ANYTHING ELSE. An offering is not a second booking system: it wears a booking
     type's shape, and the judge, the scheduler, the row, the confirmation and the invitation are the
     ones every booking gets. Against the served functions, where they are served. --- */
  let served = false
  try { served = (await fetch(url + '/functions/v1/session-slots', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* not served */ }
  if (!served) console.log('  (the session functions are not served — npm run dev serves them)')
  else {
    const call = async (sb, name, body) => {
      const { data } = await sb.auth.getSession()
      const r = await fetch(url + '/functions/v1/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify(body),
      })
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    /* the provider keeps hours — the ones they already keep for the site's own types */
    await service.from('provider_schedules').upsert({
      user_id: provId, timezone: 'Europe/Amsterdam',
      weekly: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] },
      name: 'Working hours', is_default: true, buffer_before: 0, buffer_after: 0, notice_hours: 1, max_per_day: 0,
    }, { onConflict: 'user_id,name' })

    const offering = await service.from('provider_offerings').insert({
      provider_id: provId, slug: tag + '-hour', title: 'An hour with me', sub: 'Whatever you like',
      minutes: 60, price_cents: 0, where: 'none', state: 'live', released_at: new Date().toISOString(), released_by: provId,
    }).select('id').single()
    ok('a live offering exists', !offering.error, offering.error && offering.error.message)
    made.offerings.push(offering.data.id)
    const event = 'offering:' + offering.data.id

    const from = new Date(now + 2 * 864e5).toISOString().slice(0, 10)
    const to = new Date(now + 9 * 864e5).toISOString().slice(0, 10)
    const slots = await call(asReader, 'session-slots', { event, from, to, timeZone: 'Europe/Amsterdam' })
    const times = Object.values((slots.body && slots.body.slots) || {}).flat()
    ok('its open times come from the provider\'s own hours', slots.status === 200 && times.length > 0, JSON.stringify(slots.body).slice(0, 160))
    const start = times[0]
    const booked = await call(asReader, 'book-session', { event, start, timeZone: 'Europe/Amsterdam', notes: 'looking forward to it' })
    ok('a reader books it like anything else', booked.status === 200 && !!(booked.body && booked.body.booking && booked.body.booking.uid), JSON.stringify(booked.body).slice(0, 220))
    const uid = booked.body && booked.body.booking && booked.body.booking.uid
    if (uid) made.bookings.push(uid)
    const row = uid ? (await service.from('bookings').select('*').eq('uid', uid).maybeSingle()).data : null
    ok('the row is a booking like any other', !!row && row.event === event && row.status === 'accepted')
    ok('with the offering\'s title on it', row && row.title === 'An hour with me')
    ok('and the provider as its host', row && row.provider_id === provId)

    /* RETIRING IS ABOUT NEW BOOKINGS AND NOTHING ELSE */
    await service.from('provider_offerings').update({ state: 'retired' }).eq('id', offering.data.id)
    const noneLeft = await call(asReader, 'session-slots', { event, from, to, timeZone: 'Europe/Amsterdam' })
    ok('a retired offering is not available — never an empty calendar', noneLeft.status >= 400, JSON.stringify(noneLeft.body || {}).slice(0, 160))
    const noMore = await call(asReader, 'book-session', { event, start, timeZone: 'Europe/Amsterdam' })
    ok('and cannot be booked again', noMore.status >= 400)
    const stillThere = uid ? (await service.from('bookings').select('status').eq('uid', uid).maybeSingle()).data : null
    ok('while the booking already made stands exactly where it was', stillThere && stillThere.status === 'accepted')
    /* and it can still be cancelled — a call somebody paid for is theirs to move or drop */
    const cancelled = uid ? await call(asReader, 'cancel-session', { uid, reason: 'something came up' }) : { status: 0 }
    ok('and is still theirs to cancel', cancelled.status === 200, JSON.stringify(cancelled.body || {}).slice(0, 160))

    /* THE CONFIRMATION AND THE INVITATION ARE THE ONES EVERY BOOKING GETS — where the site's relay
       is the local Mailpit, which is the only place it is safe to look. Both sides get one, each
       with a calendar invitation attached, because this goes through the same _shared/booking.ts as
       everything else.

       THE QUESTION IS WHERE THE SITE SENDS, NOT WHETHER MAILPIT IS UP. Mailpit answers on every
       machine that has the stack running, and on a machine whose SMTP_HOST is a real relay the
       letters go there instead — so asking Mailpit whether it is awake and then reading nothing is
       a failure about somebody's .env rather than about the code. */
    let mail = null
    if (toMailpit()) { try { mail = await (await fetch('http://127.0.0.1:54324/api/v1/messages?limit=30', { signal: AbortSignal.timeout(1500) })).json() } catch { /* not up */ } }
    if (!mail) console.log('  (the site\'s relay is not the local Mailpit — the letters are not looked at)')
    else {
      const to = (a) => (mail.messages || []).filter((m) => (m.To || []).some((x) => x.Address === a))
      const reader = to(tag + '-reader@example.com'), host = to(tag + '-prov@example.com')
      ok('the reader is told it is booked', reader.some((m) => /is booked/.test(m.Subject) && /An hour with me/.test(m.Subject)))
      ok('the provider is told too', host.some((m) => /is booked/.test(m.Subject)))
      ok('each with a calendar invitation attached', reader.concat(host).filter((m) => /is booked/.test(m.Subject)).every((m) => m.Attachments > 0))
      ok('and the cancellation withdraws it, both ways', reader.some((m) => /cancelled/.test(m.Subject)) && host.some((m) => /cancelled/.test(m.Subject)))
    }

    /* a draft is not bookable either, and an unreleased one is not */
    const draft = await service.from('provider_offerings').insert({ provider_id: provId, slug: tag + '-draft', title: 'Not yet', minutes: 30, state: 'draft' }).select('id').single()
    made.offerings.push(draft.data.id)
    const noDraft = await call(asReader, 'session-slots', { event: 'offering:' + draft.data.id, from, to, timeZone: 'Europe/Amsterdam' })
    ok('a draft is not bookable', noDraft.status >= 400)
    const nonsense = await call(asReader, 'session-slots', { event: 'offering:00000000-0000-0000-0000-000000000000', from, to, timeZone: 'Europe/Amsterdam' })
    ok('and an address of nothing at all says so', nonsense.status >= 400)
  }

  /* --- A HOST KEEPS MORE THAN ONE SET OF HOURS, and a type may ask for one ------------------- */
  if (served) {
    const call = async (sb, name, body) => {
      const { data } = await sb.auth.getSession()
      const r = await fetch(url + '/functions/v1/' + name, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify(body),
      })
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    /* the provider keeps a second set: evenings, Tuesdays and Thursdays */
    const evening = await service.from('provider_schedules').insert({
      user_id: provId, name: 'Evenings', is_default: false, timezone: 'Europe/Amsterdam',
      weekly: { 2: [['18:00', '21:00']], 4: [['18:00', '21:00']] }, notice_hours: 1,
    }).select('id').single()
    ok('a host may keep a second set of hours', !evening.error, evening.error && evening.error.message)
    const clash = await service.from('provider_schedules').insert({ user_id: provId, name: 'Evenings', timezone: 'UTC', weekly: {} })
    ok('and never two of one name', !!clash.error)
    const twoDefaults = await service.from('provider_schedules').insert({ user_id: provId, name: 'Weekends', is_default: true, timezone: 'UTC', weekly: {} })
    ok('nor two defaults', !!twoDefaults.error)

    /* a type naming a set gets that set's times */
    const onEvenings = await service.from('provider_offerings').insert({
      provider_id: provId, slug: tag + '-evening', title: 'An evening hour', minutes: 60,
      where: 'none', state: 'live', released_at: new Date().toISOString(), released_by: provId,
    }).select('id').single()
    made.offerings.push(onEvenings.data.id)
    const from2 = new Date(now + 2 * 864e5).toISOString().slice(0, 10)
    const to2 = new Date(now + 16 * 864e5).toISOString().slice(0, 10)
    const hourOf = (i) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' }).format(new Date(i)))

    const byDefault = await call(asReader, 'session-slots', { event: 'offering:' + onEvenings.data.id, from: from2, to: to2, timeZone: 'Europe/Amsterdam' })
    const dayTimes = Object.values((byDefault.body && byDefault.body.slots) || {}).flat()
    ok('a type naming no set gets the default one', dayTimes.length > 0 && dayTimes.every((i) => hourOf(i) < 17))

    /* the offering carries the set's name, the way a booking type will */
    await service.from('provider_offerings').update({ schedule: 'Evenings' }).eq('id', onEvenings.data.id)
    const byName = await call(asReader, 'session-slots', { event: 'offering:' + onEvenings.data.id, from: from2, to: to2, timeZone: 'Europe/Amsterdam' })
    const evenings = Object.values((byName.body && byName.body.slots) || {}).flat()
    ok('a type naming a set gets that set', evenings.length > 0 && evenings.every((i) => hourOf(i) >= 18), JSON.stringify(evenings.slice(0, 3)))
    ok('and it is a different set of times from the default', JSON.stringify(evenings) !== JSON.stringify(dayTimes))

    /* a set they do not keep falls back to their default rather than offering nothing */
    await service.from('provider_offerings').update({ schedule: 'Weekends in June' }).eq('id', onEvenings.data.id)
    const missing = await call(asReader, 'session-slots', { event: 'offering:' + onEvenings.data.id, from: from2, to: to2, timeZone: 'Europe/Amsterdam' })
    const back = Object.values((missing.body && missing.body.slots) || {}).flat()
    ok('a type naming hours the host does not keep falls back to their default', back.length > 0 && back.every((i) => hourOf(i) < 17))

    /* a day off belongs to the set it was written on */
    const offDay = Object.keys((byName.body && byName.body.slots) || {})[0]
    await service.from('provider_overrides').insert({ user_id: provId, day: offDay, ranges: null, schedule_id: evening.data.id })
    await service.from('provider_offerings').update({ schedule: 'Evenings' }).eq('id', onEvenings.data.id)
    const afterOff = await call(asReader, 'session-slots', { event: 'offering:' + onEvenings.data.id, from: from2, to: to2, timeZone: 'Europe/Amsterdam' })
    ok('a day off takes that day out of the set it was written on', !Object.keys((afterOff.body && afterOff.body.slots) || {}).includes(offDay))
    await service.from('provider_offerings').update({ schedule: null }).eq('id', onEvenings.data.id)
    const dayOnDefault = await call(asReader, 'session-slots', { event: 'offering:' + onEvenings.data.id, from: from2, to: to2, timeZone: 'Europe/Amsterdam' })
    ok('and leaves the other set alone', Object.keys((dayOnDefault.body && dayOnDefault.body.slots) || {}).includes(offDay))
    await service.from('provider_overrides').delete().eq('user_id', provId)
  }

  /* --- who is owed a signature --- */
  const v2 = tag + '-v2'
  await service.from('provider_terms').insert({ version: v2, body: 'The new wording.' })
  made.terms.push(v2)
  const { data: owed } = await service.rpc('provider_terms_owed', { p_version: v2 })
  const mine = (owed || []).find((x) => x.user_id === provId)
  ok('a provider who signed the old one is owed the new one', !!mine)
  ok('and the letter can say which they signed', mine && mine.signed === v1)
  ok('a reader is not a provider and is not asked', !(owed || []).some((x) => x.user_id === readerId))
  const nosy = await asReader.rpc('provider_terms_owed', { p_version: v2 })
  ok('and the list is not a reader\'s to see', nosy.data === null)

  /* --- FAILING TO SIGN STOPS SELLING AND NOTHING ELSE --- */
  const { data: maySell } = await service.rpc('provider_may_sell', { p_user: provId })
  ok('somebody on the old terms may not sell', maySell === false)
  const draft2 = await asProv.from('provider_offerings').insert({ provider_id: provId, slug: tag + '-d', title: 'A draft under old terms' }).select('id').single()
  ok('…but a draft is still theirs to write', !draft2.error, draft2.error && draft2.error.message)
  if (draft2.data) made.offerings.push(draft2.data.id)
  const edit2 = await asProv.from('provider_offerings').update({ title: 'Still editable' }).eq('id', draft2.data.id)
  ok('…and still theirs to edit', !edit2.error)
  await setting('approve', 'off')
  const sellRefused = await asProv.from('provider_offerings').update({ state: 'live' }).eq('id', draft2.data.id)
  ok('what they cannot do is put it on sale, and the reason is the terms', !!sellRefused.error && /current terms have not been agreed/.test(sellRefused.error.message))
  const stayedLive = await service.from('provider_offerings').select('state').eq('id', made1.data.id).maybeSingle()
  ok('and what was already live is untouched', stayedLive.data && stayedLive.data.state === 'retired')
  const { data: bal } = await service.rpc('payout_balance', { p_user: provId })
  ok('and their earnings are still read, not withheld', bal !== null)

  await asProv.from('provider_terms_signed').insert({ user_id: provId, version: v2 })
  const { data: maySellNow } = await service.rpc('provider_may_sell', { p_user: provId })
  ok('signing the current version is the whole of it', maySellNow === true)
  const sells = await asProv.from('provider_offerings').update({ state: 'live' }).eq('id', draft2.data.id)
  ok('and then it goes on sale', !sells.error, sells.error && sells.error.message)
  /* --- THE POLICY PROJECTS WITHOUT A MACHINE ---
     The admin's Edge Function has no disk and cannot run providers-push.mjs, so it calls
     projectProviders itself: the four settings and the terms row are database writes, and a
     deployment with git out of the cycle and no deploy hook would otherwise never see a policy
     change at all. Same function, same writes, so this is the check for both callers. --- */
  {
    const { projectProviders } = await import('./providers-io.mjs')
    const v = 'probe-' + Date.now().toString(36)
    made.terms.push(v)
    const { policy } = await projectProviders({ data: { offerings: 'on', approve: 'off', terms: v, 'payout-delay': '2d', connect: 'own' }, body: 'The terms, as the function wrote them.', db: service })
    ok('the delay is resolved to minutes by the ledger\'s own arithmetic', policy.delay === 2880)
    const rows = (await service.from('app_settings').select('key, value').in('key', ['provider_offerings', 'provider_approve', 'provider_delay', 'provider_connect'])).data || []
    const val = (k) => (rows.find((r) => r.key === 'provider_' + k) || {}).value
    ok('the four answers are settings, written by the function', val('offerings') === 'on' && val('approve') === 'off' && val('delay') === '2880' && val('connect') === 'own')
    const t = (await service.from('provider_terms').select('version, body').eq('version', v).maybeSingle()).data
    ok('and the terms are a row of their own', t && t.body.startsWith('The terms, as the function'))
    /* a version with no words is refused rather than written empty */
    let refused = ''
    try { await projectProviders({ data: { terms: v + '-empty' }, body: '', db: service }) } catch (e) { refused = e.message }
    ok('a version with no words is refused', /has no words/.test(refused), refused)
  }

} catch (e) {
  fail++
  console.log('  FAIL  ' + e.message)
} finally {
  await service.from('bookings').delete().in('uid', made.bookings)
  await service.from('provider_offerings').delete().in('id', made.offerings)
  await service.from('provider_terms_signed').delete().in('version', made.terms)
  await service.from('provider_terms').delete().in('version', made.terms)
  for (const id of made.users) await service.auth.admin.deleteUser(id).catch(() => {})
  if (wasOfferings !== null) await setting('offerings', wasOfferings)
  if (wasApprove !== null) await setting('approve', wasApprove)
}

console.log('\n  ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''))
if (fail) process.exit(1)
