<script setup>
/*
 * THE SHAPES A THING IS SOLD IN, as a row of chips per option.
 *
 * One control for every offer that has options, so a size, a colour and a finish are the same
 * thing to a buyer and to this code. It replaced a hardcoded Size row, and the reason it is
 * worth its own component rather than a loop in the page is the second rule below.
 *
 * TWO RULES, and both are about not lying to somebody mid-choice:
 *
 *   A combination a shop does not sell is shown and UNPRESSABLE, never hidden. Hiding it makes
 *   values appear and vanish as other options are picked, which reads as a broken page; and a
 *   buyer who wanted the one that is gone learns nothing about why.
 *
 *   A value is dimmed when NO combination containing it is sold given what is already chosen —
 *   which is a question about the whole matrix, not about the value. A shirt sold in small
 *   black and large white must dim white while small is picked, and un-dim it the moment large
 *   is. That is the bit a loop in the page would get wrong.
 *
 * The key it emits is the one the cart, the purchase and the fulfilment all carry, built by the
 * one grammar the build and the checkout function use (lib/variants.js).
 */
import { computed } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { normaliseOptions, variantsOf } from '@platform-kit/kit/lib/variants.js'
import { buyable } from '@platform-kit/kit/lib/stock.js'

const props = defineProps({
  /* the offer, for its sku and key — the matrix hangs off them */
  offer: { type: Object, required: true },
  /* what is chosen: an option name → a value slug */
  modelValue: { type: Object, default: () => ({}) },
  /* true once somebody has tried to buy without choosing, so the gap is pointed at */
  warn: { type: Boolean, default: false },
  /* what the shop has, keyed as _shared/stock.js keys it; null is "unknown", which sells */
  stock: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])

/* the product's own words — the  group, as every other store component reads them */
const W = computed(() => (us('store').product || {}).ui || {})
const options = computed(() => normaliseOptions(props.offer.options || []))
const matrix = computed(() => variantsOf(props.offer, options.value, { sold: { not: props.offer.unsold || [] } }))

/*
 * WOULD ANY COMBINATION HOLD THIS VALUE, given everything else already chosen? Asked of the
 * matrix rather than of the value, which is what makes "white, but only in large" read right.
 *
 * Asked TWICE, because a value can be unavailable for two different reasons and the reader is
 * told different things: `made` is whether the shop sells such a thing at all (the file), and
 * `had` is whether there is one today (the shop). A value nobody makes is struck through for
 * ever; one that has run out says so and may come back. One boolean would make the page say
 * "no longer made" about a jumper on a lorry.
 */
const holds = (v, optName, value) => v.chosen.every((c) => (c.option === optName ? c.value === value : (!props.modelValue[c.option] || props.modelValue[c.option] === c.value)))
function made(optName, value) { return matrix.value.some((v) => v.sold && holds(v, optName, value)) }
function had(optName, value) { return matrix.value.some((v) => v.sold && holds(v, optName, value) && buyable(props.offer, v.variant, props.stock)) }
/* pressable: it is made AND there is one. The two are separate only in what is SAID. */
function reachable(optName, value) { return made(optName, value) && had(optName, value) }

function pick(optName, value) {
  const next = { ...props.modelValue, [optName]: value }
  /* a choice may strand a later one — picking small where white is only large. Rather than
     leaving a dead selection, the stranded ones are dropped and the buyer re-picks, which is
     honest; silently changing their colour would not be. */
  for (const o of options.value) {
    if (o.name === optName) continue
    if (next[o.name] && !matrix.value.some((v) => v.sold && v.chosen.every((c) => !next[c.option] || next[c.option] === c.value))) delete next[o.name]
  }
  emit('update:modelValue', next)
}

const missing = computed(() => options.value.filter((o) => !props.modelValue[o.name]).map((o) => o.name))
defineExpose({ missing })
</script>

<template>
  <div v-if="options.length" class="vp">
    <div v-for="o in options" :key="o.name" class="vp-opt" :class="{ warn: warn && !modelValue[o.name] }">
      <span class="vp-label">
        {{ o.name }}
        <em v-if="warn && !modelValue[o.name]"> — {{ W.pick || '' }}</em>
      </span>
      <div class="vp-chips">
        <button
          v-for="v in o.values" :key="v.value" type="button" class="vp-chip"
          :class="{ on: modelValue[o.name] === v.value, off: !made(o.name, v.value), out: made(o.name, v.value) && !had(o.name, v.value) }"
          :disabled="!reachable(o.name, v.value)"
          :aria-pressed="modelValue[o.name] === v.value"
          :title="!made(o.name, v.value) ? (W['not-sold'] || '') : !had(o.name, v.value) ? (W['sold-out'] || '') : null"
          @click="pick(o.name, v.value)"
        >{{ v.label || v.value }}<em v-if="made(o.name, v.value) && !had(o.name, v.value)"> · {{ W['sold-out'] }}</em></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vp { display: flex; flex-direction: column; gap: 12px }
.vp-opt { display: flex; flex-direction: column; gap: 6px }
.vp-label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
.vp-opt.warn .vp-label { color: var(--accent) }
.vp-label em { font-style: normal; text-transform: none; letter-spacing: 0 }
.vp-chips { display: flex; flex-wrap: wrap; gap: 8px }
.vp-chip { border: 1px solid var(--hair); background: var(--paper); color: var(--ink); border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 14px; cursor: pointer }
.vp-chip:hover:not([disabled]) { border-color: var(--ink3) }
.vp-chip.on { border-color: var(--ink); background: var(--ink); color: var(--paper) }
/* RUN OUT IS NOT DISCONTINUED. A shape nobody makes is struck through — it is gone for good.
   A shape that has run out keeps its name upright and says so, because it is coming back. */
.vp-chip.out { opacity: .55; cursor: default }
.vp-chip.out em { font-style: normal; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3) }
/* shown, not hidden: a buyer who wanted it sees that it exists and is not available */
.vp-chip.off { opacity: .4; cursor: not-allowed; text-decoration: line-through }
.vp-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
</style>
