<script setup>
/*
 * The library as a picker: the Media page in a modal (MediaPage `pick`), opened by any file field through
 * lib/admin/media-pick.js and closed with the chosen file or nothing. Mounted once by the admin; the manager's chunk is
 * fetched the first time a field asks. Words are the `media` scope's `page.pick` and `page.sources`.
 *
 * AND WHEREVER ELSE A PICTURE CAN COME FROM. The kit's image sources (packages/kit/build/images) appear
 * here as further tabs beside the library — Unsplash today, generators expected later. Three rules:
 *
 *   A SOURCE WITH NO KEY IS ABSENT, not greyed out and not failing when pressed. The server says
 *   which exist (`images sources`, asked once per admin session) and the browser draws those; a
 *   deployment that has set nothing sees exactly the library it saw before, with no tab bar at all.
 *
 *   SOURCES ARE ONLY FOR PICTURES. A field asking for any file gets the library alone: a PDF field
 *   offering a photograph search would be nonsense.
 *
 *   WHAT IS CHOSEN LANDS IN THE LIBRARY and the field takes an ordinary address, so nothing about
 *   this is special to the rest of the system.
 */
import { defineAsyncComponent, ref, watch, computed } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { pickState, answerPick } from '../../lib/admin/media-pick.js'
import { images } from '../../lib/admin/api.js'
const MediaPage = defineAsyncComponent(() => import('../MediaPage.vue'))
const ImageSource = defineAsyncComponent(() => import('./ImageSource.vue'))

const P = us('media').page.pick
const S = computed(() => us('media').page.sources)

/* asked once: which sources this deployment has keys for. Null until the answer is in, so the
   tab bar is not drawn and then taken away again. */
const sources = ref(null)
const tab = ref('library')

async function askSources() {
  if (sources.value !== null) return
  try { sources.value = (await images('sources')).sources || [] } catch { sources.value = [] }
}

/* a source's own name is a word of the scope, under its key — so a new source needs one line of
   markdown and no change here */
const nameOf = (key) => S.value[key] || key
const shown = computed(() => (pickState.value && pickState.value.pictures ? (sources.value || []) : []))

function onKey(e) { if (e.key === 'Escape') answerPick(null) }
watch(pickState, (s) => {
  if (s) { document.addEventListener('keydown', onKey); tab.value = 'library'; if (s.pictures) askSources() }
  else document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="pickState" class="mp-veil" @mousedown.self="answerPick(null)">
      <div class="mp-box" role="dialog" :aria-label="P.title">
        <header class="mp-head">
          <h2>{{ P.title }}</h2>
          <button type="button" class="mp-x" :aria-label="P.cancel" @click="answerPick(null)">×</button>
        </header>

        <!-- drawn only where there is somewhere else to look -->
        <nav v-if="shown.length" class="mp-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="tab === 'library'" :class="{ on: tab === 'library' }" @click="tab = 'library'">{{ S.library }}</button>
          <button v-for="s in shown" :key="s.key" type="button" role="tab" :aria-selected="tab === s.key" :class="{ on: tab === s.key }" @click="tab = s.key">{{ nameOf(s.key) }}</button>
        </nav>

        <div class="mp-body">
          <MediaPage v-if="tab === 'library'" pick :pictures="pickState.pictures" @pick="answerPick" @cancel="answerPick(null)" />
          <ImageSource v-else :source="tab" :dir="pickState.dir || 'content/uploads'" @pick="answerPick" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mp-veil { position: fixed; inset: 0; z-index: 95; background: #0a0d0b7a; backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 24px }
.mp-box { width: min(1100px, 100%); height: min(760px, 100%); background: var(--paper); color: var(--ink); border: 1px solid var(--hair); border-radius: 16px; box-shadow: 0 30px 80px #0006; display: flex; flex-direction: column; overflow: hidden }
.mp-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 10px; border-bottom: 1px solid var(--hair) }
.mp-head h2 { margin: 0; font-family: var(--fd); font-weight: 600; font-size: 19px }
.mp-x { border: 0; background: none; color: var(--ink2); font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 6px } .mp-x:hover { color: var(--ink) }
.mp-tabs { display: flex; gap: 2px; padding: 8px 18px 0; border-bottom: 1px solid var(--hair) }
.mp-tabs button { border: 0; background: none; color: var(--ink3); font: inherit; font-size: 14px; padding: 7px 12px 9px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px }
.mp-tabs button:hover { color: var(--ink) }
.mp-tabs button.on { color: var(--ink); border-bottom-color: var(--accent) }
.mp-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 6px 6px 0 0 }
.mp-body { flex: 1; min-height: 0; padding: 14px 18px 16px }
.mp-body :deep(.md) { height: 100% }
</style>
