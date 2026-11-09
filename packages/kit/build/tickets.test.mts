/* The work, as against the conversation: what state a ticket is in, what is owed on one, how a
   list is ordered and narrowed, and the counts a desk wants at a glance. Pure — every case names
   the moment it reckons from. */
import { STATES, LIVE, PRIORITIES, isLive, isOwed, sortTickets, owedOn, ageOf, tally, narrow, statusOfTicket, priorityOf } from '../src/lib/desk/shape.js'

let pass = 0, fail = 0
const ok = (msg: string, cond: boolean, detail?: string|undefined) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const t0 = Date.parse('2026-06-10T12:00:00Z')
const H = 3600000
const ago = (h: number) => new Date(t0 - h * H).toISOString()
const soon = (h: number) => new Date(t0 + h * H).toISOString()
const W = { 'due-in': 'Due in {span}', 'due-over': 'Overdue by {span}', waiting: 'Waiting {span}' }

/* --- what a state means --- */
/* A TICKET IS OPEN OR IT IS RESOLVED. It had five, and three of them — doing, waiting, closed —
   were a guess about how one business works: "In hand" and "With them" assume a queue with a
   handover in it, and a ticket here may be a SaaS bug or a coaching question. What "With them" was
   reaching for is a FACT and not a state, and it is isOwed. */
ok('two states, and open is the first', STATES.length === 2 && STATES[0] === 'open' && STATES[1] === 'resolved')
ok('one of them is live work', LIVE.length === 1 && !LIVE.includes('resolved'))
ok('open is live', isLive({ status: 'open' }))
ok('finished is not', !isLive({ status: 'resolved' }) && !isLive(null))
/* a row written under the old shape still reads: what each word meant is carried, not guessed */
ok('a ticket in hand is an open one', isLive({ status: 'doing' }) && statusOfTicket({ status: 'doing' }) === 'open')
ok('a ticket with them is an open one', isLive({ status: 'waiting' }) && statusOfTicket({ status: 'waiting' }) === 'open')
ok('a closed one is resolved', !isLive({ status: 'closed' }) && statusOfTicket({ status: 'closed' }) === 'resolved')
ok('an urgent one is a high one', priorityOf({ priority: 'urgent' }) === 'high')
ok('three urgencies', PRIORITIES.length === 3 && !PRIORITIES.includes('urgent'))
ok('an open one somebody is waiting on does', isOwed({ status: 'open', waiting_since: ago(3) }))
ok('and one nobody is waiting on does not', !isOwed({ status: 'open', waiting_since: null }))

/* --- what is owed, in the same words the queues use --- */
{
  const due: any = owedOn({ status: 'open', due_at: soon(5) }, W, t0)
  ok('a due date reads as time left', due.text === 'Due in 5h' && due.over === false, JSON.stringify(due))
  const late: any = owedOn({ status: 'open', due_at: ago(26) }, W, t0)
  ok('and past it, as time over, in the desk\'s own spans', late.text === 'Overdue by 26h' && late.over === true, JSON.stringify(late))
  ok('which become days once there are days of it', (owedOn({ status: 'open', due_at: ago(24 * 5) }, W, t0) as any).text === 'Overdue by 5d')
  const waiting: any = owedOn({ status: 'open', waiting_since: ago(2) }, W, t0)
  ok('with no date, how long they have waited', waiting.text === 'Waiting 2h' && waiting.soft === true)
  ok('a due date wins over a wait, because it is a promise',
    (owedOn({ status: 'open', due_at: soon(3), waiting_since: ago(9) }, W, t0) as any).text === 'Due in 3h')
  ok('nothing is owed on finished work', owedOn({ status: 'resolved', due_at: ago(99) }, W, t0) === null)
  ok('or on one with neither', owedOn({ status: 'open' }, W, t0) === null)
}

/* --- how long it has been open --- */
ok('an age is said in the desk\'s own spans', ageOf({ created_at: ago(72) }, t0) === '3d', ageOf({ created_at: ago(72) }, t0))
ok('and nothing has no age', ageOf(null, t0) === '' && ageOf({}, t0) === '')

