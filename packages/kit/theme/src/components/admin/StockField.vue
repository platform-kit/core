<script setup>
/*
 * HOW MANY ARE LEFT, SET WHERE THE EDITOR ALREADY IS.
 *
 * The count is state and never touches the file — the model strips it on every save. This control
 * talks to the rows directly, as the signed-in administrator: anyone may READ a count (a card
 * needs to), and `inventory_set` refuses anybody who is not an admin, in SQL, so there is no
 * permission decision in this file at all.
 *
 * It sets a count and records a NOTE, because `inventory_set` writes the DIFFERENCE rather than
 * the new total: "now 40" is a number nobody can check, "found 3 more" is something somebody can
 * investigate. The last few movements are shown under it for the same reason — a count that has
 * drifted is read back, not guessed at.
 *
 * A shape at a time, because stock is per shape: a shop with linen and leather has two counts and
 * one of them running out is not the product running out.
 */
import { ref, computed, watch } from 'vue'
import { supabase, configured } from 'platformkit/lib/supabase.js'
import { optionsOf, variantsOf } from 'platformkit/lib/variants.js'
import { us } from 'platformkit/lib/content.js'

const props = defineProps({ form: { type: Object, default: () => ({}) } })

const W = computed(() => (us('models').stock || {}).main || {})
const rows = ref(null)
const moves = ref([])
const busy = ref('')
const said = ref('')

/* every shape this product is sold in, so a count can be set on each; one line for an offer with
   no options at all */
const shapes = computed(() => {
  const opts = optionsOf(props.form)
  const made = variantsOf({ sku: props.form.sku || '', key: props.form.key || '' }, opts, { sold: { not: props.form.unsold || [] } })
  return made.filter((v) => v.sold)
})
const countOf = (variant) => (rows.value || []).find((r) => r.variant === (variant || '')) || null
const availableOf = (variant) => { const r = countOf(variant); return r ? Math.max(0, r.stocked - r.reserved) : null }

async function load() {
  if (!configured || !props.form.sku) { rows.value = []; return }
  const { data } = await supabase.from('inventory').select('variant, stocked, reserved, updated_at').eq('sku', props.form.sku)
  rows.value = data || []
  const { data: m } = await supabase.from('inventory_movements').select('variant, delta, reason, note, at').eq('sku', props.form.sku).order('at', { ascending: false }).limit(8)
  moves.value = m || []
}
watch(() => props.form.sku, load, { immediate: true })

async function set(variant, value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) { said.value = W['whole-number']; return }
  busy.value = variant; said.value = ''
  const { data, error } = await supabase.rpc('inventory_set', { p_sku: props.form.sku, p_variant: variant || '', p_stocked: n, p_note: null })
  busy.value = ''
  if (error) { said.value = error.message; return }
  said.value = data === 0 ? W.same : fill(W.moved, { n: data > 0 ? '+' + data : String(data) })
  await load()
}

const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const when = (at) => { try { return new Date(at).toLocaleDateString() } catch { return '' } }
</script>

<template>
  <div class="ui-stock">
    <p v-if="!configured" class="ui-stocksay">{{ W['no-backend'] }}</p>
    <template v-else>
      <div v-for="v in shapes" :key="v.variant" class="ui-stockrow">
        <span class="ui-stockname">{{ v.label || W.one }}</span>
        <input
          type="number" min="0" step="1" class="ui-input ui-stockin" :disabled="busy === v.variant"
          :value="countOf(v.variant) ? countOf(v.variant).stocked : 0"
          :aria-label="W.stocked"
          @change="set(v.variant, $event.target.value)"
        />
        <span class="ui-stockheld">
          <template v-if="countOf(v.variant) && countOf(v.variant).reserved">{{ fill(W.held, { n: countOf(v.variant).reserved }) }}</template>
        </span>
        <span class="ui-stockleft" :class="{ none: availableOf(v.variant) === 0 }">{{ availableOf(v.variant) === null ? '' : fill(W.left, { n: availableOf(v.variant) }) }}</span>
      </div>
      <p v-if="said" class="ui-stocksaid">{{ said }}</p>
      <!-- WHY IT MOVED, so a count that has drifted can be read back rather than guessed at -->
      <details v-if="moves.length" class="ui-stockmoves">
        <summary>{{ W.movements }}</summary>
        <ul>
          <li v-for="(m, i) in moves" :key="i">
            <span class="ui-mvwhen">{{ when(m.at) }}</span>
            <span class="ui-mvdelta" :class="{ up: m.delta > 0 }">{{ m.delta > 0 ? '+' + m.delta : m.delta }}</span>
            <span class="ui-mvwhy">{{ W['reason-' + m.reason] || m.reason }}</span>
            <span v-if="m.variant" class="ui-mvwhat">{{ m.variant }}</span>
          </li>
        </ul>
      </details>
    </template>
  </div>
</template>

<style scoped>
.ui-stock { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--hair); border-radius: 12px; padding: 12px }
.ui-stockrow { display: grid; grid-template-columns: minmax(0, 1fr) 88px auto auto; align-items: center; gap: 10px; font-size: 14px }
.ui-stockname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ui-stockin { width: 100% }
.ui-stockheld, .ui-stockleft { font-size: 12px; color: var(--ink3); white-space: nowrap }
.ui-stockleft.none { color: var(--warn, var(--ink3)); font-weight: 500 }
.ui-stocksay, .ui-stocksaid { margin: 0; font-size: 12px; color: var(--ink3) }
.ui-stockmoves { margin-top: 4px; font-size: 12px; color: var(--ink3) }
.ui-stockmoves summary { cursor: pointer }
.ui-stockmoves ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px }
.ui-stockmoves li { display: flex; gap: 10px; align-items: baseline }
.ui-mvwhen { flex: 0 0 72px }
.ui-mvdelta { flex: 0 0 36px; text-align: right; font-variant-numeric: tabular-nums }
.ui-mvdelta.up { color: var(--ok, var(--ink)) }
.ui-mvwhy { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ui-mvwhat { color: var(--ink3); opacity: .8 }
@media (max-width: 560px) {
  .ui-stockrow { grid-template-columns: minmax(0, 1fr) 80px; row-gap: 2px }
  .ui-stockheld, .ui-stockleft { grid-column: span 1 }
}
</style>
