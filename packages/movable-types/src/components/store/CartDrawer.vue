<script setup>
/*
 * The bag, as a drawer that slides in from the right on any page — mounted once
 * in App.vue and opened from the header's bag button or by adding something.
 * Lines, quantities, the subtotal, and the selected provider's checkout.
 * Copy lives in content/app/ui/store.md.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { money, checkout } from '@platform-kit/kit/lib/commerce.js'
import { isSignedIn } from '@platform-kit/kit/lib/auth.js'
import { guestCart } from '@platform-kit/kit/lib/shipto.js'
import * as cart from '@platform-kit/kit/lib/cart.js'
import { apply as applyPromotions } from '@platform-kit/kit/lib/promotions.js'
import { promotions as promoList, priceContext } from '@platform-kit/kit/lib/storefront.js'
import { capture } from '@platform-kit/kit/lib/analytics.js'
import { ROUTES } from '../../router.js'
import site from '#site'
import ShipTo from './ShipTo.vue'
import { lineShips } from '@platform-kit/kit/lib/shipto.js'

/*
 * WHAT COMES OFF THIS BAG, worked out here by the same module the checkout uses, so the figure
 * somebody agrees to is the figure they are charged. A discount that only appears on Stripe’s
 * page is one the shopper had no chance to understand.
 */
const cut = computed(() => {
  const lines = cart.items.value.map((l) => ({ sku: l.sku, variant: l.variant || '', unit_price: l.unit_amount, quantity: l.quantity }))
  if (!lines.length) return null
  const ctx = { ...priceContext(), item_total: cart.total.value }
  const r = applyPromotions(lines, promoList(), { context: ctx })
  return r.discount > 0 ? r : null
})
/* named by their titles, which is what a shopper reads — `name` is the file, for the machine */
const cutNames = computed(() => {
  const r = cut.value; if (!r) return ''
  const byName = Object.fromEntries(promoList().map((x) => [x.name, x.title || x.name]))
  return [...new Set(r.lines.flatMap((l) => l.by))].map((n) => byName[n] || n).join(' · ')
})
const C = us('store').cart.ui
const S = us('store').page.head
const paymentProvider = site.payments?.provider || 'stripe'
const busy = ref(false)
const error = ref('')
const errorCode = ref('')

/* a bag of printed copies and files checks out with no account */
const asGuest = computed(() => !isSignedIn.value && guestCart(cart.items.value))
async function doCheckout() {
  if (!isSignedIn.value && !asGuest.value) { if (window.DLauth) window.DLauth.open(); return }
  busy.value = true; error.value = ''; errorCode.value = ''
  capture('click', { kind: 'checkout', items: cart.count.value, total: cart.total.value })
  try { await checkout(cart.items.value) }
  catch (e) { error.value = (e && e.message) || S['error-heading']; errorCode.value = (e && e.code) || '' }
  finally { busy.value = false }
}
function onKey(e) { if (e.key === 'Escape' && cart.open.value) cart.closeCart() }
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
/* the page behind must not scroll while the drawer is open */
watch(cart.open, (v) => { document.documentElement.classList.toggle('bag-open', v) })
const goShop = () => { cart.closeCart(); if (location.pathname !== ROUTES.store) location.assign(ROUTES.store) }
</script>

