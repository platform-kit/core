/*
 * The rules a call made browser to browser follows, pure and with no imports, so the engine and
 * build/huddle.test.mjs read the same ones.
 *
 * The only genuinely tricky thing in a mesh is deciding who offers. If both sides offer at once the
 * negotiation collides — "glare" — and both can end up with no media. The fix is not a timer or a
 * retry: it is a rule both sides can apply to the same two names and reach opposite answers. Here it
 * is the ordering of the two ids: the lower offers, the higher waits and answers. Every peer applies
 * it locally, nobody arbitrates, and there is no round trip to agree it.
 */

/* of two people, which one opens the connection */
export const shouldOffer = (me, them) => String(me) < String(them)

/* the same rule said the other way, for the side that is expected to answer */
export const shouldAnswer = (me, them) => String(me) > String(them)

/* a person in the room twice — two tabs, a reconnection — is one person; the newest wins */
export function livePeers(seen = [], me = null, now = Date.now(), staleMs = 30000) {
  const by = new Map()
  for (const p of seen) {
    if (!p || !p.id || p.id === me) continue
    if (p.at && now - new Date(p.at).getTime() > staleMs) continue
    const had = by.get(p.id)
    if (!had || new Date(p.at || 0) >= new Date(had.at || 0)) by.set(p.id, p)
  }
  return [...by.values()]
}

/* whether another person may join, and why not when they may not */
export function roomFull(count, max) {
  const n = Number(count) || 0
  const cap = Number(max) || 0
  return cap > 0 && n >= cap
}

/* the tiles a call draws: the reader first, then everyone else by name. A tile knows only what a
   surface needs — who it is, whether they are speaking, and what is off. */
export function tiles(peers = [], me = {}, words = {}) {
  const mine = { id: me.id, name: words.you || 'You', me: true, speaking: !!me.speaking, muted: !!me.muted, cameraOff: !!me.cameraOff, stream: me.stream || null }
  const theirs = peers
    .map((p) => ({ id: p.id, name: p.name || words.someone || 'someone', me: false, speaking: !!p.speaking, muted: !!p.muted, cameraOff: !!p.cameraOff, stream: p.stream || null }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return [mine, ...theirs]
}

/* how a call is laid out: one, two, or a grid. Pure so the page never computes it twice. */
export function layoutOf(n, sharing = false) {
  if (sharing) return 'stage'
  if (n <= 1) return 'alone'
  if (n === 2) return 'pair'
  return 'grid'
}

/* a connection's state said in one word the surface can show */
export function stateOf(pc) {
  const s = String(pc || '')
  if (s === 'connected' || s === 'completed') return 'connected'
  if (s === 'failed') return 'failed'
  if (s === 'disconnected' || s === 'closed') return 'gone'
  return 'connecting'
}

/* whether a call can be made at all with what we were given, and what to say when it cannot. A pair
   behind strict NAT needs a relay; with none, the call is told so rather than left spinning. */
export function reachable({ relay, state, seconds }) {
  if (state === 'connected') return { ok: true }
  if (state === 'failed') return { ok: false, reason: relay ? 'failed' : 'no-relay' }
  if (!relay && Number(seconds) >= 12) return { ok: false, reason: 'no-relay' }
  return { ok: true, waiting: true }
}
