<script setup>
import { ref } from 'vue'
import { md, mdBlock } from './md.js'
import { glyph } from './icons.js'
import SectionHead from './SectionHead.vue'
/*
 * Tabs: a few panels under a row of tabs — each a label, a glyph, a passage of markdown and a
 * picture — as pills or an underline; a product's Description · Details · Shipping, a plan's
 * facets, anything told in parts.
 *
 * Slots for a look's skin: `head` and `panels`.
 */
defineProps({
  badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' },
  variant: { type: String, default: 'pills' },      /* pills | underline */
  items: { type: Array, default: () => [] },      /* [{ label, icon?, body, image? }] */
})
const at = ref(0)
</script>
<template>
  <section class="lpsec lptabs" :class="'lptb-' + variant">
    <div class="lpwrap">
      <slot name="head" :heading="heading" :lead="lead"><SectionHead :badge="badge" :eyebrow="eyebrow" :heading="heading" :lead="lead" center /></slot>
      <slot name="panels" :items="items" :at="at" :md="md">
        <div v-if="items.length" class="lptb lprv">
          <div class="lptb-row" role="tablist">
            <button v-for="(t, i) in items" :key="i" type="button" role="tab" :aria-selected="at === i" class="lptb-tab" :class="{ on: at === i }" @click="at = i"><span v-if="t.icon" class="lptb-ico" v-html="glyph(t.icon)"></span><span v-html="md(t.label)"></span></button>
          </div>
          <div class="lptb-panel" :key="at" :class="{ 'lptb-two': !!items[at].image }">
            <div class="lptb-body" v-html="mdBlock(items[at].body)"></div>
            <figure v-if="items[at].image" class="lpcard lptb-fig"><img :src="items[at].image" :alt="items[at].label || ''" loading="lazy" decoding="async" /></figure>
          </div>
        </div>
      </slot>
    </div>
  </section>
</template>
<style scoped>
.lptb { max-width: 980px; margin: 0 auto }
.lptb-row { display: flex; justify-content: center; gap: 4px; flex-wrap: wrap; margin-bottom: 30px }
.lptb-pills .lptb-row { padding: 4px; border-radius: 999px; background: var(--wash); border: 1px solid var(--hair); width: max-content; max-width: 100%; margin-left: auto; margin-right: auto }
.lptb-tab { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 14px; font-weight: 600; color: var(--ink3); background: none; border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer; transition: color .15s, background .15s }
.lptb-tab:hover { color: var(--ink) }
.lptb-pills .lptb-tab.on { color: var(--paper); background: var(--ink) }
.lptb-underline .lptb-row { border-bottom: 1px solid var(--hair); gap: 0 }
.lptb-underline .lptb-tab { border-radius: 0; padding: 12px 18px; border-bottom: 2px solid transparent; margin-bottom: -1px }
.lptb-underline .lptb-tab.on { color: var(--ink); border-bottom-color: var(--accent) }
.lptb-ico :deep(svg) { width: 16px; height: 16px }
.lptb-panel { animation: lptb-in .35s cubic-bezier(.2,.8,.2,1) }
@keyframes lptb-in { from { opacity: 0; transform: translateY(6px) } }
.lptb-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; align-items: center }
.lptb-panel:not(.lptb-two) .lptb-body { max-width: 640px; margin: 0 auto; text-align: center }
.lptb-body { font-size: 16.5px; line-height: 1.6; color: var(--ink2) } .lptb-body :deep(p) { margin: 0 0 12px } .lptb-body :deep(p:last-child) { margin: 0 } .lptb-body :deep(strong) { color: var(--ink) } .lptb-body :deep(ul) { padding-left: 1.2em }
.lptb-fig { margin: 0; overflow: hidden } .lptb-fig img { display: block; width: 100%; height: auto }
@media (max-width: 800px) { .lptb-two { grid-template-columns: 1fr; gap: 20px } .lptb-fig { order: -1 } }
</style>
