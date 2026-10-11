/*
 * THE SOCIAL NETWORK AS AN ATPROTO SERVER — the personal data server and the app view a client
 * talks to, over the tables the site's own pages use (93-network.sql), so Bluesky's app and any other
 * atproto client signs in with the host swapped. The same move as the Matrix surface
 * (functions/matrix-api), and the same argument: THE TABLES ARE THE STORE AND THIS IS A VIEW OF
 * THEM, and EVERY REQUEST IS SERVED AS THE PERSON (_shared/atproto/session.ts), so what a client may
 * read is what the database's guards let that person read and nothing this function decides.
 *
 * A client reaches this at the site's own address: the host rewrites /xrpc/* and the two identity
 * paths here (deploy/_redirects), and the dev server proxies them. A client always asks for
 * /xrpc/<method> at the ROOT of a host, so the function's own address with a path is not one a client
 * can use.
 *
 *   /.well-known/atproto-did                         a handle's DID, by the host it was asked on
 *   /.well-known/did.json                            a member's did:web document, or the site's own
 *   com.atproto.server.*                             describe, sign in with an app password, refresh,
 *                                                    who am I, sign out; app passwords; no account made here
 *   com.atproto.identity.resolveHandle              a handle on this site, to its DID
 *   com.atproto.repo.*                               create, put, delete, apply, get, list, describe; upload a picture
 *   app.bsky.actor.*                                 profiles, search, preferences
 *   app.bsky.feed.*                                  the timeline, an author, a thread, posts, likes, reposts,
 *                                                    and each space's feed as a feed generator
 *   app.bsky.graph.*                                 follows, followers, blocks, mutes
 *   app.bsky.notification.*                          what happened to them, the count, seen
 *
 * What a closed network refuses, it refuses by name: the sync methods and anything addressed to
 * another server answer that the network is closed (federation is the site's switch and then each
 * member's, openspec social-network).
 */
import { admin, appUrl, isServiceBearer } from '../_shared/lib.ts'
import { project, join, leave, repoStatus, repoCar, recordCar, frameOf, errorFrame } from '../_shared/atproto/federation.ts'
import { joinedIdentity, ask, mergeFeeds } from '../_shared/atproto/appview.ts'
import * as SITE from '../_shared/pipe/site.js'
import { REFUSALS } from '../_shared/atproto/errors.js'
import { POST, LIKE, REPOST, FOLLOW, BLOCK, PROFILE, WRITABLE, uriOf, parseUri, handleOf, cleanDomain, usernameOfHandle, isDid, messageOfKey, cursorOf, clientAllowed } from '../_shared/atproto/ids.js'
import { createSession, sessionOf, refreshSession, deleteSession, loginAllowed, noteAttempt, makeAppPassword, type Session } from '../_shared/atproto/session.ts'
import { newCtx, loadPeople, profileBasic, profileDetailed, postViews, messageViews, feedItems, loadPosts, generatorView, generatorUri, didFor, cidOf, recordOf, type Ctx } from '../_shared/atproto/views.ts'
import { createRecord, deleteRecord, getRecord, listRecords, uploadBlob, putProfile, userOfActor, userOfDid, resolvePost } from '../_shared/atproto/writes.ts'

const S = SITE as { modules?: Record<string, unknown>; network?: { federate?: boolean; apps?: boolean; community?: boolean } }
const NETWORK_ON = (S.modules ?? {}).network !== false
/* the site's switch — and, for a local stack only, NETWORK_FEDERATE=1, so the federation's tests can
   run against a site that does not federate; the deploy refuses it (deploy-checks) */
const FEDERATES = !!(S.network && S.network.federate) || /^(1|true|on)$/i.test(Deno.env.get('NETWORK_FEDERATE') || '')
/* OTHER APPS SIGNING IN — the site owner's choice (network.apps), off by default */
const APPS = !!(S.network && S.network.apps)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, atproto-proxy, atproto-accept-labelers, x-bsky-topics, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const no = (f: { status: number; body: unknown }) => json(f.body, f.status)
const domain = () => cleanDomain(Deno.env.get('NETWORK_HANDLE_DOMAIN') || new URL(appUrl()).hostname)
const siteHost = () => new URL(appUrl()).host
const serviceDid = () => 'did:web:' + siteHost().replace(/:/g, '%3A')
const ipOf = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
const bearer = (req: Request) => (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '') || null

/* the DID document of a member: who they are, the handle they are known by, and this site as the
   server that holds their posts. A did:web has no key here — a closed network signs nothing. */
function didDoc(did: string, handle: string) {
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did,
    alsoKnownAs: [`at://${handle}`],
    verificationMethod: [],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: appUrl() }],
  }
}
/* the site's own document: the service a space's feed generator names */
const serviceDoc = () => ({
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: serviceDid(),
  service: [
    { id: '#bsky_fg', type: 'BskyFeedGenerator', serviceEndpoint: appUrl() },
    { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: appUrl() },
  ],
})

/* who somebody is, for the methods that say so: their DID and handle from their profile */
async function identityOf(userId: string) {
  const { data: p } = await admin.from('profiles').select('id, username, email').eq('id', userId).maybeSingle()
  if (!p) return null
  const { data: i } = await admin.from('network_identities').select('did').eq('user_id', userId).not('joined_at', 'is', null).is('left_at', null).maybeSingle()
  const name = p.username || 'm' + p.id.replace(/-/g, '').slice(-12)
  const handle = handleOf(name, domain())!
  const did = (i && i.did) || 'did:web:' + handle.replace(/:/g, '%3A')
  return { userId, did, handle, email: p.email as string | null }
}

