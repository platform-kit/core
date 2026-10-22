<script setup>
/* A cart made through the Store API (Shopify's Storefront), followed to its checkoutUrl — /cart/c/<token>: the cart's
   lines are put in the site's bag (the same lines the product pages add: a sku, a variant, a quantity), the shipping
   country set when the cart's buyer said one, and the buyer goes on as any buyer does — straight to Checkout when every
   line may be bought as they are (a guest with print and download lines alone, or a signed-in reader), else to the
   store with the bag open and the sign-in offered. Nothing is bought here: the bag and create-checkout-session are the
   one way. Words: store.md `cart.handoff`. */
import { ref, onMounted } from 'vue'
import { ROUTES, navigate } from '../router.js'
import { setHead } from 'platformkit/lib/seo.js'
import { us } from 'platformkit/lib/strings.js'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { isSignedIn, authSettled } from 'platformkit/lib/auth.js'
import * as cart from 'platformkit/lib/cart.js'
import { checkout } from 'platformkit/lib/commerce.js'
import { shipTo, guestCart, rules } from 'platformkit/lib/shipto.js'
import { shipsTo } from 'platformkit/lib/shipping.js'
import SiteMark from '../components/SiteMark.vue'

const props = defineProps({ path: { type: String, required: true } })
const W = (us('store').cart || {}).handoff || {}
const token = props.path.slice((ROUTES.cart + '/c/').length).split('/')[0]
const state = ref('loading')   /* loading | signin | expired | failed */
const error = ref('')
setHead({ title: W.title || '', description: '', path: props.path, noindex: true })

async function load() {
  if (!configured || !supabase || !/^[a-f0-9]{36}$/.test(token)) { state.value = 'expired'; return }
  const fns = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '') + '/functions/v1/storefront-api/api/carts/' + token
  let data = null
  try { const r = await fetch(fns); if (r.status === 404) { state.value = 'expired'; return } if (!r.ok) throw new Error('the cart could not be read'); data = await r.json() } catch (e) { state.value = 'failed'; error.value = e.message; return }
  if (!data.lines || !data.lines.length) { state.value = 'expired'; return }
  /* the bag as the product pages fill it */
  cart.clear()
  for (const l of data.lines) cart.add({ sku: l.sku, slug: l.handle, name: l.name, variant: l.variant, label: l.label, unit_amount: l.unit_amount, currency: l.currency, kind: l.kind, image: l.image }, l.quantity)
  const cc = data.buyerIdentity && data.buyerIdentity.countryCode
  if (cc && shipsTo(rules, cc)) shipTo.value = cc
  /* wait for the session to be known before deciding who is buying */
  await new Promise((r) => { const t = setInterval(() => { if (authSettled.value) { clearInterval(t); r() } }, 50); setTimeout(() => { clearInterval(t); r() }, 4000) })
  if (isSignedIn.value || guestCart(cart.items.value)) {
    try { await checkout(cart.items.value); return } catch (e) { state.value = 'failed'; error.value = e.message; return }
  }
  state.value = 'signin'
  cart.openCart()
  if (window.DLauth) window.DLauth.open({ intent: 'buy' })
}
onMounted(load)
function toStore() { navigate(ROUTES.store) }
</script>

<template>
  <div class="handoff lproot">
    <header class="handoff-bar"><a :href="ROUTES.home" class="handoff-home" @click.prevent="navigate(ROUTES.home)"><SiteMark class="handoff-mark" /></a></header>
    <main class="handoff-main">
      <template v-if="state === 'loading'"><div class="handoff-spin" aria-hidden="true"></div><h1 class="handoff-h">{{ W.title }}</h1><p class="handoff-lead">{{ W.lead }}</p></template>
      <template v-else-if="state === 'signin'"><h1 class="handoff-h">{{ W['signin-title'] }}</h1><p class="handoff-lead">{{ W['signin-lead'] }}</p><button type="button" class="lpbtn" @click="cart.openCart()">{{ W['open-bag'] }}</button></template>
      <template v-else-if="state === 'expired'"><h1 class="handoff-h">{{ W['expired-title'] }}</h1><p class="handoff-lead">{{ W['expired-lead'] }}</p><button type="button" class="lpbtn" @click="toStore">{{ W['to-store'] }}</button></template>
      <template v-else><h1 class="handoff-h">{{ W['failed-title'] }}</h1><p class="handoff-lead">{{ error || W['failed-lead'] }}</p><button type="button" class="lpbtn" @click="cart.openCart()">{{ W['open-bag'] }}</button></template>
    </main>
  </div>
</template>

<style scoped>
.handoff { min-height: 100vh; background: var(--paper); color: var(--ink) }
.handoff-bar { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--hair) }
.handoff-home { display: inline-flex; color: var(--ink); text-decoration: none } .handoff-mark { width: 22px; height: 22px }
.handoff-main { max-width: 520px; margin: 0 auto; padding: 72px 16px 48px; text-align: center; display: grid; gap: 14px; justify-items: center }
.handoff-h { font-size: clamp(24px, 4vw, 32px); margin: 0; max-width: none; line-height: 1.15 } .handoff-lead { color: var(--ink2); margin: 0; max-width: 40ch }
.handoff-spin { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--hair); border-top-color: var(--ink); animation: handoff-turn .9s linear infinite }
@keyframes handoff-turn { to { transform: rotate(360deg) } }
@media (prefers-reduced-motion: reduce) { .handoff-spin { animation: none } }
</style>
