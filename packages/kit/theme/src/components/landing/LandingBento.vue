<script setup>
import { computed } from 'vue'
import { md } from './md.js'
import { glyph } from './icons.js'
import { embedOf } from '../../lib/embed.js'
import SectionHead from './SectionHead.vue'
import Ticker from './Ticker.vue'
/*
 * Bento: a grid of tiles of four sizes — 1×1, 2×1 wide, 1×2 tall, 2×2 large — packed densely on
 * three or four columns, each tile one of six kinds: a feature (glyph, title, line), a picture
 * (full-bleed, the words on a scrim, desaturated until hovered — the spotlight), a stat (a big
 * number and its label), a quote (a line and who said it), a list (a title and ticked points), a
 * video (a muted loop). Each tile may wear a tone of its own and link somewhere; a spotlight
 * follows the pointer across the grid. `cascade` loops the tiles vertically forever with faded
 * edges, for standing beside the words. Every word is the page's.
 *
 * Slots for a look's skin: `head` and `tiles`.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  columns: { type: Number, default: 3 },        /* 3 | 4 */
  layout: { type: String, default: 'stacked' }, /* stacked (words above) | beside (words beside the grid) */
  cascade: { type: Boolean, default: false },   /* the tiles scroll up forever, faded top and bottom */
  gap: { type: String, default: 'normal' },     /* tight | normal */
  items: { type: Array, default: () => [] },    /* [{ kind, size, tone, icon, title, body, image, video, href, value, label, points, quote, name }] */
})
const tiles = computed(() => props.items.map((t) => ({ ...t, kind: t.kind || 'feature', size: t.size || '1x1', tone: t.tone || 'paper' })))
const src = (t) => { const e = embedOf(t.video); return e && e.kind === 'file' ? e.src : '' }
/* the spotlight: the pointer's place on each tile, as custom properties its ::before reads */
function move(e) { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--mx', (e.clientX - r.left) + 'px'); e.currentTarget.style.setProperty('--my', (e.clientY - r.top) + 'px') }
</script>

<template>
  <section class="lpsec lpbentogrid">
    <div class="lpwrap lpbn-wrap" :class="['lpbn-' + layout, { 'lpbn-cascade': cascade }]">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead class="lpbn-head" :eyebrow="eyebrow" :heading="heading" :lead="lead" /></slot>
      <slot name="tiles" :tiles="tiles" :md="md">
        <component :is="cascade ? Ticker : 'div'" v-bind="cascade ? { vertical: true, speed: 28 } : {}" class="lpbn-room">
          <div v-if="tiles.length" class="lpbn-grid" :class="['lpbn-c' + Math.min(4, Math.max(2, columns)), 'lpbn-gap-' + gap]">
            <component v-for="(t, i) in tiles" :key="i" :is="t.href ? 'a' : 'div'" :href="t.href || undefined" class="lpbn lprv" :class="['lpbn-' + t.kind, 'lpbn-s' + t.size, { lplift: !!t.href, ['lpd' + Math.min(3, i % 4)]: i % 4 && !cascade }]" :data-tone="t.tone !== 'paper' ? t.tone : undefined" @mousemove="move">
              <!-- a picture: the picture whole, the words on a scrim at the foot -->
              <template v-if="t.kind === 'picture'">
                <img v-if="t.image" :src="t.image" :alt="t.title || ''" loading="lazy" decoding="async" class="lpbn-pic" />
                <div v-if="t.title || t.body" class="lpbn-scrim"><h4 v-if="t.title" v-html="md(t.title)"></h4><p v-if="t.body" v-html="md(t.body)"></p></div>
              </template>
              <!-- a muted loop -->
              <template v-else-if="t.kind === 'video'">
                <video v-if="src(t)" :src="src(t)" :poster="t.image || undefined" autoplay muted loop playsinline class="lpbn-pic"></video>
                <div v-if="t.title || t.body" class="lpbn-scrim"><h4 v-if="t.title" v-html="md(t.title)"></h4><p v-if="t.body" v-html="md(t.body)"></p></div>
              </template>
              <!-- a big number -->
              <div v-else-if="t.kind === 'stat'" class="lpbn-words lpbn-statw">
                <b class="lpbn-value lpnum" v-html="md(t.value)"></b>
                <span v-if="t.label" class="lpbn-label" v-html="md(t.label)"></span>
                <p v-if="t.body" v-html="md(t.body)"></p>
              </div>
              <!-- a line and who said it -->
              <figure v-else-if="t.kind === 'quote'" class="lpbn-words lpbn-quotew">
                <blockquote v-html="md(t.quote || t.body)"></blockquote>
                <figcaption v-if="t.name"><img v-if="t.image" :src="t.image" alt="" loading="lazy" /><span><b v-html="md(t.name)"></b><i v-if="t.label" v-html="md(t.label)"></i></span></figcaption>
              </figure>
              <!-- a title and ticked points -->
              <div v-else-if="t.kind === 'list'" class="lpbn-words">
                <span v-if="t.icon" class="lpbn-ico" v-html="glyph(t.icon)"></span>
                <h4 v-if="t.title" v-html="md(t.title)"></h4>
                <ul class="lpbn-points"><li v-for="(p, j) in (t.points || [])" :key="j"><svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg><span v-html="md(p)"></span></li></ul>
              </div>
              <!-- a feature: glyph, title, line, with a picture at the top when it has one -->
              <template v-else>
                <img v-if="t.image" :src="t.image" alt="" loading="lazy" decoding="async" class="lpbn-img" />
                <div class="lpbn-words">
                  <span v-if="t.icon" class="lpbn-ico" v-html="glyph(t.icon)"></span>
                  <h4 v-if="t.title" v-html="md(t.title)"></h4>
                  <p v-if="t.body" v-html="md(t.body)"></p>
                  <span v-if="t.href && t.label" class="lpbn-link"><span v-html="md(t.label)"></span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg></span>
                </div>
              </template>
            </component>
          </div>
        </component>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpbn-beside { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 56px; align-items: center }
.lpbn-beside .lpbn-head { margin-bottom: 0 }
.lpbn-cascade .lpbn-room { max-height: 560px }
.lpbn-cascade .lpbn-grid { padding: 8px 0 }
.lpbn-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 200px; grid-auto-flow: dense; gap: 16px }
.lpbn-c4 { grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: 180px }
.lpbn-gap-tight { gap: 8px }
.lpbn { position: relative; display: flex; flex-direction: column; overflow: hidden; color: inherit; text-decoration: none; border-radius: 18px; background: var(--card2, var(--card)); border: 1px solid var(--hair); box-shadow: inset 0 1px 0 var(--edge, #ffffff66), var(--sh); isolation: isolate }
.lpbn-s2x1 { grid-column: span 2 } .lpbn-s1x2 { grid-row: span 2 } .lpbn-s2x2 { grid-column: span 2; grid-row: span 2 }
/* the spotlight: a soft light under the pointer, drawn over the tile */
.lpbn::before { content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0; transition: opacity .35s; background: radial-gradient(360px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%) }
.lpbn:hover::before { opacity: 1 }
.lpbn-words { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 6px; padding: 22px; margin-top: auto; min-height: 0 }
.lpbn-ico { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--accent2); background: var(--accentbg); margin-bottom: 8px }
.lpbn-ico :deep(svg) { width: 18px; height: 18px }
.lpbn h4 { font-size: 18px; letter-spacing: -.01em; line-height: 1.25 }
.lpbn p { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--ink2) }
.lpbn-link { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 14px; font-weight: 600; color: var(--accent2) }
.lpbn-img { display: block; width: 100%; flex: 1; min-height: 0; object-fit: cover }
/* a picture or a loop fills the tile; the words sit on a scrim at the foot; the picture is grey until the pointer finds it */
.lpbn-pic { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .7s cubic-bezier(.2,.8,.2,1), filter .5s }
.lpbn-picture .lpbn-pic { filter: grayscale(.85) }
.lpbn-picture:hover .lpbn-pic, .lpbn-video:hover .lpbn-pic { filter: none; transform: scale(1.04) }
.lpbn-scrim { position: relative; z-index: 2; margin-top: auto; padding: 46px 20px 18px; background: linear-gradient(180deg, transparent, #000000b8); color: #fff }
.lpbn-scrim h4 { color: #fff } .lpbn-scrim p { color: #ffffffcc }
/* a stat */
.lpbn-statw { justify-content: flex-end }
.lpbn-value { font-family: var(--fd); font-weight: 600; font-size: clamp(40px, 4.4vw, 60px); line-height: 1; letter-spacing: -.03em; color: var(--ink) }
.lpbn-value :deep(em) { color: var(--accent2); font-style: normal }
.lpbn-label { font-size: 14.5px; font-weight: 500; color: var(--ink) }
/* a quote */
.lpbn-quotew { margin: 0; justify-content: center; gap: 14px }
.lpbn-quotew blockquote { margin: 0; font-family: var(--fd); font-size: 19px; line-height: 1.4; color: var(--ink) }
.lpbn-quotew blockquote::before { content: '“'; color: var(--accent2) } .lpbn-quotew blockquote::after { content: '”'; color: var(--accent2) }
.lpbn-quotew figcaption { display: flex; align-items: center; gap: 10px; font-size: 13.5px }
.lpbn-quotew figcaption img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover }
.lpbn-quotew figcaption span { display: flex; flex-direction: column; line-height: 1.3 } .lpbn-quotew figcaption i { font-style: normal; color: var(--ink3) }
/* a list */
.lpbn-points { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 7px }
.lpbn-points li { display: flex; gap: 8px; align-items: flex-start; font-size: 14.5px; line-height: 1.4; color: var(--ink2) }
.lpbn-points svg { flex: none; color: var(--accent2); margin-top: 3px }
/* a tile's own tone (the ground's rule remaps the tokens) */
.lpbn[data-tone='ink'] { background: var(--paper); border-color: transparent }
.lpbn[data-tone='accent'] { background: var(--tone-accent2); border-color: transparent }
.lpbn[data-tone='wash'] { background: color-mix(in srgb, var(--ink) 6%, transparent) }
@media (max-width: 980px) { .lpbn-beside { grid-template-columns: 1fr; gap: 32px } .lpbn-grid, .lpbn-c4 { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 180px } .lpbn-s2x1, .lpbn-s2x2 { grid-column: span 2 } }
@media (max-width: 600px) { .lpbn-grid, .lpbn-c4 { grid-template-columns: 1fr; grid-auto-rows: auto } .lpbn { min-height: 160px } .lpbn-s2x1, .lpbn-s2x2, .lpbn-s1x2 { grid-column: auto; grid-row: auto } .lpbn-picture, .lpbn-video { min-height: 220px } .lpbn-cascade .lpbn-room { max-height: 460px } }
</style>
