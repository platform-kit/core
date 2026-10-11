/* What is on, as a surface asks for it: what "today" means to the person reading, what to call the
   gap before something starts, whether it is on right now, and the gathering by day that makes a
   calendar a calendar. Every case names its own moment; nothing here reads the clock. */
import { whenWord, clockOf, stampOf, untilWord, isOn, byDay, dayOf } from '../src/lib/spaces/model.js'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const at = (s) => Date.parse(s)
const W = { today: 'Today', tomorrow: 'Tomorrow' }
const U = { now: 'On now', mins: 'in {n}m', hours: 'in {n}h', days: 'in {n}d' }

/* --- the day something falls on is the reader's day, not the server's --- */
{
  /* half past eleven at night in London is the next morning in Tokyo, and the calendar of somebody
     in Tokyo has to say so */
  const late = at('2026-06-10T22:30:00Z')
  ok('a day is read in the zone it is read in',
    dayOf(late, 'Europe/London') === '2026-06-10' && dayOf(late, 'Asia/Tokyo') === '2026-06-11',
    dayOf(late, 'Europe/London') + ' vs ' + dayOf(late, 'Asia/Tokyo'))
}

/* --- today, tomorrow, the weekday, the date --- */
{
  const now = at('2026-06-10T09:00:00Z')
  ok('today', whenWord(at('2026-06-10T19:00:00Z'), now, W, 'UTC') === 'Today')
  ok('tomorrow', whenWord(at('2026-06-11T19:00:00Z'), now, W, 'UTC') === 'Tomorrow')
  ok('a day this week is its own name', whenWord(at('2026-06-13T19:00:00Z'), now, W, 'UTC') === 'Saturday')
  /* past the week a weekday means nothing — "Saturday" could be any of four */
  const far = whenWord(at('2026-07-20T19:00:00Z'), now, W, 'UTC')
  ok('and anything further off is a date', /\d/.test(far) && !/day$/.test(far), far)
  ok('yesterday is not today', whenWord(at('2026-06-09T19:00:00Z'), now, W, 'UTC') !== 'Today')
}

/* --- how long until --- */
{
  const now = at('2026-06-10T09:00:00Z')
  ok('minutes while it is minutes', untilWord(now + 5 * 60000, now, U) === 'in 5m')
  ok('hours after that', untilWord(now + 3 * 3600000, now, U) === 'in 3h')
  ok('days after that', untilWord(now + 2 * 86400000, now, U) === 'in 2d')
  ok('and once it has begun it is on', untilWord(now - 60000, now, U) === 'On now')
  ok('a minute away is never nought minutes', untilWord(now + 20000, now, U) === 'in 1m')
}

/* --- on now, with a little grace --- */
{
  const o = { starts_at: '2026-06-10T19:00:00Z', ends_at: '2026-06-10T20:30:00Z' }
  ok('during it', isOn(o, at('2026-06-10T19:30:00Z')))
  ok('a few minutes early, because people arrive early', isOn(o, at('2026-06-10T18:55:00Z')))
  ok('not an hour early', !isOn(o, at('2026-06-10T18:00:00Z')))
  ok('a few minutes over, because they run over', isOn(o, at('2026-06-10T20:35:00Z')))
  ok('not an hour over', !isOn(o, at('2026-06-10T21:30:00Z')))
  /* one with no end is given an hour, which is what a thing with no end usually is */
  ok('no end is an hour', isOn({ starts_at: '2026-06-10T19:00:00Z' }, at('2026-06-10T19:45:00Z'))
    && !isOn({ starts_at: '2026-06-10T19:00:00Z' }, at('2026-06-10T20:30:00Z')))
  ok('nothing is not on', !isOn(null, Date.now()) && !isOn({}, Date.now()))
}

/* --- gathered by day, which is what makes it a calendar --- */
{
  const list = [
    { id: 'c', starts_at: '2026-06-12T09:00:00Z' },
    { id: 'a', starts_at: '2026-06-10T19:00:00Z' },
    { id: 'b', starts_at: '2026-06-10T21:00:00Z' },
  ]
  const days = byDay(list, 'UTC')
  ok('one group per day', days.length === 2, String(days.length))
  ok('in the order they happen', days[0].day === '2026-06-10' && days[1].day === '2026-06-12')
  ok('and two on one day are both under it', days[0].items.length === 2)
  ok('nothing at all is no days', byDay([], 'UTC').length === 0 && byDay(undefined, 'UTC').length === 0)
}

/* --- the clock --- */
ok('a time is said in the reader\'s own terms', /\d/.test(clockOf(at('2026-06-10T19:00:00Z'), 'UTC')))
ok('and in their zone', clockOf(at('2026-06-10T19:00:00Z'), 'UTC') !== clockOf(at('2026-06-10T19:00:00Z'), 'Asia/Tokyo'))

/* --- a stamp on something that may be months old --- */
{
  const now = Date.parse('2026-06-10T12:00:00Z')
  ok('today is the time alone', stampOf(now - 3600000, now, 'UTC') === '11:00 AM', stampOf(now - 3600000, now, 'UTC'))
  ok('an older day says which day', /Jun 2/.test(stampOf(now - 8 * 86400000, now, 'UTC')))
  ok('and another year says which year', /2025/.test(stampOf(now - 400 * 86400000, now, 'UTC')))
  ok('nothing stamps as nothing', stampOf(null, now) === '' && stampOf('not a date', now) === '')
}

console.log('\ncalendar: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
