/*
 * THE WAYS TO PAY FOR AN OFFER, read off its product file (openspec: payment-plans).
 *
 * One rule for the name of each way of paying, shared by the build that compiles them into offers of their own
 * (build/commitments.mts) and the page that offers them, so a way the page shows is always one the checkout sells.
 * Amounts here are the file's dollars, in minor units; the checkout charges the catalogue's, whatever a page says.
 */
export type WayToPay = {
  sku: string
  /* once: the offer's own price, paid once; open: a membership's open-ended subscription, cancelled any time */
  plan: 'once' | 'open' | 'full' | 'monthly'
  /* the number of payments, and how far apart: 1 for paying once or in full */
  payments: number
  months: number | null
  amount: number
  then: 'end' | 'monthly' | 'renew' | null
  /* buying it is a commitment the buyer agrees to first */
  committed: boolean
}

export const waySku = (sku: string, way: string) => `${sku}--${way}`
/* the offer a way of paying pays for: the sku it is named after */
export const offerSkuOf = (sku: string) => String(sku || '').split('--')[0]

const minor = (v: unknown) => Math.round(Number(v) * 100)

export function waysToPay(d: any): WayToPay[] {
  if (!d || !d.sku) return []
  const out: WayToPay[] = []
  const terms = Array.isArray(d.terms) ? d.terms : []
  const plans = Array.isArray(d.plans) ? d.plans : []
  if (!terms.length && !plans.length) return []
  if (d.price != null && d.billing === 'subscription') out.push({ sku: d.sku, plan: 'open', payments: 1, months: null, amount: minor(d.price), then: null, committed: false })
  else if (d.price != null && !terms.length) out.push({ sku: d.sku, plan: 'once', payments: 1, months: null, amount: minor(d.price), then: null, committed: false })
  for (const p of plans) {
    const n = Number(p?.payments)
    if (Number.isInteger(n) && n >= 2 && Number(p.each) > 0) out.push({ sku: waySku(d.sku, `plan-${n}`), plan: 'monthly', payments: n, months: null, amount: minor(p.each), then: 'end', committed: true })
  }
  for (const t of [...terms].sort((a: any, b: any) => Number(a.months) - Number(b.months))) {
    const m = Number(t?.months)
    if (!(Number.isInteger(m) && m >= 1)) continue
    const then = t.then ?? 'end'
    if (t.full != null) out.push({ sku: waySku(d.sku, `${m}m-full`), plan: 'full', payments: 1, months: m, amount: minor(t.full), then, committed: true })
    if (t.monthly != null) out.push({ sku: waySku(d.sku, `${m}m-monthly`), plan: 'monthly', payments: m, months: m, amount: minor(t.monthly), then, committed: true })
  }
  return out
}
