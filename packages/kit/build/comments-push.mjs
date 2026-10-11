/*
 * WHAT MAY BE COMMENTED ON, projected.
 *
 * One row of `comment_subjects` per thing whose file says it takes comments — an article, a wiki
 * page, a doc, a book, a product — beside the events' own rows, which events-push writes. The
 * table is the ONE place every comment policy reads, whatever the kind, which is how a policy can
 * answer for a book and an event without knowing what either is.
 *
 * It is a projection and the files own it: a subject no file declares any more is removed, and the
 * comments under it go with the cascade. Three things it never touches: `post_id`, which is written
 * the first time somebody says something and is the thread's identity; the comments themselves; and
 * the concrete subjects of an OPEN KIND, which no file declares because the whole point of an open
 * kind is that an embed makes them — owning those meant deleting every embedded conversation on
 * every run, which a deploy would have done silently.
 *
 * Run by the deploy after the spaces are pushed (a subject may name a channel), by `npm run
 * db:reset`, and by hand while writing one.
 */
import { createClient } from '@supabase/supabase-js'
import { asStore } from './store/index.mjs'
import { supabaseUrl, serviceKey } from './tts/storage.mjs'
import matter from 'gray-matter'
import { bookChapters } from '../src/lib/speech.js'

/* the kinds a site may put comments on, and where their files live. An event is not here: its
   subjects are written by events-push, from the record the calendar is projected from. */
export const KINDS = {
  article: 'content/articles',
  wiki: 'content/wiki',
  doc: 'content/docs',
  product: 'content/store/products',
}

/* A BOOK IS COMMENTED ON A CHAPTER AT A TIME, never as a whole.
   "What did you think of The Kybalion" is not a conversation anybody has; "chapter four lost me" is.
   So a book that takes comments gets one subject PER CHAPTER — 'the-kybalion/chapters/4' — and the
   reader opens that chapter's own thread in a drawer beside the page. In the community they read as
   "The Kybalion — 4. The Principle of Polarity", which is a board of things people are actually
   talking about rather than a row of book titles. */
export const CHAPTERS = { 'book-chapter': 'content/books' }

/* THE SITE'S OWN COMMENT POLICY, `content/comments.md`. Its frontmatter is what every record that
 * takes comments inherits — who may comment, whether what is said waits, the flagged words, whether
 * votes and reactions are taken, how far the indent goes and how long a run may get — beside the
 * open kinds, which are the same file's other job.
 *
 * Turning comments on for a whole library is this file and nothing else: a record that says
 * nothing takes the policy's answer, so nobody edits two hundred articles to change one word.
 * `allow: off` is what ships, because a site that has not thought about moderation should not wake
 * up to a comment section.
 */
export const POLICY = { allow: 'off', approval: 'none', votes: false, reactions: true, depth: 3, collapse: 5, flagged: [], domains: [] }

const ALLOW = ['off', 'everyone', 'members', 'hosts']
const APPROVAL = ['none', 'all', 'trusted']
const word = (v, list, fallback) => {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return list.includes(s) ? s : fallback
}
const flag = (v, fallback) => (v === true || v === false ? v : typeof v === 'string' ? /^(true|yes|on)$/i.test(v.trim()) : fallback)
const num = (v, fallback, lo, hi) => {
  const n = Math.round(Number(v))
  return isFinite(n) && n >= lo && n <= hi ? n : fallback
}

/* the words a site will not have appearing unread. One list for the whole site, never one the
   platform ships: what a community will not have said is that community's business. */
export const wordsOf = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n,]/))
  .map((w) => String(w || '').trim()).filter(Boolean)

/* the five fields a row carries beside its access and its channel: the resolved answer */
export const shape = (c) => ({ allow: c.allow, approval: c.approval, votes: !!c.votes, reactions: !!c.reactions, depth: c.depth, collapse: c.collapse })

