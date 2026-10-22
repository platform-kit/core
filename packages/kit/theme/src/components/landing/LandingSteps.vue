<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { md, mdBlock } from './md.js'
import { glyph } from './icons.js'
import { us } from 'platformkit/lib/strings.js'
import SectionHead from './SectionHead.vue'
import Device from './Device.vue'
/*
 * Steps: the process, numbered — across, joined by a dotted line through the numbers; down, a
 * numbered list with one step lit; alternating, a picture beside each step, sides taking turns;
 * or along a path: picture cards stepping down the page, a curve drawn through their numbers
 * (measured after layout, redrawn on resize). A step is a number, a title, a passage, a glyph or
 * a picture; the numbers are the order.
 *
 * Slots for a look's skin: `head` and `steps`.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'across' },   /* across | down | alternating | path | numbered | beside | spine | timeline */
  image: { type: String, default: '' },          /* the screenshot beside the list (beside) */
  device: { type: String, default: 'none' },     /* none | browser | phone | laptop */
  highlight: { type: Number, default: 0 },       /* for down: the step lit (1-based; 0 none) */
  items: { type: Array, default: () => [] },     /* [{ title, body, icon?, image?, href? }] */
})
const W = (us('sections').steps || {}).label || {}
const n = (i) => String(i + 1).padStart(2, '0')
/* the path: a curve through the numbers, measured from the cards' places */
const row = ref(null), d = ref(''), box = ref({ w: 0, h: 0 })
let ro = null
function draw() {
  if (props.layout !== 'path' || !row.value) return
  const R = row.value.getBoundingClientRect(); box.value = { w: R.width, h: R.height }
  const pts = [...row.value.querySelectorAll('.lpsp-num')].map((el) => { const r = el.getBoundingClientRect(); return [r.left - R.left + r.width / 2, r.top - R.top + r.height / 2] })
  if (pts.length < 2) { d.value = ''; return }
  let s = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const c = (x1 - x0) * 0.5; s += ` C ${x0 + c} ${y0}, ${x1 - c} ${y1}, ${x1} ${y1}` }
  d.value = s
}
onMounted(() => { draw(); ro = new ResizeObserver(draw); if (row.value) ro.observe(row.value) })
onBeforeUnmount(() => ro && ro.disconnect())
</script>

