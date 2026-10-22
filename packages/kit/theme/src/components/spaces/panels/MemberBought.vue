<script setup>
/*
 * What somebody has bought: paid purchases, newest first, said in the store's own words where the
 * offers know the sku and by the sku itself where they do not — a book that has been taken off sale
 * is still something they bought. No Stripe id and no card of any kind is among them.
 * Words from the theme's content/ui/spaces.md (## member-panels), which a site rewords in its own.
 */
import { ref, watch, computed } from 'vue'
import { supabase } from 'platformkit/lib/supabase.js'
import { us } from 'platformkit/lib/content.js'
import { products } from '#content'

const props = defineProps({ user: { type: String, default: '' }, mine: { type: Boolean, default: false } })
const W = computed(() => us('spaces')['member-panels'].main)
const rows = ref([])
const done = ref(false)

watch(() => props.user, async (id) => {
  done.value = false
  rows.value = []
  if (!id) return
  const { data } = await supabase.rpc('member_bought', { p_user: id })
  rows.value = data || []
  done.value = true
}, { immediate: true })

const titleOf = (sku) => {
  const p = (products || []).find((x) => x.sku === sku)
  return (p && p.title) || sku
}
const money = (n, cur) => (typeof n === 'number'
  ? new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(n / 100)
  : '')
const when = (v) => {
  const d = new Date(v)
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}
</script>

<template>
  <ul v-if="rows.length" class="mb">
    <li v-for="(r, i) in rows" :key="r.sku + ':' + i">
      <b>{{ titleOf(r.sku) }}</b>
      <i>{{ money(r.amount, r.currency) }} · {{ when(r.at) }}</i>
    </li>
  </ul>
  <p v-else-if="done" class="su-quiet">{{ W[mine ? 'bought-none-own' : 'bought-none'] }}</p>
</template>

<style scoped>
.mb { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px }
.mb li { display: flex; align-items: baseline; gap: 10px; padding: 5px 0 }
.mb b { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 500; color: var(--ink2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.mb i { flex: none; font-style: normal; font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
</style>
