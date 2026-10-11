<script setup>
import { computed, ref } from 'vue'
import { md } from './md.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import { money } from '@platform-kit/kit/lib/commerce.js'
import * as cart from '@platform-kit/kit/lib/cart.js'
import { capture } from '@platform-kit/kit/lib/analytics.js'
import { products as PRODUCTS, collection as collectionOf } from '@platform-kit/kit/lib/storefront.js'
import { ROUTES } from '../../router.js'
import ProductCard from '../store/ProductCard.vue'
import Stars from './Stars.vue'
import SectionHead from './SectionHead.vue'
/*
 * Products: the site's own products on a landing page — a collection's, a tag's, the featured, or
 * every one — as cards (the store's own card: a book stands as an object, a good as its picture),
 * a bordered grid, a rail that scrolls sideways, or a compact list; as many as the page says, in the
 * store's order or by price. A card carries the badge, the price (struck through when the page gives
 * an old one), stars when the product has a rating, and a quick add where nothing needs choosing.
 *
 * Slots for a look's skin: `head` and `products`.
 */
const props = defineProps({
  badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' },
  source: { type: String, default: 'all' },     /* all | featured | collection | tag | skus */
  collection: { type: String, default: '' },
  tag: { type: String, default: '' },
  skus: { type: Array, default: () => [] },     /* a hand-picked list, in this order */
  layout: { type: String, default: 'cards' },   /* cards | bordered | rail | list */
  columns: { type: Number, default: 4 },
  limit: { type: Number, default: 8 },
  sort: { type: String, default: 'order' },     /* order | price-asc | price-desc | newest */
  cta: { type: String, default: '' }, href: { type: String, default: '' },
})
const W = (us('sections').products || {}).card || {}
const P = us('store').product.ui
const items = computed(() => {
  let list = PRODUCTS.value.filter((p) => !p.hidden && p.kind !== 'membership' && p.kind !== 'session')
  if (props.source === 'featured') list = list.filter((p) => p.featured)
  else if (props.source === 'collection' && props.collection) { const c = collectionOf(props.collection); list = c ? c.items : [] }
  else if (props.source === 'tag' && props.tag) list = list.filter((p) => (p.tags || []).includes(props.tag))
  else if (props.source === 'skus' && props.skus.length) list = props.skus.map((s) => list.find((p) => p.sku === s)).filter(Boolean)
  if (props.sort === 'price-asc') list = list.slice().sort((a, b) => (a.unit_amount || 0) - (b.unit_amount || 0))
  if (props.sort === 'price-desc') list = list.slice().sort((a, b) => (b.unit_amount || 0) - (a.unit_amount || 0))
  return props.limit > 0 ? list.slice(0, props.limit) : list
})
const added = ref('')
function quickAdd(p, e) {
  e.preventDefault()
  cart.add({ sku: p.sku, slug: p.id, name: p.title, variant: '', unit_amount: p.unit_amount, currency: p.currency, kind: p.kindKey, image: p.image ? p.image.src : null })
  capture('click', { kind: 'add_to_cart', product_id: p.sku, from: 'section' })
  added.value = p.sku; setTimeout(() => { added.value = '' }, 1400); cart.openCart()
}
const quick = (p) => p.available && p.kind !== 'print' && p.kind !== 'book' && !(p.sizes && p.sizes.length)
</script>
<template>
  <section class="lpsec lpproducts" :class="'lppd-' + layout">
    <div class="lpwrap">
      <div class="lppd-top">
        <slot name="head" :heading="heading" :lead="lead"><SectionHead class="lppd-head" :badge="badge" :eyebrow="eyebrow" :heading="heading" :lead="lead" /></slot>
        <a v-if="cta" :href="href || ROUTES.store" class="lppd-more lprv" v-html="md(cta)"></a>
      </div>
      <slot name="products" :items="items" :md="md">
        <!-- the list: a row per product -->
        <div v-if="layout === 'list' && items.length" class="lppd-rows lprv lpd1">
          <a v-for="(p, i) in items" :key="p.id" :href="p.href" class="lppd-row lpk" :style="{ '--k': (0.05 + i * 0.05) + 's' }">
            <span class="lppd-thumb"><img v-if="p.image" :src="p.image.src" :alt="p.title" loading="lazy" /></span>
            <span class="lppd-roww"><span v-if="p.tags && p.tags[0]" class="lppd-tag">{{ p.tags[0] }}</span><b>{{ p.title }}</b><span v-if="p.subtitle" class="lppd-sub">{{ p.subtitle }}</span><Stars v-if="p.rating" :value="Number(p.rating)" :line="p.reviews ? (W.reviews || '').replace('{n}', p.reviews) : ''" class="lppd-stars" /></span>
            <span class="lppd-price lpnum"><b>{{ p.available ? money(p.unit_amount, p.currency) : P.unavailable }}</b><s v-if="p.compare" class="lpnum">{{ p.compare }}</s></span>
            <button v-if="quick(p)" type="button" class="lppd-add" :class="{ on: added === p.sku }" @click="quickAdd(p, $event)">{{ added === p.sku ? W.added : W.add }}</button>
            <span v-else class="lppd-view">{{ W.view }} →</span>
          </a>
        </div>
        <!-- cards, bordered, and the rail -->
        <div v-else-if="items.length" class="lppd-grid lprv lpd1" :class="'lppd-c' + Math.min(5, Math.max(2, columns))">
          <div v-for="(p, i) in items" :key="p.id" class="lppd-cell lpk" :style="{ '--k': (0.05 + i * 0.05) + 's' }">
            <ProductCard :product="p" />
          </div>
        </div>
      </slot>
    </div>
  </section>
