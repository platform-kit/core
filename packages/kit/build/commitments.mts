/*
 * PAYMENT PLANS AND FIXED TERMS, as the catalogue compiles them (openspec: payment-plans).
 *
 * A plan or a term is a COMMITMENT: a number of payments, owed in full. Each way of paying is
 * compiled into an offer of its own beside the one its file declares — a subscription for paying
 * monthly, a one-off for paying a term in full — so the checkout, the provider's price sync and the
 * Hyperswitch renewal run sell it exactly as they sell any other offer, and nothing downstream needs
 * to know a plan exists in order to charge for it. What only a commitment has (how many payments,
 * what follows, what a missed payment does) rides on the derived offer as `commitment`.
 *
 * The prices are the file's own, never derived one from another: the markup on paying over time is
 * the seller's.
 */

import { waySku } from '../src/lib/payment-plans.js'

export const THEN = ['end', 'monthly', 'renew'] as const
export const CHANGE = ['anytime', 'term-end', 'never'] as const
export const RESTRICT = ['immediately', 'after-retries', 'never'] as const

/* the derived offer's identity: FNV-1a over the parent's key and the way of paying, eight hex —
   the same answer on every machine, so the provider's price for it is found again, never remade */
export function derivedKey(parentKey: string, way: string) {
  let h = 0x811c9dc5
  for (const ch of `${parentKey}:${way}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/* "24h", "3d", "90m" → minutes; "off", false or nothing → null; anything else → undefined (refused) */
export function graceMinutes(v: unknown): number | null | undefined {
  if (v == null || v === false || v === 'off') return null
  const m = /^(\d+)\s*(m|h|d)$/.exec(String(v).trim())
  if (!m || Number(m[1]) <= 0) return undefined
  return Number(m[1]) * ({ m: 1, h: 60, d: 1440 } as const)[m[2] as 'm' | 'h' | 'd']
}

const money = (v: unknown) => (typeof v === 'number' || /^\d+(\.\d{1,2})?$/.test(String(v ?? ''))) && Number(v) > 0

type Ctx = { file: string; d: any; base: any; err: (m: string) => void; sessions: boolean }

/*
 * What a file's `plans`, `terms`, `changes` and `missed` add: fields on the offer itself (what the
 * picker shows, the policies) and the derived offers. A file with none of them returns nothing,
 * and its offer's record is the one it had before any of this existed.
 */
export function compileCommitments({ file, d, base, err, sessions }: Ctx): { extra: Record<string, unknown>; derived: any[] } {
  const extra: Record<string, unknown> = {}
  const derived: any[] = []
  const has = (k: string) => d[k] != null
  if (!has('plans') && !has('terms') && !has('changes') && !has('missed')) return { extra, derived }

  const membership = d.kind === 'membership'
  if ((has('terms') || has('changes')) && !membership) err(`${file}: terms and changes are a membership's; this is a ${d.kind || 'product'}`)
  if (has('plans') && base.billing === 'subscription') err(`${file}: plans are for something bought once; a subscription is already paid over time`)
  if (has('plans') && (d.kind === 'good' || d.kind === 'print' || d.kind === 'apparel')) err(`${file}: plans are not offered on something that ships — an order sent cannot be taken back (Klarna and Affirm cover paying over time there)`)
  if (has('missed') && !has('plans') && !has('terms')) err(`${file}: missed says what a missed payment does, and this offer has no plans or terms`)

  /* what a missed payment does: the defaults are the gentlest that still protect the seller */
  const m = d.missed && typeof d.missed === 'object' ? d.missed : {}
  const restrict = m.restrict ?? 'immediately'
  if (!RESTRICT.includes(restrict)) err(`${file}: missed.restrict "${restrict}" — ${RESTRICT.join(' | ')}`)
  const grace = graceMinutes(m.cancelBookings)
  if (grace === undefined) err(`${file}: missed.cancelBookings "${m.cancelBookings}" — off, or a grace period such as 24h or 3d`)
  if (grace && !sessions) err(`${file}: missed.cancelBookings cancels bookings, and this site has the sessions module off`)
  const missed = { restrict, cancel_bookings_after_minutes: grace ?? null }

  const common = (way: string, title: string) => ({
    file, sku: waySku(base.sku, way), key: derivedKey(base.key, way), title,
    kind: base.kind, currency: base.currency, tier: base.tier, rank: base.rank, book: base.book,
  })

  if (has('plans')) {
    if (!Array.isArray(d.plans) || !d.plans.length) err(`${file}: plans is a list — each row: payments, each`)
    const seen = new Set<number>()
    const plans = []
    for (const p of Array.isArray(d.plans) ? d.plans : []) {
      const n = Number(p?.payments)
      if (!(Number.isInteger(n) && n >= 2)) { err(`${file}: a plan's payments "${p?.payments}" — a whole number, two or more`); continue }
      if (seen.has(n)) { err(`${file}: two plans of ${n} payments`); continue }
      seen.add(n)
      if (!money(p.each)) { err(`${file}: the ${n}-payment plan's each "${p.each}" — write dollars above zero: 1600 or 1600.00`); continue }
      const way = `plan-${n}`
      const o = { ...common(way, `${base.title} · ${n} payments`), billing: 'subscription', period: 'monthly', unit_amount: Math.round(Number(p.each) * 100),
        commitment: { of: base.sku, plan: 'monthly', payments: n, months: null, then: 'end', missed } }
      derived.push(o)
      plans.push({ payments: n, each: o.unit_amount, sku: o.sku })
    }
    extra.plans = plans
  }

  if (has('terms') && membership) {
    if (!Array.isArray(d.terms) || !d.terms.length) err(`${file}: terms is a list — each row: months, and full or monthly`)
    const seen = new Set<number>()
    const terms = []
    for (const t of Array.isArray(d.terms) ? d.terms : []) {
      const months = Number(t?.months)
      if (!(Number.isInteger(months) && months >= 1)) { err(`${file}: a term's months "${t?.months}" — a whole number, one or more`); continue }
      if (seen.has(months)) { err(`${file}: two terms of ${months} months`); continue }
      seen.add(months)
      if (t.full == null && t.monthly == null) { err(`${file}: the ${months}-month term has neither full nor monthly`); continue }
      if (t.full != null && !money(t.full)) err(`${file}: the ${months}-month term's full "${t.full}" — write dollars above zero`)
      if (t.monthly != null && !money(t.monthly)) err(`${file}: the ${months}-month term's monthly "${t.monthly}" — write dollars above zero`)
      const then = t.then ?? 'end'
      if (!THEN.includes(then)) { err(`${file}: the ${months}-month term's then "${then}" — ${THEN.join(' | ')}`); continue }
      if (then === 'monthly' && base.billing !== 'subscription') err(`${file}: the ${months}-month term continues monthly, and the membership has no open-ended monthly price to continue at`)
      const row: any = { months, then }
      if (t.full != null) {
        const o = { ...common(`${months}m-full`, `${base.title} · ${months} months`), billing: 'once', period: null, unit_amount: Math.round(Number(t.full) * 100),
          commitment: { of: base.sku, plan: 'full', payments: 1, months, then, missed } }
        derived.push(o)
        row.full = { sku: o.sku, amount: o.unit_amount }
      }
      if (t.monthly != null) {
        const o = { ...common(`${months}m-monthly`, `${base.title} · ${months} months, monthly`), billing: 'subscription', period: 'monthly', unit_amount: Math.round(Number(t.monthly) * 100),
          commitment: { of: base.sku, plan: 'monthly', payments: months, months, then, missed } }
        derived.push(o)
        row.monthly = { sku: o.sku, amount: o.unit_amount }
      }
      terms.push(row)
    }
    extra.terms = terms.sort((a, b) => a.months - b.months)
    /* a membership sold in terms alone has no open-ended price: it is not bought as itself */
    if (d.price == null) extra.terms_only = true
  }

  if (has('changes') && membership) {
    const c = d.changes && typeof d.changes === 'object' ? d.changes : {}
    const upgrade = c.upgrade ?? 'anytime', downgrade = c.downgrade ?? 'anytime'
    if (!CHANGE.includes(upgrade)) err(`${file}: changes.upgrade "${upgrade}" — ${CHANGE.join(' | ')}`)
    if (!CHANGE.includes(downgrade)) err(`${file}: changes.downgrade "${downgrade}" — ${CHANGE.join(' | ')}`)
    extra.changes = { upgrade, downgrade }
  }
  if (has('plans') || has('terms')) extra.missed = missed
  return { extra, derived }
}