/* --- the order --- */
{
  const rows = [
    { id: 'n', priority: 'normal', last_at: ago(1), created_at: ago(50) },
    { id: 'u', priority: 'urgent', last_at: ago(9), created_at: ago(2) },
    { id: 'l', priority: 'low', last_at: ago(0.5), created_at: ago(100) },
    { id: 'h', priority: 'high', last_at: ago(30), created_at: ago(30) },
  ]
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ id: string; priority: string; last_at: string; created_at: string; }[]' is not assignable to parameter of type 'never[]'
  ok('busy: the urgent first, whatever moved last', sortTickets(rows, 'busy').map((r: any) => r.id).join('') === 'uhnl',
    // @ts-expect-error TS2345, from the conversion: Argument of type '{ id: string; priority: string; last_at: string; created_at: string; }[]' is not assignable to parameter of type 'never[]'
    sortTickets(rows, 'busy').map((r: any) => r.id).join(''))
  // @ts-expect-error TS2345, from the conversion: Argument of type '{ id: string; priority: string; last_at: string; created_at: string; }[]' is not assignable to parameter of type 'never[]'
  ok('new: the newest raised', (sortTickets(rows, 'new')[0] as any).id === 'u')
  const waited = [
    { id: 'a', waiting_since: ago(2), last_at: ago(1) },
    { id: 'b', waiting_since: ago(20), last_at: ago(3) },
    { id: 'c', waiting_since: null, last_at: ago(0.2) },
  ]
  ok('waiting: the longest wait first, and nobody waiting last',
    // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; waiting_since: string; last_at: string; } | { id: string; waiting_since: null; last_at: string; })[]' is no
    sortTickets(waited, 'waiting').map((r: any) => r.id).join('') === 'bac',
    // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; waiting_since: string; last_at: string; } | { id: string; waiting_since: null; last_at: string; })[]' is no
    sortTickets(waited, 'waiting').map((r: any) => r.id).join(''))
  const dated = [{ id: 'x', due_at: soon(40) }, { id: 'y', due_at: soon(2) }, { id: 'z', due_at: null }]
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; due_at: string; } | { id: string; due_at: null; })[]' is not assignable to parameter of type 'never[]'. Typ
  ok('due: the soonest, and no date last', sortTickets(dated, 'due').map((r: any) => r.id).join('') === 'yxz')
  // @ts-expect-error TS2345, from the conversion: Argument of type 'null' is not assignable to parameter of type 'never[] | undefined'.
  ok('sorting nothing is nothing', sortTickets(null).length === 0 && sortTickets([]).length === 0)
  ok('and the list handed in is not reordered under the caller',
    // @ts-expect-error TS2345, from the conversion: Argument of type '{ id: string; priority: string; last_at: string; created_at: string; }[]' is not assignable to parameter of type 'never[]'
    (() => { const r = [...rows]; sortTickets(r, 'busy'); return r[0].id === 'n' })())
}

/* --- narrowing --- */
{
  const me = 'me'
  const rows = [
    { id: '1', ref: 1041, title: 'Parcel never arrived', status: 'open', priority: 'high', assignees: [{ id: me }], contact: { name: 'Bea Buyer' } },
    { id: '2', ref: 1042, title: 'Refund for the hardcover', status: 'resolved', priority: 'normal', assignees: [], contact: { name: 'Ada' } },
    { id: '3', ref: 1043, title: 'Reprint the covers', status: 'doing', priority: 'urgent', assignees: [{ id: 'sam' }], contact: null },
    { id: '4', ref: 1044, title: 'Chase the carrier', status: 'waiting', priority: 'low', assignees: [], contact: { name: 'Bea Buyer' } },
  ]
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('open is the live work', narrow(rows, { status: 'open' }, me).length === 3)
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('a named state is that state', narrow(rows, { status: 'resolved' }, me).map((r: any) => r.id).join('') === '2')
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('all is all of it', narrow(rows, { status: 'all' }, me).length === 4)
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('mine is the ones I am on', narrow(rows, { status: 'open', assignee: 'mine' }, me).map((r: any) => r.id).join('') === '1')
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('nobody is the ones nobody is on', narrow(rows, { status: 'open', assignee: 'nobody' }, me).map((r: any) => r.id).join('') === '4')
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('one person is theirs', narrow(rows, { status: 'open', assignee: 'sam' }, me).map((r: any) => r.id).join('') === '3')
  /* row 3 was written 'urgent', which is now high: an old row narrows with the new ones rather
     than falling out of every filter a desk offers */
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('an urgency narrows to it, and carries the old word with it', narrow(rows, { status: 'all', priority: 'high' }, me).map((r: any) => r.id).join('') === '13')
  ok('awaiting a reply is a narrowing of its own, derived and never set', narrow([
    // @ts-expect-error TS2322, from the conversion: Type '{ id: string; status: string; waiting_since: string; }' is not assignable to type 'never'.
    { id: 'a', status: 'open', waiting_since: ago(3) },
    // @ts-expect-error TS2322, from the conversion: Type '{ id: string; status: string; waiting_since: null; }' is not assignable to type 'never'.
    { id: 'b', status: 'open', waiting_since: null },
    // @ts-expect-error TS2322, from the conversion: Type '{ id: string; status: string; waiting_since: string; }' is not assignable to type 'never'.
    { id: 'c', status: 'resolved', waiting_since: ago(9) },
  ], { status: 'owed' }, me).map((r: any) => r.id).join('') === 'a')
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('words look in the title', narrow(rows, { status: 'all', q: 'carrier' }, me).map((r: any) => r.id).join('') === '4')
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('…and in who it is about', narrow(rows, { status: 'all', q: 'bea' }, me).map((r: any) => r.id).join('') === '14')
  // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
  ok('a number finds the one it numbers', narrow(rows, { status: 'all', q: '1043' }, me).map((r: any) => r.id).join('') === '3')
  ok('and so does it with a hash, because that is how people write it',
    // @ts-expect-error TS2345, from the conversion: Argument of type '({ id: string; ref: number; title: string; status: string; priority: string; assignees: { id: string; }[]; contact: { name
    narrow(rows, { status: 'all', q: '#1043' }, me).map((r: any) => r.id).join('') === '3')
  // @ts-expect-error TS2345, from the conversion: Argument of type 'null' is not assignable to parameter of type 'never[] | undefined'.
  ok('narrowing nothing is nothing', narrow(null, {}, me).length === 0)

  // @ts-expect-error TS2345, from the conversion: Argument of type '({ waiting_since: string | null; id: string; ref: number; title: string; status: string; priority: string; assignees: { id
  const n = tally(rows.map((r) => ({ ...r, waiting_since: r.id === '1' ? ago(3) : null })), me)
  ok('the counts a desk wants', n.live === 3 && n.mine === 1 && n.unassigned === 1 && n.owed === 1, JSON.stringify(n))
}

console.log('\ntickets: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
