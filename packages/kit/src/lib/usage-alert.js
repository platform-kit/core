/*
 * When the site tells a customer that a usage payment needs them.
 *
 * An incremental usage charge the customer must act on — the bank wants verification, or the charge
 * failed — is announced by a red banner on every page until it is settled (UsagePaymentAlert.vue). A
 * charge that is only processing needs nothing from them, so it raises no banner.
 *
 * The banner keeps off a few pages, and they are not the quiet pages of interrupt.js: that list keeps
 * ads and the chat off a reader's places of work, but an unpaid charge is the customer's own business
 * and belongs there too. It keeps off the checkout, where it would sit over the payment form; an embed,
 * which is somebody else's page; and the preview and share renders, which are pictures of a page.
 *
 * Pure: no imports, no environment, pinned by build/usage-alert.test.mjs.
 */

/* the statuses that need the customer, most urgent first */
export const NEEDS_CUSTOMER = ['requires_action', 'failed']

/* the one status the banner announces, from the statuses of a customer's open usage payments: null when
   none needs them */
export function alertFor(statuses) {
  const open = new Set(Array.isArray(statuses) ? statuses : [statuses])
  return NEEDS_CUSTOMER.find((status) => open.has(status)) || null
}

export const ALERT_QUIET = ['/checkout/', '/embed/', '/__preview', '/__share']

export function mayShowUsageAlert(path) {
  const p = String(path || '')
  if (!p.startsWith('/')) return false
  for (const q of ALERT_QUIET) {
    if (q.endsWith('/')) { if (p.startsWith(q)) return false }
    else if (p === q || p.startsWith(q + '/')) return false
  }
  return true
}
