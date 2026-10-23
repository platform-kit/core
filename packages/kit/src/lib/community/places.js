/*
 * THE COMMUNITY'S PLACES, AS ONE LIST (streamline-social-layout). Pure: no store, no network, no
 * words — the navigation draws what this returns, and build/community-nav.test.mjs holds it for every
 * kind of person and every configuration.
 *
 * The social layout's navigation has two sections. The first, with no heading: Home, Explore (only
 * where For You is on), Messages, Events, Notifications; then Saved, Drafts and a customer's own
 * tickets, each only while it holds something and the site has not hidden it; then Work, for whoever
 * answers a queue — one row whose count is the sum of the queues, unfolding to a row per queue. The
 * second is the spaces (drawn by the navigation from the spaces themselves).
 *
 * Every place the chat layout offers is reachable from here or from a place here: REACH says where
 * each of the chat layout's places went, and the test refuses a chat place with no home.
 */

/* what a site may take out of view with community.hide; nothing by default */
export const HIDEABLE = ['following', 'saved', 'drafts', 'tickets']

/* the queues, in the order Work unfolds them */
/* the order Work unfolds in: the people first (clients, then comments on what the site publishes), then
   support (the chat, then the tickets it raises), then the social accounts (messages, then comments) */
export const QUEUES = ['clients', 'comments', 'support', 'tickets', 'social-dms', 'social-comments']

const n = (v) => Math.max(0, Number(v) || 0)

/*
 * ctx:
 *   network     the network module is on
 *   events      the events module is on (Events is a place)
 *   forYou      the site turned For You on (community.forYou)
 *   signedIn    a reader is signed in
 *   hide        the site's community.hide list
 *   coaching    this reader has a coaching place in the community (coachingPlace)
 *   counts      { dms, coaching, notes, mentions, saved, drafts, tickets } — what waits in each
 *   work        [{ key, count }] — the queues this reader answers
 *   locked      the places this reader may not enter (openspec: community-access-by-entitlement) — by
 *               word (home, events, messages, notifications) or a registered place's key. A locked
 *               place stays in the list, marked, with no count: opening it shows the join card.
 */
export function socialPlaces(ctx = {}) {
  const hide = new Set(ctx.hide || [])
  const c = ctx.counts || {}
  const signed = !!ctx.signedIn
  const first = [
    { key: ctx.network ? 'net' : 'index', icon: 'home', word: 'home' },
    ...(ctx.network && ctx.forYou ? [{ key: 'net-explore', icon: 'search', word: 'explore' }] : []),
    /* the order James set (2026-10-08): Home, Events, Coaching, Messages, the site's places, Notifications */
    ...(ctx.events !== false ? [{ key: 'events', icon: 'calendar', word: 'events' }] : []),
    /* COACHING, a place of its own where coaching lives in the community: sessions are public to
       discover, while the coaching conversation and its count belong to the signed-in reader. */
    ...(ctx.coaching || (signed && n(c.coaching) > 0) ? [{ key: 'coaching', icon: 'armchair', word: 'coaching', count: n(c.coaching) }] : []),
    ...(signed ? [{ key: 'dms', icon: 'dm', word: 'messages', count: n(c.dms) }] : []),
    /* THE PLACES A SITE REGISTERED (community.places), after Messages and before Notifications, in the order given:
       each with its word and icon, shown to whom its registration says, with the count it carries */
    ...(ctx.places || []).filter((x) => x.shows === 'everyone' || signed).map((x) => ({ key: x.key, icon: x.icon, word: x.word, count: n((c.places || {})[x.key]), place: true })),
    ...(signed ? [{ key: ctx.network ? 'net-notes' : 'mentions', icon: 'bell', word: 'notifications', count: ctx.network ? n(c.notes) : n(c.mentions) }] : []),
    ...(signed && n(c.saved) > 0 && !hide.has('saved') ? [{ key: 'saved', icon: 'star', word: 'saved' }] : []),
    ...(signed && n(c.drafts) > 0 && !hide.has('drafts') ? [{ key: 'drafts', icon: 'pencil', word: 'drafts', count: n(c.drafts) }] : []),
    ...(signed && n(c.tickets) > 0 && !hide.has('tickets') ? [{ key: 'my-tickets', icon: 'ticket', word: 'my-tickets', count: n(c.tickets) }] : []),
  ]
  const rows = QUEUES.map((k) => (ctx.work || []).find((w) => w.key === k)).filter(Boolean).map((w) => ({ key: w.key, count: n(w.count) }))
  const work = signed && rows.length ? { key: 'work', count: rows.reduce((s, r) => s + r.count, 0), rows } : null
  /* a place the reader may not enter keeps its row — the way to what it costs — with nothing counted */
  const locked = new Set(ctx.locked || [])
  const shut = first.map((x) => (locked.has(x.word) || (x.place && locked.has(x.key)) ? { ...x, locked: true, count: 0 } : x))
  return { first: shut, work }
}