/* the member an identifier names: an address, a handle, or a DID */
async function userOfIdentifier(id: string) {
  const s = String(id || '').trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('did:')) return userOfDid(s, domain())
  if (s.includes('@') && !usernameOfHandle(s, domain())) {
    const { data } = await admin.from('profiles').select('id').eq('email', s).maybeSingle()
    return data ? data.id : null
  }
  return userOfActor(s, domain())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!NETWORK_ON) return no(REFUSALS.off())

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/functions\/v1\/atproto/, '').replace(/^\/atproto/, '') || '/'
  const q = url.searchParams

  /* ---------------------------------------------------------------- who a handle is */
  if (path === '/.well-known/atproto-did' || path === '/.well-known/did.json') {
    const host = String(q.get('host') || req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim().toLowerCase()
    if (host === siteHost().toLowerCase() || !usernameOfHandle(host.replace(/:\d+$/, ''), domain())) {
      return path === '/.well-known/did.json' && host === siteHost().toLowerCase() ? json(serviceDoc()) : new Response('Not found', { status: 404, headers: CORS })
    }
    const user = await userOfActor(host.replace(/:\d+$/, ''), domain())
    const who = user ? await identityOf(user) : null
    if (!who) return new Response('Not found', { status: 404, headers: CORS })
    if (path === '/.well-known/atproto-did') return new Response(who.did, { headers: { ...CORS, 'Content-Type': 'text/plain' } })
    return who.did.startsWith('did:web:') ? json(didDoc(who.did, who.handle)) : new Response('Not found', { status: 404, headers: CORS })
  }

  /* ---------------------------------------------------------------- the database asking */
  /* a joined member's public records changed: every queued member's repository is made to agree */
  if (path === '/internal/project' && req.method === 'POST') {
    if (!(await isServiceBearer(req))) return no(REFUSALS.forbidden())
    const { data: dirty } = await admin.from('network_dirty').select('user_id').order('at').limit(50)
    const done: any[] = []
    for (const d of (dirty || []) as any[]) {
      await admin.from('network_dirty').delete().eq('user_id', d.user_id)
      try { done.push({ user: d.user_id, ...(await project(d.user_id, domain())) }) } catch (e) { console.error('atproto project:', d.user_id, e); done.push({ user: d.user_id, error: String(e) }) }
    }
    return json({ done })
  }

  /* the relay asked to crawl the site again (the daily job), where the site federates */
  if (path === '/internal/crawl' && req.method === 'POST') {
    if (!(await isServiceBearer(req))) return no(REFUSALS.forbidden())
    if (FEDERATES) await requestCrawl()
    return json({ asked: FEDERATES })
  }

  /* ---------------------------------------------------------------- joining the wider network */
  if ((path === '/network/join' || path === '/network/leave') && req.method === 'POST') {
    if (!FEDERATES) return no(REFUSALS.closed())
    const s = await sessionOf(bearer(req))
    if (!s || s === 'expired' || s.kind !== 'site') return no(REFUSALS.auth())
    if (path === '/network/leave') return json(await leave(s.userId))
    const out: any = await join(s.userId, domain())
    if (out.error === 'username') return no(REFUSALS.noHandle())
    if (out.error) return no(REFUSALS.badRequest(out.error))
    await requestCrawl()
    return json(out)
  }

  const m = /^\/xrpc\/([a-zA-Z0-9.]+)$/.exec(path)
  if (!m) return no(REFUSALS.unsupported(path))
  const nsid = m[1]
  if (!clientAllowed(nsid, { apps: APPS, federate: FEDERATES })) return no(REFUSALS.noApps())
  const body = async () => { try { return await req.json() } catch { return {} } }

  try {
    /* ---------------------------------------------------------------- open to anybody */
    if (nsid === 'com.atproto.server.describeServer') {
      return json({ did: serviceDid(), availableUserDomains: ['.' + domain()], inviteCodeRequired: true, phoneVerificationRequired: false, links: { privacyPolicy: appUrl(), termsOfService: appUrl() } })
    }
    if (nsid === 'com.atproto.server.createAccount') return no(REFUSALS.noAccount(appUrl()))
    if (nsid === 'com.atproto.identity.resolveHandle') {
      const user = await userOfActor(String(q.get('handle') || ''), domain())
      const who = user ? await identityOf(user) : null
      return who ? json({ did: who.did }) : no(REFUSALS.badRequest('Unable to resolve handle'))
    }
    if (nsid === 'com.atproto.server.createSession') {
      const b = await body()
      const ip = ipOf(req)
      const allowed = await loginAllowed(ip)
      if (!allowed.ok) return no(REFUSALS.tooMany(allowed.retryAfter))
      const user = await userOfIdentifier(b.identifier)
      const who = user ? await identityOf(user) : null
      const tokens = who ? await createSession(who.userId, String(b.password || ''), who, serviceDid()) : null
      if (!who || !tokens) { await noteAttempt(ip); return no(REFUSALS.badLogin()) }
      return json({ did: who.did, handle: who.handle, ...(who.email ? { email: who.email, emailConfirmed: true } : {}), accessJwt: tokens.accessJwt, refreshJwt: tokens.refreshJwt, active: true, didDoc: who.did.startsWith('did:web:') ? didDoc(who.did, who.handle) : undefined })
    }
    if (nsid === 'com.atproto.server.refreshSession') {
      const r = await refreshSession(bearer(req), identityOf, serviceDid())
      if (r === 'expired') return no(REFUSALS.expired())
      if (!r) return no(REFUSALS.invalidToken())
      return json({ did: r.who.did, handle: r.who.handle, accessJwt: r.accessJwt, refreshJwt: r.refreshJwt, active: true })
    }
    if (nsid === 'com.atproto.server.deleteSession') { await deleteSession(bearer(req)); return json({}) }

    /* ---------------------------------------------------------------- a closed network, said plainly */
    if (/^com\.atproto\.sync\./.test(nsid) && !FEDERATES) return no(REFUSALS.closed())

    /* ---------------------------------------------------------------- the sync methods, where the site federates:
       only a joined member's public repository, to anybody, as every server serves it */
    if (/^com\.atproto\.sync\./.test(nsid)) return await sync(req, nsid, q)
    if (nsid === 'com.atproto.server.getServiceAuth' && !FEDERATES) return no(REFUSALS.closed())
    if (/^chat\.bsky\./.test(nsid)) return no(REFUSALS.unsupported(nsid))

    /* ---------------------------------------------------------------- a guest may read what is open */
    const token = bearer(req)
    let s: Session | null = null
    if (token) {
      const got = await sessionOf(token)
      if (got === 'expired') return no(REFUSALS.expired())
      if (!got) return no(REFUSALS.invalidToken())
      s = got
    }
    const ctx = newCtx(s ? s.db : guestDb(), s ? s.userId : null, domain(), serviceDid())
    const need = () => { if (!s) throw REFUSALS.auth() }
    /* somebody a client names: a member here — or, on a closed site, somebody elsewhere, which is said
       as the network being closed rather than as nobody being there */
    const userOf = async (actor: string | null) => {
      const u = actor ? await userOfActor(actor, domain()) : null
      if (u) return u
      if (!FEDERATES && actor && (String(actor).startsWith('did:') || /\./.test(String(actor))) && !usernameOfHandle(String(actor), domain())) throw REFUSALS.closed()
      throw REFUSALS.noProfile()
    }

    /* THE WORLD OUTSIDE: a read about somebody elsewhere goes to the app view as the member, where
       the site federates and they have joined; anybody else is told why not */
    const OUTSIDE = new Set(['app.bsky.actor.getProfile', 'app.bsky.feed.getAuthorFeed', 'app.bsky.feed.getPostThread', 'app.bsky.feed.getPosts', 'app.bsky.graph.getFollows', 'app.bsky.graph.getFollowers', 'app.bsky.feed.getLikes', 'app.bsky.feed.getRepostedBy', 'app.bsky.feed.getActorLikes'])
    if (OUTSIDE.has(nsid)) {
      const targets = [q.get('actor'), q.get('uri'), ...q.getAll('uris')].filter(Boolean) as string[]
      const foreign = []
      for (const t of targets) { const did = t.startsWith('at://') ? t.slice(5).split('/')[0] : t; if (!(await userOfActor(did, domain()))) foreign.push(t) }
      if (foreign.length && foreign.length === targets.length) {
        if (!FEDERATES) return no(REFUSALS.closed())
        const mine = await joinedIdentity(s ? s.userId : null)
        if (!mine) return no(REFUSALS.notJoined())
        const out = await ask(mine, nsid, q)
        return out ? json(out) : no(REFUSALS.badRequest('The wider network did not answer'))
      }
    }

    /* the protocol's own reads of an account */
    if (nsid === 'com.atproto.server.getSession') {
      need()
      const who = await identityOf(s!.userId)
      return json({ did: who!.did, handle: who!.handle, ...(who!.email ? { email: who!.email, emailConfirmed: true } : {}), active: true, didDoc: who!.did.startsWith('did:web:') ? didDoc(who!.did, who!.handle) : undefined })
    }
    if (nsid === 'com.atproto.server.checkAccountStatus') { need(); return json({ activated: true, validDid: true, repoCommit: '', repoRev: '', repoBlocks: 0, indexedRecords: 0, privateStateValues: 0, expectedBlobs: 0, importedBlobs: 0 }) }
    if (nsid === 'com.atproto.server.createAppPassword') {
      need()
      const b = await body()
      const made = await makeAppPassword(s!.userId, String(b.name || ''))
      if ((made as any).error) return no(REFUSALS.badRequest((made as any).error === 'taken' ? 'An app password with that name already exists' : (made as any).error))
      return json(made)
    }
    if (nsid === 'com.atproto.server.listAppPasswords') {
      need()
      const { data } = await s!.db.from('network_app_passwords').select('name, created_at, last_used_at').order('created_at', { ascending: false })
      return json({ passwords: ((data || []) as any[]).map((p) => ({ name: p.name, createdAt: p.created_at, ...(p.last_used_at ? { lastUsedAt: p.last_used_at } : {}) })) })
    }
    if (nsid === 'com.atproto.server.revokeAppPassword') {
      need()
      const b = await body()
      await s!.db.from('network_app_passwords').delete().eq('name', String(b.name || ''))
      return json({})
    }
    if (nsid === 'com.atproto.identity.updateHandle') return no(REFUSALS.badRequest('A handle here is your username: change it on your account page.'))

    /* ---------------------------------------------------------------- the repository */
    if (nsid === 'com.atproto.repo.describeRepo') {
      const user = await userOf(q.get('repo'))
      const who = await identityOf(user)
      return json({ handle: who!.handle, did: who!.did, didDoc: who!.did.startsWith('did:web:') ? didDoc(who!.did, who!.handle) : {}, collections: WRITABLE, handleIsCorrect: true })
    }
    if (nsid === 'com.atproto.repo.getRecord') {
      const user = await userOf(q.get('repo'))
      const r = await getRecord(ctx, user, String(q.get('collection') || ''), String(q.get('rkey') || ''))
      return r ? json(r) : no(REFUSALS.notFound())
    }
    if (nsid === 'com.atproto.repo.listRecords') {
      const user = await userOf(q.get('repo'))
      return json(await listRecords(ctx, user, String(q.get('collection') || ''), Number(q.get('limit') || 50), q.get('cursor') || undefined))
    }
    if (nsid === 'com.atproto.repo.createRecord' || nsid === 'com.atproto.repo.putRecord') {
      need()
      const b = await body()
      await ownRepo(b.repo, s!)
      if (nsid === 'com.atproto.repo.putRecord' && b.collection === PROFILE) return json(await putProfile(ctx, b.record))
      if (nsid === 'com.atproto.repo.putRecord') await deleteRecord(ctx, b.collection, b.rkey).catch(() => {})
      return json(await createRecord(ctx, b.collection, b.record, b.rkey))
    }
    if (nsid === 'com.atproto.repo.deleteRecord') {
      need()
      const b = await body()
      await ownRepo(b.repo, s!)
      await deleteRecord(ctx, b.collection, b.rkey)
      return json({})
    }
    if (nsid === 'com.atproto.repo.applyWrites') {
      need()
      const b = await body()
      await ownRepo(b.repo, s!)
      const results: any[] = []
      for (const w of b.writes || []) {
        if (w.$type === 'com.atproto.repo.applyWrites#create') results.push({ $type: 'com.atproto.repo.applyWrites#createResult', ...(await createRecord(ctx, w.collection, w.value, w.rkey)) })
        else if (w.$type === 'com.atproto.repo.applyWrites#update') {
          if (w.collection === PROFILE) results.push({ $type: 'com.atproto.repo.applyWrites#updateResult', ...(await putProfile(ctx, w.value)) })
          else { await deleteRecord(ctx, w.collection, w.rkey).catch(() => {}); results.push({ $type: 'com.atproto.repo.applyWrites#updateResult', ...(await createRecord(ctx, w.collection, w.value, w.rkey)) }) }
        } else if (w.$type === 'com.atproto.repo.applyWrites#delete') { await deleteRecord(ctx, w.collection, w.rkey); results.push({ $type: 'com.atproto.repo.applyWrites#deleteResult' }) }
      }
      return json({ results })
    }
    if (nsid === 'com.atproto.repo.uploadBlob') {
      need()
      const bytes = new Uint8Array(await req.arrayBuffer())
      return json(await uploadBlob(ctx, bytes, req.headers.get('content-type') || ''))
    }

    /* ---------------------------------------------------------------- people */
    if (nsid === 'app.bsky.actor.getProfile') {
      const user = await userOf(q.get('actor'))
      const v = await profileDetailed(ctx, user)
      return v ? json(v) : no(REFUSALS.noProfile())
    }
    if (nsid === 'app.bsky.actor.getProfiles') {
      const out = []
      for (const a of q.getAll('actors').slice(0, 25)) { const u = await userOfActor(a, domain()); const v = u ? await profileDetailed(ctx, u) : null; if (v) out.push(v) }
      return json({ profiles: out })
    }
    if (nsid === 'app.bsky.actor.searchActors' || nsid === 'app.bsky.actor.searchActorsTypeahead') {
      const term = String(q.get('q') || q.get('term') || '')
      const { data } = await ctx.db.rpc('network_find', { p_q: term, p_limit: Number(q.get('limit') || 25) })
      const ids = ((data || []) as any[]).map((r) => (typeof r === 'string' ? r : r.network_find))
      await loadPeople(ctx, ids)
      return json({ actors: ids.map((id) => profileBasic(ctx, id)).filter(Boolean) })
    }
    if (nsid === 'app.bsky.actor.getPreferences') {
      need()
      const { data } = await s!.db.from('network_prefs').select('prefs').eq('user_id', s!.userId).maybeSingle()
      return json({ preferences: (data && data.prefs) || [] })
    }
    if (nsid === 'app.bsky.actor.putPreferences') {
      need()
      const b = await body()
      await s!.db.from('network_prefs').upsert({ user_id: s!.userId, prefs: b.preferences || [], updated_at: new Date().toISOString() })
      return json({})
    }
    if (nsid === 'app.bsky.actor.getSuggestions') return json({ actors: [] })

    /* ---------------------------------------------------------------- the timeline and feeds */
    if (nsid === 'app.bsky.feed.getTimeline') {
      need()
      const { data, error } = await s!.db.rpc('network_timeline', { p_before: q.get('cursor') || null, p_limit: Math.min(Number(q.get('limit') || 30), 100) })
      if (error) throw REFUSALS.badRequest(error.message)
      const rows = (data || []) as any[]
      let feed = await feedItems(ctx, rows)
      /* a joined member's first page is the site's own timeline and Bluesky's view of theirs, made one
         — the people they follow elsewhere are in Bluesky's; a later page is the site's own */
      const mine = FEDERATES && !q.get('cursor') ? await joinedIdentity(s!.userId) : null
      if (mine) { const outside = await ask(mine, nsid, { limit: String(Math.min(Number(q.get('limit') || 30), 100)) }); if (outside && outside.feed) feed = mergeFeeds(feed, outside.feed, Math.min(Number(q.get('limit') || 30), 100)) }
      return json({ feed, ...(rows.length ? { cursor: cursorOf(rows, 'at') } : {}) })
    }
    if (nsid === 'app.bsky.feed.getAuthorFeed') {
      const user = await userOf(q.get('actor'))
      const limit = Math.min(Number(q.get('limit') || 30), 100)
      const before = q.get('cursor')
      const filter = q.get('filter') || 'posts_with_replies'
      let pq = ctx.db.from('network_posts').select('id, created_at, reply_parent_id, media').eq('author_id', user).order('created_at', { ascending: false }).limit(limit)
      if (before) pq = pq.lt('created_at', before)
      let rq = ctx.db.from('network_reposts').select('post_id, created_at').eq('author_id', user).not('post_id', 'is', null).order('created_at', { ascending: false }).limit(limit)
      if (before) rq = rq.lt('created_at', before)
      const [p, r] = await Promise.all([pq, filter === 'posts_with_media' ? Promise.resolve({ data: [] }) : rq])
      let posts = ((p.data || []) as any[])
      if (filter === 'posts_no_replies' || filter === 'posts_and_author_threads') posts = posts.filter((x) => !x.reply_parent_id)
      if (filter === 'posts_with_media') posts = posts.filter((x) => (x.media || []).length)
      const items = [
        ...posts.map((x) => ({ post_id: x.id, at: x.created_at })),
        ...((r.data || []) as any[]).map((x) => ({ post_id: x.post_id, reposted_by: user, at: x.created_at })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit)
      return json({ feed: await feedItems(ctx, items), ...(items.length === limit ? { cursor: cursorOf(items, 'at') } : {}) })
    }
    if (nsid === 'app.bsky.feed.getPosts') {
      const ids: string[] = [], msgs: string[] = [], order: string[] = []
      for (const u of q.getAll('uris').slice(0, 25)) {
        const r = await resolvePost(ctx, u)
        if (r && (r as any).post) { ids.push((r as any).post); order.push('p' + (r as any).post) }
        else if (r && (r as any).message) { msgs.push((r as any).message); order.push('m' + (r as any).message) }
      }
      const [pv, mv] = await Promise.all([postViews(ctx, ids), messageViews(ctx, msgs)])
      return json({ posts: order.map((k) => (k[0] === 'p' ? pv.get(k.slice(1)) : mv.get(k.slice(1)))).filter(Boolean) })
    }
    if (nsid === 'app.bsky.feed.getPostThread') return json({ thread: await thread(ctx, String(q.get('uri') || ''), Number(q.get('depth') || 6), Number(q.get('parentHeight') || 80)) })
    if (nsid === 'app.bsky.feed.getLikes' || nsid === 'app.bsky.feed.getRepostedBy') {
      const r = await resolvePost(ctx, String(q.get('uri') || ''))
      if (!r || !(r as any).post) return json(nsid === 'app.bsky.feed.getLikes' ? { uri: q.get('uri'), likes: [] } : { uri: q.get('uri'), repostedBy: [] })
      const { data } = await ctx.db.from(nsid === 'app.bsky.feed.getLikes' ? 'network_likes' : 'network_reposts').select('author_id, created_at').eq('post_id', (r as any).post).order('created_at', { ascending: false }).limit(Math.min(Number(q.get('limit') || 50), 100))
      const rows = (data || []) as any[]
      await loadPeople(ctx, rows.map((x) => x.author_id))
      if (nsid === 'app.bsky.feed.getRepostedBy') return json({ uri: q.get('uri'), repostedBy: rows.map((x) => profileBasic(ctx, x.author_id)).filter(Boolean) })
      return json({ uri: q.get('uri'), likes: rows.map((x) => ({ actor: profileBasic(ctx, x.author_id), createdAt: x.created_at, indexedAt: x.created_at })).filter((x) => x.actor) })
    }
    if (nsid === 'app.bsky.feed.getQuotes') return json({ uri: q.get('uri'), posts: [] })
    if (nsid === 'app.bsky.feed.getActorLikes') return json({ feed: [] })
    if (nsid === 'app.bsky.feed.searchPosts') return json({ posts: [] })

    /* EACH SPACE'S FEED, as a feed generator the site itself answers for — for a member of the
       space, its posts; for anybody else, nothing at all */
    if (nsid === 'app.bsky.feed.getFeedGenerator' || nsid === 'app.bsky.feed.getFeedGenerators' || nsid === 'app.bsky.feed.getSuggestedFeeds' || nsid === 'app.bsky.unspecced.getPopularFeedGenerators' || nsid === 'app.bsky.feed.getActorFeeds') {
      const spaces = s ? (((await s.db.rpc('network_spaces')).data || []) as any[]).filter((x) => x.channel_id) : []
      const views = await Promise.all(spaces.map((x) => generatorView(ctx, x)))
      if (nsid === 'app.bsky.feed.getFeedGenerator') {
        const v = views.find((x) => x.uri === q.get('feed'))
        return v ? json({ view: v, isOnline: true, isValid: true }) : no(REFUSALS.notFound('Feed'))
      }
      const want = q.getAll('feeds')
      return json({ feeds: want.length ? views.filter((v) => want.includes(v.uri)) : views })
    }
    if (nsid === 'app.bsky.feed.describeFeedGenerator') {
      const spaces = s ? (((await s.db.rpc('network_spaces')).data || []) as any[]).filter((x) => x.channel_id) : []
      return json({ did: serviceDid(), feeds: spaces.map((x) => ({ uri: generatorUri(ctx, x.slug) })) })
    }
    if (nsid === 'app.bsky.feed.getFeed' || nsid === 'app.bsky.feed.getFeedSkeleton') {
      const feed = parseUri(String(q.get('feed') || ''))
      if (!feed || feed.did !== serviceDid()) return no(REFUSALS.notFound('Feed'))
      const spaces = s ? (((await s.db.rpc('network_spaces')).data || []) as any[]) : []
      const sp = spaces.find((x) => x.slug === feed.rkey && x.channel_id)
      if (!sp) return json({ feed: [] })
      let mq = s!.db.from('space_messages').select('id, created_at').eq('channel_id', sp.channel_id).is('thread_root_id', null).is('deleted_at', null).neq('kind', 'system').order('created_at', { ascending: false }).limit(Math.min(Number(q.get('limit') || 30), 100))
      if (q.get('cursor')) mq = mq.lt('created_at', q.get('cursor'))
      const rows = ((await mq).data || []) as any[]
      if (nsid === 'app.bsky.feed.getFeedSkeleton') {
        const mv = await messageViews(ctx, rows.map((r) => r.id))
        return json({ feed: rows.map((r) => mv.get(r.id)).filter(Boolean).map((v: any) => ({ post: v.uri })), ...(rows.length ? { cursor: cursorOf(rows) } : {}) })
      }
      return json({ feed: await feedItems(ctx, rows.map((r) => ({ message_id: r.id, at: r.created_at }))), ...(rows.length ? { cursor: cursorOf(rows) } : {}) })
    }

    /* ---------------------------------------------------------------- who follows whom */
    if (nsid === 'app.bsky.graph.getFollows' || nsid === 'app.bsky.graph.getFollowers') {
      const user = await userOf(q.get('actor'))
      const follows = nsid === 'app.bsky.graph.getFollows'
      const { data } = await ctx.db.from('network_follows').select('follower_id, subject_id, created_at').eq(follows ? 'follower_id' : 'subject_id', user).not('subject_id', 'is', null).order('created_at', { ascending: false }).limit(Math.min(Number(q.get('limit') || 50), 100))
      const ids = ((data || []) as any[]).map((r) => (follows ? r.subject_id : r.follower_id))
      await loadPeople(ctx, [user, ...ids])
      const subject = profileBasic(ctx, user)
      const list = ids.map((id) => profileBasic(ctx, id)).filter(Boolean)
      return json(follows ? { subject, follows: list } : { subject, followers: list })
    }
    if (nsid === 'app.bsky.graph.getBlocks' || nsid === 'app.bsky.graph.getMutes') {
      need()
      const blocks = nsid === 'app.bsky.graph.getBlocks'
      const { data } = await s!.db.from(blocks ? 'network_blocks' : 'network_mutes').select(blocks ? 'blocked_id' : 'muted_id').eq(blocks ? 'blocker_id' : 'muter_id', s!.userId)
      const ids = ((data || []) as any[]).map((r) => r.blocked_id || r.muted_id)
      await loadPeople(ctx, ids)
      return json(blocks ? { blocks: ids.map((id) => profileBasic(ctx, id)).filter(Boolean) } : { mutes: ids.map((id) => profileBasic(ctx, id)).filter(Boolean) })
    }
    if (nsid === 'app.bsky.graph.muteActor' || nsid === 'app.bsky.graph.unmuteActor') {
      need()
      const b = await body()
      const user = await userOf(b.actor)
      if (nsid === 'app.bsky.graph.muteActor') await s!.db.from('network_mutes').insert({ muter_id: s!.userId, muted_id: user })
      else await s!.db.from('network_mutes').delete().eq('muter_id', s!.userId).eq('muted_id', user)
      return json({})
    }
    if (/^app\.bsky\.graph\.(getLists|getListMutes|getListBlocks|getStarterPacks|getActorStarterPacks)$/.test(nsid)) return json({ lists: [], starterPacks: [] })
    if (nsid === 'app.bsky.graph.getSuggestedFollowsByActor') return json({ suggestions: [] })
    if (nsid === 'app.bsky.graph.getRelationships') {
      const me = s ? s.userId : null
      const actor = await userOf(q.get('actor'))
      const others = []
      for (const o of q.getAll('others')) { const u = await userOfActor(o, domain()); if (u) others.push(u) }
      await loadPeople(ctx, [actor, ...others])
      return json({ actor: didFor(ctx, actor), relationships: others.map((u) => ({ $type: 'app.bsky.graph.defs#relationship', did: didFor(ctx, u), ...(me === actor ? ctx.rel.get(u) || {} : {}) })) })
    }

    /* ---------------------------------------------------------------- what happened to me */
    if (nsid === 'app.bsky.notification.listNotifications') {
      need()
      const { data } = await s!.db.rpc('network_notifications', { p_before: q.get('cursor') || null, p_limit: Math.min(Number(q.get('limit') || 50), 100) })
      const rows = (data || []) as any[]
      const { data: seen } = await s!.db.from('network_seen').select('seen_at').eq('user_id', s!.userId).maybeSingle()
      await loadPeople(ctx, [s!.userId, ...rows.map((r) => r.actor_id)])
      await loadPosts(ctx, rows.flatMap((r) => [r.post_id, r.subject_post_id]))
      const notes = []
      for (const r of rows) {
        const author = profileBasic(ctx, r.actor_id)
        if (!author) continue
        const rec = r.post_id ? ctx.posts.get(r.post_id) : null
        const subj = r.subject_post_id ? ctx.posts.get(r.subject_post_id) : null
        const record = r.reason === 'follow' ? { $type: FOLLOW, subject: didFor(ctx, s!.userId), createdAt: r.at }
          : rec ? await recordOf(ctx, rec)
          : { $type: r.reason === 'like' ? LIKE : REPOST, subject: subj ? { uri: uriOf(didFor(ctx, subj.author_id), POST, subj.rkey), cid: '' } : undefined, createdAt: r.at }
        const uri = rec ? uriOf(author.did, POST, rec.rkey) : `at://${author.did}/${r.reason === 'follow' ? FOLLOW : r.reason === 'like' ? LIKE : REPOST}/${String(r.at).replace(/\D/g, '').slice(0, 13)}`
        notes.push({
          uri, cid: await cidOf(ctx, 'n' + uri, record), author, reason: r.reason, record,
          ...(subj ? { reasonSubject: uriOf(didFor(ctx, subj.author_id), POST, subj.rkey) } : {}),
          isRead: !!(seen && new Date(seen.seen_at) >= new Date(r.at)), indexedAt: new Date(r.at).toISOString(), labels: [],
        })
      }
      /* what happened to a joined member elsewhere — a reply from somebody on Bluesky — is Bluesky's to say */
      const mine = FEDERATES && !q.get('cursor') ? await joinedIdentity(s!.userId) : null
      if (mine) {
        const outside = await ask(mine, nsid, { limit: '50' })
        const ours = new Set(notes.map((n: any) => n.uri))
        for (const n of (outside && outside.notifications) || []) if (!ours.has(n.uri)) notes.push(n)
        notes.sort((a: any, b: any) => new Date(b.indexedAt).getTime() - new Date(a.indexedAt).getTime())
      }
      return json({ notifications: notes, ...(rows.length ? { cursor: cursorOf(rows, 'at') } : {}), ...(seen ? { seenAt: seen.seen_at } : {}) })
    }
    if (nsid === 'app.bsky.notification.getUnreadCount') { need(); const { data } = await s!.db.rpc('network_unread'); return json({ count: Number(data) || 0 }) }
    if (nsid === 'app.bsky.notification.updateSeen') {
      need()
      const b = await body()
      await s!.db.from('network_seen').upsert({ user_id: s!.userId, seen_at: b.seenAt || new Date().toISOString() })
      return json({})
    }
    if (/^app\.bsky\.notification\.(registerPush|unregisterPush|putPreferences|putPreferencesV2|putActivitySubscription)$/.test(nsid)) { need(); return json({}) }
    if (nsid === 'app.bsky.notification.getPreferences') { need(); return json({ preferences: {} }) }
    if (nsid === 'app.bsky.notification.listActivitySubscriptions') return json({ subscriptions: [] })

    /* ---------------------------------------------------------------- what this site has none of */
    if (nsid === 'app.bsky.labeler.getServices') return json({ views: [] })
    if (/^app\.bsky\.unspecced\./.test(nsid)) return json({ feeds: [], actors: [], topics: [], suggested: [], starterPacks: [], trends: [] })
    if (nsid === 'app.bsky.feed.sendInteractions') return json({})

    return no(REFUSALS.unsupported(nsid))
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in (e as any) && 'body' in (e as any)) return no(e as any)
    console.error('atproto:', nsid, e)
    return no(REFUSALS.badRequest('Something went wrong answering that'))
  }
})

