/*
 * THE APP VIEW: rows made into what an atproto client draws — a person, a post, a thread, a feed, a
 * notification — in the shapes app.bsky's lexicons define. Every row is read through the PERSON'S
 * client (ctx.db), so what comes back is what the database's guards let them read (93-network.sql);
 * nothing here decides who may see what.
 *
 * A RECORD IS MADE, NOT STORED. A post's record is assembled from its row — its words and whatever
 * else its author wrote in `record`, what it answers, its pictures, what it quotes — and its CID is
 * the hash of that, so it is the same every time it is asked for and changes only when what it
 * names changes (an author joining the wider network changes their DID, and so every URI and CID
 * that names them, consistently). The one place the service role reads here is the CID of a post a
 * reply names, which goes into the reply's own hash and is never shown.
 */
import { admin } from '../lib.ts'
import { jsonToLex } from 'npm:@atproto/lex-json@0.1.7'
import { cidForLex } from 'npm:@atproto/lex-cbor@0.1.7'
import { cidForRawBytes } from 'npm:@atproto/lex-data@0.1.8'
import { POST, LIKE, REPOST, FOLLOW, BLOCK, GENERATOR, didOf, handleOf, nameOf, uriOf, spaceKey } from './ids.js'
import { planEmbed, kindOf } from './media.js'

/* the whole post on the site, for a record that cannot carry all its media */
const postLink = (_ctx: Ctx, row: any) => (Deno.env.get('APP_URL') || '').replace(/\/$/, '') + '/feed/post/' + row.id

export type Ctx = {
  db: any
  me: string | null
  domain: string
  serviceDid: string
  people: Map<string, any>
  rel: Map<string, any>
  cids: Map<string, string>
  posts: Map<string, any>
}
export const newCtx = (db: any, me: string | null, domain: string, serviceDid: string): Ctx =>
  ({ db, me, domain, serviceDid, people: new Map(), rel: new Map(), cids: new Map(), posts: new Map() })

const POST_COLS = 'id, author_id, rkey, text, audience, record, media, reply_root_id, reply_parent_id, quote_id, reply_root_uri, reply_parent_uri, quote_uri, like_count, repost_count, reply_count, quote_count, created_at, removed_at'

/* ---------------------------------------------------------------- people */

/* the people a set of rows names, with where the reader stands with each — one read each way */
export async function loadPeople(ctx: Ctx, ids: (string | null | undefined)[]) {
  /* the reader too, whenever anybody is loaded: what they did is said as URIs in THEIR name */
  const want = [...new Set([...(ids.filter(Boolean) as string[]), ...(ctx.me ? [ctx.me] : [])])].filter((id) => !ctx.people.has(id))
  if (!want.length) return
  const { data } = await ctx.db.rpc('network_people', { p_ids: want })
  for (const p of (data || []) as any[]) ctx.people.set(p.id, p)
  for (const id of want) if (!ctx.people.has(id)) ctx.people.set(id, null)
  if (!ctx.me) return
  const me = ctx.me
  const [follows, followers, mutes, blocks] = await Promise.all([
    ctx.db.from('network_follows').select('subject_id, rkey').eq('follower_id', me).in('subject_id', want),
    ctx.db.from('network_follows').select('follower_id, rkey').eq('subject_id', me).in('follower_id', want),
    ctx.db.from('network_mutes').select('muted_id').eq('muter_id', me).in('muted_id', want),
    ctx.db.from('network_blocks').select('blocked_id, rkey').eq('blocker_id', me).in('blocked_id', want),
  ])
  for (const id of want) ctx.rel.set(id, {})
  for (const r of follows.data || []) ctx.rel.get(r.subject_id).following = r.rkey
  for (const r of followers.data || []) ctx.rel.get(r.follower_id).followedBy = r.rkey
  for (const r of mutes.data || []) ctx.rel.get(r.muted_id).muted = true
  for (const r of blocks.data || []) ctx.rel.get(r.blocked_id).blocking = r.rkey
}

export const didFor = (ctx: Ctx, id: string) => didOf(ctx.people.get(id), ctx.domain)
const handleFor = (ctx: Ctx, id: string) => handleOf(nameOf(ctx.people.get(id)), ctx.domain) || 'handle.invalid'