<template>
  <section class="lpsec lpprocess" :class="'lpprocess-' + layout">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout === 'across' || layout === 'path'" /></slot>
      <slot name="steps" :items="items" :md="md">
        <!-- across: a dotted line through the numbers -->
        <ol v-if="layout === 'across' && items.length" class="lpsp-row lprv" :style="{ '--n': items.length }">
          <li v-for="(s, i) in items" :key="i" class="lpsp lpk" :style="{ '--k': (0.1 + i * 0.12) + 's' }">
            <span class="lpsp-num"><i v-if="s.icon" v-html="glyph(s.icon)"></i><template v-else>{{ n(i) }}</template></span>
            <div class="lpsp-words"><h4 v-html="md(s.title)"></h4><div v-if="s.body" class="lpsp-body" v-html="mdBlock(s.body)"></div></div>
          </li>
        </ol>
        <!-- numbered: 01 / 02 / 03 as big cards -->
        <ol v-else-if="layout === 'numbered' && items.length" class="lpsp-numbered">
          <li v-for="(s, i) in items" :key="i" class="lpcard lpsp lpsp-num-card lprv" :class="{ ['lpd' + Math.min(3, i % 4)]: i % 4 }">
            <b class="lpsp-bignum lpnum">{{ n(i) }}</b>
            <div class="lpsp-words"><h4 v-html="md(s.title)"></h4><div v-if="s.body" class="lpsp-body" v-html="mdBlock(s.body)"></div></div>
            <img v-if="s.image" :src="s.image" alt="" class="lpsp-numimg" loading="lazy" decoding="async" />
          </li>
        </ol>
        <!-- beside: the steps down the left, the product on the right -->
        <div v-else-if="layout === 'beside' && items.length" class="lpsp-beside">
          <ol class="lpsp-down lprv">
            <li v-for="(s, i) in items" :key="i" class="lpsp lpk" :class="{ 'lpsp-lit': highlight === i + 1 }" :style="{ '--k': (0.1 + i * 0.1) + 's' }">
              <span class="lpsp-num"><i v-if="s.icon" v-html="glyph(s.icon)"></i><template v-else>{{ n(i) }}</template></span>
              <div class="lpsp-words"><h4 v-html="md(s.title)"></h4><div v-if="s.body" class="lpsp-body" v-html="mdBlock(s.body)"></div></div>
            </li>
          </ol>
          <div class="lpsp-vis lprv lpd1"><span class="lphalo"></span><Device v-if="device !== 'none' && image" :kind="device" :image="image" /><figure v-else-if="image" class="lpcard lpsp-fig"><img :src="image" alt="" loading="lazy" decoding="async" /></figure></div>
        </div>
        <!-- the spine: a dotted line down the left, a glyph per step -->
        <ol v-else-if="layout === 'spine' && items.length" class="lpsp-spine lprv">
          <li v-for="(s, i) in items" :key="i" class="lpsp lpk" :style="{ '--k': (0.1 + i * 0.1) + 's' }">
            <span class="lpsp-num lpsp-spinenum"><i v-if="s.icon" v-html="glyph(s.icon)"></i><template v-else>{{ n(i) }}</template></span>
            <div class="lpsp-words"><h4 v-html="md(s.title)"></h4><div v-if="s.body" class="lpsp-body" v-html="mdBlock(s.body)"></div></div>
          </li>
        </ol>
        <!-- the timeline: dots on a line across, the words under -->
        <ol v-else-if="layout === 'timeline' && items.length" class="lpsp-tl lprv" :style="{ '--n': items.length }">
          <li v-for="(s, i) in items" :key="i" class="lpsp lpk" :class="{ 'lpsp-lit': highlight === i + 1 }" :style="{ '--k': (0.1 + i * 0.1) + 's' }">
            <span class="lpsp-tldot"></span>
            <div class="lpsp-words"><h4 v-html="md(s.title)"></h4><div v-if="s.body" class="lpsp-body" v-html="mdBlock(s.body)"></div></div>
          </li>
        </ol>
        <!-- down: a numbered list, one lit -->
        <ol v-else-if="layout === 'down' && items.length" class="lpsp-down lprv">
          <li v-for="(s, i) in items" :key="i" class="lpsp lpk" :class="{ 'lpsp-lit': highlight === i + 1 }" :style="{ '--k': (0.1 + i * 0.1) + 's' }">
            <span class="lpsp-num"><i v-if="s.icon" v-html="glyph(s.icon)"></i><template v-else>{{ n(i) }}</template></span>
            <div class="lpsp-words"><h4 v-html="md(s.title)"></h4><div v-if="s.body" class="lpsp-body" v-html="mdBlock(s.body)"></div></div>
          </li>
        </ol>
        <!-- alternating: a picture beside each step -->
        <ol v-else-if="layout === 'alternating' && items.length" class="lpsp-alt">
          <li v-for="(s, i) in items" :key="i" class="lpsp lprv" :class="{ 'lpsp-flip': i % 2 }">
            <div class="lpsp-words lpk" style="--k: .1s">
              <span class="lpsp-tag">{{ (W.step || 'Step {n}').replace('{n}', i + 1) }}</span>
              <h4 v-html="md(s.title)"></h4>
              <div v-if="s.body" class="lpsp-body" v-html="mdBlock(s.body)"></div>
            </div>
            <figure v-if="s.image" class="lpcard lpsp-fig lpk" style="--k: .2s"><img :src="s.image" :alt="s.title || ''" loading="lazy" decoding="async" /></figure>
          </li>
        </ol>
        <!-- the path: cards stepping down, a curve through the numbers -->
        <div v-else-if="layout === 'path' && items.length" ref="row" class="lpsp-path lprv" :style="{ '--n': items.length }">
          <svg v-if="d" class="lpsp-curve" :viewBox="`0 0 ${box.w} ${box.h}`" :width="box.w" :height="box.h" aria-hidden="true"><path :d="d" /></svg>
          <component v-for="(s, i) in items" :key="i" :is="s.href ? 'a' : 'div'" :href="s.href || undefined" class="lpsp lpk" :style="{ '--k': (0.1 + i * 0.14) + 's', '--i': i }">
            <span class="lpsp-num">{{ n(i) }}</span>
            <div class="lpcard lpsp-card">
              <img v-if="s.image" :src="s.image" :alt="s.title || ''" loading="lazy" decoding="async" />
              <div class="lpsp-cardw"><h4 v-html="md(s.title)"></h4><div v-if="s.body" class="lpsp-body" v-html="mdBlock(s.body)"></div></div>
            </div>
          </component>
        </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpsp-num { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; font: 600 12.5px var(--m); letter-spacing: .04em; color: var(--accent2); background: var(--paper); border: 1.5px solid var(--accent); flex: none; position: relative; z-index: 1 }
