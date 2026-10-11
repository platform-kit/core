<script setup>
/*
 * The full modal an ad takes at most once an hour, for a reader who has shown
 * interest. Presentational, like AdCard: the host owns the timing and the
 * click. `inline` renders the dialog in the flow of the page, without the veil,
 * which is how the admin preview shows it.
 */
import { us } from '@platform-kit/kit/lib/content.js'
import MediaBlock from './content/MediaBlock.vue'

defineProps({
  ad: { type: Object, required: true },
  inline: { type: Boolean, default: false },
})
const emit = defineEmits(['go', 'dismiss'])
const U = us('cta').card.ui
</script>

<template>
  <div class="cta-veil" :class="{ 'cta-veil-inline': inline }" @click.self="emit('dismiss')">
    <div class="cta-modal" role="dialog" aria-modal="true" :aria-label="ad.headline || ad.button">
      <button type="button" class="cta-x" :aria-label="U.close" @click="emit('dismiss')">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>
      <img v-if="ad.image" class="cta-img" :src="ad.image" alt="" />
      <div v-if="ad.media" class="cta-media"><MediaBlock :media="ad.media" /></div>
      <div class="cta-body">
        <span class="cta-label">{{ U.label }}</span>
        <h2 v-if="ad.headline" class="cta-h">{{ ad.headline }}</h2>
        <div class="cta-text" v-html="ad.body" />
        <div class="cta-actions">
          <button type="button" class="cta-btn" @click="emit('go')">{{ ad.button }}</button>
          <button type="button" class="cta-later" @click="emit('dismiss')">{{ U.dismiss }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cta-label { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent2); margin-bottom: 8px }
.cta-btn { font: inherit; font-size: 15px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px;
  padding: 12px 24px; cursor: pointer; transition: transform .14s, box-shadow .14s }
.cta-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 24px -14px #000a }
.cta-x { position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink3); background: color-mix(in srgb, var(--paper) 80%, transparent); backdrop-filter: blur(6px); border: 0; border-radius: 50%; cursor: pointer; z-index: 1 }
.cta-x:hover { color: var(--ink) }

.cta-veil { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: #0a0d0b66; backdrop-filter: blur(6px) }
.cta-veil-inline { position: relative; inset: auto; z-index: auto; padding: 0; background: none; backdrop-filter: none; display: block }
.cta-modal { position: relative; width: 100%; max-width: 540px; background: var(--paper); color: var(--ink);
  border: 1px solid var(--hair); border-radius: 24px; overflow: hidden; box-shadow: 0 34px 90px -34px #000d }
.cta-img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover }
.cta-media { padding: 18px 18px 0 }
.cta-body { padding: 28px 30px 26px }
.cta-h { font-family: var(--fd); font-weight: 600; font-size: clamp(22px, 2.8vw, 28px); letter-spacing: -.02em; line-height: 1.12; margin: 0 0 12px; text-wrap: balance }
.cta-text :deep(p) { font-size: 15.5px; line-height: 1.6; color: var(--ink2); margin: 0 0 10px }
.cta-actions { display: flex; align-items: center; gap: 16px; margin-top: 18px; flex-wrap: wrap }
.cta-later { font: inherit; font-size: 13.5px; color: var(--ink3); background: none; border: 0; cursor: pointer }
.cta-later:hover { color: var(--ink) }

@media (prefers-reduced-motion: no-preference) {
  .cta-veil:not(.cta-veil-inline) .cta-modal { animation: cta-in .2s ease-out }
  @keyframes cta-in { from { opacity: 0; transform: translateY(10px) scale(.985) } to { opacity: 1; transform: none } }
}
</style>