/* THE SYNC METHODS: what a relay and an app view read of a joined member's public repository */
async function sync(req: Request, nsid: string, q: URLSearchParams): Promise<Response> {
  const did = String(q.get('did') || '')
  const car = (bytes: Uint8Array) => new Response(bytes, { headers: { ...CORS, 'Content-Type': 'application/vnd.ipld.car' } })
  const gone = (st: any) => no(st.status === 'takendown' ? { status: 400, body: { error: 'RepoTakendown', message: 'This repository has been taken down' } } : { status: 400, body: { error: 'RepoDeactivated', message: 'This account has left the wider network' } })
  if (nsid === 'com.atproto.sync.subscribeRepos') return subscribe(req, q.get('cursor'))
  if (nsid === 'com.atproto.sync.listRepos') {
    const { data } = await admin.from('network_commits').select('did, cid, rev').order('did').limit(Math.min(Number(q.get('limit') || 500), 1000))
    const repos = []
    for (const r of (data || []) as any[]) { const st = await repoStatus(r.did); if (st) repos.push({ did: r.did, head: r.cid, rev: r.rev, active: st.active, ...(st.status ? { status: st.status } : {}) }) }
    return json({ repos })
  }
  const st = did ? await repoStatus(did) : null
  if (!st) return no({ status: 400, body: { error: 'RepoNotFound', message: 'Could not find repo for DID' } })
  if (nsid === 'com.atproto.sync.getRepoStatus') return json(st)
  if (!st.active) return gone(st)
  if (nsid === 'com.atproto.sync.getLatestCommit') return st.commit ? json({ cid: st.commit, rev: st.rev }) : no(REFUSALS.notFound('Commit'))
  if (nsid === 'com.atproto.sync.getRepo') { const b = await repoCar(did); return b ? car(b) : no(REFUSALS.notFound('Repo')) }
  if (nsid === 'com.atproto.sync.getRecord') { const b = await recordCar(did, String(q.get('collection') || ''), String(q.get('rkey') || '')); return b ? car(b) : no(REFUSALS.notFound()) }
  if (nsid === 'com.atproto.sync.getBlob') {
    const { data: i } = await admin.from('network_identities').select('user_id').eq('did', did).maybeSingle()
    const cid = String(q.get('cid') || '')
    if (!i || !(await admin.rpc('network_public_blob', { p_user: i.user_id, p_cid: cid })).data) return no({ status: 400, body: { error: 'BlobNotFound', message: 'Blob not found' } })
    const dl = await admin.storage.from('network').download(`${i.user_id}/${cid}`)
    if (dl.error || !dl.data) {
      /* a picture put from the site's own pages is kept by its path; its CID is on the post */
      const { data: p } = await admin.from('network_posts').select('media').eq('author_id', i.user_id).contains('media', [{ cid }]).limit(1).maybeSingle()
      const im = p && (p.media || []).find((x: any) => x.cid === cid)
      const dl2 = im ? await admin.storage.from('network').download(im.path) : null
      if (!dl2 || dl2.error || !dl2.data) return no({ status: 400, body: { error: 'BlobNotFound', message: 'Blob not found' } })
      return new Response(dl2.data, { headers: { ...CORS, 'Content-Type': im.mime || 'application/octet-stream' } })
    }
    return new Response(dl.data, { headers: { ...CORS, 'Content-Type': 'application/octet-stream' } })
  }
  if (nsid === 'com.atproto.sync.listBlobs') return json({ cids: [] })
  return no(REFUSALS.unsupported(nsid))
}

