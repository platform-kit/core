/*
 * WRITING THROUGH THE PROTOCOL: a record from another app becomes a row, through the PERSON'S client,
 * so the same policies and triggers that guard the site's own pages guard it — the audience never
 * widening down a thread, a block standing between two people, a suspension (93-network.sql). This
 * module adds no rule of its own beyond the record's lexicon; what it does is translate.
 *
 *   app.bsky.feed.post      a network post — or, answering a space's post, a reply in that room
 *   app.bsky.feed.like      a like — or, on a space's post, the room's own ❤️ reaction
 *   app.bsky.feed.repost    a repost
 *   app.bsky.graph.follow   a follow of a member, or (joined) of somebody elsewhere
 *   app.bsky.graph.block    a block of a member
 *   app.bsky.actor.profile  the name and the line on the site's own profile
 *
 * WHO A CLIENT'S POST REACHES is decided here because a client cannot ask: everyone for a member who
 * has joined the wider network, the people here for everybody else (the atproto-api spec).
 */
import { admin } from '../lib.ts'
import { schemas } from 'npm:@atproto/api@0.24.0'
import { Lexicons, jsonToLex } from 'npm:@atproto/lexicon@0.7.16'

/* the records' lexicons, from Bluesky's own schemas, checked by the same package that turns a JSON
   record into what it is — so a blob is recognised as a blob */
const lexicons = new Lexicons(schemas as any)
import { cidForRawBytes } from 'npm:@atproto/lex-data@0.1.8'
import { POST, LIKE, REPOST, FOLLOW, BLOCK, PROFILE, WRITABLE, parseUri, uriOf, isTid, messageOfKey, spaceKey, handleOfDidWeb, usernameOfHandle, cleanDomain } from './ids.js'
import { MEDIA, kindOfType } from './media.js'
import { REFUSALS } from './errors.js'
import { type Ctx, loadPosts, recordOf, cidOf, didFor, loadPeople } from './views.ts'

type Fail = { status: number; body: unknown }
const fail = (f: Fail) => { throw f }

/* ---------------------------------------------------------------- who a DID is */

/* the member a DID names, or null for somebody elsewhere — a did:web on our handle domain, or a
   did:plc one of ours joined with. Read as the service role: it answers whose handle is whose. */
export async function userOfDid(did: string, domain: string): Promise<string | null> {
  if (String(did).startsWith('did:web:')) {
    const name = usernameOfHandle(handleOfDidWeb(did), domain)
    if (!name) return null
    const { data } = await admin.rpc('network_user_of_name', { p_name: name })
    return (data as string) || null
  }
  if (String(did).startsWith('did:plc:')) {
    const { data } = await admin.from('network_identities').select('user_id').eq('did', did).maybeSingle()
    return data ? data.user_id : null
  }
  return null
}
export async function userOfActor(actor: string, domain: string) {
  if (String(actor).startsWith('did:')) return userOfDid(actor, domain)
  const name = usernameOfHandle(actor, domain)
  if (!name) return null
  const { data } = await admin.rpc('network_user_of_name', { p_name: name })
  return (data as string) || null
}

/* what an at:// URI names on this site: a post (by its author and key), a space's message, or
   nothing of ours */
export async function resolvePost(ctx: Ctx, uri: string) {
  const u = parseUri(uri)
  if (!u || u.collection !== POST) return null
  const author = await userOfDid(u.did, ctx.domain)
  if (!author) return { external: true, uri }
  const msg = messageOfKey(u.rkey)
  if (msg) return { message: msg, author }
  const { data } = await ctx.db.from('network_posts').select('id').eq('author_id', author).eq('rkey', u.rkey).maybeSingle()
  return data ? { post: data.id, author } : { missing: true, author }
}

/* ---------------------------------------------------------------- validating */

