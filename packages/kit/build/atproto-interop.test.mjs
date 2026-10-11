/* THE WIDER NETWORK, checked by the network's own tools (openspec: social-network, atproto-api) — the
   things a relay and an app view do to a server, done here with Bluesky's own libraries:

   - a PLC directory of our own on a local port, which accepts an identity only where
     @did-plc/lib says its genesis operation is valid and the DID is the hash of it;
   - the member's repository fetched whole and verified by @atproto/repo against the signing key
     their DID document names: their everyone post in it, their post to the people here not;
   - the event stream read by @atproto/sync's Firehose — the consumer a relay is built on, which
     checks every commit's signature against the DID document — dropped and resumed from its cursor,
     every event once, in order;
   - a moderator's removal reaching the stream as a deletion, and leaving reaching it as the
     account's deactivation, the repository answering as gone.

   It needs the atproto function served with NETWORK_FEDERATE=1, NETWORK_PLC_URL pointing at this
   test's directory (http://host.docker.internal:2582 from the stack) and a NETWORK_PLC_ROTATION_KEY;
   it skips itself, saying which is missing, otherwise. ATPROTO_INTEROP_TEST=0 skips it too. */
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { assureValidCreationOp, didForCreateOp, opToData } from '@did-plc/lib'
import { verifyRepoCar } from '@atproto/repo'
import { Firehose, MemoryRunner } from '@atproto/sync'
import { IdResolver, MemoryCache } from '@atproto/identity'
import { verifyJwt } from '@atproto/xrpc-server'
import { AtpAgent } from '@atproto/api'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('atproto-interop: ' + m)
if (process.env.ATPROTO_INTEROP_TEST === '0') { note('skipped (ATPROTO_INTEROP_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
const FN = url + '/functions/v1/atproto'
const PORT = Number(process.env.ATPROTO_PLC_PORT || 2582)

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(400) } return null }

/* ------------------------------------------------------------ a PLC directory of our own */
const ops = new Map()
const plc = http.createServer(async (req, res) => {
  const did = decodeURIComponent(req.url.slice(1))
  if (req.method === 'POST') {
    let body = ''; for await (const c of req) body += c
    try {
      const op = JSON.parse(body)
      if ((await didForCreateOp(op)) !== did) throw new Error('the DID is not the hash of its genesis operation')
      await assureValidCreationOp(did, op)
      ops.set(did, op)
      res.writeHead(200).end('{}')
    } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: e.message })) }
    return
  }
  const op = ops.get(did)
  if (!op) { res.writeHead(404).end('{}'); return }
  const d = opToData(did, op)
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did, alsoKnownAs: d.alsoKnownAs,
    verificationMethod: [{ id: did + '#atproto', type: 'Multikey', controller: did, publicKeyMultibase: d.verificationMethods.atproto.replace(/^did:key:/, '') }],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: d.services.atproto_pds.endpoint }],
  }))
})
await new Promise((r, j) => plc.listen(PORT, '0.0.0.0', r).on('error', j))

/* ------------------------------------------------------------ an app view of our own, standing in for Bluesky's:
   it answers only a service token that verifies — by Bluesky's own server library — against the key
   the asking member's DID document names, addressed to it, for the method asked */
const APPVIEW_DID = 'did:web:appview.test'
const OUTSIDER = 'did:plc:outsideoutsideoutsideout'
const asked = []
const outsidePost = { uri: `at://${OUTSIDER}/app.bsky.feed.post/3kzzzzzzzzzzz`, cid: 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm', author: { did: OUTSIDER, handle: 'someone.elsewhere.test' }, record: { $type: 'app.bsky.feed.post', text: 'hello from elsewhere', createdAt: new Date().toISOString() }, indexedAt: new Date(Date.now() + 60000).toISOString() }
const appview = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const nsid = u.pathname.replace('/xrpc/', '')
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/, '')
    const payload = await verifyJwt(token, APPVIEW_DID, nsid, async (iss) => {
      const op = ops.get(iss.split('#')[0]); if (!op) throw new Error('unknown issuer')
      return opToData(iss.split('#')[0], op).verificationMethods.atproto
    })
    asked.push({ nsid, iss: payload.iss })
  } catch (e) { res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'AuthRequired', message: e.message })); return }
  const out = nsid === 'app.bsky.feed.getTimeline' ? { feed: [{ post: outsidePost }] }
    : nsid === 'app.bsky.actor.getProfile' ? { did: OUTSIDER, handle: 'someone.elsewhere.test', displayName: 'Somebody elsewhere' }
    : nsid === 'app.bsky.notification.listNotifications' ? { notifications: [] }
    : {}
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out))
})
await new Promise((r, j) => appview.listen(PORT + 1, '0.0.0.0', r).on('error', j))

