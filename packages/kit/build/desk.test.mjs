/*
 * The desk's rules live in four pure modules — src/lib/desk/shape.js and the three adapters — so
 * the surface and this file read the same arithmetic: what a row of the one list looks like, what
 * is owed and in which words, the order, and how each source's own rows are translated into it.
 * The fixtures below are real rows: support_inbox's, chat_inbox's, space_unread's and
 * space_activity's, as the database returns them. Nothing here touches Supabase — the policies
 * themselves are proven against the local stack by build/desk-db.test.mjs.
 */
import { sourcesOn, sourceForQueue, filterQueue, dueOf, owedOf, sortDesk, deskBadge, badgeBySource, filterDesk, sourcesIn, SOURCES, isDone, doneSet } from '../src/lib/desk/shape.js'
import * as support from '../src/lib/desk/support.js'
import * as coaching from '../src/lib/desk/coaching.js'
import * as comments from '../src/lib/desk/comments.js'
import { loadSite, deskSourcesOf } from './site.mjs'
import { sources as nodeDeskSources } from './site-desk-node.mjs'
import { join } from 'node:path'

let pass = 0, fail = 0
const WORKSPACE = new URL('../../..', import.meta.url).pathname
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\nDESK\n')

const now = Date.parse('2026-09-22T12:00:00.000Z')
const ago = (min) => new Date(now - min * 60000).toISOString()
const WORDS = { 'due-in': 'Reply due in {span}', 'due-over': 'Overdue by {span}', waiting: 'Waiting {span}' }

/* --- which sources a site runs --- */
ok('every source with everything on', eq(sourcesOn({}), SOURCES))
ok('a module off is not a source', eq(sourcesOn({ coaching: false }), ['support', 'comments']))
ok('support off leaves the others', eq(sourcesOn({ support: false }), ['coaching', 'comments']))
/* the comments queue is not a module of its own: comments come with the content, and the
   conversations no room owns would otherwise be nobody's job */
ok('the comments queue is there whatever is off', sourcesOn({ support: false, coaching: false }).join(' ') === 'comments')
ok('spaces off is no desk at all', eq(sourcesOn({ spaces: false }), []))
ok('each desk queue narrows to its own source', ['support', 'clients', 'comments', 'social'].every((queue) =>
  sourceForQueue(queue) === ({ support: 'support', clients: 'coaching', comments: 'comments', social: 'social' })[queue]))
const socialRegistration = [{ id: 'social', module: 'social-publishing' }]
ok('registered sources are opt-in and obey their module switch',
  eq(sourcesOn({ 'social-publishing': true }, socialRegistration), ['support', 'coaching', 'comments', 'social'])
    && eq(sourcesOn({ 'social-publishing': false }, socialRegistration), SOURCES)
    && eq(sourcesOn({ spaces: false, 'social-publishing': true }, socialRegistration), []))
const demoSite = await loadSite(join(WORKSPACE, 'sites/demo'))
ok('a site can register its Social Desk adapter explicitly',
  deskSourcesOf({ spaces: { deskSources: './src/community/desk-sources.js' } }).sources === './src/community/desk-sources.js')
ok('the generic demo site has no Social Desk registration', deskSourcesOf(demoSite).sources === null)
ok('Social conversation destinations map to the one registered source',
  sourceForQueue('social-comments') === 'social' && sourceForQueue('social-dms') === 'social')
const socialQueueFixture = [
  { source: 'social', conversationKind: 'comment', id: 'comment-1', resolved: false },
  { source: 'social', conversationKind: 'dm', id: 'dm-1', resolved: false },
  { source: 'support', conversationKind: 'comment', id: 'support-1', resolved: false },
  { source: 'social', conversationKind: 'comment', id: 'comment-done', resolved: true },
]
ok('Social comment and DM queues stay disjoint, including their done tabs',
  eq(filterQueue(socialQueueFixture, 'social-comments').map((row) => row.id), ['comment-1'])
    && eq(filterQueue(socialQueueFixture, 'social-dms').map((row) => row.id), ['dm-1'])
    && eq(filterQueue(socialQueueFixture, 'social-comments', true).map((row) => row.id), ['comment-done']))
