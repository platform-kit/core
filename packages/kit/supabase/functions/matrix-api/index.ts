/*
 * THE COMMUNITY AS A MATRIX HOMESERVER — the Client-Server API over the tables the site's own
 * client already uses, so Element, FluffyChat, Nheko, Cinny and the rest sign in and read the
 * site's rooms with the host swapped, on every platform, without this project shipping an app.
 *
 * THE TABLES ARE THE STORE AND THIS IS A VIEW OF THEM. No event graph, no room DAG, no state
 * resolution, no second copy of a message: `space_messages` is the timeline, `channels` are the
 * rooms, `spaces` are Spaces, and `_shared/matrix/` translates each way. The hard parts of Matrix
 * exist to reconcile several homeservers; with one they are not needed.
 *
 * EVERY REQUEST IS SERVED AS THE PERSON. `_shared/matrix/session.ts` has the whole argument: the
 * community's reads end at `can_read_channel`, which asks `auth.uid()`, so the service role reads
 * nothing here and the only way to serve this surface is to be them. The service role is used for
 * two things — checking a password and reading the token table — and never for community data.
 *
 *   GET  /_matrix/client/versions                                 what we speak
 *   GET|POST /_matrix/client/v3/login                             the flows; the site's own password
 *   POST /_matrix/client/v3/logout | /logout/all                  ends GoTrue's session too
 *   POST /_matrix/client/v3/register                              refused, with where to sign up
 *   GET  /_matrix/client/v3/capabilities                          and what is absent, said plainly
 *   GET  /_matrix/client/v3/pushrules/                            empty: this site notifies its own way
 *   POST /_matrix/client/v3/user/{id}/filter                      accepted, never applied: the sync is already only theirs
 *   POST /_matrix/client/v3/keys/{upload,query,claim}             taken, kept by nobody: no room here is encrypted
 *   PUT  /_matrix/client/v3/user/{id}/account_data/{type}         taken and dropped: a reader's settings are the site's
 *   GET  /_matrix/client/v3/thirdparty/protocols                  empty: no bridges
 *   GET  /_matrix/client/v3/sync?since=                           the token is a seq per channel
 *   GET  /_matrix/client/v3/joined_rooms                          the rooms and Spaces that are theirs
 *   GET  /_matrix/client/v3/rooms/{id}/messages?from=&dir=        both directions
 *   PUT  /_matrix/client/v3/rooms/{id}/send/{type}/{txn}          a message, a thread reply, an edit
 *   PUT  /_matrix/client/v3/rooms/{id}/redact/{event}/{txn}       a withdrawal
 *   GET  /_matrix/client/v3/rooms/{id}/state | /members | /joined_members
 *   PUT  /_matrix/client/v3/rooms/{id}/state/{type}/{key}         refused: this site decides these
 *   PUT  /_matrix/client/v3/rooms/{id}/typing/{user}
 *   POST /_matrix/client/v3/rooms/{id}/receipt/{type}/{event} | /read_markers
 *   GET  /_matrix/client/v3/profile/{user}                        name and picture
 *   POST /_matrix/media/v3/upload   GET /_matrix/media/v3/download/{server}/{id}
 */
import { admin, appUrl } from '../_shared/lib.ts'
import { API_ON, SPACES_ON, ENCRYPTION_ON } from '../_shared/api/flags.ts'
import { keyOf } from '../_shared/api/keys.ts'
import * as SITE from '../_shared/pipe/site.js'
import { login, logout, sessionOf, loginAllowed, noteAttempt, devicesOf, type Session } from '../_shared/matrix/session.ts'
import { eventId, isOurs, foreignHost, readEvent, readRoom, readUser, roomId, spaceId, userId } from '../_shared/matrix/ids.js'
import {
  uploadKeys, queryKeys, claimKeys, uploadCrossSigning, uploadSignatures,
  sendToDevice, takeToDevice, changedDevices,
  putBackupVersion, getBackupVersion, putRoomKeys, getRoomKeys, deleteBackupVersion } from '../_shared/matrix/keys.js'