<template>
  <Teleport to="body">
    <div class="bag-veil" :class="{ on: cart.open.value }" @click="cart.closeCart()" />
    <aside class="bag" :class="{ on: cart.open.value }" role="dialog" :aria-label="C.title" :aria-hidden="!cart.open.value">
      <header class="bag-head">
        <h2 class="bag-title">{{ C.title }} <span v-if="cart.count.value" class="bag-count">{{ cart.count.value }}</span></h2>
        <button type="button" class="bag-x" :aria-label="C.close" @click="cart.closeCart()">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </header>

      <div v-if="!cart.items.value.length" class="bag-empty">
        <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 16h28l-2.4 24H12.4L10 16Z" /><path d="M17 16v-3a7 7 0 0 1 14 0v3" stroke-linecap="round" />
        </svg>
        <p>{{ C.empty }}</p>
        <button type="button" class="bag-cta" @click="goShop">{{ C['empty-cta'] }}</button>
      </div>

      <template v-else>
        <ul class="bag-lines">
          <li v-for="l in cart.items.value" :key="l.key" class="bag-line" :class="{ fresh: l.key === cart.lastAdded.value }">
            <a class="bag-img" :href="'/store/products/' + (l.slug || '')" @click="cart.closeCart()">
              <img v-if="l.image" :src="l.image" alt="" loading="lazy" />
            </a>
            <div class="bag-info">
              <a class="bag-name" :href="'/store/products/' + (l.slug || '')" @click="cart.closeCart()">{{ l.name }}</a>
              <span v-if="l.label || l.variant" class="bag-var">{{ l.label || l.variant }}</span>
              <span class="bag-each">{{ money(l.unit_amount, l.currency) }}</span>
              <div class="bag-row">
                <div v-if="l.kind === 'store_good' || l.kind === 'good' || l.kind === 'print'" class="bag-qty" :aria-label="C.qty">
                  <button type="button" :disabled="l.quantity <= 1" @click="cart.setQty(l.key, l.quantity - 1)">−</button>
                  <span>{{ l.quantity }}</span>
                  <button type="button" :disabled="l.quantity >= 10" @click="cart.setQty(l.key, l.quantity + 1)">+</button>
                </div>
                <button type="button" class="bag-rm" @click="cart.remove(l.key)">{{ C.remove }}</button>
              </div>
            </div>
            <b class="bag-linetotal">{{ money(l.unit_amount * l.quantity, l.currency) }}</b>
          </li>
        </ul>
        <footer class="bag-foot">
          <ShipTo v-if="cart.items.value.some(lineShips)" class="bag-ship" />
          <div class="bag-sub"><span>{{ C.subtotal }}</span><b>{{ money(cart.total.value, cart.currency.value) }}</b></div>
          <!-- what the shop is taking off, named, so nobody meets it for the first time on Stripe’s page -->
          <div v-if="cut" class="bag-sub bag-cut"><span>{{ cutNames }}</span><b>&minus;{{ money(cut.discount, cart.currency.value) }}</b></div>
          <div v-if="cut" class="bag-sub bag-due"><span>{{ C.due }}</span><b>{{ money(cut.total, cart.currency.value) }}</b></div>
          <!-- STRIPE TAKES ONE CODE. Our own discounts apply by themselves and stack; a code typed
               on Stripe’s page is one more, and only one. Said here because a shopper who expects
               to add three finds out at the worst moment. -->
          <p v-if="cut && paymentProvider === 'stripe'" class="bag-note">{{ C["one-code"] }}</p>
          <p class="bag-note">{{ C.note }}</p>
          <p v-if="error" class="bag-err">{{ errorCode === 'stripe_unconfigured' ? S['unconfigured-heading'] : error }}</p>
          <button type="button" class="bag-cta" :disabled="busy" @click="doCheckout">{{ busy ? C.working : (isSignedIn ? C.checkout : asGuest ? C['checkout-guest'] : C['signin-to-checkout']) }}</button>
          <p v-if="asGuest" class="bag-note">{{ C['guest-note'] }}</p>
          <button type="button" class="bag-cont" @click="cart.closeCart()">{{ C.continue }}</button>
        </footer>
      </template>
    </aside>
  </Teleport>
</template>

