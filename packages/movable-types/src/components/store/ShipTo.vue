<script setup>
/*
 * Where it ships: the country a buyer chooses before checkout, and what shipping costs
 * there — the store's rules (src/lib/shipping.js) from the storefront's settings. The
 * choice is remembered in the browser; the first time, it is guessed from the browser's
 * locale when that is somewhere the store ships. Checkout is made for this country alone.
 */
import { computed } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { money } from '@platform-kit/kit/lib/commerce.js'
import { shipTo, rules, rates } from '@platform-kit/kit/lib/shipto.js'

const W = us('store').cart.ship
const names = (() => { try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }) } catch (e) { return null } })()
const name = (c) => { try { return (names && names.of(c)) || c } catch (e) { return c } }
const options = computed(() => rules.countries.map((c) => ({ code: c, name: name(c) })).sort((a, b) => a.name.localeCompare(b.name)))
const country = computed({ get: () => shipTo.value, set: (v) => { shipTo.value = v } })
const standard = computed(() => (rates.value[0] ? money(rates.value[0].amount, 'usd') : ''))
const more = computed(() => rates.value.slice(1))
</script>

<template>
  <div class="shipto">
    <label class="shipto-row">
      <span class="shipto-label">{{ W.label }}</span>
      <select v-model="country" class="shipto-sel">
        <option v-for="o in options" :key="o.code" :value="o.code">{{ o.name }}</option>
      </select>
    </label>
    <p v-if="standard" class="shipto-rate">{{ W.standard.replace('{price}', standard) }}<template v-if="more.length"> · {{ W.more.replace('{n}', more.length) }}</template></p>
  </div>
</template>

<style scoped>
.shipto { display: flex; flex-direction: column; gap: 4px }
.shipto-row { display: flex; align-items: center; justify-content: space-between; gap: 12px }
.shipto-label { font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.shipto-sel { font: inherit; font-size: 13.5px; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 6px 10px; max-width: 60% }
.shipto-rate { margin: 0; font-size: 12.5px; color: var(--ink3) }
</style>