/*
 * THE EVENT STREAM: every event after the relay's cursor, in order, then whatever comes next. An Edge
 * Function's connection does not last for ever; a relay reconnects with its cursor and loses nothing,
 * since the events are rows and the cursor a number.
 */
function subscribe(req: Request, cursor: string | null): Response {
  if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return no(REFUSALS.badRequest('subscribeRepos is a WebSocket'))
  const { socket, response } = Deno.upgradeWebSocket(req)
  let open = true
  socket.onclose = () => { open = false }
  socket.onerror = () => { open = false }
  socket.onopen = async () => {
    const { data: last } = await admin.from('network_seq').select('seq').order('seq', { ascending: false }).limit(1).maybeSingle()
    let at = cursor == null ? Number(last ? last.seq : 0) : Number(cursor)
    if (cursor != null && last && Number(cursor) > Number(last.seq)) { socket.send(errorFrame('FutureCursor', 'Cursor in the future')); socket.close(); return }
    while (open) {
      const { data } = await admin.from('network_seq').select('*').gt('seq', at).order('seq').limit(200)
      for (const row of (data || []) as any[]) { if (!open) break; socket.send(frameOf(row)); at = Number(row.seq) }
      if (!data || data.length < 200) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return response
}

/* tell the relay the site exists, so it crawls the stream — once a member has joined, and after a deploy */
async function requestCrawl() {
  const relay = String(Deno.env.get('NETWORK_RELAY_URL') || '').trim() || 'https://bsky.network'
  if (relay === 'none') return
  try {
    await fetch(relay.replace(/\/+$/, '') + '/xrpc/com.atproto.sync.requestCrawl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostname: siteHost() }), signal: AbortSignal.timeout(10000) })
  } catch (e) { console.error('atproto: requestCrawl', e) }
}

/* a repo named in a write must be the writer's own */
async function ownRepo(repo: string, s: Session) {
  const user = repo ? await userOfActor(repo, domain()) : null
  if (user !== s.userId) throw REFUSALS.forbidden('You may write only to your own repository')
}

/* a guest's reads go through the anonymous role, under the same guards as anybody's */
import { createClient } from 'npm:@supabase/supabase-js@2'
let GUEST: any = null
function guestDb() {
  if (!GUEST) GUEST = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  return GUEST
}

/* A THREAD, as the protocol draws it: the post, the posts it answers up to a height, and the answers
   under it to a depth — each one the reader may read, a missing one said as missing */
async function thread(ctx: Ctx, uri: string, depth: number, height: number): Promise<any> {
  const r = await resolvePost(ctx, uri)
  if (!r || (r as any).message) {
    if (r && (r as any).message) {
      const mv = await messageViews(ctx, [(r as any).message])
      const v = mv.get((r as any).message)
      if (v) return { $type: 'app.bsky.feed.defs#threadViewPost', post: v, replies: [] }
    }
    return { $type: 'app.bsky.feed.defs#notFoundPost', uri, notFound: true }
  }
  if (!(r as any).post) return { $type: 'app.bsky.feed.defs#notFoundPost', uri, notFound: true }
  const id = (r as any).post
  await loadPosts(ctx, [id])
  const row = ctx.posts.get(id)
  if (!row) return { $type: 'app.bsky.feed.defs#notFoundPost', uri, notFound: true }
  const rootId = row.reply_root_id || row.id
  const { data } = await ctx.db.from('network_posts').select('id, reply_parent_id').eq('reply_root_id', rootId).order('created_at').limit(500)
  const all = [...((data || []) as any[]).map((x) => x.id), rootId]
  const views = await postViews(ctx, all)
  const kids = new Map<string, string[]>()
  for (const x of (data || []) as any[]) { const k = x.reply_parent_id; if (!kids.has(k)) kids.set(k, []); kids.get(k)!.push(x.id) }
  const down = (pid: string, d: number): any[] => (d <= 0 ? [] : (kids.get(pid) || []).map((cid) => views.get(cid) ? { $type: 'app.bsky.feed.defs#threadViewPost', post: views.get(cid), replies: down(cid, d - 1) } : null).filter(Boolean))
  const up = async (p: any, h: number): Promise<any> => {
    if (!p.reply_parent_id || h <= 0) return undefined
    await loadPosts(ctx, [p.reply_parent_id])
    const parent = ctx.posts.get(p.reply_parent_id)
    const pv = parent ? (views.get(parent.id) || (await postViews(ctx, [parent.id])).get(parent.id)) : null
    if (!pv) return { $type: 'app.bsky.feed.defs#notFoundPost', uri: '', notFound: true }
    return { $type: 'app.bsky.feed.defs#threadViewPost', post: pv, parent: await up(parent, h - 1), replies: [] }
  }
  const view = views.get(id) || (await postViews(ctx, [id])).get(id)
  if (!view) return { $type: 'app.bsky.feed.defs#notFoundPost', uri, notFound: true }
  return { $type: 'app.bsky.feed.defs#threadViewPost', post: view, parent: await up(row, height), replies: down(id, depth) }
}