import { fromEvent, toEvent } from '../_shared/matrix/events.js'
import { READ_ONLY_STATE, roomState, spaceState } from '../_shared/matrix/state.js'
import { REFUSALS } from '../_shared/matrix/errors.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const no = (r: { status: number; body: unknown }) => json(r.body, r.status)
const HOST = () => appUrl().replace(/^https?:\/\//, '').replace(/\/+$/, '')
/* the largest file this surface takes, said once: the config answers with it and the upload
   refuses past it, so a client is never told one number and held to another */
const MAX_UPLOAD_MB = 10
const ipOf = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
const bearer = (req: Request) => {
  const h = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  return h || new URL(req.url).searchParams.get('access_token') || null
}

/* ---------------------------------------------------------------------------------------------
 * WHAT A PERSON CAN SEE. One read, used by /sync, /joined_rooms and every room endpoint, through
 * THEIR client — so the answer is the database's and not ours. A channel that is not in here is
 * one they may not read, and every endpoint refuses on that basis rather than on a check of its
 * own: one place to be wrong instead of twelve.
 * ------------------------------------------------------------------------------------------- */
async function theirRooms(s: Session) {
  const [spaces, channels, mine] = await Promise.all([
    s.db.from('spaces').select('id, slug, name, created_at, position').is('archived_at', null),
    /* `encrypted` is read here because roomState needs it: a client that is not told a room is
       sealed will post the plaintext into it while everybody else is sealing */
    s.db.from('channels').select('id, space_id, slug, name, topic, created_at, created_by, position, last_seq, encrypted').is('archived_at', null),
    s.db.from('space_members').select('space_id').eq('user_id', s.userId),
  ])
  const inSpace = new Set(((mine.data ?? []) as any[]).map((r) => r.space_id))
  const spaceRows = ((spaces.data ?? []) as any[]).filter((x) => inSpace.has(x.id))
  const ok = new Set(spaceRows.map((x) => x.id))
  const channelRows = ((channels.data ?? []) as any[]).filter((c) => ok.has(c.space_id))
  return { spaces: spaceRows, channels: channelRows, byId: new Map(channelRows.map((c) => [c.id, c])) }
}

/* the members of a channel's space, with the names a client shows */
async function membersOf(s: Session, spaceId_: string) {
  const { data, error } = await s.db.rpc('space_people', { p_space: spaceId_ })
  if (error) console.error('matrix: the members could not be named —', error.message)
  return ((data ?? []) as any[]).map((p) => ({ user_id: p.id, name: p.name || null, avatar: p.avatar || null }))
}

/* who holds which capability in a space — the grants, resolved by the database's own view of them.
   Power levels are DERIVED from this and never settable; see _shared/matrix/state.js. */
async function holdersOf(s: Session, spaceId_: string) {
  const { data } = await s.db.from('space_grants').select('capability, scope, user_id, space_id').eq('scope', 'user').eq('space_id', spaceId_)
  const by = new Map<string, string[]>()
  for (const g of (data ?? []) as any[]) {
    if (!g.user_id) continue
    by.set(g.user_id, [...(by.get(g.user_id) ?? []), g.capability])
  }
  return [...by].map(([user_id, capabilities]) => ({ user_id, capabilities }))
}

/* a media id is the attachment's path, so nothing has to be stored to resolve one; the bucket's
   own url never leaves this function (3.10) */
const mediaOf = (row: any) => (row?.attachment ? `mxc://${HOST()}/${btoa(String(row.attachment)).replace(/=+$/, '')}` : null)
const pathOfMedia = (id: string) => { try { return atob(id.replace(/-/g, '+').replace(/_/g, '/')) } catch { return null } }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  /* OFF MEANS GONE. The surface is the community served as a homeserver, so it comes and goes with
     the spaces module, and needs the api module as every other door does. */
  if (!API_ON || !SPACES_ON) return no(REFUSALS.unsupported('the Matrix API on this site'))

  const url = new URL(req.url)
  /* the function may be reached at its own address or through the host's /_matrix rewrite */
  const path = url.pathname.replace(/^\/functions\/v1\/matrix-api/, '').replace(/^\/matrix-api/, '') || '/'
  const seg = path.split('/').filter(Boolean)
  const q = Object.fromEntries(url.searchParams)
  const host = HOST()

  const body = async () => { try { return await req.json() } catch { return null } }

  /* ---- what we speak, and what we do not ---- */
  if (path === '/_matrix/client/versions') {
    return json({
      versions: ['v1.1', 'v1.2', 'v1.3', 'v1.4', 'v1.5', 'v1.6'],
      unstable_features: {
        'org.matrix.msc3440.stable': true,   /* threads */
        'org.matrix.msc3916.stable': true,   /* media fetched with the token, as everything else is */
      },
    })
  }

  if (path === '/_matrix/client/v3/register' || path === '/_matrix/client/r0/register') {
    return no(REFUSALS.noRegister(appUrl()))
  }

  if (path === '/_matrix/client/v3/login' && req.method === 'GET') {
    return json({ flows: [{ type: 'm.login.password' }] })
  }

  if (path === '/_matrix/client/v3/login' && req.method === 'POST') {
    const b = await body()
    if (!b) return no(REFUSALS.badJson())
    const ip = ipOf(req)
    const allowed = await loginAllowed(ip)
    if (!allowed.ok) return no(REFUSALS.tooManyLogins(allowed.retryAfter))

    /* Matrix sends the address either as a plain `user` or as an identifier object */
    const email = String(b.identifier?.address || b.identifier?.user || b.user || '').trim()
    const password = String(b.password || '')
    if (!email || !password) { await noteAttempt(ip); return no(REFUSALS.badLogin()) }

    const device = { id: String(b.device_id || crypto.randomUUID()).slice(0, 120), name: b.initial_device_display_name ? String(b.initial_device_display_name).slice(0, 200) : undefined }
    const got = await login(email, password, device)
    if (!got) { await noteAttempt(ip); return no(REFUSALS.badLogin()) }

    return json({
      user_id: userId(got.user.id, host),
      access_token: got.token,
      device_id: got.device,
      home_server: host,
      /* no well_known: see the note above — a client keeps the address it reached us on, which
         is correct behind the site's rewrite, at the function's own host, and in the stack alike */
    })
  }

  if (path === '/_matrix/client/v3/logout' || path === '/_matrix/client/v3/logout/all') {
    await logout(bearer(req))
    return json({})
  }

  /* ---- an endpoint we do not have is 404, not 401 ----
     The specification is explicit about this and clients lean on it hard: a 401 on an endpoint we
     simply do not implement says "this exists and your token is wrong", which is the opposite of
     what is true, and a client that is probing for an optional feature cannot tell the two apart.
     Element discovers OIDC by asking for /v1/auth_metadata, and a 401 there reads to it as a
     server demanding a sign-in it has already done. So the path is judged before the token is. */
  const KNOWN = [
    /^\/_matrix\/client\/(v3|r0|unstable)\//,
    /^\/_matrix\/client\/v1\/(rooms|media)\//,
    /^\/_matrix\/media\/(v3|r0|v1)\//,
  ]
  if (path.startsWith('/_matrix/') && !KNOWN.some((r) => r.test(path))) {
    return no(REFUSALS.unsupported(`${req.method} ${path}`))
  }

  /* ---- everything below is somebody's ---- */
  const token = bearer(req)
  if (!token) return no(REFUSALS.noToken())

  /* A KEY OF KIND MATRIX has no person: it acts for a script or a bridge, and what it may reach is
     a grant rather than a membership. It is refused everything a person's session gets until it is
     granted the room, and never reaches the coaching chat or the desk — which are not this
     surface at all. (3.11) */
  const asKey = token.startsWith('pk_') || token.length < 60 ? await keyOf(token, ['matrix']) : null
  if (asKey === 'other-kind') return no(REFUSALS.keyNotMatrix())

  const s = await sessionOf(token)
  if (!s) return no(REFUSALS.badToken())

  /*
   * DEVICE KEYS — REAL, now that a channel can be sealed.
   *
   * These five used to answer honestly as empty, with a comment saying no room here was ever
   * encrypted. That was true and is not any more: a channel whose file says `encrypted: true` is
   * served with `m.room.encryption` in its state, and a client seeing that will seal every message
   * it sends there. A client that could not store or fetch a key would then be unable to send at
   * all — so each of these is now a key store, and the thing it stores is public keys and opaque
   * blobs, never a secret.
   *
   * What a site gives up by sealing a room is said once, in the module's own documentation: no
   * search of it, no bot in it, no moderating what nobody can read. That is why `space-encryption`
   * is a switch of its own and not part of the community.
   */
  if (path === '/_matrix/client/v3/keys/upload' && req.method === 'POST') {
    if (!ENCRYPTION_ON) return json({ one_time_key_counts: {} })
    return json(await uploadKeys(s.db, { userId: s.userId, deviceId: s.device, body: await body() }))
  }
  if (path === '/_matrix/client/v3/keys/query' && req.method === 'POST') {
    if (!ENCRYPTION_ON) return json({ device_keys: {}, failures: {}, master_keys: {}, self_signing_keys: {}, user_signing_keys: {} })
    const b = await body() as { device_keys?: Record<string, unknown> }
    const ids = Object.keys(b.device_keys || {}).map((m) => (readUser(m) || {}).id).filter(Boolean) as string[]
    /* asked for nobody in particular means "everybody I can see", which is what a client sends on
       its first sync of a room */
    return json(await queryKeys(s.db, { userIds: ids.length ? ids : [s.userId], host: HOST(), idOf: userId, asking: s.userId }))
  }
  if (path === '/_matrix/client/v3/keys/claim' && req.method === 'POST') {
    if (!ENCRYPTION_ON) return json({ one_time_keys: {}, failures: {} })
    const b = await body() as { one_time_keys?: Record<string, Record<string, string>> }
    /* THE SERVICE ROLE, and only here: a claim deletes a row belonging to somebody else, and a
       delete policy that allowed it would let anybody empty anybody's keys and make them
       unreachable. The caller is still fenced — they had to hold a session to get this far. */
    return json(await claimKeys(admin, {
      request: b.one_time_keys || {}, host: HOST(), idOf: userId,
      userOf: (m: string) => (readUser(m) || {}).id || null,
    }))
  }
  /* Cross-signing: three keys that let one of a person's devices vouch for another, so nobody has
     to verify every device against every other by hand. */
  if (path === '/_matrix/client/v3/keys/device_signing/upload' && req.method === 'POST') {
    if (!ENCRYPTION_ON) return json({})
    return json(await uploadCrossSigning(s.db, { userId: s.userId, body: await body() }))
  }
  if (/^\/_matrix\/client\/v3\/keys\/signatures\/upload$/.test(path) && req.method === 'POST') {
    if (!ENCRYPTION_ON) return json({ failures: {} })
    /* THE SERVICE ROLE, because a signature is written into somebody else's row and the policy
       rightly refuses that from their client. What fences it is `asking` below — the caller's own
       id, from their session — which is the only name a signature is ever written under. */
    return json(await uploadSignatures(admin, {
      userId: s.userId, body: await body(),
      /* the caller's own Matrix id: a signature is keyed by its SIGNER, and the signer is whoever
         is holding this session, never whoever the body says */
      asking: userId(s.userId, HOST()),
      userOf: (m: string) => (readUser(m) || {}).id || null,
    }))
  }
  /*
   * TO-DEVICE. How a room key reaches another device at all. The body is already sealed to that
   * device, so this is a queue of ciphertext; the service role writes it because the row lands in
   * somebody else's queue, and an insert policy allowing that would let anybody deliver a forged
   * room key that looked exactly like a real one.
   */
  {
    const m = /^\/_matrix\/client\/v3\/sendToDevice\/([^/]+)\/([^/]+)$/.exec(path)
    if (m && req.method === 'PUT') {
      if (!ENCRYPTION_ON) return json({})
      const b = await body() as { messages?: Record<string, Record<string, unknown>> }
      return json(await sendToDevice(admin, {
        senderId: s.userId, type: decodeURIComponent(m[1]), messages: b.messages || {},
        userOf: (x: string) => (readUser(x) || {}).id || null,
      }))
    }
  }
  /*
   * THE KEY BACKUP. A reader on a second browser has none of the room keys the first one made, and
   * every message sent before that moment is unreadable there. This is how they get them: an
   * opaque blob per session, sealed under a recovery key shown to them once and never again —
   * because the site never had it to show twice.
   *
   * M_NOT_FOUND is still the answer when there is no backup yet, which is a client's normal first
   * day; what has gone is M_NOT_FOUND as the answer to everything.
   */
  if (path.startsWith('/_matrix/client/v3/room_keys/')) {
    if (!ENCRYPTION_ON) return no(REFUSALS.noKeyBackup())
    const rest = path.slice('/_matrix/client/v3/room_keys/'.length)
    const q = new URL(req.url).searchParams

    if (rest === 'version' || rest.startsWith('version/')) {
      const wanted = rest.startsWith('version/') ? decodeURIComponent(rest.slice('version/'.length)) : null
      if (req.method === 'POST') return json(await putBackupVersion(s.db, { userId: s.userId, body: await body() }))
      if (req.method === 'GET') {
        const v = await getBackupVersion(s.db, { userId: s.userId, version: wanted })
        return v ? json(v) : no(REFUSALS.noKeyBackup())
      }
      if (req.method === 'PUT') {
        /* a client re-stating its auth data for a version it already has: taken, and the version
           is what it was. Refusing it strands a client that is only saying what we already know. */
        return json({})
      }
      if (req.method === 'DELETE') {
        /* a version nobody named is not "all of them": Matrix names the one to delete, and a
           client that forgot to is not asking us to throw its keys away */
        if (!wanted) return no(REFUSALS.noKeyBackup())
        return (await deleteBackupVersion(s.db, { userId: s.userId, version: wanted })) ? json({}) : no(REFUSALS.noKeyBackup())
      }
    }
    if (rest.startsWith('keys')) {
      const version = q.get('version')
      if (!version) return no(REFUSALS.noKeyBackup())
      const after = rest.slice('keys'.length).replace(/^\//, '')
      const parts = after ? after.split('/').map(decodeURIComponent) : []
      const room = parts[0] || null, session = parts[2] || null   /* keys/<room>/<"sessions">/<id> */
      if (req.method === 'PUT') {
        const b = await body() as Record<string, unknown>
        /* one shape serves all three of Matrix's routes: the whole backup, one room, one session */
        const rooms = room
          ? { [room]: session ? { sessions: { [session]: b } } : b }
          : ((b as { rooms?: Record<string, unknown> }).rooms || {})
        const r = await putRoomKeys(s.db, { userId: s.userId, version, rooms })
        return r ? json(r) : no(REFUSALS.noKeyBackup())
      }
      if (req.method === 'GET') {
        const r = await getRoomKeys(s.db, { userId: s.userId, version, room, session })
        return r ? json(r) : no(REFUSALS.noKeyBackup())
      }
    }
    return no(REFUSALS.noKeyBackup())
  }

  /* ACCOUNT DATA — a client's own settings, which this site does not keep.
     What a reader has set belongs to the site's own account, not to a per-client bag the site
     would then have to reconcile with it. A write is taken and dropped, a read says there is
     none; a client treats both as "nothing saved yet" and uses its local defaults, which is what
     we mean. (A client's settings are its own; a reader's are the site's.) */
  if (/^\/_matrix\/client\/v3\/user\/[^/]+\/account_data\/[^/]+$/.test(path)) {
    if (req.method === 'PUT') return json({})
    return no(REFUSALS.unsupported('stored account data'))
  }
  if (/^\/_matrix\/client\/v3\/user\/[^/]+\/rooms\/[^/]+\/account_data\/[^/]+$/.test(path)) {
    if (req.method === 'PUT') return json({})
    return no(REFUSALS.unsupported('stored account data'))
  }

  /* A FILTER IS ACCEPTED AND NOT APPLIED, which is a real statement and not a shrug.
     A client posts a filter — almost always the lazy-loading one — and will not begin syncing
     until it has an id back for it. What a filter asks for is LESS than everything; what this
     surface returns is already only what the person may see, and a sync here is a page of
     channels rather than a world, so there is nothing a filter could usefully cut. Returning a
     superset of what was asked for is what the specification allows, and it is what we do.
     The id is a constant because there is nothing to remember: every filter means the same here. */
  const FILTER_ID = 'all'
  if (/^\/_matrix\/client\/v3\/user\/[^/]+\/filter$/.test(path) && req.method === 'POST') {
    return json({ filter_id: FILTER_ID })
  }
  if (/^\/_matrix\/client\/v3\/user\/[^/]+\/filter\/[^/]+$/.test(path) && req.method === 'GET') {
    return json({})
  }

  /* PUSH RULES — EMPTY, AND THAT IS THE ANSWER.
     A client will not start its sync loop until it has a ruleset; it retries for ever if asked to
     do without one. We do no Matrix push: a site tells its people through its own notifications,
     which know about memberships and the desk and work when no Matrix client is open. So the
     answer is a well-formed ruleset with no rules in it — every list present, because a client
     reads the five by name — which says "nothing here decides what wakes you", truthfully. */
  if (path === '/_matrix/client/v3/pushrules/' || path === '/_matrix/client/v3/pushrules') {
    return json({ global: { override: [], content: [], room: [], sender: [], underride: [] } })
  }

  /* No bridges to anywhere: an empty map is the specified way to say so, and a 404 here reads to
     a client as a server too old to ask rather than one with nothing to offer. */
  if (path === '/_matrix/client/v3/thirdparty/protocols') return json({})

  if (path === '/_matrix/client/v3/capabilities') {
    return json({
      capabilities: {
        'm.change_password': { enabled: false },
        'm.room_versions': { default: '10', available: { 10: 'stable' } },
        'm.set_displayname': { enabled: false },
        'm.set_avatar_url': { enabled: false },
        /* said plainly rather than left for a client to discover by failing */
        'site.platformkit.federation': { enabled: false, reason: 'This site is a homeserver for its own people and does not join the public Matrix network.' },
        /*
         * ENCRYPTION IS PER ROOM, and this says which way round it is on this site. It used to be
         * flatly absent, with a reason that was true then: the site read its own rooms for search,
         * moderation and its assistants, so end-to-end encryption would have been a claim it could
         * not keep. A channel may now say `encrypted: true` in its file, and then the site keeps
         * the claim by GIVING UP those three in that room — which is why the reason, when it is
         * on, says what a sealed room costs rather than only that it exists.
         */
        'site.platformkit.encryption': ENCRYPTION_ON
          ? { enabled: true, reason: 'A channel is end-to-end encrypted when its own file says so. In such a room the site can read nothing: there is no search of it, no bot in it, and no moderating what nobody can read.' }
          : { enabled: false, reason: 'The site reads its own rooms for search, moderation and its assistants, so end-to-end encryption would be a claim it could not keep. A deployment may switch the space-encryption module on to seal a channel at the cost of those three.' },
      },
    })
  }

  if (path === '/_matrix/client/v3/account/whoami') {
    return json({ user_id: userId(s.userId, host), device_id: s.device })
  }

  if (path === '/_matrix/client/v3/devices') {
    const { data } = await devicesOf(s.userId)
    return json({ devices: ((data ?? []) as any[]).map((d) => ({ device_id: d.device_id, display_name: d.device_name, last_seen_ts: Date.parse(d.last_used_at || d.created_at) || undefined })) })
  }

  /* ---- the rooms that are theirs ---- */
  if (path === '/_matrix/client/v3/joined_rooms') {
    const { spaces, channels } = await theirRooms(s)
    return json({ joined_rooms: [...spaces.map((x) => spaceId(x.id, host)), ...channels.map((c) => roomId(c.id, host))] })
  }

  /* ---- sync: the token is the channel's own seq, which the timeline is already indexed by ---- */
  if (path === '/_matrix/client/v3/sync') {
    const { spaces, channels } = await theirRooms(s)
    const since = parseSince(q.since)
    const join: Record<string, unknown> = {}
    const next: Record<string, number> = {}

    for (const c of channels) {
      const from = since[c.id] ?? null
      const query = s.db.from('space_messages').select('*').eq('channel_id', c.id).order('seq', { ascending: true }).limit(200)
      const { data } = from === null ? await query.gte('seq', Math.max(0, Number(c.last_seq || 0) - 20)) : await query.gt('seq', from)
      const rows = (data ?? []) as any[]
      next[c.id] = rows.length ? Number(rows[rows.length - 1].seq) : (from ?? Number(c.last_seq || 0))
      /* a first sync carries the state; a later one carries what is new and nothing else */
      const timeline = rows.map((r) => toEvent(r, { host, mediaUrl: mediaOf }))
      if (from === null || timeline.length) {
        join[roomId(c.id, host)] = {
          timeline: { events: timeline, limited: rows.length >= 200, prev_batch: String(rows.length ? rows[0].seq : 0) },
          state: { events: from === null ? roomState(c, { host, holders: await holdersOf(s, c.space_id), members: await membersOf(s, c.space_id) }) : [] },
          ephemeral: { events: [] },
          unread_notifications: {},
        }
      }
    }
    /* the Spaces themselves, so a client draws the site's own arrangement rather than a flat list */
    if (!q.since) {
      for (const sp of spaces) {
        join[spaceId(sp.id, host)] = {
          timeline: { events: [], limited: false, prev_batch: '0' },
          state: { events: spaceState(sp, channels.filter((c) => c.space_id === sp.id), { host, viewer: s.userId }) },
          ephemeral: { events: [] },
        }
      }
    }
    /*
     * AND THE TWO THINGS AN ENCRYPTED ROOM NEEDS FROM A SYNC.
     *
     * `to_device` is how a room key reaches this device at all — without it a client can see an
     * encrypted room and never read a word of it. A batch is deleted on the NEXT sync rather than
     * this one, which is Matrix's own contract: a client that dies mid-sync sees its keys again
     * instead of losing them for good.
     *
     * `device_lists.changed` is who has added or changed a device since the last sync, so a client
     * re-queries before sealing the next message. Without it, somebody who signs in on a new
     * laptop stops being able to read the room there and nobody can tell why.
     */
    let toDevice: { events: unknown[] } = { events: [] }
    let deviceLists: { changed: string[]; left: string[] } = { changed: [], left: [] }
    if (ENCRYPTION_ON) {
      const td = await takeToDevice(s.db, { userId: s.userId, deviceId: s.device, since: since[TD] || 0, host, idOf: userId })
      toDevice = { events: td.events }
      next[TD] = td.next
      const lastAt = since[AT] || 0
      const changed = lastAt ? await changedDevices(s.db, { since: new Date(lastAt).toISOString() }) : []
      deviceLists = { changed: changed.map((u) => userId(u, host)), left: [] }
      next[AT] = Date.now()
    }
    return json({
      next_batch: makeSince(next), rooms: { join, invite: {}, leave: {} },
      presence: { events: [] }, account_data: { events: [] },
      to_device: toDevice, device_lists: deviceLists,
    })
  }

  /* ---- from here on, a room ---- */
  if (seg[0] === '_matrix' && (seg[2] === 'v3' || seg[2] === 'v1') && seg[3] === 'rooms') {
    const given = decodeURIComponent(seg[4] ?? '')
    if (!isOurs(given, host)) {
      const other = foreignHost(given)
      /* a refusal that says why, rather than a lookup that finds nothing and reads as an empty
         room, or a request that hangs until the client gives up (3.12) */
      return no(other ? REFUSALS.foreign(other) : REFUSALS.noSuchRoom())
    }
    const ref = readRoom(given)
    if (!ref) return no(REFUSALS.noSuchRoom())

    const { byId, spaces, channels } = await theirRooms(s)
    /* a Space is a room too, and its state is its children */
    if (ref.kind === 'space') {
      const sp = spaces.find((x) => x.id === ref.id)
      if (!sp) return no(REFUSALS.notInRoom())
      if (seg[5] === 'state' && req.method === 'GET') return json(spaceState(sp, channels.filter((c) => c.space_id === sp.id), { host, viewer: s.userId }))
      if (seg[5] === 'messages') return json({ chunk: [], start: q.from ?? '0', end: q.from ?? '0' })
      if (seg[5] === 'hierarchy' || (seg[2] === 'v1' && seg[5] === 'hierarchy')) {
        const mine = channels.filter((c) => c.space_id === sp.id)
        const room = (id: string, name: string, topic: string | null, type: string | null, children: string[]) => ({
          room_id: id,
          name,
          topic: topic || undefined,
          room_type: type || undefined,
          num_joined_members: 0,
          world_readable: false,
          guest_can_join: false,
          join_rule: 'invite',
          children_state: children.map((cid) => ({
            type: 'm.space.child', state_key: cid, content: { via: [host] },
            sender: userId('00000000-0000-0000-0000-000000000000', host), origin_server_ts: 0, room_id: id,
          })),
        })
        return json({
          rooms: [
            room(spaceId(sp.id, host), sp.name || sp.slug || 'Space', null, 'm.space', mine.map((c) => roomId(c.id, host))),
            ...mine.map((c) => room(roomId(c.id, host), c.name || c.slug || 'Channel', c.topic ?? null, null, [])),
          ],
        })
      }
      return json({})
    }

    const ch = byId.get(ref.id)
    if (!ch) return no(REFUSALS.notInRoom())
    const rid = roomId(ch.id, host)
    const what = seg[5]

    if (what === 'state' && req.method === 'GET' && !seg[6]) {
      return json(roomState(ch, { host, holders: await holdersOf(s, ch.space_id), members: await membersOf(s, ch.space_id) }))
    }
    /* NOTHING HERE IS SET FROM A CLIENT. A power level, a name, a topic, encryption: all of them
       are the site's, and a client that could set one would be a second, weaker way to grant
       moderation beside the admin's. The refusal names which thing it was. */
    if (what === 'state' && req.method === 'PUT') {
      const type = decodeURIComponent(seg[6] ?? '')
      if (type === 'm.room.encryption') return no(REFUSALS.noEncryption())
      return no(REFUSALS.readOnlyState(READ_ONLY_STATE[type] ?? 'That'))
    }

    if (what === 'members' || what === 'joined_members') {
      const people = await membersOf(s, ch.space_id)
      if (what === 'joined_members') {
        return json({ joined: Object.fromEntries(people.map((m) => [userId(m.user_id, host), { display_name: m.name }])) })
      }
      return json({ chunk: people.map((m) => ({ type: 'm.room.member', state_key: userId(m.user_id, host), room_id: rid, sender: userId(m.user_id, host), content: { membership: 'join', displayname: m.name } })) })
    }

    if (what === 'relations') {
      const root = readEvent(decodeURIComponent(seg[6 + (seg[2] === 'v1' ? 0 : 0)] ?? ''))
      if (!root) return no(REFUSALS.badJson())
      const relType = decodeURIComponent(seg[7] ?? '')
      if (relType && relType !== 'm.thread') return json({ chunk: [] })
      const lim = Math.min(Number(q.limit || 50) || 50, 200)
      const { data } = await s.db.from('space_messages').select('*')
        .eq('channel_id', ch.id).eq('thread_root_id', root.id)
        .order('seq', { ascending: true }).limit(lim)
      const rows = (data ?? []) as any[]
      return json({
        chunk: rows.map((r) => toEvent(r, { host, mediaUrl: mediaOf })),
        next_batch: undefined,
      })
    }

    if (what === 'messages') {
      const dir = q.dir === 'f' ? 'f' : 'b'
      const from = Number(q.from || (dir === 'b' ? Number.MAX_SAFE_INTEGER : 0)) || 0
      const lim = Math.min(Number(q.limit || 50) || 50, 200)
      const query = s.db.from('space_messages').select('*').eq('channel_id', ch.id).limit(lim)
      const { data } = dir === 'b'
        ? await query.lt('seq', from).order('seq', { ascending: false })
        : await query.gt('seq', from).order('seq', { ascending: true })
      const rows = (data ?? []) as any[]
      return json({
        chunk: rows.map((r) => toEvent(r, { host, mediaUrl: mediaOf })),
        start: String(from),
        end: String(rows.length ? rows[rows.length - 1].seq : from),
      })
    }

    if (what === 'send' && req.method === 'PUT') {
      const b = await body()
      if (!b) return no(REFUSALS.badJson())
      /* a picture or a file: the mxc the client was given a moment ago, brought to its real name */
      let media: { path: string; type: string; name: string; size: number } | null = null
      let mediaId: string | null = null
      const mxc = typeof b.url === 'string' && b.url.startsWith('mxc://') ? b.url : ''
      if (mxc) {
        const staged = pathOfMedia(mxc.split('/').pop() ?? '')
        /* only ever their own shelf: a client that hands us somebody else's address gets nothing */
        if (!staged || !staged.startsWith(`matrix/${s.userId}/`)) return no(REFUSALS.unsupported('that media id'))
        const ext = staged.split('.').pop() ?? 'bin'
        mediaId = crypto.randomUUID()
        const home = `${ch.id}/${mediaId}.${ext}`
        /* as them, so the channel's own insert policy is the fence and nothing here is a second
           opinion about who may attach a file */
        const { error: copied } = await s.db.storage.from('spaces').copy(staged, home)
        if (copied) return no(REFUSALS.cannotSend())
        await s.db.storage.from('spaces').remove([staged])
        const info = (b.info && typeof b.info === 'object') ? b.info : {}
        media = {
          path: home,
          type: String(info.mimetype || '') || 'application/octet-stream',
          name: String(b.body || 'file').slice(0, 200),
          size: Number(info.size) || 0,
        }
      }
      const made = fromEvent({ type: decodeURIComponent(seg[6] ?? 'm.room.message'), content: b }, { channelId: ch.id, media, sealed: ENCRYPTION_ON && !!(ch as any).encrypted })
      /* a picture's size in pixels, as the sender measured it: a client needs it to lay the
         timeline out before the bytes arrive, and it rides on meta, which never changes */
      if (made.ok && media) {
        const i = (b.info && typeof b.info === 'object') ? b.info : {}
        const w = Number(i.w) || 0, h = Number(i.h) || 0
        if (w > 0 && h > 0) (made.row as any).meta = { ...((made.row as any).meta || {}), image: { w, h } }
      }
      if (!made.ok) {
        if (made.why === 'encrypted') return no(REFUSALS.noEncryption())
        if (made.why === 'not-sealed') return no(REFUSALS.notSealed())
        if (made.why === 'must-seal') return no(REFUSALS.mustSeal())
        return no(REFUSALS.badJson())
      }
      /* AN EDIT IS AN UPDATE OF THE LINE, not a new one: both surfaces then name the same message
         at every step, which is the whole reason the event id is the row's own id. */
      if (made.replaces) {
        const { data, error } = await s.db.from('space_messages').update({ body: made.row.body, edited_at: new Date().toISOString() }).eq('id', made.replaces).select().single()
        if (error) return no(REFUSALS.cannotSend())
        return json({ event_id: eventId((data as any).id) })
      }
      /* written as them: the insert policy is the one the browser meets, so a room they may read
         and not write in refuses here for the same reason it would there */
      const { data, error } = await s.db.from('space_messages').insert({ ...made.row, author_id: s.userId, ...(mediaId ? { id: mediaId } : {}) }).select().single()
      if (error) {
        /* the file is already at a name built from an id no row will ever hold: take it back */
        if (mediaId) await s.db.storage.from('spaces').remove([`${ch.id}/${mediaId}.${(made.row as any).attachment?.split('.').pop() ?? 'bin'}`])
        return no(REFUSALS.cannotSend())
      }
      return json({ event_id: eventId((data as any).id) })
    }

    if (what === 'redact' && req.method === 'PUT') {
      const target = readEvent(decodeURIComponent(seg[6] ?? ''))
      if (!target) return no(REFUSALS.badJson())
      const { error } = await s.db.from('space_messages').update({ deleted_at: new Date().toISOString() }).eq('id', target.id)
      if (error) return no(REFUSALS.notInRoom())
      return json({ event_id: eventId(target.id) })
    }

    if (what === 'typing' && req.method === 'PUT') {
      const b = await body()
      await s.db.from('channel_members').update({ typing_at: b?.typing ? new Date().toISOString() : null }).eq('channel_id', ch.id).eq('user_id', s.userId)
      return json({})
    }

    if (what === 'receipt' || what === 'read_markers') {
      const b = what === 'read_markers' ? await body() : null
      const evId = what === 'receipt' ? decodeURIComponent(seg[7] ?? '') : String(b?.['m.fully_read'] || b?.['m.read'] || '')
      const target = readEvent(evId)
      if (target) {
        const { data } = await s.db.from('space_messages').select('seq').eq('id', target.id).maybeSingle()
        const seq = Number((data as any)?.seq || 0)
        /* the Matrix client's own position, kept apart from our web client's on purpose: reading
           on a phone should not mark the room read in a browser somebody left open */
        if (seq) await s.db.from('matrix_read').upsert({ user_id: s.userId, channel_id: ch.id, seq, updated_at: new Date().toISOString() })
      }
      return json({})
    }

    return no(REFUSALS.unsupported(`that room endpoint (${what ?? '/'})`))
  }

  /* ---- a person ---- */
  if (seg[0] === '_matrix' && seg[3] === 'profile') {
    const who = readRoom(decodeURIComponent(seg[4] ?? '')) ? null : (decodeURIComponent(seg[4] ?? ''))
    const u = who && who.startsWith('@') ? who : null
    const id = u ? (u.match(/^@([0-9a-f]{32}):/i) || [])[1] : null
    const uuid = id ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}` : s.userId
    const { data } = await s.db.from('profiles').select('name, avatar_url').eq('id', uuid).maybeSingle()
    return json({ displayname: (data as any)?.name ?? null })
  }

  /* ---- media: through the repository, never a bucket url in an event (3.10) ---- */
  /* the old media paths, and the authenticated ones a current client uses instead */
  const isMedia = (seg[0] === '_matrix' && seg[1] === 'media')
    || (seg[0] === '_matrix' && seg[1] === 'client' && seg[2] === 'v1' && seg[3] === 'media')
  if (isMedia) {
    /* v1 shifts every part one along: client/v1/media/download/… against media/v3/download/… */
    const at = seg[1] === 'media' ? 0 : 1
    const what = seg[3 + at]
    const mediaId = seg[5 + at] ?? ''
    if (what === 'config' && req.method === 'GET') {
      return json({ 'm.upload.size': MAX_UPLOAD_MB * 1024 * 1024 })
    }
    if (what === 'upload' && req.method === 'POST') {
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (bytes.length > MAX_UPLOAD_MB * 1024 * 1024) return no(REFUSALS.tooLarge(MAX_UPLOAD_MB))
      const EXT: Record<string, string> = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
        'application/pdf': 'pdf', 'text/plain': 'txt', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
      }
      const type_ = String(req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      const ext = EXT[type_]
      if (!ext) return no(REFUSALS.unsupported(`files of type ${type_ || 'unknown'}`))
      const path_ = `matrix/${s.userId}/${crypto.randomUUID()}.${ext}`
      const { error } = await s.db.storage.from('spaces').upload(path_, bytes, { contentType: type_ })
      if (error) return no(REFUSALS.cannotStage(error.message))
      return json({ content_uri: `mxc://${host}/${btoa(path_).replace(/=+$/, '')}` })
    }
    if ((what === 'download' || what === 'thumbnail') && req.method === 'GET') {
      const p = pathOfMedia(mediaId)
      if (!p) return no(REFUSALS.unsupported('that media id'))
      /* signed as them, so a file in a room they cannot read is refused by storage's own policy */
      const { data, error } = await s.db.storage.from('spaces').createSignedUrl(p, 60)
      if (error || !data) return no(REFUSALS.notInRoom())
      const got = await fetch(data.signedUrl)
      return new Response(got.body, { status: got.status, headers: { ...CORS, 'Content-Type': got.headers.get('content-type') || 'application/octet-stream' } })
    }
  }

  return no(REFUSALS.unsupported(`${req.method} ${path}`))
})

