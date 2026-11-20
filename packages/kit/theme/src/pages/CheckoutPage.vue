<script setup lang="ts">
/*
 * AN OFFER'S OWN CHECKOUT (openspec: offer-checkout-page): /checkout/<sku> says what the offer is, offers its ways to
 * pay with what each commits the buyer to, and takes them to the payment provider. It is core, not the store's, so a
 * membership or a programme sells with the store switched off, and it is the one address a button, an email or a
 * drip can send somebody to pay at. /checkout alone opens the reader's own latest checkout left unfinished.
 */
import { computed, ref, watch, onMounted } from 'vue'
import { products as PRODUCTS } from '#content'
import { us } from 'platformkit/lib/content.js'
import { money, checkout, subscribe } from 'platformkit/lib/commerce.js'
import { authSettled, isSignedIn, hasProduct, memberTiers } from 'platformkit/lib/auth.js'
import { waysToPay } from 'platformkit/lib/payment-plans.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { replace, ROUTES } from 'platformkit/lib/router.js'
import { setHead } from 'platformkit/lib/seo.js'
import { capture } from 'platformkit/lib/analytics.js'
import SiteLayout from '../layouts/SiteLayout.vue'
import PlanPicker from '../components/store/PlanPicker.vue'

const props = defineProps<{ path?: string }>()
const W = computed(() => ((us('checkout').page || {}).main || {}))
const SW = computed(() => ((us('store').page || {}).head || {}))
const fill = (s: string, v: Record<string, string>) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(x), s || '')

const asked = computed(() => decodeURIComponent(String(props.path || '').split('/')[2] || ''))
const offer = computed<any>(() => asked.value ? PRODUCTS.find((p: any) => p.sku === asked.value || p.id === asked.value) || null : null)
const returned = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('checkout') : null

/* /checkout with no offer: the reader's latest unfinished checkout, or a word that there is none */
const resuming = computed(() => !asked.value)
const nothing = ref(false)
async function resume() {
  if (!resuming.value || !authSettled.value) return
  if (!isSignedIn.value) { nothing.value = true; return }
  const { data } = await supabase.rpc('my_checkout_left')
  const row = Array.isArray(data) ? data[0] : null
  if (row && row.offer_sku) replace(ROUTES.checkout + '/' + row.offer_sku)
  else nothing.value = true
}
watch([authSettled, isSignedIn], resume)
onMounted(resume)

setHead({ title: offer.value?.title || W.value.eyebrow, description: offer.value?.subtitle || '', path: ROUTES.checkout + (asked.value ? '/' + asked.value : ''), noindex: true })

const ways = computed(() => (offer.value ? waysToPay(offer.value) : []))
const owned = computed(() => {
  const o = offer.value
  if (!o || !isSignedIn.value) return false
  if (o.kind === 'membership') return !!o.tier && memberTiers.value.includes(o.tier)
  return hasProduct(o.key)
})
/* the body: its opening, then each ## section, as on the store's page */
const sections = computed(() => {
  const html = String(offer.value?.body || '')
  const parts = html.split(/(?=<h2\b)/)
  const out: { title: string, html: string }[] = []
  if (parts[0] && parts[0].trim()) out.push({ title: '', html: parts[0] })
  for (const part of parts.slice(1)) {
    const m = /^<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*)$/.exec(part)
    if (m) out.push({ title: m[1].replace(/<[^>]+>/g, '').trim(), html: m[2] })
  }
  return out
})
const priceLine = computed(() => {
  const o = offer.value
  if (!o || ways.value.length || o.price == null) return ''
  const amount = money(Math.round(Number(o.price) * 100), o.currency || 'usd')
  if (o.billing === 'subscription') return fill(o.period === 'weekly' ? W.value['pay-weekly'] : W.value['pay-monthly'], { amount })
  return fill(W.value['pay-once'], { amount })
})

/* paying: signed in first, then the provider; a sign-in started here carries on to the payment */
const busy = ref(false)
const fault = ref('')
let pending: null | (() => Promise<unknown>) = null
async function run(fn: () => Promise<unknown>, evt?: Record<string, unknown>) {
  if (!isSignedIn.value) { pending = fn; if ((window as any).DLauth) (window as any).DLauth.open({ intent: 'buy' }); return }
  busy.value = true; fault.value = ''
  if (evt) capture('click', evt)
  try { await fn() } catch (e: any) {
    fault.value = e?.code === 'stripe_unconfigured' ? (SW.value['unconfigured-heading'] || '') : (e?.message || SW.value['error-heading'] || '')
  } finally { busy.value = false }
}
watch(isSignedIn, (on) => { if (on && pending) { const fn = pending; pending = null; run(fn) } })
const payOne = () => {
  const o = offer.value
  if (!o) return
  run(o.billing === 'subscription' ? () => subscribe(o.sku) : () => checkout([{ sku: o.sku, quantity: 1 }]), { kind: o.billing === 'subscription' ? 'subscribe' : 'buy_now', product_id: o.sku })
}
</script>

