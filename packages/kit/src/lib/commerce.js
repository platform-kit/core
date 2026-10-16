/*
 * Commerce from the client: the Edge Functions that talk to the selected payment provider. A purchase
 * is named by its sku — the product file's slug — and the function looks the
 * offer up in its own copy of the files and passes it to the provider; the client never
 * sends an amount or a provider id. Checkout and the Billing Portal are provider-
 * hosted — the client only ever receives a URL and goes there. Hyperswitch
 * returns a short-lived client secret for its embedded payment element; that
 * secret is kept in tab-scoped session storage, never in the checkout URL.
 * supabase-js
 * attaches the signed-in user's JWT to every function call.
 */
import { supabase } from './supabase.js'
import { shipTo, lineShips } from './shipto.js'
import { ug } from './strings.js'

/* the page checkout was started from — where a cancelled checkout comes back to */
/* where a checkout comes back to: this page, or a path the caller names (a paid form sends them
   back to the form itself, so the answer is the next thing they see). A path on this site only. */
const here = (path) => (path && String(path).startsWith('/') ? String(path) : window.location.pathname + window.location.search)
async function call(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  const fail = (msg, code) => {
    if (String(code || '').startsWith('hyperswitch_')) {
      console.error('Hyperswitch operation failed', { operation: name, code, message: msg })
      const copy = ug('store', 'page').head || {}
      msg = code === 'hyperswitch_profile_capability_unavailable' ||
        code === 'hyperswitch_checkout_term_unavailable'
        ? copy['checkout-options-unavailable'] || copy['error-heading']
        : copy['payment-provider-error'] || copy['error-heading']
    }
    const e = new Error(msg); e.code = code || ''; throw e
  }
  if (error) {
    let msg = error.message || 'request failed', code = ''
    try { const j = await error.context.json(); if (j && j.error) { msg = j.error; code = j.code || '' } } catch (e) { /* no body */ }
    fail(msg, code)
  }
  if (data && data.error) fail(data.error, data.code)
  return data
}

function followCheckout(data) {
  if (data?.provider === 'hyperswitch' && data.client && data.checkoutId) {
    sessionStorage.setItem(`platformkit:hyperswitch-checkout:${data.checkoutId}`, JSON.stringify({
      ...data.client,
      ...(data.summary ? { summary: data.summary } : {}),
      expiresAt: Date.now() + 30 * 60 * 1000,
    }))
  }
  if (data && data.url) window.location.assign(data.url)
  return data
}

/* one-time purchases: goods and book unlocks, any mix, one Checkout */
export async function checkout(items, opts = {}) {
  const d = await call('create-checkout-session', {
    items: items.map((i) => ({ sku: i.sku, quantity: i.quantity, variant: i.variant || undefined })),
    /* where a cancel comes back to: where they started unless the caller says otherwise — a paid
       form sends them back to the form, so the answer is the next thing they see */
    return: opts.return ? here(opts.return) : here(),
    ...(items.some(lineShips) ? { country: shipTo.value } : {}),
  })
  return followCheckout(d)
}
/* a session paid as it is booked: the chosen time rides with the payment, and
   the webhook books it the moment the payment lands; back on the Coaching tab */
export async function payAndBook(sku, booking) {
  const d = await call('create-checkout-session', { items: [{ sku, quantity: 1 }], booking, return: here(), success: '/app/coaching' })
  return followCheckout(d)
}
/* a membership starts through Checkout in subscription mode; a subscriber
   choosing another plan is switched in place and told (no page leaves) */
export async function subscribe(sku) {
  const d = await call('create-checkout-session', { items: [{ sku, quantity: 1 }], return: here() })
  return followCheckout(d)
}
/* …and is managed entirely in the selected provider's portal */
export async function openPortal() {
  const d = await call('create-portal-session', {})
  if (d && d.url) window.location.assign(d.url)
  return d
}

export const money = (amount, currency) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((amount || 0) / 100)
