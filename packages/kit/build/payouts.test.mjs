/*
 * WHAT THE BUSINESS OWES, pinned on fixed numbers. Three claims are worth a test rather than a
 * paragraph, because each of them is a way a ledger goes wrong quietly:
 *
 *   A SHARE OF A PERIOD IS REFUSED WHERE IT IS WRITTEN. There is no one payment for a week to be a
 *   share of, so "12% monthly" can only ever come to a number nobody can point at. It is refused by
 *   the pure rule, by the database's check constraint, and by the form.
 *
 *   A REFUND REVERSES IN PROPORTION AND NEVER MORE. Half the payment back is half the amount back;
 *   a rounding that gave back a penny more than it earned is a ledger that drifts, and a reversal
 *   bigger than the balance is not an invoice to a provider.
 *
 *   EARNED, PAYABLE, WAITING AND SENT ARE FOUR DIFFERENT NUMBERS. A page that shows one of them and
 *   calls it the other is the reason somebody thinks they have been underpaid.
 *
 * What the database does with the rules — the sweep, the reversal, the balance — is
 * build/payouts-db.test.mjs against the local stack.
 */
import { TRIGGERS, AMOUNTS, ruleFault, amountOf, payableAt, reversalOf, balanceOf, linesFor, spanMinutes } from '../src/lib/payouts.js'
import { payoutStatusIsSettled } from '../supabase/functions/_shared/payment-provider.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nPAYOUTS\n')

/* --- the shapes a rule may take --- */
ok('three triggers and no more', TRIGGERS.join() === 'weekly,monthly,booking')
ok('two amounts and no more', AMOUNTS.join() === 'fixed,share')

const retainer = { trigger: 'monthly', amount_kind: 'fixed', amount: 40000, currency: 'usd', active: true }
const share = { trigger: 'booking', booking_type: 'coaching-session', amount_kind: 'share', amount: 1250, currency: 'usd', active: true }
const perCall = { trigger: 'booking', booking_type: 'coaching-session', amount_kind: 'fixed', amount: 5000, currency: 'usd', active: true }

ok('a monthly retainer is a rule', ruleFault(retainer) === null)
ok('a share of a booking is a rule', ruleFault(share) === null)
ok('a flat amount per booking is a rule', ruleFault(perCall) === null)

/* the one refusal the whole model rests on */
ok('a share of a month is refused', /share of/.test(ruleFault({ ...share, trigger: 'monthly', booking_type: null }) || ''))
ok('a share of a week is refused', /share of/.test(ruleFault({ ...share, trigger: 'weekly', booking_type: null }) || ''))
ok('a booking rule names its type', /names which booking type/.test(ruleFault({ ...perCall, booking_type: null }) || ''))
ok('an amount of nothing is refused', ruleFault({ ...perCall, amount: 0 }) !== null)
ok('a negative amount is refused', ruleFault({ ...perCall, amount: -100 }) !== null)
ok('a share above all of it is refused', /at most all of it/.test(ruleFault({ ...share, amount: 10001 }) || ''))
ok('a share of exactly all of it stands', ruleFault({ ...share, amount: 10000 }) === null)
ok('an unknown trigger is refused', ruleFault({ ...perCall, trigger: 'daily' }) !== null)
ok('nothing at all is refused', ruleFault(null) !== null)

/* --- what a rule comes to --- */
ok('a share is basis points', amountOf(share, 8000) === 1000)
ok('a share rounds to the penny', amountOf({ ...share, amount: 3333 }, 10000) === 3333)
ok('a fixed amount ignores what was collected', amountOf(perCall, 8000) === 5000 && amountOf(perCall, 0) === 5000)
/* a booking that was free still happened, and a line of nothing is the honest record of it */
ok('a share of nothing is nothing', amountOf(share, 0) === 0)
ok('a share of nothing is a number, not nothing at all', amountOf(share, 0) === 0 && typeof amountOf(share, 0) === 'number')

/* --- when it may be sent --- */
const collected = '2026-09-01T12:00:00.000Z'
ok('a 30-day delay is 30 days', payableAt(collected, 30 * 1440) === '2026-10-01T12:00:00.000Z')
ok('no delay is at once', payableAt(collected, 0) === collected)
ok('the clock runs from the money, not the call', payableAt(collected, 1440) === '2026-09-02T12:00:00.000Z')

/* --- an initiated payout is not a completed payout --- */
ok('a successful payout is settled', payoutStatusIsSettled('success'))
ok('a succeeded payout is settled', payoutStatusIsSettled('SUCCEEDED'))
ok('an initiated payout remains unsettled', !payoutStatusIsSettled('initiated'))
ok('a pending payout remains unsettled', !payoutStatusIsSettled('pending'))
ok('a processing payout remains unsettled', !payoutStatusIsSettled('processing'))