/* the face somebody uploaded, where they did; a drawn face is the site's own and has no address */
const avatarOf = (p: any) => (p && p.avatar && /^https?:\/\//.test(p.avatar) ? p.avatar : undefined)

export function profileBasic(ctx: Ctx, id: string) {
  const p = ctx.people.get(id)
  if (!p) return null
  const me = ctx.me ? didFor(ctx, ctx.me) : null
  const r = ctx.rel.get(id) || {}
  const did = didFor(ctx, id)
  return {
    $type: 'app.bsky.actor.defs#profileViewBasic',
    did, handle: handleFor(ctx, id),
    ...(p.name ? { displayName: p.name } : {}),
    ...(avatarOf(p) ? { avatar: avatarOf(p) } : {}),
    viewer: {
      muted: !!r.muted, blockedBy: false,
      ...(r.blocking && me ? { blocking: uriOf(me, BLOCK, r.blocking) } : {}),
      ...(r.following && me ? { following: uriOf(me, FOLLOW, r.following) } : {}),
      ...(r.followedBy ? { followedBy: uriOf(did!, FOLLOW, r.followedBy) } : {}),
    },
    labels: [],
    createdAt: p.created_at,
  }
}

export async function profileDetailed(ctx: Ctx, id: string) {
  await loadPeople(ctx, [id])
  const base = profileBasic(ctx, id)
  if (!base) return null
  const p = ctx.people.get(id)
  const { data: n } = await ctx.db.rpc('network_person', { p_user: id })
  const { count } = await ctx.db.from('network_posts').select('id', { count: 'exact', head: true }).eq('author_id', id)
  return {
    ...base, $type: 'app.bsky.actor.defs#profileViewDetailed',
    ...(p.about ? { description: p.about } : {}),
    followersCount: (n && n.followers) || 0, followsCount: (n && n.following) || 0, postsCount: count || 0,
    indexedAt: p.created_at,
  }
}

/* ---------------------------------------------------------------- pictures */

/* a picture's blob, as the protocol names it: its CID is the hash of its bytes, worked out once and
   kept on the post (derived; the service role writes it), and the picture is served by an address
   the reader's own session signs */
async function blobOf(row: any, im: any) {
  if (!im.cid) {
    const dl = await admin.storage.from('network').download(im.path)
    if (dl.error || !dl.data) return null
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    im.cid = String(await cidForRawBytes(bytes))
    im.size = bytes.length
    const media = (row.media || []).map((x: any) => (x.path === im.path ? { ...x, cid: im.cid, size: im.size } : x))
    await admin.from('network_posts').update({ media }).eq('id', row.id)
  }
  return { $type: 'blob', ref: { $link: im.cid }, mimeType: im.mime || (kindOf(im) === 'video' ? 'video/mp4' : 'image/jpeg'), size: im.size || 0 }
}

/* ---------------------------------------------------------------- records */

/* rows by id, as the reader may read them — remembered for the request */
export async function loadPosts(ctx: Ctx, ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter(Boolean) as string[])].filter((id) => !ctx.posts.has(id))
  if (!want.length) return
  const { data } = await ctx.db.from('network_posts').select(POST_COLS).in('id', want)
  for (const r of (data || []) as any[]) ctx.posts.set(r.id, r)
  for (const id of want) if (!ctx.posts.has(id)) ctx.posts.set(id, null)
}

/* a post's uri and cid as a reply or a quote names it — the service role reads the row for its hash
   alone, since a reader may answer a post whose parent they cannot see */
async function strongRef(ctx: Ctx, id: string): Promise<{ uri: string; cid: string } | null> {
  let row = ctx.posts.get(id)
  if (!row) {
    const { data } = await admin.from('network_posts').select(POST_COLS).eq('id', id).maybeSingle()
    if (!data) return null
    row = data
  }
  await loadAuthorIds(ctx, [row.author_id])
  const rec = await recordOf(ctx, row)
  return { uri: uriOf(didFor(ctx, row.author_id), POST, row.rkey), cid: await cidOf(ctx, row.id, rec) }
}

/* the authors behind DIDs, whether or not the reader may see them — a DID in a hash is not a view */
async function loadAuthorIds(ctx: Ctx, ids: string[]) {
  const want = ids.filter((id) => !ctx.people.get(id))
  if (!want.length) return
  await loadPeople(ctx, want)
  const still = want.filter((id) => !ctx.people.get(id))
  if (!still.length) return
  const { data } = await admin.from('profiles').select('id, username').in('id', still)
  const { data: ids_ } = await admin.from('network_identities').select('user_id, did').in('user_id', still).not('joined_at', 'is', null).is('left_at', null)
  const plc = new Map(((ids_ || []) as any[]).map((r) => [r.user_id, r.did]))
  for (const p of (data || []) as any[]) ctx.people.set(p.id, { id: p.id, handle_name: p.username || 'm' + p.id.replace(/-/g, '').slice(-12), plc_did: plc.get(p.id) || null, hidden: true })
}

