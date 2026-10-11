/*
 * WHAT THE BUSINESS OWES, as arithmetic. Pure: no imports, no clock it asks itself, no database —
 * the page, the sweep and build/payouts.test.mjs read the same functions, so "a refund of half
 * reverses half" is a test rather than a claim.
 *
 * A rule is a TRIGGER and an AMOUNT, and they mix: a person may hold any number and they all apply.
 * That is the whole model, and it is why "flat monthly, plus a share of every call" is two rows
 * rather than a third kind of rule to write.
 */

/* what makes a rule fire */
export const TRIGGERS = ['weekly', 'monthly', 'booking']
/* what it comes to. A share is in basis points — 1250 is 12.5% — because a percentage held as a
   float is a percentage that eventually pays somebody a fraction of a penny and cannot say why. */
export const AMOUNTS = ['fixed', 'share']

/* A SHARE OF A WEEK IS NOT A THING. There is no single payment for a period to be a share of, so
   the rule is refused where it is written rather than discovered when it first fires and comes to
   a number nobody can explain. The database holds the same rule as a check constraint. */
export function ruleFault(rule) {
  const r = rule || {}
  if (!TRIGGERS.includes(r.trigger)) return 'a rule fires on a week, a month, or a booking'
  if (!AMOUNTS.includes(r.amount_kind)) return 'a rule comes to a fixed amount or a share'
  if (r.trigger === 'booking' && !r.booking_type) return 'a rule on a booking names which booking type'
  if (r.amount_kind === 'share' && r.trigger !== 'booking') return 'a share needs one payment to be a share of, so it goes on a booking'
  if (!(Number(r.amount) > 0)) return 'an amount is more than nothing'
  if (r.amount_kind === 'share' && Number(r.amount) > 10000) return 'a share is at most all of it'
  return null
}

/* WHAT ONE RULE COMES TO, given what was actually collected. A share is of what the customer paid
   after any discount — so the number can always be explained by pointing at one payment — and a
   share of nothing is nothing, which is said rather than skipped: a booking that was free or came
   with a membership DID happen, and a line saying it came to nothing is the honest record. */
export function amountOf(rule, collected = 0) {
  const r = rule || {}
  if (r.amount_kind === 'share') return Math.round((Math.max(0, Number(collected) || 0) * Number(r.amount)) / 10000)
  return Math.max(0, Math.round(Number(r.amount) || 0))
}

/* WHEN IT MAY BE SENT. The site holds it for a while after the money was collected — not to hold
   the money, but so a refund inside the window reverses a line instead of chasing money already
   sent. A business that pays out same-day is a business that asks providers for money back. */
export function payableAt(collectedAt, delayMinutes = 0) {
  const at = new Date(collectedAt || Date.now()).getTime()
  const wait = Math.max(0, Number(delayMinutes) || 0)
  return new Date((isFinite(at) ? at : Date.now()) + wait * 60000).toISOString()
}

/* WHAT A REFUND REVERSES. In proportion, so half the payment back is half the amount earned back,
   and never more than was earned — a rounding that reversed a penny more than it gave is a ledger
   that drifts. A line that never became payable is not reversed at all: it simply never was. */
export function reversalOf(line, refunded, collected) {
  const earned = Math.max(0, Number((line && line.amount) || 0))
  const back = Math.max(0, Number(refunded) || 0)
  const paid = Math.max(0, Number(collected) || 0)
  if (!earned || !back) return 0
  if (!paid || back >= paid) return earned
  return Math.min(earned, Math.round((earned * back) / paid))
}

/* WHAT SOMEBODY IS OWED, from their lines alone — never from the processor, which knows what was
   sent and not why. Earned is everything; payable is what the delay has released and nothing has
   paid; sent is what went. A reversal is a line of its own with a negative amount, so it simply
   sums: nothing here has to remember to subtract. */
export function balanceOf(lines = [], now = Date.now()) {
  let earned = 0, payable = 0, sent = 0, waiting = 0
  for (const l of lines || []) {
    const a = Number(l.amount) || 0
    /* A LINE A REFUND CAUGHT INSIDE THE WINDOW never becomes payable, and it is not earned either: the
       money went back. Counting it as earned and then nowhere else leaves somebody looking at a figure
       with no home — earned 100, payable 0, waiting 0, sent 0, and where did it go. It is still in the
       list of lines, said as reversed, which is where it belongs. */
    if (!l.paid_at && !isFinite(new Date(l.payable_at || 0).getTime())) continue
    earned += a
    if (l.paid_at) { sent += a; continue }
    if (new Date(l.payable_at || 0).getTime() <= now) payable += a
    else waiting += a
  }
  /* NEVER A DEMAND. A reversal bigger than anything owed leaves the balance at nothing and stands
     against what is earned next; it is not an invoice to a provider. */
  return { earned, payable: Math.max(0, payable), waiting, sent, owed: Math.max(0, payable) }
}

/* the lines one booking makes, given the rules the person holds. One per rule, so two rules on one
   booking are two lines that each say which rule made them. */
export function linesFor({ rules = [], booking = {}, collected = 0, delay = 0 } = {}) {
  const out = []
  for (const r of rules) {
    if (!r || r.active === false || ruleFault(r)) continue
    if (r.trigger !== 'booking') continue
    if (r.booking_type !== booking.type) continue
    out.push({
      rule_id: r.id,
      amount: amountOf(r, collected),
      currency: r.currency || 'usd',
      booking_uid: booking.uid,
      earned_at: booking.end_at || booking.start_at,
      payable_at: payableAt(booking.collected_at || booking.end_at || booking.start_at, delay),
    })
  }
  return out
}

/* a span as the policy writes it → whole minutes, the same grammar a space's window takes */
export function spanMinutes(v) {
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)?$/.exec(String(v == null ? '' : v).trim().toLowerCase())
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * ({ m: 1, h: 60, d: 1440, w: 10080 }[m[2] || 'd']))
}
