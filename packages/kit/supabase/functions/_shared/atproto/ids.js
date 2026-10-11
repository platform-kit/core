/*
 * WHO AND WHAT, IN ATPROTO'S WORDS — plain JavaScript, no imports, read by the function and by the
 * tests alike (build/atproto.test.mjs). A member's handle is their username under the site's handle
 * domain; their DID is the portable did:plc made when they joined the wider network, else a did:web
 * on that handle, which the site answers for and nobody outside holds. A record's at:// URI is never
 * stored: it is made here from the author's identity as it is now (openspec: atproto-api).
 */

export const POST = 'app.bsky.feed.post'
export const LIKE = 'app.bsky.feed.like'
export const REPOST = 'app.bsky.feed.repost'
export const FOLLOW = 'app.bsky.graph.follow'
export const BLOCK = 'app.bsky.graph.block'
export const PROFILE = 'app.bsky.actor.profile'
export const GENERATOR = 'app.bsky.feed.generator'

/* the collections a member may write through the protocol, and nothing else */
export const WRITABLE = [POST, LIKE, REPOST, FOLLOW, BLOCK, PROFILE]

/* a space's message is no record in anybody's repository; when the protocol shows it as a post its
   record key says so, and that key is never a TID, so it can never meet a real one */
export const SPACE_KEY = 's~'
export const spaceKey = (messageId) => SPACE_KEY + String(messageId).replace(/-/g, '')
export const messageOfKey = (rkey) => {
  const hex = String(rkey || '').startsWith(SPACE_KEY) ? String(rkey).slice(SPACE_KEY.length) : ''
  return /^[0-9a-f]{32}$/.test(hex) ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : null
}

export const cleanDomain = (d) => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\.+|\.+$/g, '')

/* a member's handle: their username under the handle domain, or nothing — no username, no handle */
export const handleOf = (username, domain) => (username && cleanDomain(domain) ? `${String(username).toLowerCase()}.${cleanDomain(domain)}` : null)

/* the username a handle under our domain names, or nothing for a handle elsewhere */
export function usernameOfHandle(handle, domain) {
  const h = String(handle || '').trim().toLowerCase().replace(/^@/, '')
  const d = cleanDomain(domain)
  if (!d || !h.endsWith('.' + d)) return null
  const u = h.slice(0, -(d.length + 1))
  return /^[a-z0-9][a-z0-9-]{1,38}$/.test(u) ? u : null
}

/* a member's DID: the portable one where they joined, else the site's did:web on their handle.
   did:web may not carry a port, so a domain with one is written with %3A as the method requires. */
export const didWebOf = (handle) => (handle ? 'did:web:' + String(handle).replace(/:/g, '%3A') : null)
export const nameOf = (person) => (person && (person.handle_name || person.username)) || null
export const didOf = (person, domain) => (person && person.plc_did) || didWebOf(handleOf(nameOf(person), domain))

/* the handle a did:web names, where it is one of ours */
export function handleOfDidWeb(did) {
  const m = /^did:web:(.+)$/.exec(String(did || ''))
  return m ? decodeURIComponent(m[1]) : null
}

export const isDid = (s) => /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.%-]+)$/.test(String(s || ''))

/* at://<did>/<collection>/<rkey>, and back */
export const uriOf = (did, collection, rkey) => `at://${did}/${collection}/${rkey}`
export function parseUri(uri) {
  const m = /^at:\/\/([^/]+)\/([a-zA-Z0-9.]+)\/([A-Za-z0-9._:~-]+)$/.exec(String(uri || ''))
  return m ? { did: m[1], collection: m[2], rkey: m[3] } : null
}

/* a TID: thirteen characters of base32-sortable time, first character no higher than j */
export const isTid = (s) => /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(String(s || ''))
const S32 = '234567abcdefghijklmnopqrstuvwxyz'
export function newTid(now = Date.now(), clock = Math.floor(Math.random() * 1024)) {
  let v = (BigInt(Math.floor(now)) * 1000n << 10n) | BigInt(clock & 1023)
  let s = ''
  for (let i = 0; i < 13; i++) { s = S32[Number(v & 31n)] + s; v >>= 5n }
  return s
}

/* a cursor is the moment the page stopped at, as the protocol passes it back */
export const cursorOf = (rows, key = 'created_at') => (rows.length ? String(rows[rows.length - 1][key]) : undefined)

/*
 * MAY THIS METHOD BE ASKED AT ALL? Other apps signing in (network.apps) is the site owner's choice,
 * off by default. Off, the surface answers only what the site needs for itself — its description —
 * and, where it federates, what relays and other servers need to read the public repositories
 * (sync, a handle, a public record). Everything an app would sign in to use is refused.
 */
const PUBLIC_WHEN_FEDERATING = new Set(['com.atproto.identity.resolveHandle', 'com.atproto.repo.describeRepo', 'com.atproto.repo.getRecord', 'com.atproto.repo.listRecords'])
export function clientAllowed(nsid, { apps = false, federate = false } = {}) {
  if (apps) return true
  if (nsid === 'com.atproto.server.describeServer') return true
  if (federate && (/^com\.atproto\.sync\./.test(nsid) || PUBLIC_WHEN_FEDERATING.has(nsid))) return true
  return false
}
