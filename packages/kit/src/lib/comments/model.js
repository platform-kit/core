/*
 * THE SHAPE OF A CONVERSATION, and the arithmetic over what people did to it. Pure: no imports, no
 * clock it asks itself, no supabase — the page and build/comments.test.mjs read exactly the same
 * functions, so "9 up and 1 down beats 40 up and 30 down" is a test rather than a claim.
 *
 * The one idea worth stating: A REPLY MAY ANSWER ANY REPLY, and it is the DRAWING that is bounded.
 * The depth is kept in the data because who somebody was answering is part of what they said;
 * indenting four times is a column six words wide. So `shape` nests to the surface's depth, runs
 * flat after it, and every line drawn shallower than it really is carries `answers` — who it is
 * replying to — because a flat run answering four different people is a conversation nobody can
 * follow.
 */

/* the tree, from the flat list the database returns. Oldest first; an orphan (its parent gone from
   this page, or a parent that would loop) is treated as a top-level line rather than dropped —
   losing somebody's words to a broken pointer is the worse failure. */
export function treeOf(rows = []) {
  const list = (rows || []).filter((r) => r && r.id)
  const by = new Map(list.map((r) => [r.id, { ...r, kids: [] }]))
  const roots = []
  for (const r of by.values()) {
    const p = r.parent && by.get(r.parent)
    /* a parent that is also, however far up, a child of this one is a loop; nothing writes one, and
       a read that trusted it would hang */
    let loops = false
    for (let q = p; q; q = q.parent && by.get(q.parent)) if (q.id === r.id) { loops = true; break }
    if (p && !loops) p.kids.push(r)
    else roots.push(r)
  }
  const at = (n, d) => { n.depth = d; n.kids.forEach((k) => at(k, d + 1)) }
  roots.forEach((n) => at(n, 0))
  return roots
}

/* WHAT IS DRAWN, in order, each line knowing how far to indent and who it answers.
 *
 *   depth     how far the indent goes before a run flattens (1 = a comment and one flat run)
 *   collapse  how many replies under one comment are shown before the rest fold behind a control
 *
 * A folded run is not dropped: `hidden` says how many there are, and the caller opens it by passing
 * that comment's id in `open`. */
export function shape(rows = [], { depth = 3, collapse = 5, open = [] } = {}) {
  const stop = Math.max(1, Number(depth) || 1)
  const most = Math.max(1, Number(collapse) || 1)
  const opened = new Set(open || [])
  const out = []
  const line = (n, parent) => ({
    ...n,
    /* the indent stops; the conversation does not */
    indent: Math.min(n.depth, stop),
    flat: n.depth > stop,
    /* once the indent stops, the shape no longer says who somebody was answering, so the line
       does. Null while the indent still says it. */
    answers: n.depth > stop && parent ? { id: parent.id, name: parent.name || '' } : null,
  })
  const walk = (node, parent) => {
    out.push(line(node, parent))
    /* a line at or past the stop takes its WHOLE subtree as one run: there is no indent left to
       tell a reply from a reply to a reply, so they are one list in the order they were written */
    const run = node.depth >= stop ? deep(node) : node.kids
    if (!run.length) return
    const show = run.length > most && !opened.has(node.id) ? run.slice(0, most) : run
    for (const k of show) {
      if (node.depth >= stop) out.push(line(k, k.of || node))
      else walk(k, node)
    }
    if (show.length < run.length) out.push({ fold: node.id, hidden: run.length - show.length, indent: Math.min(node.depth + 1, stop) })
  }
  for (const r of treeOf(rows)) walk(r, null)
  return out
}

/* every descendant of a node, oldest first, each remembering the line it answers — the flat run
   under a comment once the indent has stopped */
function deep(node) {
  const out = []
  const go = (n) => { for (const k of n.kids) { out.push({ ...k, of: n }); go(k) } }
  go(node)
  return out.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

/* ---------------------------------------------------------------------------------------------
 * VOTES: what each order means, and why `best` is not `top`.
 * ------------------------------------------------------------------------------------------- */

export const ORDERS = ['oldest', 'newest', 'top', 'best', 'controversial']
/* an order nothing can compute is not a choice */
export const ordersFor = (votes) => (votes ? ORDERS : ['oldest', 'newest'])

export const scoreOf = (c) => (Number(c && c.up) || 0) - (Number(c && c.down) || 0)

/* THE WILSON LOWER BOUND on the proportion of ups, at 95% — what Reddit's `best` is. A raw score
 * rewards whatever was seen most: 40 up and 30 down outranks 9 up and 1 down although the first is
 * disputed and the second is liked. This asks instead "how good is this, at worst, given how many
 * people have said anything", so a small strong majority beats a large argued one. That difference
 * is the whole reason both orders exist. */
export function bestOf(c) {
  const up = Number(c && c.up) || 0
  const down = Number(c && c.down) || 0
  const n = up + down
  if (!n) return 0
  const z = 1.96
  const p = up / n
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n)
}

/* THE MOST ARGUED OVER: many votes, close to even. Both halves matter — two people disagreeing is
 * not a controversy, and forty people agreeing is not one either. */
export function heatOf(c) {
  const up = Number(c && c.up) || 0
  const down = Number(c && c.down) || 0
  const n = up + down
  if (!n || !up || !down) return 0
  const balance = Math.min(up, down) / Math.max(up, down)
  return n * balance
}

const stamp = (c) => new Date((c && c.created_at) || 0).getTime() || 0

/* the reader's own order, over the roots alone: a reply belongs to what it answers, and sorting the
   whole flat list would scatter every conversation. `shape` nests what comes back. */