export function policyOf(d = {}) {
  return {
    allow: word(d.allow, ALLOW, POLICY.allow),
    approval: word(d.approval, APPROVAL, POLICY.approval),
    votes: flag(d.votes, POLICY.votes),
    reactions: flag(d.reactions, POLICY.reactions),
    depth: num(d.depth, POLICY.depth, 1, 10),
    collapse: num(d.collapse, POLICY.collapse, 1, 200),
    flagged: wordsOf(d.flagged),
    /* WHERE THE EMBED MAY BE DRAWN. Naming none lets it anywhere, because a site that has not
       decided has not decided against; naming any refuses every other page. */
    domains: wordsOf(d.domains),
  }
}

/*
 * `comments:` as people write it, RESOLVED AGAINST THE POLICY field by field — so the row holds the
 * answer and not the question, and one policy change reprojects rather than rewriting every record.
 * Returns null for "takes none".
 *
 *   (nothing said)                              the policy's own answer
 *   comments: false | off                       none, whatever the policy says
 *   comments: members                           members, the rest the policy's
 *   comments: { allow: everyone, votes: true }  those two its own, the rest the policy's
 *   comments: { allow: members, space: the-practice, channel: the-books }
 *                                               a post in that channel — one thread, two ways in
 */
export function commentsOf(v, policy = POLICY) {
  const p = { ...POLICY, ...(policy || {}) }
  const none = { ...p, allow: 'off' }
  const said = (o) => (o.allow === 'off' ? null : { ...o, space: o.space || null, channel: o.channel || null })
  if (v == null || v === '') return said({ ...p })
  if (v === false || v === 'off') return said(none)
  if (v === true) return said({ ...p, allow: p.allow === 'off' ? 'members' : p.allow })
  if (typeof v === 'string') return said({ ...p, allow: word(v, ALLOW, p.allow) })
  if (typeof v !== 'object') return said({ ...p })
  /* OFF MEANS OFF WHEREVER IT IS WRITTEN. A block saying `allow: off` used to fall through to the
     default and come back as `members` — so turning comments off in the admin, which writes the
     block, would have turned them ON. The word is the same word in both places. */
  if (v.allow === false) return null
  return said({
    ...p,
    allow: v.allow == null ? p.allow : word(v.allow, ALLOW, p.allow),
    approval: v.approval == null ? p.approval : word(v.approval, APPROVAL, p.approval),
    votes: flag(v.votes, p.votes),
    reactions: flag(v.reactions, p.reactions),
    depth: num(v.depth, p.depth, 1, 10),
    collapse: num(v.collapse, p.collapse, 1, 200),
    space: v.space ? String(v.space) : null,
    channel: v.channel ? String(v.channel) : null,
  })
}

/* WHAT THE SWEEP MAY REMOVE. The files own what the files declare, so a subject no file declares
   any more goes and its comments go with the cascade. But an OPEN KIND's concrete subjects are not
   declared by any file and never will be — the whole point of declaring a kind open is that its
   subjects are made at runtime, by the first person to comment through an embed. The sweep owned
   them anyway, so every projection run deleted every conversation an embed had ever started, and a
   deploy would have done it silently. For an open kind the projection owns the wildcard and nothing
   else. Pinned by build/comments.test.mjs, because a destructive rule that lives inside a loop is a
   rule no test can reach. */
export function sweepable(row, want = []) {
  if (!row || !row.kind) return false
  const keep = new Set(want.map((r) => r.kind + '\u0000' + r.subject))
  if (keep.has(row.kind + '\u0000' + row.subject)) return false
  const open = new Set(want.filter((r) => r.subject === '*').map((r) => r.kind))
  if (open.has(row.kind) && row.subject !== '*') return false
  return true
}

/* WHERE EACH KIND IS READ. The library's four live under /content; a product under the store. A
   subject's href is what the forum post links back to, so it has to be the address a reader can
   actually open — not a guess made from the kind's name. */
