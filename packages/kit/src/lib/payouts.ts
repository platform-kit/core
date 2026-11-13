/*
 * WHAT A PAGE NEEDS TO KNOW ABOUT PAYOUTS. Pure: no imports, no clock it asks itself, no database.
 * What anybody is owed is worked out by the database alone (payouts_sweep and payouts_reverse in
 * supabase/schemas/57-providers.sql, tested by build/payouts-db.test.mjs); nothing here computes an
 * amount. This holds the rule's vocabulary and its refusals for the admin form, the sum of lines the
 * database already wrote for the earnings page, and the delay's grammar for the build.
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
export function ruleFault(rule: any) {
  const r = rule || {}
  if (!TRIGGERS.includes(r.trigger)) return 'a rule fires on a week, a month, or a booking'
  if (!AMOUNTS.includes(r.amount_kind)) return 'a rule comes to a fixed amount or a share'
  if (r.trigger === 'booking' && !r.booking_type) return 'a rule on a booking names which booking type'
  if (r.amount_kind === 'share' && r.trigger !== 'booking') return 'a share needs one payment to be a share of, so it goes on a booking'
  if (!(Number(r.amount) > 0)) return 'an amount is more than nothing'
  if (r.amount_kind === 'share' && Number(r.amount) > 10000) return 'a share is at most all of it'
  return null
}

/* WHAT SOMEBODY IS OWED, from their lines alone — never from the processor, which knows what was
   sent and not why. Earned is everything; payable is what the delay has released and nothing has
   paid; sent is what went. A reversal is a line of its own with a negative amount, so it simply
   sums: nothing here has to remember to subtract. */
/* a line of what a provider is owed: its amount, when it may be paid, and when it was */
export type PayoutLine = { amount: number, payable_at: string, paid_at?: string | null, [k: string]: any }
export function balanceOf(lines: PayoutLine[] = [], now = Date.now()) {
  let earned = 0, payable = 0, sent = 0, waiting = 0
  for (const l of lines || []) {
    const a = Number((l as any).amount) || 0
    /* A LINE A REFUND CAUGHT INSIDE THE WINDOW never becomes payable, and it is not earned either: the
       money went back. Counting it as earned and then nowhere else leaves somebody looking at a figure
       with no home — earned 100, payable 0, waiting 0, sent 0, and where did it go. It is still in the
       list of lines, said as reversed, which is where it belongs. */
    if (!(l as any).paid_at && !isFinite(new Date((l as any).payable_at || 0).getTime())) continue
    earned += a
    if ((l as any).paid_at) { sent += a; continue }
    if (new Date((l as any).payable_at || 0).getTime() <= now) payable += a
    else waiting += a
  }
  /* NEVER A DEMAND. A reversal bigger than anything owed leaves the balance at nothing and stands
     against what is earned next; it is not an invoice to a provider. */
  return { earned, payable: Math.max(0, payable), waiting, sent, owed: Math.max(0, payable) }
}

/* a span as the policy writes it → whole minutes, the same grammar a space's window takes */
export function spanMinutes(v: string|null) {
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)?$/.exec(String(v == null ? '' : v).trim().toLowerCase())
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * ({ m: 1, h: 60, d: 1440, w: 10080 } as Record<string, number>)[m[2] || 'd'])
}