function valid(collection: string, record: any) {
  if (!WRITABLE.includes(collection)) fail(REFUSALS.invalid(`${collection} is not something this site keeps`))
  if (!record || record.$type !== collection) fail(REFUSALS.invalid(`the record's $type must be ${collection}`))
  /* a record arrives as JSON; its lexicon is checked against what it IS — a blob a blob, a CID a CID */
  try { lexicons.assertValidRecord(collection, jsonToLex(record)) } catch (e) { fail(REFUSALS.invalid((e as Error).message)) }
}
const dbFail = (error: any) => {
  const m = String((error && error.message) || error || '')
  if (/more people/.test(m)) return REFUSALS.invalid(m.replace(/^network:\s*/, ''))
  if (/block|cannot be read|does not exist/.test(m)) return REFUSALS.forbidden(m.replace(/^network:\s*/, ''))
  if (/duplicate|unique/i.test(m)) return REFUSALS.badRequest('That record already exists')
  if (/row-level security|permission|policy/i.test(m)) return REFUSALS.forbidden('Not allowed')
  return REFUSALS.badRequest(m || 'The write was refused')
}

/* ---------------------------------------------------------------- the writes */

export type Written = { uri: string; cid: string }

export async function createRecord(ctx: Ctx, collection: string, record: any, rkey?: string): Promise<Written> {
  valid(collection, record)
  if (rkey && collection !== PROFILE && !isTid(rkey)) fail(REFUSALS.invalid('a record key here is a TID'))
  const me = ctx.me!
  await loadPeople(ctx, [me])
  const myDid = didFor(ctx, me)
  const joined = !!(ctx.people.get(me) && ctx.people.get(me).joined)

  if (collection === POST) {
    const row: any = { author_id: me, text: record.text || '', audience: joined ? 'everyone' : 'here', ...(rkey ? { rkey } : {}) }
    const extra = { ...record }
    delete extra.$type; delete extra.text; delete extra.createdAt
    if (record.reply) {
      const parent = await resolvePost(ctx, record.reply.parent && record.reply.parent.uri)
      if (!parent || (parent as any).missing) fail(REFUSALS.notFound('The post being answered'))
      if ((parent as any).message) {
        /* AN ANSWER TO A SPACE'S POST is said in the space, as a reply in its thread, under the room's
           own guards — it never becomes a network post anybody outside the room could read */
        const { data: m } = await ctx.db.from('space_messages').select('id, channel_id').eq('id', (parent as any).message).maybeSingle()
        if (!m) fail(REFUSALS.notFound('The post being answered'))
        const { data, error } = await ctx.db.from('space_messages').insert({ channel_id: m.channel_id, author_id: me, thread_root_id: m.id, body: record.text || '' }).select('id').single()
        if (error) fail(dbFail(error))
        return { uri: uriOf(myDid, POST, spaceKey(data.id)), cid: await cidOf(ctx, 's' + data.id, { $type: POST, text: record.text || '', createdAt: new Date().toISOString() }) }
      }
      if ((parent as any).external) {
        if (!joined) fail(REFUSALS.notJoined())
        row.reply_parent_uri = record.reply.parent.uri; row.reply_root_uri = record.reply.root.uri
      } else row.reply_parent_id = (parent as any).post
      if ((parent as any).external) extra.reply = record.reply; else delete extra.reply
    }
    const embed = record.embed || null
    const media = embed && (embed.$type === 'app.bsky.embed.recordWithMedia' ? embed.media : embed)
    const quoteRef = embed && (embed.$type === 'app.bsky.embed.record' ? embed.record : embed.$type === 'app.bsky.embed.recordWithMedia' ? embed.record && embed.record.record : null)
    if (media && media.$type === 'app.bsky.embed.images') {
      row.media = []
      for (const im of (media.images || []).slice(0, 4)) {
        const cid = im.image && im.image.ref && (im.image.ref.$link || String(im.image.ref))
        if (!cid) fail(REFUSALS.invalid('an image names no blob'))
        row.media.push({ kind: 'image', path: `${me}/${cid}`, cid, alt: im.alt || '', mime: im.image.mimeType, size: im.image.size,
          ...(im.aspectRatio ? { width: im.aspectRatio.width, height: im.aspectRatio.height } : {}) })
      }
      delete extra.embed
    } else if (media && media.$type === 'app.bsky.embed.video') {
      /* one video, from an app that uploaded it to this server as a blob */
      const v = media.video
      const cid = v && v.ref && (v.ref.$link || String(v.ref))
      if (!cid) fail(REFUSALS.invalid('a video names no blob'))
      row.media = [{ kind: 'video', path: `${me}/${cid}`, cid, alt: media.alt || '', mime: v.mimeType, size: v.size,
        ...(media.aspectRatio ? { width: media.aspectRatio.width, height: media.aspectRatio.height } : {}) }]
      delete extra.embed
    } else if (media && media.$type === 'app.bsky.embed.external') {
      extra.embed = media
    } else delete extra.embed
    if (quoteRef) {
      const q = await resolvePost(ctx, quoteRef.uri)
      if (!q || (q as any).missing || (q as any).message) fail(REFUSALS.notFound('The post being quoted'))
      if ((q as any).external) { if (!joined) fail(REFUSALS.notJoined()); row.quote_uri = quoteRef.uri; extra.embed = embed }
      else row.quote_id = (q as any).post
    }
    row.record = extra
    const { data, error } = await ctx.db.from('network_posts').insert(row).select('id, rkey').single()
    if (error) fail(dbFail(error))
    await loadPosts(ctx, [data.id])
    const rec = await recordOf(ctx, ctx.posts.get(data.id))
    return { uri: uriOf(myDid, POST, data.rkey), cid: await cidOf(ctx, data.id, rec) }
  }

  if (collection === LIKE || collection === REPOST) {
    const target = await resolvePost(ctx, record.subject && record.subject.uri)
    if (!target || (target as any).missing) fail(REFUSALS.notFound('The post'))
    if ((target as any).message) {
      if (collection === REPOST) fail(REFUSALS.invalid('A space’s post stays in the space; it cannot be reposted'))
      /* a like on a space's post is the room's own ❤️ — the same act the room's members make */
      const { data: m } = await ctx.db.from('space_messages').select('id, channel_id').eq('id', (target as any).message).maybeSingle()
      if (!m) fail(REFUSALS.notFound('The post'))
      const { error } = await ctx.db.from('reactions').insert({ surface: 'message', target_id: m.id, user_id: me, emoji: '❤️', channel_id: m.channel_id })
      if (error && !/duplicate/i.test(error.message)) fail(dbFail(error))
      const rec = { $type: LIKE, subject: record.subject, createdAt: record.createdAt }
      return { uri: uriOf(myDid, LIKE, spaceKey(m.id)), cid: await cidOf(ctx, 'l' + m.id, rec) }
    }
    const table = collection === LIKE ? 'network_likes' : 'network_reposts'
    const row: any = { author_id: me, ...(rkey ? { rkey } : {}) }
    if ((target as any).external) { if (!joined) fail(REFUSALS.notJoined()); row.subject_uri = record.subject.uri; row.subject_cid = record.subject.cid }
    else row.post_id = (target as any).post
    const { data, error } = await ctx.db.from(table).insert(row).select('rkey').single()
    if (error) fail(dbFail(error))
    return { uri: uriOf(myDid, collection, data.rkey), cid: await cidOf(ctx, collection + data.rkey, record) }
  }

  if (collection === FOLLOW || collection === BLOCK) {
    const subject = await userOfDid(record.subject, ctx.domain)
    if (collection === BLOCK && !subject) fail(REFUSALS.invalid('Only somebody on this site can be blocked here'))
    if (collection === FOLLOW && !subject && !joined) fail(REFUSALS.notJoined())
    const table = collection === FOLLOW ? 'network_follows' : 'network_blocks'
    const row: any = collection === FOLLOW
      ? { follower_id: me, ...(subject ? { subject_id: subject } : { subject_did: record.subject }) }
      : { blocker_id: me, blocked_id: subject }
    if (rkey) row.rkey = rkey
    const { data, error } = await ctx.db.from(table).insert(row).select('rkey').single()
    if (error) fail(dbFail(error))
    return { uri: uriOf(myDid, collection, data.rkey), cid: await cidOf(ctx, collection + data.rkey, record) }
  }

  if (collection === PROFILE) return putProfile(ctx, record)
  return fail(REFUSALS.invalid('unknown collection'))
}

