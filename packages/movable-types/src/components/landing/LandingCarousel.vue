<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { md } from './md.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import SectionHead from './SectionHead.vue'
/*
 * Carousel: slides — a picture, a title, a line, a link each — moved by arrows, dots, a drag or a
 * swipe (a scrolling row that snaps), one at a time or several across; `arc` fans the slides on a
 * curve, the middle one upright; `coverflow` stacks the sides back; `strip` shows one large with the
 * others as thumbnails under it. Autoplay when asked, paused under the pointer and off under
 * reduced motion. The buttons' words are the `sections` strings.
 *
 * Slots for a look's skin: `head` and `slides`.
 */
const props = defineProps({
  badge: { type: String, default: '' }, eyebrow: { type: String, default: '' }, heading: { type: String, default: '' }, lead: { type: String, default: '' },
  layout: { type: String, default: 'cards' },   /* cards | arc | coverflow | strip */
  across: { type: Number, default: 3 },
  autoplay: { type: Number, default: 0 },       /* seconds; 0 off */
  items: { type: Array, default: () => [] },    /* [{ image, title?, body?, href? }] */
})
const W = (us('sections').carousel || {}).nav || {}
const at = ref(0)
const n = computed(() => props.items.length)
const go = (d) => { at.value = (at.value + d + n.value) % n.value; scrollTo() }
const track = ref(null)
function scrollTo() { const el = track.value && track.value.children[at.value]; if (el && props.layout === 'cards') el.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'smooth' }) }
function onScroll() { if (props.layout !== 'cards' || !track.value) return; const k = [...track.value.children]; const x = track.value.scrollLeft; let best = 0, d = 1e9; k.forEach((c, i) => { const dd = Math.abs(c.offsetLeft - x); if (dd < d) { d = dd; best = i } }); at.value = best }
let timer = null, hover = false
const rm = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
onMounted(() => { if (props.autoplay > 0 && !rm) timer = setInterval(() => { if (!hover) go(1) }, props.autoplay * 1000) })
onBeforeUnmount(() => clearInterval(timer))
const off = (i) => { let d = i - at.value; if (d > n.value / 2) d -= n.value; if (d < -n.value / 2) d += n.value; return d }
</script>
<template>
  <section class="lpsec lpcarousel" :class="'lpcr-' + layout" @mouseenter="hover = true" @mouseleave="hover = false">
    <div class="lpwrap">
      <div class="lpcr-top">
        <slot name="head" :heading="heading" :lead="lead"><SectionHead class="lpcr-head" :badge="badge" :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout !== 'cards'" /></slot>
        <div v-if="n > 1 && layout === 'cards'" class="lpcr-nav lprv">
          <button type="button" class="lpcr-btn" :aria-label="W.previous" @click="go(-1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8H2M7 3L2 8l5 5" /></svg></button>
          <button type="button" class="lpcr-btn" :aria-label="W.next" @click="go(1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M9 3l5 5-5 5" /></svg></button>
        </div>
      </div>
      <slot name="slides" :items="items" :at="at" :md="md">
        <!-- cards: a snapping row -->
        <div v-if="layout === 'cards' && items.length" ref="track" class="lpcr-track lprv" :style="{ '--n': across }" @scroll.passive="onScroll">
          <component v-for="(s, i) in items" :key="i" :is="s.href ? 'a' : 'div'" :href="s.href || undefined" class="lpcard lpcr-slide" :class="{ lplift: !!s.href }">
            <img v-if="s.image" :src="s.image" :alt="s.title || ''" loading="lazy" decoding="async" />
            <div v-if="s.title || s.body" class="lpcr-words"><h4 v-if="s.title" v-html="md(s.title)"></h4><p v-if="s.body" v-html="md(s.body)"></p></div>
          </component>
        </div>
        <!-- arc and coverflow: placed by their distance from the one in front -->
        <div v-else-if="(layout === 'arc' || layout === 'coverflow') && items.length" class="lpcr-stage lprv">
          <component v-for="(s, i) in items" :key="i" :is="s.href && off(i) === 0 ? 'a' : 'div'" :href="s.href && off(i) === 0 ? s.href : undefined" class="lpcard lpcard-solid lpcr-slide lpcr-abs" :class="{ on: off(i) === 0 }" :style="{ '--o': off(i), zIndex: 10 - Math.abs(off(i)), opacity: Math.abs(off(i)) > 2 ? 0 : 1 }" @click="off(i) !== 0 ? (at = i) : null">
            <img v-if="s.image" :src="s.image" :alt="s.title || ''" loading="lazy" decoding="async" />
            <div v-if="s.title" class="lpcr-words"><h4 v-html="md(s.title)"></h4><p v-if="s.body" v-html="md(s.body)"></p></div>
          </component>
        </div>
        <!-- the strip: one large, thumbnails under -->
        <div v-else-if="layout === 'strip' && items.length" class="lpcr-stripw lprv">
          <figure class="lpcard lpcr-big" :key="at"><img :src="items[at].image" :alt="items[at].title || ''" decoding="async" /><figcaption v-if="items[at].title || items[at].body"><b v-if="items[at].title" v-html="md(items[at].title)"></b><span v-if="items[at].body" v-html="md(items[at].body)"></span></figcaption></figure>
          <div class="lpcr-thumbs" role="tablist">
            <button v-for="(s, i) in items" :key="i" type="button" role="tab" :aria-selected="at === i" class="lpcr-thumb" :class="{ on: at === i }" @click="at = i"><img :src="s.image" :alt="s.title || ''" loading="lazy" /></button>
          </div>
        </div>
        <div v-if="n > 1 && layout !== 'cards'" class="lpcr-under lprv lpd1">
          <button type="button" class="lpcr-btn" :aria-label="W.previous" @click="go(-1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8H2M7 3L2 8l5 5" /></svg></button>
          <span class="lpcr-dots"><i v-for="(s, i) in items" :key="i" :class="{ on: at === i }" @click="at = i"></i></span>
          <button type="button" class="lpcr-btn" :aria-label="W.next" @click="go(1)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M9 3l5 5-5 5" /></svg></button>
        </div>
      </slot>
    </div>
  </section>
