<script setup>
/*
 * THE JOIN CARD — where a site sells its network (network.access) and this reader is outside a grant.
 * Whole, in place of the timeline, for somebody who may not read; compact, in place of the composer
 * and the actions, for somebody who may read but not write. Its button buys the offer the config
 * names (network.access.join) — a membership by subscribing, anything else by checkout — after a
 * sign-in when there is nobody to sell to. Whether the reader is inside a grant is the database's
 * answer (network_admitted); this only says so. Words from network.md (access).
 *
 * It is also what any locked place of the community shows (openspec: community-access-by-entitlement):
 * Events, Messages, Notifications, a registered place — one card, one offer, wherever the reader is
 * kept out. A line left empty in the site's words is not drawn; where the site names its plans page
 * (network.access.plans), a quiet link to it sits under the button.
 */
import { computed, ref } from 'vue'
import site from '#site'
import { us } from 'platformkit/lib/content.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import { products } from 'platformkit/lib/storefront.js'
import { subscribe, checkout, money } from 'platformkit/lib/commerce.js'
import { navigate } from 'platformkit/lib/router.js'

const props = defineProps({ compact: { type: Boolean, default: false } })
const W = computed(() => us('network').access.main)
const sku = (site.network && site.network.access && site.network.access.join) || ''
const plans = (site.network && site.network.access && site.network.access.plans) || ''
function toPlans(e) { e.preventDefault(); navigate(plans) }
const offer = computed(() => (sku ? products.value.find((p) => p.sku === sku) || null : null))
const price = computed(() => {
  const o = offer.value
  if (!o || o.unit_amount == null) return ''
  /* a round price reads round: $100 a month, not $100.00 */
  const p = money(o.unit_amount, o.currency).replace(/[.,]00(?=\D*$)/, '')
  const key = o.interval === 'week' ? 'price-week' : o.interval === 'month' ? 'price-month' : 'price-once'
  return String(W.value[key] || '').replace('{price}', p)
})
const busy = ref(false)
const err = ref('')
async function join() {
  if (!isSignedIn.value) { if (window.DLauth) window.DLauth.open({ intent: 'buy' }); return }
  if (!offer.value) return
  busy.value = true; err.value = ''
  try { if (offer.value.recurring) await subscribe(offer.value.sku); else await checkout([{ sku: offer.value.sku, quantity: 1 }]) }
  catch { err.value = W.value.failed } finally { busy.value = false }
}
</script>

<template>
  <div class="nj" :class="{ 'nj-compact': compact }">
    <template v-if="!compact">
      <span class="nj-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="9.5" r="2.5" /><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M14.5 19.5a4.5 4.5 0 0 1 7-3.7" /></svg>
      </span>
      <h2>{{ W.title }}</h2>
      <p v-if="W.line || price"><template v-if="W.line">{{ W.line }}</template><b v-if="price" class="nj-price" :class="{ alone: !W.line }">{{ price }}{{ W.line ? '.' : '' }}</b></p>
    </template>
    <p v-else class="nj-line">{{ W['read-only'] }}<b v-if="price" class="nj-price">{{ price }}.</b></p>
    <button v-if="offer || !isSignedIn" type="button" class="nj-go" :disabled="busy" @click="join">{{ isSignedIn ? W.join : W.signin }}</button>
    <a v-if="plans && !compact && W.plans" class="nj-plans" :href="plans" @click="toPlans">{{ W.plans }}</a>
    <em v-if="err" class="nj-err">{{ err }}</em>
  </div>
</template>

<style scoped>
/* THE OFFER, as a thing worth having: a wash of the accent from the top, the mark on its tile, the
   price in the line, one button — rising into place like everything else that arrives */
.nj { position: relative; overflow: hidden; margin: 28px 18px; padding: 36px 24px 32px; border-radius: 22px; text-align: center;
  border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--hair));
  background: radial-gradient(120% 90% at 50% -20%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 60%), var(--paper);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 4%, transparent), 0 24px 48px -32px color-mix(in srgb, var(--accent) 42%, transparent);
  animation: nj-in .5s cubic-bezier(.2, .8, .2, 1) both }
@keyframes nj-in { from { opacity: 0; transform: translateY(10px) scale(.99) } }
.nj-mark { display: inline-grid; place-items: center; width: 60px; height: 60px; margin-bottom: 14px; border-radius: 19px; color: var(--accent);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 18%, var(--paper)), color-mix(in srgb, var(--accent) 6%, var(--paper)));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 12px 28px -18px color-mix(in srgb, var(--accent) 80%, transparent) }
.nj h2 { margin: 0 0 8px; max-width: none; font-family: var(--fd); font-size: 24px; font-weight: 800; letter-spacing: -.015em; color: var(--ink) }
.nj p { margin: 0 auto 18px; max-width: 40ch; font-size: 15.5px; line-height: 1.55; color: var(--ink2) }
.nj p b { color: var(--ink); font-weight: 700 }
.nj-price { margin-left: .3em }
.nj-price.alone { margin-left: 0 }
/* the other plans: quiet, under the button — a way to compare, never a second offer */
.nj-plans { display: block; width: fit-content; margin: 14px auto 0; font-size: 14px; font-weight: 600; color: var(--ink2); text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 18%, transparent); padding-bottom: 1px; transition: color .25s cubic-bezier(.2, .8, .2, 1), border-color .25s cubic-bezier(.2, .8, .2, 1) }
.nj-plans:hover { color: var(--ink); border-color: currentColor }
.nj-plans:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px }
.nj-go { font: inherit; font-size: 15px; font-weight: 700; padding: 12px 32px; border: 0; border-radius: 999px; color: var(--paper); cursor: pointer;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 82%, #fff) 0%, var(--accent) 60%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .28), 0 10px 22px -12px color-mix(in srgb, var(--accent) 85%, transparent);
  transition: transform .25s cubic-bezier(.2, .8, .2, 1), filter .25s }
.nj-go:hover { filter: brightness(1.05); transform: translateY(-1px) }
.nj-go:active { transform: scale(.98) }
@media (prefers-reduced-motion: reduce) { .nj { animation: none } .nj-go { transition: none } }
.nj-go:disabled { opacity: .6; cursor: default }
.nj-err { display: block; margin-top: 10px; font-style: normal; font-size: 13px; color: #c8382f }
/* in place of the composer: one line and the button, the height of a short composer */
.nj-compact { display: flex; align-items: center; gap: 14px; margin: 0; padding: 16px 18px; border: 0; border-bottom: 1px solid var(--hair); border-radius: 0; text-align: left; box-shadow: none;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 6%, var(--paper)), var(--paper)) }
.nj-compact .nj-line { flex: 1; margin: 0; max-width: none; font-size: 15px }
.nj-compact .nj-go { flex: none; padding: 9px 20px }
</style>