ok('the Node fallback has no registered Desk sources', Array.isArray(nodeDeskSources) && nodeDeskSources.length === 0)

/* --- what is owed, one rule over three clocks --- */
const owedRow = (min, due) => ({ waiting_since: ago(min), due })
ok('nothing promised owes nothing', dueOf(owedRow(30, 0), now) === null)
ok('nothing waiting owes nothing', dueOf({ waiting_since: null, due: 15 }, now) === null)
const d1 = dueOf(owedRow(5, 15), now)
ok('a promise not yet up is due, not over', d1 && !d1.over && d1.left === 10 * 60000, JSON.stringify(d1))
const d2 = dueOf(owedRow(50, 15), now)
ok('a promise gone by is over', d2 && d2.over && d2.left === -35 * 60000, JSON.stringify(d2))

ok('a support thread past the desk\'s wait says so', owedOf(owedRow(50, 15), WORDS, now).text === 'Overdue by 35m')
ok('a member inside their promise says when', owedOf(owedRow(60, 24 * 60), WORDS, now).text === 'Reply due in 23h')
ok('a mention promises nothing and simply waits', eq(owedOf({ waiting_since: ago(60), due: 0 }, WORDS, now), { text: 'Waiting 1h', over: false, soft: true }))
ok('a wait is never nought minutes', owedOf({ waiting_since: ago(0), due: 0 }, WORDS, now).text === 'Waiting 1m')
ok('a row waiting on nobody says nothing', owedOf({ waiting_since: null, due: 15 }, WORDS, now) === null)
ok('both are said in one set of words', ['support', 'coaching']
  .map((s) => owedOf({ source: s, waiting_since: ago(90), due: 15 }, WORDS, now))
  .every((o) => o && (o.text.startsWith('Overdue by') || o.text.startsWith('Waiting'))))

/* --- the order: longest wait first, then activity --- */
const list = [
  { key: 'a', waiting_since: ago(10), at: ago(10) },
  { key: 'b', waiting_since: ago(90), at: ago(90) },
  { key: 'c', waiting_since: null, at: ago(1) },
  { key: 'd', waiting_since: ago(40), at: ago(40) },
  { key: 'e', waiting_since: null, at: ago(200) },
]
ok('longest wait first, the unwaiting under them by activity', eq(sortDesk(list).map((r) => r.key), ['b', 'd', 'a', 'c', 'e']))
ok('the order does not disturb the list it was given', list[0].key === 'a')
const badge = deskBadge([owedRow(50, 15), owedRow(5, 15), { waiting_since: ago(60), due: 0 }, { waiting_since: null, due: 15 }], now)
ok('the badge counts what waits and what is past its promise', eq(badge, { waiting: 3, overdue: 1 }), JSON.stringify(badge))

/* --- support: support_inbox's own rows --- */
const SUPPORT_ROWS = [
  { id: 's-open', status: 'open', assignee_id: null, created_at: ago(200), last_message_at: ago(50),
    contact: { id: 'k1', user_id: null, name: null, kind: 'guest', last_path: '/store', orders: 0 },
    last: { id: 'm1', author: 'contact', kind: 'text', body: 'is this in stock?', created_at: ago(50), deleted_at: null },
    unread: 2, waiting_since: ago(50) },
  { id: 's-answered', status: 'open', assignee_id: 'agent', created_at: ago(300), last_message_at: ago(20),
    contact: { id: 'k2', user_id: 'u2', name: 'Ada', kind: 'customer', last_path: '/app', orders: 3 },
    last: { id: 'm2', author: 'agent', kind: 'text', body: 'sent!', created_at: ago(20), deleted_at: null },
    unread: 0, waiting_since: null },
  { id: 's-resolved', status: 'resolved', created_at: ago(900), last_message_at: ago(800),
    contact: { id: 'k3', user_id: 'u3', name: 'Bo', kind: 'user' }, last: null, unread: 0, waiting_since: ago(800) },
]
const sup = support.rowsOf(SUPPORT_ROWS, { wait: 15 })
ok('support lists what waits on the desk and what was finished with, and nothing between',
  eq(sup.map((r) => r.id), ['s-open', 's-resolved']), JSON.stringify(sup.map((r) => [r.id, r.resolved])))
 ok('an open thread nobody is waiting on belongs to the support inbox, not the desk', !sup.some((r) => r.id === 's-answered'))
