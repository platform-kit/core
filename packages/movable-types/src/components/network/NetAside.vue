<script setup>
/*
 * BESIDE THE TIMELINE — what every social app keeps on its right: a search for people, Who to
 * follow, and (where the site has spaces) the spaces whose feeds the reader runs through Home, each
 * pinned or not with one press. Hidden on a narrow screen, where Explore holds the search.
 * Words from network.md (shell, timeline).
 */
import { computed, ref, onMounted, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { ROUTES, navigate } from '@platform-kit/kit/lib/router.js'
import { isSignedIn } from '@platform-kit/kit/lib/auth.js'
import { net, suggestions, loadSpaces, pin, PINNING } from '@platform-kit/kit/lib/network/api.js'
import site from '#site'
import { showsFollowing } from '@platform-kit/kit/lib/community/places.js'
const FOLLOWING = showsFollowing((site.community || {}).hide)
import NetPersonRow from './NetPersonRow.vue'

const emit = defineEmits(['pinned'])
const S = computed(() => us('network').shell.main)
const T = computed(() => us('network').timeline.main)
const q = ref('')
const who = ref([])
const whoLoaded = ref(false)
const pinBusy = ref('')
const spaces = computed(() => net.spaces || [])

async function load() {
  if (!isSignedIn.value) return
  try { who.value = await suggestions(4) } catch { who.value = [] } finally { whoLoaded.value = true }
  loadSpaces().catch(() => {})
}
onMounted(load)
watch(isSignedIn, load)
function search() { const s = q.value.trim(); navigate(ROUTES.feed + '/explore' + (s ? '?q=' + encodeURIComponent(s) : '')) }
async function togglePin(s) { pinBusy.value = s.space_id; try { await pin(s.space_id, !s.pinned); emit('pinned') } finally { pinBusy.value = '' } }
</script>

<template>
  <div class="nas">
    <form class="na-search" role="search" @submit.prevent="search">
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
      <input v-model="q" type="search" :placeholder="S.search" :aria-label="S.search" />
    </form>

    <div v-if="FOLLOWING && isSignedIn && who.length" class="na-card">
      <h2>{{ S['who-title'] }}</h2>
      <template v-if="who.length">
        <NetPersonRow v-for="id in who" :key="id" :id="id" />
        <a class="na-more" :href="ROUTES.feed + '/explore'">{{ S['who-more'] }}</a>
      </template>
      <p v-else class="na-none">{{ S['who-none'] }}</p>
    </div>

    <!-- the spaces one may pin to Home: only where the site lets members choose (community.pinning) -->
    <div v-if="PINNING && isSignedIn && spaces.length" class="na-card">
      <h2>{{ S['spaces-title'] }}</h2>
      <p class="na-line">{{ T['pins-line'] }}</p>
      <ul class="na-spaces">
        <li v-for="s in spaces" :key="s.space_id">
          <a :href="ROUTES.spaces + '/' + s.slug">
            <span class="na-mark" aria-hidden="true">{{ (s.name || '?').slice(0, 1) }}</span>
            <span>{{ s.name }}</span>
          </a>
          <button type="button" :class="{ on: s.pinned }" :disabled="pinBusy === s.space_id" :aria-pressed="s.pinned" @click="togglePin(s)">{{ s.pinned ? T.unpin : T.pin }}</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.nas { position: sticky; top: 18px; display: flex; flex-direction: column; gap: 16px }
.na-search { display: flex; align-items: center; gap: 10px; padding: 0 16px; height: 46px; border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 6%, var(--paper)); color: var(--ink3); border: 1px solid transparent }
.na-search:focus-within { border-color: var(--accent); background: var(--paper); color: var(--accent) }
.na-search input { flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; font-size: 15px; color: var(--ink) }
.na-search input:focus { outline: none }
.na-card { padding: 14px 0 6px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--ink) 9%, transparent); border-radius: 18px; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 3.5%, var(--paper)) 0%, var(--paper) 55%); box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 4%, transparent), 0 10px 28px -20px color-mix(in srgb, var(--ink) 35%, transparent); animation: na-in .45s cubic-bezier(.2, .8, .2, 1) both }
.na-card + .na-card { animation-delay: .06s }
@keyframes na-in { from { opacity: 0; transform: translateY(8px) } }
@media (prefers-reduced-motion: reduce) { .na-card { animation: none } }
.na-card h2 { margin: 0 16px 6px; font-family: var(--fd); font-size: 19px; font-weight: 800; letter-spacing: -.01em; color: var(--ink) }
.na-line { max-width: none; margin: 0 16px 6px; font-size: 13.5px; line-height: 1.45; color: var(--ink3) }
.na-none { max-width: none; margin: 4px 16px 12px; font-size: 14px; color: var(--ink3) }
.na-more { display: block; padding: 12px 16px; font-size: 14.5px; color: var(--accent); text-decoration: none }
.na-more:hover { background: color-mix(in srgb, var(--ink) 3%, transparent) }
.na-spaces { list-style: none; margin: 0; padding: 0 0 6px }
.na-spaces li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 16px }
.na-spaces a { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 15px; font-weight: 700; color: var(--ink); text-decoration: none }
.na-spaces a span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.na-spaces a:hover span:last-child { text-decoration: underline }
.na-mark { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 16%, var(--paper)); color: var(--accent); font-weight: 800; font-size: 15px; text-transform: uppercase }
.na-spaces button { flex: none; font: inherit; font-size: 13px; font-weight: 700; padding: 6px 14px; border: 0; border-radius: 999px;
  background: var(--ink); color: var(--paper); cursor: pointer }
.na-spaces button.on { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1px var(--hair) }
</style>
