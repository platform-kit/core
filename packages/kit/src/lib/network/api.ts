/*
 * THE NETWORK, FOR THE SITE'S OWN PAGES — the reactive store the timeline, a person's page, a
 * thread and the notifications draw from. Every read and write goes to the tables as the signed-in
 * reader (or as a guest), so the database's guards decide what comes back (93-network.sql); nothing
 * here decides who may see what. The atproto surface reads the same rows for other apps.
 */
import { reactive } from 'vue'
import { supabase, configured } from '../supabase.js'
import { session, user } from '../auth.js'
import site from '#site'
/* PINNING (community.pinning, off by default; openspec: spaces-reach-home): with it off every space a
   member is in reaches their timeline; with it on only the ones they pinned do, and the pin is offered */
export const PINNING = !!(site && site.community && site.community.pinning)
import { joinPages, cursorOf, postOfMessage, peopleIn, toggled, spread } from './model.js'
import { probe } from './probe.js'
import { MEDIA } from '../../../supabase/functions/_shared/atproto/media.js'

const POST_COLS = 'id, author_id, rkey, text, audience, media, reply_root_id, reply_parent_id, quote_id, reply_parent_uri, quote_uri, like_count, repost_count, reply_count, quote_count, created_at, removed_at'
const MSG_COLS = 'id, channel_id, author_id, body, title, attachment, attachment_type, media, reply_count, created_at, channels!space_messages_channel_fkey(slug, space_id, spaces(id, slug, name))'
const PAGE = 30

export const net = reactive<any>({
  people: {},        /* id → { name, username, page, avatar… } */
  posts: {},         /* id → post (the network's) */
  messages: {},      /* id → a space's message, shaped as a post */
  spaces: [],        /* where the reader may post to a space's members, and what they pinned */
  images: {},        /* path → a signed url: a post's pictures, videos and posters */
  /* whether this reader may read and write here (network.access): asked of the database, true where the site sells nothing */
  access: { read: true, write: true, known: false },
  /* the community's other gated places (community.access, places[].access): place → whether this reader
     enters, asked of the database (community_admitted); a place that is not here is open */
  places: {},
})

const me = () => (user.value ? user.value.id : null)
const ok = () => !!(supabase && configured)

/* ---------------------------------------------------------------- who takes part */

/* the database decides (network_admitted, over network.access; community_admitted for every other gated
   place); a site that sells nothing is open */
const GATED = (site.community && site.community.gated) || []
export async function admission() {
  const grants = site.network && site.network.access
  const places = GATED.length && ok()
    ? Promise.all(GATED.map(async (k) => [k, (await (supabase as any).rpc('community_admitted', { p_place: k })).data !== false]))
    : Promise.resolve([])
  if (!grants || !ok()) { net.access = { read: true, write: true, known: true } }
  else {
    const ask = async (g: string) => (await (supabase as any).rpc('network_admitted', { p_user: me(), p_grant: g })).data === true
    const [read, write] = await Promise.all([ask('read'), ask('write')])
    net.access = { read, write, known: true }
  }
  net.places = Object.fromEntries(await places)
  return net.access
}

/* ---------------------------------------------------------------- who */

export async function loadPeople(ids: Iterable<string>|null|undefined) {
  const want = [...new Set(ids)].filter((id) => id && !net.people[id])
  if (!want.length || !ok()) return
  const { data } = await (supabase as any).rpc('network_people', { p_ids: want })
  for (const p of data || []) net.people[p.id] = p
}

export async function personOf(userId: any) {
  if (!ok() || !userId) return null
  const { data } = await (supabase as any).rpc('network_person', { p_user: userId })
  return data || null
}

/* ---------------------------------------------------------------- what */

