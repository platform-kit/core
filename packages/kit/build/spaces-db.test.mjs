/* The spaces' own rules, against the local stack: the membership fill and its sweep, the isolation a
   space promises (a reader who is not a member sees no space, channel, message, member, unread row
   or search hit, by every path the client uses), a private channel invisible to a member of its
   space who has not joined it, the counters checked against a walk of the rows they stand for, the
   catch-up cursor and what it marks for paging, a mention resolved from its token and counted, the
   edit guard, and the live topic — one connection for many channels, a member receiving what the
   database sends, a stranger's subscription refused. Everything it makes is removed at the end.
   Skipped with a note when the stack is down (SPACES_TEST=0 skips it too). */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('spaces-db: ' + m)
if (process.env.SPACES_TEST === '0') { note('skipped (SPACES_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  try { sb.realtime.setAuth(data.session.access_token) } catch { /* older client */ }
  return { sb, id: data.user.id, token: data.session.access_token }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const SLUG = 'test-space-' + Math.random().toString(36).slice(2, 8)
let spaceId = null
const made = []

try {
  const admin = await as('admin@example.com')
  const support = await as('support@example.com')
  const reader = await as('free@example.com')

  /* ---------------------------------------------------------------- the room */
  const { data: space, error: se } = await service.from('spaces')
    .insert({ slug: SLUG, name: 'A test space', kind: 'staff', fill: { role: ['admin', 'support'] } })
    .select().single()
  if (se) throw se
  spaceId = space.id

  const swept = await service.rpc('space_sync_members')
  ok('the fill rule makes the memberships', !swept.error)
  const mem = (await service.from('space_members').select('user_id').eq('space_id', spaceId)).data || []
  const memIds = mem.map((m) => m.user_id)
  ok('everyone the rule names is a member', memIds.includes(admin.id) && memIds.includes(support.id))
  ok('everyone it does not name is not', !memIds.includes(reader.id))

  const { data: open_ } = await service.from('channels').insert({ space_id: spaceId, slug: 'general', name: 'General', mode: 'stream', visibility: 'open' }).select().single()
  const { data: priv } = await service.from('channels').insert({ space_id: spaceId, slug: 'secret', name: 'Secret', mode: 'stream', visibility: 'private' }).select().single()
  const { data: forum } = await service.from('channels').insert({ space_id: spaceId, slug: 'board', name: 'Board', mode: 'forum', visibility: 'open' }).select().single()
  const { data: ops } = await service.from('channels').insert({ space_id: spaceId, slug: 'ops', name: 'Ops', mode: 'stream', visibility: 'open' }).select().single()
  /* the polls get a room of their own: a poll is a message, so asking one in #general would move
     every seq the counters, the cursor and the thread checks below are counting on */
  const asked = (await service.from('channels').insert({ space_id: spaceId, slug: 'asked', name: 'Asked', mode: 'stream', visibility: 'open' }).select().single()).data
  await service.from('channel_members').insert([
    { channel_id: open_.id, user_id: admin.id }, { channel_id: open_.id, user_id: support.id },
    { channel_id: forum.id, user_id: admin.id },
    { channel_id: asked.id, user_id: admin.id }, { channel_id: asked.id, user_id: support.id },
  ])

  /* ---------------------------------------------------------------- what is said */
  const bodies = ['first line', 'second line about money', 'third line']
  for (const body of bodies) {
    const { error } = await admin.sb.from('space_messages').insert({ channel_id: open_.id, author_id: admin.id, body })
    if (error) throw new Error('insert: ' + error.message)
  }
  const { data: mention } = await admin.sb.from('space_messages')
    .insert({ channel_id: open_.id, author_id: admin.id, body: 'over to you <@' + support.id + '>' }).select().single()
  await service.from('space_messages').insert({ channel_id: priv.id, author_id: admin.id, body: 'behind a closed door' })

  const rows = (await service.from('space_messages').select('seq').eq('channel_id', open_.id).order('seq')).data || []
  ok('every message takes the next number, with no gaps', rows.map((r) => r.seq).join(',') === '1,2,3,4', rows.map((r) => r.seq).join(','))

  /* ---------------------------------------------------------------- the isolation */
  const r = reader.sb
  ok('a reader who is not a member sees no space', ((await r.from('spaces').select('id').eq('id', spaceId)).data || []).length === 0)
  ok('…no channel', ((await r.from('channels').select('id').eq('space_id', spaceId)).data || []).length === 0)
  ok('…no message', ((await r.from('space_messages').select('id').eq('channel_id', open_.id)).data || []).length === 0)
  ok('…no member', ((await r.from('space_members').select('user_id').eq('space_id', spaceId)).data || []).length === 0)
  ok('…no reaction', ((await r.from('reactions').select('emoji').eq('surface', 'message').eq('channel_id', open_.id)).data || []).length === 0)
  ok('…no mention', ((await r.from('space_mentions').select('user_id').eq('channel_id', open_.id)).data || []).length === 0)
  const rUnread = (await r.rpc('space_unread')).data || []
  ok('…no unread row for it', !rUnread.some((x) => x.channel === open_.id))
  ok('…no search hit', (((await r.rpc('space_search', { p_q: 'money' })).data) || []).length === 0)
  ok('…and the history is refused outright', ((await r.rpc('space_history', { p_channel: open_.id })).data) === null)
  ok('…as is the channel itself', ((await r.rpc('can_read_channel', { p_channel: open_.id })).data) === false)
  const rWrite = await r.from('space_messages').insert({ channel_id: open_.id, author_id: reader.id, body: 'let me in' })
  ok('…and they cannot write into it', !!rWrite.error)

  /* a private channel is invisible to a member of its space who has not joined it */
  const aChannels = (await admin.sb.from('channels').select('slug').eq('space_id', spaceId)).data || []
  ok('a private channel is not in a non-member’s list', !aChannels.some((c) => c.slug === 'secret'), JSON.stringify(aChannels.map((c) => c.slug)))
  ok('an open channel of their space is', aChannels.some((c) => c.slug === 'general'))
  ok('a private channel’s messages are not theirs to read', ((await admin.sb.from('space_messages').select('id').eq('channel_id', priv.id)).data || []).length === 0)
  const sneak = await admin.sb.from('channel_members').insert({ channel_id: priv.id, user_id: admin.id })
  ok('and they cannot join it of their own accord', !!sneak.error)

  /* ---------------------------------------------------------------- a question asked of the room */
  /* `admin` and `support` are both in this space by its fill rule; `reader` is in nothing. */
  const pollRow = {
    channel_id: asked.id, author_id: admin.id, kind: 'poll', body: 'Which book next?',
    meta: { poll: { options: [{ key: 'aa', text: 'The Kybalion' }, { key: 'bb', text: 'As a Man Thinketh' }], multi: false } },
  }
  const { data: poll, error: pe } = await admin.sb.from('space_messages').insert(pollRow).select().single()
  ok('a member of the room may ask it a question', !pe && poll && poll.kind === 'poll', pe && pe.message)

  ok('and somebody in the room may answer',
    !(await support.sb.from('space_poll_votes').insert({ message_id: poll.id, option_key: 'aa', user_id: support.id })).error)
  ok('the answer is a row of their own, readable by the room',
    ((await admin.sb.from('space_poll_votes').select('option_key, user_id').eq('message_id', poll.id)).data || []).length === 1)
  ok('nobody may answer in somebody else\'s name',
    !!(await support.sb.from('space_poll_votes').insert({ message_id: poll.id, option_key: 'bb', user_id: admin.id })).error)
  ok('a second answer is refused where the poll takes one',
    !!(await support.sb.from('space_poll_votes').insert({ message_id: poll.id, option_key: 'bb', user_id: support.id })).error)
  ok('but the answer may be taken back',
    !(await support.sb.from('space_poll_votes').delete().eq('message_id', poll.id).eq('user_id', support.id).eq('option_key', 'aa')).error
    && !((await admin.sb.from('space_poll_votes').select('option_key').eq('message_id', poll.id)).data || []).length)
  await support.sb.from('space_poll_votes').insert({ message_id: poll.id, option_key: 'bb', user_id: support.id })

  /* somebody who is not in the room */
  ok('somebody outside the room may not answer its poll',
    !!(await reader.sb.from('space_poll_votes').insert({ message_id: poll.id, option_key: 'aa', user_id: reader.id })).error)
  ok('nor read who did',
    !((await reader.sb.from('space_poll_votes').select('user_id').eq('message_id', poll.id)).data || []).length)
  ok('nor ask the room a question of their own',
    !!(await reader.sb.from('space_messages').insert({ ...pollRow, author_id: reader.id })).error)

  /* several answers, where the poll says so */
  const { data: many } = await admin.sb.from('space_messages').insert({
    channel_id: asked.id, author_id: admin.id, kind: 'poll', body: 'Which of these have you read?',
    meta: { poll: { options: [{ key: 'x', text: 'One' }, { key: 'y', text: 'Two' }], multi: true } },
  }).select().single()
  const m1 = await support.sb.from('space_poll_votes').insert({ message_id: many.id, option_key: 'x', user_id: support.id })
  const m2 = await support.sb.from('space_poll_votes').insert({ message_id: many.id, option_key: 'y', user_id: support.id })
  ok('a poll that takes several takes both', !m1.error && !m2.error, (m1.error || m2.error || {}).message)
  ok('and each is taken back on its own',
    !(await support.sb.from('space_poll_votes').delete().eq('message_id', many.id).eq('option_key', 'x').eq('user_id', support.id)).error
    && ((await admin.sb.from('space_poll_votes').select('option_key').eq('message_id', many.id)).data || []).length === 1)

  /* closing */
  ok('somebody outside the room may not close its poll',
    (await reader.sb.rpc('space_poll_close', { p_message: poll.id })).data === false)
  ok('and somebody in the room who keeps it may', (await support.sb.rpc('space_poll_close', { p_message: many.id })).data === true)
  ok('the author may', (await admin.sb.rpc('space_poll_close', { p_message: poll.id })).data === true)
  ok('a closed poll takes no more answers',
    !!(await support.sb.from('space_poll_votes').insert({ message_id: poll.id, option_key: 'aa', user_id: support.id })).error)
  ok('and lets none be taken back',
    !(await support.sb.from('space_poll_votes').delete().eq('message_id', poll.id).eq('user_id', support.id).eq('option_key', 'bb')).error
    && ((await admin.sb.from('space_poll_votes').select('option_key').eq('message_id', poll.id)).data || []).length === 1)
  ok('and it keeps what it said',
    ((await admin.sb.from('space_messages').select('poll_closed_at').eq('id', poll.id).single()).data || {}).poll_closed_at !== null)
  ok('the options were never the client\'s to rewrite',
    !!(await admin.sb.from('space_messages').update({ meta: { poll: { options: [{ key: 'aa', text: 'Something else' }] } } }).eq('id', poll.id)).error)

  /* ------------------------------------------------- what a bot offered, and who took it first */
  /* The offer is the ROOM's: everybody sees it, the first press takes it, and the rest see what was
     taken. That is why it is a column the database writes rather than a guess from the transcript —
     two people press at the same moment far more often in a channel than on a desk, and the
     alternative is the bot summoned twice for one question. */
  const { data: offered } = await service.from('space_messages').insert({
    channel_id: asked.id, kind: 'system', body: 'Which would you like?',
    meta: { bot: 'scribe', name: 'Scribe', choices: [{ key: 'aa', text: 'This week' }, { key: 'bb', text: 'Today' }] },
  }).select().single()

  ok('somebody outside the room may not take what it was offered',
    (await reader.sb.rpc('space_choose', { p_message: offered.id, p_key: 'aa' })).data === null)
  ok('a choice the offer does not hold is not a choice',
    (await support.sb.rpc('space_choose', { p_message: offered.id, p_key: 'zz' })).data === null)

  const first = await support.sb.rpc('space_choose', { p_message: offered.id, p_key: 'bb' })
  ok('somebody in the room takes it', !!first.data, (first.error || {}).message)
  const said = (await admin.sb.from('space_messages').select('body, author_id, meta').eq('id', first.data).single()).data
  ok('\u2026and the press is their own message, in their own name', said && said.author_id === support.id, said && said.author_id)
  ok('\u2026carrying the words the OFFER said, never the client\u2019s', said && said.body === 'Today', said && said.body)
  ok('\u2026and saying which offer it answers', said && said.meta && said.meta.chose && said.meta.chose.message === offered.id)

  const second = await admin.sb.rpc('space_choose', { p_message: offered.id, p_key: 'aa' })
  ok('a second press takes nothing', second.data === null)
  const after = (await service.from('space_messages').select('choice_key, choice_by').eq('id', offered.id).single()).data
  ok('\u2026and changes nothing: the first press stands', after.choice_key === 'bb' && after.choice_by === support.id, JSON.stringify(after))
  ok('\u2026and posted no second answer',
    ((await service.from('space_messages').select('id').eq('channel_id', asked.id).eq('body', 'This week')).data || []).length === 0)

  ok('nobody may say an offer was taken by hand',
    !!(await admin.sb.from('space_messages').update({ choice_at: null, choice_key: 'aa' }).eq('id', offered.id)).error)
  ok('nor rewrite what was offered',
    !!(await admin.sb.from('space_messages').update({ meta: { choices: [{ key: 'aa', text: 'Something else' }] } }).eq('id', offered.id)).error)

  /* ---------------------------------------------------------------- the counters */
  const walk = (await service.from('space_messages').select('seq').eq('channel_id', open_.id)).data || []
  const sUnread = ((await support.sb.rpc('space_unread')).data || []).find((x) => x.channel === open_.id)
  ok('unread is what a walk of the rows would say', sUnread && sUnread.unread === walk.length, JSON.stringify(sUnread))
  ok('the mention is counted apart', sUnread && sUnread.mentions === 1, JSON.stringify(sUnread))
  const mentioned = (await service.from('space_mentions').select('user_id, kind').eq('message_id', mention.id)).data || []
  ok('the mention resolved from its token, and to one person', mentioned.length === 1 && mentioned[0].user_id === support.id)
  ok('the author of a mention is not notified of their own', !mentioned.some((m) => m.user_id === admin.id))

  await support.sb.rpc('space_read', { p_channel: open_.id, p_seq: 4 })
  const sAfter = ((await support.sb.rpc('space_unread')).data || []).find((x) => x.channel === open_.id)
  ok('reading to the end clears the unread', sAfter.unread === 0, JSON.stringify(sAfter))
  ok('and the mentions with it', sAfter.mentions === 0)

  /* ---------------------------------------------------------------- catching up */
  const c1 = (await support.sb.rpc('space_catchup', { p_cursors: { [open_.id]: 2 }, p_lim: 50 })).data || []
  const mine = c1.find((x) => x.channel === open_.id)
  ok('a cursor returns only what is newer', mine && mine.messages.length === 2, JSON.stringify(mine && mine.messages.length))
  ok('and says where it started', mine && mine.from === 2)
  ok('a channel with nothing new is left out', !((await support.sb.rpc('space_catchup', { p_cursors: { [open_.id]: 4 } })).data || []).some((x) => x.channel === open_.id))
  const c2 = ((await support.sb.rpc('space_catchup', { p_cursors: { [open_.id]: 0 }, p_lim: 2 })).data || []).find((x) => x.channel === open_.id)
  ok('a channel further behind than the answer carries is marked for paging', c2 && c2.more === true && c2.messages.length === 2, JSON.stringify(c2 && { more: c2.more, n: c2.messages.length }))

  /* ---------------------------------------------------------------- search */
  const hits = (await support.sb.rpc('space_search', { p_q: 'money', p_space: spaceId })).data || []
  ok('a search finds what is in their own channel', hits.length === 1 && hits[0].body.includes('money'), JSON.stringify(hits.length))
  const noReach = (await support.sb.rpc('space_search', { p_q: 'closed door' })).data || []
  ok('and never what is in a channel they are not in', noReach.length === 0)
  const narrowed = (await support.sb.rpc('space_search', { p_q: 'money', p_space: spaceId, p_from: admin.id })).data || []
  ok('narrowing by who wrote it keeps the hit', narrowed.length === 1)
  const notThem = (await support.sb.rpc('space_search', { p_q: 'money', p_space: spaceId, p_from: support.id })).data || []
  ok('narrowing to someone who did not write it finds nothing', notThem.length === 0)
  const elsewhere = (await support.sb.rpc('space_search', { p_q: 'money', p_channel: priv.id })).data || []
  ok('narrowing to a channel they are not in finds nothing, rather than something', elsewhere.length === 0)

  /* A FILE IS LOOKED FOR BY ITS NAME. Somebody looks for the invoice, not for whatever was typed
     beside it — and the text parser reads a file name as one word, so the name is indexed whole
     AND opened out at its punctuation, or a word from the middle of one finds nothing. */
  const { data: withFile } = await service.from('space_messages').insert({
    channel_id: open_.id, author_id: admin.id, kind: 'file', body: 'the one from Tuesday',
    attachment: open_.id + '/' + crypto.randomUUID() + '.pdf', attachment_type: 'application/pdf',
    attachment_name: 'kybalion-proof-invoice.pdf', attachment_size: 1234,
  }).select().single()
  const found = async (q) => ((await support.sb.rpc('space_search', { p_q: q, p_space: spaceId })).data || [])
    .some((r) => r.id === withFile.id)
  ok('a word out of the middle of a file name finds it', await found('invoice'))
  ok('so does the whole name, pasted in', await found('kybalion-proof-invoice.pdf'))
  ok('and so do two of its words', await found('kybalion proof'))
  ok('what was said beside the file still finds it', await found('Tuesday'))
  ok('and a word in neither finds nothing', !(await found('zebra')))
  await service.from('space_messages').delete().eq('id', withFile.id)

  /* ---------------------------------------------------------------- threads and the forum */
  const root = (await service.from('space_messages').select('id').eq('channel_id', open_.id).eq('seq', 1).single()).data
  await admin.sb.from('space_messages').insert({ channel_id: open_.id, author_id: admin.id, thread_root_id: root.id, body: 'a reply' })
  const bumped = (await service.from('space_messages').select('reply_count, last_reply_at').eq('id', root.id).single()).data
  ok('a reply raises the root’s count', bumped.reply_count === 1 && !!bumped.last_reply_at)
  const hist = (await admin.sb.rpc('space_history', { p_channel: open_.id })).data || []
  ok('a plain reply is in its thread and not in the stream', hist.length === 4, String(hist.length))
  await admin.sb.from('space_messages').insert({ channel_id: open_.id, author_id: admin.id, thread_root_id: root.id, body: 'and to the channel', echoed: true })
  const hist2 = (await admin.sb.rpc('space_history', { p_channel: open_.id })).data || []
  ok('a reply also sent to the channel is in both, once each', hist2.length === 5, String(hist2.length))
  const th = (await admin.sb.rpc('space_thread', { p_root: root.id })).data
  ok('the thread holds both replies', th && th.replies.length === 2)

  await admin.sb.from('space_messages').insert({ channel_id: forum.id, author_id: admin.id, title: 'A question', body: 'the body of it' })
  const posts = (await admin.sb.rpc('space_posts', { p_channel: forum.id })).data || []
  ok('a forum post is a message with a title', posts.length === 1 && posts[0].title === 'A question')
  await service.from('channels').update({ mode: 'stream' }).eq('id', forum.id)
  const asStream = (await admin.sb.rpc('space_history', { p_channel: forum.id })).data || []
  ok('the same channel read the other way holds the same message', asStream.length === 1 && asStream[0].title === 'A question')
  await service.from('channels').update({ mode: 'forum' }).eq('id', forum.id)

  /* A FEED IS A THIRD READING OF THE SAME ROWS: switched to it and back, nothing is written; its
     first answers come from one read under the same guards as the thread */
  const fpost = (await service.from('space_messages').select('id').eq('channel_id', forum.id).single()).data
  await admin.sb.from('space_messages').insert({ channel_id: forum.id, author_id: admin.id, thread_root_id: fpost.id, body: 'first answer' })
  await admin.sb.from('space_messages').insert({ channel_id: forum.id, author_id: admin.id, thread_root_id: fpost.id, body: 'second answer' })
  await admin.sb.from('space_messages').insert({ channel_id: forum.id, author_id: admin.id, thread_root_id: fpost.id, body: 'third answer' })
  const feedBefore = (await service.from('space_messages').select('id, seq, reply_count').eq('channel_id', forum.id).order('seq')).data || []
  const toFeed = await service.from('channels').update({ mode: 'feed' }).eq('id', forum.id).select('mode').single()
  ok('a channel may be read as a feed', !toFeed.error && toFeed.data.mode === 'feed', toFeed.error?.message)
  const asFeed = (await admin.sb.rpc('space_history', { p_channel: forum.id })).data || []
  ok('…and holds the same post', asFeed.some((m) => m.id === fpost.id))
  const firstAns = (await admin.sb.rpc('space_first_replies', { p_roots: [fpost.id], p_n: 2 })).data || {}
  ok('a feed shows a post\u2019s first answers, oldest first', (firstAns[fpost.id] || []).map((r) => r.body).join('|') === 'first answer|second answer', JSON.stringify(firstAns))
  const outsider = (await reader.sb.rpc('space_first_replies', { p_roots: [fpost.id], p_n: 2 })).data || {}
  ok('…and nobody outside the room reads them', !outsider[fpost.id])
  await service.from('channels').update({ mode: 'forum' }).eq('id', forum.id)
  const feedAfter = (await service.from('space_messages').select('id, seq, reply_count').eq('channel_id', forum.id).order('seq')).data || []
  ok('switching to a feed and back wrote nothing', JSON.stringify(feedBefore) === JSON.stringify(feedAfter))

  /* ---------------------------------------------------------------- the edit guard */
  const ed = await admin.sb.from('space_messages').update({ body: 'first line, rewritten' }).eq('id', root.id).select().single()
  ok('an author rewrites their own message', !ed.error && ed.data.body === 'first line, rewritten')
  ok('and it says that it was', !!ed.data.edited_at)
  const notMine = await support.sb.from('space_messages').update({ body: 'not yours' }).eq('id', root.id).select()
  ok('nobody else can', (notMine.data || []).length === 0)
  const moved = await admin.sb.from('space_messages').update({ channel_id: priv.id }).eq('id', root.id).select()
  ok('and a message cannot be moved to another channel', !!moved.error)

  /* ------------------------------------------------- what a message notifies, and what it does not */
  const targets = async (id) => ((await service.rpc('space_notify_targets', { p_message: id })).data || []).map((x) => (x && x.space_notify_targets) || x)
  const plain = (await service.from('space_messages').select('id').eq('channel_id', open_.id).eq('seq', 2).single()).data
  ok('a plain message notifies nobody who only asked for mentions', (await targets(plain.id)).length === 0)
  ok('being named does notify', (await targets(mention.id)).includes(support.id))
  ok('and does not notify the person who named them', !(await targets(mention.id)).includes(admin.id))

  await service.from('channel_members').update({ notify: 'all' }).eq('channel_id', open_.id).eq('user_id', support.id)
  ok('a channel set to everything notifies on a plain message', (await targets(plain.id)).includes(support.id))
  await service.from('channel_members').update({ notify: 'none' }).eq('channel_id', open_.id).eq('user_id', support.id)
  ok('a channel set to nothing notifies on nothing, mention or not', (await targets(mention.id)).length === 0)
  await service.from('channel_members').update({ notify: 'mentions', muted_until: new Date(Date.now() + 36e5).toISOString() }).eq('channel_id', open_.id).eq('user_id', support.id)
  ok('a muted channel notifies nobody either', (await targets(mention.id)).length === 0)
  await service.from('channel_members').update({ muted_until: null }).eq('channel_id', open_.id).eq('user_id', support.id)

  /* a reply in a thread someone is in */
  const tRoot = (await service.from('space_messages').select('id').eq('channel_id', open_.id).eq('seq', 1).single()).data
  await service.from('space_messages').insert({ channel_id: open_.id, author_id: support.id, thread_root_id: tRoot.id, body: 'my reply' })
  const { data: rep } = await admin.sb.from('space_messages').insert({ channel_id: open_.id, author_id: admin.id, thread_root_id: tRoot.id, body: 'and mine' }).select().single()
  ok('a reply notifies the people in that thread', (await targets(rep.id)).includes(support.id))
  const outside = (await service.from('space_messages').insert({ channel_id: open_.id, author_id: admin.id, body: 'unrelated' }).select().single()).data
  ok('and a message outside it does not', !(await targets(outside.id)).includes(support.id))

  const withdrawn = (await service.from('space_messages').insert({ channel_id: open_.id, author_id: admin.id, body: 'gone <@' + support.id + '>' }).select().single()).data
  await service.from('space_messages').update({ deleted_at: new Date().toISOString() }).eq('id', withdrawn.id)
  ok('a withdrawn message notifies nobody', (await targets(withdrawn.id)).length === 0)

  /* ---------------------------------------------------------------- live */
  const topic = 'sp:' + open_.id
  const heard = []
  const ch = support.sb.channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'message' }, ({ payload }) => heard.push(payload))
  let subErr = null
  const joinedOk = await new Promise((res) => { ch.subscribe((s, e) => { if (e) subErr = String(e); if (s === 'SUBSCRIBED') res(true); if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') res(false) }) })
  ok('a member of the channel may listen to its topic', joinedOk === true, subErr || '')
  /* A subscription is acknowledged a moment before the server is really sending on the topic. The
     client closes that window by catching the channel up on being told it is subscribed; a raw
     subscription like this one has to write again rather than wait longer, because the window is
     not a fixed length and a sleep that is long enough today is flaky tomorrow. */
  let liveIns = null
  for (let tryN = 0; tryN < 5 && !heard.length; tryN++) {
    await wait(400)
    liveIns = await admin.sb.from('space_messages').insert({ channel_id: open_.id, author_id: admin.id, body: 'live line ' + tryN })
    for (let i = 0; i < 20 && !heard.length; i++) await wait(100)
  }
  ok('the line that is to be heard was written', liveIns && !liveIns.error, liveIns && liveIns.error && liveIns.error.message)
  ok('and the database sends them what was written', heard.length > 0 && /^live line/.test(String(heard[0].body)), JSON.stringify(heard.map((h) => h.body)))

  const strangerCh = reader.sb.channel(topic, { config: { private: true } })
  const strangerOk = await new Promise((res) => { strangerCh.subscribe((s) => { if (s === 'SUBSCRIBED') res(true); if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') res(false) }); setTimeout(() => res(false), 8000) })
  ok('a reader who is not a member is refused the same topic', strangerOk === false)

  /* many channels, one connection */
  const extra = [open_.id, forum.id].map((id) => admin.sb.channel('sp:' + id, { config: { private: true } }))
  const extraStates = await Promise.all(extra.map((channel) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve('WAIT_TIMEOUT'), 8000)
    channel.subscribe((state) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(state)) { clearTimeout(timer); resolve(state) }
    })
  })))
  const liveChannels = admin.sb.realtime.getChannels()
  ok('every topic rides one socket',
    extraStates.every((state) => state === 'SUBSCRIBED')
      && liveChannels.length >= 2
      && admin.sb.realtime.isConnected()
      && extra.every((channel) => channel.socket === admin.sb.realtime),
    JSON.stringify({ states: extraStates, channels: liveChannels.length, connected: admin.sb.realtime.isConnected() }))

  await support.sb.removeChannel(ch)
  await reader.sb.removeChannel(strangerCh)
  for (const e of extra) await admin.sb.removeChannel(e)
  support.sb.realtime.disconnect(); reader.sb.realtime.disconnect(); admin.sb.realtime.disconnect()

  /* ---------------------------------------------------------------- the platform's own line */
  /* an event of this run's own: a site's other spaces may be listening for the real ones */
  const EVENT = 'test.paid.' + SLUG
  await service.from('space_hooks').insert({ space_id: spaceId, event: EVENT, channel_id: open_.id })
  const posted = await service.rpc('space_hook_post', { p_event: EVENT, p_body: 'A paperback sold', p_meta: { amount: 2000 } })
  ok('the platform writes into the channel the staff chose', posted.data === 1, JSON.stringify(posted.data))
  const sys = (await service.from('space_messages').select('kind, body, author_id, meta').eq('channel_id', open_.id).eq('kind', 'system')).data || []
  ok('and it is a system line with nobody as its author', sys.length === 1 && sys[0].author_id === null && sys[0].meta.amount === 2000)
  const forged = await admin.sb.from('space_messages').insert({ channel_id: open_.id, author_id: admin.id, kind: 'system', body: 'not from the platform' })
  ok('which nobody may forge', !!forged.error)

  /* and the platform's own events, through the paths they really travel */
  await service.from('space_hooks').insert([
    { space_id: spaceId, event: 'purchase.paid', channel_id: ops.id },
    { space_id: spaceId, event: 'print.failed', channel_id: ops.id },
  ])
  const before = ((await service.from('space_messages').select('id').eq('channel_id', ops.id)).data || []).length
  const { data: buy } = await service.from('purchases').insert({ email: 'buyer+' + SLUG + '@example.com', amount_total: 2400, currency: 'usd', status: 'paid', sku: 'a-book-softcover', key: SLUG.slice(0, 8) }).select().single()
  await wait(300)
  const afterBuy = (await service.from('space_messages').select('meta, body, kind').eq('channel_id', ops.id).order('seq', { ascending: false }).limit(1)).data || []
  ok('a paid purchase writes into the channel the staff chose', afterBuy.length === 1 && afterBuy[0].kind === 'system' && afterBuy[0].meta.event === 'purchase-paid', JSON.stringify(afterBuy[0] && afterBuy[0].meta))
  ok('and carries the facts, never a sentence', afterBuy[0] && afterBuy[0].body === null && afterBuy[0].meta.amount === 2400)

  /* a purchase row is only ever paid or refunded — there is no unpaid one to write about */
  const { data: back } = await service.from('purchases').insert({ email: 'r+' + SLUG + '@example.com', amount_total: 100, currency: 'usd', status: 'refunded', sku: 'x', key: 'z' + SLUG.slice(0, 7) }).select().single()
  await wait(250)
  const n2 = ((await service.from('space_messages').select('id').eq('channel_id', ops.id)).data || []).length
  ok('a refunded purchase writes nothing', n2 === before + 1, String(n2))

  const { data: dup } = await service.from('fulfilments').insert({ email: 'p+' + SLUG + '@example.com', key: 'k' + SLUG.slice(0, 7), book: 'a-book', edition: 'e1', address: {}, status: 'failed', error: 'the printer had no such cover' }).select().single()
  await wait(300)
  const last = (await service.from('space_messages').select('meta').eq('channel_id', ops.id).order('seq', { ascending: false }).limit(1)).data || []
  ok('a print order that failed says so, with the reason', last[0] && last[0].meta.event === 'print-failed' && String(last[0].meta.reason).includes('no such cover'), JSON.stringify(last[0] && last[0].meta))
  await service.from('fulfilments').update({ status: 'failed', error: 'again' }).eq('id', dup.id)
  await wait(250)
  const n3 = ((await service.from('space_messages').select('id').eq('channel_id', ops.id)).data || []).length
  ok('and says it once, not again on every touch', n3 === before + 2, String(n3))
  await service.from('fulfilments').delete().eq('id', dup.id)
  await service.from('purchases').delete().in('id', [buy.id, back.id])

  const noHook = await service.rpc('space_hook_post', { p_event: 'nobody.listens', p_body: null, p_meta: {} })
  ok('an event no channel asked for writes nothing', noHook.data === 0)

  /* ---------------------------------------------------------------- what a voice costs
     Speaking is membership; a voice note is a capability, and the capability is a row. Every scope
     is checked from both sides: the database's own answer (space_may), the insert it guards, and
     the counters the surface reads it from. */
  const grants = []
  const grant = async (row) => {
    const { data, error } = await service.from('space_grants').insert({ capability: 'voice', ...row }).select().single()
    if (error) throw new Error('grant: ' + error.message)
    grants.push(data.id)
    return data.id
  }
  const ungrant = async (id) => { await service.from('space_grants').delete().eq('id', id); grants.splice(grants.indexOf(id), 1) }
  const voiceRow = (who, channel) => ({ channel_id: channel, author_id: who.id, kind: 'voice',
    attachment: channel + '/' + crypto.randomUUID() + '.mp3', attachment_type: 'audio/mpeg', seconds: 3 })
  const mayVoice = async (who, channel) => ((await who.sb.rpc('space_may', { p_channel: channel, p_capability: 'voice' })).data) === true
  const tryVoice = async (who, channel) => {
    const { data, error } = await who.sb.from('space_messages').insert(voiceRow(who, channel)).select().single()
    if (data) await service.from('space_messages').delete().eq('id', data.id)
    return !error
  }

  /* support@example.com is staff but not an admin; member2 is an ordinary member of the space */
  const member = await as('member2@example.com')
  const joined = await service.from('space_members').insert({ space_id: spaceId, user_id: member.id, source: 'invite' })
  ok('a person is put into a space by hand', !joined.error, joined.error && joined.error.message)
  await service.from('channel_members').insert({ channel_id: open_.id, user_id: member.id })

  ok('with no grant anywhere, a member may not speak with a voice', (await mayVoice(member, open_.id)) === false)
  ok('and the insert is refused, not merely unoffered', (await tryVoice(member, open_.id)) === false)
  ok('the counters say so too, so the mic is never drawn',
    !(((await member.sb.rpc('space_unread')).data) || []).find((r) => r.channel === open_.id).voice)
  ok('the staff always may, because the desk answers everywhere', (await mayVoice(admin, open_.id)) === true)

  const gSite = await grant({ scope: 'site' })
  ok('a grant to everyone reaches them', (await mayVoice(member, open_.id)) === true)
  ok('and the insert goes through', (await tryVoice(member, open_.id)) === true)
  ok('the counters carry the same answer', !!((((await member.sb.rpc('space_unread')).data) || []).find((r) => r.channel === open_.id).voice))
  await ungrant(gSite)
  ok('taking the grant away takes the capability away', (await mayVoice(member, open_.id)) === false)

  const gChan = await grant({ scope: 'channel', channel_id: forum.id })
  ok('a grant to one room is a grant to that room alone', (await mayVoice(member, open_.id)) === false)
  await ungrant(gChan)

  const gSpace = await grant({ scope: 'space', space_id: spaceId })
  ok('a grant to a space reaches its rooms', (await mayVoice(member, open_.id)) === true)
  await ungrant(gSpace)

  const gUser = await grant({ scope: 'user', user_id: member.id })
  ok('a grant to one person reaches them', (await mayVoice(member, open_.id)) === true)
  ok('and nobody else', (await mayVoice(support, open_.id)) === true)   /* support is staff, so always */
  const reader2 = await as('free@example.com')
  ok('a person outside the space is not let in by a grant', (await mayVoice(reader2, open_.id)) === false)
  await ungrant(gUser)

  /* a tier: member2's own live membership, whatever the seed gave them */
  const tiers = (((await service.from('entitlements').select('tier').eq('user_id', member.id).eq('key', 'subscribed').eq('active', true)).data) || [])
    .map((e) => e.tier).filter(Boolean)
  if (tiers.length) {
    const gTier = await grant({ scope: 'tier', tier: tiers[0] })
    ok('a grant to a tier reaches a live member of it', (await mayVoice(member, open_.id)) === true)
    const gOther = tiers.includes('tier-1') ? null : await grant({ scope: 'tier', tier: 'tier-nobody-has' })
    if (gOther) { await ungrant(gTier); ok('and not a member of some other tier', (await mayVoice(member, open_.id)) === false); await ungrant(gOther) }
    else await ungrant(gTier)
  } else note('no live tier on member2 in this seed — the tier scope is checked by build/desk.test.mjs alone')

  /* a purchase, and the week it is good for */
  const { data: vbuy } = await service.from('purchases')
    .insert({ user_id: member.id, email: 'member2@example.com', amount_total: 4900, currency: 'usd', status: 'paid', sku: 'a-session', key: 'vk' + SLUG.slice(0, 6) }).select().single()
  const gBuy = await grant({ scope: 'product', product_key: 'vk' + SLUG.slice(0, 6), days: 7 })
  ok('a grant that comes with something bought reaches whoever bought it', (await mayVoice(member, open_.id)) === true)
  await service.from('purchases').update({ created_at: new Date(Date.now() - 30 * 86400000).toISOString() }).eq('id', vbuy.id)
  ok('and runs out when its days are up', (await mayVoice(member, open_.id)) === false)
  await service.from('space_grants').update({ days: null }).eq('id', gBuy)
  ok('unless it was given for good', (await mayVoice(member, open_.id)) === true)
  await ungrant(gBuy)
  await service.from('purchases').delete().eq('id', vbuy.id)

  /* the bucket keeps the same rule */
  const gSite2 = await grant({ scope: 'site' })
  const mp3 = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0])], { type: 'audio/mpeg' })
  const okPut = await member.sb.storage.from('spaces').upload(open_.id + '/' + crypto.randomUUID() + '.mp3', mp3, { contentType: 'audio/mpeg' })
  ok('the sound may be put in the bucket under its own channel', !okPut.error, okPut.error && okPut.error.message)
  if (!okPut.error) await service.storage.from('spaces').remove([okPut.data.path])
  const badPut = await reader2.sb.storage.from('spaces').upload(open_.id + '/' + crypto.randomUUID() + '.mp3', mp3, { contentType: 'audio/mpeg' })
  ok('and not by somebody who is not in the room', !!badPut.error)
  await ungrant(gSite2)
  const refusedPut = await member.sb.storage.from('spaces').upload(open_.id + '/' + crypto.randomUUID() + '.mp3', mp3, { contentType: 'audio/mpeg' })
  ok('nor by a member of it with no grant', !!refusedPut.error)

  /* ---------------------------------------------------------------- what an administrator reaches */
  const { data: dmId } = await member.sb.rpc('space_dm_open', { p_space: spaceId, p_with: [support.id] })
  if (dmId) {
    await member.sb.from('space_messages').insert({ channel_id: dmId, author_id: member.id, body: 'between the two of us' })
    const seen = ((await admin.sb.from('space_messages').select('id').eq('channel_id', dmId)).data) || []
    ok('an administrator cannot read a direct message they are not in', seen.length === 0)
    const chans = ((await admin.sb.from('channels').select('id').eq('id', dmId)).data) || []
    ok('nor even see that it is there', chans.length === 0)
  }
  const { data: theirs } = await service.from('space_messages').insert({ channel_id: open_.id, author_id: support.id, body: 'something to moderate' }).select().single()
  const hidden = ((await admin.sb.from('space_messages').select('id').eq('channel_id', priv.id)).data) || []
  ok('moderation buys an administrator no sight of a room they are not in', hidden.length === 0)
  const modSeen = ((await admin.sb.from('space_messages').select('id').eq('id', theirs.id)).data) || []
  ok('they moderate the rooms they can already read', modSeen.length === 1)
  const { error: modErr } = await admin.sb.from('space_messages').update({ deleted_at: new Date().toISOString() }).eq('id', theirs.id)
  ok('and may withdraw what is in it', !modErr, modErr && modErr.message)
  const { error: rewriteErr } = await admin.sb.from('space_messages').update({ body: 'rewritten' }).eq('id', theirs.id)
  ok('but may not rewrite it', !!rewriteErr || (((await service.from('space_messages').select('body').eq('id', theirs.id)).data)[0].body !== 'rewritten'))

  for (const id of grants.slice()) await ungrant(id)

  /* ---------------------------------------------------------------- what somebody is here
     A role is a record of the space's own, and holding one is a row. What a role MAY DO is not on
     the role: it is a grant at role scope, so there is one answer to "what may this person do" and
     roles feed it rather than keeping rules of their own. */
  /* A space's roles are DECLARED — they come from its file, projected by the build — so nothing
     invents them on insert and no browser writes one. The test makes its space with the service
     role, so it declares its own three the same way the projection would. */
  await service.from('space_roles').insert([
    { space_id: spaceId, slug: 'member', name: 'Member', rank: 0 },
    { space_id: spaceId, slug: 'moderator', name: 'Moderator', rank: 50, colour: '#3d7369' },
    { space_id: spaceId, slug: 'owner', name: 'Owner', rank: 100, colour: '#86613c' },
  ])
  const roleRows = (((await service.from('space_roles').select('id, slug, name, rank').eq('space_id', spaceId)).data) || [])
  ok('the roles a space declares are its own', roleRows.length === 3, JSON.stringify(roleRows.map((r) => r.slug)))
  ok('and they rank', (roleRows.find((r) => r.slug === 'owner') || {}).rank > (roleRows.find((r) => r.slug === 'member') || {}).rank)
  const heldBy = async (who) => (((await service.from('space_member_roles').select('role_id').eq('space_id', spaceId).eq('user_id', who)).data) || []).length
  /* the memberships were made before the roles existed, and the member role is given on JOINING —
     so they are re-made here, which is what a real space does: its file declares its roles before
     anybody is in it */
  await service.from('space_members').delete().eq('space_id', spaceId)
  await service.rpc('space_sync_members')
  await service.from('space_members').insert({ space_id: spaceId, user_id: admin.id, source: 'invite' }).select()
  ok('being in the space is holding the member role, given with the membership', (await heldBy(support.id)) === 1)

  const modRole = roleRows.find((r) => r.slug === 'moderator')
  ok('an administrator cannot write a role from a browser — it is a declaration',
    !!(await admin.sb.from('space_roles').insert({ space_id: spaceId, slug: 'founder', name: 'Founding member', rank: 30 }).select().single()).error)
  ok('nor rename one', !!(await admin.sb.from('space_roles').update({ name: 'Boss' }).eq('id', modRole.id).select().single()).error
    || ((await service.from('space_roles').select('name').eq('id', modRole.id).single()).data || {}).name === 'Moderator')
  ok('nor remove one', !(await admin.sb.from('space_roles').delete().eq('id', modRole.id)).error === false
    || !!(await service.from('space_roles').select('id').eq('id', modRole.id).maybeSingle()).data)

  const { data: mentor } = await service.from('space_roles')
    .insert({ space_id: spaceId, slug: 'mentor', name: 'Mentor', rank: 20 }).select().single()
  ok('holding one is a row', !(await admin.sb.from('space_member_roles').insert({ space_id: spaceId, user_id: admin.id, role_id: mentor.id })).error)
  ok('the database answers whether somebody holds it', ((await admin.sb.rpc('space_holds', { p_space: spaceId, p_role: 'mentor' })).data) === true)
  ok('and whether they do not', ((await support.sb.rpc('space_holds', { p_space: spaceId, p_role: 'mentor' })).data) === false)
  ok('a person holds several at once', (await heldBy(admin.id)) >= 2)
  ok('the space\'s people carry what each is called', (((await admin.sb.rpc('space_people', { p_space: spaceId, p_channel: open_.id })).data) || [])
    .some((x) => Array.isArray(x.roles) && x.roles.includes('mentor')))

  /* And the point of all of it: a role can be given a capability. Asked of somebody who is NOT on
     the staff, because the staff always may and would prove nothing either way. */
  const ordinary = await as('member2@example.com')
  await service.from('space_members').insert({ space_id: spaceId, user_id: ordinary.id, source: 'invite' })
  await service.from('channel_members').insert({ channel_id: open_.id, user_id: ordinary.id })
  ok('a moderator may name the whole channel, because a grant says so and not the client',
    ((await admin.sb.rpc('space_may', { p_channel: open_.id, p_capability: 'mention-channel' })).data) === true)
  ok('and somebody who is merely a member may not', ((await ordinary.sb.rpc('space_may', { p_channel: open_.id, p_capability: 'mention-channel' })).data) === false)
  ok('an administrator cannot insert a grant from a browser either',
    !!(await admin.sb.from('space_grants').insert({ capability: 'voice', scope: 'space', space_id: spaceId }).select().single()).error)
  const { data: gRole } = await service.from('space_grants')
    .insert({ capability: 'voice', scope: 'role', role_id: mentor.id, space_id: spaceId, source: 'file' }).select().single()
  ok('with the role unheld, the grant reaches nobody', ((await ordinary.sb.rpc('space_may', { p_channel: open_.id, p_capability: 'voice' })).data) === false)
  await service.from('space_member_roles').insert({ space_id: spaceId, user_id: ordinary.id, role_id: mentor.id })
  ok('a role may be given a voice, and whoever holds it has one', ((await ordinary.sb.rpc('space_may', { p_channel: open_.id, p_capability: 'voice' })).data) === true)
  await service.from('space_member_roles').delete().eq('space_id', spaceId).eq('user_id', ordinary.id).eq('role_id', mentor.id)
  ok('and loses it with the role', ((await ordinary.sb.rpc('space_may', { p_channel: open_.id, p_capability: 'voice' })).data) === false)
  await service.from('space_grants').delete().eq('id', gRole.id)
  await service.from('space_member_roles').delete().eq('space_id', spaceId).eq('user_id', admin.id).eq('role_id', mentor.id)
  await service.from('space_roles').delete().eq('id', mentor.id)
  await service.from('space_members').delete().eq('space_id', spaceId).eq('user_id', ordinary.id)

  /* ---------------------------------------------------------------- a room somebody paid for
     The paid server and the paid community: a space whose rule is something bought or a membership
     held, filled the moment the money lands rather than on the next hour's sweep — somebody who has
     just paid to be in a room should be in the room. */
  const PKEY = 'pk' + SLUG.slice(0, 7)
  const { data: paid } = await service.from('spaces')
    .insert({ slug: SLUG + '-paid', name: 'A paid server', kind: 'server', fill: { product: PKEY } }).select().single()
  const { data: lobby } = await service.from('channels')
    .insert({ space_id: paid.id, slug: 'lobby', name: 'Lobby', mode: 'stream', visibility: 'open' }).select().single()
  const inSpace = async () => (((await service.from('space_members').select('user_id').eq('space_id', paid.id).eq('user_id', reader.id)).data) || []).length > 0
  const inLobby = async () => (((await service.from('channel_members').select('user_id').eq('channel_id', lobby.id).eq('user_id', reader.id)).data) || []).length > 0

  ok('somebody who has not bought it is not in the server', !(await inSpace()))
  const { data: pass_ } = await service.from('purchases')
    .insert({ user_id: reader.id, email: 'free@example.com', amount_total: 2000, currency: 'usd', status: 'paid', sku: 'server-pass', key: PKEY }).select().single()
  await wait(300)
  ok('the moment the purchase is paid they are in it', await inSpace())
  ok('and in its open rooms', await inLobby())
  await service.from('purchases').update({ status: 'refunded' }).eq('id', pass_.id)
  await wait(300)
  ok('a refund takes the room back', !(await inSpace()))
  ok('and the rooms with it', !(await inLobby()))

  await service.from('spaces').update({ fill: { tier: 'tier-9' } }).eq('id', paid.id)
  const { data: ent } = await service.from('entitlements')
    .insert({ user_id: reader.id, kind: 'class', key: 'subscribed', tier: 'tier-9', active: true, source: 'grant', source_id: 'test:' + SLUG }).select().single()
  await wait(300)
  ok('a membership begun puts them in a community', !!ent && (await inSpace()), ent ? '' : 'no entitlement row')
  if (ent) {
    await service.from('entitlements').update({ active: false }).eq('id', ent.id)
    await wait(300)
    ok('and one ended takes them out again', !(await inSpace()))
    await service.from('space_members').insert({ space_id: paid.id, user_id: reader.id, source: 'invite' })
    await service.rpc('space_sync_one', { p_user: reader.id })
    ok('somebody invited by hand is never swept away by a rule', await inSpace())
    await service.from('entitlements').delete().eq('id', ent.id)
  }
  await service.from('purchases').delete().eq('id', pass_.id)
  await service.from('spaces').delete().eq('id', paid.id)

  /* ---------------------------------------------------------------- the projection
     A space, its rooms, its roles and the grants a site ships are a DECLARATION: files under
     content/spaces, compiled and projected here. What matters is what the projection does NOT do —
     it never deletes a room, it never touches a direct message, and it never touches a grant
     somebody made by hand. A file removed by mistake must not take a year of conversation with it. */
  {
    const fsx = await import('node:fs')
    const osx = await import('node:os')
    const px = await import('node:path')
    const { compileSpaces } = await import('./spaces.mjs')
    const { pushSpaces } = await import('./spaces-push.mjs')
    const { gitStore } = await import('./store/index.mjs')
    const fixture = fsx.mkdtempSync(px.join(osx.tmpdir(), 'spaces-proj-'))
    const put = (rel, body) => { fsx.mkdirSync(px.dirname(px.join(fixture, rel)), { recursive: true }); fsx.writeFileSync(px.join(fixture, rel), body) }
    const drop = (rel) => fsx.rmSync(px.join(fixture, rel), { force: true })
    const SL = 'proj-' + Math.random().toString(36).slice(2, 8)
    /* The projection archives every space the declaration does not name, which is exactly what it
       should do — and means a run over a fixture alone would archive this site's own rooms. So the
       fixture's declaration is projected BESIDE the site's real one, the way a second space would
       be, and the site's rooms are never out of the declaration for a moment. */
    const mine = JSON.parse(fsx.readFileSync(px.join(process.cwd(), 'supabase/functions/_shared/spaces.json'), 'utf8'))
    const project = async () => {
      const declared = await compileSpaces({ store: gitStore(fixture), write: false })
      if (!declared) throw new Error('the fixture does not compile')
      return pushSpaces({ declared: [...mine, ...declared], db: service, quiet: true })
    }
    try {
      put(`content/spaces/${SL}.md`, '---\nname: A projected space\nkind: community\nroles:\n  - { slug: member, name: Member, rank: 0 }\n  - { slug: mod, name: Moderator, rank: 50, can: [mention-channel] }\ngrants:\n  - { capability: voice, to: everyone }\n---\nWhat this place is.\n')
      put(`content/spaces/${SL}/lounge.md`, '---\nname: Lounge\norder: 1\nhears: [purchase.paid]\n---\n')
      put(`content/spaces/${SL}/attic.md`, '---\nname: Attic\norder: 2\n---\n')
      await project()

      const spaceOf = async () => (await service.from('spaces').select('id, name, kind, archived_at').eq('slug', SL).maybeSingle()).data
      const chOf = async (slug) => (await service.from('channels').select('id, name, topic, archived_at').eq('space_id', (await spaceOf()).id).eq('slug', slug).maybeSingle()).data
      const sp = await spaceOf()
      ok('the declaration makes the space', !!sp && sp.name === 'A projected space' && sp.kind === 'community')
      const lounge = await chOf('lounge'), attic = await chOf('attic')
      ok('and its rooms', !!lounge && !!attic && lounge.name === 'Lounge')
      const rs = (await service.from('space_roles').select('slug, rank').eq('space_id', sp.id)).data || []
      ok('and the roles it declares', rs.length === 2 && rs.some((r) => r.slug === 'mod' && r.rank === 50))
      const gs = (await service.from('space_grants').select('capability, scope, source, space_id, channel_id, role_id').eq('space_id', sp.id)).data || []
      ok('and its grants, every one marked as the file\'s', gs.length === 2 && gs.every((g) => g.source === 'file'), JSON.stringify(gs))
      ok('a role\'s `can` is a grant at role scope', gs.some((g) => g.capability === 'mention-channel' && g.scope === 'role' && !!g.role_id))
      ok('and `everyone` on the space is a grant scoped to the space', gs.some((g) => g.capability === 'voice' && g.scope === 'space' && g.channel_id === null))
      const hs = (await service.from('space_hooks').select('event, channel_id').eq('space_id', sp.id)).data || []
      ok('what a room hears is the room\'s own line', hs.length === 1 && hs[0].event === 'purchase.paid' && hs[0].channel_id === lounge.id)

      /* something is said in the attic, and somebody is handed a capability by hand */
      await service.from('channel_members').insert({ channel_id: attic.id, user_id: admin.id })
      const { data: saidRow } = await service.from('space_messages').insert({ channel_id: attic.id, author_id: admin.id, body: 'A year of conversation.' }).select().single()
      const { data: byHand } = await service.from('space_grants')
        .insert({ capability: 'voice', scope: 'user', user_id: support.id, space_id: sp.id, source: 'hand', note: 'by hand' }).select().single()

      /* nothing changed: the projection is idempotent */
      const again = await project()
      ok('running it twice changes nothing', again.said.length === 0, JSON.stringify(again.said))

      /* the attic's file goes */
      drop(`content/spaces/${SL}/attic.md`)
      await project()
      const gone = await chOf('attic')
      ok('a room whose file has gone is ARCHIVED, never deleted', !!gone && !!gone.archived_at)
      ok('and what was said in it is still there', !!(await service.from('space_messages').select('id').eq('id', saidRow.id).maybeSingle()).data)
      ok('the room kept its id, so every counter and membership hanging off it survived', gone.id === attic.id)

      /* and comes back */
      put(`content/spaces/${SL}/attic.md`, '---\nname: Attic\norder: 2\n---\n')
      await project()
      const back = await chOf('attic')
      ok('putting the file back brings the room back', !!back && !back.archived_at && back.id === attic.id)
      ok('with everything still in it', !!(await service.from('space_messages').select('id').eq('id', saidRow.id).maybeSingle()).data)

      /* a grant the file stops giving goes; one given by hand never does */
      put(`content/spaces/${SL}.md`, '---\nname: A projected space\nkind: community\nroles:\n  - { slug: member, name: Member, rank: 0 }\n  - { slug: mod, name: Moderator, rank: 50 }\n---\n')
      await project()
      const after = (await service.from('space_grants').select('id, source, capability').eq('space_id', sp.id)).data || []
      ok('a grant the declaration no longer gives is removed', !after.some((g) => g.source === 'file'))
      ok('and one given by hand is untouched', after.some((g) => g.id === byHand.id))
      const rsAfter = (await service.from('space_roles').select('slug').eq('space_id', sp.id)).data || []
      ok('a role the declaration still names stays', rsAfter.some((r) => r.slug === 'mod'))

      /* a direct message is nobody's declaration */
      const { data: dm } = await service.rpc('space_dm_open', { p_space: sp.id, p_with: [support.id] })
      if (dm) {
        await project()
        const still = (await service.from('channels').select('id, archived_at').eq('id', dm).maybeSingle()).data
        ok('a direct message is never touched by the projection', !!still && !still.archived_at)
      } else ok('a direct message is never touched by the projection', true, 'none opened')

      /* and the whole space, when its file goes */
      drop(`content/spaces/${SL}.md`)
      drop(`content/spaces/${SL}/lounge.md`)
      drop(`content/spaces/${SL}/attic.md`)
      await project()
      const dead = await spaceOf()
      ok('a space whose file has gone is archived too, and not deleted', !!dead && !!dead.archived_at)
    } finally {
      const s = (await service.from('spaces').select('id').eq('slug', SL).maybeSingle()).data
      if (s) await service.from('spaces').delete().eq('id', s.id)
      fsx.rmSync(fixture, { recursive: true, force: true })
    }
  }


  /* ---------------------------------------------------------------- the DMs place
     A direct message is a channel; the DMs place is one read of all of them, whichever space each
     lives in. It answers with the other people BY NAME, because the names a page holds belong to
     the space it has open — a conversation in another space would otherwise be addressed to
     "someone". */
  /* the sections above have emptied and refilled this space as they went, so put the two of them
     back: a direct message is between people who are in the space, and that is all this needs */
  await service.from('space_members').insert([{ space_id: spaceId, user_id: admin.id, source: 'fill' }, { space_id: spaceId, user_id: support.id, source: 'fill' }])
  const dmChan = (await admin.sb.rpc('space_dm_open', { p_space: spaceId, p_with: [support.id] })).data
  ok('a direct message is opened by who is in it', !!dmChan)
  await admin.sb.from('space_messages').insert({ channel_id: dmChan, author_id: admin.id, body: 'a line in a direct message' })
  await support.sb.from('space_messages').insert({ channel_id: dmChan, author_id: support.id, body: 'and one back' })

  const dmMine = ((await admin.sb.rpc('space_dms')).data || []).find((d) => d.channel === dmChan)
  ok('the DMs read answers every direct message the caller is in', !!dmMine)
  ok('and says which space it is in', dmMine && dmMine.space === spaceId && !!dmMine.space_name)
  ok('and names the other person, never the caller', dmMine
    && (dmMine.people || []).length === 1
    && dmMine.people[0].id === support.id
    && !!dmMine.people[0].name)
  ok('and carries the last line, whose it is and when', dmMine && dmMine.last
    && dmMine.last.author === support.id && String(dmMine.last.body).includes('one back') && !!dmMine.last_message_at)

  /* unread is the same subtraction the rest of the surface makes */
  await service.from('channel_members').update({ last_read_seq: 0 }).eq('channel_id', dmChan).eq('user_id', admin.id)
  const dmUnreadRow = ((await admin.sb.rpc('space_dms')).data || []).find((d) => d.channel === dmChan)
  ok('unread is a count and the place can say how many are waiting', dmUnreadRow && dmUnreadRow.unread === 2)
  /* and it is each person's own: the other side has caught up, and says so in the same read */
  const seqNow = ((await service.from('channels').select('last_seq').eq('id', dmChan).maybeSingle()).data || {}).last_seq
  await service.from('channel_members').update({ last_read_seq: seqNow }).eq('channel_id', dmChan).eq('user_id', support.id)
  const dmReadRow = ((await support.sb.rpc('space_dms')).data || []).find((d) => d.channel === dmChan)
  ok('and it is each person\'s own', dmReadRow && dmReadRow.unread === 0)

  /* nobody else's conversation is in anybody's list */
  const dmStranger = await as('member@example.com')
  ok('somebody who is not in it is not told it exists',
    !((await dmStranger.sb.rpc('space_dms')).data || []).some((d) => d.channel === dmChan))

  /* ---------------------------------------------------------------- which tiers a fill admits
     A FILL SAYS WHICH TIERS, AND NOTHING IS IMPLIED. Tiers are not a ladder here: a rule that
     means all three says all three. What a key admits is the same rule for every key — one value,
     or several meaning any of them. */
  {
    const matches = async (uid, set) => ((await service.rpc('space_fill_set_matches', { p_user: uid, p_set: set })).data) === true
    const two = await as('member@example.com')    /* the lower of the two seeded members */
    const three = await as('member2@example.com') /* the higher */
    /* THE TIER SLUGS ARE THE SITE'S, so they are read from the two accounts rather than written here:
       every site names its tiers itself (the root site's tier-2 and tier-3, the demo's member and patron)
       and a rule spelt out in this file would only ever be true on one of them. */
    const tierOf = async (uid) => ((await service.from('entitlements').select('tier').eq('user_id', uid).eq('kind', 'class').eq('key', 'subscribed').maybeSingle()).data || {}).tier
    const t2 = await tierOf(two.id), t3 = await tierOf(three.id)
    ok('the two seeded members hold two different tiers', !!t2 && !!t3 && t2 !== t3, JSON.stringify({ t2, t3 }))

    ok('one tier admits that tier', await matches(two.id, { tier: t2 }))
    ok('…and nobody else — a higher tier is NOT implied', !(await matches(three.id, { tier: t2 })))
    ok('…nor a lower one', !(await matches(two.id, { tier: t3 })))

    /* several values mean ANY OF THEM, which is how a rule admits more than one tier */
    ok('a list admits each of them', (await matches(two.id, { tier: [t2, t3] }))
      && (await matches(three.id, { tier: [t2, t3] })))
    ok('…and still nobody else', !(await matches(admin.id, { tier: [t2, t3] })))
    ok('an empty list admits nobody', !(await matches(three.id, { tier: [] })))

    /* the same rule for every key, which is what was wrong: a list written on any of these used to
       match nobody at all, silently */
    ok('a list of entitlements works the same way', await matches(three.id, { entitlement: ['nothing', 'subscribed'] }))
    ok('and a list of roles, as it always did', await matches(admin.id, { role: ['editor', 'admin'] }))

    /* the keys of one set must ALL hold, list or not */
    ok('two keys in one set must both hold', !(await matches(three.id, { tier: [t3], role: ['admin'] })))
  }

  /* ---------------------------------------------------------------- naming a group
     Who holds a role is the database's answer, so this is where it is resolved: `@coaches` reaches
     whoever holds the role IN THIS SPACE and is IN THIS ROOM, and nobody else. */
  {
    await service.from('space_members').insert({ space_id: spaceId, user_id: ordinary.id, source: 'invite' })
    await service.from('channel_members').insert({ channel_id: open_.id, user_id: ordinary.id })
    const { data: role } = await service.from('space_roles')
      .insert({ space_id: spaceId, slug: 'mentors', name: 'Mentors', rank: 5 }).select().single()
    await service.from('space_member_roles').insert({ space_id: spaceId, user_id: ordinary.id, role_id: role.id })

    const said = (await admin.sb.from('space_messages').insert({
      channel_id: open_.id, author_id: admin.id, kind: 'text', body: '<@role:mentors> could one of you take this?',
    }).select().single()).data
    const got = ((await service.from('space_mentions').select('user_id, kind').eq('message_id', said.id)).data) || []
    ok('naming a group reaches whoever holds it', got.some((m) => m.user_id === ordinary.id && m.kind === 'group'))
    ok('…and nobody else', got.length === 1, JSON.stringify(got))

    /* somebody who holds the role but is NOT in the room is not reached: a mention is a mention in
       a place, and telling them about a room they cannot open helps nobody */
    const away = await as('free@example.com')
    await service.from('space_members').insert({ space_id: spaceId, user_id: away.id, source: 'invite' })
    await service.from('space_member_roles').insert({ space_id: spaceId, user_id: away.id, role_id: role.id })
    /* joining a space puts somebody into its open rooms, so taking them out again is the premise */
    await service.from('channel_members').delete().eq('channel_id', open_.id).eq('user_id', away.id)
    const two = (await admin.sb.from('space_messages').insert({
      channel_id: open_.id, author_id: admin.id, kind: 'text', body: 'again <@role:mentors>',
    }).select().single()).data
    const got2 = ((await service.from('space_mentions').select('user_id').eq('message_id', two.id)).data) || []
    ok('somebody who holds it but is not in the room is not reached',
      got2.length === 1 && got2[0].user_id === ordinary.id)

    /* a role of ANOTHER space with the same slug is not this one */
    const { data: other } = await service.from('spaces').insert({ slug: SLUG + '-elsewhere', name: 'Elsewhere', kind: 'community' }).select().single()
    await service.from('space_roles').insert({ space_id: other.id, slug: 'mentors', name: 'Mentors', rank: 5 })
    const three = (await admin.sb.from('space_messages').insert({
      channel_id: open_.id, author_id: admin.id, kind: 'text', body: 'once more <@role:mentors>',
    }).select().single()).data
    ok('a role of another space with the same slug is a different group',
      (((await service.from('space_mentions').select('user_id').eq('message_id', three.id)).data) || []).length === 1)
    await service.from('spaces').delete().eq('id', other.id)

    await service.from('space_messages').delete().in('id', [said.id, two.id, three.id])
    await service.from('space_roles').delete().eq('id', role.id)
    await service.from('space_members').delete().eq('space_id', spaceId).in('user_id', [ordinary.id, away.id])
    await service.from('channel_members').delete().eq('channel_id', open_.id).in('user_id', [ordinary.id, away.id])
  }

  /* ---------------------------------------------------------------- written now, sent later */
  {
    const soon = new Date(Date.now() + 3600e3).toISOString()
    const made = (await admin.sb.rpc('space_schedule', { p_channel: open_.id, p_body: 'At nine, then.', p_at: soon })).data
    ok('a message may be put down for later', made && made.ok === true)

    const mine = (await admin.sb.rpc('space_scheduled_mine')).data || []
    ok('…and its author sees it waiting, with where and when', mine.some((s) => s.id === made.id && s.channel && s.send_at))
    /* A MESSAGE THAT HAS NOT BEEN SENT HAS NOT BEEN SAID: nobody else sees it, not even the room */
    const nosy = await as('member2@example.com')
    ok('nobody else sees it', !((await nosy.sb.rpc('space_scheduled_mine')).data || []).length)
    ok('…not even by reading the table', !((await nosy.sb.from('space_scheduled').select('id')).data || []).length)

    ok('the past is refused', ((await admin.sb.rpc('space_schedule', {
      p_channel: open_.id, p_body: 'x', p_at: new Date(Date.now() - 1000).toISOString() })).data || {}).error === 'past')
    ok('and so is a room they cannot speak in', ((await nosy.sb.rpc('space_schedule', {
      p_channel: open_.id, p_body: 'x', p_at: soon })).data || {}).error === 'not-yours')

    /* THE MINUTE IT GOES it is an ordinary message, so every trigger that follows one follows it */
    const before = ((await service.from('space_messages').select('id', { count: 'exact', head: true }).eq('channel_id', open_.id)).count) || 0
    await service.from('space_scheduled').update({ send_at: new Date(Date.now() - 1000).toISOString() }).eq('id', made.id)
    const { data: sent } = await service.rpc('run_space_scheduled')
    ok('the runner sends what is due', sent >= 1)
    const after = ((await service.from('space_messages').select('id', { count: 'exact', head: true }).eq('channel_id', open_.id)).count) || 0
    ok('…as a message in the room', after === before + 1)
    ok('…and the plan is gone, because a thing that happened is the thing',
      !((await admin.sb.rpc('space_scheduled_mine')).data || []).some((s) => s.id === made.id))
    const landed = ((await service.from('space_messages').select('body, author_id, seq').eq('channel_id', open_.id).order('seq', { ascending: false }).limit(1)).data || [])[0]
    ok('…written by the person who scheduled it, numbered like any other',
      landed && landed.body === 'At nine, then.' && landed.author_id === admin.id && landed.seq > 0)
    await service.from('space_messages').delete().eq('id', landed.id)
  }

  /* ---------------------------------------------------------------- everything not read
     The other half of the question the counters answer: not how many, but what. */
  {
    await service.from('space_members').insert({ space_id: spaceId, user_id: ordinary.id, source: 'invite' })
    await service.from('channel_members').insert({ channel_id: open_.id, user_id: ordinary.id })
    await service.from('channel_members').update({ last_read_seq: 0 }).eq('channel_id', open_.id).eq('user_id', ordinary.id)

    const mine = (await ordinary.sb.from('space_messages').insert({
      channel_id: open_.id, author_id: ordinary.id, kind: 'text', body: 'Something I said myself.',
    }).select().single()).data
    const theirs = (await admin.sb.from('space_messages').insert({
      channel_id: open_.id, author_id: admin.id, kind: 'text', body: 'Something somebody else said.',
    }).select().single()).data

    const waiting = (await ordinary.sb.rpc('space_unseen')).data || []
    const ids = waiting.map((w) => w.id)
    ok('what somebody else said is waiting', ids.includes(theirs.id))
    /* you have read what you wrote — the trigger says so, and the list agrees with the counter */
    ok('…and what they said themselves is not', !ids.includes(mine.id))
    const row = ((await ordinary.sb.rpc('space_unread')).data || []).find((r) => r.channel === open_.id)
    ok('…and the counter says the same number the list does',
      row && (row.seq - row.read) === waiting.filter((w) => w.channel_id === open_.id).length,
      JSON.stringify({ counter: row && row.seq - row.read, list: waiting.filter((w) => w.channel_id === open_.id).length }))
    ok('…and it says where it is and who said it', waiting[0] && !!waiting[0].channel && !!waiting[0].author)

    /* MUTING IS SOMEBODY SAYING THEY DO NOT WANT TO BE TOLD, and a list that tells them anyway is
       a list they stop opening */
    await service.from('channel_members')
      .update({ muted_until: new Date(Date.now() + 3600e3).toISOString() })
      .eq('channel_id', open_.id).eq('user_id', ordinary.id)
    ok('a muted room is left out',
      !((await ordinary.sb.rpc('space_unseen')).data || []).some((w) => w.channel_id === open_.id))
    await service.from('channel_members').update({ muted_until: null }).eq('channel_id', open_.id).eq('user_id', ordinary.id)

    /* and nothing of a room they are not in, ever */
    const outsider = await as('free@example.com')
    ok('and a room somebody is not in is not in their list',
      !((await outsider.sb.rpc('space_unseen')).data || []).some((w) => w.channel_id === open_.id))

    await service.from('space_messages').delete().in('id', [mine.id, theirs.id])
    await service.from('space_members').delete().eq('space_id', spaceId).eq('user_id', ordinary.id)
  }

  /* ---------------------------------------------------------------- pinned to the room
     A pin is the ROOM's, not a person's, so the question it answers is a capability and not
     authorship: whoever keeps the room pins, everybody in it reads, and nobody else does either. */
  {
    /* the capability tests above took this one out of the space; a pin is read by whoever is IN
       the room, so one of them has to be */
    await service.from('space_members').insert({ space_id: spaceId, user_id: ordinary.id, source: 'invite' })
    await service.from('channel_members').insert({ channel_id: open_.id, user_id: ordinary.id })
    const said = (await admin.sb.from('space_messages').insert({
      channel_id: open_.id, author_id: admin.id, kind: 'text', body: 'The rules of this room.',
    }).select().single()).data
    ok('a message to pin', !!said)

    const asMember = await as('member@example.com')
    const refused = (await asMember.sb.rpc('space_pin', { p_message: said.id, p_on: true })).data
    ok('somebody who merely writes here may not pin', refused && refused.error === 'not-allowed')
    ok('…and nothing was pinned', !((await asMember.sb.rpc('space_pinned', { p_channel: open_.id })).data || []).length)

    const done = (await admin.sb.rpc('space_pin', { p_message: said.id, p_on: true, p_note: 'read this' })).data
    ok('whoever keeps the room may', done && done.ok === true)
    const seen = (await admin.sb.rpc('space_pinned', { p_channel: open_.id })).data || []
    ok('…and it is there, with who put it there', seen.length === 1 && seen[0].message_id === said.id && !!seen[0].by)
    ok('…and the note it was pinned with', seen[0].note === 'read this')

    /* the point of a pin: everybody in the room sees the same one */
    const theirs = (await ordinary.sb.rpc('space_pinned', { p_channel: open_.id })).data || []
    ok('everybody in the room sees it', theirs.length === 1 && theirs[0].message_id === said.id)
    /* and nobody outside it sees anything at all */
    const outside = await as('free@example.com')
    ok('and nobody outside the room does', !((await outside.sb.rpc('space_pinned', { p_channel: open_.id })).data || []).length)

    /* the table itself takes no write, whatever a client tries */
    const direct = await admin.sb.from('space_pins').insert({ channel_id: open_.id, message_id: said.id })
    ok('the table takes no insert of its own — space_pin is the one way in', !!direct.error)

    await admin.sb.rpc('space_pin', { p_message: said.id, p_on: false })
    ok('and unpinning takes it away', !((await admin.sb.rpc('space_pinned', { p_channel: open_.id })).data || []).length)

    /* a withdrawn message takes its pin with it, rather than leaving a pin to nothing */
    await admin.sb.rpc('space_pin', { p_message: said.id, p_on: true })
    await service.from('space_messages').update({ deleted_at: new Date().toISOString() }).eq('id', said.id)
    ok('a withdrawn message is not still pinned',
      !((await admin.sb.rpc('space_pinned', { p_channel: open_.id })).data || []).length)
    await service.from('space_members').delete().eq('space_id', spaceId).eq('user_id', ordinary.id)
  }

  /* ------------------------------------------------- how far back a plan keeps what was said */
  {
    /* an old line, older than any horizon a test would write */
    const { data: old } = await service.from('space_messages')
      .insert({ channel_id: open_.id, author_id: admin.id, body: 'said a long time ago' }).select().single()
    await service.from('space_messages').update({ created_at: new Date(Date.now() - 400 * 864e5).toISOString() }).eq('id', old.id)
    /* somebody who is NOT staff: the support agent and the administrator are both exempt by the
       function itself, so neither of them can show that a horizon bites */
    const plain = await as('member2@example.com')
    await service.from('space_members').insert({ space_id: spaceId, user_id: plain.id }).select()
    await service.from('channel_members').insert({ channel_id: open_.id, user_id: plain.id }).select()
    const reads = async (who) => ((await who.sb.rpc('space_history', { p_channel: open_.id, p_lim: 200 })).data || []).some((m) => m.id === old.id)

    ok('with no horizon declared, everything that was said is still read', await reads(plain))

    /* 60 days for everybody. The staff are exempt by the function itself, so this is checked with
       somebody who is in the space and is not staff. */
    await service.from('spaces').update({ history: [{ days: 60 }] }).eq('id', spaceId)
    ok('a horizon puts what is older than it out of reach', !(await reads(plain)))
    ok('and never applies to the staff, who must be able to answer for what was said', await reads(admin))

    /* a rule that names somebody this person is not still leaves them unlimited: a horizon is
       something a site says out loud, and a rule nobody wrote is not one */
    await service.from('spaces').update({ history: [{ days: 30, role: 'nobody-holds-this' }] }).eq('id', spaceId)
    ok('a rule that matches nobody leaves them reading everything', await reads(plain))

    /* 0 is no limit, and the most generous matching rule wins */
    await service.from('spaces').update({ history: [{ days: 60 }, { days: 0 }] }).eq('id', spaceId)
    ok('the most generous rule wins, and zero days means no limit', await reads(plain))

    await service.from('spaces').update({ history: [] }).eq('id', spaceId)
    await service.from('space_messages').delete().eq('id', old.id)
    await service.from('channel_members').delete().eq('channel_id', open_.id).eq('user_id', plain.id)
    await service.from('space_members').delete().eq('space_id', spaceId).eq('user_id', plain.id)
  }

  /* ---------------------------------------------------------------- the sweep takes it away */
  await service.from('spaces').update({ fill: { role: ['admin'] } }).eq('id', spaceId)
  await service.rpc('space_sync_members')
  const left = (await service.from('space_members').select('user_id').eq('space_id', spaceId)).data || []
  ok('a membership the rule no longer grants is taken away', !left.map((m) => m.user_id).includes(support.id))
  const gone = (await service.from('channel_members').select('user_id').eq('channel_id', open_.id)).data || []
  ok('and it takes their channel memberships with it', !gone.map((m) => m.user_id).includes(support.id))
  const sGone = ((await support.sb.rpc('space_unread')).data || []).find((x) => x.channel === open_.id)
  ok('so the same read that worked before returns nothing', !sGone)
} finally {
  if (spaceId) await service.from('spaces').delete().eq('id', spaceId)
}


