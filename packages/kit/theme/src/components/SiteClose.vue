<script setup>
/*
 * The close at the foot of a page — the landing's own Close section, worded by an
 * ad in the 'footer' placement (content/ads/*.md), so the footer's call to action
 * is targeted and A/B-tested like the inline card and the modal: the picker
 * chooses by placement, audience and topics, an experiment collapses it to the
 * visitor's variant, the impression is the exposure and the click the goal. With
 * no footer ad the site's own words stand (content/app/ui/library.md, article.close).
 */
import { ref, computed, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { resolve } from './landing/index.js'
import { look } from 'platformkit/lib/look.js'
import { pickAd, markDismissed } from 'platformkit/lib/ads.js'
import { capture } from 'platformkit/lib/analytics.js'
import { expose } from 'platformkit/lib/experiments.js'

const props = defineProps({ topics: { type: Array, default: () => [] } })
const D = (us('library').article || {}).close || {}
const ad = ref(null)
const comp = computed(() => resolve('Close', look.value))
const words = computed(() => ad.value
  ? { heading: ad.value.headline || D.heading, cta: ad.value.button || D.cta, href: ad.value.href || D.href }
  : { heading: D.heading, cta: D.cta, href: D.href })
onMounted(async () => {
  const b = await pickAd({ placement: 'footer', pageTopics: props.topics })
  if (!b) return
  ad.value = b
  capture('cta_impression', { ad_id: b.id, mode: 'footer' })
  expose(b)
})
/* the close's button is a plain link; a click on it is the goal */
function onClick(e) {
  if (!ad.value || !e.target.closest('a')) return
  capture('cta_click', { ad_id: ad.value.id, mode: 'footer' })
  markDismissed(ad.value.id)
}
</script>

<template>
  <div v-if="comp && words.heading" class="lproot siteclose" @click="onClick">
    <component :is="comp" :key="ad ? ad.id : 'default'" :heading="words.heading" :cta="words.cta" :href="words.href" />
  </div>
</template>

<style scoped>
/* THE CLOSE IS THE LANDING'S OWN SECTION, AND MUST LOOK LIKE IT.
 *
 * On the landing the close is 546px tall (150 above, 120 below), and its light — a radial 160vw
 * wide and 80vh tall whose centre sits on the section's bottom edge, with the sun disc behind it —
 * spills ABOVE the section into whatever is over it and BELOW into the footer. Nothing clips it
 * except the landing's own root, which is the whole page, so both spills are soft and the section
 * reads as the ground the page ends on.
 *
 * At the foot of the store and of an article this component is that same section, so it must give
 * it the same room. Two things were taking it away:
 *
 *   the padding. This file used to override the section's 150/120 to 90/90, which makes it 456px
 *   and moves the light's centre up relative to the words. It does not any more: the section sets
 *   its own proportions, as it does on the landing.
 *
 *   the clip. overflow: hidden cut the light at its brightest point, drawing a hard line across the
 *   foot of the page; an inset clip freeing only the bottom then cut the TOP of the sun instead,
 *   which is the harder line of the two, because the sun is near-opaque at its edge where the glow
 *   is already transparent. The clip exists only for the WIDTH — 160vw would give the page a
 *   horizontal scrollbar — so it clips the sides and frees a viewport of room above and below,
 *   which is what overflow cannot express (overflow-y: visible computes to auto beside
 *   overflow-x: hidden).
 */
.siteclose {
  margin: 40px 0 0;
  border-radius: 0;
  background: transparent;
  /* CLIP-PATH HIDES THE SIDES; IT DOES NOT STOP THEM WIDENING THE PAGE. The glow is drawn wider
     than the measure and clipped, but clipping is painting and the overflow is still laid out —
     so a page whose close was not inside a landing root scrolled sideways into 380px of nothing.
     overflow-x: clip stops that and, unlike hidden, leaves the other axis genuinely visible, which
     is what lets the light go a viewport above and below. */
  overflow-x: clip;
  overflow-y: visible;
  clip-path: inset(-100vh 0 -100vh 0);
}
</style>
