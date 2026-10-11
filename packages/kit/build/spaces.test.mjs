/*
 * The spaces' rules live in two pure modules — src/lib/spaces/model.js and query.js — so the surface
 * and this file read the same arithmetic: what is unread, what a catch-up asks for and what it
 * leaves to paging, where the unread divider sits, which message notifies whom, how a mention is
 * written and read back, and what a search asks for once its narrowings have been chosen. Nothing here
 * touches Supabase: the database's own rules (the counters, the policies, the broadcast) are proven
 * against the local stack by build/spaces-db.test.mjs.
 */
import {
  unreadOf, mentionsOf, mutedNow, badgeOf, waitingOf, badgesBySpace, cursorsOf, mergeCatchup, mergeMessages,
  dividerSeq, threadOf, writeMention, mentionIds, mentionsChannel, mentionParts, plainBody, runsOf,
  notifies, mayMentionChannel, CHANNEL_MENTION, dmTitle, sidedRoom, canReply, canReact, fromEvent, fromBot, railSections, draftCount,
  botsMentioned, BOT_PICK, rolesMentioned, ROLE_PICK,
  toTokens, fromTokens, mentionSpans, CHANNEL_PICK, statusOf, myStatus, isStatus, AWAY_AFTER,
  rolesOf, holdsRole, tallyPoll, pollOf, saidIn, saidBy, roomAsProse, roomFor, titleOf } from '../src/lib/spaces/model.js'
import { ALL, search as emojiSearch, remember } from '../src/lib/spaces/emoji.js'
import { KEYS, commandOf, isTyping, sayKey, stepRoom } from '../src/lib/spaces/keys.js'
import { offers, usable, fieldValue } from '../src/lib/spaces/later.js'
import { RANGES, rangeDates, dayStart, dayEnd, blankQuery, queryArgs, emptyQuery, narrowingCount, chipsOf, describeQuery } from '../src/lib/spaces/query.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\nSPACES\n')

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const now = Date.parse('2026-09-22T12:00:00.000Z')

/* --- unread is a subtraction, never a count --- */
ok('unread is the difference', unreadOf({ seq: 30, read: 12 }) === 18)
ok('unread reads the raw column names too', unreadOf({ last_seq: 5, last_read_seq: 5 }) === 0)
ok('unread never goes below zero', unreadOf({ seq: 3, read: 9 }) === 0)
ok('mentions are their own counter', mentionsOf({ mentions: 2 }) === 2 && mentionsOf({}) === 0)

const rows = [
  { channel: 'c1', space: 's1', seq: 10, read: 4, mentions: 1, notify: 'mentions' },
  { channel: 'c2', space: 's1', seq: 8, read: 8, mentions: 0, notify: 'mentions' },
  { channel: 'c3', space: 's2', seq: 40, read: 0, mentions: 0, notify: 'none' },
  { channel: 'c4', space: 's2', seq: 5, read: 1, mentions: 2, notify: 'mentions', muted_until: '2026-09-23T00:00:00.000Z' },
]
const badge = badgeOf(rows, now)
ok('a badge counts the unread of the channels that ask to be counted', badge.unread === 6, JSON.stringify(badge))
ok('a badge counts every mention, muted or not', badge.mentions === 3, JSON.stringify(badge))
ok('a channel set to nothing adds no unread', badgeOf([rows[2]], now).unread === 0)
ok('a muted channel keeps its mentions and drops its messages', badgeOf([rows[3]], now).unread === 0 && badgeOf([rows[3]], now).mentions === 2)
ok('muting expires', mutedNow({ muted_until: '2026-09-21T00:00:00.000Z' }, now) === false)
/* --- and the ONE number the site's header carries --- */
/* What is waiting is what somebody addressed to this person: a direct message unread, a mention
   anywhere. A busy channel nobody named them in is not waiting for them, however many lines it has —
   a header badge that counted it would read 400 by Tuesday and mean nothing. */
const dms = [
  { channel: 'd1', kind: 'dm', seq: 7, read: 5, mentions: 0, notify: 'all' },      /* 2 unread */
  { channel: 'd2', kind: 'dm', seq: 3, read: 3, mentions: 0, notify: 'all' },      /* nothing */
  { channel: 'c9', kind: 'channel', seq: 400, read: 0, mentions: 1, notify: 'mentions' },  /* 1 mention, 400 unread */
]
ok('the header counts DMs unread plus every mention, and no other traffic', waitingOf(dms, now) === 3, String(waitingOf(dms, now)))
ok('a muted DM stops counting its messages', waitingOf([{ ...dms[0], muted_until: '2026-09-23T00:00:00.000Z' }], now) === 0)
ok('a muted room still counts what names you', waitingOf([{ ...dms[2], muted_until: '2026-09-23T00:00:00.000Z' }], now) === 1)
ok('a DM set to nothing stops counting', waitingOf([{ ...dms[0], notify: 'none' }], now) === 0)
ok('nothing waiting is zero, not a blank', waitingOf([], now) === 0)

const by = badgesBySpace(rows, now)
ok('badges split by space', by.s1.unread === 6 && by.s2.unread === 0 && by.s2.mentions === 2, JSON.stringify(by))

/* --- the cursor, and what is too far behind to carry --- */
ok('cursors are the last seq seen per channel', eq(cursorsOf([{ channel: 'c1', seen: 4 }, { channel: 'c2', read: 8 }]), { c1: 4, c2: 8 }))
ok('a channel named twice keeps the furthest', eq(cursorsOf([{ channel: 'c1', seen: 4 }, { channel: 'c1', seen: 9 }]), { c1: 9 }))
const answer = [
  { channel: 'c1', from: 4, more: false, messages: [{ id: 'm5', seq: 5 }, { id: 'm6', seq: 6 }] },
  { channel: 'c9', from: 0, more: true, messages: [{ id: 'x', seq: 1 }] },
]
const merged = mergeCatchup(answer)
ok('a catch-up adds what is new', merged.add.c1.length === 2)
ok('a channel further behind than the cap is paged, never trimmed silently', eq(merged.page, ['c9']))

/* --- messages arrive in any order and land once --- */
const list = mergeMessages([{ id: 'a', seq: 2 }], [{ id: 'b', seq: 1 }, { id: 'a', seq: 2, body: 'later' }])
ok('messages are ordered by seq', eq(list.map((m) => m.id), ['b', 'a']))
ok('a message that arrives twice is one message, the newer fields winning', list[1].body === 'later')
ok('a message with no id is ignored', mergeMessages([], [{ seq: 1 }]).length === 0)

/* --- the divider --- */
const stream = [
  { id: '1', seq: 1, author_id: A }, { id: '2', seq: 2, author_id: B },
  { id: '3', seq: 3, author_id: A }, { id: '4', seq: 4, author_id: B },
]
ok('the divider sits at the first unread that is not mine', dividerSeq(stream, 1, A) === 2)
ok('my own messages do not move the divider', dividerSeq(stream, 2, A) === 4)
ok('nothing unread, no divider', dividerSeq(stream, 4, A) === null)
ok('the divider is a seq, so a page of older messages does not move it', dividerSeq(stream.slice(1), 1, A) === 2)

/* --- runs: by the author of a space message, not the chat's sender --- */
const t = (min) => new Date(Date.parse('2026-09-22T09:00:00.000Z') + min * 60000).toISOString()
const run = runsOf([
  { id: '1', author_id: A, created_at: t(0) },
  { id: '2', author_id: A, created_at: t(1) },
  { id: '3', author_id: B, created_at: t(2) },
  { id: '4', author_id: B, created_at: t(20) },
  { id: '5', kind: 'system', created_at: t(21) },
  { id: '6', author_id: B, created_at: t(22) },
])
ok('a run begins with the first message', run[0].first === true)
ok('the same person a minute later joins it', run[1].first === false)
ok('someone else begins a new run', run[2].first === true)
ok('the same person long after begins a new one', run[3].first === true)
ok('a system line is always its own', run[4].first === true && run[4].last === true)
ok('and never lets two messages either side of it join', run[5].first === true)
ok('the last of a run is marked', run[1].last === true && run[0].last === false)
ok('a message with no author never joins a run', runsOf([{ id: 'a', created_at: t(0) }, { id: 'b', created_at: t(0) }])[1].first === true)

/* --- threads --- */
const root = { id: 'r', author_id: B, reply_count: 2, last_reply_at: '2026-09-22T10:00:00.000Z' }
ok('a thread carries its own count', threadOf(root, [], A).count === 2)
ok('a thread I wrote in is mine', threadOf(root, [{ author_id: A }], A).mine === true)
ok('a thread I only read is not', threadOf(root, [{ author_id: B }], A).mine === false)
ok('the root being mine puts me in the thread', threadOf({ ...root, author_id: A }, [], A).mine === true)