/* the reader's likes and reposts among these posts, so each card knows whether it is pressed */
async function markMine(ids: string|any[]) {
  if (!me() || !ids.length) return
  const [likes, reposts] = await Promise.all([
    (supabase as any).from('network_likes').select('post_id').eq('author_id', me()).in('post_id', ids),
    (supabase as any).from('network_reposts').select('post_id').eq('author_id', me()).in('post_id', ids),
  ])
  const liked = new Set((likes.data || []).map((r: { post_id: any }) => r.post_id))
  const reposted = new Set((reposts.data || []).map((r: { post_id: any }) => r.post_id))
  for (const id of ids) if (net.posts[id]) net.posts[id] = { ...net.posts[id], liked: liked.has(id), reposted: reposted.has(id) }
}

/* posts by id, with what they quote and answer, their people, and the reader's own marks */
export async function loadPosts(ids: any[]|Iterable<unknown>|null|undefined) {
  const want = [...new Set(ids)].filter(Boolean)
  if (!want.length || !ok()) return []
  const { data } = await (supabase as any).from('network_posts').select(POST_COLS).in('id', want)
  const rows = data || []
  for (const p of rows) net.posts[p.id] = { ...p, kind: 'post' }
  /* what they quote and answer, one level, so a card can say what it is answering */
  const more = new Set<string>()
  for (const p of rows) { if (p.quote_id && !net.posts[p.quote_id]) more.add(p.quote_id); if (p.reply_parent_id && !net.posts[p.reply_parent_id]) more.add(p.reply_parent_id) }
  if (more.size) {
    const { data: extra } = await (supabase as any).from('network_posts').select(POST_COLS).in('id', [...more])
    for (const p of extra || []) net.posts[p.id] = { ...p, kind: 'post' }
  }
  // @ts-expect-error TS2538, from the conversion: Type 'unknown' cannot be used as an index type.
  const all = want.concat([...more]).map((id) => net.posts[id]).filter(Boolean)
  await Promise.all([loadPeople(peopleIn(all)), markMine(want), signImages(all)])
  return rows
}

async function loadMessages(ids: any[]|Iterable<unknown>|null|undefined) {
  const want = [...new Set(ids)].filter(Boolean)
  if (!want.length || !ok()) return
  const { data, error } = await (supabase as any).from('space_messages').select(MSG_COLS).in('id', want)
  if (error) throw error
  for (const m of data || []) {
    const ch = m.channels || {}
    net.messages[m.id] = postOfMessage({ ...m, channel_slug: ch.slug }, ch.spaces || null)
  }
  // @ts-expect-error TS2538, from the conversion: Type 'unknown' cannot be used as an index type.
  await Promise.all([loadPeople(peopleIn(want.map((id) => net.messages[id]).filter(Boolean))), markMessages(want),
    import('../spaces/api.js').then((m) => m.signMedia(data || [])).catch(() => {})])
}

/* ONE WAY TO REACT: a space's post is liked as the spaces like anything — a ❤️ reaction, the same row the
   spaces page writes — so its card can wear the network's bar and count it where the spaces count it */
export const LIKE = '❤️'
async function markMessages(ids: string|any[]) {
  if (!ids.length) return
  const { data } = await (supabase as any).from('reactions').select('target_id, user_id').eq('surface', 'message').eq('emoji', LIKE).in('target_id', ids)
  const rows = data || []
  for (const id of ids) {
    if (!net.messages[id]) continue
    const mine = rows.filter((r: { target_id: any }) => r.target_id === id)
    net.messages[id] = { ...net.messages[id], like_count: mine.length, liked: !!me() && mine.some((r: { user_id: any }) => r.user_id === me()) }
  }
}
export async function likeMessage(post: { id: string|number }, on: any) {
  const m = net.messages[post.id]
  if (!m || !me()) return
  net.messages[post.id] = { ...m, liked: on, like_count: Math.max(0, (m.like_count || 0) + (on ? 1 : -1)) }
  const q = on
    ? (supabase as any).from('reactions').insert({ surface: 'message', target_id: post.id, channel_id: m.channel_id, user_id: me(), emoji: LIKE })
    : (supabase as any).from('reactions').delete().eq('surface', 'message').eq('target_id', post.id).eq('user_id', me()).eq('emoji', LIKE)
  const { error } = await q
  if (error) { net.messages[post.id] = m; throw error }
}

