<script setup>
import { md } from './md.js'
import SectionHead from './SectionHead.vue'
import Ticker from './Ticker.vue'
/*
 * Integrations: what it connects to — each a mark, a name and a line, linked or not — as tiles
 * in a grid; as an orbit, the marks circling the site's own mark beside the words; or as a
 * marquee of chips, two rows the other way round. Every word is the page's.
 *
 * Slots for a look's skin: `head` and `items`.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'tiles' },   /* tiles | orbit | marquee | scatter */
  columns: { type: Number, default: 3 },
  centre: { type: String, default: '' },        /* the orbit's centre: a picture */
  cta: { type: String, default: '' }, href: { type: String, default: '' },
  items: { type: Array, default: () => [] },    /* [{ name, body?, image?, href? }] */
})
const half = () => Math.ceil(props.items.length / 2)
const initials = (n) => String(n || '').slice(0, 2).toUpperCase()
</script>

<template>
  <section class="lpsec lpint" :class="'lpint-' + layout">
    <div class="lpwrap" :class="{ 'lpin-two': layout === 'orbit' }">
      <!-- the scatter: marks strewn about the words -->
      <div v-if="layout === 'scatter' && items.length" class="lpin-scatter">
        <div class="lpin-scwords lprv"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" center /><a v-if="cta" :href="href || '#'" class="lpbtn text-white"><span v-html="md(cta)"></span></a></div>
        <component v-for="(it, i) in items" :key="i" :is="it.href ? 'a' : 'span'" :href="it.href || undefined" class="lpin-sc" :style="{ '--i': i, '--n': items.length, '--k': (0.1 + i * 0.06) + 's' }" :title="it.name"><img v-if="it.image" :src="it.image" :alt="it.name || ''" loading="lazy" /><b v-else>{{ initials(it.name) }}</b></component>
      </div>
      <template v-else>
      <div>
        <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead class="lpin-head" :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout !== 'orbit'" /></slot>
        <a v-if="layout === 'orbit' && cta" :href="href || '#'" class="lpbtn text-white lprv"><span v-html="md(cta)"></span></a>
      </div>
      <slot name="items" :items="items" :md="md">
        <!-- the orbit -->
        <div v-if="layout === 'orbit' && items.length" class="lpin-orbit lprv lpd1" :style="{ '--n': items.length }">
          <span class="lpin-ring"></span><span class="lpin-ring lpin-ring2"></span>
          <span class="lpin-centre"><img v-if="centre" :src="centre" alt="" loading="lazy" /></span>
          <component v-for="(it, i) in items" :key="i" :is="it.href ? 'a' : 'span'" :href="it.href || undefined" class="lpin-sat" :style="{ '--i': i }" :title="it.name"><img v-if="it.image" :src="it.image" :alt="it.name || ''" loading="lazy" /><b v-else>{{ initials(it.name) }}</b></component>
        </div>
        <!-- the marquee of chips -->
        <div v-else-if="layout === 'marquee' && items.length" class="lpin-tk lprv">
          <Ticker :speed="34"><span v-for="(it, i) in items.slice(0, half())" :key="i" class="lpin-chip"><img v-if="it.image" :src="it.image" alt="" loading="lazy" /><b v-html="md(it.name)"></b></span></Ticker>
          <Ticker :speed="30" reverse><span v-for="(it, i) in items.slice(half())" :key="i" class="lpin-chip"><img v-if="it.image" :src="it.image" alt="" loading="lazy" /><b v-html="md(it.name)"></b></span></Ticker>
        </div>
        <!-- the tiles -->
        <div v-else-if="items.length" class="lpin-grid" :class="'lpin-c' + Math.min(4, Math.max(2, columns))">
          <component v-for="(it, i) in items" :key="i" :is="it.href ? 'a' : 'div'" :href="it.href || undefined" class="lpcard lpin-tile lprv" :class="{ lplift: !!it.href, ['lpd' + Math.min(3, i % 4)]: i % 4 }">
            <span class="lpin-mark"><img v-if="it.image" :src="it.image" :alt="it.name || ''" loading="lazy" /><b v-else>{{ initials(it.name) }}</b></span>
            <div><h4 v-html="md(it.name)"></h4><p v-if="it.body" v-html="md(it.body)"></p></div>
          </component>
        </div>
        <p v-if="layout !== 'orbit' && cta" class="lpin-more lprv lpd2"><a :href="href || '#'" v-html="md(cta)"></a></p>
      </slot>
      </template>
    </div>
  </section>
</template>