ok('a support row carries the desk\'s wait as its promise', sup[0].due === 15)
ok('a guest is a guest, and the page they are on is the detail', sup[0].person.kind === 'guest' && sup[0].detail === '/store')
ok('a support row names its source and keys on it', sup[0].source === 'support' && sup[0].key === 'support:s-open')
ok('the last line is theirs, not ours', sup[0].last.mine === false && sup[0].last.body === 'is this in stock?')
const supCustomer = support.rowsOf([{ ...SUPPORT_ROWS[1], waiting_since: ago(5), last: { author: 'contact', body: 'hi', created_at: ago(5) } }], { wait: 15 })
ok('a signed-in reader who has paid is a customer', supCustomer[0].person.kind === 'customer' && supCustomer[0].person.name === 'Ada')
ok('a reader who has not is a reader', support.rowsOf([{ id: 'x', status: 'open', waiting_since: ago(5), contact: { kind: 'user', name: 'Bo' }, last: null }], {})[0].person.kind === 'reader')
ok('with no policy in hand a support thread still waits, promising nothing', support.rowsOf(SUPPORT_ROWS, {})[0].due === 0)

/* --- comments: the conversations no room owns, and only those --- */
const COMMENT_ROWS = [
  { id: 'c1', kind: 'article', subject: 'listening-back', title: 'Listening Back', href: '/content/articles/listening-back',
    attached: false, body: 'is this even true', state: 'waiting', flagged: null, created_at: ago(70),
    author_id: 'u9', author: 'Nell', trusted: false },
  { id: 'c2', kind: 'page', subject: '/blog/a-post', title: 'A post', href: 'https://elsewhere/blog/a-post',
    attached: false, body: 'damn', state: 'waiting', flagged: 'damn', created_at: ago(20),
    author_id: 'u3', author: 'Bo', trusted: true },
  { id: 'c3', kind: 'book-chapter', subject: 'the-kybalion/chapters/4', title: 'The Kybalion — 4', href: '/content/books/the-kybalion?ch=4',
    attached: true, body: 'chapter four lost me', state: 'waiting', flagged: null, created_at: ago(10),
    author_id: 'u1', author: 'Ada', trusted: true },
  { id: 'c4', kind: 'article', subject: 'listening-back', title: 'Listening Back', href: '/content/articles/listening-back',
    attached: false, body: 'good piece', state: 'live', flagged: null, created_at: ago(300), author_id: 'u2', author: 'Kit', trusted: true },
]
const cq = comments.rowsOf(COMMENT_ROWS, { wait: 15 })
ok('a room\'s own comments are that room\'s to moderate, not the desk\'s', !cq.some((r) => r.id === 'c3'))
ok('the unattached ones are the desk\'s', eq(cq.map((r) => r.id), ['c1', 'c2', 'c4']))
ok('a held comment waits from when it was said', cq[0].waiting_since === COMMENT_ROWS[0].created_at)
ok('a decided one is finished with', cq[2].resolved === true && cq[2].waiting_since === null)
ok('the detail is what a person reads, never a slug', cq[0].detail === 'Listening Back')
ok('a comments row names its source and keys on it', cq[0].source === 'comments' && cq[0].key === 'comments:c1')
ok('the matched word travels to the moderator', cq[1].flagged === 'damn')
ok('a trusted author held by a word is still held', cq[1].waiting_since !== null && COMMENT_ROWS[1].trusted === true)
ok('the line is theirs, not ours', cq[0].last.mine === false && cq[0].last.body === 'is this even true')
ok('the way back to the page travels with it', cq[1].href === 'https://elsewhere/blog/a-post')
ok('with no policy in hand it still waits, promising nothing', comments.rowsOf(COMMENT_ROWS, {})[0].due === 0)

