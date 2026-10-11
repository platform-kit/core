/* When something happens again: the rule read as fields, the occurrences it makes, the daylight
   saving it survives, and the plain words it is said in. No clock of its own — every case names
   the moment it reckons from. */
import { occurrences, nextAfter, describe, problems, spanMs, instantOf } from '../src/lib/recurrence.js'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const at = (s) => Date.parse(s)
/* an occurrence as the clock in its own zone reads it, which is the only reading that matters */
const said = (ms, zone) => new Date(ms).toLocaleString('en-GB', { timeZone: zone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const list = (r, from, to, zone = r.zone || 'UTC') =>
  occurrences(r, { from: at(from), to: at(to) }).map((o) => said(o.start, zone))

/* ---- a span ---- */
ok('minutes', spanMs('90m') === 5400000)
ok('hours', spanMs('2h') === 7200000)
ok('a number alone is minutes, which is what people mean', spanMs(45) === 2700000)
ok('nonsense is not a span', spanMs('a while') === null && spanMs('') === null)

/* ---- what is wrong with a rule ---- */
ok('a rule says how often', problems({}).length === 1)
ok('and it must be one of the four', problems({ every: 'fortnight' }).length === 1)
ok('a time is a time', problems({ every: 'week', at: 'sevenish' }).length === 1)
ok('a sound rule has nothing wrong with it', problems({ every: 'week', on: ['tuesday'], at: '19:00' }).length === 0)

/* ---- every week ---- */
{
  const r = { every: 'week', on: ['tuesday'], at: '19:00', zone: 'Europe/London', lasts: '90m' }
  const got = list(r, '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z')
  ok('every Tuesday in March', got.length === 5, got.join(' | '))
  ok('and each is a Tuesday at seven by its own clock', got.every((s) => /^Tue/.test(s) && /19:00/.test(s)), got[0])
  /* the clocks went forward on 29 March 2026: seven o'clock is seven o'clock on both sides of it */
  const across = list(r, '2026-03-20T00:00:00Z', '2026-04-10T00:00:00Z')
  ok('a spring forward does not move the hour', across.every((s) => /19:00/.test(s)), across.join(' | '))
  const utc = occurrences(r, { from: at('2026-03-20T00:00:00Z'), to: at('2026-04-10T00:00:00Z') })
  ok('…which means the instant DOES move, by the hour the clocks did',
    new Date(utc[0].start).getUTCHours() === 19 && new Date(utc[utc.length - 1].start).getUTCHours() === 18,
    utc.map((o) => new Date(o.start).toISOString()).join(' | '))
  ok('an occurrence knows when it ends', utc[0].end - utc[0].start === 5400000)
}

/* ---- a set of days, and every other week ---- */
ok('weekdays is five days', list({ every: 'week', on: 'weekdays', at: '09:00' }, '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z').length === 5)
ok('weekends is two', list({ every: 'week', on: 'weekends', at: '09:00' }, '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z').length === 2)
{
  const r = { every: 'week', interval: 2, on: ['monday'], at: '10:00', from: '2026-06-01' }
  const got = list(r, '2026-06-01T00:00:00Z', '2026-07-13T00:00:00Z')
  ok('every other Monday counts from the rule\'s own start', got.length === 3, got.join(' | '))
}

/* ---- every month ---- */
{
  const third = list({ every: 'month', on: [{ nth: 3, day: 'friday' }], at: '18:00' }, '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')
  ok('every third Friday', third.length === 4, third.join(' | '))
  ok('…and each is the third Friday', /^Fri,? 16 Jan/.test(third[0]), third[0])
  const last = list({ every: 'month', on: [{ nth: -1, day: 'friday' }], at: '18:00' }, '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z')
  ok('the last Friday of the month', /^Fri,? 30 Jan/.test(last[0]), last.join(' | '))
  const dated = list({ every: 'month', on: [{ date: 1 }], at: '09:00' }, '2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z')
  ok('the first of the month', dated.length === 3, dated.join(' | '))
  const end = list({ every: 'month', on: [{ date: 31 }], at: '09:00' }, '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')
  ok('the 31st in a month that has no 31st falls on its last day', end.length === 4, end.join(' | '))
}

/* ---- every year ---- */
{
  const july = list({ every: 'year', on: [{ date: 4, month: 'july' }], at: '12:00' }, '2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z')
  ok('every 4th of July', july.length === 3 && july[0].includes('Jul'), july.join(' | '))
}

/* ---- an end ---- */
{
  const counted = occurrences({ every: 'week', on: ['tuesday'], at: '19:00', count: 4, from: '2026-06-02' },
    { from: at('2026-06-01T00:00:00Z'), to: at('2027-01-01T00:00:00Z') })
  ok('a count stops it', counted.length === 4, String(counted.length))
  const until = occurrences({ every: 'week', on: ['tuesday'], at: '19:00', until: '2026-06-30' },
    { from: at('2026-06-01T00:00:00Z'), to: at('2027-01-01T00:00:00Z') })
  ok('so does a date', until.length === 5, String(until.length))
  const skipped = list({ every: 'day', at: '09:00', except: ['2026-06-03'] }, '2026-06-01T00:00:00Z', '2026-06-06T00:00:00Z')
  ok('a day it does not happen is left out', skipped.length === 4 && !skipped.some((s) => s.includes('03 Jun')), skipped.join(' | '))
}

/* ---- the window ---- */
{
  const r = { every: 'week', on: ['tuesday'], at: '19:00' }
  const mid = occurrences(r, { from: at('2026-06-09T20:00:00Z'), to: at('2026-06-24T00:00:00Z') })
  ok('an occurrence already begun is not in a window that starts after it', mid.length === 2, String(mid.length))
  ok('nothing at all is an empty list, never a crash', occurrences(null, { from: 0, to: 1 }).length === 0)
  ok('a rule with nothing wrong and no window is still finite', occurrences(r, { from: at('2026-01-01T00:00:00Z'), to: at('2036-01-01T00:00:00Z'), limit: 10 }).length === 10)
}

/* ---- the next one ---- */
{
  const n = nextAfter({ every: 'week', on: ['tuesday'], at: '19:00', zone: 'UTC' }, at('2026-06-10T00:00:00Z'))
  ok('the next Tuesday after a Wednesday is six days off', new Date(n.start).toISOString().startsWith('2026-06-16'), new Date(n.start).toISOString())
  ok('a spent rule has no next', nextAfter({ every: 'week', on: ['tuesday'], until: '2020-01-01' }, at('2026-06-10T00:00:00Z')) === null)
}

/* ---- an hour the clock skipped ---- */
{
  /* 29 March 2026, 01:00 → 02:00 in London: half past one did not happen that day */
  ok('an instant that the clock never read is not one', instantOf({ y: 2026, mo: 3, d: 29, h: 1, mi: 30 }, 'Europe/London') === null)
  const r = { every: 'week', on: ['sunday'], at: '01:30', zone: 'Europe/London' }
  const got = list(r, '2026-03-22T00:00:00Z', '2026-04-06T00:00:00Z')
  ok('…so that week it does not happen, rather than happening at another time', got.length === 2, got.join(' | '))
}

/* ---- said in words ---- */
ok('every Tuesday', describe({ every: 'week', on: ['tuesday'], at: '19:00' }) === 'Every Tuesday at 7pm')
ok('with a length', describe({ every: 'week', on: ['tuesday'], at: '19:00', lasts: '90m' }).endsWith('90 minutes'))
ok('two days', describe({ every: 'week', on: ['monday', 'thursday'], at: '08:30' }) === 'Every Monday and Thursday at 8:30am')
ok('weekdays by their own word', describe({ every: 'week', on: 'weekdays', at: '09:00' }) === 'Every weekday at 9am')
ok('a date of the month reads as one', describe({ every: 'month', on: [{ date: 3 }] }) === 'Every month on the 3rd')
ok('and two of them', describe({ every: 'month', on: [{ date: 1 }, { date: 15 }] }) === 'Every month on the 1st and 15th')
ok('a whole hour is an hour', describe({ every: 'week', on: ['tuesday'], lasts: '60m' }).endsWith('1 hour'))
ok('and two and a half are said as that', describe({ every: 'week', on: ['tuesday'], lasts: '150m' }).endsWith('2.5 hours'))
ok('every other week', describe({ every: 'week', interval: 2, on: ['monday'] }) === 'Every other Monday')
ok('the third Friday', describe({ every: 'month', on: [{ nth: 3, day: 'friday' }], at: '18:00' }) === 'Every third Friday of the month at 6pm')
ok('a yearly date', describe({ every: 'year', on: [{ date: 4, month: 'july' }] }) === 'Every July 4th')
ok('an end is said too', describe({ every: 'week', on: ['tuesday'], until: '2027-01-01' }).includes('until January 1, 2027'))
ok('and a count', describe({ every: 'week', on: ['tuesday'], count: 6 }).includes('6 times'))
ok('a rule that is wrong says nothing rather than something misleading', describe({ every: 'fortnight' }) === '')

console.log('\nrecurrence: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