const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const site = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id, token: data.session.access_token }
}
const SLUG = 'iop-' + Math.random().toString(36).slice(2, 7)
let A = null, M = null, before = null, identity = null

try {
  const probe = await fetch(FN + '/xrpc/com.atproto.sync.listRepos').then((r) => r.json()).catch(() => null)
  if (!probe || probe.error) { note('skipped — the function does not federate here (serve it with NETWORK_FEDERATE=1)'); plc.close(); appview.close(); process.exit(0) }

  A = await site('member@example.com'); M = await site('admin@example.com')
  before = (await service.from('profiles').select('username, public_profile').eq('id', A.id).single()).data
  await service.from('profiles').update({ username: SLUG }).eq('id', A.id)
  for (const [t, col] of [['network_likes', 'author_id'], ['network_reposts', 'author_id'], ['network_follows', 'follower_id'], ['network_posts', 'author_id']]) await service.from(t).delete().eq(col, A.id)
  const old = (await service.from('network_identities').select('did').eq('user_id', A.id).maybeSingle()).data
  if (old) { await service.from('network_seq').delete().eq('did', old.did); await service.from('network_identities').delete().eq('user_id', A.id) }

  /* ------------------------------------------------------------ joining */
  const joined = await fetch(FN + '/network/join', { method: 'POST', headers: { Authorization: 'Bearer ' + A.token } }).then((r) => r.json())
  ok('a member joins the wider network and is given a portable identity', /^did:plc:[a-z2-7]{24}$/.test(joined.did || ''), JSON.stringify(joined))
  identity = joined.did
  ok('…which the PLC directory accepted as a valid genesis operation', ops.has(identity))
  const doc = ops.get(identity) && opToData(identity, ops.get(identity))
  ok('…naming their handle and this site as the server holding their posts', doc && doc.alsoKnownAs[0] === `at://${joined.handle}` && /^https?:/.test(doc.services.atproto_pds.endpoint))

  /* ------------------------------------------------------------ the repository */
  const pe = (await A.sb.from('network_posts').insert({ author_id: A.id, text: 'public, on the wider network', audience: 'everyone' }).select().single()).data
  const ph = (await A.sb.from('network_posts').insert({ author_id: A.id, text: 'only for the people here', audience: 'here' }).select().single()).data
  const head = await until(async () => {
    const r = await fetch(`${FN}/xrpc/com.atproto.sync.getLatestCommit?did=${identity}`).then((x) => x.json()).catch(() => null)
    if (!r || !r.cid) return null
    const car = new Uint8Array(await (await fetch(`${FN}/xrpc/com.atproto.sync.getRepo?did=${identity}`)).arrayBuffer())
    const v = await verifyRepoCar(car, identity, doc.verificationMethods.atproto).catch(() => null)
    const cs = v ? (Array.isArray(v.creates) ? v.creates : Object.values(v.creates || {})) : []
    return cs.some((c) => c.rkey === pe.rkey) ? v : null
  })
  const creates = head ? (Array.isArray(head.creates) ? head.creates : Object.values(head.creates)) : []
  const paths = creates.map((c) => `${c.collection}/${c.rkey}`)
  ok('the repository verifies against the signing key the DID document names', !!head, 'no verified repository')
  ok('…and holds the everyone post', paths.includes(`app.bsky.feed.post/${pe.rkey}`), paths.join(' '))
  ok('…and not the post to the people here', !paths.includes(`app.bsky.feed.post/${ph.rkey}`))
  const rec = await fetch(`${FN}/xrpc/com.atproto.sync.getRecord?did=${identity}&collection=app.bsky.feed.post&rkey=${ph.rkey}`)
  ok('a record kept for the people here is not served by the sync methods', rec.status === 400)

  /* ------------------------------------------------------------ the stream, as a relay reads it */
  const seen = []
  let last = 0
  /* the resolver fetches a did:plc only over https from a named host; the document it would have
     fetched is the one this test's directory holds, built from the operation it accepted — so it is
     put in the resolver's cache, and every commit's signature is still checked against that key */
  const didCache = new MemoryCache()
  const docRes = await new Promise((resolve) => http.get(`http://127.0.0.1:${PORT}/${encodeURIComponent(identity)}`, (r) => { let b = ''; r.on('data', (c) => { b += c }); r.on('end', () => resolve(JSON.parse(b))) }))
  await didCache.cacheDid(identity, docRes)
  const idResolver = new IdResolver({ plcUrl: `http://localhost:${PORT}`, didCache })
  const read = (cursor, stopAfter) => new Promise((resolve) => {
    const runner = new MemoryRunner({ startCursor: cursor })
    const fh = new Firehose({
      idResolver, runner, service: FN.replace(/^http/, 'ws'), unauthenticatedHandles: true,
      handleEvent: async (evt) => { if (evt.did !== identity) return; seen.push({ seq: evt.seq, event: evt.event, path: evt.collection ? `${evt.collection}/${evt.rkey}` : '' }); last = evt.seq; if (seen.length >= stopAfter) { await fh.destroy(); resolve() } },
      onError: (e) => { console.log('  firehose: ' + (e.message || e) + (e.cause ? ' — ' + (e.cause.message || e.cause) : '')) },
    })
    fh.start()
    setTimeout(async () => { await fh.destroy(); resolve() }, 20000)
  })
  await read(0, 2)
  /* a reader stopped mid-stream may finish the event in hand; once it has settled, its place is the
     last number it handled — exactly what a relay keeps */
  await wait(1500)
  last = Math.max(...seen.map((s) => s.seq))
  const firstTwo = seen.slice()
  ok('a relay reads the member\'s events from the start, each commit\'s signature checked', firstTwo.length >= 2, JSON.stringify(firstTwo))
  await read(last, 100)
  /* one commit may carry several records, each its own event under the commit's number: an event is a
     number and a path, and none may come twice; the numbers may not go backwards */
  const all = seen.map((s) => s.seq)
  const keys = seen.map((s) => s.seq + ' ' + s.path)
  ok('…dropped and resumed from its cursor, every event once, in order', all.length > 2 && all.every((s, i) => i === 0 || s >= all[i - 1]) && new Set(keys).size === keys.length, keys.join(','))
  ok('…the everyone post among them as a create', seen.some((s) => s.event === 'create' && s.path === `app.bsky.feed.post/${pe.rkey}`))
  ok('…and nothing of the post to the people here', !seen.some((s) => s.path === `app.bsky.feed.post/${ph.rkey}`))

  /* ------------------------------------------------------------ the world outside */
  const made = await fetch(FN + '/xrpc/com.atproto.server.createAppPassword', { method: 'POST', headers: { Authorization: 'Bearer ' + A.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'interop' }) }).then((r) => r.json())
  const viaFn = (input, init) => { const u = new URL(String(input instanceof Request ? input.url : input)); const to = FN + u.pathname + u.search; return input instanceof Request ? fetch(new Request(to, input), init) : fetch(to, init) }
  const a = new AtpAgent({ service: 'http://site.test', fetch: viaFn })
  await a.login({ identifier: joined.handle, password: made.password })
  const tl = (await a.getTimeline()).data.feed
  ok('a joined member\'s timeline holds what the people they follow elsewhere said', tl.some((f) => f.post.uri === outsidePost.uri), JSON.stringify(tl.map((f) => f.post.uri)))
  ok('…next to their own posts on the site', tl.some((f) => f.post.uri.endsWith('/' + pe.rkey)))
  ok('…asked of the app view with a service token signed by their own key', asked.some((x) => x.nsid === 'app.bsky.feed.getTimeline' && x.iss === identity))
  const prof = (await a.getProfile({ actor: OUTSIDER })).data
  ok('somebody elsewhere is read through the app view', prof.displayName === 'Somebody elsewhere')
  const B = await site('member2@example.com')
  const madeB = await fetch(FN + '/xrpc/com.atproto.server.createAppPassword', { method: 'POST', headers: { Authorization: 'Bearer ' + B.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'interop' }) }).then((r) => r.json())
  const bAgent = new AtpAgent({ service: 'http://site.test', fetch: viaFn })
  await bAgent.login({ identifier: 'member2@example.com', password: madeB.password })
  let refused = ''
  try { await bAgent.getProfile({ actor: OUTSIDER }) } catch (e) { refused = e.message }
  ok('a member who has not joined asks nothing of anybody elsewhere, and is told why', /wider network/.test(refused), refused)
  await service.from('network_app_passwords').delete().in('user_id', [A.id, B.id])

  /* ------------------------------------------------------------ moderation reaches it */
  await M.sb.rpc('network_remove_post', { p_post: pe.id, p_reason: 'test' })
  const gone = await until(async () => {
    const car = new Uint8Array(await (await fetch(`${FN}/xrpc/com.atproto.sync.getRepo?did=${identity}`)).arrayBuffer())
    const v = await verifyRepoCar(car, identity, doc.verificationMethods.atproto).catch(() => null)
    const cs = v ? (Array.isArray(v.creates) ? v.creates : Object.values(v.creates)) : []
    return v && !cs.some((c) => c.rkey === pe.rkey) ? true : null
  })
  ok('a moderator\'s removal takes the post out of the repository', !!gone)
  const del = (await service.from('network_seq').select('body').eq('did', identity).eq('kind', 'commit').order('seq', { ascending: false }).limit(1).single()).data
  ok('…and the stream carries its deletion', del && del.body.ops.some((o) => o.action === 'delete' && o.path === `app.bsky.feed.post/${pe.rkey}`), JSON.stringify(del && del.body.ops))

  /* ------------------------------------------------------------ leaving */
  const left = await fetch(FN + '/network/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + A.token } }).then((r) => r.json())
  const status = await fetch(`${FN}/xrpc/com.atproto.sync.getRepoStatus?did=${identity}`).then((r) => r.json())
  ok('leaving takes the repository down', left.left === true && status.active === false && status.status === 'deactivated', JSON.stringify(status))
  const repoNow = await fetch(`${FN}/xrpc/com.atproto.sync.getRepo?did=${identity}`).then((r) => r.json())
  ok('…and it answers as deactivated', repoNow.error === 'RepoDeactivated', JSON.stringify(repoNow))
  const acct = (await service.from('network_seq').select('body').eq('did', identity).eq('kind', 'account').order('seq', { ascending: false }).limit(1).single()).data
  ok('…and the stream carries the account\'s deactivation', acct && acct.body.active === false && acct.body.status === 'deactivated')
  const again = await fetch(FN + '/network/join', { method: 'POST', headers: { Authorization: 'Bearer ' + A.token } }).then((r) => r.json())
  ok('joining again is the same identity', again.did === identity, JSON.stringify(again))
  await fetch(FN + '/network/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + A.token } })
} catch (e) {
  fail++
  console.log('  FAIL  the run — ' + (e && (e.message || e)))
} finally {
  if (A) {
    for (const [t, col] of [['network_likes', 'author_id'], ['network_reposts', 'author_id'], ['network_follows', 'follower_id'], ['network_dirty', 'user_id'], ['network_posts', 'author_id']]) await service.from(t).delete().eq(col, A.id)
    await service.from('network_moderation').delete().eq('subject_id', A.id)
    if (identity) { await service.from('network_seq').delete().eq('did', identity); await service.from('network_repo_blocks').delete().eq('did', identity); await service.from('network_commits').delete().eq('did', identity) }
    await service.from('network_identities').delete().eq('user_id', A.id)
    if (before) await service.from('profiles').update({ username: before.username, public_profile: before.public_profile }).eq('id', A.id)
  }
  plc.close()
  appview.close()
}

console.log(`atproto-interop: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