<style scoped>
.bag-veil { position: fixed; inset: 0; z-index: 90; background: #0a0d0b66; backdrop-filter: blur(4px); opacity: 0; pointer-events: none; transition: opacity .25s }
.bag-veil.on { opacity: 1; pointer-events: auto }
.bag { position: fixed; top: 0; right: 0; bottom: 0; z-index: 91; width: min(440px, 100vw); display: flex; flex-direction: column;
  background: var(--paper); color: var(--ink); border-left: 1px solid var(--hair); box-shadow: -30px 0 80px -30px #000a;
  transform: translateX(104%); transition: transform .32s cubic-bezier(.2, .8, .2, 1); visibility: hidden }
.bag.on { transform: none; visibility: visible }
.bag-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 16px; border-bottom: 1px solid var(--hair) }
.bag-title { font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.01em; margin: 0; display: flex; align-items: center; gap: 10px }
.bag-count { font-family: var(--m); font-size: 11px; color: var(--paper); background: var(--ink); border-radius: 999px; min-width: 20px; height: 20px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center }
.bag-x { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink2); background: none; border: 1px solid var(--hair); border-radius: 50%; cursor: pointer }
.bag-x:hover { color: var(--ink); border-color: var(--ink3) }
.bag-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 40px 28px; text-align: center; color: var(--ink3) }
.bag-empty p { margin: 0; font-size: 15px; color: var(--ink2) }
.bag-lines { list-style: none; margin: 0; padding: 6px 20px; flex: 1; overflow-y: auto }
.bag-line { display: grid; grid-template-columns: 78px 1fr auto; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--hair); align-items: start; border-radius: 10px }
.bag-line.fresh { animation: bag-fresh 1.6s ease-out }
@keyframes bag-fresh { 0% { background: color-mix(in srgb, var(--accent) 16%, transparent) } 100% { background: transparent } }
.bag-img { display: block; aspect-ratio: 4 / 5; border-radius: 10px; overflow: hidden; background: var(--wash) }
.bag-img img { width: 100%; height: 100%; object-fit: cover; display: block }
.bag-info { display: flex; flex-direction: column; gap: 3px; min-width: 0 }
.bag-name { font-family: var(--fd); font-weight: 600; font-size: 15.5px; color: var(--ink); text-decoration: none; line-height: 1.2 }
.bag-var { font-family: var(--m); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
.bag-each { font-family: var(--m); font-size: 12px; color: var(--ink3) }
.bag-row { display: flex; align-items: center; gap: 14px; margin-top: 8px }
.bag-qty { display: inline-flex; align-items: center; border: 1px solid var(--hair); border-radius: 999px; overflow: hidden }
.bag-qty button { width: 30px; height: 30px; font: inherit; font-size: 16px; color: var(--ink2); background: none; border: 0; cursor: pointer }
.bag-qty button:disabled { color: var(--hair); cursor: default }
.bag-qty span { min-width: 22px; text-align: center; font-family: var(--m); font-size: 13px }
.bag-rm { font: inherit; font-size: 12.5px; color: var(--ink3); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px }
.bag-rm:hover { color: var(--ink) }
.bag-cut { color: var(--ok, var(--ink3)) }
.bag-due b { font-size: 1.05em }
.bag-linetotal { font-family: var(--m); font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; padding-top: 2px }
.bag-foot { padding: 16px 20px 22px; border-top: 1px solid var(--hair); background: var(--paper) }
.bag-ship { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--hair) }
.bag-sub { display: flex; justify-content: space-between; align-items: baseline; font-size: 15px }
.bag-sub b { font-family: var(--fd); font-size: 22px; font-weight: 600; letter-spacing: -.01em; font-variant-numeric: tabular-nums }
.bag-note { margin: 4px 0 14px; font-size: 12.5px; color: var(--ink3) }
.bag-err { margin: 0 0 12px; font-size: 13px; color: #b45309 }
.bag-cta { display: block; width: 100%; font: inherit; font-size: 15.5px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 14px 20px; cursor: pointer; transition: transform .14s, box-shadow .14s }
.bag-cta:hover { transform: translateY(-1px); box-shadow: 0 12px 28px -14px #000a }
.bag-cta:disabled { opacity: .6; cursor: default; transform: none }
.bag-cont { display: block; width: 100%; margin-top: 10px; font: inherit; font-size: 13.5px; color: var(--ink2); background: none; border: 0; cursor: pointer; padding: 6px }
.bag-cont:hover { color: var(--ink) }
@media (prefers-reduced-motion: reduce) { .bag, .bag-veil { transition: none } }
</style>