/* the profile record is the site's own profile: its name and its line, nothing more */
export async function putProfile(ctx: Ctx, record: any): Promise<Written> {
  valid(PROFILE, record)
  const patch: any = {}
  if ('displayName' in record) patch.display_name = String(record.displayName || '').trim().slice(0, 60) || null
  if ('description' in record) patch.about = String(record.description || '').trim().slice(0, 280) || null
  const { error } = await ctx.db.from('profiles').update(patch).eq('id', ctx.me)
  if (error) fail(dbFail(error))
  await loadPeople(ctx, [ctx.me])
  return { uri: uriOf(didFor(ctx, ctx.me!), PROFILE, 'self'), cid: await cidOf(ctx, 'profile', record) }
}

export async function deleteRecord(ctx: Ctx, collection: string, rkey: string) {
  const me = ctx.me!
  const msg = messageOfKey(rkey)
  if (msg && collection === LIKE) {
    await ctx.db.from('reactions').delete().eq('surface', 'message').eq('target_id', msg).eq('user_id', me).eq('emoji', '❤️')
    return
  }
  const table = { [POST]: 'network_posts', [LIKE]: 'network_likes', [REPOST]: 'network_reposts', [FOLLOW]: 'network_follows', [BLOCK]: 'network_blocks' }[collection]
  if (!table) fail(REFUSALS.invalid(`${collection} cannot be deleted here`))
  const who = table === 'network_follows' ? 'follower_id' : table === 'network_blocks' ? 'blocker_id' : 'author_id'
  const { error } = await ctx.db.from(table).delete().eq(who, me).eq('rkey', rkey)
  if (error) fail(dbFail(error))
}

