<script setup>
import { md } from './md.js'
/*
 * Quote: one pull quote, large, with its source — a line from a review, a reader, the founder,
 * a book. Centred on the ground with a mark before it; nothing else on the row.
 *
 * Slots for a look's skin: `quote`.
 */
defineProps({
  quote: { type: String, default: '' },
  name: { type: String, default: '' },
  role: { type: String, default: '' },
  image: { type: String, default: '' },
})
</script>

<template>
  <section class="lpsec lpquote">
    <div class="lpwrap">
      <slot name="quote" :quote="quote" :name="name" :role="role" :image="image" :md="md">
        <figure v-if="quote" class="lpqt lprv">
          <span class="lpqt-mark" aria-hidden="true">“</span>
          <blockquote class="lpk" style="--k: .1s" v-html="md(quote)"></blockquote>
          <figcaption v-if="name || role" class="lpk" style="--k: .28s">
            <img v-if="image" :src="image" :alt="name || ''" loading="lazy" />
            <span><b v-if="name" v-html="md(name)"></b><i v-if="role" v-html="md(role)"></i></span>
          </figcaption>
        </figure>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpqt { margin: 0 auto; max-width: 860px; text-align: center; position: relative; padding-top: 30px }
.lpqt-mark { position: absolute; left: 50%; top: -18px; transform: translateX(-50%); font-family: var(--fd); font-size: 110px; line-height: 1; color: var(--accent); opacity: .35; pointer-events: none }
.lpqt blockquote { margin: 0; font-family: var(--fd); font-weight: 500; font-size: clamp(24px, 3.4vw, 40px); line-height: 1.3; letter-spacing: -.015em; color: var(--ink); text-wrap: balance }
.lpqt blockquote :deep(em) { color: var(--accent2); font-style: italic }
.lpqt figcaption { display: inline-flex; align-items: center; gap: 12px; margin-top: 26px }
.lpqt figcaption img { width: 44px; height: 44px; border-radius: 50%; object-fit: cover }
.lpqt figcaption span { display: flex; flex-direction: column; text-align: left; line-height: 1.3 }
.lpqt figcaption b { font-size: 15px; font-weight: 600 } .lpqt figcaption i { font-style: normal; font-size: 13.5px; color: var(--ink3) }
</style>