/* --- a refund reverses in proportion and never more --- */
const line = { amount: 1000 }
ok('all of it back is all of it back', reversalOf(line, 8000, 8000) === 1000)
ok('half of it back is half of it back', reversalOf(line, 4000, 8000) === 500)
ok('more back than was paid is still only what was earned', reversalOf(line, 99999, 8000) === 1000)
ok('a third back rounds to the penny', reversalOf(line, 2666, 8000) === 333)
ok('nothing back is nothing', reversalOf(line, 0, 8000) === 0)
ok('a line of nothing reverses nothing', reversalOf({ amount: 0 }, 8000, 8000) === 0)
ok('a refund of a payment of nothing takes the line whole', reversalOf(line, 500, 0) === 1000)

/* --- the four numbers --- */
const now = Date.parse('2026-09-20T00:00:00.000Z')
const lines = [
  { amount: 1000, payable_at: '2026-09-10T00:00:00.000Z' },                        /* released */
  { amount: 500, payable_at: '2026-09-30T00:00:00.000Z' },                         /* still held */
  { amount: 300, payable_at: '2026-09-05T00:00:00.000Z', paid_at: '2026-09-06T00:00:00.000Z' }, /* gone */
]
const b = balanceOf(lines, now)
ok('earned is everything', b.earned === 1800)
ok('payable is what the delay released and nothing paid', b.payable === 1000)
ok('waiting is what the delay still holds', b.waiting === 500)
ok('sent is what went', b.sent === 300)
ok('owed is the payable', b.owed === 1000)
ok('no lines is four zeroes', JSON.stringify(balanceOf([], now)) === JSON.stringify({ earned: 0, payable: 0, waiting: 0, sent: 0, owed: 0 }))

/* a reversal is a line with a negative amount, so it simply sums */
/* A LINE A REFUND CAUGHT INSIDE THE WINDOW is out of all four: the money went back, and a figure
   counted as earned but never payable, never waiting and never sent is a figure with no home. */
const caught = balanceOf([...lines, { amount: 700, payable_at: 'infinity' }], now)
ok('a line caught inside the window is not earned', caught.earned === 1800)
ok('nor payable, nor waiting, nor sent', caught.payable === 1000 && caught.waiting === 500 && caught.sent === 300)
ok('but one already sent is still sent, whatever its date says', balanceOf([{ amount: 700, payable_at: 'infinity', paid_at: '2026-09-01T00:00:00.000Z' }], now).sent === 700)

const reversed = balanceOf([...lines, { amount: -1000, payable_at: '2026-09-11T00:00:00.000Z' }], now)
ok('a reversal sums', reversed.earned === 800 && reversed.payable === 0)
/* and a reversal bigger than the balance is not a demand */
const overdrawn = balanceOf([{ amount: 300, payable_at: '2026-09-01T00:00:00.000Z' }, { amount: -900, payable_at: '2026-09-02T00:00:00.000Z' }], now)
ok('a reversal never asks a provider for money', overdrawn.payable === 0 && overdrawn.owed === 0)
ok('but the earning still shows what happened', overdrawn.earned === -600)

/* --- the lines one booking makes --- */
const booking = { uid: 'ns_a1', type: 'coaching-session', end_at: '2026-09-01T13:00:00.000Z', collected_at: collected }
/* a retainer and a share together: the mix James asked for, as two rows */
const made = linesFor({ rules: [retainer, share, perCall], booking, collected: 8000, delay: 30 * 1440 })
ok('the period rule does not fire on a booking', made.length === 2)
ok('the share is a share of the payment', made.some((l) => l.amount === 1000))
ok('the flat one is flat', made.some((l) => l.amount === 5000))
ok('each line says which rule made it', made.every((l) => 'rule_id' in l))
ok('each line is payable from when the money came', made.every((l) => l.payable_at === '2026-10-01T12:00:00.000Z'))
ok('each line is earned when the call ended', made.every((l) => l.earned_at === booking.end_at))
ok('another booking type earns nothing', linesFor({ rules: [share], booking: { ...booking, type: 'discovery-call' }, collected: 8000 }).length === 0)
ok('an inactive rule earns nothing', linesFor({ rules: [{ ...share, active: false }], booking, collected: 8000 }).length === 0)
ok('a faulty rule earns nothing', linesFor({ rules: [{ ...share, trigger: 'weekly' }], booking, collected: 8000 }).length === 0)
ok('no rules is no lines', linesFor({ booking, collected: 8000 }).length === 0)

/* --- the delay as the policy writes it --- */
ok('30d is thirty days', spanMinutes('30d') === 43200)
ok('a bare number is days', spanMinutes('30') === 43200)
ok('2w is a fortnight', spanMinutes('2w') === 20160)
ok('12h is half a day', spanMinutes('12h') === 720)
ok('45m is minutes', spanMinutes('45m') === 45)
ok('0d is no delay at all', spanMinutes('0d') === 0)
ok('nonsense is nothing', spanMinutes('soon') === null && spanMinutes('') === null && spanMinutes(null) === null)

console.log('\n  ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''))
if (fail) process.exit(1)
