/* the native scheduler's arithmetic: wall time in a zone, the open starts of a host */
import { wallToUtc, dayOf, offsetAt, rangesOn, openStarts, byDay, share, joiningCredit, offer, overLimit } from '../supabase/functions/_shared/schedulers/times.js'
import { occurrences } from '../src/lib/recurrence.js'
let n = 0, bad = 0
const ok = (name, c) => { n++; if (!c) { bad++; console.log('  ✗', name) } }
const AMS = 'Europe/Amsterdam'
/* a wall time resolves through the zone: summer is UTC+2, winter UTC+1 */
ok('summer 09:00 Amsterdam is 07:00Z', new Date(wallToUtc('2026-07-06', '09:00', AMS)).toISOString() === '2026-07-06T07:00:00.000Z')
ok('winter 09:00 Amsterdam is 08:00Z', new Date(wallToUtc('2026-12-07', '09:00', AMS)).toISOString() === '2026-12-07T08:00:00.000Z')
ok('the clocks change: 29 Mar 2026 03:00 is 01:00Z', new Date(wallToUtc('2026-03-29', '03:00', AMS)).toISOString() === '2026-03-29T01:00:00.000Z')
ok('offset in summer', offsetAt(Date.UTC(2026, 6, 6, 12), AMS) === 2 * 36e5)
ok('dayOf crosses midnight', dayOf(Date.UTC(2026, 6, 5, 23, 30), AMS).day === '2026-07-06' && dayOf(Date.UTC(2026, 6, 5, 23, 30), AMS).weekday === 1)
ok('New York', new Date(wallToUtc('2026-07-06', '09:00', 'America/New_York')).toISOString() === '2026-07-06T13:00:00.000Z')
/* the hours: weekdays 09:00–12:00 */
const weekly = { 1: [['09:00', '12:00']], 2: [['09:00', '12:00']], 3: [['09:00', '12:00']], 4: [['09:00', '12:00']], 5: [['09:00', '12:00']] }
ok('a day off by override', rangesOn('2026-07-08', 3, weekly, [{ day: '2026-07-08', ranges: null }]).length === 0)
ok('an exception replaces the day', rangesOn('2026-07-08', 3, weekly, [{ day: '2026-07-08', ranges: [['14:00', '16:00']] }])[0][0] === '14:00')
ok('a weekend is off', rangesOn('2026-07-11', 6, weekly, []).length === 0)
const now = Date.UTC(2026, 6, 5, 10)   /* Sunday 5 July 2026, 12:00 Amsterdam */
const hours = { timezone: AMS, weekly, overrides: [], buffer_before: 0, buffer_after: 0, notice_hours: 24, max_per_day: 0 }
const type = { duration: 60 }
const starts = openStarts({ hours, type, from: '2026-07-06', to: '2026-07-07', now })
const iso = (ms) => new Date(ms).toISOString()
ok('Monday within 24 h of Sunday noon: nothing before 12:00 Monday, so no Monday starts', !starts.some((s) => dayOf(s, AMS).day === '2026-07-06'))
const tue = starts.filter((s) => dayOf(s, AMS).day === '2026-07-07').map(iso)
ok('Tuesday: 09:00 … 11:00 on a 15-minute step, ending inside noon (9 starts)', tue.length === 9 && tue[0] === '2026-07-07T07:00:00.000Z' && tue[8] === '2026-07-07T09:00:00.000Z')
const later = Date.UTC(2026, 6, 4, 10)
const busy = [{ start: wallToUtc('2026-07-07', '10:00', AMS), end: wallToUtc('2026-07-07', '11:00', AMS) }]
const withBusy = openStarts({ hours, type, busy, from: '2026-07-07', to: '2026-07-07', now: later }).map(iso)
ok('a booked 10:00–11:00 removes every overlapping start (9:15 … 10:45)', withBusy.length === 2 && withBusy[0] === '2026-07-07T07:00:00.000Z' && withBusy[1] === '2026-07-07T09:00:00.000Z')
const withBuffer = openStarts({ hours: { ...hours, buffer_before: 15, buffer_after: 15 }, type, busy, from: '2026-07-07', to: '2026-07-07', now: later }).map(iso)
ok('15 minutes of breathing room: 09:00 would end with no gap and 11:15 would run past noon — the day offers nothing', withBuffer.length === 0)
const thirty = openStarts({ hours: { ...hours, buffer_before: 15, buffer_after: 15 }, type: { duration: 30 }, busy, from: '2026-07-07', to: '2026-07-07', now: later }).map(iso)
ok('a 30-minute session with the room: 09:00 and 09:15 (ending by 09:45), then 11:15 and 11:30 (ending by noon)', thirty.length === 4 && thirty[0] === '2026-07-07T07:00:00.000Z' && thirty[1] === '2026-07-07T07:15:00.000Z' && thirty[2] === '2026-07-07T09:15:00.000Z')
const capped = openStarts({ hours: { ...hours, max_per_day: 1 }, type, busy, from: '2026-07-07', to: '2026-07-07', now: later })
ok('at most one a day: a day with one booking offers nothing', capped.length === 0)
const off = openStarts({ hours: { ...hours, overrides: [{ day: '2026-07-07', ranges: null }] }, type, from: '2026-07-07', to: '2026-07-07', now: later })
ok('a day off offers nothing', off.length === 0)
const grouped = byDay(openStarts({ hours, type, from: '2026-07-07', to: '2026-07-07', now: later }), 'America/New_York')
ok('grouped in the reader\'s zone', Object.keys(grouped).length === 1 && grouped['2026-07-07'].length === 9)
const ninety = openStarts({ hours, type: { duration: 90 }, from: '2026-07-07', to: '2026-07-07', now: later })
ok('a 90-minute session ends inside noon: 09:00 … 10:30 (7 starts)', ninety.length === 7)

