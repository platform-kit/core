<script setup>
import { md } from './md.js'
import { glyph } from './icons.js'
/*
 * Perks: the slim strip of reasons — free shipping, secure payment, a return within thirty days —
 * three or four, each a glyph, a title and a line, in a row with hairlines between; on a phone,
 * two by two. A band is a tone.
 *
 * Slots for a look's skin: `items`.
 */
defineProps({
  items: { type: Array, default: () => [] },   /* [{ icon, title, body?, image? }] — an image (a payment method's mark) in place of the glyph */
  align: { type: String, default: 'center' },  /* center | left */
  layout: { type: String, default: 'strip' },  /* strip | cards | grid | inline */
})
</script>

<template>
  <section class="lpsec lpperks" :class="['lpperks-' + align, 'lppk-' + layout]">
    <div class="lpwrap">
      <slot name="items" :items="items" :md="md">
        <ul v-if="items.length" class="lppk-row lprv" :style="{ '--n': items.length }">
          <li v-for="(p, i) in items" :key="i" class="lpk" :class="{ lpcard: layout === 'cards' }" :style="{ '--k': (0.05 + i * 0.08) + 's' }">
            <span v-if="p.image" class="lppk-img"><img :src="p.image" :alt="p.title || ''" loading="lazy" /></span>
            <span v-else class="lppk-ico" v-html="glyph(p.icon || 'check')"></span>
            <div><b v-html="md(p.title)"></b><span v-if="p.body" v-html="md(p.body)"></span></div>
          </li>
        </ul>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpperks { padding: 34px 0 }
.lppk-row { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 18px }
.lppk-row li { display: flex; align-items: center; gap: 14px; padding: 6px 18px; border-left: 1px solid var(--hair) }
.lppk-row li:first-child { border-left: 0; padding-left: 0 }
.lpperks-center li { justify-content: center }
.lppk-ico { flex: none; display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: var(--accent2); background: var(--accentbg) } .lppk-ico :deep(svg) { width: 19px; height: 19px }
.lppk-row div { display: flex; flex-direction: column; gap: 1px; line-height: 1.3 }
.lppk-row b { font-size: 15px; font-weight: 600; color: var(--ink) } .lppk-row span { font-size: 13px; color: var(--ink3) }
.lppk-img { flex: none; display: grid; place-items: center; width: 52px; height: 36px; border-radius: 8px; background: var(--card); border: 1px solid var(--hair) } .lppk-img img { max-width: 40px; max-height: 24px; object-fit: contain }
/* cards: each perk in its own box, the words under the glyph */
.lppk-cards .lppk-row li { flex-direction: column; text-align: center; padding: 24px 18px; border-left: 0 } .lppk-cards .lppk-row div { align-items: center } .lppk-cards .lppk-ico { width: 48px; height: 48px; border-radius: 50% }
/* grid: two by two, a line each */
.lppk-grid .lppk-row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 40px } .lppk-grid .lppk-row li { border-left: 0; padding: 0; align-items: flex-start; justify-content: flex-start } .lppk-grid .lppk-row span { font-size: 14px; color: var(--ink2) }
/* inline: one line, pipes between */
.lppk-inline { padding: 18px 0 } .lppk-inline .lppk-row { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px 0 } .lppk-inline .lppk-row li { padding: 4px 22px; gap: 8px } .lppk-inline .lppk-ico { width: 26px; height: 26px; border-radius: 7px; background: none; color: var(--accent2) } .lppk-inline .lppk-ico :deep(svg) { width: 16px; height: 16px } .lppk-inline .lppk-row b { font-size: 13.5px; font-weight: 500 } .lppk-inline .lppk-row span { display: none }
@media (max-width: 860px) { .lppk-row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px } .lppk-row li { border-left: 0; padding: 6px 0; justify-content: flex-start } }
</style>