/* --- coaching: chat_inbox's own rows, and the promise the offers make --- */
const PRODUCTS = [
  { kind: 'membership', tier: 'inner', 'chat-hours': 24 },
  { kind: 'membership', tier: 'inner', 'chat-hours': 48 },
  { kind: 'membership', tier: 'basic', 'chat-hours': 72 },
  { kind: 'session', 'chat-hours': 48 },
  { kind: 'book' },
]
const table = coaching.hoursTable(PRODUCTS)
ok('a tier keeps the kinder of two promises', table.tier.inner === 48 && table.tier.basic === 72)
ok('a paid session keeps the shortest', table.session === 48)
const rank = (t) => ({ basic: 1, inner: 2 }[t] || 0)
ok('the highest live tier wins', coaching.hoursFor(table, { tiers: ['basic', 'inner'] }, rank) === 48)
ok('a week of chat from a session, where there is no tier', coaching.hoursFor(table, { tiers: [], session_chat: true }, rank) === 48)
ok('nobody is promised nothing', coaching.hoursFor(table, { tiers: [] }, rank) === 0)
const CHAT_ROWS = [
  { id: 'c-wait', created_at: ago(400), last_message_at: ago(120), awaiting_since: ago(120), unread: 1,
    peer: { id: 'u5', name: 'Kit', tiers: ['basic'], session_chat: false },
    last: { id: 'cm1', kind: 'text', body: 'one more thing', sender_id: 'u5', created_at: ago(120), deleted_at: null } },
  { id: 'c-done', created_at: ago(900), last_message_at: ago(5), awaiting_since: null, unread: 0,
    peer: { id: 'u6', name: 'Lee', tiers: [], session_chat: false }, last: { sender_id: 'me', body: 'anytime', created_at: ago(5) } },
]
const coa = coaching.rowsOf(CHAT_ROWS, { products: PRODUCTS, rank, me: 'me' })
ok('coaching lists only the threads whose last word is theirs', eq(coa.map((r) => r.id), ['c-wait']))
ok('a coaching row carries the tier\'s promise in minutes', coa[0].due === 72 * 60)
ok('a coaching peer is a member', coa[0].person.kind === 'member' && coa[0].person.name === 'Kit')
ok('a coaching row keys on its source', coa[0].key === 'coaching:c-wait' && coa[0].source === 'coaching')


/* --- the union: two sources, one list --- */
/* the desk's list is what is waiting; the support fixture's resolved thread is on the other side of
   it, which is exactly where a thread nobody is waiting on belongs */
const everything = sortDesk([...sup, ...coa])
const all = filterDesk(everything, null, false)
ok('two sources make one list', all.length === 2, JSON.stringify(everything.map((r) => [r.source, r.resolved])))
ok('and what was resolved is on the finished side of it', filterDesk(everything, null, true).map((r) => r.id).join() === 's-resolved')
ok('the list is longest wait first', eq(all.map((r) => r.source), ['coaching', 'support']), JSON.stringify(all.map((r) => [r.source, r.waiting_since])))
ok('every row says where it came from', all.every((r) => SOURCES.includes(r.source)))
ok('every row has a key of its own', new Set(all.map((r) => r.key)).size === all.length)
ok('every row fills the same shape', all.every((r) => r.person && 'unread' in r && 'waiting_since' in r && 'due' in r && 'at' in r))

/* --- each queue counts its own --- */
/* a place badges its own rows: Support counts what is waiting at the desk, Clients what a client is
   waiting on, and neither ever shows the other's number */
const counted = badgeBySource(all)
ok('each queue counts only its own rows',
  counted.support.waiting === all.filter((r) => r.source === 'support').length
  && counted.coaching.waiting === all.filter((r) => r.source === 'coaching').length,
  JSON.stringify(counted))
