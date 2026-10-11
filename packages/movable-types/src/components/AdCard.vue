<script setup>
/*
 * The quiet corner card an ad takes on most pages. Presentational: the host
 * (CtaHost.vue) decides when it appears and what happens on a click; the admin
 * preview renders the same card for a draft. `inline` keeps it in the flow of
 * the page instead of fixed to the corner.
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
  <aside class="cta-card" :class="{ 'cta-card-inline': inline }" :aria-label="U.label">
    <button type="button" class="cta-x cta-x-card" :aria-label="U.close" @click="emit('dismiss')">
      <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
    </button>
    <img v-if="ad.image" class="cta-card-img" :src="ad.image" alt="" />
    <span class="cta-label">{{ U.label }}</span>
    <h3 v-if="ad.headline" class="cta-card-h">{{ ad.headline }}</h3>
    <div class="cta-card-text" v-html="ad.body" />
    <div v-if="ad.media" class="cta-card-media"><MediaBlock :media="ad.media" /></div>
    <button type="button" class="cta-btn cta-btn-sm" @click="emit('go')">{{ ad.button }}</button>
  </aside>
</template>

<style scoped>
.cta-label { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent2); margin-bottom: 8px }
.cta-btn { font: inherit; font-size: 15px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px;
  padding: 12px 24px; cursor: pointer; transition: transform .14s, box-shadow .14s }
.cta-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 24px -14px #000a }
.cta-btn-sm { font-size: 13.5px; padding: 9px 18px; margin-top: 12px }
.cta-x { position: absolute; width: 26px; height: 26px; top: 8px; right: 8px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--ink3); background: none; border: 0; border-radius: 50%; cursor: pointer; z-index: 1 }
.cta-x:hover { color: var(--ink) }

.cta-card { position: fixed; right: 20px; bottom: 20px; z-index: 70; width: min(340px, calc(100vw - 40px));
  background: var(--paper); color: var(--ink); border: 1px solid var(--hair); border-radius: 18px; padding: 18px 18px 16px;
  box-shadow: 0 26px 60px -28px #000c, 0 1px 2px #0000000d }
.cta-card-inline { position: relative; right: auto; bottom: auto; z-index: auto; width: 340px; max-width: 100% }
.cta-card-img { display: block; width: calc(100% + 36px); margin: -18px -18px 12px; aspect-ratio: 16 / 7; object-fit: cover; border-radius: 18px 18px 0 0 }
.cta-card-h { font-family: var(--fd); font-weight: 600; font-size: 17.5px; letter-spacing: -.015em; line-height: 1.2; margin: 0 24px 6px 0 }
.cta-card-text :deep(p) { font-size: 13.5px; line-height: 1.5; color: var(--ink2); margin: 0 }
.cta-card-media { margin-top: 10px }

@media (prefers-reduced-motion: no-preference) {
  .cta-card:not(.cta-card-inline) { animation: cta-up .26s cubic-bezier(.2, .8, .2, 1) }
  @keyframes cta-up { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
}
</style>