/* a picture's or a video's address (and a video's poster), signed for an hour, read only by whoever may read its post */
async function signImages(posts: any[]) {
  const paths = []
  for (const p of posts) for (const im of p.media || []) for (const at of [im && im.path, im && im.poster]) if (at && !net.images[at]) paths.push(at)
  if (!paths.length) return
  const { data } = await (supabase as any).storage.from('network').createSignedUrls(paths, 3600)
  for (const s of data || []) if (s.signedUrl && s.path) net.images[s.path] = s.signedUrl
}

/* ---------------------------------------------------------------- the timeline */

export function timeline() {
  const st = reactive<any>({ items: [], loading: false, done: false, error: '' })
  async function load(reset = false) {
    if (st.loading || !ok() || !session.value) return
    st.loading = true; st.error = ''
    try {
      const before = reset ? null : cursorOf(st.items)
      const { data, error } = await (supabase as any).rpc('network_timeline', { p_before: before, p_limit: PAGE, p_all_spaces: !PINNING })
      if (error) throw error
      const rows = data || []
      await Promise.all([
        loadPosts(rows.filter((r: { post_id: any }) => r.post_id).map((r: { post_id: any }) => r.post_id)),
        loadMessages(rows.filter((r: { message_id: any }) => r.message_id).map((r: { message_id: any }) => r.message_id)),
        loadPeople(rows.map((r: { reposted_by: any }) => r.reposted_by).filter(Boolean)),
      ])
      st.items = reset ? joinPages([], rows) : joinPages(st.items, rows)
      st.done = rows.length < PAGE
    } catch (e: any) { st.error = e.message || String(e) } finally { st.loading = false }
  }
  return { st, load, more: () => load(false), refresh: () => load(true) }
}

/* EXPLORE: everything posted on the site that the reader may read, newest first — the threads'
   openings, not their answers. The database decides what is in it. */
/*
 * FOR YOU (community.forYou): a page of the posts with pictures or video the reader may read, ranked
 * by the database (network_for_you) and arranged by spread — never more than two from one person in
 * any six. Each comes back with its post, a network post or a space's, ready for a tile.
 */
export async function forYou(offset = 0, limit = 30) {
  if (!ok() || !session.value) return { items: [], done: true }
  const { data, error } = await (supabase as any).rpc('network_for_you', { p_offset: offset, p_limit: limit })
  if (error) throw error
  const rows = data || []
  await Promise.all([
    loadPosts(rows.filter((r: { kind: string }) => r.kind === 'post').map((r: { id: any }) => r.id)),
    loadMessages(rows.filter((r: { kind: string }) => r.kind === 'space').map((r: { id: any }) => r.id)),
  ])
  const items = rows.map((r: { kind: string; id: string|number }) => ({ ...r, post: r.kind === 'post' ? net.posts[r.id] : net.messages[r.id] })).filter((r: { post: { media: any } }) => r.post && (r.post.media || []).length)
  return { items: spread(items), done: rows.length < limit }
}