/* ---- A TYPE THAT HAPPENS AT A FIXED TIME ----
   Two kinds of thing are booked and they are not the same: most are "whenever suits us", and the
   host's hours decide; a weekly call happens at seven on Tuesday whether anybody books or not. The
   scheduler asks the recurrence for the second kind and never opens the hours — this pins the
   arithmetic behind that, which is the part that goes wrong across a clocks change. */
{
  const call = { every: 'week', on: ['tuesday'], at: '19:00', zone: 'Europe/London' }
  const from = Date.parse('2026-09-24T00:00:00Z')
  const on = occurrences(call, { from, to: from + 30 * 864e5, limit: 50 })
  ok('a weekly call offers its own Tuesdays and nothing else',
    on.length === 4 && on.every((o) => new Date(o.start).getUTCDay() === 2))
  ok('…at the hour it says, in its own zone',
    new Date(on[0].start).toISOString() === '2026-09-29T18:00:00.000Z')   /* 19:00 BST */
  /* THE CLOCKS CHANGE and the wall time wins: the same call is an hour later in UTC afterwards */
  const winter = occurrences(call, { from: Date.parse('2026-10-20T00:00:00Z'), to: Date.parse('2026-11-10T00:00:00Z'), limit: 50 })
  ok('across the clocks going back it is still seven o\'clock there',
    winter.some((o) => new Date(o.start).toISOString() === '2026-11-03T19:00:00.000Z'))
  ok('…which is a different hour in UTC from before, and that is the point',
    new Date(on[0].start).getUTCHours() === 18 && new Date(winter[winter.length - 1].start).getUTCHours() === 19)
  /* grouped for a reader the way the open hours are, so one surface draws both kinds */
  const days = byDay(on.map((o) => o.start), 'Europe/London')
  ok('grouped by day like any other times', Object.keys(days).length === 4)
}

