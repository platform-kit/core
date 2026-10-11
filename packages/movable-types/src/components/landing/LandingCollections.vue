<script setup>
import { computed } from 'vue'
import { md } from './md.js'
import { glyph } from './icons.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import { collections as COLLECTIONS } from '@platform-kit/kit/lib/storefront.js'
import { ROUTES } from '../../router.js'
import SectionHead from './SectionHead.vue'
/*
 * Collections: the store's collections as ways in — tiles with a picture, a name and a count;
 * small icon tiles; two big banners side by side; round pictures in a row — every one a link to
 * the collection's page. The site's own, or the ones the page picks, in its order.
 *
 * Slots for a look's skin: `head` and `tiles`.
 */
const props = defineProps({
  badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' },
  layout: { type: String, default: 'tiles' },   /* tiles | icons | banners | circles */
  ids: { type: Array, default: () => [] },      /* a picked list; blank = every collection */
  icons: { type: Object, default: () => ({}) }, /* id → glyph (the icons layout) */
  limit: { type: Number, default: 0 },
  cta: { type: String, default: '' }, href: { type: String, default: '' },
})
const W = (us('sections').collections || {}).tile || {}
const items = computed(() => { let list = props.ids.length ? props.ids.map((id) => COLLECTIONS.value.find((c) => c.id === id)).filter(Boolean) : COLLECTIONS.value; return props.limit > 0 ? list.slice(0, props.limit) : list })
const count = (c) => (W.count || '{n} items').replace('{n}', c.items.length)
</script>
<template>
  <section class="lpsec lpcollections" :class="'lpcl-' + layout">
    <div class="lpwrap">
      <div class="lpcl-top">
        <slot name="head" :heading="heading" :lead="lead"><SectionHead class="lpcl-head" :badge="badge" :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout === 'icons'" /></slot>
        <a v-if="cta" :href="href || ROUTES.store + '/collections'" class="lpcl-more lprv" v-html="md(cta)"></a>
      </div>
      <slot name="tiles" :items="items" :md="md">
        <div v-if="items.length" class="lpcl-grid lprv lpd1" :class="'lpcl-n' + Math.min(6, items.length)">
          <a v-for="(c, i) in items" :key="c.id" :href="c.href" class="lpcl lpk" :style="{ '--k': (0.05 + i * 0.06) + 's' }">
            <template v-if="layout === 'icons'"><span class="lpcl-ico" v-html="glyph(icons[c.id] || 'layers')"></span><b>{{ c.title }}</b><span class="lpcl-count">{{ count(c) }}</span></template>
            <template v-else-if="layout === 'circles'"><span class="lpcl-circ"><img v-if="c.image || c.covers[0]" :src="c.image || c.covers[0]" :alt="c.title" loading="lazy" /></span><b>{{ c.title }}</b><span class="lpcl-count">{{ count(c) }}</span></template>
            <template v-else>
              <img v-if="c.image || c.covers[0]" :src="c.image || c.covers[0]" :alt="c.title" loading="lazy" decoding="async" class="lpcl-pic" />
              <span class="lpcl-words"><b>{{ c.title }}</b><span v-if="layout === 'banners' && c.subtitle" class="lpcl-sub">{{ c.subtitle }}</span><span class="lpcl-count">{{ layout === 'banners' ? (W.explore || 'Explore') + ' →' : count(c) }}</span></span>
            </template>
          </a>
        </div>
      </slot>
    </div>
  </section>
</template>
<style scoped>
.lpcl-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px } .lpcl-top :deep(.lpshead) { margin-bottom: 30px }
.lpcl-more { margin-bottom: 34px; font-size: 14.5px; font-weight: 600; color: var(--accent2); text-decoration: none; white-space: nowrap }
.lpcl-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px }
.lpcl-n2 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpcl-n3 { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lpcl-n5, .lpcl-n6 { grid-template-columns: repeat(5, minmax(0, 1fr)) }
.lpcl { position: relative; display: flex; flex-direction: column; color: inherit; text-decoration: none; border-radius: 14px; overflow: hidden; background: var(--card); border: 1px solid var(--hair); transition: transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s } .lpcl:hover { transform: translateY(-3px); box-shadow: var(--shhi) }
.lpcl-pic { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; transition: transform .7s cubic-bezier(.2,.8,.2,1) } .lpcl:hover .lpcl-pic { transform: scale(1.04) }
.lpcl-words { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px 16px } .lpcl-words b { font-size: 16px } .lpcl-count { font-size: 13px; color: var(--ink3) }
/* icons */
.lpcl-icons .lpcl { align-items: center; text-align: center; padding: 22px 12px 18px; gap: 8px }
.lpcl-ico { display: inline-grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; color: var(--accent2); background: var(--accentbg) } .lpcl-ico :deep(svg) { width: 22px; height: 22px }
/* banners: two large, the words on the picture */
.lpcl-banners .lpcl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px }
.lpcl-banners .lpcl { aspect-ratio: 16 / 10; color: #fff; border: 0 } .lpcl-banners .lpcl-pic { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto }
.lpcl-banners .lpcl-words { position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 24px 24px; background: linear-gradient(180deg, transparent, #000000b8); gap: 4px } .lpcl-banners .lpcl-words b { font-size: 24px } .lpcl-banners .lpcl-sub { font-size: 14px; opacity: .85 } .lpcl-banners .lpcl-count { color: #fff; font-weight: 600; margin-top: 6px }
/* circles */
.lpcl-circles .lpcl { align-items: center; text-align: center; background: none; border: 0; gap: 8px; overflow: visible } .lpcl-circles .lpcl:hover { box-shadow: none }
.lpcl-circ { display: block; width: min(100%, 150px); aspect-ratio: 1; border-radius: 50%; overflow: hidden; background: var(--wash); box-shadow: var(--sh) } .lpcl-circ img { width: 100%; height: 100%; object-fit: cover; display: block }
@media (max-width: 900px) { .lpcl-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lpcl-n5, .lpcl-n6 { grid-template-columns: repeat(3, minmax(0, 1fr)) } }
@media (max-width: 600px) { .lpcl-grid, .lpcl-n3, .lpcl-n5, .lpcl-n6, .lpcl-banners .lpcl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px } .lpcl-top { flex-direction: column; align-items: flex-start } }
</style>
