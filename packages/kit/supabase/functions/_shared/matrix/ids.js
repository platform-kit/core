/*
 * THE NAMES MATRIX USES FOR THINGS WE ALREADY HAVE.
 *
 * Matrix names a room `!local:server`, a user `@local:server` and a Space the same way a room is
 * named. We already have ids for all three, so this is a total, reversible mapping and nothing
 * more: no allocation, no table of correspondences, no database. A correspondence table would be
 * a second source of truth about which room is which, and the first thing to go out of step.
 *
 * The local part is the uuid with its hyphens taken out — Matrix's grammar for the local part of a
 * room or user id is deliberately narrow, and a hyphen is fine in practice but a uuid read back
 * out of a client's url, a log line or a bridge's config is easier to eyeball as one run of hex.
 * A single letter in front says which kind of thing it is, so a room id and a Space id can never
 * be confused for one another even though Matrix gives them the same shape.
 *
 * `server` is the site's own host and is passed in rather than read from the environment: these
 * functions run in the Edge Function, in the build and under Node in the test, and a module that
 * reached for `Deno.env` would run in exactly one of them.
 */

const HEX32 = /^[0-9a-f]{32}$/i

/* a uuid without its hyphens, and back */
export const packUuid = (id) => String(id || '').replace(/-/g, '').toLowerCase()
export function unpackUuid(local) {
  const h = String(local || '').toLowerCase()
  if (!HEX32.test(h)) return null
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/* the letter that says what a local part names. One character, so the id stays short, and never
   reused: `c` was channels before Spaces existed and keeping it is cheaper than a migration of
   every client's stored room list. */
export const KIND = { channel: 'c', space: 's', message: 'm' }

const sigil = (s) => (s === 'user' ? '@' : s === 'event' ? '$' : '!')

/* `!c<hex>:host` for a channel, `!s<hex>:host` for a space, `@<hex>:host` for a person,
   `$m<hex>` for a message — an event id carries no host, as Matrix stopped doing in room v4. */
export const roomId = (channel, host) => `!${KIND.channel}${packUuid(channel)}:${host}`
export const spaceId = (space, host) => `!${KIND.space}${packUuid(space)}:${host}`
export const userId = (profile, host) => `@${packUuid(profile)}:${host}`
export const eventId = (message) => `$${KIND.message}${packUuid(message)}`

/* and back. Each answers `{ kind, id }` or null — never a throw and never a guess, because these
   read strings a client chose and a client may send anything at all. */
export function readRoom(s) {
  const m = /^!([cs])([0-9a-f]{32}):(.+)$/i.exec(String(s || ''))
  if (!m) return null
  const id = unpackUuid(m[2])
  return id ? { kind: m[1].toLowerCase() === KIND.channel ? 'channel' : 'space', id, host: m[3] } : null
}
export function readUser(s) {
  const m = /^@([0-9a-f]{32}):(.+)$/i.exec(String(s || ''))
  if (!m) return null
  const id = unpackUuid(m[1])
  return id ? { kind: 'user', id, host: m[2] } : null
}
export function readEvent(s) {
  const m = /^\$m([0-9a-f]{32})$/i.exec(String(s || ''))
  if (!m) return null
  const id = unpackUuid(m[1])
  return id ? { kind: 'message', id } : null
}

/*
 * IS THIS OURS? A client may name a room on another homeserver — because somebody pasted a link,
 * or a bridge is configured hopefully — and the answer has to be a refusal that says why rather
 * than a lookup that finds nothing and reads as an empty room. So the host is compared, and a
 * room id we could not have minted is foreign whatever it looks like.
 */
export function isOurs(s, host) {
  const r = readRoom(s) || readUser(s)
  if (!r) return false
  return !r.host || r.host === host
}
export const foreignHost = (s) => {
  const r = readRoom(s) || readUser(s)
  return r && r.host ? r.host : null
}