/*
 * WHICH PLACES A READER MAY NOT ENTER, from the database's answers: `home` (network.access read, false
 * when the reader is outside it) and every gated place's admission. Nothing is locked until it is known.
 */
export function lockedPlaces({ home = true, admitted = {} } = {}) {
  const out = []
  if (home === false) out.push('home')
  for (const [k, ok] of Object.entries(admitted || {})) if (ok === false) out.push(k)
  return out
}

/* what community.hide: ['following'] takes away, read by the column and a person's page */
export const showsFollowing = (hide = []) => !(hide || []).includes('following')

/*
 * WHERE EACH OF THE CHAT LAYOUT'S PLACES WENT. A place in the social list is reachable as itself; the
 * rest are reached from one that is:
 */
export const REACH = {
  index: 'spaces',            /* the community's front page: the Spaces heading */
  threads: 'notifications',   /* thread replies: Notifications' Replies filter, or its Threads tab without the network */
  mentions: 'notifications',  /* Notifications' Mentions filter (without the network it is Notifications itself) */
  unreads: 'spaces',          /* bold channels and each space row's count */
  discover: 'browse-spaces',  /* Find a space: Browse spaces at the foot of the spaces */
}
/* the place a chat-layout key is reached from in the social list, for a context */
export const reachOf = (key, ctx = {}) => (REACH[key] === 'notifications' ? (ctx.network ? 'net-notes' : 'mentions') : REACH[key])

/* without the network, Notifications is the spaces' own lists, as tabs: what named you, and the threads you are in */
export const NOTE_TABS = ['mentions', 'threads']

/* both layouts share the same primary destinations; the chat frame changes their presentation only */
export function chatNavigation(ctx = {}) {
  return socialPlaces(ctx)
}

/* the chat layout's places for a context, including destinations surfaced under More */
export function chatPlaces(ctx = {}) {
  const c = ctx.counts || {}
  const navigation = chatNavigation(ctx)
  return [
    ...navigation.first.map((place) => place.key),
    ...(navigation.work ? navigation.work.rows.map((row) => row.key) : []),
    ...(n(c.unreads) > 0 ? ['unreads'] : []),
    ...(ctx.signedIn ? ['mentions', 'threads', 'saved', 'drafts'] : []),
    'discover',
  ]
}

/*
 * A SPACE FOLDS unless the reader is in it or opened it themselves: open is the set of space ids
 * they unfolded by hand (kept per browser by the navigation).
 */
export const spaceOpen = (spaceId, currentSpaceId, open = []) => spaceId === currentSpaceId || (open || []).includes(spaceId)

/*
 * WHAT A SPACE OPENS ON (openspec: remove-space-about-tab). A space has no home of its own: it opens
 * on what it holds — its feed, or its first room where it has none. Its rooms are listed feed first,
 * the rest in their own order; a direct message or an archived room is never one of them. A space of
 * one room has nothing to unfold, so its row is the way into that room.
 */