export async function recordOf(ctx: Ctx, row: any) {
  const extra = { ...(row.record || {}) }
  delete extra.$type; delete extra.text; delete extra.createdAt; delete extra.reply
  const embedExtra = extra.embed && extra.embed.$type === 'app.bsky.embed.external' ? extra.embed : null
  delete extra.embed
  const rec: any = { $type: POST, text: row.text || '', createdAt: new Date(row.created_at).toISOString(), ...extra }
  if (row.reply_parent_id) {
    const parent = await strongRef(ctx, row.reply_parent_id)
    const root = row.reply_root_id && row.reply_root_id !== row.reply_parent_id ? await strongRef(ctx, row.reply_root_id) : parent
    if (parent && root) rec.reply = { root, parent }
  } else if (row.reply_parent_uri && row.record && row.record.reply) {
    rec.reply = row.record.reply
  }
  /* what the protocol's records carry (_shared/atproto/media.js): four pictures, or one video; more,
     or a mix, goes as the first four pictures with a link to the whole post on the site */
  const plan = planEmbed(row.media)
  const ratio = (m: any) => (m.width && m.height ? { aspectRatio: { width: m.width, height: m.height } } : {})
  let media: any = embedExtra
  if (plan && plan.video) {
    const blob = await blobOf(row, plan.video)
    if (blob) media = { $type: 'app.bsky.embed.video', video: blob, ...(plan.video.alt ? { alt: plan.video.alt } : {}), ...ratio(plan.video) }
  } else if (plan) {
    const images = []
    for (const im of plan.images) {
      const blob = await blobOf(row, im)
      if (blob) images.push({ image: blob, alt: im.alt || '', ...ratio(im) })
    }
    if (images.length) media = { $type: 'app.bsky.embed.images', images }
    /* the rest of the post is on the site: said in its text, which every client shows */
    if (plan.link) {
      const url = postLink(ctx, row)
      const before = rec.text ? rec.text + '\n\n' : ''
      rec.text = before + url
      /* a link in a record is a facet over its bytes, or no app makes it one */
      const enc = new TextEncoder()
      const start = enc.encode(before).length
      rec.facets = [...(rec.facets || []), { index: { byteStart: start, byteEnd: start + enc.encode(url).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] }]
    }
  }
  const quote = row.quote_id ? await strongRef(ctx, row.quote_id) : (row.quote_uri && row.record && row.record.embed && row.record.embed.record) || null
  if (quote && media) rec.embed = { $type: 'app.bsky.embed.recordWithMedia', record: { $type: 'app.bsky.embed.record', record: quote }, media }
  else if (quote) rec.embed = { $type: 'app.bsky.embed.record', record: quote }
  else if (media) rec.embed = media
  return rec
}

export async function cidOf(ctx: Ctx, key: string, rec: unknown) {
  const have = ctx.cids.get(key)
  if (have) return have
  const cid = String(await cidForLex(jsonToLex(rec as any)))
  ctx.cids.set(key, cid)
  return cid
}

/* ---------------------------------------------------------------- posts */

async function signImages(ctx: Ctx, rows: any[]) {
  const paths = rows.flatMap((r) => (r.media || []).flatMap((im: any) => [im.path, im.poster])).filter(Boolean)
  const out = new Map<string, string>()
  if (!paths.length) return out
  const { data } = await ctx.db.storage.from('network').createSignedUrls(paths, 3600)
  for (const s of (data || []) as any[]) if (s.signedUrl && s.path) out.set(s.path, s.signedUrl)
  return out
}

/* the reader's own likes and reposts among these posts, so each view knows what is pressed */
async function myMarks(ctx: Ctx, ids: string[]) {
  const likes = new Map<string, string>(), reposts = new Map<string, string>()
  if (!ctx.me || !ids.length) return { likes, reposts }
  const [l, r] = await Promise.all([
    ctx.db.from('network_likes').select('post_id, rkey').eq('author_id', ctx.me).in('post_id', ids),
    ctx.db.from('network_reposts').select('post_id, rkey').eq('author_id', ctx.me).in('post_id', ids),
  ])
  for (const x of (l.data || []) as any[]) likes.set(x.post_id, x.rkey)
  for (const x of (r.data || []) as any[]) reposts.set(x.post_id, x.rkey)
  return { likes, reposts }
}

