<script setup>
import { md } from './md.js'
import { glyph } from './icons.js'
import SectionHead from './SectionHead.vue'
import { vTilt } from './tilt.js'
/*
 * Features: a grid of what the thing does — two, three or four across — each a glyph, a title and
 * a line, a picture at the top when it has one, one card highlighted when the page says so; drawn
 * as cards, plain columns, a bordered grid (hairlines, no boxes), or a list of ticked points
 * beside a screenshot; and `showcase`, the words over one big screenshot with the features in a
 * row beneath. The bread and butter of a marketing page, drawn in the look's paper.
 *
 * Slots for a look's skin: `head`, `items`, `visual`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  columns: { type: Number, default: 3 },          /* 2 | 3 | 4 */
  variant: { type: String, default: 'cards' },    /* cards | plain | bordered | list | showcase | flip | around */
  tilt: { type: Boolean, default: false },        /* the cards turn toward the pointer */
  image: { type: String, default: '' },           /* the screenshot beside the list, or under the words for a showcase */
  alt: { type: String, default: '' },
  side: { type: String, default: 'right' },       /* the picture's side, for the list: left | right */
  cta: { type: String, default: '' }, href: { type: String, default: '' },
  items: { type: Array, default: () => [] },      /* [{ icon, title, body, href?, link?, image?, highlight? }] */
})
</script>

<template>
  <section class="lpsec lpfeat" :class="'lpfeat-' + variant">
    <div class="lpwrap" :class="{ 'lpft-two': variant === 'list', 'lpft-two-l': variant === 'list' && side === 'left' }">
      <div class="lpft-lead">
        <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead"><SectionHead :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="variant === 'showcase'" /></slot>
        <!-- the list: ticked points beside the picture -->
        <ul v-if="variant === 'list' && items.length" class="lpft-list lprv">
          <li v-for="(f, i) in items" :key="i" class="lpk" :style="{ '--k': (0.1 + i * 0.1) + 's' }">
            <span class="lpft-ico lpft-ico-s" v-html="glyph(f.icon || 'check')"></span>
            <div><h4 v-html="md(f.title)"></h4><p v-if="f.body" v-html="md(f.body)"></p></div>
          </li>
        </ul>
        <a v-if="variant === 'list' && cta" :href="href || '#'" class="lpbtn text-white lpft-cta lprv"><span v-html="md(cta)"></span></a>
      </div>
      <slot name="visual" :image="image" :alt="alt">
        <div v-if="(variant === 'list' || variant === 'showcase') && image" class="lpft-vis lprv lpd1">
          <span class="lphalo"></span>
          <figure class="lpcard lpft-fig lpk"><img :src="image" :alt="alt || ''" loading="lazy" decoding="async" /></figure>
        </div>
      </slot>
      <slot name="items" :items="items" :md="md">
        <!-- flip: the picture and the title in front, the words behind -->
        <div v-if="variant === 'flip' && items.length" class="lpft-grid" :class="['lpft-c' + Math.min(4, Math.max(2, columns))]">
          <div v-for="(f, i) in items" :key="i" class="lpft-flip lprv" :class="{ ['lpd' + Math.min(3, i % 4)]: i % 4 }" tabindex="0">
            <div class="lpft-flipin">
              <div class="lpcard lpft-face lpft-front"><img v-if="f.image" :src="f.image" :alt="f.title || ''" loading="lazy" decoding="async" /><span class="lpft-frontw"><span v-if="f.icon" class="lpft-ico" v-html="glyph(f.icon)"></span><h4 v-html="md(f.title)"></h4></span></div>
              <div class="lpcard lpft-face lpft-back"><span v-if="f.icon" class="lpft-ico" v-html="glyph(f.icon)"></span><h4 v-html="md(f.title)"></h4><p v-if="f.body" v-html="md(f.body)"></p><a v-if="f.href && f.link" :href="f.href" class="lpft-link" v-html="md(f.link)"></a></div>
            </div>
          </div>
        </div>
        <!-- around: the facts either side of a centre picture -->
        <div v-else-if="variant === 'around' && items.length" class="lpft-around">
          <div class="lpft-side lprv"><div v-for="(f, i) in items.filter((x, j) => j % 2 === 0)" :key="i" class="lpft lpft-fact lpk" :style="{ '--k': (0.1 + i * 0.1) + 's' }"><span v-if="f.icon" class="lpft-ico lpft-ico-s" v-html="glyph(f.icon)"></span><div><h4 v-html="md(f.title)"></h4><p v-if="f.body" v-html="md(f.body)"></p></div></div></div>
          <div class="lpft-centre lprv lpd1"><span class="lphalo"></span><figure v-if="image" class="lpft-fig lpk"><img :src="image" :alt="alt || ''" loading="lazy" decoding="async" /></figure></div>
          <div class="lpft-side lprv lpd2"><div v-for="(f, i) in items.filter((x, j) => j % 2 === 1)" :key="i" class="lpft lpft-fact lpk" :style="{ '--k': (0.1 + i * 0.1) + 's' }"><span v-if="f.icon" class="lpft-ico lpft-ico-s" v-html="glyph(f.icon)"></span><div><h4 v-html="md(f.title)"></h4><p v-if="f.body" v-html="md(f.body)"></p></div></div></div>
        </div>
        <div v-else-if="variant !== 'list' && items.length" class="lpft-grid" :class="['lpft-c' + Math.min(4, Math.max(2, columns))]">
          <component v-for="(f, i) in items" :key="i" :is="f.href ? 'a' : 'div'" :href="f.href || undefined" v-tilt="tilt && variant === 'cards'" class="lpft lprv" :class="{ lpcard: variant === 'cards' || f.highlight, lplift: variant === 'cards' && f.href, 'lpft-hi': f.highlight, 'lpft-haspic': !!f.image, ['lpd' + Math.min(3, i % 4)]: i % 4 }">
            <img v-if="f.image" :src="f.image" alt="" loading="lazy" decoding="async" class="lpft-pic" />
            <div class="lpft-body">
              <span v-if="f.icon" class="lpft-ico" v-html="glyph(f.icon)"></span>
              <h4 v-html="md(f.title)"></h4>
              <p v-if="f.body" v-html="md(f.body)"></p>
              <span v-if="f.href && f.link" class="lpft-link"><span v-html="md(f.link)"></span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg></span>
            </div>
          </component>
        </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpft-grid { display: grid; gap: 18px }