<template>
  <SiteLayout :current="ROUTES.checkout">
    <main class="co-page lproot lpfull">
      <div class="lpbg"></div>
      <div class="lpgrain"></div>
      <section class="co-shell">
        <div v-if="resuming && !nothing" class="co-wait" aria-hidden="true"></div>
        <div v-else-if="resuming || !offer" class="co-note">
          <h1 class="co-title">{{ resuming ? W['nothing-heading'] : W['missing-heading'] }}</h1>
          <p class="co-lede">{{ resuming ? W['nothing-body'] : W['missing-body'] }}</p>
          <a class="co-cta co-cta-inline" href="/pricing">{{ W['missing-cta'] }}</a>
        </div>
        <template v-else>
          <div class="co-about">
            <p class="co-eyebrow">{{ W.eyebrow }}</p>
            <h1 class="co-title">{{ offer.title }}</h1>
            <p v-if="offer.subtitle" class="co-lede">{{ offer.subtitle }}</p>
            <div v-for="(s, i) in sections" :key="i" class="co-section">
              <h2 v-if="s.title" class="co-h2">{{ s.title }}</h2>
              <div class="co-body" v-html="s.html" />
            </div>
          </div>
          <aside class="co-card">
            <div v-if="returned === 'success'" class="co-done">
              <h2 class="co-h2">{{ W['paid-heading'] }}</h2>
              <p>{{ W['paid-body'] }}</p>
              <a class="co-cta" href="/">{{ W['paid-cta'] }}</a>
            </div>
            <div v-else-if="owned" class="co-done">
              <h2 class="co-h2">{{ W['owned-heading'] }}</h2>
              <p>{{ W['owned-body'] }}</p>
              <a class="co-cta" :href="ROUTES.billing">{{ W['owned-cta'] }}</a>
            </div>
            <template v-else>
              <p v-if="returned === 'cancel'" class="co-cancelled">{{ W.cancelled }}</p>
              <PlanPicker v-if="ways.length" :product="offer" :busy="busy" @run="(fn, evt) => run(fn, evt)" />
              <button v-else type="button" class="co-cta" :disabled="busy" @click="payOne">{{ priceLine }}</button>
              <p v-if="fault" class="co-fault" role="alert">{{ fault }}</p>
              <p v-if="!isSignedIn" class="co-signin">{{ W['signin-note'] }}</p>
            </template>
          </aside>
        </template>
      </section>
    </main>
  </SiteLayout>
</template>

<style scoped>
.co-page { min-height: 70vh }
.co-shell { position: relative; max-width: 1080px; margin: 0 auto; padding: 56px 16px 96px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 400px); gap: 48px; align-items: start }
.co-note { grid-column: 1 / -1; max-width: 560px }
.co-wait { grid-column: 1 / -1; min-height: 240px }
.co-eyebrow { margin: 0 0 10px; font-family: var(--mono, ui-monospace, monospace); font-size: .78rem; letter-spacing: .12em; text-transform: uppercase; color: var(--ink2) }
.co-title { margin: 0; font-size: clamp(2rem, 4.4vw, 3rem); line-height: 1.08; color: var(--ink) }
.co-lede { margin: 14px 0 0; font-size: 1.12rem; line-height: 1.5; color: var(--ink2) }
.co-section { margin-top: 28px }
.co-h2 { margin: 0 0 10px; font-size: 1.15rem; color: var(--ink) }
.co-body { color: var(--ink); line-height: 1.6 }
.co-body :deep(ul) { margin: 0; padding-left: 1.2em }
.co-body :deep(li) { margin: 4px 0 }
.co-card { position: sticky; top: 96px; display: grid; gap: 14px; padding: 24px; border: 1px solid var(--hair); border-radius: 18px; background: var(--paper) }
.co-done p { margin: 0 0 16px; color: var(--ink2); line-height: 1.5 }
.co-cancelled, .co-signin { margin: 0; color: var(--ink2); font-size: .92rem; line-height: 1.5 }
.co-fault { margin: 0; color: var(--danger, #b42318); font-size: .92rem }
.co-cta { display: inline-flex; align-items: center; justify-content: center; width: 100%; font: inherit; font-size: 15.5px; font-weight: 600; color: var(--paper); background: var(--ink);
  border: 1px solid var(--ink); border-radius: 999px; padding: 14px 22px; cursor: pointer; text-decoration: none }
.co-cta:disabled { opacity: .55; cursor: default }
.co-cta:focus-visible { outline: 2px solid var(--accent2); outline-offset: 3px }
.co-cta-inline { width: auto; margin-top: 22px }
@media (max-width: 820px) {
  .co-shell { grid-template-columns: minmax(0, 1fr); gap: 28px; padding-top: 32px }
  .co-card { position: static }
}
</style>