</template>
<style scoped>
.lppd-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px }
.lppd-top :deep(.lpshead) { margin-bottom: 30px }
.lppd-more { margin-bottom: 34px; font-size: 14.5px; font-weight: 600; color: var(--accent2); text-decoration: none; white-space: nowrap }
.lppd-grid { display: grid; gap: 18px }
.lppd-c2 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lppd-c3 { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lppd-c4 { grid-template-columns: repeat(4, minmax(0, 1fr)) } .lppd-c5 { grid-template-columns: repeat(5, minmax(0, 1fr)) }
.lppd-cell { min-width: 0 }

/* bordered: hairlines between, no boxes */
.lppd-bordered .lppd-grid { gap: 0; border-top: 1px solid var(--hair); border-left: 1px solid var(--hair) }
.lppd-bordered .lppd-cell { padding: 20px; border-right: 1px solid var(--hair); border-bottom: 1px solid var(--hair) }
/* the rail: sideways */
/* THE SNAP MUST KEEP THE GUTTER TOO. The rail pulls itself out to the page edge and pads the
   gutter back, which is right — but a mandatory snap with no scroll-padding lands the first card's
   edge on the CONTAINER's edge, scrolling the gutter away the moment the page loads. At 390 that put
   the first product hard against the screen. scroll-padding makes the snap line the gutter. */
.lppd-rail .lppd-grid { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: 28px; scrollbar-width: none; margin: 0 -28px; padding: 0 28px 8px }
.lppd-rail .lppd-grid::-webkit-scrollbar { display: none }
.lppd-rail .lppd-cell { flex: 0 0 240px; scroll-snap-align: start }
/* the list */
.lppd-rows { display: flex; flex-direction: column; border-top: 1px solid var(--hair) }
.lppd-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto auto; gap: 18px; align-items: center; padding: 14px 6px; border-bottom: 1px solid var(--hair); color: inherit; text-decoration: none; transition: background .15s } .lppd-row:hover { background: var(--wash) }
.lppd-thumb { display: block; width: 72px; height: 72px; border-radius: 10px; background: var(--wash); overflow: hidden } .lppd-thumb img { width: 100%; height: 100%; object-fit: cover; display: block }
.lppd-roww { display: flex; flex-direction: column; gap: 2px; min-width: 0 } .lppd-roww b { font-size: 16px } .lppd-sub { font-size: 13.5px; color: var(--ink3) }
.lppd-tag { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.lppd-stars :deep(svg) { width: 13px; height: 13px }
.lppd-price { display: flex; flex-direction: column; align-items: flex-end } .lppd-price b { font-family: var(--fd); font-size: 18px; font-weight: 600 } .lppd-price s { font-size: 13px; color: var(--ink3) }
.lppd-add { font: inherit; font-size: 13px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 9px 16px; cursor: pointer; white-space: nowrap } .lppd-add.on { background: var(--accent2) }
.lppd-view { font-size: 13.5px; font-weight: 600; color: var(--accent2); white-space: nowrap }
@media (max-width: 980px) { .lppd-c4, .lppd-c5 { grid-template-columns: repeat(3, minmax(0, 1fr)) } }
@media (max-width: 640px) { .lppd-grid, .lppd-c3, .lppd-c4, .lppd-c5 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px } .lppd-top { flex-direction: column; align-items: flex-start } .lppd-row { grid-template-columns: 56px minmax(0, 1fr) auto; } .lppd-add, .lppd-view { grid-column: 2 / -1; justify-self: start } .lppd-thumb { width: 56px; height: 56px } }
</style>