.lpft-c2 { grid-template-columns: repeat(2, minmax(0, 1fr)) }
.lpft-c3 { grid-template-columns: repeat(3, minmax(0, 1fr)) }
.lpft-c4 { grid-template-columns: repeat(4, minmax(0, 1fr)) }
.lpft { display: flex; flex-direction: column; color: inherit; text-decoration: none; min-width: 0; overflow: hidden }
.lpft-body { display: flex; flex-direction: column; gap: 10px; flex: 1 }
.lpfeat-cards .lpft-body { padding: 26px 24px 24px }
.lpfeat-cards .lpft-haspic .lpft-body { padding-top: 20px }
.lpfeat-plain .lpft-grid { gap: 36px 32px }
.lpfeat-plain .lpft-hi .lpft-body { padding: 24px }
/* bordered: hairlines between, no boxes */
.lpfeat-bordered .lpft-grid { gap: 0; border-top: 1px solid var(--hair); border-left: 1px solid var(--hair) }
.lpfeat-bordered .lpft { border-right: 1px solid var(--hair); border-bottom: 1px solid var(--hair); border-radius: 0; box-shadow: none; background: transparent }
.lpfeat-bordered .lpft-body { padding: 28px 26px }
.lpfeat-bordered .lpft-hi { background: var(--accentbg) }
.lpft-hi { position: relative; border-color: var(--accent) !important }
.lpft-ico { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; color: var(--accent2); background: var(--accentbg); margin-bottom: 4px }
.lpft-ico :deep(svg) { width: 20px; height: 20px }
.lpft-ico-s { width: 30px; height: 30px; border-radius: 9px; flex: none } .lpft-ico-s :deep(svg) { width: 16px; height: 16px }
.lpft h4 { font-size: 18.5px; line-height: 1.25; letter-spacing: -.01em }
.lpft p { margin: 0; font-size: 15px; line-height: 1.55; color: var(--ink2) }
.lpft-link { display: inline-flex; align-items: center; gap: 6px; margin-top: auto; padding-top: 8px; font-size: 14px; font-weight: 600; color: var(--accent2) }
.lpft-pic { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 12px }
.lpfeat-cards .lpft-pic { border-radius: 0 }
/* flip cards */
.lpft-flip { perspective: 1200px; aspect-ratio: 4 / 5; outline: none }
.lpft-flipin { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform .8s cubic-bezier(.2,.8,.2,1) }
.lpft-flip:hover .lpft-flipin, .lpft-flip:focus-visible .lpft-flipin { transform: rotateY(180deg) }
.lpft-face { position: absolute; inset: 0; backface-visibility: hidden; overflow: hidden; display: flex; flex-direction: column; padding: 0 }
.lpft-front img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.lpft-frontw { position: relative; margin-top: auto; padding: 60px 22px 22px; background: linear-gradient(180deg, transparent, #000000b0); color: #fff; display: flex; flex-direction: column; gap: 10px }
.lpft-frontw h4 { color: #fff; font-size: 22px } .lpft-frontw .lpft-ico { background: #ffffff22; color: #fff }
.lpft-back { transform: rotateY(180deg); padding: 26px; gap: 10px; justify-content: center }
.lpft-around { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.3fr) minmax(0, .8fr); gap: 40px; align-items: center }
.lpft-side { display: flex; flex-direction: column; gap: 28px }
.lpft-fact { flex-direction: row; gap: 14px; align-items: flex-start } .lpft-fact h4 { font-size: 16.5px; margin-bottom: 4px } .lpft-fact p { font-size: 14px }
.lpft-side:last-child .lpft-fact { flex-direction: row-reverse; text-align: right }
.lpft-centre { position: relative } .lpft-centre .lpft-fig { margin: 0; max-width: none } .lpft-centre .lpft-fig img { width: 100%; height: auto; display: block }
/* the list beside a picture */
.lpft-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 64px; align-items: center }
.lpft-two-l .lpft-vis { order: -1 }
.lpft-two :deep(.lpshead) { margin-bottom: 26px }
.lpft-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 18px }
.lpft-list li { display: flex; gap: 14px; align-items: flex-start }
.lpft-list h4 { font-size: 17px; margin-bottom: 3px } .lpft-list p { font-size: 14.5px }
.lpft-cta { margin-top: 28px }
.lpft-vis { position: relative }
.lpft-fig { position: relative; z-index: 1; margin: 0; overflow: hidden } .lpft-fig img { display: block; width: 100%; height: auto }
/* the showcase: a big picture under the words, the features in a row beneath */
.lpfeat-showcase .lpft-vis { max-width: 980px; margin: 0 auto 44px }
.lpfeat-showcase .lpft-grid { gap: 28px 32px }
@media (prefers-reduced-motion: reduce) { .lpft-flipin { transition: none } }
@media (max-width: 980px) { .lpft-around { grid-template-columns: 1fr } .lpft-centre { order: -1 } .lpft-side:last-child .lpft-fact { flex-direction: row; text-align: left } .lpft-c3, .lpft-c4 { grid-template-columns: repeat(2, minmax(0, 1fr)) } .lpft-two { grid-template-columns: 1fr; gap: 36px } .lpft-two-l .lpft-vis { order: 0 } }
@media (max-width: 600px) { .lpft-grid { grid-template-columns: 1fr } .lpfeat-cards .lpft-body { padding: 22px 20px } }
</style>