export function discover() {
  const st = reactive<any>({ items: [], loading: false, done: false, error: '' })
  async function load(reset = false) {
    if (st.loading || !ok()) return
    st.loading = true; st.error = ''
    try {
      const before = reset || !st.items.length ? null : st.items[st.items.length - 1].created_at
      let q = (supabase as any).from('network_posts').select(POST_COLS).is('reply_parent_id', null).is('removed_at', null).order('created_at', { ascending: false }).limit(PAGE)
      if (before) q = q.lt('created_at', before)
      /* AND THE READER'S SPACES (spaces-reach-home): with following off this is Home, so the feeds of
         every space they are in come into it too — or only the pinned ones where the site has turned
         pinning on — by the timeline's own read, which applies each space's guards */
      const [{ data, error }, spaced] = await Promise.all([
        q,
        session.value ? (supabase as any).rpc('network_timeline', { p_before: before, p_limit: PAGE, p_all_spaces: !PINNING }) : { data: [] },
      ])
      if (error) throw error
      const rows = data || []
      const spaceRows = ((spaced && spaced.data) || []).filter((r: { kind: string }) => r.kind === 'space')
      await Promise.all([loadPosts(rows.map((r: { id: any }) => r.id)), loadMessages(spaceRows.map((r: { message_id: any }) => r.message_id))])
      const items = [
        ...rows.map((r: { id: any; created_at: any }) => ({ kind: 'post', post_id: r.id, at: r.created_at, created_at: r.created_at })),
        ...spaceRows.map((r: { message_id: any; at: any }) => ({ kind: 'space', message_id: r.message_id, at: r.at, created_at: r.at })),
      ].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime()).slice(0, PAGE)
      st.items = reset ? items : st.items.concat(items)
      st.done = rows.length < PAGE && spaceRows.length < PAGE
    } catch (e: any) { st.error = e.message || String(e) } finally { st.loading = false }
  }
  return { st, load, more: () => load(false), refresh: () => load(true) }
}

/* people: by name for the search box, and who the reader might follow for the rail */
export async function findPeople(q: any, limit = 12) {
  if (!ok() || !me() || !String(q || '').trim()) return []
  const { data } = await (supabase as any).rpc('network_find', { p_q: String(q).trim(), p_limit: limit })
  const ids = (data || []).map((r: { network_find: any; id: any }) => (typeof r === 'string' ? r : r.network_find || r.id)).filter(Boolean)
  await loadPeople(ids)
  return ids
}
export async function suggestions(limit = 5) {
  if (!ok() || !me()) return []
  const { data } = await (supabase as any).rpc('network_suggestions', { p_limit: limit })
  const ids = (data || []).map((r: { network_suggestions: any; id: any }) => (typeof r === 'string' ? r : r.network_suggestions || r.id)).filter(Boolean)
  await loadPeople(ids)
  return ids
}

/* somebody's own posts, newest first — what the reader may read of them */
export function authorFeed(userId: any) {
  const st = reactive<any>({ items: [], loading: false, done: false, error: '' })
  async function load(reset = false) {
    if (st.loading || !ok() || !userId) return
    st.loading = true; st.error = ''
    try {
      const before = reset || !st.items.length ? null : st.items[st.items.length - 1].created_at
      let q = (supabase as any).from('network_posts').select(POST_COLS).eq('author_id', userId).order('created_at', { ascending: false }).limit(PAGE)
      if (before) q = q.lt('created_at', before)
      const { data, error } = await q
      if (error) throw error
      const rows = data || []
      await loadPosts(rows.map((r: { id: any }) => r.id))
      st.items = (reset ? [] : st.items).concat(rows.map((r: { id: string|number }) => net.posts[r.id] || { ...r, kind: 'post' }))
      st.done = rows.length < PAGE
    } catch (e: any) { st.error = e.message || String(e) } finally { st.loading = false }
  }
  return { st, load, more: () => load(false), refresh: () => load(true) }
}

/* a thread: the post, its root when it answers something, and every answer the reader may read */
export async function loadThread(postId: string|number) {
  if (!ok() || !postId) return null
  await loadPosts([postId])
  const p = net.posts[postId]
  if (!p) return null
  const rootId = p.reply_root_id || p.id
  if (!net.posts[rootId]) await loadPosts([rootId])
  const { data } = await (supabase as any).from('network_posts').select('id').eq('reply_root_id', rootId).order('created_at').limit(500)
  await loadPosts((data || []).map((r: { id: any }) => r.id))
  return { root: net.posts[rootId] || p, focus: postId, replies: (data || []).map((r: { id: string|number }) => net.posts[r.id]).filter(Boolean) }
}

