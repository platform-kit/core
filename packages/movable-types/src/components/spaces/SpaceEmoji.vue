<script setup>
/*
 * THE EMOJI PICKER, one of them, used wherever an emoji is chosen: the composer inserts from it and
 * a message reacts with it. Two pickers would be two sets, two searches and two ideas about what
 * "recently used" means.
 *
 * It opens on what this person reached for last, because that is what they are about to reach for
 * again — kept in this browser and nowhere else (it is a convenience, not a fact about them). The
 * search is on the WORDS, in the pure module the build tests; nobody types 🔥 to find 🔥.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { GROUPS, search, remember } from '@platform-kit/kit/lib/spaces/emoji.js'

const props = defineProps({
  /* drawn away from its button (teleported out of a scroller that would clip it), in which case it
     places itself and carries its own floating rather than relying on a rule reaching it there */
  at: { type: Object, default: null },
})
const emit = defineEmits(['pick', 'close'])
const W = computed(() => us('spaces').emoji.main)
const KEY = 'dl.spaces.emoji'

const q = ref('')
const box = ref(null)
const root = ref(null)
const recent = ref([])
/* clicking away closes it — the thing every popup owes, said once here rather than by each host */
const away = (e) => { if (root.value && !root.value.contains(e.target)) emit('close') }
onMounted(async () => {
  try { recent.value = JSON.parse(localStorage.getItem(KEY) || '[]') } catch { recent.value = [] }
  await nextTick()
  if (box.value) box.value.focus()
  document.addEventListener('pointerdown', away, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', away, true))

/* searching replaces the groups; otherwise the groups stand, with what was used last above them */
const found = computed(() => (q.value.trim() ? search(q.value) : null))
const sections = computed(() => {
  if (found.value) return [[W.value.results, found.value.map((e) => e.emoji)]]
  const out = GROUPS.map(([g, list]) => [W.value['group-' + g] || g, list.map(([e]) => e)])
  return recent.value.length ? [[W.value.recent, recent.value], ...out] : out
})

function choose(e) {
  recent.value = remember(recent.value, e)
  try { localStorage.setItem(KEY, JSON.stringify(recent.value)) } catch { /* a private window */ }
  emit('pick', e)
}
</script>

<template>
  <div ref="root" class="se" :class="{ floating: !!at }" :style="at ? { top: at.top + 'px', left: at.left + 'px' } : null" @keydown.esc="emit('close')">
    <input ref="box" v-model="q" type="search" class="se-find" :placeholder="W.find" :aria-label="W.find" />
    <div class="se-body">
      <template v-for="[title, list] in sections" :key="title">
        <p v-if="list.length" class="se-group">{{ title }}</p>
        <ul v-if="list.length" class="se-grid">
          <li v-for="e in list" :key="title + e">
            <button type="button" @click="choose(e)">{{ e }}</button>
          </li>
        </ul>
      </template>
      <p v-if="found && !found.length" class="se-none">{{ W.none }}</p>
    </div>
  </div>
</template>

<style scoped>
.se.floating { position: fixed; z-index: 140 }
.se { display: flex; flex-direction: column; gap: 8px; width: 288px; padding: 10px;
  background: var(--paper); border: 1px solid var(--hair, var(--line, var(--hair))); border-radius: 13px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, .18) }
.se-find { font: inherit; font-size: 13px; color: var(--ink); padding: 7px 10px;
  background: color-mix(in srgb, var(--ink) 5%, transparent); border: 1px solid transparent; border-radius: 9px }
.se-find:focus { outline: none; border-color: color-mix(in srgb, var(--ink) 28%, transparent) }
.se-body { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto }
.se-group { margin: 6px 0 0; font-size: 10px; font-weight: 700; letter-spacing: .07em;
  text-transform: uppercase; color: var(--ink3) }
.se-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 1px; margin: 0; padding: 0; list-style: none }
.se-grid button { display: grid; place-items: center; width: 100%; aspect-ratio: 1; font-size: 18px;
  line-height: 1; background: none; border: 0; border-radius: 7px; cursor: pointer }
.se-grid button:hover { background: color-mix(in srgb, var(--ink) 9%, transparent) }
.se-none { margin: 10px 2px; font-size: 12.5px; color: var(--ink3) }
</style>
