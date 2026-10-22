<script setup>
/*
 * A PICTURE FROM SOMEWHERE THAT IS NOT THE LIBRARY YET.
 *
 * One component for the whole class of image sources (packages/kit/build/images): it is told
 * which source it is showing and asks the pipe to search it and to take what was chosen. It
 * knows nothing about Unsplash — a generator added later shows here with no change but its own
 * words, because the shape the pipe answers is the same.
 *
 * CHOOSING PUTS THE PICTURE IN THE LIBRARY and hands the field an ordinary address. Nothing
 * hotlinks: a site keeps its pictures whatever happens to the account they came from, and every
 * other rule about assets goes on working because there is nothing special about this one. The
 * line under the grid says so, because somebody choosing a picture should know where it goes.
 *
 * The key is never here. Every call is the admin's own pipe, which is already the one door.
 */
import { ref, computed, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { images } from '../../lib/admin/api.js'

const props = defineProps({
  source: { type: String, required: true },
  /* where in the library it lands — the field's own folder, as an upload would */
  dir: { type: String, default: 'content/uploads' },
})
const emit = defineEmits(['pick'])

const W = computed(() => us('media').page.sources)
const q = ref('')
const results = ref([])
const looking = ref(false)
const taking = ref('')
const trouble = ref('')
const searched = ref(false)

const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m))

async function look() {
  const term = q.value.trim()
  if (!term || looking.value) return
  looking.value = true; trouble.value = ''; searched.value = true
  try {
    const got = await images('search', { source: props.source, q: term, perPage: 24 })
    results.value = got.results || []
  } catch (e) { trouble.value = e.message || String(e); results.value = [] } finally { looking.value = false }
}

/* the moment a picture is actually chosen: the source does whatever its terms ask, the bytes
   come back, and the library holds them before the field is told anything */
async function take(r) {
  if (taking.value) return
  taking.value = r.id; trouble.value = ''
  try {
    const got = await images('take', { source: props.source, result: r, dir: props.dir })
    emit('pick', got.entry || { url: got.path, path: got.path })
  } catch (e) { trouble.value = W.value.failed + ' — ' + (e.message || String(e)) } finally { taking.value = '' }
}

watch(() => props.source, () => { results.value = []; searched.value = false; q.value = ''; trouble.value = '' })
</script>

<template>
  <div class="is-wrap">
    <form class="is-bar" @submit.prevent="look">
      <input v-model="q" class="is-q" type="search" :placeholder="W.placeholder" :aria-label="W.placeholder" autofocus />
      <button type="submit" class="is-go" :disabled="looking || !q.trim()">{{ looking ? W.searching : W.search }}</button>
    </form>

    <p v-if="trouble" class="is-trouble" role="alert">{{ trouble }}</p>

    <div v-if="results.length" class="is-grid">
      <figure v-for="r in results" :key="r.id" class="is-cell">
        <button type="button" class="is-hit" :disabled="!!taking" :aria-label="W.use" @click="take(r)">
          <img :src="r.thumb" :alt="r.alt || ''" loading="lazy" />
          <span v-if="taking === r.id" class="is-taking">{{ W.taking }}</span>
        </button>
        <figcaption v-if="r.credit" class="is-credit">
          <a v-if="r.credit.url" :href="r.credit.url" target="_blank" rel="noopener noreferrer">{{ fill(W.by, { name: r.credit.name }) }}</a>
          <span v-else>{{ fill(W.by, { name: r.credit.name }) }}</span>
          <a v-if="r.credit.sourceUrl" :href="r.credit.sourceUrl" target="_blank" rel="noopener noreferrer">{{ fill(W.on, { source: r.credit.source }) }}</a>
        </figcaption>
      </figure>
    </div>

    <p v-else-if="searched && !looking" class="is-empty">{{ W.empty }}</p>
    <p v-else-if="!searched" class="is-empty">{{ W.start }}</p>

    <p class="is-note">{{ W.note }}</p>
  </div>
</template>

<style scoped>
.is-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0 }
.is-wrap p { max-width: none }
.is-bar { display: flex; gap: 8px; margin: 0 0 12px }
.is-q { flex: 1; padding: 9px 12px; border: 1px solid var(--hair); border-radius: 9px; background: var(--paper); color: var(--ink); font: inherit }
.is-q:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px }
.is-go { padding: 9px 16px; border: 0; border-radius: 9px; background: var(--ink); color: var(--paper); font: inherit; cursor: pointer }
.is-go:hover:not([disabled]) { opacity: .88 }
.is-go[disabled] { opacity: .5; cursor: default }
.is-trouble { margin: 0 0 10px; color: var(--accent); font-size: 14px }
.is-grid { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; align-content: start }
.is-cell { margin: 0 }
.is-hit { position: relative; display: block; width: 100%; aspect-ratio: 3 / 2; padding: 0; border: 1px solid var(--hair); border-radius: 10px; overflow: hidden; background: var(--wash); cursor: pointer }
.is-hit:hover { border-color: var(--accent) }
.is-hit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.is-hit[disabled] { cursor: default }
.is-hit img { width: 100%; height: 100%; object-fit: cover; display: block }
.is-taking { position: absolute; inset: 0; display: grid; place-items: center; background: #0a0d0bb0; color: #fff; font-size: 13px }
.is-credit { margin: 5px 2px 0; font-size: 12px; color: var(--ink3); display: flex; gap: 6px; flex-wrap: nowrap; white-space: nowrap; overflow: hidden }
.is-credit > :first-child { overflow: hidden; text-overflow: ellipsis; min-width: 0 }
.is-credit > :last-child { flex: none }
.is-credit a { color: inherit; text-decoration: underline }
.is-empty { flex: 1; display: grid; place-items: center; margin: 0; color: var(--ink3); font-size: 14px; text-align: center }
.is-note { margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--hair); font-size: 12px; color: var(--ink3) }
@media (max-width: 560px) { .is-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) } }
</style>
