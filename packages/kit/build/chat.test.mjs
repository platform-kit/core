/*
 * The chat's rules live in one pure module, src/lib/chat/model.js, so the page
 * and this file read the same arithmetic: days and runs, ticks, reactions,
 * initials, the clock, the inbox preview, and how an echo lands on the row it
 * was. Nothing here touches Supabase — the database's own rules (RLS, the
 * triggers, the RPCs) are proven against the local stack by hand.
 */
import { daySections, dayLabel, groupRuns, tickOf, reactionChips, toggleReaction, initials, clock, previewOf, whenOf, reactionSet, mergeMessages, dueOf, spanOf, sortInbox } from '../src/lib/chat/model.js'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\nCHAT\n')

const now = new Date(2026, 8, 14, 15, 0, 0).getTime()   /* Mon 14 Sep 2026, 15:00 local */
const at = (h, m = 0, dayOffset = 0) => { const d = new Date(now); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString() }
const me = 'me', you = 'you'
const msg = (id, sender, when, extra = {}) => ({ id, sender_id: sender, kind: 'text', body: 'm' + id, created_at: when, ...extra })

/* --- days --- */
const W = { today: 'Today', yesterday: 'Yesterday' }
ok('today', dayLabel(at(9), now, W) === 'Today')
ok('yesterday', dayLabel(at(23, 59, -1), now, W) === 'Yesterday')
ok('earlier this year names the weekday', /^\w{3}/.test(dayLabel(at(9, 0, -10), now, W, 'en-GB')))
ok('last year carries the year', /2025/.test(dayLabel(new Date(2025, 0, 1).toISOString(), now, W, 'en-GB')))
const across = [msg(1, you, at(23, 50, -1)), msg(2, me, at(0, 5)), msg(3, me, at(0, 6))]
const secs = daySections(across, now, W)
ok('midnight splits the sections', secs.length === 2 && secs[0].label === 'Yesterday' && secs[1].label === 'Today')
ok('sections hold their messages in order', secs[0].messages.length === 1 && secs[1].messages.length === 2)
ok('no messages, no sections', daySections([], now).length === 0)

/* --- runs --- */
const runs = groupRuns([msg(1, you, at(9, 0)), msg(2, you, at(9, 2)), msg(3, me, at(9, 3)), msg(4, you, at(9, 20))])
ok('a run: first flagged first', runs[0].first && !runs[0].last)
ok('a run: last flagged last', !runs[1].first && runs[1].last)
ok('a lone message is both', runs[2].first && runs[2].last)
ok('a gap over five minutes starts a run', runs[3].first && runs[3].last)

/* --- ticks --- */
ok('no tick on the peer\'s message', tickOf(msg(1, you, at(9)), me, at(10)) === null)
ok('pending while it has not landed', tickOf(msg(1, me, at(9), { pending: true }), me, at(10)) === 'pending')
ok('sent once on the server', tickOf(msg(1, me, at(9)), me, at(8)) === 'sent')
ok('sent with no cursor at all', tickOf(msg(1, me, at(9)), me, null) === 'sent')
ok('read when the cursor has passed it', tickOf(msg(1, me, at(9)), me, at(9, 1)) === 'read')

/* --- reactions --- */
let rx = []
rx = toggleReaction(rx, 'm1', me, '❤️')
ok('a reaction added', rx.length === 1 && rx[0].emoji === '❤️')
rx = toggleReaction(rx, 'm1', you, '❤️')
rx = toggleReaction(rx, 'm1', me, '👍')
const chips = reactionChips(rx.filter((r) => r.message_id === 'm1'), me)
ok('chips count and mark mine', eq(chips, [{ emoji: '❤️', count: 2, mine: true }, { emoji: '👍', count: 1, mine: true }]))
rx = toggleReaction(rx, 'm1', me, '❤️')
ok('toggling again removes only mine', rx.length === 2 && !rx.some((r) => r.user_id === me && r.emoji === '❤️'))
ok('the peer\'s stays', rx.some((r) => r.user_id === you && r.emoji === '❤️'))
ok('the quick set is the line split on spaces', eq(reactionSet('❤️ 👍  🙏'), ['❤️', '👍', '🙏']))