/* --- mentions: a token, never a name --- */
const body = 'have a look ' + writeMention(A) + ' and ' + writeMention(B) + ' and ' + writeMention(A)
ok('a mention is written as a token', writeMention(A) === '<@' + A + '>')
ok('every id once, in order', eq(mentionIds(body), [A, B]))
ok('a bare email is not a mention', eq(mentionIds('write to ada@example.com about it'), []))

/* ---- a bot is mentioned like anybody else, and is nobody's notification ---- */
{
  const said = 'morning <@bot:scribe> what did I miss, and ask <@' + A + '> too'
  ok('a bot a body names comes back by its slug', eq(botsMentioned(said), ['scribe']))
  ok('…once each, however often it is named', eq(botsMentioned('<@bot:scribe> and <@bot:scribe>'), ['scribe']))
  ok('…and nothing is a bot that is not one', eq(botsMentioned('<@' + A + '> hello'), []))
  /* THE POINT: naming a bot must never put a row in somebody's mentions */
  ok('naming a bot notifies nobody', eq(mentionIds(said), [A]))
  ok('and a bot is not the channel', mentionsChannel(said) === false)
  /* one grammar: what is typed becomes the token and comes back as what was typed */
  const picked = { 'The Scribe': BOT_PICK('scribe') }
  ok('a picked bot is written as its token', toTokens('hello @The Scribe', picked) === 'hello <@bot:scribe>')
  const back = fromTokens('hello <@bot:scribe>', { 'bot:scribe': 'The Scribe' })
  ok('…and read back as the name', back.text === 'hello @The Scribe' && back.picked['The Scribe'] === 'bot:scribe')
  ok('…and drawn as a mention while it is typed',
    mentionSpans('hi @The Scribe ok', picked).some((s) => s.kind === 'at' && s.text === '@The Scribe'))
  const parts = mentionParts('hi <@bot:scribe>', { 'bot:scribe': 'The Scribe' })
  ok('…and as a mention once it is sent', parts.some((x) => x.kind === 'mention' && x.name === 'The Scribe'))
}

/* ---- a role is a group you can name ---- */
{
  const said = 'morning <@role:coaches> — and <@' + A + '> too'
  ok('a role a body names comes back by its slug', eq(rolesMentioned(said), ['coaches']))
  ok('…once each', eq(rolesMentioned('<@role:coaches> <@role:coaches>'), ['coaches']))
  /* THE POINT: who holds a role is the database's answer. A client does not know and must not
     guess — so a role token is never counted as somebody's mention here. */
  ok('naming a group is not naming a person', eq(mentionIds(said), [A]))
  ok('…and a group is not a bot', eq(botsMentioned(said), []))
  ok('…and a bot is not a group', eq(rolesMentioned('<@bot:scribe>'), []))
  /* one grammar again: what is typed becomes the token and comes back as what was typed */
  const picked = { Coaches: ROLE_PICK('coaches') }
  ok('a picked group is written as its token', toTokens('hi @Coaches', picked) === 'hi <@role:coaches>')
  const back = fromTokens('hi <@role:coaches>', { 'role:coaches': 'Coaches' })
  ok('…and read back as its name', back.text === 'hi @Coaches' && back.picked.Coaches === 'role:coaches')
  ok('…and drawn as a mention once sent',
    mentionParts('hi <@role:coaches>', { 'role:coaches': 'Coaches' }).some((x) => x.kind === 'mention' && x.name === 'Coaches'))
}

/* ---- a bot's line is said, not announced ---- */
{
  const line = { kind: 'system', meta: { bot: 'scribe', name: 'The Scribe' }, body: 'Here is what you missed.' }
  const event = { kind: 'system', meta: { event: 'purchase-paid' } }
  const notice = { kind: 'system', meta: {} }
  ok('a bot line is from a bot and not an event', fromBot(line) && !fromEvent(line))
  ok('an event is an event and not a bot', fromEvent(event) && !fromBot(event))
  ok('a bot line is answered like anybody else\'s', canReply(line) && canReact(line))
  ok('a plain notice still is not', canReply(notice) === false)
  ok('and a withdrawn bot line is not', canReply({ ...line, deleted_at: 'x' }) === false)
}
ok('a plain at-name is not a mention', eq(mentionIds('ask @ada'), []))
ok('a malformed token is not a mention', eq(mentionIds('<@not-a-uuid>'), []))
ok('the channel is named by its own token', mentionsChannel('all hands ' + CHANNEL_MENTION) === true)
ok('the channel is not named by accident', mentionsChannel('the channel is quiet') === false)

const names = { [A]: 'Ada', [B]: 'Grace' }
const parts = mentionParts('hi ' + writeMention(A) + '!', names)
ok('a body is cut into text and mentions', eq(parts.map((p) => p.kind), ['text', 'mention', 'text']))
ok('a mention carries the name the caller knows', parts[1].name === 'Ada' && parts[1].id === A)
ok('an unknown id is not left as a uuid', mentionParts(writeMention('33333333-3333-4333-8333-333333333333'), names)[0].name === 'someone')
ok('the plain reading puts the name back', plainBody('hi ' + writeMention(A), names) === 'hi @Ada')
ok('a body with no mention is itself', plainBody('plain words') === 'plain words')

/* --- what notifies --- */
const msg = (extra = {}) => ({ id: 'm', author_id: B, created_at: '2026-09-22T11:00:00.000Z', ...extra })
ok('my own message never notifies me', notifies(msg({ author_id: A }), { me: A, notify: 'all', now }) === false)
ok('a withdrawn message never notifies', notifies(msg({ deleted_at: 'x' }), { me: A, notify: 'all', now }) === false)
ok('nothing means nothing', notifies(msg(), { me: A, notify: 'none', mentioned: true, now }) === false)
ok('a muted channel notifies nobody', notifies(msg(), { me: A, notify: 'mentions', mentioned: true, muted_until: '2026-09-23T00:00:00.000Z', now }) === false)
ok('everything means every message', notifies(msg(), { me: A, notify: 'all', now }) === true)
ok('by default a plain message does not notify', notifies(msg(), { me: A, notify: 'mentions', now }) === false)
ok('being named does', notifies(msg(), { me: A, notify: 'mentions', mentioned: true, now }) === true)
ok('a reply in a thread I am in does', notifies(msg({ thread_root_id: 'r' }), { me: A, notify: 'mentions', inThread: true, now }) === true)
ok('a reply in a thread I am not in does not', notifies(msg({ thread_root_id: 'r' }), { me: A, notify: 'mentions', inThread: false, now }) === false)
ok('the whole channel named by someone who may', notifies(msg(), { me: A, notify: 'mentions', mentionsChannel: true, mayMentionChannel: true, now }) === true)
ok('the whole channel named by someone who may not notifies nobody', notifies(msg(), { me: A, notify: 'mentions', mentionsChannel: true, mayMentionChannel: false, now }) === false)
ok('who may name the whole channel is the database to decide, and the client no longer pretends',
  mayMentionChannel({ mention: true }) && !mayMentionChannel({ mention: false }))

