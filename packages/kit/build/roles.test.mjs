/*
 * ROLES ARE GRANTED ONLY BY ADMINISTRATORS — asked of the local stack as a reader, an editor and a
 * provider, through every path that writes a role, a class, an entitlement or a membership: the profile's
 * own row, set_roles, the ledger's tables, the spaces', teams' and channels' membership rows, a provider's
 * offering, and the comments a moderator approves. Every attempt is refused and nothing changes. Then the
 * last administrator: refused when they remove themselves, and when two administrators remove each other
 * at the same moment, one of them always remains.
 *
 * Run from a site's root with the stack's env; skipped with a note when it is down (ROLES_TEST=0 skips it).
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('roles: ' + m)
if (process.env.ROLES_TEST === '0') { note('skipped (ROLES_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
if (!url || !anonKey || !localStack()) { note('skipped — no local stack in the environment'); process.exit(0) }
try { await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(4000) }) } catch { note('skipped — the stack is not answering'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, serviceKey(), O)
const as = async (email) => { const c = createClient(url, anonKey, O); const { error } = await c.auth.signInWithPassword({ email, password: 'password123' }); return error ? null : c }
const idOf = async (c) => (await c.auth.getUser()).data.user?.id
/* refused, or let through and changed nothing: PostgREST answers an update its policy filters out with no rows */
const refused = (r) => !!r.error || (Array.isArray(r.data) && !r.data.length) || r.data === null
const stamp = Date.now().toString(36)

const reader = await as('member@example.com'), editor = await as('editor@example.com'), provider = await as('coach@example.com'), admin = await as('admin@example.com')
if (!reader || !editor || !provider || !admin) { note('skipped — the seed\'s member@, editor@, coach@ or admin@ does not sign in'); process.exit(0) }
const people = [['a reader', reader], ['an editor', editor], ['a provider', provider]]
const { data: space } = await service.from('spaces').select('id').limit(1).single()
const { data: rooms } = await service.from('channels').select('id, space_id').eq('kind', 'channel').limit(2)

for (const [who, c] of people) {
  const id = await idOf(c)
  const { data: before } = await service.from('profiles').select('roles, role, email, email_verified_at, stripe_customer_id').eq('id', id).single()
  for (const [field, value] of [['roles', ['admin']], ['role', 'admin'], ['email_verified_at', new Date().toISOString()], ['stripe_customer_id', 'cus_probe'], ['email', `probe-${stamp}@example.test`]]) {
    if (field === 'email_verified_at' && before.email_verified_at) continue
    const r = await c.from('profiles').update({ [field]: value }).eq('id', id).select(field)
    ok(`${who} cannot write their own ${field}`, refused(r), JSON.stringify(r.data))
  }
  const s = await c.rpc('set_roles', { p_user: id, p_roles: ['admin'] })
  ok(`${who} cannot give themselves a role through set_roles`, s.data?.ok !== true, JSON.stringify(s.data))
  for (const [table, row] of [
    ['entitlements', { user_id: id, kind: 'class', key: 'subscribed', source: 'grant', source_id: 'probe-' + stamp }],
    ['purchases', { user_id: id, sku: 'member-monthly', status: 'paid', stripe_checkout_session_id: 'cs_probe_' + stamp }],
    ['subscriptions', { id: 'sub_probe_' + stamp, user_id: id, status: 'active' }],
    ['space_members', { space_id: space.id, user_id: id }],
    ['space_member_roles', { space_id: space.id, user_id: id, role: 'moderator' }],
    ['team_members', { team: 'the-coaches', user_id: id }],
  ]) {
    const r = await c.from(table).insert(row).select()
    ok(`${who} cannot write themselves into ${table}`, refused(r), JSON.stringify(r.data))
    if (!r.error && r.data?.length) await service.from(table).delete().match(row)
  }
  const e = await c.from('entitlements').update({ active: true, expires_at: null }).eq('user_id', id).select('id')
  ok(`${who} cannot revive or extend their own entitlements`, refused(e), JSON.stringify(e.data))
  const { data: after } = await service.from('profiles').select('roles, role, email, email_verified_at, stripe_customer_id').eq('id', id).single()
  ok(`…and ${who}'s profile is as it was`, JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after))
}

/* a room a member is in: they choose how it tells them things, never which room it is or how they came to be there */
if (rooms?.length === 2) {
  const id = await idOf(reader)
  await service.from('channel_members').upsert({ channel_id: rooms[0].id, user_id: id, source: 'fill' })
  await service.from('channel_members').delete().eq('channel_id', rooms[1].id).eq('user_id', id)
  const moved = await reader.from('channel_members').update({ channel_id: rooms[1].id }).eq('channel_id', rooms[0].id).eq('user_id', id).select()
  ok('a member cannot move their membership into another room', refused(moved), JSON.stringify(moved.data))
  const kept = await reader.from('channel_members').update({ source: 'hand' }).eq('channel_id', rooms[0].id).eq('user_id', id).select()
  ok('…nor mark a rule\'s membership as their own, to outlive it', refused(kept), JSON.stringify(kept.data))
  const told = await reader.from('channel_members').update({ notify: 'all' }).eq('channel_id', rooms[0].id).eq('user_id', id).select('notify')
  ok('…but does choose how the room tells them things', !told.error && told.data?.[0]?.notify === 'all', told.error?.message)
  const { data: row } = await service.from('channel_members').select('source').eq('channel_id', rooms[0].id).eq('user_id', id).single()
  ok('…and the row is still the rule\'s', row?.source === 'fill', JSON.stringify(row))
  await service.from('channel_members').delete().eq('channel_id', rooms[0].id).eq('user_id', id)
}