.lpsp-num :deep(svg) { width: 18px; height: 18px }
.lpsp h4 { font-size: 18.5px; letter-spacing: -.01em; line-height: 1.25 }
.lpsp-body { font-size: 15px; line-height: 1.55; color: var(--ink2) } .lpsp-body :deep(p) { margin: 0 0 8px } .lpsp-body :deep(p:last-child) { margin: 0 }
/* across */
.lpsp-row { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 28px; position: relative }
.lpsp-row::before { content: ''; position: absolute; left: calc(100% / var(--n) / 2); right: calc(100% / var(--n) / 2); top: 20px; border-top: 2px dotted color-mix(in srgb, var(--accent) 55%, transparent) }
.lpsp-row .lpsp { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 0 8px }
.lpsp-row .lpsp-words { align-items: center }
.lpsp-row .lpsp-num { margin-bottom: 8px }
/* down */
.lpsp-down { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; max-width: 760px }
.lpsp-down .lpsp { display: flex; gap: 18px; align-items: flex-start; padding: 18px 20px; border-radius: 14px; border: 1px solid transparent; transition: background .2s, border-color .2s }
.lpsp-down .lpsp-lit { background: var(--card); border-color: var(--hair); box-shadow: var(--sh) }
.lpsp-down .lpsp-lit .lpsp-num { background: var(--accent); color: var(--paper) }
.lpsp-words { display: flex; flex-direction: column; gap: 6px; min-width: 0 }
/* alternating */
.lpsp-alt { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 56px }
.lpsp-alt .lpsp { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: center }
.lpsp-alt .lpsp-flip .lpsp-fig { order: -1 }
.lpsp-tag { font-family: var(--m); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent2) }
.lpsp-alt h4 { font-size: 26px; letter-spacing: -.015em }
.lpsp-alt .lpsp-body { font-size: 16.5px }
.lpsp-fig { margin: 0; overflow: hidden } .lpsp-fig img { display: block; width: 100%; height: auto }
/* numbered cards */
.lpsp-numbered { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px }
.lpsp-num-card { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 24px; align-items: center; padding: 28px 30px }
.lpsp-bignum { font-family: var(--fd); font-weight: 500; font-size: 56px; line-height: 1; letter-spacing: -.03em; color: var(--ink); padding-right: 24px; border-right: 1px solid var(--hair) }
.lpsp-numimg { width: 140px; height: 90px; object-fit: cover; border-radius: 10px }
/* beside a screenshot */
.lpsp-beside { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 56px; align-items: center }
.lpsp-vis { position: relative } .lpsp-fig { margin: 0; overflow: hidden; position: relative; z-index: 1 } .lpsp-fig img { display: block; width: 100%; height: auto }
/* the spine */
.lpsp-spine { list-style: none; margin: 0; padding: 0; max-width: 680px; position: relative }
.lpsp-spine::before { content: ''; position: absolute; left: 20px; top: 20px; bottom: 20px; border-left: 2px dotted color-mix(in srgb, var(--accent) 50%, transparent) }
.lpsp-spine .lpsp { display: flex; gap: 22px; align-items: flex-start; padding: 0 0 34px } .lpsp-spine .lpsp:last-child { padding-bottom: 0 }
.lpsp-spinenum { box-shadow: 0 0 0 6px var(--paper) }
/* the timeline */
.lpsp-tl { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 20px; position: relative }
.lpsp-tl::before { content: ''; position: absolute; left: 0; right: 0; top: 5px; border-top: 1px solid var(--hair) }
.lpsp-tl .lpsp { display: flex; flex-direction: column; gap: 14px; padding-top: 0 }
.lpsp-tldot { width: 11px; height: 11px; border-radius: 50%; background: var(--paper); border: 2px solid var(--ink3); position: relative; z-index: 1 }
.lpsp-tl .lpsp-lit .lpsp-tldot { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accentbg) }
.lpsp-tl h4 { font-size: 17px }
/* the path */
.lpsp-path { position: relative; display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 24px; padding-top: 10px }
.lpsp-curve { position: absolute; inset: 0; pointer-events: none; overflow: visible }
.lpsp-curve path { fill: none; stroke: color-mix(in srgb, var(--accent) 55%, transparent); stroke-width: 2; stroke-dasharray: 3 7; stroke-linecap: round }
.lpsp-path .lpsp { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; text-decoration: none; color: inherit; margin-top: calc(var(--i) * 48px) }
.lpsp-path .lpsp-card { width: 100%; overflow: hidden; display: flex; flex-direction: column; transition: transform .3s cubic-bezier(.2,.8,.2,1) }
.lpsp-path a.lpsp:hover .lpsp-card { transform: translateY(-4px) }
.lpsp-card img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover }
.lpsp-cardw { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 6px }
.lpsp-cardw h4 { font-size: 17px }
@media (max-width: 980px) { .lpsp-beside { grid-template-columns: 1fr; gap: 28px } .lpsp-tl { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpsp-tl::before { display: none } .lpsp-num-card { grid-template-columns: 70px minmax(0, 1fr) } .lpsp-numimg { display: none } .lpsp-bignum { font-size: 40px } .lpsp-row { grid-template-columns: 1fr; gap: 22px } .lpsp-row::before { display: none } .lpsp-row .lpsp { flex-direction: row; text-align: left; align-items: flex-start; gap: 16px } .lpsp-row .lpsp-words { align-items: flex-start; padding-top: 8px } .lpsp-alt .lpsp { grid-template-columns: 1fr; gap: 20px } .lpsp-alt .lpsp-flip .lpsp-fig { order: 0 } .lpsp-path { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpsp-path .lpsp { margin-top: 0 } .lpsp-curve { display: none } }
@media (max-width: 600px) { .lpsp-path { grid-template-columns: 1fr } }
</style>