<style scoped>
.lpin-grid { display: grid; gap: 14px }
.lpin-c2 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpin-c3 { grid-template-columns: repeat(3, minmax(0, 1fr)) } .lpin-c4 { grid-template-columns: repeat(4, minmax(0, 1fr)) }
.lpin-tile { display: flex; gap: 14px; align-items: flex-start; padding: 18px 20px; color: inherit; text-decoration: none }
.lpin-mark { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--wash); border: 1px solid var(--hair); overflow: hidden }
.lpin-mark img { width: 60%; height: 60%; object-fit: contain } .lpin-mark b { font: 600 13px var(--m); color: var(--accent2) }
.lpin-tile h4 { font-size: 16px; margin-bottom: 3px } .lpin-tile p { margin: 0; font-size: 14px; line-height: 1.45; color: var(--ink2) }
.lpin-more { margin: 24px 0 0; text-align: center; font-size: 14.5px } .lpin-more a { color: var(--accent2); font-weight: 600; text-decoration: none }
/* the orbit */
.lpin-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px; align-items: center }
.lpin-two .lpin-head { margin-bottom: 22px }
.lpin-orbit { position: relative; aspect-ratio: 1; width: min(100%, 460px); margin: 0 auto }
.lpin-ring { position: absolute; inset: 0; border-radius: 50%; border: 1px dashed color-mix(in srgb, var(--ink3) 45%, transparent) }
.lpin-ring2 { inset: 22% }
.lpin-centre { position: absolute; left: 50%; top: 50%; width: 88px; height: 88px; transform: translate(-50%, -50%); border-radius: 50%; background: var(--card); border: 1px solid var(--hair); box-shadow: var(--shhi); display: grid; place-items: center; overflow: hidden }
.lpin-centre img { width: 55%; height: 55%; object-fit: contain }
.lpin-sat { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; background: var(--card); border: 1px solid var(--hair); box-shadow: var(--sh); display: grid; place-items: center; overflow: hidden; text-decoration: none;
  transform: rotate(calc(var(--i) * 360deg / var(--n))) translateX(calc(50% * 8.2)) rotate(calc(var(--i) * -360deg / var(--n))); transition: transform .3s }
.lpin-sat:hover { transform: rotate(calc(var(--i) * 360deg / var(--n))) translateX(calc(50% * 8.2)) rotate(calc(var(--i) * -360deg / var(--n))) scale(1.1) }
.lpin-sat img { width: 55%; height: 55%; object-fit: contain } .lpin-sat b { font: 600 12px var(--m); color: var(--accent2) }
/* the scatter: each mark on a ring at its own angle and radius, floating a little */
.lpin-scatter { position: relative; min-height: 460px; display: grid; place-items: center }
.lpin-scwords { position: relative; z-index: 1; max-width: 520px; text-align: center; display: flex; flex-direction: column; align-items: center } .lpin-scwords :deep(.lpshead) { margin-bottom: 18px }
.lpin-sc { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 14px; background: var(--card); border: 1px solid var(--hair); box-shadow: var(--sh); display: grid; place-items: center; overflow: hidden; text-decoration: none;
  --a: calc(var(--i) * 360deg / var(--n) + 20deg); --r: calc(190px + mod(var(--i), 3) * 70px);
  /* placed by its own transform, so it is not on the reveal (whose transform would win): its entry is its own */
  transform: rotate(var(--a)) translateX(var(--r)) rotate(calc(-1 * var(--a))); animation: lpin-float 6s ease-in-out infinite calc(var(--i) * -.7s), lpin-in .7s cubic-bezier(.2,.8,.2,1) var(--k) both }
.lpin-sc img { width: 55%; height: 55%; object-fit: contain } .lpin-sc b { font: 600 12px var(--m); color: var(--accent2) }
@keyframes lpin-float { 50% { margin-top: -32px } }
@keyframes lpin-in { from { opacity: 0; scale: .6 } }
@media (prefers-reduced-motion: reduce) { .lpin-sc { animation: none } }
/* the marquee */
.lpin-tk { display: flex; flex-direction: column; gap: 14px; margin: 0 -28px }
.lpin-chip { display: inline-flex; align-items: center; gap: 10px; margin: 0 7px; padding: 10px 18px 10px 12px; border-radius: 999px; background: var(--card); border: 1px solid var(--hair); white-space: nowrap }
.lpin-chip img { width: 22px; height: 22px; object-fit: contain } .lpin-chip b { font-weight: 600; font-size: 14.5px }
@media (max-width: 980px) { .lpin-two { grid-template-columns: 1fr; gap: 28px } .lpin-c3, .lpin-c4 { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
@media (max-width: 720px) { .lpin-sc { --r: calc(120px + mod(var(--i), 3) * 34px); width: 40px; height: 40px; margin: -20px 0 0 -20px } .lpin-scatter { min-height: 420px } }
@media (max-width: 600px) { .lpin-grid { grid-template-columns: 1fr } .lpin-sat { width: 44px; height: 44px; margin: -22px 0 0 -22px } }
</style>
