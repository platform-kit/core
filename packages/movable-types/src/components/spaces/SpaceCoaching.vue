<script setup>
/*
 * A MEMBER'S COACHING, inside the community (openspec: coaching-in-one-place).
 *
 * A business says once where coaching lives (platformkit.config.js coaching.where): the results
 * sheet, or here — and the conversation and the sessions go together. It is the same conversation
 * and the same sessions either way: the chat is CoachingPanel, the sessions are the sheet's own
 * Coaching page with its banner left off (what is coming, what has been, and the booker, which
 * offers only what this reader may book with what is left). No address of its own: the rail already
 * says where you are.
 *
 * What is in the place is places.js coachingPlace: the conversation where they may write to a coach,
 * the sessions where the sessions module is on. The coach's side is the desk's Clients queue.
 */
import { ref, computed, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import CoachingPanel from '../chat/CoachingPanel.vue'
import CoachingPage from '../../instrument/ui/results/CoachingPage.vue'

const props = defineProps({
  /* { chat, sessions } — what this reader's place holds */
  place: { type: Object, default: () => ({ chat: true, sessions: false }) },
})
const W = computed(() => us('spaces').coaching.main)
const KEY = 'pk.coaching.tab'
const read = () => { try { return localStorage.getItem(KEY) || '' } catch (e) { return '' } }
const tabs = computed(() => [
  ...(props.place.chat ? [{ key: 'chat', word: W.value.chat }] : []),
  ...(props.place.sessions ? [{ key: 'sessions', word: W.value.sessions }] : []),
])
const tab = ref(read())
/* the remembered tab where it is still offered, else the first: the conversation where there is one */
watch(tabs, (t) => { if (!t.some((x) => x.key === tab.value)) tab.value = (t[0] || {}).key || '' }, { immediate: true })
function choose(k) { tab.value = k; try { localStorage.setItem(KEY, k) } catch (e) { /* this browser keeps nothing */ } }
</script>

<template>
  <div class="scoach">
    <nav v-if="tabs.length > 1" class="scoach-tabs" role="tablist">
      <button
        v-for="t in tabs" :key="t.key" type="button" role="tab" :class="{ on: tab === t.key }"
        :aria-selected="tab === t.key" @click="choose(t.key)"><span>{{ t.word }}</span></button>
    </nav>
    <div v-if="tab === 'chat'" class="scoach-chat"><CoachingPanel /></div>
    <div v-else-if="tab === 'sessions'" class="scoach-sessions"><CoachingPage framed /></div>
  </div>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; this says what it wants instead. The chat's
   own surfaces are named here because the site's --card is translucent and would show the rail
   through the list. The sessions wear the instrument's tokens on the sheet; here they are the
   community's, as the admin's Bookings maps them. */
.scoach { --chat-side: color-mix(in srgb, var(--ink) 3%, var(--paper));
  --chat-peer: color-mix(in srgb, var(--ink) 6%, var(--paper));
  --chat-field: color-mix(in srgb, var(--ink) 5%, var(--paper));
  --chat-own: var(--ink); --chat-own-ink: var(--paper);
  --qink: var(--ink); --qink2: var(--ink2); --qink3: var(--ink3); --qhair: var(--hair);
  --qcard: color-mix(in srgb, var(--ink) 2.5%, var(--paper)); --qpaper: var(--paper); --qflip: var(--paper);
  --s2: 16px; --s3: 26px;
  display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; background: var(--paper) }
.scoach-tabs { flex: none; display: flex; gap: 4px; margin: 0; padding: 6px 16px 0; border: 0; border-bottom: 1px solid var(--hair) }
.scoach-tabs button { flex: none; padding: 0 12px; border: 0; border-radius: 10px 10px 0 0; background: transparent; font: inherit;
  font-size: 15px; font-weight: 600; color: var(--ink3); cursor: pointer; transition: color .2s, background .2s }
.scoach-tabs button:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 4%, transparent) }
.scoach-tabs button span { position: relative; display: block; padding: 10px 2px 12px }
.scoach-tabs button.on { color: var(--ink); font-weight: 700 }
.scoach-tabs button.on span::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--accent) }
.scoach-chat { flex: 1; min-height: 0; overflow: hidden }
.scoach-sessions { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 20px 40px }
@media (max-width: 480px) { .scoach-sessions { padding: 12px 12px 24px } }
</style>