/* ── BREATHING ROOM IS TWO NUMBERS, and the wider of the host's and the type's holds ────────────
   One number meant the same either side, which is not how anybody works: ten minutes to write a
   note after a call, none needed before it. */
{
  const busy1 = [{ start: Date.parse('2026-07-07T08:00:00Z'), end: Date.parse('2026-07-07T09:00:00Z') }]   /* 10:00–11:00 in Amsterdam */
  /* the file's `iso` is a full instant; these checks are about the clock on the host's wall */
  const wall = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: AMS, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms))
  const at = (h, ty) => openStarts({ hours: { ...hours, ...h }, type: { duration: 30, ...(ty || {}) }, busy: busy1, from: '2026-07-07', to: '2026-07-07', now: later }).map(wall)

  const none = at({})
  ok('with no room owed, the half hour straight after a call is offered', none.includes('11:00'))
  ok('and the one straight before it', none.includes('09:30'))

  const after = at({ buffer_after: 15 })
  ok('fifteen minutes after takes the slot at 11:00', !after.includes('11:00') && after.includes('11:15'))
  ok('and leaves the one before it alone', after.includes('09:30'))

  const before = at({ buffer_before: 15 })
  ok('fifteen minutes before takes the slot ending at 10:00', !before.includes('09:30') && before.includes('09:00'))
  ok('and leaves the one after it alone', before.includes('11:00'))

  /* THE WIDER WINS, whichever side it came from */
  const typeWider = at({ buffer_after: 10 }, { bufferAfter: 30 })
  ok('a type asking for more room than the host keeps gets it', !typeWider.includes('11:15') && typeWider.includes('11:30'))
  const hostWider = at({ buffer_after: 30 }, { bufferAfter: 10 })
  ok('and a type asking for less never takes the host\'s away', !hostWider.includes('11:15') && hostWider.includes('11:30'))

  /* and the LONGER notice, for the same reason */
  const soon = Date.parse('2026-07-07T06:00:00Z')   /* 08:00 in Amsterdam, the morning of */
  const hostNotice = openStarts({ hours: { ...hours, notice_hours: 0 }, type: { duration: 30, notice: 48 }, busy: [], from: '2026-07-07', to: '2026-07-07', now: soon })
  ok('a type asking for more notice than the host gets it', hostNotice.length === 0)
  const typeNotice = openStarts({ hours: { ...hours, notice_hours: 48 }, type: { duration: 30, notice: 0 }, busy: [], from: '2026-07-07', to: '2026-07-07', now: soon })
  ok('and a type asking for less never shortens the host\'s', typeNotice.length === 0)
}

/*
 * WHOSE TURN IT IS — cal.com's ladder, a case per rung. Every one of these is a rota somebody would
 * otherwise have to trust without being able to check.
 */
{
  const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  ok('the host booked least takes it', share(three, { a: { count: 3 }, b: { count: 1 }, c: { count: 2 } }).id === 'b')
  ok('priority beats a lighter load', share([{ id: 'a', priority: 4 }, { id: 'b' }], { a: { count: 99 }, b: { count: 0 } }).id === 'a')
  /* 200% with eleven stands BELOW 100% with six (0.055 against 0.060); at twelve they are level */
  ok('weight is a percentage, not a count', share([{ id: 'a', weight: 200 }, { id: 'b' }], { a: { count: 11 }, b: { count: 6 } }).id === 'a')
  ok('and at twelve the weight is level, so the older turn wins', share([{ id: 'a', weight: 200, }, { id: 'b' }], { a: { count: 12, last: 500 }, b: { count: 6, last: 100 } }).id === 'b')
  ok('level on load, the least recently booked', share(three, { a: { count: 1, last: 300 }, b: { count: 1, last: 100 }, c: { count: 1, last: 200 } }).id === 'b')
  ok('a host never booked is the oldest turn there is', share([{ id: 'a' }, { id: 'b' }], { a: { count: 0, last: 1 }, b: { count: 0 } }).id === 'b')
  ok('a host who is not free is not in the draw', share(three, { a: { count: 0 }, b: { count: 0 }, c: { count: 0 } }, ['c']).id === 'c')
  ok('nobody free is nobody', share(three, {}, []) === null)
  /* a CANCELLED booking leaves the turn where it was: the caller counts only what is confirmed, and
     this pins that the function asks for nothing else */
  ok('only what the caller counted counts', share([{ id: 'a' }, { id: 'b' }], { a: { count: 0 }, b: { count: 2 } }).id === 'a')
  /* level all the way down, one at random — checked by distribution rather than by one draw */
  const seen = { a: 0, b: 0, c: 0 }
  for (let i = 0; i < 3000; i++) seen[share(three, { a: { count: 1, last: 5 }, b: { count: 1, last: 5 }, c: { count: 1, last: 5 } }).id]++
  ok('level to the bottom: at random, and every host is drawn', Object.values(seen).every((v) => v > 800))
  /* the joining credit: their share of what the rota has done, at their own weight */
  ok('a host joining is credited their share', joiningCredit([{ id: 'a' }, { id: 'b' }], { a: { count: 6 }, b: { count: 4 } }, 100) === 5)
  ok('at twice the weight, twice the credit', joiningCredit([{ id: 'a' }, { id: 'b' }], { a: { count: 6 }, b: { count: 4 } }, 200) === 10)
  ok('a rota that has done nothing credits nothing', joiningCredit([{ id: 'a' }], { a: { count: 0 } }, 100) === 0)
}

