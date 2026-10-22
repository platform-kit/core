<script setup>
import { md, mdBlock } from './md.js'
import { glyph } from './icons.js'
/*
 * Split: one thing said large — a picture beside a passage, the picture left or right, a few
 * points under the passage and a button. Two of these in a row, sides swapped, is how most
 * product pages tell their story.
 *
 * Slots for a look's skin: `visual` and `copy`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  body: { type: String, default: '' },          /* markdown */
  image: { type: String, default: '' },
  alt: { type: String, default: '' },
  side: { type: String, default: 'left' },      /* the picture's side: left | right */
  points: { type: Array, default: () => [] },   /* [{ icon?, text }] */
  cta: { type: String, default: '' },
  href: { type: String, default: '' },
})
</script>

<template>
  <section class="lpsec lpsplit">
    <div class="lpwrap lpsp" :class="{ 'lpsp-r': side === 'right' }">
      <slot name="visual" :image="image" :alt="alt">
        <div class="lpsp-vis lprv">
          <span class="lphalo"></span>
          <figure v-if="image" class="lpcard lpsp-fig lpk"><img :src="image" :alt="alt || ''" loading="lazy" decoding="async" /></figure>
        </div>
      </slot>
      <slot name="copy" :eyebrow="eyebrow" :heading="heading" :body="body" :points="points" :cta="cta" :href="href" :md="md">
        <div class="lpcol lprv lpsp-copy">
          <span v-if="eyebrow" class="lpeyebrow" v-html="md(eyebrow)"></span>
          <h2 v-if="heading" class="lps lpk" style="--k: .1s" v-html="md(heading)"></h2>
          <div v-if="body" class="lpsp-body lpk" style="--k: .22s" v-html="mdBlock(body)"></div>
          <ul v-if="points.length" class="lpsp-points">
            <li v-for="(p, i) in points" :key="i" class="lpk" :style="{ '--k': (0.34 + i * 0.1) + 's' }"><span class="lpsp-pi" v-html="glyph(p.icon || 'check')"></span><span v-html="md(p.text)"></span></li>
          </ul>
          <a v-if="cta" :href="href || '#'" class="lpbtn text-white lpsp-cta lpk" :style="{ '--k': (0.4 + points.length * 0.1) + 's' }"><span v-html="md(cta)"></span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
          </a>
        </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpsp { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 64px; align-items: center }
.lpsp-r .lpsp-vis { order: 2 }
.lpsp-vis { position: relative }
.lpsp-fig { position: relative; z-index: 1; margin: 0; overflow: hidden }
.lpsp-fig img { display: block; width: 100%; height: auto }
.lpsp-body { font-size: 17.5px; line-height: 1.6; color: var(--ink2) }
.lpsp-body :deep(p) { margin: 0 0 14px } .lpsp-body :deep(p:last-child) { margin-bottom: 0 }
.lpsp-points { list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px }
.lpsp-points li { display: flex; gap: 12px; align-items: flex-start; font-size: 16px; line-height: 1.45 }
.lpsp-pi { flex: none; display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; color: var(--accent2); background: var(--accentbg); transform: translateY(-1px) }
.lpsp-pi :deep(svg) { width: 15px; height: 15px }
.lpsp-cta { margin-top: 28px }
@media (max-width: 980px) { .lpsp { grid-template-columns: 1fr; gap: 36px } .lpsp-r .lpsp-vis { order: 0 } }
</style>
