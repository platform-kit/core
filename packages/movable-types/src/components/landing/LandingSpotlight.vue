<script setup>
import { ref, computed } from 'vue'
import { md, mdBlock } from './md.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import { money } from '@platform-kit/kit/lib/commerce.js'
import * as cart from '@platform-kit/kit/lib/cart.js'
import { capture } from '@platform-kit/kit/lib/analytics.js'
import { products as PRODUCTS } from '@platform-kit/kit/lib/storefront.js'
import { glyph } from './icons.js'
import Stars from './Stars.vue'
import SectionHead from './SectionHead.vue'
import LandingCountdown from './LandingCountdown.vue'
/*
 * Spotlight: one product, large, on a landing page — the site's own, by sku — its pictures as a
 * gallery with thumbnails, the name and a line, the stars, the price with an old price struck, a
 * passage the page writes or the product's own opening, a size to choose when it has sizes, a
 * quantity, Add to bag (the store's own bag) and the trust line under it; a drop's countdown and
 * what is left of it (`until`, `stock`) when the page says. The picture on the left or the right.
 *
 * Slots for a look's skin: `gallery` and `details`.
 */
const props = defineProps({
  badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' },
  sku: { type: String, default: '' },
  side: { type: String, default: 'left' },
  body: { type: String, default: '' },           /* markdown; blank = the product's own opening */
  points: { type: Array, default: () => [] },    /* [{ icon?, text }] under the passage */
  trust: { type: Array, default: () => [] },     /* [{ icon?, text }] the small line under the button */
  compare: { type: String, default: '' },        /* the old price, as written */
  until: { type: String, default: '' },          /* a drop: the moment it ends */
  stock: { type: Object, default: () => ({}) },  /* { left, total } — as written */
  cta: { type: String, default: '' },
})
const W = (us('sections').products || {}).card || {}
const SW = (us('sections').spotlight || {}).drop || {}
const P = us('store').product.ui
const p = computed(() => PRODUCTS.value.find((x) => x.sku === props.sku) || null)
const at = ref(0), size = ref(''), qty = ref(1), needSize = ref(false), added = ref(false)
const text = computed(() => props.body || (p.value && p.value.excerpt) || '')
function add() {
  if (!p.value || !p.value.available) return
  if (p.value.sizes && p.value.sizes.length && !size.value) { needSize.value = true; return }
  cart.add({ sku: p.value.sku, slug: p.value.id, name: p.value.title, variant: size.value, unit_amount: p.value.unit_amount, currency: p.value.currency, kind: p.value.kindKey, image: p.value.image ? p.value.image.src : null }, qty.value)
  capture('click', { kind: 'add_to_cart', product_id: p.value.sku, from: 'spotlight' })
  added.value = true; setTimeout(() => { added.value = false }, 1400); cart.openCart()
}
const pct = computed(() => { const l = Number(props.stock.left), t = Number(props.stock.total); return t > 0 ? Math.max(0, Math.min(100, Math.round((l / t) * 100))) : null })
</script>
<template>
  <section class="lpsec lpspotlight">
    <div class="lpwrap">
      <slot name="head" :heading="heading" :lead="lead"><SectionHead :badge="badge" :eyebrow="eyebrow" :heading="heading" :lead="lead" /></slot>
      <div v-if="p" class="lpsl" :class="{ 'lpsl-r': side === 'right' }">
        <slot name="gallery" :product="p" :at="at">
          <div class="lpsl-gal lprv">
            <span class="lphalo"></span>
            <figure class="lpcard lpsl-main" :key="at"><img v-if="p.images[at]" :src="p.images[at].src" :alt="p.title" decoding="async" /><span v-if="p.badge" class="lpsl-badge">{{ p.badge }}</span></figure>
            <div v-if="p.images.length > 1" class="lpsl-thumbs" role="tablist">
              <button v-for="(im, i) in p.images" :key="i" type="button" role="tab" :aria-selected="at === i" class="lpsl-thumb" :class="{ on: at === i }" @click="at = i"><img :src="im.src" :alt="p.title" loading="lazy" /></button>
            </div>
          </div>
        </slot>
        <slot name="details" :product="p" :md="md">
          <div class="lpsl-det lprv lpd1">
            <LandingCountdown v-if="until" :until="until" layout="strip" class="lpsl-cd" :heading="SW.ends" />
            <span v-if="p.tags && p.tags[0]" class="lpsl-tag">{{ p.tags[0] }}</span>
            <h3 class="lpsl-title">{{ p.title }}</h3>
            <p v-if="p.subtitle" class="lpsl-sub">{{ p.subtitle }}</p>
            <Stars v-if="p.rating" :value="Number(p.rating)" :line="p.reviews ? (W.reviews || '').replace('{n}', p.reviews) : ''" class="lpsl-stars" />
            <p class="lpsl-price"><b class="lpnum">{{ p.available ? money(p.unit_amount, p.currency) : P.unavailable }}</b><s v-if="compare" class="lpnum">{{ compare }}</s><i v-if="p.recurring">/ {{ p.interval }}</i></p>
            <div v-if="text" class="lpsl-body" v-html="mdBlock(text)"></div>
            <ul v-if="points.length" class="lpsl-points"><li v-for="(x, i) in points" :key="i"><span class="lpsl-pi" v-html="glyph(x.icon || 'check')"></span><span v-html="md(x.text)"></span></li></ul>
            <div v-if="pct != null" class="lpsl-stock"><span class="lpsl-stockbar"><i :style="{ width: pct + '%' }"></i></span><span class="lpsl-stockw">{{ (SW.left || '{left} of {total} left').replace('{left}', stock.left).replace('{total}', stock.total) }}</span></div>
            <div class="lpsl-buy">
              <label v-if="p.sizes && p.sizes.length" class="lpsl-size" :class="{ warn: needSize }"><span>{{ P['size-label'] || 'Size' }}</span><select v-model="size" @change="needSize = false"><option value="" disabled>{{ P['size-pick'] || '—' }}</option><option v-for="s in p.sizes" :key="s" :value="s">{{ s }}</option></select></label>
              <label class="lpsl-qty"><span>{{ P['qty-label'] || 'Qty' }}</span><input v-model.number="qty" type="number" min="1" max="20" /></label>
              <button type="button" class="lpbtn text-white lpsl-btn" :disabled="!p.available" @click="add"><span v-html="md(added ? W.added : (cta || W.add))"></span></button>
            </div>
            <ul v-if="trust.length" class="lpsl-trust"><li v-for="(x, i) in trust" :key="i"><span v-html="glyph(x.icon || 'check')"></span><span v-html="md(x.text)"></span></li></ul>
          </div>
        </slot>
      </div>
    </div>
  </section>