/* --- the rooms a sidebar shows --- */
{
  const N = { [A]: 'Ada', [B]: 'Grace', c: 'Kay', d: 'Lin' }
  const me = 'me'
  ok('a direct message with one person is their name', dmTitle([me, A], N, me) === 'Ada')
  ok('with two, both, in order', dmTitle([me, B, A], N, me) === 'Ada, Grace')
  ok('with more than three, the rest are counted', dmTitle([me, A, B, 'c', 'd'], N, me, { more: '+{n}' }) === 'Ada, Grace +2')
  ok('a room with nobody else has its own word, never a blank', dmTitle([me], N, me, { self: 'Just you' }) === 'Just you')
  ok('somebody with no name is not a blank either', dmTitle([me, 'x'], N, me, { someone: 'someone' }) === 'someone')

  /* which rooms are read by side rather than by author — the one place that decides it, because a
     rule kept in a template is true only while somebody is looking at that template */
  ok('a direct message is read by side', sidedRoom({ kind: 'dm' }) === true)
  ok('a channel is read by author, however few are in it', sidedRoom({ kind: 'channel' }) === false)
  ok('a forum is read by author too', sidedRoom({ kind: 'channel', mode: 'forum' }) === false)
  ok('and no room at all is not a side', sidedRoom(null) === false)

  /* WHAT CAN BE ANSWERED. A room the platform writes into is only useful if the writing can be
     talked about where it is: an order that failed is the start of a piece of work, and the place
     to do that work is a thread hanging off the line that announced it. */
  const order = { kind: 'system', meta: { event: 'purchase-paid', sku: 'a-book' } }
  const joined = { kind: 'system', meta: {} }
  const said = { kind: 'text', body: 'morning', author_id: 'a' }
  ok('a platform line about something that happened can be answered', canReply(order) === true)
  ok('…and reacted to, which is how somebody says they have it', canReact(order) === true)
  ok('the room\'s own housekeeping cannot: there is nothing to say back to it', canReply(joined) === false)
  ok('somebody\'s own message always can', canReply(said) === true)
  ok('a withdrawn line cannot', canReply({ ...said, deleted_at: new Date().toISOString() }) === false)
  ok('and what tells the two system lines apart is what the platform already put on the row',
    fromEvent(order) === true && fromEvent(joined) === false && fromEvent(said) === false)

  const chans = [
    { id: 'c1', space_id: 's', kind: 'channel', name: 'zebra' },
    { id: 'c2', space_id: 's', kind: 'channel', name: 'alpha' },
    { id: 'c3', space_id: 's', kind: 'dm', name: '' },
    { id: 'c4', space_id: 'other', kind: 'channel', name: 'elsewhere' },
  ]
  const rows = [{ channel: 'c1', starred: true }, { channel: 'c2' }, { channel: 'c3' }]
  const sec = railSections(chans, rows, 's')
  ok('a starred channel is in its own section', eq(sec.starred.map((c) => c.id), ['c1']))
  ok('the rest are channels, by name', eq(sec.channels.map((c) => c.name), ['alpha']))
  ok('a direct message is neither', eq(sec.dms.map((c) => c.id), ['c3']))
  ok('another space is not in this one', !JSON.stringify(sec).includes('elsewhere'))
  ok('a channel the reader has not joined is not a room of theirs', railSections([chans[0]], [], 's').channels.length === 1)

  ok('drafts are counted, and whitespace is not a draft', draftCount({ a: 'hi', b: '   ', c: '' }) === 1)
}

/* --- the search: chosen, never typed --- */
/* There is no query grammar: the words are the words, and who, where and when are controls. These
   check what a chosen narrowing asks the database for, and what the reader is shown it will do. */
ok('the spans are the ones offered', eq(RANGES, ['any', 'today', 'yesterday', 'last-7-days', 'last-30-days', 'this-year', 'custom']))
ok('a blank search narrows nothing', eq(blankQuery(), { text: '', from: null, in: null, range: 'any', after: null, before: null }))
ok('any span bounds nothing', eq(rangeDates('any', now), { after: null, before: null }))
ok('today begins at midnight', rangeDates('today', now).after === '2026-09-22T00:00:00.000Z')
ok('today has no upper bound', rangeDates('today', now).before === null)
ok('yesterday is one whole day', eq(rangeDates('yesterday', now), { after: '2026-09-21T00:00:00.000Z', before: '2026-09-22T00:00:00.000Z' }))
ok('seven days back is seven days back', rangeDates('last-7-days', now).after === '2026-09-15T00:00:00.000Z')
ok('this year begins in January', rangeDates('this-year', now).after === '2026-01-01T00:00:00.000Z')
ok('a custom span takes the picked days', eq(rangeDates('custom', now, { after: '2026-09-01', before: '2026-09-03' }), { after: '2026-09-01T00:00:00.000Z', before: '2026-09-04T00:00:00.000Z' }))
ok('the upper day is included whole', dayEnd('2026-09-03') === '2026-09-04T00:00:00.000Z')
ok('an unpicked day is nothing', dayStart('') === null && dayStart(null) === null)
ok('a nonsense day is nothing, never a wrong instant', dayStart('whenever') === null)

const q = { text: '  money  ', from: A, in: 'c1', range: 'last-7-days', after: null, before: null }
const args = queryArgs(q, now)
ok('the words are trimmed', args.q === 'money')
ok('who and where go as they were chosen', args.from === A && args.in === 'c1')
ok('the span is resolved to its instants', args.after === '2026-09-15T00:00:00.000Z' && args.before === null)
ok('nothing chosen is sent as null, never an empty string', eq(queryArgs(blankQuery(), now), { q: '', from: null, in: null, after: null, before: null }))
ok('a search with nothing in it is empty', emptyQuery(blankQuery()) === true)
ok('words alone are not empty', emptyQuery({ ...blankQuery(), text: 'money' }) === false)
ok('a narrowing alone is not empty', emptyQuery({ ...blankQuery(), from: A }) === false)
ok('the narrowings are counted for the button', narrowingCount(q) === 3 && narrowingCount(blankQuery()) === 0)
ok('a span counts once however many instants it makes', narrowingCount({ ...blankQuery(), range: 'yesterday' }) === 1)

const W = { words: 'words like “{q}”', from: 'from {who}', in: 'in {where}', 'range-last-7-days': 'in the last 7 days', join: ', ' }
const chips = chipsOf(q, W, { [A]: 'Ada', c1: '#general' })
ok('a chip per narrowing', eq(chips.map((c) => c.key), ['from', 'in', 'range']))
ok('a chip says it in words', chips[0].label === 'from Ada' && chips[1].label === 'in #general' && chips[2].label === 'in the last 7 days')
ok('a chip knows what to drop', eq(chips[0].clear, { from: null }) && eq(chips[2].clear, { range: 'any', after: null, before: null }))
ok('the search is said back plainly', describeQuery(q, W, { [A]: 'Ada', c1: '#general' }) === 'words like “money”, from Ada, in #general, in the last 7 days', describeQuery(q, W, { [A]: 'Ada', c1: '#general' }))
ok('an empty search says nothing', describeQuery(blankQuery(), W) === '')

/* --- writing one: a name in the box, a token on the wire --- */
const PICKED = { 'Sam Support': B, Sam: A, channel: CHANNEL_PICK }
ok('a name becomes its token', toTokens('hello @Sam Support have a look', PICKED) === 'hello <@' + B + '> have a look')
ok('the longest name wins, so a Sam does not eat a Sam Support',
  toTokens('@Sam Support and @Sam', PICKED) === '<@' + B + '> and <@' + A + '>')
ok('the channel is its own token', toTokens('@channel now', PICKED) === CHANNEL_MENTION + ' now')
ok('a name nobody picked is left as words', toTokens('hello @Nobody', PICKED) === 'hello @Nobody')
ok('an at-sign on its own is left alone', toTokens('email me @ noon', PICKED) === 'email me @ noon')
ok('nothing picked changes nothing', toTokens('plain words', {}) === 'plain words')

const back = fromTokens('hi <@' + B + '> and ' + CHANNEL_MENTION, { [B]: 'Sam Support' }, { channel: 'channel' })
ok('a token read back is the name again', back.text === 'hi @Sam Support and @channel', back.text)
ok('and what each name stood for is remembered', back.picked['Sam Support'] === B && back.picked.channel === CHANNEL_PICK)
ok('a draft goes out as it came in', toTokens(back.text, back.picked) === 'hi <@' + B + '> and ' + CHANNEL_MENTION)

const spans = mentionSpans('hi @Sam Support ok', PICKED)
ok('the pieces to draw are text, mention, text', eq(spans.map((x) => x.kind), ['text', 'at', 'text']), JSON.stringify(spans))
ok('a mention carries its words and who it is', spans[1].text === '@Sam Support' && spans[1].id === B)
ok('the pieces put back together are what was typed', spans.map((x) => x.text).join('') === 'hi @Sam Support ok')
ok('nothing to draw is one plain piece', eq(mentionSpans('plain', {}), [{ kind: 'text', text: 'plain' }]))
ok('an empty box draws nothing at all', eq(mentionSpans('', PICKED), []))
ok('a uuid is never what somebody sees', !spans.some((x) => /[0-9a-f]{8}-[0-9a-f]{4}/.test(x.text)))

/* --- who is about: a status is about a session, not about a person --- */
ok('a person with a tab that is here is here', statusOf([{ status: 'away' }, { status: 'active' }]) === 'active')
ok('not now beats away', statusOf([{ status: 'away' }, { status: 'dnd' }]) === 'dnd')
ok('nobody on the topic at all is away', statusOf([]) === 'away' && statusOf(null) === 'away')
ok('only the three are statuses', isStatus('active') && isStatus('dnd') && !isStatus('lunch'))
ok('a while with nobody touching anything reads as away', myStatus('active', now - AWAY_AFTER - 1000, now) === 'away')
ok('and anything at all reads as here', myStatus('active', now - 1000, now) === 'active')
ok('but somebody who said not now has not stopped meaning it by going quiet',
  myStatus('dnd', now - AWAY_AFTER - 1000, now) === 'dnd')