/* ---------------------------------------------------------------- what happened to me */

export async function notifications(before = null) {
  if (!ok() || !session.value) return []
  const { data, error } = await (supabase as any).rpc('network_notifications', { p_before: before, p_limit: 50 })
  if (error) throw error
  const rows = data || []
  await Promise.all([
    loadPosts(rows.flatMap((r: { post_id: any; subject_post_id: any }) => [r.post_id, r.subject_post_id]).filter(Boolean)),
    loadPeople(rows.map((r: { actor_id: any }) => r.actor_id)),
  ])
  return rows
}
/* THE COMMUNITY'S ONE LIST, where the spaces are on beside the network (98-community.sql): the
   network's notifications and the spaces' mentions, thread replies and events coming up, newest
   first, under the one "seen" marker. Each row says its source; a network row is shaped as
   notifications() shapes one, a space's carries its message or event as `item`. */
export async function communityNotes(before = null) {
  if (!ok() || !session.value) return []
  const { data, error } = await (supabase as any).rpc('community_notifications', { p_before: before, p_limit: 60 })
  if (error) throw error
  const rows = data || []
  await Promise.all([
    loadPosts(rows.flatMap((r: { post_id: any; subject_post_id: any }) => [r.post_id, r.subject_post_id]).filter(Boolean)),
    loadPeople(rows.map((r: { actor_id: any }) => r.actor_id).filter(Boolean)),
  ])
  return rows
}
/* when the reader last opened the list — read before markSeen moves it, so what is new can be marked */
export async function lastSeen() {
  if (!ok() || !me()) return null
  const { data } = await (supabase as any).from('network_seen').select('seen_at').eq('user_id', me()).maybeSingle()
  return data ? data.seen_at : null
}
export async function markSeen() {
  if (!ok() || !me()) return
  await (supabase as any).from('network_seen').upsert({ user_id: me(), seen_at: new Date().toISOString() })
}

/* ---------------------------------------------------------------- the spaces one may post to */

export async function loadSpaces() {
  if (!ok() || !session.value) { net.spaces = []; return [] }
  const { data } = await (supabase as any).rpc('network_spaces')
  net.spaces = (data || []).filter((s: { channel_id: any }) => s.channel_id)
  return net.spaces
}
export async function pin(spaceId: any, on: any) {
  if (on) await (supabase as any).from('network_pins').insert({ user_id: me(), space_id: spaceId })
  else await (supabase as any).from('network_pins').delete().eq('user_id', me()).eq('space_id', spaceId)
  await loadSpaces()
}

/* ---------------------------------------------------------------- writing */

const EXT: any = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }


/*
 * POST. `audience` is everyone | here | space:<id>; a space's members are reached through the
 * space's feed channel, so that post is the space's message and the space's guards hold it.
 */
