<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { md, mdBlock } from './md.js'
import { glyph } from './icons.js'
import SectionHead from './SectionHead.vue'
import Device from './Device.vue'
/*
 * Showcase: features told one at a time with a picture for each — the way a product page walks
 * through what it does. `scroll`: the pictures stay put while the features scroll past on the
 * other side, each lighting as it reaches the middle and swapping the picture; `tabs`: the
 * features as tabs (a click, or a hover), the chosen one's picture large; `flip`: picture cards
 * with the title on the front and the words on the back, turned by the pointer. A picture may
 * sit in a device.
 *
 * Slots for a look's skin: `head` and `items`.
 */
const props = defineProps({
  badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' },
  layout: { type: String, default: 'scroll' },    /* scroll | tabs | flip */
  device: { type: String, default: 'none' },       /* none | browser | phone | laptop */
  side: { type: String, default: 'right' },        /* the pictures' side: left | right */
  hover: { type: Boolean, default: true },         /* tabs switch on hover too */
  items: { type: Array, default: () => [] },       /* [{ icon?, title, body, image, video? }] */
})
const at = ref(0)
const list = ref(null)
let io = null
onMounted(() => {
  if (props.layout !== 'scroll' || !list.value) return
  const els = [...list.value.querySelectorAll('.lpsc-item')]
  io = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) at.value = Number(e.target.dataset.i) }) }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 })
  els.forEach((e) => io.observe(e))
})
onBeforeUnmount(() => io && io.disconnect())
</script>
<template>
  <section class="lpsec lpshowcase" :class="['lpsc-' + layout, { 'lpsc-l': side === 'left' }]">
    <div class="lpwrap">
      <slot name="head" :heading="heading" :lead="lead"><SectionHead :badge="badge" :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout === 'flip'" /></slot>
      <slot name="items" :items="items" :at="at" :md="md">
        <!-- flip cards -->
        <div v-if="layout === 'flip' && items.length" class="lpsc-flips">
          <div v-for="(it, i) in items" :key="i" class="lpsc-flipcard lprv" :class="{ ['lpd' + Math.min(3, i % 4)]: i % 4 }" tabindex="0">
            <div class="lpsc-flipin">
              <div class="lpsc-front lpcard"><img v-if="it.image" :src="it.image" :alt="it.title || ''" loading="lazy" decoding="async" /><span class="lpsc-frontw"><span v-if="it.icon" class="lpsc-ico" v-html="glyph(it.icon)"></span><h4 v-html="md(it.title)"></h4></span></div>
              <div class="lpsc-back lpcard"><span v-if="it.icon" class="lpsc-ico" v-html="glyph(it.icon)"></span><h4 v-html="md(it.title)"></h4><div class="lpsc-body" v-html="mdBlock(it.body)"></div></div>
            </div>
          </div>
        </div>
        <!-- scroll, and tabs: the list and the picture -->
        <div v-else-if="items.length" class="lpsc-two">
          <div ref="list" class="lpsc-list" :class="{ 'lpsc-tablist': layout === 'tabs' }" :role="layout === 'tabs' ? 'tablist' : undefined">
            <component v-for="(it, i) in items" :key="i" :is="layout === 'tabs' ? 'button' : 'div'" :type="layout === 'tabs' ? 'button' : undefined" :role="layout === 'tabs' ? 'tab' : undefined" :aria-selected="layout === 'tabs' ? at === i : undefined"
              class="lpsc-item" :class="{ on: at === i, lprv: layout === 'scroll' }" :data-i="i" @click="at = i" @mouseenter="layout === 'tabs' && hover ? (at = i) : null">
              <span v-if="it.icon" class="lpsc-ico" v-html="glyph(it.icon)"></span>
              <span class="lpsc-words"><h4 v-html="md(it.title)"></h4><div v-if="it.body" class="lpsc-body" v-html="mdBlock(it.body)"></div></span>
              <span v-if="layout === 'scroll'" class="lpsc-bar" aria-hidden="true"></span>
            </component>
          </div>
          <div class="lpsc-vis lprv lpd1">
            <span class="lphalo"></span>
            <div class="lpsc-stage">
              <template v-for="(it, i) in items" :key="i">
                <div v-show="at === i" class="lpsc-pic" :class="{ on: at === i }">
                  <Device v-if="device !== 'none'" :kind="device" :image="it.image" :video="it.video" :alt="it.title || ''" />
                  <figure v-else class="lpcard lpsc-fig"><video v-if="it.video" :src="it.video" autoplay muted loop playsinline></video><img v-else-if="it.image" :src="it.image" :alt="it.title || ''" loading="lazy" decoding="async" /></figure>
                </div>
              </template>
            </div>
          </div>
        </div>
      </slot>
    </div>
  </section>