export const HREF = {
  article: '/content/articles',
  wiki: '/content/wiki',
  doc: '/content/docs',
  book: '/content/books',
  product: '/store/products',
}

/* what a thing's own gate says, in the words the ladder uses. A file with no gate is open. */
const accessOf = (d) => {
  const a = d.canAccess || d.access
  return a == null || a === '' || a === 'guest' ? [] : (Array.isArray(a) ? a.map(String) : [String(a)])
}

export async function pushComments({ root = process.cwd(), store, log = console.log, db: client = null } = {}) {
  const url = client ? '' : supabaseUrl()
  const key = client ? '' : serviceKey()
  if (!client && (!url || !key)) { log('comments: no database to push to'); return { subjects: 0 } }
  const db = client || createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const st = asStore(store || root)

  /* the channels a subject may point at, by "<space>/<channel>" */
  const { data: spaceRows, error: spaceError } = await db.from('spaces').select('id, slug')
  if (spaceError) throw new Error(`comments: could not read spaces: ${spaceError.message}`)
  if (!Array.isArray(spaceRows)) throw new Error('comments: could not read spaces: expected a row list')
  const { data: chanRows, error: chanError } = await db.from('channels').select('id, slug, space_id')
  if (chanError) throw new Error(`comments: could not read channels: ${chanError.message}`)
  if (!Array.isArray(chanRows)) throw new Error('comments: could not read channels: expected a row list')
  const channelId = (space, channel) => {
    if (!channel) return null
    const sid = (spaceRows || []).find((s) => s.slug === space)?.id
    return (chanRows || []).find((c) => c.slug === channel && (!sid || c.space_id === sid))?.id || null
  }

  /* THE SITE'S POLICY FIRST: every row below is the record's own answer resolved against it, so
     the database holds the answer and one policy change reprojects rather than rewriting content. */
  const cfg = matter((await st.read('content/comments.md')) || '').data || {}
  const policy = policyOf(cfg)

  const want = []

  /* a book's chapters, each its own subject */
  for (const [kind, dir] of Object.entries(CHAPTERS)) {
    const names = await st.list(dir, { deep: true })
    for (const slug of names) {
      const m = matter((await st.read(dir + '/' + slug + '.md')) || '')
      const d = m.data || {}, body = m.content || ''
      if (d.published === false) continue
      const c = commentsOf(d.comments, policy)
      if (!c) continue
      const ch = channelId(c.space, c.channel)
      bookChapters(body).forEach((chapter, i) => {
        want.push({
          kind, subject: slug + '/chapters/' + (i + 1),
          /* the title the board shows: the book and the chapter, because a post called "4" is a
             post nobody opens */
          title: (d.title || slug) + ' — ' + chapter.title,
          href: HREF.book + '/' + slug + '?ch=' + (i + 1),
          access: accessOf(d), channel_id: ch, ...shape(c),
          updated_at: new Date().toISOString(),
        })
      })
    }
  }

  for (const [kind, dir] of Object.entries(KINDS)) {
    /* the store lists NAMES without the extension, nested ones as 'a/b' — the same shape every
       other build step reads a content directory with */
    const names = await st.list(dir, { deep: true })
    for (const slug of names) {
      const d = matter((await st.read(dir + '/' + slug + '.md')) || '').data || {}
      if (d.published === false) continue
      const c = commentsOf(d.comments, policy)
      if (!c) continue
      const ch = channelId(c.space, c.channel)
      if (c.channel && !ch) { log(`comments: ${kind}/${slug}: no channel "${c.space || ''}/${c.channel}" — the comments stay on the page`) }
      want.push({
        kind, subject: slug, title: d.title || slug,
        href: HREF[kind] + '/' + slug,
        access: accessOf(d), channel_id: ch, ...shape(c),
        updated_at: new Date().toISOString(),
      })
    }
  }

  /* AND THE OPEN KINDS, as one wildcard row each (subject '*'): the site saying "this kind of thing
     may be commented on wherever it is, and here is on what terms". An embed's first comment makes
     the concrete row from it. */
  for (const k of cfg.kinds || []) {
    if (!k || !k.kind) continue
    /* an open kind is the same resolution: the site's policy, and whatever this kind says of its
       own. Its allow defaults to members rather than the policy's, because declaring a kind open
       and leaving it off would be a declaration that says nothing. */
    const c = commentsOf({ allow: 'members', ...k }, policy)
    if (!c) continue
    want.push({
      kind: String(k.kind), subject: '*', title: null, href: null,
      access: Array.isArray(k.access) ? k.access.map(String) : [],
      channel_id: channelId(k.space, k.channel), ...shape(c),
      updated_at: new Date().toISOString(),
    })
  }

  /* THE FLAGGED WORDS go to app_settings and nowhere a browser can reach: an author who can read
     the list is an author who can walk around it. They hold a comment for a person to look at and
     decide nothing by themselves — a machine may flag; only a person decides. */
  const { error: flaggedError } = await db.from('app_settings').upsert(
    { key: 'comment_flagged', value: JSON.stringify(policy.flagged), updated_at: new Date().toISOString() },
    { onConflict: 'key' })
  if (flaggedError) throw new Error(`comments: could not update flagged-word policy: ${flaggedError.message}`)
  /* the domains are NOT a secret and are read by the embed itself (comment_domains), so a site may
     change where its comments appear without a deploy */
  const { error: domainsError } = await db.from('app_settings').upsert(
    { key: 'comment_domains', value: JSON.stringify(policy.domains), updated_at: new Date().toISOString() },
    { onConflict: 'key' })
  if (domainsError) throw new Error(`comments: could not update domain policy: ${domainsError.message}`)

  if (want.length) {
    /* post_id is left alone: it is the thread's identity and is written the first time somebody
       says something. An upsert naming it would wipe a live conversation on every deploy. */
    const { error } = await db.from('comment_subjects')
      .upsert(want, { onConflict: 'kind,subject' })
    if (error) throw new Error('comments: ' + error.message)
  }
  /* WHAT THE SWEEP MAY REMOVE, and the one thing it must never touch.
   *
   * The files own what the files declare, so a subject no file declares any more goes and its
   * comments go with the cascade. But an OPEN KIND's concrete subjects are not declared by any
   * file and never will be — the whole point of declaring a kind open is that its subjects are
   * made at runtime, by the first person to comment through an embed. The sweep owned them
   * anyway, so every projection run deleted every conversation an embed had ever started, and
   * every comment in them. A deploy would have done it silently.
   *
   * So: for a kind the site declared OPEN, the projection owns the wildcard row and nothing else.
   */
  /* the kinds this projection owns: its own, the chapters', and whatever the open list named —
     never a kind it did not write, so events keep theirs */
  const kinds = [...new Set([...Object.keys(KINDS), ...Object.keys(CHAPTERS), ...want.map((r) => r.kind)])]
  const { data: had, error: hadError } = await db.from('comment_subjects').select('kind, subject').in('kind', kinds)
  if (hadError) throw new Error(`comments: could not read existing subjects: ${hadError.message}`)
  if (!Array.isArray(had)) throw new Error('comments: could not read existing subjects: expected a row list')
  let gone = 0
  for (const r of had) {
    if (!sweepable(r, want)) continue
    const { error } = await db.from('comment_subjects').delete().eq('kind', r.kind).eq('subject', r.subject)
    if (error) throw new Error(`comments: could not remove ${r.kind}/${r.subject}: ${error.message}`)
    gone++
  }
  log(`comments: ${want.length} subject(s)${gone ? `, ${gone} gone` : ''}${policy.flagged.length ? `, ${policy.flagged.length} flagged word(s)` : ''}`)
  return { subjects: want.length, gone, policy }
}

if (import.meta.url === `file://${process.argv[1]}`) await pushComments()
