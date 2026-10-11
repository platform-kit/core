/* THE COMMUNITY'S ONE NOTIFICATION LIST, against the local stack (openspec: community-layouts).
   A mention in a room and a like of a network post land in one list with one count, and opening the
   list clears both; a reply in a thread the reader is in is there too, and a reply that names them
   is a mention and not twice; somebody outside the room sees none of it; an event they are going to
   comes into the list the day before. Everything it makes is removed at the end. Skipped with a
   note when the stack is down (NETWORK_TEST=0 skips it too, as it does the network's own). */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('community-notes-db: ' + m)
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
const SLUG = 'community-test-' + Math.random().toString(36).slice(2, 8)
let spaceId = null, eventId = null
const posts = [], people = []
const seenBefore = new Map()

try {
  const A = await as('member@example.com')     /* the one things happen to */
  const B = await as('member2@example.com')    /* in the room with them */
  const C = await as('free@example.com')       /* outside it */
  people.push(A.id, B.id, C.id)
  for (const r of (await service.from('network_seen').select('*').in('user_id', people)).data || []) seenBefore.set(r.user_id, r.seen_at)
  /* the list's clock starts now for both, so only what this test does counts */
  const look = (who) => service.from('network_seen').upsert({ user_id: who.id, seen_at: new Date().toISOString() })
  await look(A); await look(C)
  await new Promise((r) => setTimeout(r, 50))

  const { data: space, error: se } = await service.from('spaces').insert({ slug: SLUG, name: 'A community test space', kind: 'community', fill: {} }).select().single()
  if (se) throw se
  spaceId = space.id
  const { data: room, error: re } = await service.from('channels').insert({ space_id: spaceId, slug: 'talk', name: 'talk', visibility: 'open' }).select().single()
  if (re) throw re
  await service.from('space_members').insert([{ space_id: spaceId, user_id: A.id }, { space_id: spaceId, user_id: B.id }])
  await service.from('channel_members').upsert([{ channel_id: room.id, user_id: A.id }, { channel_id: room.id, user_id: B.id }])

  const list = async (who) => ((await who.sb.rpc('community_notifications', {})).data || [])
  const count = async (who) => (await who.sb.rpc('community_unread')).data

  /* ------------------------------------------------------------ a mention and a like */
  const { error: me } = await B.sb.from('space_messages').insert({ channel_id: room.id, author_id: B.id, body: `<@${A.id}> have a look at this` })
  ok('somebody in the room may mention them', !me, me && me.message)
  const { data: p, error: pe } = await A.sb.from('network_posts').insert({ author_id: A.id, text: 'a post to be liked', audience: 'here' }).select().single()
  if (pe) throw pe
  posts.push(p.id)
  await B.sb.from('network_likes').insert({ author_id: B.id, post_id: p.id })
  let L = await list(A)
  ok('the mention is in their one list', L.some((r) => r.source === 'mention' && r.reason === 'mention-user' && r.actor_id === B.id))
  ok('…and the like beside it', L.some((r) => r.source === 'network' && r.reason === 'like' && r.subject_post_id === p.id))
  ok('…newest first', L.every((r, i) => i === 0 || new Date(L[i - 1].at) >= new Date(r.at)))
  ok('the count is two', (await count(A)) === 2, String(await count(A)))
  await look(A)
  ok('opening the list clears both', (await count(A)) === 0, String(await count(A)))
  ok('…and the list still holds them', (await list(A)).length >= 2)

  /* ------------------------------------------------------------ a thread they are in */
  const { data: root } = await A.sb.from('space_messages').insert({ channel_id: room.id, author_id: A.id, body: 'a question for the room' }).select().single()
  await B.sb.from('space_messages').insert({ channel_id: room.id, author_id: B.id, body: 'an answer', thread_root_id: root.id })
  await B.sb.from('space_messages').insert({ channel_id: room.id, author_id: B.id, body: `<@${A.id}> and a second, to you`, thread_root_id: root.id })
  L = await list(A)
  ok('an answer in their thread is in the list', L.some((r) => r.source === 'reply' && r.item.body === 'an answer'))
  ok('…an answer naming them is a mention, and only once', L.filter((r) => r.item && r.item.body === `<@${A.id}> and a second, to you`).length === 1
    && L.some((r) => r.source === 'mention' && r.item.body.includes('a second')))
  ok('their own lines are never in it', !L.some((r) => r.actor_id === A.id))
  ok('the count is the two new ones', (await count(A)) === 2, String(await count(A)))

  /* ------------------------------------------------------------ a stranger to the room */
  const LC = await list(C)
  ok('somebody outside the room sees none of it', !LC.some((r) => r.source !== 'network' || r.subject_post_id === p.id))
  ok('…and counts none of it', (await count(C)) === 0, String(await count(C)))

  /* ------------------------------------------------------------ an event they are going to */
  const { data: ev, error: ee } = await service.from('calendar_events').insert({ slug: SLUG, title: 'A test evening', space_id: spaceId, published: true, starts_at: new Date(Date.now() + 5 * 864e5).toISOString() }).select().single()
  if (ee) throw ee
  eventId = ev.id
  const soon = new Date(Date.now() + 6 * 3600e3).toISOString(), later = new Date(Date.now() + 4 * 864e5).toISOString()
  const { data: occ } = await service.from('calendar_occurrences').insert([{ event_id: ev.id, starts_at: soon }, { event_id: ev.id, starts_at: later }]).select()
  for (const o of occ) await service.from('calendar_rsvps').insert({ occurrence_id: o.id, user_id: A.id, state: 'going' })
  L = await list(A)
  const evs = L.filter((r) => r.source === 'event')
  ok('an event they are going to comes in the day before', evs.length === 1 && evs[0].item.starts_at.slice(0, 16) === soon.slice(0, 16), JSON.stringify(evs.map((e) => e.item.starts_at)))
  ok('…named, with its space', evs[0] && evs[0].item.title === 'A test evening' && evs[0].item.space === 'A community test space')
  ok('…and not to anybody who did not say they are going', !(await list(B)).some((r) => r.source === 'event' && r.item.slug === SLUG))
} catch (e) {
  fail++; console.log('  FAIL  ' + e.message)
} finally {
  if (eventId) await service.from('calendar_events').delete().eq('id', eventId)
  if (spaceId) await service.from('spaces').delete().eq('id', spaceId)
  if (posts.length) await service.from('network_posts').delete().in('id', posts)
  for (const id of people) {
    if (seenBefore.has(id)) await service.from('network_seen').upsert({ user_id: id, seen_at: seenBefore.get(id) })
    else await service.from('network_seen').delete().eq('user_id', id)
  }
}

console.log(`community-notes-db: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