</template>
<style scoped>
.lpsc-two { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: 56px; align-items: start }
.lpsc-l .lpsc-two .lpsc-vis { order: -1 }
.lpsc-vis { position: sticky; top: 96px }
.lpsc-stage { position: relative; z-index: 1 }
.lpsc-pic { animation: lpsc-in .45s cubic-bezier(.2,.8,.2,1) }
@keyframes lpsc-in { from { opacity: 0; transform: translateY(10px) scale(.985) } }
.lpsc-fig { margin: 0; overflow: hidden } .lpsc-fig img, .lpsc-fig video { display: block; width: 100%; height: auto }
.lpsc-list { display: flex; flex-direction: column; gap: 6px }
.lpsc-item { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: start; padding: 20px 22px 20px 18px; border-radius: 14px; border: 1px solid transparent; font: inherit; color: inherit; background: none; text-align: left; cursor: pointer; transition: background .25s, border-color .25s, opacity .25s }
.lpsc-item.on { background: var(--card); border-color: var(--hair); box-shadow: var(--sh) }
.lpsc-scroll .lpsc-item { padding: 28px 22px 28px 18px; min-height: 40vh; display: grid; align-content: center; cursor: default; opacity: .45 }
.lpsc-scroll .lpsc-item.on { opacity: 1 }
.lpsc-scroll .lpsc-item:first-child { min-height: 30vh } .lpsc-scroll .lpsc-item:last-child { min-height: 30vh }
.lpsc-bar { position: absolute; left: 0; top: 24px; bottom: 24px; width: 3px; border-radius: 2px; background: var(--hair) }
.lpsc-item.on .lpsc-bar { background: var(--accent) }
.lpsc-ico { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--accent2); background: var(--accentbg); flex: none } .lpsc-ico :deep(svg) { width: 18px; height: 18px }
.lpsc-item h4 { font-size: 18px; letter-spacing: -.01em; margin-bottom: 4px }
.lpsc-body { font-size: 15px; line-height: 1.55; color: var(--ink2) } .lpsc-body :deep(p) { margin: 0 0 8px } .lpsc-body :deep(p:last-child) { margin: 0 }
/* flip cards */
.lpsc-flips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px }
.lpsc-flipcard { perspective: 1200px; aspect-ratio: 4 / 5; outline: none }
.lpsc-flipin { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform .8s cubic-bezier(.2,.8,.2,1) }
.lpsc-flipcard:hover .lpsc-flipin, .lpsc-flipcard:focus-visible .lpsc-flipin { transform: rotateY(180deg) }
.lpsc-front, .lpsc-back { position: absolute; inset: 0; backface-visibility: hidden; overflow: hidden; display: flex; flex-direction: column }
.lpsc-front { padding: 0 } .lpsc-front img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.lpsc-frontw { position: relative; margin-top: auto; padding: 60px 22px 22px; background: linear-gradient(180deg, transparent, #000000b0); color: #fff; display: flex; flex-direction: column; gap: 10px }
.lpsc-frontw h4 { color: #fff; font-size: 22px } .lpsc-frontw .lpsc-ico { background: #ffffff22; color: #fff }
.lpsc-back { transform: rotateY(180deg); padding: 26px; gap: 10px; justify-content: center }
.lpsc-back h4 { font-size: 20px }
@media (prefers-reduced-motion: reduce) { .lpsc-flipin { transition: none } }
/* on a phone the tabs' picture sits above the list; the scroll layout keeps its picture stuck under the header and the items scroll beneath it, still changing the picture as they pass */
@media (max-width: 980px) { .lpsc-two { grid-template-columns: 1fr; gap: 24px } .lpsc-vis { position: static; order: -1 } .lpsc-scroll .lpsc-vis { position: sticky; top: 64px; z-index: 2 } .lpsc-scroll .lpsc-item { min-height: 32vh; padding: 18px } .lpsc-flips { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
@media (max-width: 600px) { .lpsc-flips { grid-template-columns: 1fr } .lpsc-flipcard { aspect-ratio: 4 / 3 } }
</style>