/* posts as the protocol shows them, in the order asked for; one the reader may not read is absent */
export async function postViews(ctx: Ctx, ids: string[]) {
  await loadPosts(ctx, ids)
  const rows = ids.map((id) => ctx.posts.get(id)).filter(Boolean)
  const quoted = rows.map((r: any) => r.quote_id).filter(Boolean)
  await loadPosts(ctx, quoted)
  const all = [...rows, ...quoted.map((id: string) => ctx.posts.get(id)).filter(Boolean)]
  await loadPeople(ctx, all.map((r: any) => r.author_id))
  const [urls, marks] = await Promise.all([signImages(ctx, all), myMarks(ctx, rows.map((r: any) => r.id))])
  const out = new Map<string, any>()
  for (const row of rows as any[]) {
    const author = profileBasic(ctx, row.author_id)
    if (!author) continue
    const record = await recordOf(ctx, row)
    const cid = await cidOf(ctx, row.id, record)
    const me = ctx.me ? didFor(ctx, ctx.me) : null
    out.set(row.id, {
      $type: 'app.bsky.feed.defs#postView',
      uri: uriOf(author.did, POST, row.rkey), cid, author, record,
      ...(await embedView(ctx, row, record, urls)),
      replyCount: row.reply_count || 0, repostCount: row.repost_count || 0, likeCount: row.like_count || 0, quoteCount: row.quote_count || 0,
      indexedAt: new Date(row.created_at).toISOString(),
      viewer: {
        ...(marks.likes.get(row.id) && me ? { like: uriOf(me, LIKE, marks.likes.get(row.id)!) } : {}),
        ...(marks.reposts.get(row.id) && me ? { repost: uriOf(me, REPOST, marks.reposts.get(row.id)!) } : {}),
        threadMuted: false, replyDisabled: false, embeddingDisabled: false,
      },
      labels: [],
    })
  }
  return out
}

/* what is embedded in a post, as a client draws it: the pictures by an address the reader may open,
   and a quoted post as its own view, or as missing where the reader cannot read it */
async function embedView(ctx: Ctx, row: any, record: any, urls: Map<string, string>) {
  const vid = (row.media || []).find((m: any) => kindOf(m) === 'video')
  if (vid && (row.media || []).length === 1 && urls.get(vid.path)) {
    return { embed: { $type: 'app.bsky.embed.video#view', cid: vid.cid || '', playlist: urls.get(vid.path), ...(vid.poster && urls.get(vid.poster) ? { thumbnail: urls.get(vid.poster) } : {}), ...(vid.alt ? { alt: vid.alt } : {}), ...(vid.width && vid.height ? { aspectRatio: { width: vid.width, height: vid.height } } : {}) } }
  }
  const imgs = (row.media || []).filter((im: any) => kindOf(im) === 'image').slice(0, 4).map((im: any) => ({
    thumb: urls.get(im.path) || '', fullsize: urls.get(im.path) || '', alt: im.alt || '',
    ...(im.width && im.height ? { aspectRatio: { width: im.width, height: im.height } } : {}),
  })).filter((x: any) => x.thumb)
  const media = imgs.length ? { $type: 'app.bsky.embed.images#view', images: imgs }
    : record.embed && record.embed.$type === 'app.bsky.embed.external' ? { $type: 'app.bsky.embed.external#view', external: record.embed.external } : null
  let quoted: any = null
  if (row.quote_id) {
    const q = ctx.posts.get(row.quote_id)
    const qa = q ? profileBasic(ctx, q.author_id) : null
    if (q && qa) {
      const qr = await recordOf(ctx, q)
      quoted = { $type: 'app.bsky.embed.record#viewRecord', uri: uriOf(qa.did, POST, q.rkey), cid: await cidOf(ctx, q.id, qr), author: qa, value: qr,
        likeCount: q.like_count || 0, repostCount: q.repost_count || 0, replyCount: q.reply_count || 0, quoteCount: q.quote_count || 0, indexedAt: new Date(q.created_at).toISOString(), labels: [] }
    } else {
      quoted = { $type: 'app.bsky.embed.record#viewNotFound', uri: record.embed && (record.embed.record?.uri || record.embed.record?.record?.uri), notFound: true }
    }
  }
  if (quoted && media) return { embed: { $type: 'app.bsky.embed.recordWithMedia#view', record: { record: quoted }, media } }
  if (quoted) return { embed: { $type: 'app.bsky.embed.record#view', record: quoted } }
  if (media) return { embed: media }
  return {}
}

/* a space's message, shown as a post of the space's feed: never a record in anybody's repository,
   its key saying so (ids.js SPACE_KEY) */
