<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { md } from './md.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import SectionHead from './SectionHead.vue'
import Ticker from './Ticker.vue'
/*
 * Gallery: pictures in a grid — two, three or four across, every picture the same shape or each
 * its own — with a caption each, opened large on a click in a <dialog> the section owns (Escape,
 * the backdrop or Close shut it; arrows walk the pictures).
 *
 * Slots for a look's skin: `head` and `pictures`.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  columns: { type: Number, default: 3 },
  shape: { type: String, default: 'square' },   /* square | wide | tall | natural */
  layout: { type: String, default: 'grid' },    /* grid | masonry | polaroids | scatter | arc | mosaic | lookbook */
  filters: { type: Boolean, default: false },   /* buttons over the grid, one per tag the pictures carry */
  items: { type: Array, default: () => [] },     /* [{ image, alt?, caption?, tag?, title?, price?, href? }] */
})
const tag = ref('')
const tags = computed(() => [...new Set(props.items.map((p) => p.tag).filter(Boolean))])
const shownItems = computed(() => (props.filters && tag.value ? props.items.filter((p) => p.tag === tag.value) : props.items))
const W2 = (us('sections').gallery || {}).filter || {}
const W = (us('sections').gallery || {}).dialog || {}
const dlg = ref(null), at = ref(-1)
function open(i) { at.value = i; if (dlg.value && !dlg.value.open) dlg.value.showModal() }
function close() { if (dlg.value && dlg.value.open) dlg.value.close(); at.value = -1 }
const step = (d) => { const n = props.items.length; at.value = (at.value + d + n) % n }
function onKey(e) { if (at.value < 0) return; if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1) }
watch(at, (v) => { if (v >= 0) document.addEventListener('keydown', onKey); else document.removeEventListener('keydown', onKey) })
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="lpsec lpgallery">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" /></slot>
      <slot name="pictures" :items="items" :md="md">
        <div v-if="filters && tags.length" class="lpgl-filters lprv" role="tablist">
          <button type="button" class="lpgl-fbtn" :class="{ on: !tag }" @click="tag = ''">{{ W2.all }}</button>
          <button v-for="t in tags" :key="t" type="button" class="lpgl-fbtn" :class="{ on: tag === t }" @click="tag = t">{{ t }}</button>
        </div>
        <!-- polaroids: tilted prints on a rail, moving -->
        <Ticker v-if="layout === 'polaroids' && items.length" class="lpgl-rail lprv" :speed="22">
          <figure v-for="(p, i) in items" :key="i" class="lpgl-pola" :style="{ '--t': ((i % 5) - 2) * 2.2 + 'deg' }" @click="open(i)"><span class="lpgl-pin"></span><img :src="p.image" :alt="p.alt || p.caption || ''" loading="lazy" /><figcaption v-if="p.caption" v-html="md(p.caption)"></figcaption></figure>
        </Ticker>
        <!-- the scatter: prints strewn on the table, lifted under the pointer -->
        <div v-else-if="layout === 'scatter' && items.length" class="lpgl-scatter lprv">
          <figure v-for="(p, i) in items" :key="i" class="lpgl-pola lpgl-sc lpk" :style="{ '--i': i, '--n': items.length, '--t': ((i * 7) % 11 - 5) * 2 + 'deg', '--k': (0.05 + i * 0.06) + 's' }" @click="open(i)"><img :src="p.image" :alt="p.alt || p.caption || ''" loading="lazy" /><figcaption v-if="p.caption" v-html="md(p.caption)"></figcaption></figure>
        </div>
        <!-- the arc: fanned on a curve -->
        <div v-else-if="layout === 'arc' && items.length" class="lpgl-arc lprv" :style="{ '--n': items.length }">
          <figure v-for="(p, i) in items" :key="i" class="lpgl-arcitem lpk" :style="{ '--i': i, '--k': (0.05 + i * 0.06) + 's' }" @click="open(i)"><img :src="p.image" :alt="p.alt || p.caption || ''" loading="lazy" /></figure>
        </div>
        <!-- the mosaic: a row of cells that widen under the pointer -->
        <div v-else-if="layout === 'mosaic' && items.length" class="lpgl-mosaic lprv">
          <figure v-for="(p, i) in items" :key="i" class="lpgl-mo" @click="open(i)"><img :src="p.image" :alt="p.alt || p.caption || ''" loading="lazy" /><figcaption v-if="p.caption" v-html="md(p.caption)"></figcaption></figure>
        </div>
        <!-- the lookbook: big tiles with a name and a price, each a way to the thing -->
        <div v-else-if="layout === 'lookbook' && items.length" class="lpgl-look" :class="'lpgl-c' + Math.min(4, Math.max(2, columns))">
          <component v-for="(p, i) in shownItems" :key="i" :is="p.href ? 'a' : 'div'" :href="p.href || undefined" class="lpgl-lk lprv" :class="{ ['lpd' + Math.min(3, i % 4)]: i % 4 }">
            <img :src="p.image" :alt="p.alt || p.title || ''" loading="lazy" decoding="async" />
            <span class="lpgl-lkw"><b v-if="p.title" v-html="md(p.title)"></b><i v-if="p.price" class="lpnum" v-html="md(p.price)"></i><span v-if="p.caption" v-html="md(p.caption)"></span></span>
          </component>
        </div>
        <div v-else-if="items.length" class="lpgl-grid" :class="[{ 'lpgl-masonry': layout === 'masonry' }, 'lpgl-c' + Math.min(4, Math.max(2, columns)), 'lpgl-' + shape]">
          <figure v-for="(p, i) in shownItems" :key="i" class="lpgl lprv" :class="{ ['lpd' + Math.min(3, i % 4)]: i % 4 }">
            <button type="button" class="lpgl-btn" :title="W.open" @click="open(i)"><img :src="p.image" :alt="p.alt || p.caption || ''" loading="lazy" decoding="async" /></button>
            <figcaption v-if="p.caption" v-html="md(p.caption)"></figcaption>
          </figure>
        </div>
      </slot>
      <dialog ref="dlg" class="lpgl-dlg" @close="at = -1" @click.self="close">
        <div v-if="at >= 0" class="lpgl-large">
          <img :src="items[at].image" :alt="items[at].alt || items[at].caption || ''" />
          <p v-if="items[at].caption" v-html="md(items[at].caption)"></p>
          <button v-if="items.length > 1" type="button" class="lpgl-nav lpgl-prev" :aria-label="W.previous" @click="step(-1)"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8H2M7 3L2 8l5 5" /></svg></button>
          <button v-if="items.length > 1" type="button" class="lpgl-nav lpgl-next" :aria-label="W.next" @click="step(1)"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M9 3l5 5-5 5" /></svg></button>
          <button type="button" class="lpgl-close" @click="close">{{ W.close }}</button>
        </div>
      </dialog>
    </div>
  </section>
