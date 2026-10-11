<script setup>
/*
 * The support chat's launcher, on every public page: a round button in the corner with the
 * unread count, the card a chat prompt shows above it — a pop-up's, or the desk's default nudging
 * with its teaser line (src/lib/support/prompts.js) — and the
 * panel (lazy — its chunk is fetched the first time it opens). Never for the staff, on the
 * admin, the preview, the share cards or the prerender. An away email's link (?support=<id>)
 * opens the panel on that thread. Words from content/app/ui/support.md (widget → launcher).
 */
import { ref, shallowRef, computed, watch, onMounted } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { route, ROUTES, INTERRUPT_ROUTES } from '../../router.js'
import { isStaff } from '@platform-kit/kit/lib/auth.js'
import { IN_PREVIEW } from '@platform-kit/kit/lib/analytics.js'
import { mayInterrupt } from '@platform-kit/kit/lib/interrupt.js'
import { panelOpen, unread, staff, boot, open, close, openThread } from '@platform-kit/kit/lib/support/api.js'
import { teaser, nudge, quietNudge, startPrompts, dismiss, reply, resolveDefault, fallback, track } from '@platform-kit/kit/lib/support/prompts.js'
import { installChatWidget } from '@platform-kit/kit/lib/support/chat-widget.js'
import { api as API } from '#site'
import SupportTeaser from './SupportTeaser.vue'

/* the panel's chunk is fetched a moment after the launcher lands — not before the page, not at the
   click: a chunk arriving mid-transition is what makes an open pop instead of grow */
/* held as a plain component once loaded, never an async wrapper: an async wrapper mounts a placeholder
   first and the real element after, and the enter transition would run on the placeholder */
const SupportPanel = shallowRef(null)
let panelChunk = null
const warmPanel = () => { if (!panelChunk) panelChunk = import('./SupportPanel.vue').then((m) => { SupportPanel.value = m.default; return m.default }); return panelChunk }
const L = us('support').widget.launcher
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const quiet = computed(() => IN_PREVIEW || !mayInterrupt(route.value, INTERRUPT_ROUTES) || isStaff.value || staff.value)
const prompt = ref(null)   /* the prompt being answered, handed to the panel */
const choice = ref(null)   /* the choice picked on the teaser, if any */

onMounted(async () => {
  setTimeout(warmPanel, 1200)
  await boot()
  startPrompts()
  const id = new URLSearchParams(location.search).get('support')
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    open(id)
    const p = new URLSearchParams(location.search); p.delete('support')
    const q = p.toString()
    history.replaceState({}, '', location.pathname + (q ? '?' + q : '') + location.hash)
  }
})
async function toggle() { if (panelOpen.value) { close(); prompt.value = null; choice.value = null } else { quietNudge(); resolveDefault(); await warmPanel(); open() } }
async function answer(c) { choice.value = c || null; prompt.value = reply(); if (c && prompt.value) track.chose(prompt.value, c); quietNudge(); await warmPanel(); open() }
/* the card's one button: a pop-up's opens the panel on that prompt; the nudge's opens the panel on the desk's default */
function enter() { if (teaser.value) answer(null); else toggle() }
function putAway() { if (teaser.value) dismiss(); else quietNudge() }
/* the panel is stamped by the AdCard's corner: the card moves up while the launcher is there */
watch(quiet, (q) => { document.documentElement.toggleAttribute('data-support', !q) }, { immediate: true })
/* window.$chatwidget (and $chatwoot, the same object) — the page-side object over this widget (support-api): the launcher hidden or shown on its say-so, the panel's chunk warmed as it opens */
const bubbleHidden = ref(false)
installChatWidget({ inbox: API.space, bubble: (visible) => { bubbleHidden.value = !visible }, popout: (typeof location !== 'undefined' ? location.origin : '') + ROUTES.support })
watch(panelOpen, (o) => { if (o && !SupportPanel.value) { resolveDefault(); warmPanel() } })
</script>

<template>
  <div v-if="!quiet && !bubbleHidden" class="sw" :class="{ open: panelOpen }">
    <Transition name="sw-panel">
      <component :is="SupportPanel" v-if="panelOpen && SupportPanel" class="sw-panel" :prompt="prompt" :choice="choice" :fallback="fallback" @close="toggle" @answered="prompt = null; choice = null" />
    </Transition>
    <Transition name="sw-card">
      <SupportTeaser v-if="(teaser || nudge) && !panelOpen" class="sw-teaser" :prompt="teaser || nudge" @reply="answer" @open="enter" @dismiss="putAway" />
    </Transition>
    <button type="button" class="sw-btn" :class="{ open: panelOpen }" :aria-label="panelOpen ? L.close : L.open" :title="panelOpen ? L.close : L.open" :aria-expanded="panelOpen" @click="toggle">
      <!-- the two faces turn into each other -->
      <svg class="sw-ico sw-ico-chat" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6l-4.5 3.5V16H7a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M8.5 9h7M8.5 12h4.5"/></svg>
      <svg class="sw-ico sw-ico-x" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      <Transition name="sw-badge"><i v-if="unread > 0 && !panelOpen" class="sw-n" :aria-label="fill(L.unread, { n: unread })">{{ unread > 9 ? '9+' : unread }}</i></Transition>
    </button>
  </div>