const isFeed = (c) => c.mode === 'feed'
export function roomsOf(spaceId, channels = []) {
  const live = (channels || []).filter((c) => c.space_id === spaceId && c.kind !== 'dm' && !c.archived_at)
  return [...live.filter(isFeed), ...live.filter((c) => !isFeed(c))]
}
export const frontOf = (spaceId, channels = []) => roomsOf(spaceId, channels)[0] || null
export function foldOf(spaceId, channels = []) {
  const rooms = roomsOf(spaceId, channels)
  return rooms.length > 1 ? rooms : []
}

/*
 * A SPACE'S OTHER PLACES (openspec: space-places-in-the-nav). A space of several rooms unfolds in the
 * navigation to its rooms and then its places — Events where it has any, People, and Moderation for
 * whoever keeps it — and has no tabs. A space of one room (or only its feed) keeps the tabs, since a
 * list of one room and three places under it would be a menu for a single page.
 */
export function spaceItems(spaceId, channels = [], { events = false, keeps = false } = {}) {
  const rooms = foldOf(spaceId, channels)
  if (!rooms.length) return []
  return [
    ...rooms.map((c) => ({ kind: 'room', key: c.id, room: c })),
    ...(events ? [{ kind: 'place', key: 'events' }] : []),
    { kind: 'place', key: 'people' },
    ...(keeps ? [{ kind: 'place', key: 'keeping' }] : []),
  ]
}
/* whether the space's header carries tabs: only where its places are not in the navigation */
export const spaceTabbed = (spaceId, channels = []) => !foldOf(spaceId, channels).length

/*
 * A READER'S COACHING PLACE in the community (openspec: coaching-in-one-place). Where coaching lives
 * in the community, sessions are public to discover; a signed-in reader also gets the conversations
 * (where they may write to a coach, or are written to as one). Giving sessions takes nothing away —
 * somebody who coaches may also be a member with a coach of their own — so a coach's place holds what
 * a member's does, and their Sessions also carries the ones they give, their hours and their offerings.
 *
 *   ctx: where ('spaces' | 'app'), signedIn, coach, mayChat (a membership, a session's week, or a
 *        line waiting), chatOn (the coaching module), sessionsOn (the sessions module)
 *   →    null, or { chat, sessions }
 */
export function coachingPlace(ctx = {}) {
  if (ctx.where !== 'spaces') return null
  const chat = !!ctx.signedIn && ctx.chatOn !== false && !!ctx.mayChat
  const sessions = ctx.sessionsOn !== false
  return chat || sessions ? { chat, sessions } : null
}

/*
 * WHERE AN OLD ADDRESS NOW LIVES (openspec: community-places-by-registration). A registered place may
 * claim addresses: one it claims, or any address under it, forwards to the place's own address with
 * what followed the claim; the longest claim wins, a claim written '!/x' keeps /x and what is under
 * it where it is, and an address nothing claims gives null. Kit claims (Coaching's) are passed in the
 * same list as { key, claims }.
 */
export function forwardOf(path, places = [], base = '/feed') {
  const p = (path || '').replace(/\/+$/, '') || '/'
  const under = (c) => p === c || p.startsWith(c + '/')
  let best = null
  for (const x of places || []) for (const c of x.claims || []) {
    const bare = c.replace(/^!/, '')
    if (!under(bare)) continue
    if (!best || bare.length > best.claim.length) best = { claim: bare, key: x.key, keep: c.startsWith('!') }
  }
  if (!best || best.keep) return null
  return `${base}/${best.key}${p.slice(best.claim.length)}`
}

/* The social layout's community home is the configured community path. Keep individual spaces at
   /spaces/<slug>, but let the old bare /spaces address resolve to that home. */
export const socialSpacesHome = (path, layout, spacesPath, communityPath) =>
  layout === 'social' && path === spacesPath ? communityPath : path
