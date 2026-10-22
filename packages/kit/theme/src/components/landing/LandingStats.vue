<script setup>
import { md } from './md.js'
import { glyph } from './icons.js'
import SectionHead from './SectionHead.vue'
import Stars from './Stars.vue'
import CountUp from './CountUp.vue'
/*
 * Stats: three or four numbers with a label each — readers, books, years, a percentage, a star
 * rating — as a row, as cards with a glyph, or beside the words (the heading to the left, the
 * numbers as a 2×2). The numbers are the page's words as written ("12,000+", "4.9"), never
 * computed; a value of `stars` draws the stars. A band is a tone.
 *
 * Slots for a look's skin: `head` and `stats`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'row' },   /* row | cards | beside | serif */
  animate: { type: Boolean, default: false }, /* the numbers count up as they enter view */
  stats: { type: Array, default: () => [] },  /* [{ value, label, note?, icon?, stars? }] */
  fine: { type: String, default: '' },
})
</script>

<template>
  <section class="lpsec lpstats" :class="'lpstats-' + layout">
    <div class="lpwrap" :class="{ 'lpst-two': layout === 'beside' }">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead class="lpst-head" :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout !== 'beside'" /></slot>
      <slot name="stats" :stats="stats" :md="md">
        <div v-if="stats.length" class="lpst-row lprv" :style="{ '--n': layout === 'beside' ? 2 : stats.length }">
          <div v-for="(s, i) in stats" :key="i" class="lpst lpk" :class="{ lpcard: layout === 'cards' }" :style="{ '--k': (0.1 + i * 0.1) + 's' }">
            <span v-if="s.icon && layout === 'cards'" class="lpst-ico" v-html="glyph(s.icon)"></span>
            <Stars v-if="s.stars" :value="Number(s.stars)" class="lpst-stars" />
            <b v-else class="lpst-v lpnum"><CountUp :value="s.value" :on="animate" /></b>
            <span class="lpst-l" v-html="md(s.label)"></span>
            <small v-if="s.note" class="lpst-n" v-html="md(s.note)"></small>
          </div>
        </div>
        <p v-if="fine" class="lpst-fine lprv lpd1" v-html="md(fine)"></p>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpst-row { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 24px; text-align: center }
.lpst { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 12px; border-left: 1px solid var(--hair) }
.lpst:first-child { border-left: 0 }
.lpst-v { font-family: var(--fd); font-weight: 600; font-size: clamp(40px, 5vw, 60px); line-height: 1; letter-spacing: -.03em; color: var(--ink) }
.lpst-v :deep(em) { color: var(--accent2); font-style: normal }
.lpst-l { font-size: 15px; font-weight: 500; color: var(--ink) }
.lpst-n { font-size: 13px; color: var(--ink3) }
.lpst-stars { margin: 14px 0 6px } .lpst-stars :deep(svg) { width: 22px; height: 22px }
.lpst-fine { margin: 34px auto 0; text-align: center; font-size: 14px; color: var(--ink3); max-width: 60ch }
/* serif: the number large, the label in the display italic beside it */
.lpstats-serif .lpst { flex-direction: row; align-items: baseline; gap: 10px; text-align: left; justify-content: center; flex-wrap: wrap }
.lpstats-serif .lpst-v { font-size: clamp(40px, 5vw, 64px); font-weight: 500 }
.lpstats-serif .lpst-l { font-family: var(--fd); font-style: italic; font-size: clamp(22px, 2.6vw, 32px); font-weight: 500; color: var(--ink2) }
.lpstats-serif .lpst-n { flex-basis: 100%; text-align: center }
/* cards */
.lpstats-cards .lpst { border-left: 0; padding: 26px 20px 24px; align-items: flex-start; text-align: left }
.lpstats-cards .lpst-v { font-size: clamp(34px, 3.6vw, 46px) }
.lpst-ico { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--accent2); background: var(--accentbg); margin-bottom: 10px } .lpst-ico :deep(svg) { width: 18px; height: 18px }
/* beside: the words left, a 2×2 right */
.lpst-two { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 56px; align-items: center }
.lpst-two .lpst-head { margin-bottom: 0 }
.lpstats-beside .lpst-row { gap: 16px }
.lpstats-beside .lpst { border-left: 0; align-items: flex-start; text-align: left; padding: 22px 22px 20px; border-radius: 14px; background: var(--card); border: 1px solid var(--hair); box-shadow: var(--sh) }
.lpstats-beside .lpst-v { font-size: clamp(32px, 3.4vw, 44px) }
@media (max-width: 720px) { .lpst-row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px 12px } .lpst { border-left: 0 } .lpst-two { grid-template-columns: 1fr; gap: 28px } }
</style>