export async function publish({ text, audience, files = [], alts = [], replyTo = null, quote = null }: any) {
  if (!ok() || !me()) throw new Error('signed out')
  const words = String(text || '').trim()
  if (String(audience).startsWith('space:')) {
    const sp = net.spaces.find((s: { space_id: any }) => s.space_id === audience.slice(6))
    if (!sp) throw new Error('space')
    let data
    if (files.length) {
      /* pictures and videos for a space go where the space keeps them, read by its members alone */
      const { sendMedia } = await import('../spaces/api.js')
      data = await sendMedia(sp.channel_id, files, { body: words })
      if (!data) throw new Error('media')
    } else {
      const res = await (supabase as any).from('space_messages').insert({ channel_id: sp.channel_id, author_id: me(), body: words }).select('id').single()
      if (res.error) throw res.error
      data = res.data
    }
    await loadMessages([data.id])
    return { kind: 'space', id: data.id }
  }
  /* the pictures and videos, each put under the author's own folder; a video's first frame beside it */
  const media = []
  for (const [i, f] of files.slice(0, MEDIA.max).entries()) {
    const ext = EXT[f.type]
    if (!ext) continue
    const id = crypto.randomUUID()
    const path = `${me()}/${id}.${ext}`
    const info = await probe(f)
    const up = await (supabase as any).storage.from('network').upload(path, f, { contentType: f.type, cacheControl: '31536000', upsert: false })
    if (up.error) throw up.error
    let poster
    if (info.poster) {
      poster = `${me()}/${id}.poster.jpg`
      const pu = await (supabase as any).storage.from('network').upload(poster, info.poster, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
      if (pu.error) poster = undefined
    }
    media.push({ kind: info.kind || 'image', path, alt: String(alts[i] || '').slice(0, 1000), mime: f.type, size: f.size,
      ...(info.width && info.height ? { width: info.width, height: info.height } : {}),
      ...(info.duration ? { duration: info.duration } : {}), ...(poster ? { poster } : {}) })
  }
  const row: any = { author_id: me(), text: words, audience, media }
  if (replyTo) row.reply_parent_id = replyTo
  if (quote) row.quote_id = quote
  const { data, error } = await (supabase as any).from('network_posts').insert(row).select(POST_COLS).single()
  if (error) throw error
  net.posts[data.id] = { ...data, kind: 'post' }
  if (replyTo && net.posts[replyTo]) net.posts[replyTo] = { ...net.posts[replyTo], reply_count: (net.posts[replyTo].reply_count || 0) + 1 }
  await Promise.all([loadPeople([me()]), signImages([data])])
  return { kind: 'post', id: data.id }
}

export async function remove(postId: string|number) {
  const p = net.posts[postId]
  const { error } = await (supabase as any).from('network_posts').delete().eq('id', postId).eq('author_id', me())
  if (error) throw error
  if (p && p.media && p.media.length) await (supabase as any).storage.from('network').remove(p.media.flatMap((im: { path: any; poster: any }) => [im.path, im.poster]).filter(Boolean)).catch(() => {})
  delete net.posts[postId]
}

/* a like or a repost: the card moves at once and moves back if the database says no */
async function mark(table: string, postId: string|number, on: boolean) {
  const which = table === 'network_likes' ? 'like' : 'repost'
  const before = net.posts[postId]
  if (before) net.posts[postId] = toggled(before, which, on)
  const q = on
    ? (supabase as any).from(table).insert({ author_id: me(), post_id: postId })
    : (supabase as any).from(table).delete().eq('author_id', me()).eq('post_id', postId)
  const { error } = await q
  if (error) { if (before) net.posts[postId] = before; throw error }
}
export const like = (postId: string|number, on: boolean) => mark('network_likes', postId, on)
export const repost = (postId: string|number, on: boolean) => mark('network_reposts', postId, on)

export async function follow(userId: any, on: any) {
  const q = on
    ? (supabase as any).from('network_follows').insert({ follower_id: me(), subject_id: userId })
    : (supabase as any).from('network_follows').delete().eq('follower_id', me()).eq('subject_id', userId)
  const { error } = await q
  if (error) throw error
}
export async function block(userId: any, on: any) {
  const q = on
    ? (supabase as any).from('network_blocks').insert({ blocker_id: me(), blocked_id: userId })
    : (supabase as any).from('network_blocks').delete().eq('blocker_id', me()).eq('blocked_id', userId)
  const { error } = await q
  if (error) throw error
}
export async function mute(userId: any, on: any) {
  const q = on
    ? (supabase as any).from('network_mutes').insert({ muter_id: me(), muted_id: userId })
    : (supabase as any).from('network_mutes').delete().eq('muter_id', me()).eq('muted_id', userId)
  const { error } = await q
  if (error) throw error
}
export async function report({ post = null, person = null, reason, note = '' }: any) {
  const { error } = await (supabase as any).rpc('network_report', { p_post: post, p_person: person, p_reason: reason, p_note: note || null })
  if (error) throw error
}