ok('and the two are not the same number here', counted.support.waiting !== counted.coaching.waiting || all.length === 2)
ok('a queue with nothing in it counts nought', badgeBySource([]).support.waiting === 0)
ok('a resolved row is nobody\'s badge', badgeBySource([{ source: 'support', waiting_since: new Date().toISOString(), resolved: true }]).support.waiting === 0)

/* --- a source removed --- */
const withoutCoaching = filterDesk(sortDesk([...sup]), null, false)
ok('with coaching off the desk lists the other one', eq(sourcesIn(withoutCoaching), ['support']))
ok('and says nothing about coaching anywhere', !JSON.stringify(withoutCoaching).includes('coaching'))
/* the narrowing is what a place does: Support is one queue, Clients the other */
ok('the narrowing keeps one source', eq(filterDesk(all, 'coaching', false).map((r) => r.source), ['coaching']))
ok('no narrowing keeps them all', filterDesk(all, null, false).length === 2)

/* --- finished with: one status where a system has one, a mark where it has none --- */
ok('the support desk answers from its own status',
  isDone({ source: 'support', status: 'resolved' }) === true && isDone({ source: 'support', status: 'open' }) === false)
const marks = doneSet([
  { source: 'coaching', ref: 'c-wait', resolved_at: ago(60) },
  { source: 'support', ref: 's-other', resolved_at: ago(60) },
])
ok('a mark is read by source and id', isDone({ source: 'coaching', id: 'c-wait', waiting_since: null }, marks) === true)
ok('a mark holds while nothing new was said', isDone({ source: 'coaching', id: 'c-wait', waiting_since: ago(90) }, marks) === true)
ok('and lets go the moment they write again', isDone({ source: 'coaching', id: 'c-wait', waiting_since: ago(30) }, marks) === false)
ok('an unmarked row was never finished with', isDone({ source: 'coaching', id: 'other', waiting_since: ago(5) }, marks) === false)
ok('a mark on one source says nothing about another', isDone({ source: 'support', id: 'c-wait', waiting_since: null }, marks) === false)

/* --- the two lists are the same list, cut in two --- */
const mixed = [
  { key: 'a', source: 'support', waiting_since: ago(30), at: ago(30), resolved: false },
  { key: 'b', source: 'support', waiting_since: null, at: ago(10), resolved: true },
  { key: 'c', source: 'space', waiting_since: ago(5), at: ago(5), resolved: false },
]
ok('waiting is what is not finished with', eq(filterDesk(mixed, null, false).map((r) => r.key), ['a', 'c']))
ok('done is what is', eq(filterDesk(mixed, null, true).map((r) => r.key), ['b']))
ok('a source narrows either of them', eq(filterDesk(mixed, 'support', false).map((r) => r.key), ['a']))
ok('what is finished with is not still owed', deskBadge(mixed, now).waiting === 2, JSON.stringify(deskBadge(mixed, now)))

/* --- the adapters carry it --- */
const supDone = support.rowsOf([{ id: 's-done', status: 'resolved', created_at: ago(900), last_message_at: ago(80),
  contact: { kind: 'guest' }, last: { author: 'agent', body: 'sorted', created_at: ago(80) }, unread: 0, waiting_since: ago(900) }], { wait: 15 })
ok('a resolved support thread is on the desk as finished, not as waiting',
  supDone.length === 1 && supDone[0].resolved === true && supDone[0].waiting_since === null)
const coaDone = coaching.rowsOf(CHAT_ROWS, { products: PRODUCTS, rank, me: 'me', marks: doneSet([{ source: 'coaching', ref: 'c-wait', resolved_at: ago(10) }]) })
ok('a coaching thread marked after their last word is finished with', coaDone[0].resolved === true)
const coaBack = coaching.rowsOf(CHAT_ROWS, { products: PRODUCTS, rank, me: 'me', marks: doneSet([{ source: 'coaching', ref: 'c-wait', resolved_at: ago(300) }]) })
ok('and one marked before it is waiting again', coaBack[0].resolved === false)

console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
