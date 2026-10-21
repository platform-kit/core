/*
 * AN ACCOUNT REACHES ONLY ITS OWN RECORDS — asked of the local stack as the people the seed makes, never
 * through the service key, which passes every policy and would make all of this agree with itself.
 *
 *   1. The database's own answer: every SECURITY DEFINER function a visitor or a signed-in reader may call
 *      either checks who is asking in its body or is on the reviewed list of public reads below. Supabase's
 *      default privileges open every new function to both, so a function nobody closed by name is open —
 *      book_native, the agent worker's claim and the order reads were, until this test.
 *   2. The address: a profile's email is not the reader's to write, and a guest's purchases and bookings
 *      are claimed and shown by an address only once the account has PROVEN it (a sign-up is confirmed at
 *      once, so an unproven address is only somebody's word).
 *   3. Another account's records by id — orders, purchases, bookings, subscriptions, entitlements, payout
 *      accounts and earnings, usage, form answers, agent runs, support tickets — come back as nothing.
 *   4. Staff within their role: a provider, an analyst and an editor read no customer's form answers or
 *      agent steps; a provider moves or cancels no booking that is not theirs.
 *   5. Links: a recording, a transcript and a purchased file are signed for an hour at most, for a person
 *      allowed them, and a booking's link is only ever to its own folder.
 *
 * Run from a site's root with the stack's env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY); the database is the API's port + 1 unless PLATFORMKIT_TEST_DB_URL says.
 * Skipped with a note when the stack is down (OWNERSHIP_TEST=0 skips it too). Fixtures are made and removed.
 */
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('ownership: ' + m)
if (process.env.OWNERSHIP_TEST === '0') { note('skipped (OWNERSHIP_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
if (!url || !anonKey || !localStack()) { note('skipped — no local stack in the environment'); leave(0) }
try { await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(4000) }) } catch { note('skipped — the stack is not answering'); leave(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, serviceKey(), O)
const guest = createClient(url, anonKey, O)
const as = async (email) => { const c = createClient(url, anonKey, O); const { error } = await c.auth.signInWithPassword({ email, password: 'password123' }); return error ? null : c }
const idOf = async (c) => (await c.auth.getUser()).data.user?.id
const fn = async (name, body, c) => {
  const token = c ? (await c.auth.getSession()).data.session?.access_token : null
  const r = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const stamp = Date.now().toString(36)
const DB_URL = process.env.PLATFORMKIT_TEST_DB_URL || `postgresql://postgres:postgres@127.0.0.1:${Number(new URL(url).port || 54321) + 1}/postgres`
/* a row only the usage functions write (the service role reads it), made as the owner */
const asOwner = async (sql, args) => { const db = new pg.Client({ connectionString: DB_URL }); await db.connect(); try { return (await db.query(sql, args)).rows } finally { await db.end() } }

/* ─── 1. the database's own answer ─── */

/* reads the site shows anybody, each with why: booleans about a public thing, a page's own data, settings */
const PUBLIC = {
  'agents_live()': 'whether the assistants are on, a site setting',
  'comment_domains()': 'which link domains comments may carry, a site setting',
  'comment_open_kind(p_kind text)': 'the open subject of a comment kind — its settings, no comments',
  'experiment_state(name text)': 'an experiment\'s variants and their counts, read by the page to choose one',
  'experiment_results()': 'every experiment\'s counts: the same figures experiment_state gives one by one',
  'is_provider(p_user uuid)': 'whether somebody sells sessions here, shown on their public page',
  'message_channel(p_message uuid)': 'the room a message is in, an id, for the policies',
  'network_admitted(p_user uuid, p_grant text)': 'whether somebody may take part in the network, for its policies',
  'network_blocked(p_a uuid, p_b uuid)': 'whether two people block each other, for the network\'s policies',
  'network_joined(p_user uuid)': 'whether somebody joined the network, shown on their profile',
  'network_suspended(p_user uuid)': 'whether somebody is suspended, shown where their posts were',
  'poll_is_open(p_message uuid)': 'whether a poll takes answers',
  'poll_takes_several(p_message uuid)': 'whether a poll takes several answers',
  'providers_may_offer()': 'whether the site lets providers sell, a site setting',
  'public_profile(p_username text)': 'a profile its owner made public',
  'signal_takes(p_surface text, p_target uuid, p_what text)': 'whether a surface takes votes or reactions',
  'teams_giving(p_username text)': 'the published teams a public profile is in',
  'chat_session_with(p_member uuid, p_coach uuid)': 'whether two people have a paid week of chat, for the chat\'s policies',
  'social_storage_post_allowed(p_name text)': 'the social bucket\'s read check (social_post_readable)',
  'social_storage_post_edit_allowed(p_name text)': 'the social bucket\'s write check (social_post_editable)',
  'space_banned(p_space uuid, p_user uuid)': 'whether somebody is banned from a space, which they are told',
  'space_flair_of(p_space uuid, p_user uuid)': 'the flair a member wears, shown beside their name',
  'space_horizon_in(p_channel uuid)': 'how far back a room\'s history goes for the caller',
}
/* never a visitor's or a reader's to call: the review's findings, held */
const CLOSED = ['book_native', 'agent_claim', 'agent_run_state', 'order_lines', 'order_total', 'order_payment', 'order_fulfilment', 'push_notify',
  'claim_guest_purchases', 'email_audience', 'email_audience_match', 'api_rate_take', 'api_rate_sweep', 'matrix_session_claim', 'space_wake',
  'find_words', 'space_shadowed', 'space_fill_set_matches']
/* a body that asks who is calling, directly or through a helper that does */
const CHECKS = /is_admin|is_staff|is_support|is_provider|auth\.uid|auth\.role|auth\.jwt|service_role|may_edit|is_editor|can_moderate|is_space|space_role|is_moderator|current_setting|may_see_figures|may_see_traits|can_read_channel|comment_may_|space_may|space_sees|social_can|my_readable_channel_ids|providers_may_offer|has_role|my_class|event_for_me|in_conversation|my_proven_email/i
{
  const db = new pg.Client({ connectionString: DB_URL })
  let rows = null, preds = []
  try {
    await db.connect()
    rows = (await db.query(`select p.proname as name, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, p.prosrc as body,
        has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype`)).rows
    /* the PREDICATES that check who is asking — a list kept by hand missed the kit's own may_see_member, and so called
       three of a site's functions that ask it first unchecked: a true/false function is a guard when its body checks the
       caller, or asks another guard */
    preds = (await db.query(`select p.proname as name, p.prosrc as body from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'boolean'::regtype`)).rows
  } catch (e) { note('⚠ the database did not answer (' + e.message + ') — the definer checks are skipped') }
  finally { await db.end().catch(() => {}) }
  if (rows) {
    for (const name of CLOSED) {
      const open = rows.filter((r) => r.name === name && (r.anon || r.auth))
      ok(`${name} is not a visitor's or a reader's to call`, rows.some((r) => r.name === name) && !open.length, open.map((r) => r.sig).join(', ') || 'no such function')
    }
    const guards = new Set(preds.filter((p) => CHECKS.test(p.body)).map((p) => p.name))
    for (let grew = true; grew;) { grew = false; for (const p of preds) if (!guards.has(p.name) && [...guards].some((g) => new RegExp('\\b' + g + '\\s*\\(').test(p.body))) { guards.add(p.name); grew = true } }
    const asks = (body) => CHECKS.test(body) || [...guards].some((g) => new RegExp('\\b' + g + '\\s*\\(').test(body))
    const unchecked = rows.filter((r) => (r.anon || r.auth) && !asks(r.body) && !PUBLIC[r.sig] && !r.name.startsWith('seed_'))
    ok('every definer function open to callers checks who is asking, or is a reviewed public read', !unchecked.length, unchecked.map((r) => r.sig).join('; '))
  }
}

/* ─── 2. the address ─── */

const member = await as('member@example.com'), member2 = await as('member2@example.com')
if (!member || !member2) { note('skipped the rest — the seed has no member@ or member2@ (platformkit migrate reset)'); console.log(`${fail ? fail + ' failed, ' : ''}${pass} passed`); leave(fail ? 1 : 0) }
const memberId = await idOf(member), member2Id = await idOf(member2)
const victim = `probe-victim-${stamp}@example.test`
const made = { purchases: [], bookings: [], users: [], orders: [], subscriptions: [], entitlements: [], payout_accounts: [], payout_lines: [], usage_events: [], form_responses: [], agent_runs: [], support_contacts: [] }
const insert = async (table, row) => { const { data, error } = await service.from(table).insert(row).select().single(); if (error) throw new Error(`${table}: ${error.message}`); made[table]?.push(data); return data }
/* a session proven by its emailed link, as a reader who clicked it */
const byLink = async (email) => {
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error('link: ' + error.message)
  const c = createClient(url, anonKey, O)
  const { error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw new Error('verify: ' + e2.message)
  return c
}
try {
  const bought = await insert('purchases', { email: victim, sku: 'plain-words', key: 'probe', kind: 'download', status: 'paid', amount_total: 800, currency: 'usd', stripe_checkout_session_id: 'cs_probe_' + stamp })
  const theirs = await insert('bookings', { uid: 'probe-guest-' + stamp, email: victim, name: 'Victim', status: 'accepted', event: 'probe', start_at: new Date(Date.now() + 864e5).toISOString(), end_at: new Date(Date.now() + 90e6).toISOString() })

  const wrote = await member2.from('profiles').update({ email: victim }).eq('id', member2Id).select('email')
  ok('a reader cannot write their profile\'s address', !!wrote.error, JSON.stringify(wrote.data))

  /* proven by a link to their own address, then asked to claim: nothing of another address moves */
  const m2link = await byLink('member2@example.com')
  await m2link.rpc('mark_email_verified')
  const { data: still } = await service.from('purchases').select('user_id').eq('id', bought.id).single()
  ok('a proven address claims nothing of another address', still.user_id === null, still.user_id)

  /* signing up as somebody's address (confirmed at once) claims and shows nothing… */
  const signer = createClient(url, anonKey, O)
  const { data: up, error: upErr } = await signer.auth.signUp({ email: victim, password: 'password123' + stamp })
  if (upErr || !up.user) throw new Error('sign up: ' + (upErr?.message || 'no user'))
  made.users.push(up.user.id)
  const { data: after } = await service.from('purchases').select('user_id').eq('id', bought.id).single()
  ok('a sign-up with a guest\'s address takes none of their purchases', after.user_id === null, after.user_id)
  const seen = await signer.from('bookings').select('uid').eq('uid', theirs.uid)
  ok('…nor shows their bookings', !seen.error && !(seen.data || []).length, JSON.stringify(seen.data))
  const ents = await service.from('entitlements').select('id').eq('user_id', up.user.id)
  ok('…nor gives them the paid class', !(ents.data || []).length, JSON.stringify(ents.data))

  /* …until the address is proven by its own link, which is the honest buyer coming back */
  const proven = await byLink(victim)
  const { data: marked } = await proven.rpc('mark_email_verified')
  ok('the address proven by its link is marked', marked === true, marked)
  const { data: claimed } = await service.from('purchases').select('user_id').eq('id', bought.id).single()
  ok('…and then claims the guest\'s purchases', claimed.user_id === up.user.id, claimed.user_id)
  const shown = await proven.from('bookings').select('uid').eq('uid', theirs.uid)
  ok('…and shows the guest\'s bookings', (shown.data || []).length === 1, JSON.stringify(shown))

  /* ─── 3. another account's records by id ─── */
  const order = await insert('orders', { number: 9e9 + Math.floor(Math.random() * 1e6), user_id: memberId, email: 'member@example.com', currency: 'usd', checkout_session: 'cs_probe_o_' + stamp })
  const booking = await insert('bookings', { uid: 'probe-own-' + stamp, user_id: memberId, email: 'member@example.com', status: 'accepted', event: 'probe', recording_path: `probe-own-${stamp}/recording.mp4`, start_at: new Date(Date.now() + 864e5).toISOString(), end_at: new Date(Date.now() + 90e6).toISOString() })
  const sub = await insert('subscriptions', { id: 'sub_probe_' + stamp, user_id: memberId, status: 'active' })
  const ent = await insert('entitlements', { user_id: memberId, kind: 'class', key: 'probe-' + stamp, source: 'grant', source_id: 'probe-' + stamp })
  const payAcct = await insert('payout_accounts', { user_id: memberId, account_id: 'acct_probe_' + stamp })
  const payLine = await insert('payout_lines', { user_id: memberId, amount: 1234, about: 'probe', payable_at: new Date().toISOString() })
  const used = (await asOwner('insert into public.usage_events (user_id, source_ref, offer_key, kind) values ($1, $2, $3, $4) returning source_ref', [memberId, 'probe-' + stamp, 'probe', 'model']))[0]
  const answered = await insert('form_responses', { form: 'probe', user_id: memberId })
  const run = await insert('agent_runs', { asked_by: memberId, status: 'done', job: 'probe' })
  await service.from('agent_steps').insert({ run_id: run.id, n: 1, kind: 'tool', name: 'orders', request: { probe: true } })
  const contact = await insert('support_contacts', { user_id: memberId })
  const ticket = (await service.from('support_tickets').insert({ ref: 9e9 + Math.floor(Math.random() * 1e6), title: 'probe', contact_id: contact.id }).select().single()).data

  const RECORDS = [['orders', 'id', order.id], ['purchases', 'id', bought.id], ['bookings', 'uid', booking.uid], ['subscriptions', 'id', sub.id], ['entitlements', 'id', ent.id],
    ['payout_accounts', 'account_id', payAcct.account_id], ['payout_lines', 'id', payLine.id], ['usage_events', 'source_ref', used.source_ref], ['form_responses', 'id', answered.id],
    ['agent_runs', 'id', run.id], ['agent_steps', 'run_id', run.id], ['support_tickets', 'id', ticket?.id], ['support_contacts', 'id', contact.id]]
  for (const [table, col, val] of RECORDS) {
    const r = await member2.from(table).select(col).eq(col, val)
    ok(`another reader's ${table} row by its id comes back as nothing`, !(r.data || []).length, r.error?.message || JSON.stringify(r.data))
    const g = await guest.from(table).select(col).eq(col, val)
    ok(`…and to a visitor`, !(g.data || []).length, g.error?.message || JSON.stringify(g.data))
  }
  {
    const r = await member.from('orders').select('id').eq('id', order.id)
    ok('the owner does read their own order (the check is not refusing everybody)', (r.data || []).length === 1, r.error?.message)
  }
  for (const [rpc, args] of [['order_lines', { p_order: order.id }], ['order_total', { p_order: order.id }], ['agent_run_state', { p_run: run.id }], ['support_ticket_mine', { p_ticket: ticket?.id }], ['payout_balance', { p_user: memberId }]]) {
    const r = await member2.rpc(rpc, args)
    const empty = !!r.error || r.data == null || (Array.isArray(r.data) && !r.data.length) || (typeof r.data === 'object' && !Array.isArray(r.data) && !Object.keys(r.data).length)
    ok(`${rpc} answers another reader nothing`, empty, JSON.stringify(r.data))
  }
  {
    const r = await fn('session-files', { uid: booking.uid }, member2)
    ok('session-files refuses another reader\'s booking', r.status === 403, r.status + ' ' + JSON.stringify(r.data))
    const p = await fn('payouts', { action: 'status', user: memberId }, member2)
    ok('payouts refuses another provider\'s account', p.status === 403, p.status + ' ' + JSON.stringify(p.data))
    const f = await fn('book-files', { book: 'plain-words' }, member2)
    ok('book-files gives nobody a book they did not buy', f.status === 200 && !(f.data.files || []).length, JSON.stringify(f.data))
  }

  /* ─── 4. staff within their role ─── */
  const coach = await as('coach@example.com'), analyst = await as('analyst@example.com'), editor = await as('editor@example.com'), support = await as('support@example.com')
  for (const [who, c] of [['a provider', coach], ['an analyst', analyst], ['an editor', editor]]) {
    if (!c) { note(`⚠ ${who} does not sign in — skipped`); continue }
    const f = await c.from('form_responses').select('id').eq('id', answered.id)
    ok(`${who} reads no customer's form answers`, !(f.data || []).length, JSON.stringify(f.data))
    const s = await c.from('agent_steps').select('n').eq('run_id', run.id)
    ok(`${who} reads no agent run's steps`, !(s.data || []).length, JSON.stringify(s.data))
  }
  if (support) {
    const s = await support.from('agent_steps').select('n').eq('run_id', run.id)
    ok('the support desk does read an agent run\'s steps', (s.data || []).length === 1, s.error?.message || JSON.stringify(s.data))
  }
  if (coach) {
    const c = await fn('cancel-session', { uid: booking.uid }, coach)
    ok('a provider cancels no booking that is not theirs', c.status === 403, c.status + ' ' + JSON.stringify(c.data))
    const n = await fn('cancel-session', { uid: booking.uid, action: 'no-show' }, coach)
    ok('…nor marks one a no-show', n.status === 403, n.status + ' ' + JSON.stringify(n.data))
    const { data: row } = await service.from('bookings').select('status').eq('uid', booking.uid).single()
    ok('…and the booking is as it was', row.status === 'accepted', row.status)
  }

  /* ─── 5. links ─── */
  {
    await service.storage.from('recordings').upload(`probe-own-${stamp}/recording.mp4`, new Uint8Array([0, 0, 0, 24]), { contentType: 'video/mp4', upsert: false })
    const r = await fn('session-files', { uid: booking.uid }, member)
    const link = String(r.data.recording || '')
    const tok = /token=([^&]+)/.exec(link)?.[1]
    const claims = tok ? JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()) : null
    ok('the attendee is given their recording', !!link, r.status + ' ' + JSON.stringify(r.data))
    ok('…signed for an hour at most', !!claims && claims.exp - claims.iat <= 3600, JSON.stringify(claims))
    /* a row that names another booking's film is not a key to it */
    await service.from('bookings').update({ recording_path: `someone-else-${stamp}/recording.mp4` }).eq('uid', booking.uid)
    const r2 = await fn('session-files', { uid: booking.uid }, member)
    ok('a booking is only ever given links under its own folder', r2.status === 200 && !r2.data.recording, JSON.stringify(r2.data))
    await service.storage.from('recordings').remove([`probe-own-${stamp}/recording.mp4`])
  }
} catch (e) {
  ok('the fixtures were made', false, e.message)
} finally {
  for (const [table, rows] of Object.entries(made)) for (const r of rows) {
    if (table === 'users') { await service.auth.admin.deleteUser(r).catch(() => {}); continue }
    const key = table === 'payout_accounts' ? 'account_id' : r.id !== undefined ? 'id' : 'uid'
    if (table === 'support_contacts') { await service.from('support_tickets').delete().eq('contact_id', r.id); }
    if (table === 'agent_runs') await service.from('agent_steps').delete().eq('run_id', r.id)
    if (table === 'purchases') await service.from('entitlements').delete().eq('source_id', r.stripe_checkout_session_id)
    await service.from(table).delete().eq(key, r[key])
  }
  await service.from('bookings').delete().like('uid', `probe-%-${stamp}`)
  await asOwner('delete from public.usage_events where source_ref = $1', ['probe-' + stamp]).catch(() => {})
}

console.log(fail ? `ownership: ${fail} failed, ${pass} passed` : `ownership: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