</template>
<style scoped>
.lpcr-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px }
.lpcr-nav, .lpcr-under { display: flex; gap: 8px; align-items: center; margin-bottom: 40px }
.lpcr-under { justify-content: center; margin: 28px 0 0 }
.lpcr-btn { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--ink); background: var(--card); border: 1px solid var(--hair); cursor: pointer; transition: transform .15s, border-color .15s } .lpcr-btn:hover { transform: translateY(-1px); border-color: var(--ink3) }
.lpcr-dots { display: inline-flex; gap: 6px; margin: 0 8px } .lpcr-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--hair); cursor: pointer; transition: background .2s, transform .2s } .lpcr-dots i.on { background: var(--accent); transform: scale(1.25) }
/* cards */
.lpcr-track { display: grid; grid-auto-flow: column; grid-auto-columns: calc((100% - (var(--n) - 1) * 18px) / var(--n)); gap: 18px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; padding-bottom: 6px; margin: 0 -28px; padding-left: 28px; padding-right: 28px }
.lpcr-track::-webkit-scrollbar { display: none }
.lpcr-slide { scroll-snap-align: start; overflow: hidden; display: flex; flex-direction: column; color: inherit; text-decoration: none; padding: 0 }
.lpcr-slide img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover }
.lpcr-words { padding: 16px 18px 18px } .lpcr-words h4 { font-size: 17px; margin-bottom: 4px } .lpcr-words p { margin: 0; font-size: 14px; color: var(--ink2); line-height: 1.45 }
/* arc and coverflow */
/* the perspective is in each card's own transform, not on the stage: a shared 3D context paints by depth, and a turned card's near edge would come through its neighbour */
.lpcr-stage { position: relative; height: 360px; margin: 0 auto; max-width: 980px }
.lpcr-abs { position: absolute; left: 50%; top: 0; width: 300px; margin-left: -150px; transition: transform .7s cubic-bezier(.2,.8,.2,1), opacity .5s; cursor: pointer }
.lpcr-abs.on { cursor: default }
.lpcr-arc .lpcr-stage { height: 440px }
.lpcr-arc .lpcr-abs { transform-origin: 50% 900px; transform: rotate(calc(var(--o) * 14deg)) }
.lpcr-coverflow .lpcr-abs { transform: perspective(1400px) translateX(calc(var(--o) * 240px)) translateZ(calc(-1 * max(var(--o), calc(-1 * var(--o))) * 160px)) rotateY(calc(var(--o) * -28deg)) }
.lpcr-coverflow .lpcr-abs.on { transform: perspective(1400px) translateZ(40px) }
/* the strip */
.lpcr-stripw { max-width: 920px; margin: 0 auto }
.lpcr-big { margin: 0; overflow: hidden; padding: 0; animation: lpcr-in .4s ease } .lpcr-big img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover }
.lpcr-big figcaption { display: flex; gap: 10px; align-items: baseline; padding: 14px 18px; font-size: 14px; color: var(--ink2) } .lpcr-big figcaption b { color: var(--ink) }
@keyframes lpcr-in { from { opacity: 0 } }
.lpcr-thumbs { display: flex; gap: 8px; margin-top: 12px; overflow-x: auto; scrollbar-width: none }
.lpcr-thumb { flex: 0 0 96px; aspect-ratio: 16 / 10; padding: 0; border: 2px solid transparent; border-radius: 10px; overflow: hidden; background: var(--wash); cursor: pointer; opacity: .6; transition: opacity .2s, border-color .2s }
.lpcr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block } .lpcr-thumb.on { opacity: 1; border-color: var(--accent) } .lpcr-thumb:hover { opacity: 1 }
@media (max-width: 980px) { .lpcr-track { grid-auto-columns: 70% } .lpcr-stage { height: 320px } .lpcr-abs { width: 240px; margin-left: -120px } .lpcr-coverflow .lpcr-abs { transform: perspective(1400px) translateX(calc(var(--o) * 160px)) translateZ(calc(-1 * max(var(--o), calc(-1 * var(--o))) * 160px)) rotateY(calc(var(--o) * -28deg)) } }
@media (max-width: 600px) { .lpcr-track { grid-auto-columns: 86% } .lpcr-top { flex-direction: column; align-items: flex-start } .lpcr-nav { margin-bottom: 20px } }
</style>