/* ---------------------------------------------------------------- reading a record back */

export async function getRecord(ctx: Ctx, author: string, collection: string, rkey: string) {
  await loadPeople(ctx, [author])
  const did = didFor(ctx, author)
  if (!did) return null
  if (collection === POST) {
    const { data } = await ctx.db.from('network_posts').select('id').eq('author_id', author).eq('rkey', rkey).maybeSingle()
    if (!data) return null
    await loadPosts(ctx, [data.id])
    const value = await recordOf(ctx, ctx.posts.get(data.id))
    return { uri: uriOf(did, POST, rkey), cid: await cidOf(ctx, data.id, value), value }
  }
  if (collection === PROFILE && rkey === 'self') {
    const p = ctx.people.get(author)
    if (!p) return null
    const value: any = { $type: PROFILE, ...(p.name ? { displayName: p.name } : {}), ...(p.about ? { description: p.about } : {}) }
    return { uri: uriOf(did, PROFILE, 'self'), cid: await cidOf(ctx, 'profile' + author, value), value }
  }
  const rows = await listRecords(ctx, author, collection, 1, undefined, rkey)
  return rows.records[0] || null
}

export async function listRecords(ctx: Ctx, author: string, collection: string, limit = 50, cursor?: string, only?: string) {
  await loadPeople(ctx, [author])
  const did = didFor(ctx, author)
  const n = Math.min(Math.max(Number(limit) || 50, 1), 100)
  const out: any[] = []
  if (!did) return { records: out }
  if (collection === POST) {
    let q = ctx.db.from('network_posts').select('id, rkey').eq('author_id', author).order('rkey', { ascending: false }).limit(n)
    if (cursor) q = q.lt('rkey', cursor)
    if (only) q = q.eq('rkey', only)
    const { data } = await q
    await loadPosts(ctx, (data || []).map((r: any) => r.id))
    for (const r of (data || []) as any[]) {
      const value = await recordOf(ctx, ctx.posts.get(r.id))
      out.push({ uri: uriOf(did, POST, r.rkey), cid: await cidOf(ctx, r.id, value), value })
    }
  } else if (collection === LIKE || collection === REPOST) {
    let q = ctx.db.from(collection === LIKE ? 'network_likes' : 'network_reposts').select('rkey, post_id, subject_uri, subject_cid, created_at').eq('author_id', author).order('rkey', { ascending: false }).limit(n)
    if (cursor) q = q.lt('rkey', cursor)
    if (only) q = q.eq('rkey', only)
    const { data } = await q
    for (const r of (data || []) as any[]) {
      let subject = r.subject_uri ? { uri: r.subject_uri, cid: r.subject_cid } : null
      if (!subject && r.post_id) {
        await loadPosts(ctx, [r.post_id])
        const p = ctx.posts.get(r.post_id)
        if (p) { await loadPeople(ctx, [p.author_id]); subject = { uri: uriOf(didFor(ctx, p.author_id), POST, p.rkey), cid: await cidOf(ctx, p.id, await recordOf(ctx, p)) } }
      }
      if (!subject) continue
      const value = { $type: collection, subject, createdAt: new Date(r.created_at).toISOString() }
      out.push({ uri: uriOf(did, collection, r.rkey), cid: await cidOf(ctx, collection + r.rkey, value), value })
    }
  } else if (collection === FOLLOW || collection === BLOCK) {
    const follow = collection === FOLLOW
    let q = ctx.db.from(follow ? 'network_follows' : 'network_blocks').select(follow ? 'rkey, subject_id, subject_did, created_at' : 'rkey, blocked_id, created_at')
      .eq(follow ? 'follower_id' : 'blocker_id', author).order('rkey', { ascending: false }).limit(n)
    if (cursor) q = q.lt('rkey', cursor)
    if (only) q = q.eq('rkey', only)
    const { data } = await q
    await loadPeople(ctx, (data || []).map((r: any) => r.subject_id || r.blocked_id))
    for (const r of (data || []) as any[]) {
      const subject = r.subject_did || didFor(ctx, r.subject_id || r.blocked_id)
      if (!subject) continue
      const value = { $type: collection, subject, createdAt: new Date(r.created_at).toISOString() }
      out.push({ uri: uriOf(did, collection, r.rkey), cid: await cidOf(ctx, collection + r.rkey, value), value })
    }
  } else if (collection === PROFILE) {
    const one = await getRecord(ctx, author, PROFILE, 'self')
    if (one) out.push(one)
  }
  return { records: out, ...(out.length === n ? { cursor: String(parseUri(out[out.length - 1].uri)!.rkey) } : {}) }
}

/* ---------------------------------------------------------------- a picture or a video */

export async function uploadBlob(ctx: Ctx, bytes: Uint8Array, mime: string) {
  const type = String(mime || '').split(';')[0].trim().toLowerCase()
  const kind = kindOfType(type)
  if (!kind) fail(REFUSALS.invalid('Only pictures (png, jpeg, gif, webp) and videos (mp4, webm, mov) are carried here'))
  if (kind === 'image' && bytes.length > MEDIA.maxImageBytes) fail(REFUSALS.invalid('A picture may be at most 10 MB'))
  if (kind === 'video' && bytes.length > MEDIA.maxVideoBytes) fail(REFUSALS.invalid('A video may be at most 100 MB'))
  const cid = String(await cidForRawBytes(bytes))
  const path = `${ctx.me}/${cid}`
  const up = await ctx.db.storage.from('network').upload(path, bytes, { contentType: type, upsert: false, cacheControl: '31536000' })
  if (up.error && !/exists|duplicate/i.test(up.error.message)) fail(REFUSALS.forbidden(up.error.message))
  return { blob: { $type: 'blob', ref: { $link: cid }, mimeType: type, size: bytes.length } }
}

export { cleanDomain }