export async function messageViews(ctx: Ctx, ids: string[]) {
  const out = new Map<string, any>()
  if (!ids.length) return out
  const { data } = await ctx.db.from('space_messages').select('id, channel_id, author_id, title, body, reply_count, created_at, deleted_at, kind').in('id', ids)
  const rows = ((data || []) as any[]).filter((m) => !m.deleted_at && m.author_id)
  await loadPeople(ctx, rows.map((m) => m.author_id))
  for (const m of rows) {
    const author = profileBasic(ctx, m.author_id)
    if (!author) continue
    const text = [m.title, m.body].filter(Boolean).join('\n\n').slice(0, 3000)
    const record = { $type: POST, text, createdAt: new Date(m.created_at).toISOString() }
    out.set(m.id, {
      $type: 'app.bsky.feed.defs#postView', uri: uriOf(author.did, POST, spaceKey(m.id)), cid: await cidOf(ctx, 's' + m.id, record),
      author, record, replyCount: m.reply_count || 0, repostCount: 0, likeCount: 0, quoteCount: 0,
      indexedAt: new Date(m.created_at).toISOString(),
      viewer: { replyDisabled: false, embeddingDisabled: true },
      labels: [],
    })
  }
  return out
}

/* a feed item: the post, what it answers where it answers something, and who reposted it */
export async function feedItems(ctx: Ctx, items: { post_id?: string | null; message_id?: string | null; reposted_by?: string | null; at?: string }[]) {
  const postIds = items.map((i) => i.post_id).filter(Boolean) as string[]
  await loadPosts(ctx, postIds)
  const parentIds = postIds.map((id) => ctx.posts.get(id)).filter(Boolean).flatMap((r: any) => [r.reply_parent_id, r.reply_root_id]).filter(Boolean)
  await loadPeople(ctx, items.map((i) => i.reposted_by))
  const [views, parents, msgs] = await Promise.all([
    postViews(ctx, postIds), postViews(ctx, parentIds), messageViews(ctx, items.map((i) => i.message_id).filter(Boolean) as string[]),
  ])
  const out: any[] = []
  for (const it of items) {
    if (it.message_id) { const v = msgs.get(it.message_id); if (v) out.push({ post: v }); continue }
    const v = views.get(it.post_id!)
    if (!v) continue
    const row = ctx.posts.get(it.post_id!)
    const item: any = { post: v }
    if (row && row.reply_parent_id) {
      const parent = parents.get(row.reply_parent_id) || notFound(v.record.reply?.parent?.uri)
      const root = parents.get(row.reply_root_id || row.reply_parent_id) || notFound(v.record.reply?.root?.uri)
      item.reply = { root, parent }
    }
    if (it.reposted_by) {
      const by = profileBasic(ctx, it.reposted_by)
      if (by) item.reason = { $type: 'app.bsky.feed.defs#reasonRepost', by, indexedAt: new Date(it.at || row.created_at).toISOString() }
    }
    out.push(item)
  }
  return out
}
const notFound = (uri: string) => ({ $type: 'app.bsky.feed.defs#notFoundPost', uri: uri || '', notFound: true })

/* ---------------------------------------------------------------- a space's feed, as a feed generator */

export const generatorUri = (ctx: Ctx, slug: string) => uriOf(ctx.serviceDid, GENERATOR, slug)
/* the generator's record, as a client would read it from the site's own repository: the space's name,
   the service that answers it — and the CID its hash, like every record here */
export const generatorRecord = (ctx: Ctx, s: any) => ({ $type: GENERATOR, did: ctx.serviceDid, displayName: String(s.name || s.slug).slice(0, 24), createdAt: '2026-01-01T00:00:00.000Z' })
export async function generatorView(ctx: Ctx, s: any) {
  return {
    $type: 'app.bsky.feed.defs#generatorView',
    uri: generatorUri(ctx, s.slug), cid: await cidOf(ctx, 'g' + s.space_id, generatorRecord(ctx, s)),
    did: ctx.serviceDid,
    /* the site's own handle is its domain — where that is a handle at all: a bare `localhost` is one label, and a client
       that validates against the lexicon refuses the whole answer for it (handle.invalid is the lexicon's own stand-in) */
    creator: { $type: 'app.bsky.actor.defs#profileView', did: ctx.serviceDid, handle: /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(ctx.domain || '') ? ctx.domain : 'handle.invalid', labels: [] },
    displayName: s.name, description: '', likeCount: 0, acceptsInteractions: false, labels: [],
    viewer: {}, indexedAt: new Date().toISOString(),
  }
}