export function sortComments(rows = [], order = 'oldest') {
  const list = [...(rows || [])]
  const roots = list.filter((r) => !r.parent)
  const rest = list.filter((r) => r.parent)
  const by = {
    oldest: (a, b) => stamp(a) - stamp(b),
    newest: (a, b) => stamp(b) - stamp(a),
    top: (a, b) => scoreOf(b) - scoreOf(a) || stamp(a) - stamp(b),
    best: (a, b) => bestOf(b) - bestOf(a) || stamp(a) - stamp(b),
    controversial: (a, b) => heatOf(b) - heatOf(a) || stamp(a) - stamp(b),
  }
  roots.sort(by[order] || by.oldest)
  /* replies stay in the order they were written whatever the roots are sorted by: a conversation
     read out of sequence is not a conversation */
  rest.sort(by.oldest)
  return [...roots, ...rest]
}

/* ---------------------------------------------------------------------------------------------
 * THE TALLIES, as a surface reads them back.
 * ------------------------------------------------------------------------------------------- */

/* one row per emoji, most first, saying whether this reader is among them. `re` is the object the
   read returns (emoji → count) and `mine` the emoji this reader left. */
export function reactionsOf(c) {
  const re = (c && c.re) || {}
  const mine = new Set((c && c.mine_re) || [])
  return Object.keys(re)
    .map((emoji) => ({ emoji, n: Number(re[emoji]) || 0, mine: mine.has(emoji) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.emoji.localeCompare(b.emoji))
}

/* WHAT A PRESS DOES TO A VOTE, before anything is sent: casting the opposite replaces it, casting
   the same again withdraws it. One row per person, and never a count that drifts. */
export function voteAfter(had, pressed) {
  const was = Number(had) || 0
  const now = Number(pressed) || 0
  if (!now) return 0
  return was === now ? 0 : now
}

/* the tally a surface should show the moment somebody presses, before the write comes back */
export function voteTally(c, next) {
  const was = Number((c && c.my_vote) || 0)
  const up = Number((c && c.up) || 0) - (was === 1 ? 1 : 0) + (next === 1 ? 1 : 0)
  const down = Number((c && c.down) || 0) - (was === -1 ? 1 : 0) + (next === -1 ? 1 : 0)
  return { up: Math.max(0, up), down: Math.max(0, down), my_vote: next }
}

/* ---------------------------------------------------------------------------------------------
 * THE FLAGGED LIST. A machine may flag; only a person decides — so this returns the word that
 * matched and nothing else happens by itself.
 * ------------------------------------------------------------------------------------------- */

/* WHOLE WORDS, case-insensitively, never substrings: substring matching is how "Scunthorpe" and
   "assassin" get held, and a filter that cries wolf is one a moderator stops reading. The same
   rule is written in SQL in 97-comments.sql, because that is where a comment is actually held;
   build/comments-db.test.mjs runs these same cases through the database so the two cannot drift. */
export function flaggedWord(body = '', words = []) {
  const text = String(body || '')
  for (const raw of words || []) {
    const w = String(raw || '').trim()
    if (!w) continue
    const re = new RegExp('(^|[^\\p{L}\\p{N}_])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}_])', 'iu')
    if (re.test(text)) return w
  }
  return null
}

/* WHY A COMMENT WAITS, or null for one that goes straight up. Two reasons and neither decides
   anything: `word` is the flagged list, which holds a comment whoever wrote it — including
   somebody otherwise trusted, since the list exists for the times trust is misplaced — and
   `standing` is the surface's approval setting against facts about the person. */
export function holdsFor({ approval = 'none', body = '', words = [], trusted = false } = {}) {
  const word = flaggedWord(body, words)
  if (word) return { why: 'word', word }
  if (approval === 'all') return { why: 'standing', word: null }
  if (approval === 'trusted' && !trusted) return { why: 'standing', word: null }
  return null
}

/* ---------------------------------------------------------------------------------------------
 * WHERE THE EMBED MAY BE DRAWN. A site's policy may name the domains its comments belong under;
 * naming none lets them anywhere, because a site that has not decided has not decided against.
 * ------------------------------------------------------------------------------------------- */

/* A DOMAIN MATCHES ITSELF AND ITS SUBDOMAINS, which is what somebody writing "example.com" means:
 * they are not thinking about www, and a list that made them write it twice is a list they will get
 * wrong. A scheme or a path in the entry is forgiven — somebody will paste a url — and the site's
 * own host is always allowed, since refusing to draw on the site that serves the page would be a
 * rule against nobody.
 *
 * `self` is the site's OWN ORIGIN and is always allowed, since refusing to draw on the site that
 * serves the page would be a rule against nobody. It is the origin and not the host on purpose: in
 * development the site and the page framing it are both localhost on different ports, and comparing
 * hosts let every local page through a list that should have refused it.
 *
 * This is not a secret and cannot be: somebody determined can comment by visiting the site itself.
 * What it prevents is a site's comments appearing under pages it did not agree to.
 */
export function embedAllowed(origin, domains = [], self = '') {
  const list = (domains || []).map((d) => String(d || '').trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')).filter(Boolean)
  if (!list.length) return true
  if (!origin) return false
  let host
  try { host = new URL(origin).hostname.toLowerCase() } catch (e) { return false }
  if (self && String(origin).toLowerCase() === String(self).toLowerCase()) return true
  return list.some((want) => host === want || host.endsWith('.' + want))
}

/* the three words the admin filters by, from the two columns that hold them */
export const stateOf = (c) => (c && c.deleted_at ? 'removed' : (c && c.state) || 'live')