/*
 * WHAT A TYPE OFFERS — each step of offer() on fixed numbers, and their order.
 */
{
  const hrs = (weekly) => ({ timezone: 'UTC', weekly, overrides: [], buffer_before: 0, buffer_after: 0, notice_hours: 0, max_per_day: 0 })
  const MON = '2026-10-05', TUE = '2026-10-06'   /* a Monday and the Tuesday after */
  const at = (o) => new Date(o.start).toISOString().slice(11, 16)
  const A = { id: 'a', hours: hrs({ 1: [['09:00', '12:00']] }), busy: [] }
  const B = { id: 'b', hours: hrs({ 1: [['10:00', '11:00']] }), busy: [] }
  const hour = { duration: 60, step: 60 }
  const union = offer({ type: hour, hosts: [A, B], from: MON, to: MON, now: 0 })
  ok('one host or a rota: the union, anybody free opens the time', union.map(at).join() === '09:00,10:00,11:00')
  ok('and the answer says who is free at each', union[1].hosts.sort().join('+') === 'a+b' && union[0].hosts.join() === 'a')
  const coll = offer({ type: { ...hour, assign: 'collective' }, hosts: [A, B], from: MON, to: MON, now: 0 })
  ok('collective: the intersection, because everybody comes', coll.map(at).join() === '10:00')
  /* a fixed host comes to every booking, so a time they do not keep is no time at all */
  const withFixed = offer({ type: { ...hour, assign: 'round-robin', fixed: ['b'] }, hosts: [A, B, { id: 'c', hours: hrs({ 1: [['09:00', '12:00']] }), busy: [] }], from: MON, to: MON, now: 0 })
  ok('round robin with a fixed host: the rota intersected with the fixed one', withFixed.map(at).join() === '10:00')
  /* the grid the type shows: its own step from its own offset */
  const offsetted = offer({ type: { duration: 30, step: 60, offset: 15 }, hosts: [A], from: MON, to: MON, now: 0 })
  ok('the offset moves the grid', offsetted.map(at).join() === '09:15,10:15,11:15')
  /* the window it will take bookings in */
  const rolling = offer({ type: hour, hosts: [A], from: MON, to: TUE, now: Date.UTC(2026, 9, 5, 0), windowDays: 0 })
  ok('no window offers every day asked for', rolling.length === 3)
  const shut = offer({ type: { ...hour, windowTo: '2026-10-04' }, hosts: [A], from: MON, to: MON, now: 0 })
  ok('a window that has closed offers nothing', shut.length === 0)
  const opens = offer({ type: { ...hour, windowFrom: '2026-10-06' }, hosts: [A], from: MON, to: MON, now: 0 })
  ok('a window not yet open offers nothing', opens.length === 0)
  /* the type's own limits, over what it already holds — a cap is reached, not approached */
  const A2 = { id: 'a', hours: hrs({ 1: [['09:00', '12:00']], 2: [['09:00', '12:00']] }), busy: [] }
  const both = offer({ type: hour, hosts: [A2], from: MON, to: TUE, now: 0 })
  ok('two days, three each', both.length === 6)
  const capped = offer({ type: { ...hour, limits: { day: 1 } }, hosts: [A2], from: MON, to: TUE, now: 0, taken: [{ start: Date.UTC(2026, 9, 5, 9), end: Date.UTC(2026, 9, 5, 10) }] })
  ok('a day at its count offers nothing more that day, and the next day is untouched', capped.length === 3 && capped.every((o) => o.start >= Date.UTC(2026, 9, 6)))
  const minutes = offer({ type: { ...hour, limits: { minutesDay: 90 } }, hosts: [A2], from: MON, to: MON, now: 0, taken: [{ start: Date.UTC(2026, 9, 5, 9), end: Date.UTC(2026, 9, 5, 10) }] })
  ok('a cap in minutes counts the session about to be booked', minutes.length === 0)
  /* and the ORDER: a host busy at a time is out before assignment, not after */
  const busyB = { ...B, busy: [{ start: Date.UTC(2026, 9, 5, 10), end: Date.UTC(2026, 9, 5, 11) }] }
  ok('a collective type whose one host is busy offers nothing', offer({ type: { ...hour, assign: 'collective' }, hosts: [A, busyB], from: MON, to: MON, now: 0 }).length === 0)
  ok('and as a rota the other host still opens it', offer({ type: hour, hosts: [A, busyB], from: MON, to: MON, now: 0 }).map(at).join() === '09:00,10:00,11:00')
}