/* an offering is put on sale by the site's reading, never by its author writing it live */
{
  const pid = await idOf(provider)
  const live = await provider.from('provider_offerings').insert({ provider_id: pid, slug: 'probe-' + stamp, title: 'Probe', state: 'live', minutes: 30, price_cents: 1000, currency: 'usd' }).select()
  ok('a provider cannot create an offering already on sale while the site reads new ones first', refused(live), JSON.stringify(live.data))
  const released = await provider.from('provider_offerings').insert({ provider_id: pid, slug: 'probe-r-' + stamp, title: 'Probe', state: 'draft', minutes: 30, price_cents: 1000, currency: 'usd', released_at: new Date().toISOString(), released_by: pid }).select()
  ok('…nor one marked released', refused(released), JSON.stringify(released.data))
  const draft = await provider.from('provider_offerings').insert({ provider_id: pid, slug: 'probe-d-' + stamp, title: 'Probe', state: 'draft', minutes: 30, price_cents: 1000, currency: 'usd' }).select()
  ok('…but does make a draft', !draft.error && draft.data?.length === 1, draft.error?.message)
  await service.from('provider_offerings').delete().like('slug', `probe-%${stamp}`)
}

/* a comment is said through comment_say, which holds and flags; the row is never the author's to write */
{
  const id = await idOf(reader)
  const { data: subject } = await service.from('comment_subjects').select('kind, subject').limit(1).maybeSingle()
  if (subject) {
    const put = await reader.from('comments').insert({ kind: subject.kind, subject: subject.subject, author_id: id, body: 'probe ' + stamp, state: 'live', approved_at: new Date().toISOString(), approved_by: id }).select()
    ok('a reader cannot write a comment straight in, approved', refused(put), JSON.stringify(put.data))
    const { data: mine } = await service.from('comments').insert({ kind: subject.kind, subject: subject.subject, author_id: id, body: 'probe held ' + stamp, state: 'held' }).select().single()
    if (mine) {
      const up = await reader.from('comments').update({ state: 'live', approved_at: new Date().toISOString() }).eq('id', mine.id).select()
      ok('…nor approve their own held comment', refused(up), JSON.stringify(up.data))
      await service.from('comments').delete().eq('id', mine.id)
    }
    await service.from('comments').delete().like('body', `probe%${stamp}`)
  } else note('⚠ no comment subject in the seed — the comment checks are skipped')
}

/* ─── the last administrator ─── */
{
  const aid = await idOf(admin)
  const { data: admins } = await service.from('profiles').select('id').contains('roles', ['admin'])
  if ((admins || []).length === 1) {
    const r = await admin.rpc('set_roles', { p_user: aid, p_roles: [] })
    ok('the only administrator cannot remove their own role', r.data?.ok === false && r.data?.why === 'last-admin', JSON.stringify(r.data))
  } else note('⚠ the seed has more than one administrator — the lone-administrator check is skipped')
  /* two administrators, each removing the other at the same moment: one always remains */
  const second = `probe-admin-${stamp}@example.test`
  const { data: made } = await service.auth.admin.createUser({ email: second, password: 'password123', email_confirm: true })
  if (made?.user) {
    try {
      const sid = made.user.id
      for (let round = 0; round < 5; round++) {
        await service.rpc('set_roles', { p_user: sid, p_roles: ['admin'] }).then(() => {}, () => {})
        await service.from('profiles').update({ roles: ['admin'] }).eq('id', sid)
        await service.from('profiles').update({ roles: ['admin'] }).eq('id', aid)
        const two = await as(second)
        const [x, y] = await Promise.all([admin.rpc('set_roles', { p_user: sid, p_roles: [] }), two.rpc('set_roles', { p_user: aid, p_roles: [] })])
        const { data: left } = await service.from('profiles').select('id').contains('roles', ['admin']).in('id', [aid, sid])
        ok(`two administrators removing each other at once leave one (round ${round + 1})`, (left || []).length >= 1, JSON.stringify([x.data, y.data]))
      }
    } finally {
      await service.from('profiles').update({ roles: ['admin'] }).eq('id', aid)
      await service.auth.admin.deleteUser(made.user.id).catch(() => {})
    }
  } else note('⚠ a second administrator could not be made — the race is skipped')
}

console.log(fail ? `roles: ${fail} failed, ${pass} passed` : `roles: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
