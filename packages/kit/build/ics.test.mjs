/* the calendar invitation: a booking, a move (SEQUENCE 1), a cancellation; the escaping and the folding */
import { ics, fold, escapeText } from '../supabase/functions/_shared/ics.js'
let n = 0, bad = 0
const ok = (name, c) => { n++; if (!c) { bad++; console.log('  ✗', name) } }
const base = { uid: 'ns_abc@example', start: '2026-07-07T07:00:00.000Z', end: '2026-07-07T08:00:00.000Z', summary: 'One on one', description: 'With Coach Person.\nBring one real situation.', location: 'The studio, Keizersgracht 123, Amsterdam', organizer: { name: 'Coach Person', email: 'coach@example.com' }, attendees: [{ name: 'Member Person', email: 'member@example.com' }], now: Date.UTC(2026, 6, 1, 12) }
const a = ics(base)
const un = (t) => t.replace(/\r\n /g, '')
ok('a request', a.includes('METHOD:REQUEST') && a.includes('STATUS:CONFIRMED') && a.includes('SEQUENCE:0'))
ok('the times in UTC', a.includes('DTSTART:20260707T070000Z') && a.includes('DTEND:20260707T080000Z') && a.includes('DTSTAMP:20260701T120000Z'))
ok('the place escaped', a.includes('LOCATION:The studio\\, Keizersgracht 123\\, Amsterdam'))
ok('the description keeps its line', a.includes('DESCRIPTION:With Coach Person.\\nBring one real situation.'))
ok('the people (unfolded)', un(a).includes('ORGANIZER;CN=Coach Person:mailto:coach@example.com') && un(a).includes('ATTENDEE;CN=Member Person;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:member@example.com'))
ok('CRLF line ends, the calendar closed', a.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(a))
const m = ics({ ...base, sequence: 1, start: '2026-07-07T09:00:00.000Z', end: '2026-07-07T10:00:00.000Z' })
ok('a move: the same uid, SEQUENCE 1, the new time', m.includes('UID:ns_abc@example') && m.includes('SEQUENCE:1') && m.includes('DTSTART:20260707T090000Z'))
const c = ics({ ...base, method: 'CANCEL', sequence: 2 })
ok('a cancellation', c.includes('METHOD:CANCEL') && c.includes('STATUS:CANCELLED') && un(c).includes('PARTSTAT=DECLINED') && c.includes('SEQUENCE:2'))
const long = 'DESCRIPTION:' + 'x'.repeat(200)
const f = fold(long)
ok('folded at 75 octets with a leading space', f.split('\r\n').length === 3 && f.split('\r\n')[0].length === 75 && f.split('\r\n')[1].startsWith(' ') && f.replace(/\r\n /g, '') === long)
ok('a character is never split', fold('SUMMARY:' + 'é'.repeat(80)).replace(/\r\n /g, '') === 'SUMMARY:' + 'é'.repeat(80))
ok('escapeText', escapeText('a;b,c\\d\ne') === 'a\;b\\,c\\\\d\\ne')
console.log(bad ? `✖ ics: ${n - bad}/${n}` : `✔ ics: ${n}/${n} checks`)
process.exit(bad ? 1 : 0)
