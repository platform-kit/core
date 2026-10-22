<script setup>
/*
 * THE NETWORK, ON ITS OWN — /feed and everything under it, laid out the way every social app is:
 * the network's own navigation on the left (NetRail; a bar along the bottom on a phone), its column
 * in the middle (NetColumn: Home, Explore, Notifications, a thread), and on the right search, Who
 * to follow and the spaces (NetAside). The Post button opens the composer in a window over it.
 *
 * In the chat layout with the spaces on (community.layout, the default), /feed is not drawn here: it
 * opens inside the spaces area (SpacesPage) with the same column. Here is the network on its own,
 * and the social layout.
 * Never indexed: a timeline is a person's own. Words from network.md.
 */
import { computed, ref, watch } from 'vue'
import SiteLayout from '../layouts/SiteLayout.vue'
import { us } from 'platformkit/lib/content.js'
import { route, ROUTES } from 'platformkit/lib/router.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import NetColumn from '../components/network/NetColumn.vue'
import NetComposer from '../components/network/NetComposer.vue'
import NetRail from '../components/network/NetRail.vue'
import NetAside from '../components/network/NetAside.vue'

const S = computed(() => us('network').shell.main)
const view = computed(() => {
  const p = route.value || ''
  if (p.startsWith(ROUTES.feed + '/post/')) return ''
  if (p === ROUTES.feed + '/notifications') return 'notes'
  if (p === ROUTES.feed + '/explore') return 'explore'
  return 'home'
})
const column = ref(null)
/* THE POST WINDOW: the left rail's Post button and the phone's floating one open the composer over the page */
const composing = ref(false)
const signIn = () => { if (window.DLauth) window.DLauth.open() }
function compose() { if (!isSignedIn.value) return signIn(); composing.value = true }
function posted() { composing.value = false; if (column.value) column.value.refresh() }
function onKey(e) { if (e.key === 'Escape') composing.value = false }
watch(composing, (on) => { if (on) document.addEventListener('keydown', onKey); else document.removeEventListener('keydown', onKey) })
</script>

<template>
  <SiteLayout>
    <div class="fd">
      <!-- THE NETWORK'S OWN NAVIGATION -->
      <div class="fd-left"><NetRail :view="view" @compose="compose" /></div>
      <NetColumn ref="column" />
      <!-- BESIDE IT: search, who to follow, the spaces -->
      <div class="fd-right"><NetAside @pinned="column && column.refresh()" /></div>
    </div>

    <!-- THE POST WINDOW -->
    <div v-if="composing" class="fd-modal" role="dialog" aria-modal="true" :aria-label="S['new-post']" @click.self="composing = false">
      <div class="fd-modal-box">
        <div class="fd-modal-bar">
          <button type="button" class="fd-modal-x" :aria-label="S.close" @click="composing = false">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
          </button>
        </div>
        <NetComposer autofocus @posted="posted" />
      </div>
    </div>
  </SiteLayout>
</template>

<style scoped>
/* THREE COLUMNS, the way a social app is laid out: the navigation, the column, what is beside it */
.fd { display: grid; grid-template-columns: 250px minmax(0, 680px) 340px; justify-content: center; gap: 0 28px; padding: 18px 16px 90px }
.fd-left, .fd-right { min-width: 0 }
/* THE POST WINDOW, over a dimmed page */
.fd-modal { position: fixed; inset: 0; z-index: 80; display: flex; justify-content: center; align-items: flex-start; padding: 6vh 16px;
  background: color-mix(in srgb, #0b1220 45%, transparent); animation: fd-fade .2s cubic-bezier(.2, .8, .2, 1) }
.fd-modal-box { width: 100%; max-width: 600px; border-radius: 18px; background: var(--paper); box-shadow: 0 30px 80px -20px rgba(0, 0, 0, .45);
  overflow: hidden; animation: fd-rise .25s cubic-bezier(.2, .8, .2, 1) }
.fd-modal-bar { display: flex; padding: 8px 10px 0 }
.fd-modal-x { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--ink); cursor: pointer }
.fd-modal-x:hover { background: color-mix(in srgb, var(--ink) 7%, transparent) }
.fd-modal-box :deep(.nc) { border-bottom: 0 }
@keyframes fd-fade { from { opacity: 0 } }
@keyframes fd-rise { from { opacity: 0; transform: translateY(14px) scale(.98) } }
@media (max-width: 1320px) { .fd { grid-template-columns: 88px minmax(0, 680px) 320px; gap: 0 20px } }
@media (max-width: 1140px) { .fd { grid-template-columns: 88px minmax(0, 680px) } .fd-right { display: none } }
@media (max-width: 700px) {
  .fd { grid-template-columns: minmax(0, 1fr); padding: 0 0 90px }
  .fd-left { height: 0 }
  .fd-modal { padding: 0 }
  .fd-modal-box { max-width: none; min-height: 100%; border-radius: 0 }
}
@media (prefers-reduced-motion: reduce) { .fd-modal, .fd-modal-box { animation: none } }
</style>

<style>
/* ON A PHONE the network's bar holds the bottom of the screen: the Post button sits just above it,
   where the thumb is, and the site's chat button above that — so nothing covers a place in the bar,
   and the chat's card, which rises from its button, clears the Post button */
@media (max-width: 700px) {
  html:has(.fd) { --pk-dock: calc(58px + 72px + env(safe-area-inset-bottom)) }
  body .fd .nr-post { right: 16px; bottom: calc(72px + env(safe-area-inset-bottom)) }
}
</style>
