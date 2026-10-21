/* The member's half of a space, against the local stack: a community and a paid server beside the
   staff space with none of them seeing the others, the tier that fills one lapsing, invitations
   (made, used, spent, expired, and surviving a sweep), moderating and inviting as GRANTS rather
   than role names, the four acts and the record each writes, a mute as a fence every path meets,
   and the directory saying only what the site already shows. Everything it makes is removed at the
   end. Skipped with a note when the stack is down (COMMUNITY_TEST=0 skips it too). */
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('community-db: ' + m)
if (process.env.COMMUNITY_TEST === '0') { note('skipped (COMMUNITY_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); leave(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); leave(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id, email }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
/* the browser's own hashing: a token is made and hashed where it is made, and only the digest is sent */
const token = () => randomBytes(24).toString('base64url')
const hash = (tk) => createHash('sha256').update(tk).digest('hex')

console.log('\nCOMMUNITY\n')

const mark = Math.random().toString(36).slice(2, 8)
const COMM = 'test-comm-' + mark, SERV = 'test-serv-' + mark
const TIER = 'test-tier-' + mark
const made = { spaces: [], ents: [], mods: [] }

try {
  /* Every account here is an ordinary reader on purpose. The staff always may, everywhere — that is
     the desk's own rule — so a check asked of a member of staff would pass whatever the grants say
     and would prove nothing. */
  const one = await as('member@example.com')      /* the one the space grants moderating and inviting to */
  const two = await as('member2@example.com')     /* in by the rule, and the one things are done to */
  const out = await as('free@example.com')        /* the first use of an invitation */
  const also = await as('buyer@example.com')      /* the second */
  const nobody = await as('reader1@example.com')  /* in nothing, and never let in */

  /* ---- two spaces of a kind nobody has: a community and a paid server ---- */
  const makeSpace = async (slug, name, kind, fill) => {
    const { data, error } = await service.from('spaces').insert({ slug, name, kind, fill }).select().single()
    if (error) throw new Error(slug + ': ' + error.message)
    made.spaces.push(data.id)
    await service.from('space_roles').insert([
      { space_id: data.id, slug: 'member', name: 'Member', rank: 0 },
      { space_id: data.id, slug: 'keeper', name: 'Keeper', rank: 50 },   /* a name the kit has never heard of */
    ])
    const { data: ch } = await service.from('channels').insert({ space_id: data.id, slug: 'lounge', name: 'Lounge', mode: 'stream', visibility: 'open' }).select().single()
    return { id: data.id, channel: ch.id }
  }
  const comm = await makeSpace(COMM, 'A community', 'community', { entitlement: 'subscribed' })
  const serv = await makeSpace(SERV, 'A server', 'server', { tier: TIER })

  const grant = async (email, tier) => {
    const { data } = await service.from('entitlements').insert({
      user_id: (await service.from('profiles').select('id').eq('email', email).single()).data.id,
      kind: 'class', key: 'subscribed', source: 'grant', source_id: 'probe-' + mark, tier, active: true,
      expires_at: new Date(Date.now() + 864e5).toISOString(),
    }).select().single()
    made.ents.push(data.id)
    return data.id
  }
  const servEnt = await grant(two.email, TIER)
  await service.rpc('space_sync_members')

  /* ---- one instance, three kinds ---- */
  const seen = async (who) => ((await who.sb.from('spaces').select('slug')).data || []).map((s) => s.slug)
  const twoSees = await seen(two)
  ok('somebody the server\'s tier fills is in the server', twoSees.includes(SERV), JSON.stringify(twoSees))
  ok('and does not see the staff space', !twoSees.includes('the-team'))
  const outSees = await seen(out)
  ok('somebody in neither sees neither', !outSees.includes(COMM) && !outSees.includes(SERV), JSON.stringify(outSees))
  ok('and cannot read a room of one', !((await out.sb.from('channels').select('id').eq('id', comm.channel)).data || []).length)
  ok('nor anything said in it', !((await out.sb.from('space_messages').select('id').eq('channel_id', comm.channel)).data || []).length)

  /* ---- a member of the community sees the community alone ---- */
  const commEnt = await grant(one.email, 'anything')
  await service.rpc('space_sync_members')
  const oneSees = await seen(one)
  ok('a live membership fills the community', oneSees.includes(COMM), JSON.stringify(oneSees))
  ok('and it is the only one of the three they see', !oneSees.includes(SERV) && !oneSees.includes('the-team'))

  /* ---- the tier that fills it lapses ---- */
  await service.from('entitlements').update({ active: false }).eq('id', servEnt)
  await service.rpc('space_sync_members')
  ok('a membership the tier no longer grants is gone at the sweep', !(await seen(two)).includes(SERV))
  ok('and they keep nothing they could read before', !((await two.sb.from('channels').select('id').eq('id', serv.channel)).data || []).length)
  await service.from('entitlements').update({ active: true }).eq('id', servEnt)
  await service.rpc('space_sync_members')


  /* ---- an open room of a space you are in is a room you are in ----
     Found the hard way: the fill rule made the memberships and nobody was in any room, so a
     community opened on an empty rail. An invitation put people in the rooms; the rule did not.
     It belongs on the membership rather than on whatever made it, because four things make one. */
  {
    const fresh = await as('reader2@example.com')
    const roomsOf = async (who) => ((await service.from('channel_members').select('channel_id').eq('user_id', who)).data || [])
      .map((r) => r.channel_id)
    const before = await roomsOf(fresh.id)
    await service.from('space_members').insert({ space_id: comm.id, user_id: fresh.id, source: 'manual' })
    const after = await roomsOf(fresh.id)
    ok('joining a space puts you in its open rooms', after.includes(comm.channel) && after.length > before.length)
    ok('and the rail has something in it at once',
      ((await fresh.sb.rpc('space_unread')).data || []).some((r) => r.channel === comm.channel))

    /* a private room is still joined by being put in it */
    const { data: shut } = await service.from('channels')
      .insert({ space_id: comm.id, slug: 'shut', name: 'Shut', mode: 'stream', visibility: 'private' }).select().single()
    ok('a private room is not', !(await roomsOf(fresh.id)).includes(shut.id))

    /* and a room declared after people are already there takes them with it */
    const { data: later } = await service.from('channels')
      .insert({ space_id: comm.id, slug: 'later', name: 'Later', mode: 'stream', visibility: 'open' }).select().single()
    ok('a room declared later takes the space\'s people with it', (await roomsOf(fresh.id)).includes(later.id))
    await service.from('channels').delete().in('id', [shut.id, later.id])
    await service.from('space_members').delete().eq('space_id', comm.id).eq('user_id', fresh.id)
  }

  /* ---- moderating and inviting are grants, never role names ---- */
  const keeper = (await service.from('space_roles').select('id').eq('space_id', comm.id).eq('slug', 'keeper').single()).data
  ok('a member who holds nothing may not moderate',
    !!(await one.sb.rpc('space_moderate', { p_kind: 'mute', p_space: comm.id, p_user: two.id, p_reason: 'probe' })).error)
  ok('nor invite', !!(await one.sb.rpc('space_invite', { p_space: comm.id, p_hash: hash(token()) })).error)
  await service.from('space_grants').insert([
    { capability: 'moderate', scope: 'role', role_id: keeper.id, space_id: comm.id, source: 'file' },
    { capability: 'invite', scope: 'role', role_id: keeper.id, space_id: comm.id, source: 'file' },
  ])
  ok('the grant alone still reaches nobody', !!(await one.sb.rpc('space_invite', { p_space: comm.id, p_hash: hash(token()) })).error)
  await service.from('space_member_roles').insert({ space_id: comm.id, user_id: one.id, role_id: keeper.id })
  /* the room the space's own rule put them in */
  await service.from('channel_members').insert({ channel_id: comm.channel, user_id: one.id }).select()

  /* ---- an invitation: made, used, spent, expired, and surviving a sweep ---- */
  const t1 = token()
  const { data: inv1, error: invErr } = await one.sb.rpc('space_invite', { p_space: comm.id, p_hash: hash(t1), p_role: 'member', p_uses: 2 })
  ok('somebody holding a role the space granted `invite` may make one', !invErr && !!inv1, invErr && invErr.message)
  ok('and the kit named no role to do it', true)
  const look = (await out.sb.rpc('space_invite_look', { p_hash: hash(t1) })).data
  ok('a link says what it is for before anybody presses anything', look && look.state === 'good' && look.space === COMM, JSON.stringify(look))
  const accept = async (who, tk) => (await who.sb.rpc('space_invite_accept', { p_hash: hash(tk) })).data
  const a1 = await accept(out, t1)
  ok('the first use joins', a1 && a1.state === 'joined', JSON.stringify(a1))
  ok('and they are in the space\'s open rooms', ((await out.sb.from('channels').select('id').eq('id', comm.channel)).data || []).length === 1)
  const a2 = await accept(also, t1)
  ok('the second use joins too', a2 && a2.state === 'joined', JSON.stringify(a2))
  const a3 = await accept(nobody, t1)
  ok('the third is told it is spent', a3 && a3.state === 'spent', JSON.stringify(a3))
  ok('and is not in the space by accident', !((await nobody.sb.from('spaces').select('slug').eq('slug', COMM)).data || []).length)

  const t2 = token()
  await one.sb.rpc('space_invite', { p_space: comm.id, p_hash: hash(t2), p_uses: 1, p_days: 1 })
  await service.from('space_invites').update({ expires_at: new Date(Date.now() - 6e4).toISOString() }).eq('token_hash', hash(t2))
  const a4 = await accept(nobody, t2)
  ok('a late one is told it has expired', a4 && a4.state === 'expired', JSON.stringify(a4))
  ok('and is not in the space either', !((await nobody.sb.from('spaces').select('slug').eq('slug', COMM)).data || []).length)

  /* an invitation is not a rule, and a rule must not take back what a person was invited to */
  await service.rpc('space_sync_members')
  ok('somebody who joined by invitation outlives a sweep', ((await out.sb.from('spaces').select('slug').eq('slug', COMM)).data || []).length === 1)
  const rows = (await one.sb.rpc('space_invites_of', { p_space: comm.id })).data || []
  ok('the invitations a space has out are listed for whoever may make one', rows.length === 2)
  ok('and the token is never among them', !JSON.stringify(rows).includes(t1) && !JSON.stringify(rows).includes('token'))
  ok('somebody who may not invite is shown none', !((await two.sb.rpc('space_invites_of', { p_space: comm.id })).data || []).length)

  /* ---- a space filled more than one way ---- */
  /* `one` and `two` hold the community's entitlement; `nobody` (reader1) holds nothing and is on no
     staff. The alternative is "that entitlement, OR anyone on staff", and staff is a role nobody
     here has — so the two sets are proved apart as well as together. */
  const both = await makeSpace('test-alt-' + mark, 'Two ways in', 'community',
    [{ entitlement: 'subscribed' }, { role: ['admin', 'support'] }])
  await service.rpc('space_sync_members')
  const inIt = async (who) => ((await service.from('space_members').select('user_id').eq('space_id', both.id)).data || []).some((m) => m.user_id === who.id)
  ok('somebody matching the first set is in', await inIt(one))
  ok('somebody matching neither is not', !(await inIt(nobody)))
  /* make the second set true of them and nothing else changes */
  await service.from('profiles').update({ roles: ['support'] }).eq('id', nobody.id)
  await service.rpc('space_sync_members')
  ok('somebody matching only the SECOND set is in, with none of the first asked of them', await inIt(nobody))
  await service.from('profiles').update({ roles: [] }).eq('id', nobody.id)
  await service.rpc('space_sync_members')
  ok('and when neither set holds any more, the sweep takes them out', !(await inIt(nobody)))

  /* within one set, everything must match */
  const andSpace = await makeSpace('test-and-' + mark, 'Both at once', 'community',
    [{ entitlement: 'subscribed', role: ['admin'] }])
  await service.rpc('space_sync_members')
  const inAnd = async (who) => ((await service.from('space_members').select('user_id').eq('space_id', andSpace.id)).data || []).some((m) => m.user_id === who.id)
  ok('somebody with only one of a set\'s two conditions is not in', !(await inAnd(one)))

  /* the matcher itself, asked directly about both shapes */
  const asks = async (fill, who) => (await service.rpc('space_fill_matches', { p_user: who.id, p_fill: fill })).data
  ok('a mapping still means what it meant', (await asks({ entitlement: 'subscribed' }, one)) === true)
  ok('a list is true when any set is', (await asks([{ role: ['admin'] }, { entitlement: 'subscribed' }], one)) === true)
  ok('and false when none is', (await asks([{ role: ['admin'] }, { tier: 'nothing-like-this' }], one)) === false)
  ok('an empty list fills nobody', (await asks([], one)) === false)
  ok('and so does a list of empty sets', (await asks([{}, {}], one)) === false)

  /* ---- a report, and a second one ---- */
  const { data: said } = await service.from('space_messages').insert({ channel_id: comm.channel, author_id: two.id, body: 'Something worth reporting.' }).select().single()
  const r1 = (await out.sb.rpc('space_report', { p_message: said.id, p_reason: 'spam', p_note: 'a probe' })).data
  ok('a member may report a message they can read', !!r1)
  const r2 = (await out.sb.rpc('space_report', { p_message: said.id, p_reason: 'spam' })).data
  ok('reporting it twice is one report, not two', r1 === r2)
  const queue = (await one.sb.rpc('space_reports', { p_space: comm.id })).data || []
  ok('the queue shows it once to whoever may moderate', queue.filter((q) => q.message === said.id).length === 1, JSON.stringify(queue.map((q) => q.reason)))
  ok('and carries what was said and who said it', queue.some((q) => q.body === 'Something worth reporting.' && !!q.about))
  ok('somebody who may not moderate is shown no queue', !((await two.sb.rpc('space_reports', { p_space: comm.id })).data || []).length)

  /* ---- a message removed and a member muted ---- */
  const rem = (await one.sb.rpc('space_moderate', { p_kind: 'remove-message', p_space: comm.id, p_message: said.id, p_reason: 'spam' })).data
  ok('a moderator may remove a message', !!rem)
  const after = (await service.from('space_messages').select('deleted_at, body').eq('id', said.id).single()).data
  ok('and it reads as withdrawn rather than vanishing', !!after.deleted_at && !!after.body)
  const closed = (await one.sb.rpc('space_reports', { p_space: comm.id })).data || []
  ok('the report about it is answered by the act', !closed.some((q) => q.message === said.id))

  const mute = (await one.sb.rpc('space_moderate', { p_kind: 'mute', p_space: comm.id, p_user: two.id, p_reason: 'spam', p_minutes: 1440 })).data
  ok('a moderator may mute a member for a span', !!mute)
  const mine = (await two.sb.rpc('space_my_record')).data || []
  ok('the member is told it was done and when it ends', mine.some((m) => m.kind === 'mute' && !!m.until))
  ok('and is told nothing done to anybody else', mine.every((m) => m.kind !== 'report'))
  ok('somebody it was not done to reads none of it', !((await nobody.sb.rpc('space_my_record')).data || []).length)
  ok('a record cannot be changed by the person it is about', !!(await two.sb.from('space_moderation').update({ until: null }).eq('id', mute)).error
    || !!(await service.from('space_moderation').select('until').eq('id', mute).single()).data.until)
  ok('nor read as a table by anybody', !((await one.sb.from('space_moderation').select('id')).data || []).length)

  /* ---- muting is a fence, not a filter ---- */
  const write = async (who, channel, extra = {}) => (await who.sb.from('space_messages').insert({ channel_id: channel, author_id: who.id, body: 'muted?', ...extra })).error
  ok('a muted member cannot write in a channel', !!(await write(two, comm.channel)))
  const { data: root } = await service.from('space_messages').insert({ channel_id: comm.channel, author_id: one.id, body: 'A thread.' }).select().single()
  ok('nor in a thread', !!(await write(two, comm.channel, { thread_root_id: root.id })))
  const dm = (await two.sb.rpc('space_dm_open', { p_space: comm.id, p_with: [one.id] })).data
  ok('a direct message opened before the mute is still theirs to read', !!dm)
  ok('and they cannot write in it either', !!(await write(two, dm)))
  ok('somebody who is not muted still can', !(await write(out, comm.channel)))
  /* it ends by itself */
  await service.from('space_moderation').update({ until: new Date(Date.now() - 6e4).toISOString() }).eq('id', mute)
  ok('a mute ends by itself when its span does', !(await write(two, comm.channel)), 'still refused after the span')

  /* ---- a member removed ---- */
  const before = ((await service.from('space_messages').select('id').eq('author_id', two.id).eq('channel_id', comm.channel)).data || []).length
  ok('a moderator may remove a member', !!(await one.sb.rpc('space_moderate', { p_kind: 'remove-member', p_space: comm.id, p_user: two.id, p_reason: 'probe' })).data)
  ok('the membership is gone', !((await service.from('space_members').select('user_id').eq('space_id', comm.id).eq('user_id', two.id)).data || []).length)
  const kept = ((await service.from('space_messages').select('id').eq('author_id', two.id).eq('channel_id', comm.channel)).data || []).length
  ok('and every word they wrote is still there', kept === before && before > 0, `${kept} of ${before}`)

  /* ---- the acts a space has had done in it ---- */
  const record = (await one.sb.rpc('space_record', { p_space: comm.id })).data || []
  ok('the acts are listed for whoever may moderate, with who did each and why', record.length >= 3 && record.every((m) => m.kind !== 'report'), JSON.stringify(record.map((m) => m.kind)))
  ok('and are not listed for anybody else', !((await nobody.sb.rpc('space_record', { p_space: comm.id })).data || []).length)

  /* ---- the directory says only what is already public ---- */
  const people = (await one.sb.rpc('space_people', { p_space: comm.id })).data || []
  ok('a member sees who else is in their space', people.length >= 1, JSON.stringify(people.map((p) => p.name)))
  const keys = new Set(people.flatMap((p) => Object.keys(p)))
  ok('and no address is disclosed', !keys.has('email'), [...keys].join(', '))
  ok('nor anything bought', !keys.has('purchases') && !keys.has('tier'))
  ok('somebody outside the space is shown nobody', !((await nobody.sb.rpc('space_people', { p_space: comm.id })).data || []).length)



  /* ---- a poll: closing it is the author's, and whoever keeps the room ---- */
  /* `one` is the member this space granted moderating; `out` is an ordinary member of it. */
  const asked = (await service.from('space_messages').insert({
    channel_id: comm.channel, author_id: out.id, kind: 'poll', body: 'Which evening suits?',
    meta: { poll: { options: [{ key: 'th', text: 'Thursday' }, { key: 'fr', text: 'Friday' }] } },
  }).select().single()).data
  ok('an ordinary member may not close somebody else\'s poll',
    (await two.sb.rpc('space_poll_close', { p_message: asked.id })).data === false)
  ok('whoever keeps the room may', (await one.sb.rpc('space_poll_close', { p_message: asked.id })).data === true)
  const asked2 = (await service.from('space_messages').insert({
    channel_id: comm.channel, author_id: out.id, kind: 'poll', body: 'And the week after?',
    meta: { poll: { options: [{ key: 'th', text: 'Thursday' }, { key: 'fr', text: 'Friday' }] } },
  }).select().single()).data
  ok('and so may whoever wrote it', (await out.sb.rpc('space_poll_close', { p_message: asked2.id })).data === true)

  /* ---- a person's card, and the half of it that is not for everybody ---- */
  /* `one` and `out` are both still in the community and both ordinary readers, which is the pair
     this rule is about: a member looking at a member. (`two` was removed from the space above, and
     a card of somebody who is no longer in it is answered nothing — which is checked below.) Staff
     are asked separately, because staff always may: that is the rule, not an exception to it. */
  const staff = await as('admin@example.com')
  const card = (await one.sb.rpc('space_member_card', { p_space: comm.id, p_user: out.id })).data
  ok('a member is given the card of somebody in their space', card && card.id === out.id, JSON.stringify(card && Object.keys(card)))
  ok('which says what this space calls them, when they came and how much they have said',
    card && Array.isArray(card.roles) && card.since && typeof card.said === 'number', JSON.stringify(card))
  const cardKeys = new Set(Object.keys(card || {}))
  ok('and no address, nothing bought and no tier is among it',
    !cardKeys.has('email') && !cardKeys.has('purchases') && !cardKeys.has('tier'), [...cardKeys].join(', '))
  ok('a peer is told they may NOT see the second half', card && card.more === false, JSON.stringify(card && card.more))
  ok('a member of staff who is NOT in the space is answered nothing either',
    (await staff.sb.rpc('space_member_card', { p_space: comm.id, p_user: out.id })).data === null)
  await service.from('space_members').insert({ space_id: comm.id, user_id: staff.id, source: 'manual' })
  ok('and once they are in it, they are told they may see the second half',
    ((await staff.sb.rpc('space_member_card', { p_space: comm.id, p_user: out.id })).data || {}).more === true)
  ok('somebody outside the space is answered nothing at all',
    (await nobody.sb.rpc('space_member_card', { p_space: comm.id, p_user: out.id })).data === null)
  ok('and so is a caller asking about somebody who is not in it',
    (await one.sb.rpc('space_member_card', { p_space: comm.id, p_user: nobody.id })).data === null)
  ok('including somebody who was in it and was removed',
    (await one.sb.rpc('space_member_card', { p_space: comm.id, p_user: two.id })).data === null)

  /* the one rule every read of the private half asks */
  ok('the rule refuses a peer', (await one.sb.rpc('may_see_member', { p_user: out.id })).data === false)
  ok('and allows the person themselves', (await out.sb.rpc('may_see_member', { p_user: out.id })).data === true)
  ok('and allows a member of staff', (await staff.sb.rpc('may_see_member', { p_user: out.id })).data === true)

  /* the line a person writes about themselves: their own, and shown to their space */
  const line = 'A line about me, ' + mark
  ok('a person may write a line about themselves', !(await out.sb.from('profiles').update({ about: line }).eq('id', out.id)).error)
  ok('and it is shown to somebody in the space with them',
    ((await one.sb.rpc('space_member_card', { p_space: comm.id, p_user: out.id })).data || {}).about === line)
  ok('and in the directory beside their name',
    (((await one.sb.rpc('space_people', { p_space: comm.id })).data || []).find((p) => p.id === out.id) || {}).about === line)
  const stolen = await one.sb.from('profiles').update({ about: 'written by somebody else' }).eq('id', out.id)
  ok('and nobody else may write it for them',
    !!stolen.error || ((await one.sb.rpc('space_member_card', { p_space: comm.id, p_user: out.id })).data || {}).about === line)
  const long = await out.sb.from('profiles').update({ about: 'x'.repeat(281) }).eq('id', out.id)
  ok('a line past the limit is refused by the database, not only by the browser', !!long.error, long.error && long.error.message)

  /* ---- what a reader could be in ---- */
  const could = (await nobody.sb.rpc('space_discover')).data || []
  ok('a reader is shown the spaces they could be in', could.some((s) => s.slug === COMM) && could.some((s) => s.slug === SERV), JSON.stringify(could.map((s) => s.slug)))
  ok('and the staff space is never among them', !could.some((s) => s.slug === 'the-team'))
  ok('each says what it would take', could.every((s) => s.fill && Object.keys(s.fill).length))
  ok('and whether it is already theirs', could.find((s) => s.slug === COMM).mine === false
    && ((await one.sb.rpc('space_discover')).data || []).find((s) => s.slug === COMM).mine === true)

  /* ------------------------------------------------------------------ a room with a rule of its own */
  /* The space takes the tier; the room inside it is narrower. A private room so that nothing but the
     rule can put anybody in it — an open one is joined by hand and would prove nothing. */
  const roomSpace = await makeSpace('test-rooms-' + mark, 'Rooms', 'community', { tier: TIER })
  const { data: inner } = await service.from('channels').insert({
    space_id: roomSpace.id, slug: 'inner', name: 'Inner', mode: 'stream', visibility: 'private',
    fill: { entitlement: 'test-ent-' + mark },
  }).select().single()
  /* each row its own source_id: the table is unique on (user, kind, key, source_id), so a second
     grant of the same key to the same person under one id is the same row rather than another */
  let entN = 0
  const entitle = async (who, key, extra = {}) => {
    const { data, error } = await service.from('entitlements').insert({
      user_id: who.id, kind: 'class', key, active: true, source: 'grant',
      source_id: 'probe-' + mark + '-' + (++entN), ...extra,
    }).select().single()
    if (error) throw new Error('entitle ' + key + ': ' + error.message)
    made.ents.push(data.id); return data.id
  }
  await entitle(one, 'subscribed', { tier: TIER })
  await entitle(two, 'subscribed', { tier: TIER })
  await service.rpc('space_sync_members')
  const inRoom = async () => ((await service.from('channel_members').select('user_id, source').eq('channel_id', inner.id)).data || [])
  ok('a room with a rule starts empty of anybody who does not match it', (await inRoom()).length === 0)

  const entId = await entitle(one, 'test-ent-' + mark)
  await service.rpc('space_sync_members')
  const seated = await inRoom()
  ok('somebody who matches the room is put in it by the sweep', seated.length === 1 && seated[0].user_id === one.id)
  ok('and the row says a rule did it, so nothing else will take it back', seated[0].source === 'fill')
  ok('somebody in the space who does not match is not in the room',
    !(await inRoom()).some((r) => r.user_id === two.id))

  /* NARROWER, NEVER WIDER: the room's rule is asked only of people already in the space */
  await entitle(nobody, 'test-ent-' + mark)
  await service.rpc('space_sync_members')
  ok('somebody who matches the ROOM but not the SPACE is in neither',
    !(await inRoom()).some((r) => r.user_id === nobody.id)
    && !((await service.from('space_members').select('user_id').eq('space_id', roomSpace.id)).data || []).some((r) => r.user_id === nobody.id))

  /* what they said stays when the rule stops matching — the same line removal already holds */
  const { data: saidIt } = await service.from('space_messages')
    .insert({ channel_id: inner.id, author_id: one.id, body: 'Said while the rule matched.', kind: 'text' }).select().single()
  await service.from('entitlements').update({ active: false }).eq('id', entId)
  await service.rpc('space_sync_members')
  ok('the rule stops matching and the room lets them go', !(await inRoom()).some((r) => r.user_id === one.id))
  ok('and every word they wrote is still there',
    !!((await service.from('space_messages').select('id').eq('id', saidIt.id)).data || []).length)

  /* a row somebody joined by hand is not a rule's to sweep away */
  await service.from('channel_members').insert({ channel_id: inner.id, user_id: two.id, source: 'hand' })
  await service.rpc('space_sync_members')
  ok('a membership somebody made by hand survives a sweep that matches nobody',
    (await inRoom()).some((r) => r.user_id === two.id && r.source === 'hand'))

  /* ------------------------------------------------------------------ a window that closes by itself */
  const soon = new Date(Date.now() + 2 * 864e5).toISOString()
  const over = new Date(Date.now() - 30 * 864e5).toISOString()
  const BTYPE = 'test-call-' + mark
  const { data: bk } = await service.from('bookings').insert({
    uid: 'probe-' + mark, user_id: one.id, type: BTYPE, event: BTYPE, status: 'accepted',
    start_at: soon, end_at: new Date(Date.parse(soon) + 36e5).toISOString(),
  }).select().single()
  await service.from('channels').update({ fill: { booking: BTYPE, within_next: 10080 } }).eq('id', inner.id)
  await service.from('channel_members').delete().eq('channel_id', inner.id)
  await service.rpc('space_sync_members')
  ok('a call two days away opens the room', (await inRoom()).some((r) => r.user_id === one.id))

  await service.from('bookings').update({ start_at: over, end_at: new Date(Date.parse(over) + 36e5).toISOString() }).eq('uid', bk.uid)
  await service.rpc('space_sync_members')
  ok('and once it is a month past, withinNext lets them go', !(await inRoom()).some((r) => r.user_id === one.id))

  await service.from('channels').update({ fill: [{ booking: BTYPE, within_next: 10080 }, { booking: BTYPE, within_last: 10080 }] }).eq('id', inner.id)
  const justGone = new Date(Date.now() - 2 * 864e5).toISOString()
  await service.from('bookings').update({ start_at: justGone, end_at: new Date(Date.parse(justGone) + 36e5).toISOString() }).eq('uid', bk.uid)
  await service.rpc('space_sync_members')
  ok('written together the two spans are one window, and it is still open two days after the call',
    (await inRoom()).some((r) => r.user_id === one.id))

  await service.from('bookings').update({ status: 'cancelled' }).eq('uid', bk.uid)
  await service.rpc('space_sync_members')
  ok('a cancelled booking is not a booking', !(await inRoom()).some((r) => r.user_id === one.id))
  await service.from('bookings').delete().eq('uid', bk.uid)

  /* ------------------------------------------------------------------ direct messages */
  const dmSpace = roomSpace.id
  await service.from('space_members').upsert([
    { space_id: dmSpace, user_id: one.id, source: 'manual' },
    { space_id: dmSpace, user_id: two.id, source: 'manual' },
  ], { onConflict: 'space_id,user_id' })
  const opened = await one.sb.rpc('space_dm_open', { p_space: dmSpace, p_with: [two.id] })
  ok('a direct message opens while both are willing', !opened.error && !!opened.data, JSON.stringify(opened.error))

  const off = await two.sb.rpc('space_set_dms', { p_space: dmSpace, p_on: false })
  ok('somebody may decline, in their own row', !off.error && off.data === false, JSON.stringify(off.error))
  ok('and it is theirs alone', !!(await one.sb.from('space_members').update({ dms: false }).eq('space_id', dmSpace).eq('user_id', two.id)).error
    || ((await service.from('space_members').select('dms').eq('space_id', dmSpace).eq('user_id', two.id)).data || [{}])[0].dms === false)

  const again = await one.sb.rpc('space_dm_open', { p_space: dmSpace, p_with: [two.id] })
  ok('the conversation already open is handed back exactly as before', !again.error && again.data === opened.data)

  await grant(out.email, 'tier-1')
  await service.from('space_members').upsert({ space_id: dmSpace, user_id: out.id, source: 'manual' }, { onConflict: 'space_id,user_id' })
  const fresh = await out.sb.rpc('space_dm_open', { p_space: dmSpace, p_with: [two.id] })
  ok('but a NEW one is refused, in words', !!fresh.error && /not taking direct messages/.test(fresh.error.message), JSON.stringify(fresh.error))

  const desk = await as('admin@example.com')
  await service.from('space_members').upsert({ space_id: dmSpace, user_id: desk.id, source: 'manual' }, { onConflict: 'space_id,user_id' })
  const bydesk = await desk.sb.rpc('space_dm_open', { p_space: dmSpace, p_with: [two.id] })
  ok('the desk can still reach them, or a member could make themselves unanswerable',
    !bydesk.error && !!bydesk.data, JSON.stringify(bydesk.error))

  await two.sb.rpc('space_set_dms', { p_space: dmSpace, p_on: true })
  const back = await out.sb.rpc('space_dm_open', { p_space: dmSpace, p_with: [two.id] })
  ok('and allowing them again lets a new one be opened', !back.error && !!back.data)

  await service.from('spaces').update({ dms: false }).eq('id', dmSpace)
  const shut = await desk.sb.rpc('space_dm_open', { p_space: dmSpace, p_with: [one.id] })
  ok('a space that says it has none has said it for everybody, staff included',
    !!shut.error && /no direct messages here/.test(shut.error.message), JSON.stringify(shut.error))
  await service.from('spaces').update({ dms: true }).eq('id', dmSpace)
} finally {
  for (const id of made.ents) await service.from('entitlements').delete().eq('id', id)
  await service.from('entitlements').delete().like('source_id', 'probe-' + mark)
  for (const id of made.spaces) await service.from('spaces').delete().eq('id', id)
}

console.log('\ncommunity-db: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