/* --- names, clock, previews --- */
ok('initials of two names', initials('Ada Lovelace') === 'AL')
ok('initials of three take the ends', initials('James Hunter Carter') === 'JC')
ok('initials of one', initials('ada') === 'A')
ok('initials of nothing', initials('') === '?')
ok('clock 65', clock(65) === '1:05')
ok('clock 0', clock(0) === '0:00')
ok('clock rounds', clock(4.6) === '0:05')
ok('clock survives junk', clock('x') === '0:00')
const V = { 'voice-label': 'Voice note', deleted: 'This message was deleted' }
ok('text preview collapses whitespace', previewOf({ kind: 'text', body: ' hi\n there ' }, V) === 'hi there')
ok('voice preview names it with its length', previewOf({ kind: 'voice', seconds: 12 }, V) === 'Voice note · 0:12')
ok('deleted preview', previewOf({ kind: 'text', body: 'x', deleted_at: at(9) }, V) === 'This message was deleted')
ok('when: today is a time', /\d/.test(whenOf(at(9), now, W)) && !/Yesterday/.test(whenOf(at(9), now, W)))
ok('when: yesterday', whenOf(at(9, 0, -1), now, W) === 'Yesterday')
ok('when: this week is a weekday', /^\w{3}$/.test(whenOf(at(9, 0, -3), now, W, 'en-GB')))
ok('when: older is a date', /\d/.test(whenOf(at(9, 0, -30), now, W, 'en-GB')))

/* --- merging --- */
const optimistic = [msg('a', me, at(9), { pending: true })]
const merged = mergeMessages(optimistic, [msg('a', me, at(9)), msg('b', you, at(9, 1))])
ok('the echo lands on the optimistic row', merged.length === 2 && merged[0].id === 'a' && merged[0].pending === false)
const older = mergeMessages(merged, [msg('z', you, at(8))])
ok('an older page slots in before', older[0].id === 'z' && older.length === 3)

/* ---- what a coach owes ---- */
const H = 60 * 60 * 1000
const t0 = Date.parse('2026-09-14T12:00:00Z')
const waiting = (h, extra = {}) => ({ id: 'w' + h, awaiting_since: new Date(t0 - h * H).toISOString(), last_message_at: new Date(t0 - h * H).toISOString(), created_at: new Date(t0 - 100 * H).toISOString(), ...extra })
const answered = (h, made = 100) => ({ id: 'a' + h, awaiting_since: null, last_message_at: new Date(t0 - h * H).toISOString(), created_at: new Date(t0 - made * H).toISOString() })
const d = dueOf(waiting(20), 24, t0)
ok('a 24h promise, 20h waited: 4h left', d && !d.over && Math.round(d.left / H) === 4)
ok('a 24h promise, 30h waited: 6h over', dueOf(waiting(30), 24, t0).over && Math.round(dueOf(waiting(30), 24, t0).left / H) === -6)
ok('nothing owed when the last word is the coach\'s', dueOf(answered(1), 24, t0) === null)
ok('nothing owed with no promise', dueOf(waiting(20), 0, t0) === null)
ok('spans read as minutes, hours, days', spanOf(35 * 60000) === '35m' && spanOf(4 * H) === '4h' && spanOf(60 * H) === '3d')
const list = [answered(1, 10), waiting(30), answered(5, 200), waiting(2)]
ok('by activity: latest first', sortInbox(list, 'activity').map((c) => c.id).join() === 'a1,w2,a5,w30')
ok('by creation: newest thread first', sortInbox(list, 'created').map((c) => c.id).join() === 'a1,w30,w2,a5')
ok('by waiting: longest wait first, then activity', sortInbox(list, 'awaiting').map((c) => c.id).join() === 'w30,w2,a1,a5')
ok('sorting leaves the list alone', list[0].id === 'a1')

console.log(`  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
