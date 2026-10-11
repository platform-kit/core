<script setup>
import { md } from './md.js'
import Ticker from './Ticker.vue'
import Stars from './Stars.vue'
/*
 * Logos: a line of names a reader trusts — "as seen in", "trusted by" — each a picture and a
 * name (the name is the alt, and the fallback when there is no picture), linked or not: as a row;
 * as chips; beside the words (a heading and a line to the left, the logos in a grid to the
 * right); or as a marquee that never stops (two rows when there are enough, the second the other
 * way). A rating line under the row when the page has one. Grey until hovered, so the row reads
 * as one line and not as six adverts.
 *
 * Slots for a look's skin: `head` and `logos`.
 */
const props = defineProps({
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'row' },   /* row | chips | beside | marquee | tiles */
  logos: { type: Array, default: () => [] },  /* [{ name, image, href? }] */
  mono: { type: Boolean, default: true },     /* washed to one ink until hovered */
  rating: { type: Object, default: () => ({}) },   /* { stars, line } */
})
const half = () => Math.ceil(props.logos.length / 2)
</script>

<template>
  <section class="lpsec lplogos" :class="'lplogos-' + layout">
    <div class="lpwrap" :class="{ 'lplg-two': layout === 'beside' }">
      <slot name="head" :heading="heading" :lead="lead" :md="md">
        <div v-if="heading || lead" class="lplg-head lprv">
          <p v-if="heading" class="lplg-h" v-html="md(heading)"></p>
          <p v-if="lead" class="lplg-lead" v-html="md(lead)"></p>
        </div>
      </slot>
      <slot name="logos" :logos="logos" :md="md">
        <div v-if="logos.length && layout === 'marquee'" class="lplg-tk lprv" :class="{ 'lplg-mono': mono }">
          <Ticker :speed="36"><span v-for="(l, i) in (logos.length > 8 ? logos.slice(0, half()) : logos)" :key="i" class="lplg-tkitem"><component :is="l.href ? 'a' : 'span'" :href="l.href || undefined" class="lplg-item"><img v-if="l.image" :src="l.image" :alt="l.name || ''" loading="lazy" /><b v-else v-html="md(l.name)"></b></component></span></Ticker>
          <Ticker v-if="logos.length > 8" :speed="30" reverse><span v-for="(l, i) in logos.slice(half())" :key="i" class="lplg-tkitem"><component :is="l.href ? 'a' : 'span'" :href="l.href || undefined" class="lplg-item"><img v-if="l.image" :src="l.image" :alt="l.name || ''" loading="lazy" /><b v-else v-html="md(l.name)"></b></component></span></Ticker>
        </div>
        <ul v-else-if="logos.length" class="lplg-row lprv lpd1" :class="{ 'lplg-mono': mono && layout !== 'chips' }">
          <li v-for="(l, i) in logos" :key="i" class="lpk" :style="{ '--k': (0.1 + i * 0.06) + 's' }">
            <component :is="l.href ? 'a' : 'span'" :href="l.href || undefined" class="lplg-item" :title="l.name">
              <img v-if="l.image" :src="l.image" :alt="l.name || ''" loading="lazy" decoding="async" />
              <b v-else v-html="md(l.name)"></b>
            </component>
          </li>
        </ul>
        <div v-if="rating.line || rating.stars" class="lplg-rating lprv lpd2"><Stars :value="Number(rating.stars) || 5" :line="rating.line" /></div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lplogos { padding: 48px 0 }
.lplg-head { margin: 0 0 22px; text-align: center }
.lplg-h { margin: 0; font-family: var(--m); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink3) }
.lplg-lead { margin: 8px 0 0; font-size: 15px; color: var(--ink2) }
.lplg-row { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 18px 44px }
.lplg-item { display: inline-flex; align-items: center; height: 36px; color: var(--ink2); text-decoration: none; transition: opacity .2s, filter .2s }
.lplg-item img { height: 100%; width: auto; max-width: 150px; object-fit: contain; display: block }
.lplg-item b { font-family: var(--fd); font-weight: 600; font-size: 20px; letter-spacing: -.01em; white-space: nowrap }
.lplg-mono .lplg-item { opacity: .55; filter: grayscale(1) }
.lplg-mono .lplg-item:hover { opacity: 1; filter: none }
.lplg-rating { display: flex; justify-content: center; margin-top: 26px }
/* chips */
.lplogos-chips .lplg-row { gap: 10px }
.lplogos-chips .lplg-item { height: 42px; padding: 0 18px; border-radius: 999px; background: var(--card); border: 1px solid var(--hair); box-shadow: var(--sh) }
.lplogos-chips .lplg-item img { height: 20px } .lplogos-chips .lplg-item b { font-size: 15px }
/* beside: the words left, a grid right */
.lplg-two { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 48px; align-items: center }
.lplg-two .lplg-head { text-align: left; margin: 0 }
.lplg-two .lplg-h { font-family: var(--fd); font-size: 26px; letter-spacing: -.015em; text-transform: none; color: var(--ink); font-weight: 500; line-height: 1.2 }
.lplg-two .lplg-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px }
.lplg-two .lplg-row li { display: grid; place-items: center; height: 72px; border-radius: 12px; background: var(--card); border: 1px solid var(--hair) }
.lplg-two .lplg-rating { grid-column: 1 / -1; justify-content: flex-start }
/* tiles: a tight grid of keys, lit under the pointer */
.lplogos-tiles .lplg-row { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px }
.lplogos-tiles .lplg-row li { display: grid; place-items: center; aspect-ratio: 4 / 3; border-radius: 14px; background: var(--card); border: 1px solid var(--hair); box-shadow: inset 0 1px 0 var(--edge, #ffffff66); transition: transform .25s, box-shadow .25s }
.lplogos-tiles .lplg-row li:hover { transform: translateY(-3px); box-shadow: inset 0 1px 0 var(--edge, #ffffff66), 0 14px 30px -14px color-mix(in srgb, var(--accent) 60%, transparent) }
.lplogos-tiles .lplg-item { height: 28px }
/* the marquee */
.lplg-tk { display: flex; flex-direction: column; gap: 22px; margin: 0 -28px }
.lplg-tkitem { display: inline-flex; padding: 0 28px }
@media (max-width: 900px) { .lplogos-tiles .lplg-row { grid-template-columns: repeat(3, minmax(0, 1fr)) } }
@media (max-width: 640px) { .lplg-row { gap: 14px 26px } .lplg-item { height: 28px } .lplg-item b { font-size: 17px } .lplg-two { grid-template-columns: 1fr; gap: 24px } .lplg-two .lplg-row { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
</style>
