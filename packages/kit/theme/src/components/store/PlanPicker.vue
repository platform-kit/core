<script setup lang="ts">
/*
 * THE WAYS TO PAY FOR AN OFFER SOLD ON A PLAN OR IN TERMS (openspec: payment-plans): pay once, a number of monthly
 * payments, or a term in full or monthly — each a way the checkout sells under its own sku. A way that is a
 * commitment says what is agreed to, in full, and is bought only once the box is ticked; the server refuses it
 * otherwise, so the box is the page saying what the door already holds to.
 */
import { computed, ref, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { money, commit, subscribe, checkout } from 'platformkit/lib/commerce.js'
import { waysToPay, type WayToPay } from 'platformkit/lib/payment-plans.js'

const props = defineProps<{ product: any; busy?: boolean }>()
const emit = defineEmits<{ (e: 'run', fn: () => Promise<unknown>, evt: Record<string, unknown>): void }>()
const P = computed(() => (us('store').product || {}).ui || {})
const ways = computed(() => waysToPay(props.product))
const chosen = ref(0)
const agreed = ref(false)
watch(chosen, () => { agreed.value = false })
const way = computed<WayToPay | undefined>(() => ways.value[chosen.value])
const currency = computed(() => props.product?.currency || 'usd')
const fill = (s: string, v: Record<string, string | number>) => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(String(x)), s || '')
const label = (w: WayToPay) => {
  const amount = money(w.amount, currency.value)
  if (w.plan === 'once') return fill(P.value['plans-once'], { amount })
  if (w.plan === 'full') return fill(P.value['plans-full'], { months: w.months ?? '', amount })
  if (w.months) return fill(P.value['plans-monthly'], { months: w.months, amount })
  return fill(P.value['plans-instalments'], { n: w.payments, amount })
}
const commitment = computed(() => {
  const w = way.value
  if (!w || !w.committed) return ''
  const amount = money(w.amount, currency.value)
  if (w.plan === 'full') return fill(P.value['plans-commitment-full'], { amount, months: w.months ?? '' })
  return fill(P.value['plans-commitment'], { n: w.payments, amount, total: money(w.amount * w.payments, currency.value) })
})
const then = computed(() => (way.value?.months && way.value.then ? P.value['plans-then-' + way.value.then] : ''))
const ready = computed(() => !!way.value && (!way.value.committed || agreed.value))
function go() {
  const w = way.value
  if (!w || !ready.value) return
  const fn = w.committed ? () => commit(w.sku) : props.product.kind === 'membership' ? () => subscribe(w.sku) : () => checkout([{ sku: w.sku, quantity: 1 }])
  emit('run', fn, { kind: w.committed ? 'commit' : 'buy_now', product_id: w.sku })
}
</script>

<template>
  <div v-if="ways.length" class="pp-plans">
    <fieldset class="pp-plans-ways">
      <legend class="pp-plans-legend">{{ P['plans-label'] }}</legend>
      <label v-for="(w, i) in ways" :key="w.sku" class="pp-plans-way" :class="{ on: chosen === i }">
        <input v-model="chosen" type="radio" name="pp-plan" :value="i" />
        <span>{{ label(w) }}</span>
      </label>
    </fieldset>
    <p v-if="commitment" class="pp-plans-terms">{{ commitment }}<template v-if="then"> {{ then }}</template></p>
    <label v-if="way && way.committed" class="pp-plans-agree">
      <input v-model="agreed" type="checkbox" />
      <span>{{ P['plans-agree'] }}</span>
    </label>
    <button type="button" class="pp-btn" :disabled="busy || !ready" @click="go">{{ P['plans-cta'] }}</button>
  </div>
</template>

<style scoped>
.pp-plans { display: grid; gap: 14px }
.pp-plans-ways { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; min-width: 0 }
.pp-plans-legend { margin-bottom: 8px; padding: 0; color: var(--ink2); font-size: .92rem }
.pp-plans-way { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--hair); border-radius: 12px; cursor: pointer; line-height: 1.35 }
.pp-plans-way.on { border-color: var(--ink) }
.pp-plans-way input { margin: 0; accent-color: var(--ink) }
.pp-plans-terms { margin: 0; color: var(--ink2); font-size: .92rem; line-height: 1.5 }
.pp-plans-agree { display: flex; align-items: flex-start; gap: 10px; font-size: .95rem; line-height: 1.4; cursor: pointer }
.pp-plans-agree input { margin: 3px 0 0; accent-color: var(--ink) }
.pp-plans .pp-btn { justify-self: start }
@media (max-width: 620px) { .pp-plans .pp-btn { justify-self: stretch; width: 100% } }
</style>