</template>

<style scoped>
.lpgl-grid { display: grid; gap: 16px }
.lpgl-c2 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpgl-c3 { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lpgl-c4 { grid-template-columns: repeat(4, minmax(0, 1fr)) }
.lpgl { margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0 }
.lpgl-btn { display: block; width: 100%; padding: 0; border: 0; background: var(--wash); border-radius: 14px; overflow: hidden; cursor: zoom-in; box-shadow: var(--sh); transition: transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s }
.lpgl-btn:hover { transform: translateY(-3px); box-shadow: var(--shhi) }
.lpgl-btn img { display: block; width: 100%; height: 100%; object-fit: cover }
.lpgl-square .lpgl-btn { aspect-ratio: 1 } .lpgl-wide .lpgl-btn { aspect-ratio: 16 / 10 } .lpgl-tall .lpgl-btn { aspect-ratio: 3 / 4 } .lpgl-natural .lpgl-btn img { height: auto }
.lpgl figcaption { font-size: 13.5px; color: var(--ink3); line-height: 1.4 }
/* filters */
.lpgl-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 22px }
.lpgl-fbtn { font: inherit; font-size: 13px; font-weight: 600; color: var(--ink3); background: var(--wash); border: 1px solid var(--hair); border-radius: 999px; padding: 7px 14px; cursor: pointer } .lpgl-fbtn.on { color: var(--paper); background: var(--ink); border-color: var(--ink) } .lpgl-fbtn:hover:not(.on) { color: var(--ink) }
/* masonry */
.lpgl-masonry { display: block; columns: 3; column-gap: 16px } .lpgl-masonry .lpgl { break-inside: avoid; margin-bottom: 16px } .lpgl-masonry .lpgl-btn { aspect-ratio: auto } .lpgl-masonry .lpgl-btn img { height: auto }
/* polaroids */
.lpgl-rail { margin: 0 -28px; padding: 24px 0 }
.lpgl-pola { position: relative; margin: 0 14px; width: 220px; padding: 12px 12px 14px; background: #fff; box-shadow: 0 12px 30px -14px #0009; transform: rotate(var(--t)); cursor: zoom-in; transition: transform .3s cubic-bezier(.2,.8,.2,1) } .lpgl-pola:hover { transform: rotate(0) translateY(-6px) scale(1.03); z-index: 2 }
.lpgl-pola img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover } .lpgl-pola figcaption { margin-top: 10px; font-family: var(--fd); font-style: italic; font-size: 14px; color: #333; text-align: center }
.lpgl-pin { position: absolute; left: 50%; top: -8px; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); transform: translateX(-50%); box-shadow: 0 2px 4px #0006 }
/* the scatter */
.lpgl-scatter { position: relative; height: 520px; max-width: 980px; margin: 0 auto }
.lpgl-sc { position: absolute; margin: 0; --a: calc(var(--i) * 360deg / var(--n) + 30deg); --r: calc(120px + mod(var(--i), 3) * 90px); left: 50%; top: 50%; margin-left: -110px; margin-top: -130px; transform: rotate(var(--a)) translateX(var(--r)) rotate(calc(-1 * var(--a))) rotate(var(--t)) }
.lpgl-sc:hover { transform: rotate(var(--a)) translateX(var(--r)) rotate(calc(-1 * var(--a))) rotate(0) scale(1.06); z-index: 3 }
/* the arc */
.lpgl-arc { position: relative; height: 380px; max-width: 980px; margin: 0 auto; overflow: hidden }
.lpgl-arcitem { position: absolute; left: 50%; bottom: -260px; margin: 0 0 0 -110px; width: 220px; aspect-ratio: 1; border-radius: 14px; overflow: hidden; transform-origin: 50% 540px; transform: rotate(calc((var(--i) - (var(--n) - 1) / 2) * 22deg)); box-shadow: var(--shhi); cursor: zoom-in; transition: transform .35s cubic-bezier(.2,.8,.2,1) }
.lpgl-arcitem img { width: 100%; height: 100%; object-fit: cover; display: block } .lpgl-arcitem:hover { transform: rotate(calc((var(--i) - (var(--n) - 1) / 2) * 22deg)) translateY(-16px) }
/* the mosaic */
.lpgl-mosaic { display: flex; gap: 8px; height: 420px }
.lpgl-mo { position: relative; flex: 1; margin: 0; overflow: hidden; border-radius: 14px; cursor: zoom-in; transition: flex .6s cubic-bezier(.2,.8,.2,1) } .lpgl-mo:hover { flex: 3 }
.lpgl-mo img { width: 100%; height: 100%; object-fit: cover; display: block }
.lpgl-mo figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 40px 16px 14px; color: #fff; font-size: 14px; background: linear-gradient(180deg, transparent, #000000a0); opacity: 0; transition: opacity .3s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis } .lpgl-mo:hover figcaption { opacity: 1 }
/* the lookbook */
.lpgl-look { display: grid; gap: 16px }
.lpgl-lk { position: relative; display: block; aspect-ratio: 3 / 4; overflow: hidden; border-radius: 14px; color: #fff; text-decoration: none; background: var(--wash) }
.lpgl-lk img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .7s cubic-bezier(.2,.8,.2,1) } .lpgl-lk:hover img { transform: scale(1.04) }
.lpgl-lkw { position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 18px 18px; background: linear-gradient(180deg, transparent, #000000b8); display: flex; flex-direction: column; gap: 3px }
.lpgl-lkw b { font-size: 17px } .lpgl-lkw i { font-style: normal; font-size: 14px; opacity: .9 } .lpgl-lkw span { font-size: 13px; opacity: .8 }
/* the dialog */
.lpgl-dlg { border: 0; padding: 0; background: transparent; max-width: none; max-height: none; width: 100vw; height: 100vh; margin: 0 }
.lpgl-dlg::backdrop { background: #0a0a0acc; backdrop-filter: blur(8px) }
.lpgl-large { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; width: 100%; height: 100%; padding: 56px 72px; box-sizing: border-box; animation: lpgl-in .3s cubic-bezier(.2,.8,.2,1) }
@keyframes lpgl-in { from { opacity: 0; transform: scale(.97) } }
.lpgl-large img { max-width: 100%; max-height: calc(100% - 60px); object-fit: contain; border-radius: 10px; box-shadow: 0 40px 80px -20px #000 }
.lpgl-large p { margin: 0; color: #fff; font-size: 15px; opacity: .85; text-align: center }
.lpgl-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; border: 1px solid #ffffff33; background: #ffffff1a; color: #fff; display: grid; place-items: center; cursor: pointer; backdrop-filter: blur(6px) }
.lpgl-nav:hover { background: #ffffff33 }
.lpgl-prev { left: 16px } .lpgl-next { right: 16px }
.lpgl-close { position: absolute; top: 14px; right: 18px; font: inherit; font-size: 13.5px; font-weight: 600; color: #fff; background: #ffffff1a; border: 1px solid #ffffff33; border-radius: 999px; padding: 8px 14px; cursor: pointer; backdrop-filter: blur(6px) }
.lpgl-close:hover { background: #ffffff33 }
@media (max-width: 720px) { .lpgl-masonry { columns: 2 } .lpgl-scatter { height: 420px } .lpgl-sc { width: 150px; margin-left: -75px; margin-top: -90px; --r: calc(70px + mod(var(--i), 3) * 50px) } .lpgl-mosaic { height: 300px } .lpgl-arcitem { width: 150px; margin-left: -75px } .lpgl-c3, .lpgl-c4 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpgl-large { padding: 60px 12px 24px } .lpgl-nav { width: 38px; height: 38px } .lpgl-prev { left: 6px } .lpgl-next { right: 6px } }
</style>