/* THE HOST'S OWN WEEK, and which cap a time is past */
{
  const hrs = (weekly, extra) => ({ timezone: 'UTC', weekly, overrides: [], buffer_before: 0, buffer_after: 0, notice_hours: 0, max_per_day: 0, ...extra })
  const week = { 1: [['09:00', '12:00']], 2: [['09:00', '12:00']], 3: [['09:00', '12:00']] }
  const MON = '2026-10-05', WED = '2026-10-07'
  const busy = [{ start: Date.UTC(2026, 9, 5, 9), end: Date.UTC(2026, 9, 5, 10) }, { start: Date.UTC(2026, 9, 6, 9), end: Date.UTC(2026, 9, 6, 10) }]
  const plain = openStarts({ hours: hrs(week), type: { duration: 60, step: 60 }, busy, from: MON, to: WED, now: 0 })
  ok('three mornings less the two taken', plain.length === 7)
  const capped = openStarts({ hours: hrs(week, { max_per_week: 2 }), type: { duration: 60, step: 60 }, busy, from: MON, to: WED, now: 0 })
  ok('a week at its cap offers nothing more that week, whichever day', capped.length === 0)
  /* the NEXT week is untouched: a cap is a week's, not a run of days */
  const next = openStarts({ hours: hrs(week, { max_per_week: 2 }), type: { duration: 60, step: 60 }, busy, from: '2026-10-12', to: '2026-10-14', now: 0 })
  ok('and the week after is untouched', next.length === 9)
  /* which cap a time is past, so a booking can say */
  const taken = [{ start: Date.UTC(2026, 9, 5, 9), end: Date.UTC(2026, 9, 5, 10) }]
  ok('under every cap: nothing to say', overLimit({ duration: 60, limits: { day: 2 } }, Date.UTC(2026, 9, 5, 11), taken) === null)
  ok('the day, named', (overLimit({ duration: 60, limits: { day: 1 } }, Date.UTC(2026, 9, 5, 11), taken) || {}).span === 'day')
  ok('the week, named', (overLimit({ duration: 60, limits: { week: 1 } }, Date.UTC(2026, 9, 7, 11), taken) || {}).span === 'week')
  ok('and the minutes, counting the one about to be booked', (overLimit({ duration: 60, limits: { minutesDay: 90 } }, Date.UTC(2026, 9, 5, 11), taken) || {}).span === 'minutesDay')
  ok('with the limit it met', (overLimit({ duration: 60, limits: { day: 1 } }, Date.UTC(2026, 9, 5, 11), taken) || {}).limit === 1)
}

console.log(bad ? `✖ times: ${n - bad}/${n}` : `✔ times: ${n}/${n} checks`)
process.exit(bad ? 1 : 0)