ok('nor somebody who said they were away', myStatus('away', now, now) === 'away')
ok('a status nobody recognises is read as here', myStatus('lunch', now, now) === 'active')

/* --- a member holds roles, plural, and the names are the site's --- */
ok('the slugs somebody holds are kept as they came', eq(rolesOf(['owner', 'founding-member']), ['owner', 'founding-member']))
ok('and never twice', eq(rolesOf(['owner', 'owner']), ['owner']))
ok('one word is read as a set', eq(rolesOf('moderator'), ['moderator']))
ok('nothing at all is an empty set, not an invented one', eq(rolesOf(null), []) && eq(rolesOf([]), []))
ok('a set is asked of', holdsRole(['member', 'host'], 'host') && !holdsRole(['member', 'host'], 'owner'))
/* the kit knows no role names at all: a site invents its own, and nothing here can disagree with it */
ok('a name the kit has never heard of is kept, because the names are not the kit\'s',
  eq(rolesOf(['founding-member', 'vip']), ['founding-member', 'vip']))

/* --- what somebody may do is the database's answer, carried on the counters --- */
ok('naming the whole channel follows the grant the counters carry', mayMentionChannel({ mention: true }) === true)
ok('and is refused where they carry none', mayMentionChannel({ mention: false }) === false)
ok('a row that says nothing about it is a no', mayMentionChannel({}) === false && mayMentionChannel(null) === false)