</template>

<style scoped>
/* ---- one curve for the whole widget: cubic-bezier(.2, .8, .2, 1), quick out, soft landing ---- */
/* --pk-dock: the height of a bar a page docks along the bottom (the community's, on a phone), so the
   launcher rides above it rather than over its last button */
.sw { position: fixed; right: 20px; bottom: calc(20px + var(--pk-dock, 0px)); z-index: 85; transition: bottom .3s cubic-bezier(.2, .8, .2, 1); display: flex; flex-direction: column; align-items: flex-end; gap: 12px; pointer-events: none }
.sw > * { pointer-events: auto }
/* the launcher arrives a beat after the page, growing out of its corner */
.sw-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border: 0; border-radius: 50%; cursor: pointer;
  color: var(--paper); background: var(--ink); box-shadow: 0 16px 34px -14px #000c, 0 1px 2px #0002;
  transition: transform .22s cubic-bezier(.2, .8, .2, 1), box-shadow .22s, background .22s;
  animation: sw-arrive .6s cubic-bezier(.2, .8, .2, 1) .35s both }
@keyframes sw-arrive { from { opacity: 0; transform: scale(.3) translateY(12px) } 60% { opacity: 1 } to { opacity: 1; transform: none } }
.sw-btn:hover { transform: translateY(-1px) scale(1.05); box-shadow: 0 20px 40px -16px #000c }
.sw-btn:active { transform: scale(.94) }
.sw-ico { position: absolute; transition: opacity .22s ease, transform .3s cubic-bezier(.2, .8, .2, 1) }
.sw-ico-x { opacity: 0; transform: rotate(-90deg) scale(.6) }
.sw-btn.open .sw-ico-chat { opacity: 0; transform: rotate(90deg) scale(.6) }
.sw-btn.open .sw-ico-x { opacity: 1; transform: none }
.sw-n { position: absolute; top: -2px; right: -2px; min-width: 20px; height: 20px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
  font-style: normal; font-family: var(--m); font-size: 11px; font-weight: 700; color: #fff; background: #d4483b; border: 2px solid var(--paper); border-radius: 999px }
.sw-badge-enter-active { transition: transform .35s cubic-bezier(.34, 1.56, .64, 1), opacity .2s }
.sw-badge-leave-active { transition: transform .16s ease, opacity .16s }
.sw-badge-enter-from, .sw-badge-leave-to { opacity: 0; transform: scale(.3) }
/* the panel grows out of the launcher's corner and settles; closing, it folds back */
.sw-panel { transform-origin: calc(100% - 28px) calc(100% + 40px) }
.sw-panel-enter-active { transition: opacity .26s ease, transform .42s cubic-bezier(.2, .8, .2, 1) }
.sw-panel-leave-active { transition: opacity .18s ease, transform .22s cubic-bezier(.4, 0, 1, 1) }
.sw-panel-enter-from { opacity: 0; transform: translateY(18px) scale(.86) }
.sw-panel-leave-to { opacity: 0; transform: translateY(12px) scale(.92) }
/* the card above the launcher rises as a message arrives; away, it drops */
.sw-card { transform-origin: 100% 100% }
.sw-card-enter-active { transition: opacity .3s ease, transform .5s cubic-bezier(.2, .8, .2, 1) }
.sw-card-leave-active { transition: opacity .16s ease, transform .2s cubic-bezier(.4, 0, 1, 1); position: absolute; right: 0; bottom: 68px }   /* out of the flow as it goes, so nothing under it jumps */
.sw-card-enter-from { opacity: 0; transform: translateY(14px) scale(.94) }
.sw-card-leave-to { opacity: 0; transform: translateY(8px) scale(.96) }
@media (prefers-reduced-motion: reduce) { .sw-btn { animation: none } .sw-btn, .sw-ico, .sw-panel-enter-active, .sw-panel-leave-active, .sw-card-enter-active, .sw-card-leave-active, .sw-badge-enter-active, .sw-badge-leave-active { transition: none } }
@media (max-width: 480px) {
  .sw { right: 14px; bottom: calc(14px + var(--pk-dock, 0px)) }
  .sw.open { inset: 0; right: 0; bottom: 0; gap: 0 }
  .sw.open .sw-btn { display: none }
  .sw-panel { transform-origin: 50% 100% }
}
</style>
<style>
/* the ad card shares the corner: it rides above the launcher while one is there */
html[data-support] .cta-card:not(.cta-card-inline) { bottom: 92px }
</style>
