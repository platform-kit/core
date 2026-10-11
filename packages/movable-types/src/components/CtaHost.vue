<script setup>
/*
 * The global CTA host — mounted once in App.vue. On every route it waits ten
 * seconds, then asks the targeting engine for the best ad. If a full modal
 * hasn't been shown in the last hour AND the reader has actually opened some
 * content, it shows the modal; otherwise a quiet, dismissable card in the bottom
 * right. Inside a book it is only ever the card. It stays out of the instrument
 * (/app) and the admin, and off article pages, where the CTA lives inline at
 * the foot of the piece instead (ArticleCta.vue).
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { route, ROUTES, INTERRUPT_ROUTES, navigate, isPageRoute } from '../router.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { pickAd, canShowModalNow, markShown, markDismissed, viewTally } from '@platform-kit/kit/lib/ads.js'
import { mayInterrupt, newPageView, claimCorner, releaseCorner } from '@platform-kit/kit/lib/interrupt.js'
import { capture } from '@platform-kit/kit/lib/analytics.js'
import { expose } from '@platform-kit/kit/lib/experiments.js'
import AdCard from './AdCard.vue'
import AdModal from './AdModal.vue'

const U = us('cta').card.ui
const DELAY_MS = 10000

const ad = ref(null)
const mode = ref('card')       /* 'modal' | 'card' */
let timer = null

function clear() { if (timer) { clearTimeout(timer); timer = null } }
function evaluate(path) {
  clear(); ad.value = null
  newPageView(path)
  /* where nothing may appear is one rule, asked by the ad and by the chat alike (lib/interrupt.js):
     a place of work is not a place to be sold to */
  if (!mayInterrupt(path, INTERRUPT_ROUTES)) return
  if (/^\/content\/articles\/./.test(path)) return
  /* inside a book the reader is mid-sentence, and on a landing page they are
     being introduced: only ever the corner card in either place, never the
     full modal */
  const reading = /^\/content\/books\/./.test(path) || isPageRoute(path)
  timer = setTimeout(async () => {
    const b = await pickAd({ placement: 'modal' })
    if (!b || route.value !== path || !mayInterrupt(route.value, INTERRUPT_ROUTES)) return
    /* the corner belongs to whoever takes it first in a page view: if the chat is already saying
       something there, the ad waits for another page rather than stacking on it */
    if (!claimCorner('ad')) return
    mode.value = !reading && canShowModalNow() && viewTally().n > 0 ? 'modal' : 'card'
    ad.value = b
    markShown(b.id, { modal: mode.value === 'modal' })
    capture('cta_impression', { ad_id: b.id, mode: mode.value })
    expose(b)   /* an ad under test: this is the exposure */
  }, DELAY_MS)
}
watch(route, evaluate, { immediate: true })
onBeforeUnmount(clear)

function dismiss() {
  const b = ad.value
  if (b) { markDismissed(b.id); capture('click', { kind: 'cta_dismiss', ad_id: b.id, mode: mode.value }) }
  ad.value = null
  releaseCorner('ad')   /* put away: the chat may have the corner for the rest of the page */
}
function go() {
  const b = ad.value
  if (!b) return
  capture('cta_click', { ad_id: b.id, mode: mode.value })
  markDismissed(b.id)
  ad.value = null
  if (!b.href) return
  if (b.href.startsWith('/')) navigate(b.href)
  else window.open(b.href, '_blank', 'noopener')
}
</script>

<template>
  <!-- the full modal: at most once an hour, only for a reader who has shown interest -->
  <AdModal v-if="ad && mode === 'modal'" :ad="ad" @go="go" @dismiss="dismiss" />
  <!-- the quiet version: a corner card -->
  <AdCard v-else-if="ad" :ad="ad" @go="go" @dismiss="dismiss" />
</template>