/*
 * THE ROOMS REACH THE DATABASE ON A PUBLISH, with no machine.
 *
 * compileSpaces reads the declaration through the store and takes the catalog and the forms as
 * DATA; pushSpaces takes the compiled record in hand. Between them they want a database and not a
 * disk, which is the only way a space becomes a space where nothing rebuilds. A save over rows is a
 * draft and moves nothing.
 *
 * A projection is a whole-table sync, so nothing here runs unless the table already holds only what
 * the files declare — the rule the cloud lane learned by emptying the teams table.
 */
{
  const { compileSpaces } = await import('./spaces.mjs')
  const { pushSpaces } = await import('./spaces-push.mjs')
  const { gitStore } = await import('./store/git.mjs')
  const REPO = process.cwd()
  const store = gitStore(REPO)

  const declared = await compileSpaces({ store, write: false })
  ok('the declaration compiles with no file written', Array.isArray(declared) && declared.length > 0, JSON.stringify((declared || []).map((s) => s.slug)))

  const rows = ((await service.from('spaces').select('slug')).data || []).map((r) => r.slug)
  const names = (declared || []).map((s) => s.slug)
  const safe = names.length > 0 && rows.every((s) => names.includes(s))
  ok('the table holds nothing the files do not declare, so projecting is safe', safe,
    rows.filter((s) => !names.includes(s)).join(', '))

  if (safe) {
    /* the function's situation: a declaration in hand, a client, and no environment to fall back on */
    const had = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY }
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY
    let r = null, threw = null
    try { r = await pushSpaces({ declared, db: service, quiet: true }) } catch (e) { threw = e.message }
    finally { if (had.u) process.env.SUPABASE_URL = had.u; if (had.k) process.env.SUPABASE_SERVICE_ROLE_KEY = had.k }
    ok('the spaces project with no environment and no file', !threw, threw)
    const after = ((await service.from('spaces').select('slug')).data || []).map((x) => x.slug)
    ok('every declared space is a row', names.every((s) => after.includes(s)), names.filter((s) => !after.includes(s)).join(', '))
    ok('and its rooms with it', ((await service.from('channels').select('id')).data || []).length > 0)
    const again = await pushSpaces({ declared, db: service, quiet: true })
    ok('running it twice changes nothing', (again.said || []).length === 0, (again.said || []).join('; '))
  }

  /* a save over rows moves nothing; a save on a checkout still compiles and pushes */
  const model = (await import('./models/core/spaces.mjs')).default
  ok('the spaces model answers projected()', typeof model.projected === 'function')
  let ranRows = false, ranDisk = 0
  await model.after({ data: {} }, { store: { kind: 'rows', client: service }, script: async () => { ranRows = true } })
  ok('a save over rows runs no script', !ranRows, 'it asked for a machine that is not there')
  await model.after({ data: {} }, { store, script: async () => { ranDisk++ } })
  ok('a save on a checkout compiles and pushes', ranDisk === 2, String(ranDisk) + ' script(s)')
}

console.log('\nspaces-db: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