</template>
<style scoped>
.lpsl { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: 56px; align-items: start }
.lpsl-r .lpsl-gal { order: 2 }
.lpsl-gal { position: relative; display: flex; flex-direction: column; gap: 10px }
.lpsl-main { position: relative; z-index: 1; margin: 0; overflow: hidden; padding: 0; aspect-ratio: 1; background: var(--wash); animation: lpsl-in .35s ease } .lpsl-main img { width: 100%; height: 100%; object-fit: cover; display: block }
@keyframes lpsl-in { from { opacity: 0 } }
.lpsl-badge { position: absolute; top: 14px; left: 14px; font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--paper); background: var(--ink); border-radius: 999px; padding: 5px 10px }
.lpsl-thumbs { position: relative; z-index: 1; display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none }
.lpsl-thumb { flex: 0 0 72px; aspect-ratio: 1; padding: 0; border: 2px solid transparent; border-radius: 10px; overflow: hidden; background: var(--wash); cursor: pointer; opacity: .65; transition: opacity .2s, border-color .2s } .lpsl-thumb img { width: 100%; height: 100%; object-fit: cover; display: block } .lpsl-thumb.on { opacity: 1; border-color: var(--accent) } .lpsl-thumb:hover { opacity: 1 }
.lpsl-det { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; position: sticky; top: 96px }
.lpsl-cd { padding: 0 0 8px !important; border: 0 !important; width: 100% } .lpsl-cd :deep(.lpwrap) { padding: 0 } .lpsl-cd :deep(.lpcd) { justify-content: flex-start; gap: 16px } .lpsl-cd :deep(.lpcd-head .lps) { font-size: 15px; font-family: var(--m); letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); font-weight: 500 }
.lpsl-tag { font-family: var(--m); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent2) }
.lpsl-title { font-size: clamp(28px, 3.4vw, 40px); letter-spacing: -.02em; line-height: 1.1 }
.lpsl-sub { margin: 0; font-size: 16.5px; color: var(--ink2) }
.lpsl-price { display: flex; align-items: baseline; gap: 10px; margin: 6px 0 0 } .lpsl-price b { font-family: var(--fd); font-size: 32px; font-weight: 600; letter-spacing: -.02em } .lpsl-price s { font-size: 18px; color: var(--ink3) } .lpsl-price i { font-style: normal; font-size: 13px; color: var(--ink3) }
.lpsl-body { font-size: 16px; line-height: 1.6; color: var(--ink2); margin-top: 4px } .lpsl-body :deep(p) { margin: 0 0 10px } .lpsl-body :deep(p:last-child) { margin: 0 }
.lpsl-points { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px } .lpsl-points li { display: flex; gap: 10px; align-items: flex-start; font-size: 15px } .lpsl-pi { flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; color: var(--accent2); background: var(--accentbg) } .lpsl-pi :deep(svg) { width: 13px; height: 13px }
.lpsl-stock { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 360px; margin-top: 8px } .lpsl-stockbar { height: 6px; border-radius: 3px; background: var(--wash); overflow: hidden } .lpsl-stockbar i { display: block; height: 100%; background: var(--accent); border-radius: 3px } .lpsl-stockw { font-size: 13px; color: var(--ink3) }
.lpsl-buy { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-top: 14px; width: 100% }
.lpsl-size, .lpsl-qty { display: flex; flex-direction: column; gap: 5px; font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.lpsl-size select, .lpsl-qty input { font: inherit; font-family: var(--f, inherit); font-size: 14px; text-transform: none; letter-spacing: 0; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 10px; height: 46px; padding: 0 12px; min-width: 96px } .lpsl-qty input { width: 76px }
.lpsl-size.warn select { border-color: #c2410c }
.lpsl-btn { height: 46px; cursor: pointer; font: inherit; font-weight: 600; font-size: 15.5px } .lpsl-btn:disabled { opacity: .5; cursor: default }
.lpsl-trust { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 18px } .lpsl-trust li { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink3) } .lpsl-trust :deep(svg) { width: 14px; height: 14px; color: var(--accent2) }
@media (max-width: 980px) { .lpsl { grid-template-columns: 1fr; gap: 28px } .lpsl-r .lpsl-gal { order: 0 } .lpsl-det { position: static } }
</style>
