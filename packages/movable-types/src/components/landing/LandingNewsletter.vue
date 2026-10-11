<script setup>
import { md } from './md.js'
import SectionHead from './SectionHead.vue'
import EmailCapture from './EmailCapture.vue'
import Avatars from './Avatars.vue'
import Stars from './Stars.vue'
/*
 * Newsletter: a heading, a line, and one field that takes an address into one of the site's
 * forms (lib/capture.js) — centred, or split with a picture, or as a card. Faces and a count,
 * or a rating, when the page has them; the fine print under the field. A band is a tone.
 *
 * Slots for a look's skin: `words` and `visual`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  layout: { type: String, default: 'centered' },   /* centered | split | card */
  form: { type: String, default: '' },
  name: { type: Boolean, default: false },   /* ask a first name too */
  button: { type: String, default: '' }, placeholder: { type: String, default: '' }, fine: { type: String, default: '' },
  image: { type: String, default: '' }, alt: { type: String, default: '' },
  avatars: { type: Object, default: () => ({}) },
  rating: { type: Object, default: () => ({}) },
})
</script>

<template>
  <section class="lpsec lpnews" :class="'lpnews-' + layout">
    <div class="lpwrap">
      <div class="lpnl" :class="{ lpcard: layout === 'card', 'lpnl-two': layout === 'split' && image }">
        <slot name="words" :md="md">
          <div class="lpnl-words lprv">
            <SectionHead class="lpnl-head" :eyebrow="eyebrow" :heading="heading" :lead="lead" :center="layout !== 'split'" />
            <EmailCapture class="lpnl-cap lpk" style="--k: .3s" :form="form" :button="button" :placeholder="placeholder" :fine="fine" :name="name" size="large" />
            <Avatars v-if="avatars.items && avatars.items.length" class="lpnl-av lpk" style="--k: .4s" :items="avatars.items" :line="avatars.line" />
            <Stars v-else-if="rating.line || rating.stars" class="lpnl-av lpk" style="--k: .4s" :value="Number(rating.stars) || 5" :line="rating.line" />
          </div>
        </slot>
        <slot name="visual" :image="image">
          <figure v-if="layout === 'split' && image" class="lpcard lpnl-fig lprv lpd1"><img :src="image" :alt="alt || ''" loading="lazy" decoding="async" /></figure>
        </slot>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lpnews { padding: 80px 0 }
.lpnl-words { display: flex; flex-direction: column; align-items: center; text-align: center }
.lpnl-head { margin-bottom: 26px; max-width: 620px }
.lpnl-cap { width: 100%; max-width: 480px; align-items: center }
.lpnl-av { margin-top: 22px }
.lpnews-card .lpnl { padding: 56px 40px }
/* split */
.lpnl-two { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); gap: 56px; align-items: center }
.lpnl-two .lpnl-words { align-items: flex-start; text-align: left }
.lpnl-two .lpnl-cap { align-items: flex-start }
.lpnl-fig { margin: 0; overflow: hidden } .lpnl-fig img { display: block; width: 100%; height: auto }
@media (max-width: 980px) { .lpnl-two { grid-template-columns: 1fr; gap: 28px } }
@media (max-width: 600px) { .lpnews-card .lpnl { padding: 36px 22px } }
</style>
