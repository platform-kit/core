<script setup>
/*
 * The inline CTA at the foot of an article — the same targeted ad the host
 * would show elsewhere, rendered as an organic part of the piece rather than a
 * popup. Showing it inline doesn't start the ad's cooldown (it's gentle);
 * clicking it does.
 */
import { ref, onMounted } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { navigate } from '../router.js'
import { pickAd, markDismissed } from '@platform-kit/kit/lib/ads.js'
import { capture } from '@platform-kit/kit/lib/analytics.js'
import { expose } from '@platform-kit/kit/lib/experiments.js'
import MediaBlock from './content/MediaBlock.vue'

const props = defineProps({ topics: { type: Array, default: () => [] } })
const U = us('cta').card.ui
const ad = ref(null)

onMounted(async () => {
  const b = await pickAd({ placement: 'inline', pageTopics: props.topics })
  if (!b) return
  ad.value = b
  capture('cta_impression', { ad_id: b.id, mode: 'inline' })
  expose(b)   /* an ad under test: this is the exposure */
})
function go() {
  const b = ad.value
  capture('cta_click', { ad_id: b.id, mode: 'inline' })
  markDismissed(b.id)
  if (!b.href) return
  if (b.href.startsWith('/')) navigate(b.href)
  else window.open(b.href, '_blank', 'noopener')
}
</script>

<template>
  <aside v-if="ad" class="acta" :aria-label="U.label">
    <img v-if="ad.image" class="acta-img" :src="ad.image" alt="" />
    <div class="acta-body">
      <span class="acta-label">{{ U.label }}</span>
      <h3 v-if="ad.headline" class="acta-h">{{ ad.headline }}</h3>
      <div class="acta-text" v-html="ad.body" />
      <div v-if="ad.media" class="acta-media"><MediaBlock :media="ad.media" /></div>
      <button type="button" class="acta-btn" @click="go">{{ ad.button }}</button>
    </div>
  </aside>
</template>

<style scoped>
.acta { display: flex; gap: 0; margin: 52px 0 0; border: 1px solid var(--hair); border-radius: 20px; overflow: hidden;
  background: linear-gradient(160deg, color-mix(in srgb, var(--accent2) 10%, var(--card)), var(--card)); box-shadow: 0 24px 60px -36px #0009 }
.acta-img { flex: none; width: 38%; object-fit: cover }
.acta-body { flex: 1; min-width: 0; padding: 28px 30px 26px }
.acta-label { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent2); margin-bottom: 10px }
.acta-h { font-family: var(--fd); font-weight: 600; font-size: clamp(21px, 2.4vw, 26px); letter-spacing: -.02em; line-height: 1.15; margin: 0 0 10px; text-wrap: balance }
.acta-text :deep(p) { font-size: 15.5px; line-height: 1.6; color: var(--ink2); margin: 0 0 10px }
.acta-media { margin: 14px 0 4px }
.acta-btn { margin-top: 12px; font: inherit; font-size: 15px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0;
  border-radius: 999px; padding: 12px 24px; cursor: pointer; transition: transform .14s, box-shadow .14s }
.acta-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 24px -14px #000a }
@media (max-width: 640px) { .acta { flex-direction: column } .acta-img { width: 100%; aspect-ratio: 16 / 9 } .acta-body { padding: 22px } }
</style>