/* the sync token: a seq per channel, packed small. A client stores it and hands it back, so it
   must survive a round trip through a string and mean the same thing. */
/*
 * TWO RESERVED KEYS beside the channels. A sync carries more than a timeline now: how far the
 * to-device queue has been handed over, and when the last sync was, which is what "whose devices
 * changed" is measured against. Both belong in the token, because the token is the only thing a
 * client gives back — keeping them server-side would make two clients of one person interfere.
 *
 * They are told apart from a channel by NOT being 32 hex characters, which every packed uuid is.
 * A client never looks inside the token, so this costs it nothing.
 */
const TD = 'td'   /* the last to-device row handed over */
const AT = 'at'   /* when this sync happened, in ms — for `device_lists` */

function makeSince(next: Record<string, number>) {
  const pairs = Object.entries(next).map(([id, seq]) => `${id.replace(/-/g, '')}:${seq}`)
  return pairs.length ? btoa(pairs.join(',')).replace(/=+$/, '') : '0'
}
function parseSince(since: string | undefined): Record<string, number> {
  if (!since || since === '0') return {}
  try {
    const out: Record<string, number> = {}
    for (const p of atob(since).split(',')) {
      const [h, n] = p.split(':')
      if (!h || !n) continue
      /* a reserved key keeps its own name; anything 32 hex long is a channel */
      if (!/^[0-9a-f]{32}$/i.test(h)) { out[h] = Number(n) || 0; continue }
      out[`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`] = Number(n) || 0
    }
    return out
  } catch { return {} }
}
