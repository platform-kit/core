/*
 * The country a cart ships to, as the buyer chose it (or the browser suggested it) — one
 * value the bag, the product page and the checkout call share — and the store's shipping
 * rules and the rates for that country, from the storefront's settings.
 */
import { ref, computed, watch } from 'vue'
import { storefront as STOREFRONT } from '#content'
import { shippingRules, ratesFor, shipsTo } from './shipping.js'

export const rules = shippingRules(STOREFRONT.shipping || {})
const KEY = 'dl.shipto'
const guess = () => { try { const r = (new Intl.Locale(navigator.language)).maximize().region; if (r && shipsTo(rules, r)) return r } catch (e) { /* no locale */ } return rules.countries.includes('US') ? 'US' : rules.countries[0] || '' }
const stored = (() => { try { const v = localStorage.getItem(KEY); return v && shipsTo(rules, v) ? v : '' } catch (e) { return '' } })()
export const shipTo = ref(stored || guess())
watch(shipTo, (v) => { try { localStorage.setItem(KEY, v) } catch (e) { /* private */ } })
export const rates = computed(() => ratesFor(rules, shipTo.value))
/* whether a line needs a destination */
export const lineShips = (l) => l && (l.kind === 'store_good' || l.kind === 'good' || l.kind === 'print')
/* what a guest may buy with no account: a printed copy or a file — the purchase is claimed by
   an account made later with the address Checkout collects. An unlock, a membership and a
   session are a person's own. */
export const guestLine = (l) => l && (l.kind === 'print' || l.kind === 'download')
export const guestCart = (lines) => !!(lines && lines.length) && lines.every(guestLine)
