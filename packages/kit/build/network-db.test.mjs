/* THE NETWORK'S RULES, against the local stack (openspec: social-network). The audiences — three
   posts, three readers, by every path the site's own pages use; a reply or a quote never read by
   more people than what it answers; a block mutual and ending the follows, a mute silent; the
   timeline as the people one follows and the spaces one pinned; the counts; a closed page answering
   as a name nobody holds; and moderation — a report, a removal, a suspension and its lift, every one
   of them written down and none of them editable. Everything it makes is removed at the end.
   Skipped with a note when the stack is down (NETWORK_TEST=0 skips it too). */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('network-db: ' + m)
if (process.env.NETWORK_TEST === '0') { note('skipped (NETWORK_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const client = () => createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
const as = async (email) => {
  const sb = client()
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const guest = client()

/* the ids a reader gets back for a set of posts, by the path the pages use */
const sees = async (sb, ids) => new Set(((await sb.from('network_posts').select('id').in('id', ids)).data || []).map((r) => r.id))

const SLUG = 'net-test-' + Math.random().toString(36).slice(2, 8)
let spaceId = null
let accessBefore
let placesBefore
const PASS = 'net-test-pass-' + Math.random().toString(36).slice(2, 8)
const people = []
const profilesBefore = new Map()

try {
  /* THE SITE'S OWN RULES ARE PUT ASIDE FOR THE RUN — a members' community (network.access, community.access)
     would close what these checks open — and put back after, whatever happens */
  accessBefore = (await service.from('app_settings').select('value').eq('key', 'network_access').maybeSingle()).data
  placesBefore = (await service.from('app_settings').select('value').eq('key', 'community_access').maybeSingle()).data
  await service.from('app_settings').delete().in('key', ['network_access', 'community_access'])
  const A = await as('member@example.com')     /* the author */
  const B = await as('member2@example.com')    /* in the space */
  const C = await as('free@example.com')       /* outside it */
  const M = await as('admin@example.com')      /* a moderator */
  people.push(A.id, B.id, C.id, M.id)
  for (const p of (await service.from('profiles').select('id, public_profile, username').in('id', people)).data || []) profilesBefore.set(p.id, p)
  /* a clean slate for these four: nothing of the network from an earlier run */
  for (const t of ['network_posts', 'network_follows', 'network_blocks', 'network_mutes', 'network_pins', 'network_likes', 'network_reposts']) {
    const col = { network_posts: 'author_id', network_follows: 'follower_id', network_blocks: 'blocker_id', network_mutes: 'muter_id', network_pins: 'user_id', network_likes: 'author_id', network_reposts: 'author_id' }[t]
    await service.from(t).delete().in(col, people)
  }
  await service.from('network_moderation').delete().in('subject_id', people)
  await service.from('profiles').update({ public_profile: false }).eq('id', A.id)

  /* a space with a feed channel: B is in it, C is not */
  const { data: space, error: se } = await service.from('spaces').insert({ slug: SLUG, name: 'A network test space', kind: 'community', fill: {} }).select().single()
  if (se) throw se
  spaceId = space.id
  const { data: feed, error: fe } = await service.from('channels').insert({ space_id: spaceId, slug: 'feed', name: 'Feed', mode: 'feed', visibility: 'open' }).select().single()
  if (fe) throw fe
  ok('a channel may be read as a feed', !!feed && feed.mode === 'feed')
  await service.from('space_members').insert([{ space_id: spaceId, user_id: A.id }, { space_id: spaceId, user_id: B.id }])

  /* ------------------------------------------------------------ three posts, three readers */
  const post = async (who, fields) => {
    const { data, error } = await who.sb.from('network_posts').insert({ author_id: who.id, ...fields }).select().single()
    if (error) throw new Error('post: ' + error.message)
    return data
  }
  const everyone = await post(A, { text: 'to everyone', audience: 'everyone' })
  const here = await post(A, { text: 'to the people here', audience: 'here' })
  const { data: spaced, error: me_ } = await A.sb.from('space_messages').insert({ channel_id: feed.id, author_id: A.id, body: 'to the space' }).select().single()
  if (me_) throw me_
  ok('a post takes a record key, a TID', /^[234567a-z]{13}$/.test(everyone.rkey), everyone.rkey)
  ok('…and every key is its author\'s own and different', everyone.rkey !== here.rkey)

  const ids = [everyone.id, here.id]
  const spaceSees = async (sb) => ((await sb.from('space_messages').select('id').eq('id', spaced.id)).data || []).length === 1

  let g = await sees(guest, ids)
  ok('a guest sees nothing of a member whose page is closed', g.size === 0)
  await service.from('profiles').update({ public_profile: true }).eq('id', A.id)
  g = await sees(guest, ids)
  ok('a guest sees the everyone post once the page is open', g.has(everyone.id))
  ok('…and never the post to the people here', !g.has(here.id))
  ok('…and never the space\'s', !(await spaceSees(guest)))
  await service.from('profiles').update({ public_profile: false }).eq('id', A.id)

  const c = await sees(C.sb, ids)
  ok('a member outside the space sees the everyone post', c.has(everyone.id))
  ok('…and the post to the people here', c.has(here.id))
  ok('…and not the space\'s', !(await spaceSees(C.sb)))
  const b = await sees(B.sb, ids)
  ok('a member of the space sees all three', b.has(everyone.id) && b.has(here.id) && (await spaceSees(B.sb)))
  ok('the author sees their own', (await sees(A.sb, ids)).size === 2)

  /* ------------------------------------------------------------ a closed page is a name nobody holds */
  /* the author needs an address for a page; the seed may not give one, so one is lent for the run */
  let named = profilesBefore.get(A.id)?.username
  if (!named) {
    named = SLUG + '-author'
    await service.from('profiles').update({ username: named }).eq('id', A.id)
  }
  {
    const shut = await C.sb.rpc('public_profile', { p_username: named })
    const nobody = await C.sb.rpc('public_profile', { p_username: 'nobody-holds-this-' + SLUG })
    ok('a closed page answers as a name nobody holds', JSON.stringify(shut.data ?? null) === JSON.stringify(nobody.data ?? null), JSON.stringify(shut.data))
  }

  /* ------------------------------------------------------------ the audience never widens */
  const wide = await B.sb.from('network_posts').insert({ author_id: B.id, text: 'replying to everyone', audience: 'everyone', reply_parent_id: here.id })
  ok('a reply wider than its post is refused', !!wide.error && /more people/.test(wide.error.message), wide.error?.message)
  const reply = await post(B, { text: 'a reply among us', audience: 'here', reply_parent_id: here.id })
  ok('a reply as narrow as its post is taken', !!reply.id)
  ok('…and its root is the thread\'s, whatever the client said', reply.reply_root_id === here.id)
  const deeper = await post(C, { text: 'a reply to the reply', audience: 'here', reply_parent_id: reply.id, reply_root_id: reply.id })
  ok('a reply\'s root is always the thread\'s first post', deeper.reply_root_id === here.id, deeper.reply_root_id)
  const quote = await B.sb.from('network_posts').insert({ author_id: B.id, text: 'quoting to everyone', audience: 'everyone', quote_id: here.id })
  ok('a quote wider than what it quotes is refused', !!quote.error && /more people/.test(quote.error.message), quote.error?.message)
  const outside = await B.sb.from('network_posts').insert({ author_id: B.id, text: 'answering elsewhere', audience: 'everyone', reply_parent_uri: 'at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3kabc' })
  ok('answering somebody elsewhere needs the wider network', !!outside.error, outside.error?.message)
  const forged = await B.sb.from('network_posts').insert({ author_id: A.id, text: 'in somebody else\'s name', audience: 'here' })
  ok('nobody posts in another\'s name', !!forged.error)
  const edit = await A.sb.from('network_posts').update({ text: 'changed' }).eq('id', everyone.id).select()
  ok('a post is never edited', !!edit.error || (edit.data || []).length === 0)

  /* ------------------------------------------------------------ the counts */
  const reread = async (id) => (await service.from('network_posts').select('like_count, repost_count, reply_count, quote_count').eq('id', id).single()).data
  ok('a reply moves its parent\'s count', (await reread(here.id)).reply_count === 1)
  await C.sb.from('network_likes').insert({ author_id: C.id, post_id: everyone.id })
  await B.sb.from('network_likes').insert({ author_id: B.id, post_id: everyone.id })
  const twice = await C.sb.from('network_likes').insert({ author_id: C.id, post_id: everyone.id })
  ok('a like is once per person', !!twice.error)
  ok('the likes are counted', (await reread(everyone.id)).like_count === 2)
  await C.sb.from('network_likes').delete().eq('author_id', C.id).eq('post_id', everyone.id)
  ok('…and an unlike is taken off', (await reread(everyone.id)).like_count === 1)
  await B.sb.from('network_reposts').insert({ author_id: B.id, post_id: here.id })
  ok('a repost is counted', (await reread(here.id)).repost_count === 1)

  /* ------------------------------------------------------------ the timeline */
  await C.sb.from('network_follows').insert({ follower_id: C.id, subject_id: A.id })
  await C.sb.from('network_follows').insert({ follower_id: C.id, subject_id: B.id })
  const self = await C.sb.from('network_follows').insert({ follower_id: C.id, subject_id: C.id })
  ok('nobody follows themselves', !!self.error)
  let tl = (await C.sb.rpc('network_timeline', { p_before: null, p_limit: 50 })).data || []
  ok('the timeline holds the posts of the people one follows', tl.some((t) => t.post_id === everyone.id) && tl.some((t) => t.post_id === here.id))
  ok('…and what they reposted', tl.some((t) => t.kind === 'repost' && t.post_id === here.id && t.reposted_by === B.id))
  ok('…and a reply between two people one follows', tl.some((t) => t.post_id === reply.id))
  ok('…newest first', tl.every((t, i) => i === 0 || new Date(tl[i - 1].at) >= new Date(t.at)))
  ok('…and nothing of a space one is not in', !tl.some((t) => t.message_id === spaced.id))
  const pinOut = await C.sb.from('network_pins').insert({ user_id: C.id, space_id: spaceId })
  ok('nobody pins a space they are not in', !!pinOut.error)
  /* every space one is in reaches the timeline by default (spaces-reach-home); pins count only where
     the site has turned pinning on (p_all_spaces false) */
  const tlB0 = (await B.sb.rpc('network_timeline', { p_before: null, p_limit: 50 })).data || []
  ok('by default a space one is in reaches one’s timeline, nothing pinned', tlB0.some((t) => t.kind === 'space' && t.message_id === spaced.id))
  const tlB0p = (await B.sb.rpc('network_timeline', { p_before: null, p_limit: 50, p_all_spaces: false })).data || []
  ok('with pinning on, a space one has not pinned does not', !tlB0p.some((t) => t.message_id === spaced.id))
  await B.sb.from('network_pins').insert({ user_id: B.id, space_id: spaceId })
  const tlB = (await B.sb.rpc('network_timeline', { p_before: null, p_limit: 50, p_all_spaces: false })).data || []
  ok('with pinning on, a pinned space’s feed runs through its member’s timeline', tlB.some((t) => t.kind === 'space' && t.message_id === spaced.id))
  const older = (await C.sb.rpc('network_timeline', { p_before: tl[0]?.at, p_limit: 50 })).data || []
  ok('the timeline pages backwards', older.every((t) => new Date(t.at) < new Date(tl[0].at)))

  /* a mute: gone from the timeline, still readable, and never told */
  await C.sb.from('network_mutes').insert({ muter_id: C.id, muted_id: A.id })
  tl = (await C.sb.rpc('network_timeline', { p_before: null, p_limit: 50 })).data || []
  ok('a muted person is gone from the timeline', !tl.some((t) => t.post_id === everyone.id))
  ok('…and still readable where one goes to look', (await sees(C.sb, [everyone.id])).has(everyone.id))
  ok('…and the muted person is never told', ((await A.sb.from('network_mutes').select('muter_id').eq('muted_id', A.id)).data || []).length === 0)
  await C.sb.from('network_mutes').delete().eq('muter_id', C.id)

  /* notifications: a like, a follow, a reply — to the author */
  const notes = (await A.sb.rpc('network_notifications', { p_before: null, p_limit: 50 })).data || []
  ok('the author is told of a like, a follow and a reply', ['like', 'follow', 'reply'].every((r) => notes.some((n) => n.reason === r)), notes.map((n) => n.reason).join(','))
  const unread = (await A.sb.rpc('network_unread')).data
  await A.sb.from('network_seen').upsert({ user_id: A.id, seen_at: new Date().toISOString() })
  const after = (await A.sb.rpc('network_unread')).data
  ok('what is unread is counted, and looking clears it', unread > 0 && after === 0, `${unread} → ${after}`)

  /* ------------------------------------------------------------ a block */
  await A.sb.from('network_follows').insert({ follower_id: A.id, subject_id: B.id })
  const bPost = await post(B, { text: 'B to everyone', audience: 'everyone' })
  await B.sb.from('network_blocks').insert({ blocker_id: B.id, blocked_id: A.id })
  const followsLeft = (await service.from('network_follows').select('id').eq('follower_id', A.id).eq('subject_id', B.id)).data || []
  ok('a block ends the follow', followsLeft.length === 0)
  ok('the blocked cannot read the blocker', !(await sees(A.sb, [bPost.id])).has(bPost.id))
  ok('…nor the blocker the blocked', !(await sees(B.sb, [everyone.id])).has(everyone.id))
  const refollow = await A.sb.from('network_follows').insert({ follower_id: A.id, subject_id: B.id })
  ok('…nor follow again', !!refollow.error)
  const replyBlocked = await A.sb.from('network_posts').insert({ author_id: A.id, text: 'over the wall', audience: 'everyone', reply_parent_id: bPost.id })
  ok('…nor reply', !!replyBlocked.error)
  const likeBlocked = await A.sb.from('network_likes').insert({ author_id: A.id, post_id: bPost.id })
  ok('…nor like', !!likeBlocked.error)
  ok('a block is read by the blocker alone', ((await A.sb.from('network_blocks').select('blocker_id').eq('blocked_id', A.id)).data || []).length === 0)
  await B.sb.from('network_blocks').delete().eq('blocker_id', B.id)
  ok('lifting the block lets them read each other again', (await sees(A.sb, [bPost.id])).has(bPost.id))

  /* ------------------------------------------------------------ moderation */
  const rep = await C.sb.rpc('network_report', { p_post: everyone.id, p_person: null, p_reason: 'spam', p_note: null })
  const rep2 = await C.sb.rpc('network_report', { p_post: everyone.id, p_person: null, p_reason: 'spam', p_note: null })
  ok('a member reports a post, once', !rep.error && rep.data === rep2.data, rep.error?.message)
  const notMod = await C.sb.rpc('network_remove_post', { p_post: everyone.id, p_reason: 'no' })
  ok('only a moderator removes a post', !!notMod.error)
  const removed = await M.sb.rpc('network_remove_post', { p_post: everyone.id, p_reason: 'spam' })
  ok('a moderator removes it', !removed.error, removed.error?.message)
  ok('…and nobody else reads it', !(await sees(B.sb, [everyone.id])).has(everyone.id) && !(await sees(C.sb, [everyone.id])).has(everyone.id))
  ok('…but its author still does', (await sees(A.sb, [everyone.id])).has(everyone.id))
  const answered = (await service.from('network_moderation').select('answered_at').eq('id', rep.data).single()).data
  ok('…and the report is answered', !!answered?.answered_at)
  const rewrite = await M.sb.from('network_moderation').update({ reason: 'changed' }).eq('id', rep.data).select()
  const erase = await M.sb.from('network_moderation').delete().eq('id', rep.data).select()
  ok('the record cannot be edited or deleted, even by a moderator', (rewrite.error || !(rewrite.data || []).length) && (erase.error || !(erase.data || []).length))

  const cPost = await post(C, { text: 'C before', audience: 'here' })
  const susp = await M.sb.rpc('network_suspend', { p_person: C.id, p_until: null, p_reason: 'test' })
  ok('a moderator suspends somebody', !susp.error, susp.error?.message)
  const blocked = await C.sb.from('network_posts').insert({ author_id: C.id, text: 'still here?', audience: 'here' })
  ok('a suspended person cannot post', !!blocked.error)
  ok('…and nobody else reads what they wrote', !(await sees(B.sb, [cPost.id])).has(cPost.id))
  const lift = await M.sb.rpc('network_lift', { p_act: susp.data, p_reason: 'served' })
  ok('a suspension is lifted by a row of its own', !lift.error && !!lift.data, lift.error?.message)
  ok('…and what they wrote is read again', (await sees(B.sb, [cPost.id])).has(cPost.id))
  const kinds = ((await service.from('network_moderation').select('kind').in('subject_id', [A.id, C.id])).data || []).map((r) => r.kind).sort()
  ok('every act is written down', ['lift', 'remove-post', 'report', 'suspend'].every((k) => kinds.includes(k)), kinds.join(','))

  /* ---- MESSAGE FROM A PERSON'S PAGE: offered where a DM may be opened, under space_dm_open's rules */
  await service.from('space_members').upsert([{ space_id: spaceId, user_id: A.id }, { space_id: spaceId, user_id: B.id }], { onConflict: 'space_id,user_id' })
  await service.from('spaces').update({ dms: true }).eq('id', spaceId)
  await service.from('space_members').update({ dms: true }).eq('space_id', spaceId).eq('user_id', B.id)
  /* the two may share other spaces on a seeded stack, so each case asks about THIS space being offered */
  const offered = async () => (await A.sb.rpc('space_dm_where', { p_with: B.id })).data
  const elsewhere = async () => ((await service.from('space_members').select('space_id').eq('user_id', A.id)).data || []).length > 1
  ok('two people in one space with direct messages on: Message is offered', (await offered()) != null)
  ok('…never to somebody the two share no space with', (await A.sb.rpc('space_dm_where', { p_with: C.id })).data == null)
  await service.from('space_members').update({ dms: false }).eq('space_id', spaceId).eq('user_id', B.id)
  ok('somebody who declines them there is not offered there', (await offered()) !== spaceId && ((await elsewhere()) || (await offered()) == null))
  await service.from('space_members').update({ dms: true }).eq('space_id', spaceId).eq('user_id', B.id)
  await service.from('spaces').update({ dms: false }).eq('id', spaceId)
  ok('a space that has none offers none there', (await offered()) !== spaceId)
  await service.from('spaces').update({ dms: true }).eq('id', spaceId)

  /* ---- WHO TAKES PART: read and write as two grants (network.access), as the data script writes them */
  const grant = async (rules) => {
    await service.from('app_settings').delete().eq('key', 'network_access')
    if (rules) await service.from('app_settings').insert({ key: 'network_access', value: JSON.stringify(rules) })
  }
  const given = await service.from('entitlements').insert({ user_id: B.id, kind: 'product', key: PASS, source: 'grant', source_id: PASS }).select().single()
  ok('a pass is given to one reader', !given.error, given.error?.message)
  await grant(null)   /* whatever the site's own config wrote, the test starts open */
  const open = (await A.sb.from('network_posts').insert({ author_id: A.id, text: 'for whoever takes part', audience: 'here' }).select().single()).data
  const admitted = async (who, grantName) => (await who.sb.rpc('network_admitted', { p_user: who.id, p_grant: grantName })).data === true
  ok('with no grants, everyone signed in reads and writes', (await admitted(C, 'read')) && (await admitted(C, 'write')) && (await sees(C.sb, [open.id])).has(open.id))

  await grant({ read: [{ entitlement: PASS }], write: [{ entitlement: PASS }] })
  ok('a paid network: the pass-holder reads what is posted', (await sees(B.sb, [open.id])).has(open.id))
  ok('…and somebody without it reads nothing', !(await sees(C.sb, [open.id])).has(open.id))
  ok('…nor does a guest', !(await sees(guest, [open.id])).has(open.id))
  const cPosts = await C.sb.from('network_posts').insert({ author_id: C.id, text: 'let me in', audience: 'here' })
  ok('…and cannot post', !!cPosts.error)
  ok('…nor follow', !!(await C.sb.from('network_follows').insert({ follower_id: C.id, subject_id: B.id })).error)
  ok('…nor like', !!(await C.sb.from('network_likes').insert({ author_id: C.id, post_id: open.id })).error)
  ok('…while the pass-holder likes', !(await B.sb.from('network_likes').insert({ author_id: B.id, post_id: open.id })).error)
  ok('the staff always take part', (await admitted(M, 'read')))
  ok('an administrator always takes part', (await admitted(M, 'read')) && (await admitted(M, 'write')) && (await sees(M.sb, [open.id])).has(open.id))
  ok('…and the notifications of somebody outside are empty', ((await C.sb.rpc('network_notifications', {})).data || []).length === 0)

  await grant({ write: [{ entitlement: PASS }] })
  ok('free to read, paid to post: anybody signed in reads', (await sees(C.sb, [open.id])).has(open.id) && (await admitted(C, 'read')))
  ok('…and only the pass-holder writes', !!(await C.sb.from('network_posts').insert({ author_id: C.id, text: 'still not', audience: 'here' })).error && !(await admitted(C, 'write')) && (await admitted(B, 'write')))

  await grant({ read: [{ entitlement: PASS }] })
  ok('reading alone given: whoever reads also writes', (await admitted(B, 'write')) && !(await admitted(C, 'write')))
  await grant(null)
  ok('taking the grants away opens it again', (await sees(C.sb, [open.id])).has(open.id) && (await admitted(C, 'write')))

  /* ---- WHO ENTERS EACH PLACE (community.access, community_access): events, messages, notifications */
  const places = async (rules) => {
    await service.from('app_settings').delete().eq('key', 'community_access')
    if (rules) await service.from('app_settings').insert({ key: 'community_access', value: JSON.stringify(rules) })
  }
  const enters = async (who, place) => (await who.sb.rpc('community_admitted', { p_place: place })).data === true
  await places(null)
  ok('with no rule, every place is open to anyone signed in', (await enters(C, 'events')) && (await enters(C, 'messages')) && (await enters(C, 'notifications')))
  const R = [{ entitlement: PASS }]
  await places({ events: R, messages: R, notifications: R })
  ok('a place with a rule admits whoever it holds for', (await enters(B, 'events')) && (await enters(B, 'messages')) && (await enters(B, 'notifications')))
  ok('…and nobody else', !(await enters(C, 'events')) && !(await enters(C, 'messages')) && !(await enters(C, 'notifications')))
  ok('…but the staff', (await enters(M, 'events')) && (await enters(M, 'messages')))
  ok('…and a place without a rule stays open', await enters(C, 'diagnostics'))
  ok('outside Events, no event is listed', ((await C.sb.rpc('events_upcoming', {})).data || []).length === 0)
  ok('outside Messages, no direct message is listed', ((await C.sb.rpc('space_dms', {})).data || []).length === 0)
  ok('…nor opened', !!(await C.sb.rpc('space_dm_open', { p_space: spaceId, p_with: [B.id] })).error)
  ok('outside Notifications, nothing is notified', ((await C.sb.rpc('network_notifications', {})).data || []).length === 0)
  await places(null)
  ok('taking the rules away opens every place again', (await enters(C, 'events')) && (await enters(C, 'messages')))

  /* ------------------------------------------------------------ who to follow */
  await service.from('profiles').update({ public_profile: true, username: 'nt-' + SLUG.slice(-6) }).eq('id', B.id)
  await service.from('network_follows').delete().eq('follower_id', C.id).eq('subject_id', B.id)   /* somebody already followed is never suggested */
  const suggests = async () => { const r = await C.sb.rpc('network_suggestions', { p_limit: 50 }); return { error: r.error, ids: new Set(r.data || []) } }
  let sg = await suggests()
  ok('who to follow answers', !sg.error, sg.error && sg.error.message)
  ok('…with somebody who has a page', sg.ids.has(B.id))
  await C.sb.from('network_mutes').insert({ muter_id: C.id, muted_id: B.id })
  sg = await suggests()
  ok('…and never somebody muted', !sg.error && !sg.ids.has(B.id))
  await C.sb.from('network_mutes').delete().eq('muter_id', C.id).eq('muted_id', B.id)

  /* ------------------------------------------------------------ pictures and videos */
  const vpath = A.id + '/' + SLUG + '.mp4', ppath = A.id + '/' + SLUG + '.poster.jpg'
  const { data: mp, error: me2 } = await A.sb.from('network_posts').insert({ author_id: A.id, text: 'a video', audience: 'here',
    media: [{ kind: 'video', path: vpath, poster: ppath, mime: 'video/mp4', size: 1, width: 1080, height: 1920 }, { kind: 'image', path: A.id + '/' + SLUG + '.jpg', mime: 'image/jpeg', size: 1 }] }).select('id').single()
  ok('a post carries pictures and a video', !me2, me2 && me2.message)
  const canSee = async (who, name) => (await who.rpc('network_can_read_image', { p_name: name })).data === true
  ok('…whoever may read the post may fetch the video and its poster', (await canSee(B.sb, vpath)) && (await canSee(B.sb, ppath)))
  ok('…and nobody outside may', !(await canSee(guest, vpath)) && !(await canSee(guest, ppath)))
  const tooMany = await A.sb.from('network_posts').insert({ author_id: A.id, text: 'eleven', audience: 'here', media: Array.from({ length: 11 }, (_, i) => ({ kind: 'image', path: A.id + '/' + i + '.jpg' })) })
  ok('…and never more than ten', !!tooMany.error)
  /* For You: the media posts the reader may read, and nothing else */
  const fy = async (who) => ((await who.rpc('network_for_you', { p_offset: 0, p_limit: 60 })).data || []).map((r) => r.id)
  const plain = await post(A, { text: 'words alone', audience: 'here' })
  const bSees = await fy(B.sb)
  ok('For You holds a media post the reader may read', mp && bSees.includes(mp.id))
  ok('…never a post without pictures or video', !bSees.includes(plain.id))
  ok('…and nothing for somebody signed out', (await fy(guest)).length === 0)
  if (mp) await service.from('network_posts').delete().eq('id', mp.id)
} catch (e) {
  fail++
  console.log('  FAIL  the run — ' + (e?.message || e))
} finally {
  /* everything it made, gone */
  if (people.length) {
    await service.from('network_moderation').delete().in('subject_id', people)
    await service.from('network_moderation').delete().in('actor_id', people)
    for (const [t, col] of [['network_likes', 'author_id'], ['network_reposts', 'author_id'], ['network_follows', 'follower_id'], ['network_blocks', 'blocker_id'], ['network_mutes', 'muter_id'], ['network_pins', 'user_id'], ['network_seen', 'user_id'], ['network_posts', 'author_id']]) {
      await service.from(t).delete().in(col, people)
    }
    for (const [id, p] of profilesBefore) await service.from('profiles').update({ public_profile: p.public_profile, username: p.username }).eq('id', id)
  }
  if (spaceId) await service.from('spaces').delete().eq('id', spaceId)
  await service.from('entitlements').delete().eq('key', PASS)
  await service.from('app_settings').delete().eq('key', 'network_access')
  if (accessBefore) await service.from('app_settings').insert({ key: 'network_access', value: accessBefore.value })
  await service.from('app_settings').delete().eq('key', 'community_access')
  if (placesBefore) await service.from('app_settings').insert({ key: 'community_access', value: placesBefore.value })
}

console.log(`network-db: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