/* ------------------------------------------------------------------------------------------------
 * THE DECLARATION: a space is a file, and this is its grammar and its compile.
 *
 * The grammar round-trips (a file written by the admin parses back to what it was written from), and
 * the compile refuses everything that could not mean anything — which is the only thing standing
 * between a site's repository and a room nobody can explain.
 * ---------------------------------------------------------------------------------------------- */
{
  const { parseSpace, serialiseSpace, parseChannel, serialiseChannel, parseTarget, serialiseTarget, CAPABILITIES, EVENTS, slugOk, roleSlugOk, fillOf, fillOut, fillSets } = await import('./spaces-io.mjs')

  /* --- the targets: the one bit of grammar a file has --- */
  ok('everyone is the default target', eq(parseTarget(), { scope: 'everyone' }) && eq(parseTarget('everyone'), { scope: 'everyone' }))
  ok('a tier, a role and a purchase each parse', eq(parseTarget('tier:inner'), { scope: 'tier', tier: 'inner' })
    && eq(parseTarget('role:founder'), { scope: 'role', role: 'founder' })
    && eq(parseTarget('bought:guild-pass'), { scope: 'product', sku: 'guild-pass' }))
  ok('a target nobody has heard of is refused by name', parseTarget('wizard:merlin').scope === null && parseTarget('wizard:merlin').bad === 'wizard:merlin')
  ok('a target with nothing after the colon is refused', parseTarget('tier:').scope === null)
  for (const t of ['everyone', 'tier:inner', 'role:founder', 'bought:guild-pass']) {
    ok('a target written back is the target read in (' + t + ')', serialiseTarget(parseTarget(t)) === t)
  }
  /* a declaration names classes of people, never a person: there is no way to write one */
  ok('a file cannot name a person', parseTarget('user:11111111-1111-4111-8111-111111111111').scope === null)

  /* --- the space's file --- */
  const space = {
    name: 'The Guild', kind: 'community', published: true,
    discoverable: true, encrypted: true, cover: '', thumb: '', welcome: '', groups: ['Start here'],
    history: [{ days: 365, role: 'founder' }, { days: 60 }],
    group: 'Cohorts', position: 20, reactions: false, votes: true,
    join: { how: 'approve', form: 'intake', terms: 'Be kind.', question: 'Why?' },
    dms: false,
    fill: { tier: 'inner' },
    roles: [
      { slug: 'member', name: 'Member', rank: 0 },
      { slug: 'founder', name: 'Founding Member', colour: '#86613c', rank: 30, can: ['voice'] },
    ],
    flair: [{ slug: 'founding', name: 'Founding member', colour: '#86613c', icon: 'star', note: 'Here from the first week.', position: 0 }],
    grants: [{ capability: 'voice', to: 'bought:coaching-session', days: 7, note: 'a week with every call' }],
  }
  const text = serialiseSpace(space, 'What this place is.')
  const back = parseSpace(text)
  ok('a space round-trips through its file', eq(back.data, space) && back.content === 'What this place is.')
  ok('the file is frontmatter and a body, nothing invented', /^---\n/.test(text) && text.includes('What this place is.'))
  ok('an empty space reads as a published community with nothing in it',
    eq(parseSpace('---\nname: X\n---\n').data, { name: 'X', kind: 'community', published: true, discoverable: false, encrypted: false, cover: '', thumb: '', welcome: '', groups: [], history: [], group: '', position: 99, reactions: null, votes: null, join: { how: 'none' }, dms: true, fill: {}, roles: [], flair: [], grants: [] }))
  /* THE BADGES. What they are is the file's; who wears one never is — a declaration names classes
     of people and never a person, and "Ada is a founding member" is an act. */
  ok('a badge round-trips through its file', (() => {
    const fl = [{ slug: 'founding', name: 'Founding member', colour: '#86613c', icon: 'star', note: 'Here from the first week.', position: 0 }]
    return eq(parseSpace(serialiseSpace({ name: 'X', flair: fl }, '')).data.flair, fl)
  })())
  ok('a badge shown only on the card keeps that, and one shown everywhere writes nothing',
    parseSpace(serialiseSpace({ name: 'X', flair: [{ slug: 'a', name: 'A', inline: false }] }, '')).data.flair[0].inline === false
    && !/inline:/.test(serialiseSpace({ name: 'X', flair: [{ slug: 'a', name: 'A' }] }, '')))
  ok('a badge with no slug or no name is not a badge',
    parseSpace(serialiseSpace({ name: 'X', flair: [{ slug: 'a' }, { name: 'B' }, { slug: 'c', name: 'C' }] }, '')).data.flair.length === 1)
  ok('a space with no badges writes none', !/^flair:/m.test(serialiseSpace({ name: 'X' }, '')))

  /* THE DOOR. A space that opened none writes none and reads as none: the default must never be a
     way in, or a staff space grows a Join button the day somebody changes a default. */
  ok('a space with no door writes none, and reads as none', !/^join:/m.test(serialiseSpace({ name: 'X' }, '')) && parseSpace('---\nname: X\n---\n').data.join.how === 'none')
  ok('a door that is asked for round-trips whole', (() => {
    const j = { how: 'approve', form: 'intake', terms: 'Be kind.', question: 'Why?' }
    return eq(parseSpace(serialiseSpace({ name: 'X', join: j }, '')).data.join, j)
  })())
  ok('a door nobody named is not invented by a stray key', parseSpace(serialiseSpace({ name: 'X', join: { how: 'nonsense', terms: 'x' } }, '')).data.join.how === 'none')
  /* a space says where IT sits as well as where its rooms do; naming no heading is the common case
     and writes nothing, so a site with three spaces is not made to invent categories for them */
  ok('a space with no heading writes none', !/^group:/m.test(serialiseSpace({ name: 'X', kind: 'community' }, '')))
  ok('a history rule keeps its who and its days', (() => { const r = parseSpace(serialiseSpace({ name: 'X', history: [{ days: 60, tier: 'inner' }] }, '')).data.history; return r.length === 1 && r[0].days === 60 && r[0].tier === 'inner' })())
  ok('a history rule with no days at all is dropped rather than half-honoured', parseSpace(serialiseSpace({ name: 'X', history: [{ role: 'coach' }] }, '')).data.history.length === 0)
  ok('a space at the default place writes no position', !/^position:/m.test(serialiseSpace({ name: 'X', kind: 'community' }, '')))
  ok('unpublished survives the round trip', parseSpace(serialiseSpace({ ...space, published: false }, '')).data.published === false)

  /* --- a channel's file --- */
  /* null on either of the last two is "the file did not say", which is what makes the space's own
     answer reachable: a room that meant the default and a room that never thought about it write
     the same nothing, and the projection resolves both to the same answer. */
  const room = { name: 'Lounge', topic: 'Anything', mode: 'forum', visibility: 'private', published: true, order: 2, group: 'Start here', cover: '', thumb: '', hears: ['purchase.paid'], grants: [{ capability: 'voice', to: 'everyone' }], reactions: null, votes: true, fill: { tier: 'inner' } }
  ok('a channel round-trips through its file', eq(parseChannel(serialiseChannel(room, 'The room.')).data, room))
  ok('a bare channel is an open stream at the end of the list',
    eq(parseChannel('---\nname: X\n---\n').data, { name: 'X', topic: '', mode: 'stream', visibility: 'open', published: true, order: 99, group: '', cover: '', thumb: '', hears: [], grants: [], reactions: null, votes: null, fill: {} }))

  /* --- what a room takes besides words --- */
  ok('a room that says nothing says nothing, so its space may answer',
    !/^(reactions|votes):/m.test(serialiseChannel({ name: 'X' }, '')))
  ok('a room that turned voting on says so', /^votes: true$/m.test(serialiseChannel({ name: 'X', votes: true }, '')))
  ok('a room that turned reactions off says so', /^reactions: false$/m.test(serialiseChannel({ name: 'X', reactions: false }, '')))
  ok('and a space may set the default its rooms inherit', /^votes: true$/m.test(serialiseSpace({ name: 'X', votes: true }, '')))

  /* --- the slugs the database will take --- */
  ok('a slug is lower-case words joined by hyphens', slugOk('the-guild') && slugOk('a1') && roleSlugOk('founding-member'))
  ok('and nothing else', !slugOk('The Guild') && !slugOk('-guild') && !slugOk('the--guild') && !slugOk(''))

  /* --- the compile refuses what could not mean anything --- */
  const { compileSpaces } = await import('./spaces.mjs')
  const tmp = await import('node:fs')
  const os = await import('node:os')
  const pathm = await import('node:path')
  const root = tmp.mkdtempSync(pathm.join(os.tmpdir(), 'spaces-'))
  const put = (rel, body) => { tmp.mkdirSync(pathm.dirname(pathm.join(root, rel)), { recursive: true }); tmp.writeFileSync(pathm.join(root, rel), body) }
  const { gitStore } = await import('./store/index.mjs')
  /* a catalog of its own: what the site sells and what it books, which is what a fill, a grant and
     a "what is on" line are checked against. Without one those checks stand down, on purpose — a
     site with no store cannot be told it has the wrong tier. */
  put('supabase/functions/_shared/catalog.json', JSON.stringify({
    offers: {
      'guild-pass': { sku: 'guild-pass', key: 'aa11bb22', kind: 'good' },
      'inner-monthly': { sku: 'inner-monthly', key: 'cc33dd44', kind: 'membership', tier: 'inner' },
    },
    sessions: [{ slug: 'a-call' }],
  }))
  const quiet = async (fn) => { const e = console.error, l = console.log; let said = ''; console.error = (m) => { said += m }; console.log = () => {}; try { const r = await fn(); return { r, said } } finally { console.error = e; console.log = l; process.exitCode = 0 } }
  const compile = async () => quiet(() => compileSpaces({ store: gitStore(root), write: false }))

  put('content/spaces/guild.md', '---\nname: The Guild\nkind: community\n---\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\n---\n')
  let out = await compile()
  ok('a plain declaration compiles', !!out.r && out.r.length === 1 && out.r[0].channels.length === 1, out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nkind: coven\n---\n')
  out = await compile()
  ok('a kind the schema does not know is refused by name', out.r === null && /coven/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nroles:\n  - { slug: mod, name: One }\n  - { slug: mod, name: Two }\n---\n')
  out = await compile()
  ok('two roles with one slug are refused', out.r === null && /two roles are called "mod"/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\ngrants:\n  - { capability: voice, to: "role:ghost" }\n---\n')
  out = await compile()
  ok('a grant naming a role no space declares is refused', out.r === null && /role "ghost"/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\ngrants:\n  - { capability: telepathy, to: everyone }\n---\n')
  out = await compile()
  ok('a capability nobody has heard of is refused', out.r === null && /telepathy/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nfill: { bought: nothing-we-sell }\n---\n')
  out = await compile()
  ok('a fill naming an offer the site does not sell is refused', out.r === null && /nothing-we-sell/.test(out.said), out.said)

  /* WITH NO CATALOGUE THERE IS NOTHING TO CONTRADICT THE SKU. An Edge Function has no catalog file,
     so keyOf answers null for every sku — including ones the site really does sell. Unguarded, the
     compile refused a saved space with a message saying the opposite of the truth, and the whole
     build stopped. `sells` was passed into buildFill for this and was never read. */
  const noCat = async () => quiet(() => compileSpaces({ store: gitStore(root), write: false, catalog: {} }))

  put('content/spaces/guild.md', '---\nname: The Guild\nfill: { bought: working-hours }\n---\n')
  out = await noCat()
  ok('a purchase fill compiles where there is no catalogue to widen it',
    !!out.r && out.r[0].fill.product === 'working-hours', out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\ngrants:\n  - { capability: voice, to: "bought:working-hours" }\n---\n')
  out = await noCat()
  ok('and a grant on a purchase does too', !!out.r, out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nfill: { bought: nothing-we-sell }\n---\n')
  out = await compile()
  ok('while a site that HAS a catalogue still refuses an unknown sku',
    out.r === null && /nothing-we-sell/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nfill: { tier: no-such-tier }\n---\n')
  out = await compile()
  ok('a fill naming a tier no membership declares is refused', out.r === null && /no-such-tier/.test(out.said), out.said)

  /* --- a room's own rule, and the windows on a condition --- */
  const aRoom = (body) => { put('content/spaces/guild.md', '---\nname: The Guild\nfill: { tier: inner }\n---\n'); put('content/spaces/guild/lounge.md', '---\nname: Lounge\n' + body + '---\n') }

  aRoom('fill: { tier: inner }\n')
  out = await compile()
  ok('a room may be filled by a rule of its own', !!out.r && JSON.stringify(out.r[0].channels[0].fill) === '{"tier":"inner"}', out.said)

  aRoom('fill: { booking: a-call, withinNext: 7d }\n')
  out = await compile()
  ok('a window round a call compiles to minutes',
    !!out.r && out.r[0].channels[0].fill.within_next === 10080 && out.r[0].channels[0].fill.booking === 'a-call', out.said)

  aRoom('fill: { bought: guild-pass, withinLast: 12h }\n')
  out = await compile()
  ok('and a window on a purchase', !!out.r && out.r[0].channels[0].fill.within_last === 720, out.said)

  aRoom('fill: { booking: a-call, withinLast: soon }\n')
  out = await compile()
  ok('a span nobody can read is refused by name', out.r === null && /is not a span/.test(out.said), out.said)

  aRoom('fill: { tier: inner, withinLast: 7d }\n')
  out = await compile()
  ok('a window with nothing to hang on is refused', out.r === null && /a window needs something to hang on/.test(out.said), out.said)

  aRoom('fill: { bought: guild-pass, withinNext: 7d }\n')
  out = await compile()
  ok('withinNext on a purchase is refused — a purchase has no future', out.r === null && /still to come/.test(out.said), out.said)

  aRoom('fill: { booking: no-such-call, withinLast: 7d }\n')
  out = await compile()
  ok('a booking type the site has not got is refused', out.r === null && /is not a booking type/.test(out.said), out.said)

  /* NARROWER, NEVER WIDER: a room nobody in the space could enter is a room nothing would ever tell
     you about, which is the worst way to find a mistake */
  aRoom('fill: { tier: outer }\n')
  out = await compile()
  ok('a room no member of the space could enter is refused',
    out.r === null && /no member of this space could match/.test(out.said), out.said)

  aRoom('fill: { role: admin }\n')
  out = await compile()
  ok('but a room asking something unrelated is left alone rather than guessed at', !!out.r, out.said)

  put('content/spaces/guild/lounge.md', '---\nname: Lounge\n---\n')
  out = await compile()
  ok('a room with no rule of its own compiles as it always did', !!out.r && !Object.keys(out.r[0].channels[0].fill || {}).length, out.said)

  /* --- and the space's own switch for direct messages --- */
  put('content/spaces/guild.md', '---\nname: The Guild\n---\n')
  out = await compile()
  ok('a space has direct messages unless it says otherwise', !!out.r && out.r[0].dms === true, out.said)
  put('content/spaces/guild.md', '---\nname: The Guild\ndms: false\n---\n')
  out = await compile()
  ok('and a space may say it has none', !!out.r && out.r[0].dms === false, out.said)


  /* the same faults inside an alternative, named by which alternative they are in */
  put('content/spaces/guild.md', '---\nname: The Guild\nfill:\n  - { role: [admin] }\n  - { tier: no-such-tier }\n---\n')
  out = await compile()
  ok('a fault in one alternative is refused and says which', out.r === null && /no-such-tier/.test(out.said) && /fill\[2\]/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nfill:\n  - { role: [admin] }\n  - { role: [admin] }\n---\n')
  out = await compile()
  ok('two alternatives saying the same thing are refused', out.r === null && /same/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nfill:\n  - { role: [admin] }\n  - { entitlement: subscribed }\n---\n')
  out = await compile()
  ok('two real alternatives compile, and are carried as a list',
    out.r !== null && Array.isArray((out.r.find((s) => s.slug === 'guild') || {}).fill), JSON.stringify((out.r || []).find((s) => s.slug === 'guild')))

  put('content/spaces/guild.md', '---\nname: The Guild\ngrants:\n  - { capability: voice, to: "tier:no-such-tier" }\n---\n')
  out = await compile()
  ok('a grant naming one is refused too', out.r === null && /no-such-tier/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nfill: { bought: guild-pass }\ngrants:\n  - { capability: voice, to: "tier:inner" }\n---\n')
  out = await compile()
  ok('and the ones it does sell are taken', !!out.r && out.r[0].fill.product === 'aa11bb22' && out.r[0].grants.some((g) => g.tier === 'inner'), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\n---\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\nhears: [the.rapture]\n---\n')
  out = await compile()
  ok('an event no trigger sends is refused', out.r === null && /the\.rapture/.test(out.said), out.said)

  put('content/spaces/guild/lounge.md', '---\nname: Lounge\nmode: telepathic\n---\n')
  out = await compile()
  ok('a mode the schema does not know is refused', out.r === null && /telepathic/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\nwelcome: nowhere\n---\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\n---\n')
  out = await compile()
  ok('a welcome naming a room the space does not have is refused', out.r === null && /nowhere/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\ngroups: [Start here]\n---\n')
  out = await compile()
  ok('a heading with nothing under it is refused', out.r === null && /no room sits under/.test(out.said), out.said)

  put('content/spaces/guild.md', '---\nname: The Guild\n---\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\ngroup: Elsewhere\n---\n')
  out = await compile()
  ok('a room naming a heading its space does not declare is refused', out.r === null && /Elsewhere/.test(out.said), out.said)

  /* --- what the compile makes of a good one: rows the projection can write --- */
  put('content/spaces/guild.md', '---\nname: The Guild\nkind: server\ndiscoverable: true\nwelcome: lounge\ngroups: [The work]\nroles:\n  - { slug: founder, name: Founder, rank: 30, can: [voice, moderate] }\ngrants:\n  - { capability: voice, to: everyone }\n---\nWhat this place is.\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\ngroup: The work\nhears: [purchase.paid]\ngrants:\n  - { capability: mention-channel, to: "role:founder" }\n---\n')
  out = await compile()
  const g = out.r && out.r[0]
  ok('the space carries its body, its kind and its roles', !!g && g.kind === 'server' && g.about === 'What this place is.' && g.roles.length === 1, out.said)
  ok('a role\'s `can` becomes a grant of scope role', !!g && g.grants.some((x) => x.capability === 'voice' && x.scope === 'role' && x.role === 'founder'))
  ok('a space\'s `everyone` is scoped to the space', !!g && g.grants.some((x) => x.capability === 'voice' && x.scope === 'space' && x.channel === null))
  ok('a channel\'s grant carries its channel', !!g && g.grants.some((x) => x.capability === 'mention-channel' && x.channel === 'lounge'))
  ok('what a room hears is on the room', !!g && eq(g.channels[0].hears, ['purchase.paid']))
  put('content/spaces/guild.md', '---\nname: The Guild\nsessions: [a-call]\n---\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\n---\n')
  out = await compile()
  ok('a space that still lists sessions is refused by name (booking lives with coaching)', out.r === null && /sessions: a space no longer lists sessions/.test(out.said), out.said)

  ok('a community says it exists, points at a room and names its headings',
    !!g && g.discoverable === true && g.welcome === 'lounge' && eq(g.groups, ['The work'])
    && g.sessions === undefined && g.channels[0].group === 'The work')
  ok('moderating is a grant like any other, from a role a site invented',
    !!g && g.grants.some((x) => x.capability === 'moderate' && x.scope === 'role' && x.role === 'founder'))
  {
    const sql = tmp.readFileSync(new URL('../supabase/schemas/90-spaces.sql', import.meta.url), 'utf8')
    const said = (/space_grants_capability_check\" CHECK \(\(\"capability\" = ANY \(ARRAY\[([^\]]+)\]/.exec(sql) || [])[1] || ''
    const schema = [...said.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
    ok('every capability a file may give is one the schema knows, and no other',
      schema.length > 0 && eq(CAPABILITIES, schema), CAPABILITIES.join() + ' vs ' + schema.join())
  }
  ok('every event a room may hear is one a trigger sends', EVENTS.length === 5)
  tmp.rmSync(root, { recursive: true, force: true })
}

/* ---- a poll: the arithmetic, with no browser in it ---- */
{
  const poll = (opts, extra = {}) => ({ id: 'm1', kind: 'poll', body: 'Which book next?',
    meta: { poll: { options: opts, ...extra } }, poll_closed_at: null })
  const O = [{ key: 'a', text: 'The Kybalion' }, { key: 'b', text: 'As a Man Thinketh' }]
  const v = (k, u) => ({ message_id: 'm1', option_key: k, user_id: u })

  ok('a message that is not a poll has no tally', tallyPoll({ id: 'm1', kind: 'text', meta: {} }) === null)
  ok('nor one whose options are empty', tallyPoll(poll([])) === null)

  const none = tallyPoll(poll(O), [], 'me')
  ok('a poll nobody has voted in has no shares rather than NaN',
    none.options.every((o) => o.share === 0) && none.cast === 0 && !none.voted,
    JSON.stringify(none.options.map((o) => o.share)))

  const one = tallyPoll(poll(O), [v('a', 'u1'), v('a', 'u2'), v('b', 'u3')], 'u3')
  ok('every vote is counted once against its option', one.options[0].votes === 2 && one.options[1].votes === 1)
  ok('and a share is of the people who voted', Math.abs(one.options[0].share - 2 / 3) < 1e-9)
  ok('the reader sees which one is theirs', one.options[1].mine === true && one.options[0].mine === false && one.voted)
  ok('the option in front is marked, and only it', one.options[0].leads === true && one.options[1].leads === false)
  ok('a vote of another poll is not counted here',
    tallyPoll(poll(O), [v('a', 'u1'), { message_id: 'other', option_key: 'a', user_id: 'u9' }]).cast === 1)

  const many = tallyPoll(poll(O, { multi: true }), [v('a', 'u1'), v('b', 'u1')], 'u1')
  ok('a poll that takes several counts both of one person\'s answers', many.cast === 2 && many.people === 1)
  ok('and its shares are of the answers, not the people',
    Math.abs(many.options[0].share - 0.5) < 1e-9, JSON.stringify(many.options.map((o) => o.share)))
  ok('a single-answer poll shares out by people instead',
    Math.abs(tallyPoll(poll(O), [v('a', 'u1'), v('b', 'u2')]).options[0].share - 0.5) < 1e-9)

  ok('a closed poll says so', tallyPoll({ ...poll(O), poll_closed_at: '2026-09-23T00:00:00Z' }, []).closed === true)
  ok('and an open one does not', tallyPoll(poll(O), []).closed === false)
  ok('pollOf reads the options off the message', (pollOf(poll(O)) || {}).options.length === 2)
}


/* ---- a fill may offer alternatives, and any one of them is enough ---- */
{
  const { fillOf, fillOut, fillSets } = await import('./spaces-io.mjs')
  ok('one set is kept as a mapping, so nothing already written is rewritten',
    JSON.stringify(fillOf({ entitlement: 'subscribed' })) === '{"entitlement":"subscribed"}')
  ok('and a list of one is flattened to the same mapping',
    JSON.stringify(fillOf([{ entitlement: 'subscribed' }])) === '{"entitlement":"subscribed"}')
  ok('a list of two is kept as a list', Array.isArray(fillOf([{ entitlement: 'x' }, { role: ['admin'] }])))
  ok('an empty set is not an alternative', fillSets([{ entitlement: 'x' }, {}]).length === 1)
  ok('nor is a stray value', fillSets([{ role: ['admin'] }, 'nonsense', null]).length === 1)
  ok('nothing at all is no sets', fillSets(undefined).length === 0 && fillSets({}).length === 0)
  ok('what goes out is what came in', JSON.stringify(fillOut([{ a: 1 }, { b: 2 }])) === '[{"a":1},{"b":2}]'
    && JSON.stringify(fillOut([{ a: 1 }])) === '{"a":1}' && JSON.stringify(fillOut({})) === '{}')
}

/* ---- the emoji a room offers ---- */
{
  const seen = new Set()
  ok('nothing is offered twice', !ALL.some((e) => (seen.has(e.emoji) ? true : (seen.add(e.emoji), false))))
  ok('every one carries words to find it by', ALL.every((e) => e.words.trim().length > 2))
  /* searching is on the WORDS: nobody types 🔥 to find 🔥 */
  ok('a prefix finds it', emojiSearch('fi').some((e) => e.emoji === '🔥'))
  ok('every word must match, so a second word narrows',
    emojiSearch('well done').length < emojiSearch('well').length + 8 && emojiSearch('well done').every((e) => /well/.test(e.words) && /done/.test(e.words)))
  ok('a word nobody used finds nothing', emojiSearch('xyzzy').length === 0)
  ok('an empty search is everything', emojiSearch('').length > 0)
  /* what was reached for last, newest first and never twice */
  ok('the last one is first', remember(['a', 'b'], 'c')[0] === 'c')
  ok('…and is not there twice', remember(['a', 'b'], 'b').join('') === 'ba')
  ok('…and the list does not grow for ever', remember(new Array(30).fill(0).map((_, i) => 'e' + i), 'x').length === 16)
  ok('nothing is not remembered', remember(['a'], '').join('') === 'a')
}

/* ---- the keyboard ---- */
{
  const ev = (key, o = {}) => ({ key, metaKey: !!o.mod, ctrlKey: false, shiftKey: !!o.shift, altKey: !!o.alt })
  ok('the shortcut to what is unread', commandOf(ev('a', { mod: true, shift: true })) === 'unreads')
  ok('and to the rooms above and below', commandOf(ev('ArrowDown', { alt: true })) === 'next-room')
  ok('…and to the unread ones', commandOf(ev('ArrowDown', { alt: true, shift: true })) === 'next-unread')
  /* THE PLATFORM'S OWN KEYS STAY THE PLATFORM'S: every shortcut carries shift for this reason */
  ok('⌘A is still select-all', commandOf(ev('a', { mod: true })) === null)
  ok('a bare letter is a letter', commandOf(ev('a')) === null)
  /* TYPING IS NOT A SHORTCUT */
  ok('? outside a box opens the map', commandOf(ev('?')) === 'help')
  ok('…and inside one is a question mark', commandOf(ev('?'), { typing: true }) === null)
  ok('but Escape closes wherever you are', commandOf(ev('Escape'), { typing: true }) === 'close')
  ok('a combination still works while typing', commandOf(ev('a', { mod: true, shift: true }), { typing: true }) === 'unreads')
  ok('a box is where a letter is a letter', isTyping({ tagName: 'TEXTAREA' }) && isTyping({ isContentEditable: true }) && !isTyping({ tagName: 'DIV' }))
  /* every shortcut is written down exactly once, in the list the handler reads */
  ok('every shortcut says itself', KEYS.every((k) => sayKey(k).length > 0))
  ok('and no two are the same press',
    new Set(KEYS.map((k) => [k.mod, k.alt, k.shift, k.key].join('|'))).size === KEYS.length)

  /* moving through the rooms wraps, and can be told to skip the ones with nothing in them */
  const rooms = [{ id: 'a' }, { id: 'b', hot: true }, { id: 'c' }, { id: 'd', hot: true }]
  ok('down goes to the next', stepRoom(rooms, 'a', 1) === 'b')
  ok('…and wraps at the end', stepRoom(rooms, 'd', 1) === 'a')
  ok('up wraps the other way', stepRoom(rooms, 'a', -1) === 'd')
  ok('with a rule, only those count', stepRoom(rooms, 'b', 1, { only: (r) => r.hot }) === 'd')
  ok('…and from a room the rule excludes, it starts at one end', stepRoom(rooms, 'a', 1, { only: (r) => r.hot }) === 'b')
  ok('nowhere to go is nowhere', stepRoom([], 'a', 1) === null)
}

/* ---- when "later" is ---- */
{
  const monNoon = Date.parse('2026-06-01T12:00:00')     /* a Monday */
  const keys = (at) => offers(at).map((o) => o.key)
  ok('an hour is always offered', keys(monNoon)[0] === 'hour')
  ok('…and it is an hour away', offers(monNoon)[0].when.getTime() === monNoon + 3600e3)
  ok('at noon, this evening is still to come', keys(monNoon).includes('evening'))
  /* at nine at night it is not, and offering a time in the past is the bug this prevents */
  ok('at nine at night it is not', !keys(Date.parse('2026-06-01T21:00:00')).includes('evening'))
  ok('tomorrow morning is nine', offers(monNoon).find((o) => o.key === 'morning').when.getHours() === 9)
  /* in the small hours, "morning" is THIS morning: somebody awake at three means today */
  ok('in the small hours, morning is today',
    offers(Date.parse('2026-06-03T03:00:00')).find((o) => o.key === 'morning').when.getDate() === 3)
  /* on a Monday, "Monday" is the one coming, never the one this morning */
  const mon = offers(monNoon).find((o) => o.key === 'monday').when
  ok('on a Monday, Monday is next week', mon.getTime() > monNoon && mon.getDay() === 1)
  /* two offers for the same moment is noise: on a Sunday night tomorrow morning IS Monday */
  const sun = keys(Date.parse('2026-06-07T22:00:00'))
  ok('a Sunday night offers one of them, not both', sun.filter((k) => k === 'morning' || k === 'monday').length === 1)
  ok('and every offer is in the future', offers(monNoon).every((o) => o.when.getTime() > monNoon))

  ok('the past is not schedulable', !usable(new Date(monNoon - 1000), monNoon))
  ok('nor a year and a day away', !usable(new Date(monNoon + 400 * 86400e3), monNoon))
  ok('nor nonsense', !usable('when I feel like it', monNoon))
  ok('but this evening is', usable(new Date(monNoon + 6 * 3600e3), monNoon))
  /* the field wants the reader's own zone, not UTC — a message set for nine must not go at ten */
  ok('the field says the local time', fieldValue(new Date(2026, 5, 1, 9, 5)) === '2026-06-01T09:05')
  ok('and nothing of nothing', fieldValue('not a date') === '')
}

/* ---- the room as a person reads it ----
   What a bot is handed and what a person sees must be the one thing. The bug this pins: a room of
   platform lines (a purchase, somebody joining) has body null on every row, so "the messages with a
   body" is an empty room — which is how a bot came to say it could not see the conversation at all. */
{
  const words = { 'purchase-paid': { line: 'A purchase: {sku} — {amount}.' }, unknown: { line: 'Something happened.' } }
  const money = (v) => '$' + ((Number(v) || 0) / 100).toFixed(2)
  const names = { u1: 'Ada' }
  const ev = { kind: 'system', body: null, meta: { event: 'purchase-paid', sku: 'server-pass', amount: 2000 } }
  ok('a platform line says what it means', saidIn(ev, { names, words, money }) === 'A purchase: server-pass — $20.00.')
  ok('…even with no body of its own', !ev.body)
  ok('an event nobody worded falls back', saidIn({ kind: 'system', meta: { event: 'nope' } }, { words }) === 'Something happened.')
  ok("a bot own words are its own words", saidIn({ kind: 'system', body: 'Here it is.', meta: { bot: 'scribe' } }, { words }) === 'Here it is.')
  ok('a voice note is what was heard', saidIn({ kind: 'voice', transcript: 'a minute of it' }) === 'a minute of it')
  ok('a file is its name', saidIn({ kind: 'file', attachment_name: 'invoice.pdf' }) === 'invoice.pdf')
  ok('a poll is its question', saidIn({ kind: 'poll', title: 'Thursday or Friday?' }) === 'Thursday or Friday?')
  ok('a withdrawn line says nothing', saidIn({ kind: 'text', body: 'oops', deleted_at: 'now' }) === '')
  const uu = '11111111-2222-4333-8444-555555555555'
  ok('a mention is read as the name', saidIn({ kind: 'text', body: 'ask <@' + uu + '>' }, { names: { [uu]: 'Ada' } }) === 'ask @Ada')
  ok('a title rides with the body', saidIn({ kind: 'text', title: 'Printer', body: 'still down' }) === 'Printer — still down')

  ok('a line is said by its author', saidBy({ author_id: 'u1' }, names) === 'Ada')
  ok('…or by the name the row carries', saidBy({ meta: { name: 'The Scribe' } }, names) === 'The Scribe')
  ok('…and by somebody when it has neither', saidBy({}, names) === 'someone')

  const room = roomAsProse([
    ev,
    { kind: 'text', body: 'Chasing the printer.', author_id: 'u1' },
    { kind: 'text', body: 'thanks', deleted_at: 'now', author_id: 'u1' },
  ], { names, words, money })
  ok('a notice is a notice, not something somebody said', room.split('\n')[0] === 'A purchase: server-pass — $20.00.')
  ok('…and a person is named', room.split('\n')[1] === 'Ada: Chasing the printer.')
  ok('a room of platform lines is not an empty room', roomAsProse([ev, ev], { words, money }).split('\n').length === 2)
  ok('and nothing withdrawn is handed on', !room.includes('thanks'))
  ok('the last of a long room is what is kept', roomAsProse(
    Array.from({ length: 80 }, (_, i) => ({ kind: 'text', body: 'n' + i, author_id: 'u1' })), { names, limit: 3 })
    === 'Ada: n77\nAda: n78\nAda: n79')
}

/* ---- WHICH LINES A BOT IS GIVEN ----
   A bot summoned inside a thread is answering the thread. Handing it the channel gives it
   everything except the exchange it is in, so a follow-up arrives with no sign of what it follows
   up — and a reader who opened the thread directly has no channel list loaded at all, so the
   context is not merely wrong but empty. Both were live. */
{
  const chan = [{ id: 'c1', kind: 'text', body: 'channel one' }, { id: 'c2', kind: 'text', body: 'channel two' }]
  const thread = { root: { id: 't0', kind: 'text', body: 'the question' }, replies: [{ id: 't1', kind: 'text', body: 'the answer' }] }

  const inCh = roomFor({ messages: chan, thread, threadRoot: null })
  ok('outside a thread the bot gets the channel', !inCh.inThread && inCh.lines.length === 2)
  ok('\u2026and not the thread\u2019s replies', !inCh.lines.some((m) => m.id === 't1'))

  const inTh = roomFor({ messages: chan, thread, threadRoot: 't0' })
  ok('in a thread the bot gets the thread', inTh.inThread, JSON.stringify(inTh.lines.map((m) => m.id)))
  ok('\u2026opening message first', inTh.lines[0].id === 't0')
  ok('\u2026and every reply', inTh.lines.some((m) => m.id === 't1'))
  ok('\u2026and none of the channel around it', !inTh.lines.some((m) => String(m.id).startsWith('c')))

  /* the case that produced an empty context: the thread was opened directly, so nothing else loaded */
  const cold = roomFor({ messages: [], thread, threadRoot: 't0' })
  ok('a thread opened cold still has its own words', cold.lines.length === 2)

  /* a threadRoot naming a thread that is not the open one is not that thread */
  ok('a stale root falls back to the channel', !roomFor({ messages: chan, thread, threadRoot: 'other' }).inThread)
  ok('and no thread at all is the channel', !roomFor({ messages: chan }).inThread)
  ok('nothing of nothing', roomFor({}).lines.length === 0)
}

/* ---- a desk has two sides and no names, and its messages are not all text ----
   A support message of kind voice or file has body NULL by the table's own check. The desk built
   its transcript from `body` and filtered out anything short, so every voice note and every
   attachment was dropped: a customer who sends a photo and says nothing was, to the bot, an empty
   conversation. */
{
  const msgs = [
    { kind: 'text', body: 'Do you ship to Japan?', mine: false },
    { kind: 'file', body: null, attachment_name: 'damaged-spine.jpg', mine: false },
    { kind: 'voice', body: null, mine: false },
    { kind: 'text', body: 'Let me check.', mine: true },
  ]
  const said = roomAsProse(msgs, { who: (m) => (m.mine ? 'Us' : 'Them'), unheard: 'sent a voice note' })
  const lines = said.split('\n')
  ok('a side may be the speaker', lines[0] === 'Them: Do you ship to Japan?', said)
  ok('an attachment is in the transcript', said.includes('damaged-spine.jpg'))
  ok('a voice note nobody transcribed still happened', said.includes('sent a voice note'))
  ok('both sides are there', lines[3] === 'Us: Let me check.')
  ok('every line survived', lines.length === 4, String(lines.length))
  /* and with no word for it, an untranscribed note is simply not spoken for */
  ok('nothing is invented for it', !roomAsProse([msgs[2]], { who: () => 'Them' }))
}

/* ---- A HEADING MADE OF A MESSAGE ----
   A forum card showed body.slice(0, 80), which cuts mid-word and leaves the markdown in — so a
   bot's answer became "**Breakthrough co" and "you'll need to contact th". */
{
  const T = (b, o) => titleOf({ body: b }, {}, o)
  ok('a first sentence is the heading', T('**Breakthrough coaching.** You identify where you are.') === 'Breakthrough coaching.')
  ok('\u2026with the marks gone', !T('**Bold.** rest').includes('*'))
  ok('a short line is itself', T('Do you ship to Japan?') === 'Do you ship to Japan?')
  const long = T('A single very long line with no sentence ending at all that simply keeps going and going past the limit')
  ok('a long line is cut', long.endsWith('\u2026'), long)
  /* the cut lands where the source has a space, so no word is sliced in half */
  {
    const src = 'A single very long line with no sentence ending at all that simply keeps going and going past the limit'
    const kept = long.slice(0, -1)
    ok('\u2026on a word, never through one', src.startsWith(kept) && (src.length === kept.length || src[kept.length] === ' '), JSON.stringify(kept))
  }
  ok('\u2026and within the limit', long.length <= 81, String(long.length))
  ok('a very long first sentence does not become the whole heading',
    T('x'.repeat(200) + '. next') .endsWith('\u2026'))
  ok('nothing of nothing', T('') === '' && titleOf() === '')
  ok('a mention reads as a name', T('ask <@11111111-2222-4333-8444-555555555555> about it') === 'ask @someone about it')
}

/* ---- and a bot is called by its name, everywhere ----
   The thread pane said "The Scribe"; the forum card beside it said "someone", because it looked the
   author up by id and a bot has none. */
{
  const bot = { kind: 'system', body: 'Here it is.', meta: { bot: 'scribe', name: 'The Scribe' } }
  ok('a bot post is attributed to the bot', saidBy(bot, {}, 'someone') === 'The Scribe')
  ok('a person is still attributed by id', saidBy({ author_id: 'u1' }, { u1: 'Ada' }, 'someone') === 'Ada')
  ok('and somebody unknown is somebody', saidBy({ author_id: 'zz' }, {}, 'someone') === 'someone')
}

/*
 * EVERY GLYPH ASKED FOR EXISTS. SpaceIcon draws a path by name and an unknown name draws NOTHING —
 * silently, in the shape of a control with an empty hole where its picture should be. Three were
 * found that way, all of them live: the Events row of the rail, the back button on an event, and
 * the muted-microphone mark on somebody in a call. None of them throws, none of them logs, and a
 * screenshot is the only thing that would ever have shown them.
 *
 * So it is a check rather than a habit. It reads the set out of the component and every name the
 * workspace asks for out of its templates, which is why it is here and not in a snapshot.
 */
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const HERE = dirname(fileURLToPath(import.meta.url))
  const dir = join(HERE, '..', '..', 'movable-types', 'src', 'components', 'spaces')
  let art = ''
  try { art = readFileSync(join(dir, 'SpaceIcon.vue'), 'utf8') } catch { /* no theme in this checkout */ }
  if (!art) { ok('the icon set is where it was', false, 'SpaceIcon.vue not found') }
  else {
    const known = new Set([...art.matchAll(/^ {2}'?([a-z][a-z0-9-]*)'?:/gm)].map((m) => m[1]))
    ok('the icon set is read', known.size > 20, String(known.size))
    const missing = []
    for (const file of readdirSync(dir).filter((x) => x.endsWith('.vue'))) {
      const src = readFileSync(join(dir, file), 'utf8')
      for (const m of src.matchAll(/(?:SpaceIcon[^>]*?name=|icon:\s*)['"]([a-z][a-z0-9-]*)['"]/g)) {
        if (!known.has(m[1])) missing.push(m[1] + ' (' + file + ')')
      }
    }
    ok('every glyph the workspace asks for is one the set has', !missing.length, missing.join(', '))
  }
}

console.log('\nspaces: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
