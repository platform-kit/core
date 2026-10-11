/* THE NETWORK AS AN ATPROTO SERVER, against the served function (openspec: atproto-api) — driven by
   Bluesky's own client (@atproto/api), so what passes here is what an app sees. A member makes an
   app password on the site's own session and signs in with it, and is refused with their site
   password; nobody makes an account through the protocol. Then the audiences by every method a
   client reads with: three posts, three readers; a space's post asked for by record, in a list and
   in a thread, by a guest, an outsider and a member; a space's feed as a feed generator, empty to
   anybody outside the room. A client's write goes to the widest audience the writer has. A closed
   site refuses every sync method and anything about somebody elsewhere. Likes, reposts, follows, a
   picture uploaded and posted, a record read back, deleted. Everything it makes is removed.
   Skipped with a note when the stack or the function is down (ATPROTO_TEST=0 skips it too). */
import { createClient } from '@supabase/supabase-js'
import { AtpAgent } from '@atproto/api'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('atproto: ' + m)
if (process.env.ATPROTO_TEST === '0') { note('skipped (ATPROTO_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
const FN = url + '/functions/v1/atproto'
let up = false
try { up = (await fetch(FN + '/xrpc/com.atproto.server.describeServer', { signal: AbortSignal.timeout(60000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the atproto function is not served on the local stack'); process.exit(0) }
/* the handle domain is the function's own answer, never a guess here */
const DOMAIN = (await (await fetch(FN + '/xrpc/com.atproto.server.describeServer')).json()).availableUserDomains[0].slice(1)

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
/* a client always asks /xrpc/<method> at the root of the host it was given: the host here is a name,
   and every request is sent to the function, exactly as the site's rewrite does */
const SITE = 'http://site.test'
/* …and after signing in, a client goes to the server the member's DID document names, which is the
   site's own address; whatever host it is, its /xrpc is the function */
const viaSite = (input, init) => {
  const u = new URL(String(input instanceof Request ? input.url : input))
  const to = u.pathname.startsWith('/xrpc/') ? FN + u.pathname + u.search : u.toString()
  return input instanceof Request ? fetch(new Request(to, input), init) : fetch(to, init)
}
const agent = () => new AtpAgent({ service: SITE, fetch: viaSite })
const xrpc = async (nsid, { token, params, body } = {}) => {
  const q = params ? '?' + new URLSearchParams(params) : ''
  const r = await fetch(`${FN}/xrpc/${nsid}${q}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null) }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const site = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id, token: data.session.access_token }
}

const SLUG = 'at-test-' + Math.random().toString(36).slice(2, 8)
let spaceId = null
const people = []
const before = new Map()

try {
  const A = await site('member@example.com'), B = await site('member2@example.com'), C = await site('free@example.com')
  people.push(A.id, B.id, C.id)
  for (const p of (await service.from('profiles').select('id, username, public_profile').in('id', people)).data || []) before.set(p.id, p)
  /* a username each, so a handle each */
  for (const [who, name] of [[A, SLUG + '-a'], [B, SLUG + '-b'], [C, SLUG + '-c']]) await service.from('profiles').update({ username: name }).eq('id', who.id)
  await service.from('network_app_passwords').delete().in('user_id', people)
  /* this test refuses a wrong password on purpose every run; earlier runs' attempts are not this run's */
  await service.from('network_login_attempts').delete().gte('id', 0)
  /* a clean slate for these three: nothing of the network from an earlier run */
  for (const [t, col] of [['network_likes', 'author_id'], ['network_reposts', 'author_id'], ['network_follows', 'follower_id'], ['network_blocks', 'blocker_id'], ['network_mutes', 'muter_id'], ['network_seen', 'user_id'], ['network_posts', 'author_id']]) await service.from(t).delete().in(col, people)

  /* ------------------------------------------------------------ signing in */
  const made = await xrpc('com.atproto.server.createAppPassword', { token: A.token, body: { name: 'Bluesky on my phone' } })
  ok('a member makes an app password with the site\'s own session', made.status === 200 && /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/.test(made.data && made.data.password), JSON.stringify(made.data))
  const list = await xrpc('com.atproto.server.listAppPasswords', { token: A.token })
  ok('…lists it by name and never by its secret', list.data.passwords.length === 1 && !('password' in list.data.passwords[0]))
  const pw = made.data.password
  const a = agent()
  await a.login({ identifier: SLUG + '-a.' + DOMAIN, password: pw })
  ok('Bluesky\'s client signs in with a handle and the app password', !!a.session && a.session.handle === SLUG + '-a.' + DOMAIN && /^did:web:/.test(a.session.did), JSON.stringify(a.session))
  const byMail = agent()
  await byMail.login({ identifier: 'member@example.com', password: pw })
  ok('…and with the address', !!byMail.session)
  const sitePw = await xrpc('com.atproto.server.createSession', { body: { identifier: 'member@example.com', password: 'password123' } })
  ok('the site\'s own password is refused', sitePw.status === 401, JSON.stringify(sitePw.data))
  const acct = await xrpc('com.atproto.server.createAccount', { body: { handle: 'new.' + DOMAIN, email: 'x@example.com', password: 'x' } })
  ok('no account is made through the protocol, and it says where to sign up', acct.status === 400 && /made on the site/.test(acct.data.message), JSON.stringify(acct.data))
  const me = await a.com.atproto.server.getSession()
  ok('the session is the person', me.data.did === a.session.did)
  const resolved = await xrpc('com.atproto.identity.resolveHandle', { params: { handle: SLUG + '-a.' + DOMAIN } })
  ok('a handle resolves to its DID', resolved.data && resolved.data.did === a.session.did)
  const doc = await fetch(FN + '/.well-known/did.json?host=' + SLUG + '-a.' + DOMAIN).then((r) => r.json())
  ok('…and the DID document names the site as the server holding the posts', doc.id === a.session.did && doc.service[0].type === 'AtprotoPersonalDataServer')

  /* ------------------------------------------------------------ a client's write, and its audience */
  const mine = await a.post({ text: 'written in another app' })
  const row = (await service.from('network_posts').select('audience, text').eq('author_id', A.id).eq('text', 'written in another app').single()).data
  ok('a client\'s post is a row of the network', !!mine.uri && row && row.text === 'written in another app')
  ok('…to the people here, for a member who has not joined the wider network', row && row.audience === 'here', row && row.audience)

  /* ------------------------------------------------------------ three posts, three readers */
  const { data: space } = await service.from('spaces').insert({ slug: SLUG, name: 'An atproto test space', kind: 'community', fill: {} }).select().single()
  spaceId = space.id
  const { data: feed } = await service.from('channels').insert({ space_id: spaceId, slug: 'feed', name: 'Feed', mode: 'feed', visibility: 'open' }).select().single()
  await service.from('space_members').insert([{ space_id: spaceId, user_id: A.id }, { space_id: spaceId, user_id: B.id }])
  const pe = (await A.sb.from('network_posts').insert({ author_id: A.id, text: 'to everyone', audience: 'everyone' }).select().single()).data
  const ph = (await A.sb.from('network_posts').insert({ author_id: A.id, text: 'to the people here', audience: 'here' }).select().single()).data
  const ms = (await A.sb.from('space_messages').insert({ channel_id: feed.id, author_id: A.id, body: 'to the space' }).select().single()).data
  const did = a.session.did
  const uE = `at://${did}/app.bsky.feed.post/${pe.rkey}`, uH = `at://${did}/app.bsky.feed.post/${ph.rkey}`
  const uS = `at://${did}/app.bsky.feed.post/s~${ms.id.replace(/-/g, '')}`

  await xrpc('com.atproto.server.createAppPassword', { token: B.token, body: { name: 't' } }).then(async (r) => { B.pw = r.data.password })
  await xrpc('com.atproto.server.createAppPassword', { token: C.token, body: { name: 't' } }).then(async (r) => { C.pw = r.data.password })
  const b = agent(); await b.login({ identifier: SLUG + '-b.' + DOMAIN, password: B.pw })
  const c = agent(); await c.login({ identifier: SLUG + '-c.' + DOMAIN, password: C.pw })
  const guest = agent()
  const seen = async (ag, uris) => new Set(((await ag.app.bsky.feed.getPosts({ uris })).data.posts || []).map((p) => p.uri))

  await service.from('profiles').update({ public_profile: false }).eq('id', A.id)
  ok('a guest reads nothing of a member whose page is closed', (await seen(guest, [uE, uH, uS])).size === 0)
  await service.from('profiles').update({ public_profile: true }).eq('id', A.id)
  let g = await seen(guest, [uE, uH, uS])
  ok('a guest reads the everyone post once the page is open, and nothing else', g.has(uE) && !g.has(uH) && !g.has(uS), [...g].join(' '))
  const cs = await seen(c, [uE, uH, uS])
  ok('a member outside the space reads the first two and not the space\'s', cs.has(uE) && cs.has(uH) && !cs.has(uS), [...cs].join(' '))
  const bs = await seen(b, [uE, uH, uS])
  ok('a member of the space reads all three', bs.size === 3, [...bs].join(' '))

  /* a space's post, three ways: by record, in an author's list, in a thread */
  const threadOf = async (ag) => { try { const t = await ag.app.bsky.feed.getPostThread({ uri: uS }); return t.data.thread.$type === 'app.bsky.feed.defs#threadViewPost' } catch { return false } }
  const authorHas = async (ag) => ((await ag.app.bsky.feed.getAuthorFeed({ actor: did })).data.feed || []).some((f) => f.post.uri === uS)
  ok('a space\'s post: a guest gets it by no method', !(await threadOf(guest)) && !(await authorHas(guest)) && !(await seen(guest, [uS])).has(uS))
  ok('…an outsider by no method', !(await threadOf(c)) && !(await authorHas(c)) && !(await seen(c, [uS])).has(uS))
  ok('…a member of the space by record and in a thread', (await threadOf(b)) && (await seen(b, [uS])).has(uS))
  ok('…and it is in nobody\'s author feed, being no record of theirs', !(await authorHas(b)))

  /* the space's feed, as a feed generator */
  const gens = (await b.app.bsky.feed.getSuggestedFeeds()).data.feeds
  const gen = gens.find((x) => x.displayName === 'An atproto test space'.slice(0, 24) || x.uri.endsWith('/' + SLUG))
  ok('a member is offered the space\'s feed', !!gen, JSON.stringify(gens.map((x) => x.uri)))
  if (gen) {
    const fb = (await b.app.bsky.feed.getFeed({ feed: gen.uri })).data.feed
    ok('…and reads its posts there', fb.some((f) => f.post.uri === uS))
    const fc = (await c.app.bsky.feed.getFeed({ feed: gen.uri })).data.feed
    ok('an outsider gets an empty feed', fc.length === 0)
  }

  /* ------------------------------------------------------------ the timeline, acts, notifications */
  await c.follow(did)
  const tl = (await c.getTimeline()).data.feed
  ok('the timeline holds the posts of the people one follows', tl.some((f) => f.post.uri === uE) && tl.some((f) => f.post.uri === uH))
  const liked = await c.like(uE, tl.find((f) => f.post.uri === uE).post.cid)
  const rp = await c.repost(uH, tl.find((f) => f.post.uri === uH).post.cid)
  const after = (await c.app.bsky.feed.getPosts({ uris: [uE, uH] })).data.posts
  ok('a like and a repost are counted and marked as the reader\'s own', after.find((p) => p.uri === uE).likeCount === 1 && !!after.find((p) => p.uri === uE).viewer.like && after.find((p) => p.uri === uH).repostCount === 1)
  const reply = await c.post({ text: 'answering, among us', reply: { root: { uri: uH, cid: after.find((p) => p.uri === uH).cid }, parent: { uri: uH, cid: after.find((p) => p.uri === uH).cid } } })
  ok('a reply through the protocol hangs under its post', ((await c.getPostThread({ uri: uH })).data.thread.replies || []).some((r) => r.post.uri === reply.uri))
  const notes = (await a.listNotifications()).data.notifications.map((n) => n.reason)
  ok('the author is told of the follow, the like, the repost and the reply', ['follow', 'like', 'repost', 'reply'].every((r) => notes.includes(r)), notes.join(','))
  const unread = (await a.countUnreadNotifications()).data.count
  await a.updateSeenNotifications()
  ok('unread is counted, and seeing clears it', unread >= 4 && (await a.countUnreadNotifications()).data.count === 0, String(unread))
  await c.deleteLike(liked.uri)
  await c.deleteRepost(rp.uri)
  const undone = (await c.app.bsky.feed.getPosts({ uris: [uE, uH] })).data.posts
  ok('a like and a repost deleted are taken off', undone.find((p) => p.uri === uE).likeCount === 0 && undone.find((p) => p.uri === uH).repostCount === 0)
  const prof = (await c.getProfile({ actor: did })).data
  ok('a profile carries its counts and where the reader stands', prof.followersCount >= 1 && !!prof.viewer.following, JSON.stringify(prof.viewer))

  /* a like on a space's post is the room's own reaction */
  const sp = (await b.app.bsky.feed.getPosts({ uris: [uS] })).data.posts[0]
  const sl = await b.like(uS, sp.cid)
  const reacted = (await service.from('reactions').select('emoji').eq('target_id', ms.id).eq('user_id', B.id)).data || []
  ok('a like on a space\'s post is the room\'s ❤️', reacted.length === 1 && reacted[0].emoji === '❤️')
  await b.deleteLike(sl.uri)
  ok('…and unliking takes it back', ((await service.from('reactions').select('emoji').eq('target_id', ms.id).eq('user_id', B.id)).data || []).length === 0)

  /* a picture, uploaded and posted */
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253, 227, 85, 242, 156, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
  const blob = (await a.uploadBlob(png, { encoding: 'image/png' })).data.blob
  ok('a picture uploads and is named by its hash', /^bafkrei/.test(String(blob.ref)), String(blob.ref))
  const withPic = await a.post({ text: 'a picture', embed: { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: 'one pixel' }] } })
  const pv = (await a.app.bsky.feed.getPosts({ uris: [withPic.uri] })).data.posts[0]
  ok('…and a post carries it, by an address the reader may open', pv && pv.embed && pv.embed.$type === 'app.bsky.embed.images#view' && /^https?:/.test(pv.embed.images[0].fullsize), JSON.stringify(pv && pv.embed))
  const rec = (await a.com.atproto.repo.getRecord({ repo: did, collection: 'app.bsky.feed.post', rkey: withPic.uri.split('/').pop() })).data
  ok('a record reads back with the CID its view had', rec.cid === pv.cid && rec.value.embed.images[0].alt === 'one pixel')
  const bad = await xrpc('com.atproto.repo.createRecord', { token: a.session.accessJwt, body: { repo: did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text: 5 } } })
  ok('a record that is not its lexicon is refused', bad.status === 400 && bad.data.error === 'InvalidRecord', JSON.stringify(bad.data))
  const other = await xrpc('com.atproto.repo.createRecord', { token: a.session.accessJwt, body: { repo: SLUG + '-b.' + DOMAIN, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text: 'not mine', createdAt: new Date().toISOString() } } })
  ok('nobody writes to somebody else\'s repository', other.status === 403)
  await a.deletePost(withPic.uri)
  ok('a post deleted is gone', ((await a.app.bsky.feed.getPosts({ uris: [withPic.uri] })).data.posts || []).length === 0)

  /* ------------------------------------------------------------ a closed site */
  const closed = (await xrpc('com.atproto.sync.listRepos')).data
  if (closed && closed.repos) note('this function federates (NETWORK_FEDERATE): the closed site\'s refusals are not asked here — atproto-interop.test.mjs covers the federating side')
  else {
  const sync = await xrpc('com.atproto.sync.getRepo', { params: { did } })
  ok('a closed site refuses the repository', sync.status === 400 && /closed/.test(sync.data.message), JSON.stringify(sync.data))
  const stream = await xrpc('com.atproto.sync.subscribeRepos')
  ok('…and the event stream', stream.status === 400 && /closed/.test(stream.data.message))
  const outside = await xrpc('app.bsky.actor.getProfile', { token: c.session.accessJwt, params: { actor: 'did:plc:abcdefghijklmnopqrstuvwx' } })
  ok('somebody elsewhere is refused, saying the network is closed', outside.status === 400 && /closed/.test(outside.data.message), JSON.stringify(outside.data))
  }

  /* ------------------------------------------------------------ revoking */
  await xrpc('com.atproto.server.revokeAppPassword', { token: A.token, body: { name: 'Bluesky on my phone' } })
  let after_ = 'still signed in'
  try { await a.getTimeline() } catch (e) { after_ = e.error || e.message }
  ok('revoking an app password ends the sessions made with it', after_ !== 'still signed in', after_)
} catch (e) {
  fail++
  console.log('  FAIL  the run — ' + (e && (e.message || e.error) || e))
} finally {
  if (people.length) {
    await service.from('network_app_passwords').delete().in('user_id', people)
    for (const [t, col] of [['network_likes', 'author_id'], ['network_reposts', 'author_id'], ['network_follows', 'follower_id'], ['network_seen', 'user_id'], ['network_posts', 'author_id']]) await service.from(t).delete().in(col, people)
    const { data: objs } = await service.storage.from('network').list(people[0], { limit: 100 })
    if (objs && objs.length) await service.storage.from('network').remove(objs.map((o) => people[0] + '/' + o.name))
    for (const [id, p] of before) await service.from('profiles').update({ username: p.username, public_profile: p.public_profile }).eq('id', id)
  }
  if (spaceId) await service.from('spaces').delete().eq('id', spaceId)
}

console.log(`atproto: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
