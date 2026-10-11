<script setup>
import { ref } from 'vue'
import { docsCorpus, searchDocs } from '@platform-kit/kit/lib/content.js'

const props = defineProps({ collection: { type: String, required: true } })
const emit = defineEmits(['open'])

const q = ref('')
const hits = ref([])
const openList = ref(false)
let corpus = null

async function run() {
  if (!corpus) corpus = await docsCorpus(props.collection)
  hits.value = searchDocs(corpus, q.value)
  openList.value = true
}
function pick(id) { openList.value = false; q.value = ''; emit('open', id) }
</script>

<template>
  <div class="dsearch">
    <input
      v-model="q"
      type="search"
      placeholder="Search the docs"
      @input="run"
      @focus="q && run()"
      @keydown.escape="openList = false"
    />
    <div v-if="openList && q" class="dresults">
      <button v-for="h in hits" :key="h.id" type="button" class="dhit" @click="pick(h.id)">
        <span class="dhit-t">{{ h.title }}</span>
        <span class="dhit-x">{{ h.excerpt }}</span>
      </button>
      <p v-if="!hits.length" class="dnone">Nothing matches that.</p>
    </div>
  </div>
</template>

<style scoped>
.dsearch { position: relative; margin: 0 0 16px }
input { width: 100%; box-sizing: border-box; font: inherit; font-size: 13.5px; color: var(--ink);
  background: var(--wash); border: 1px solid var(--hair); border-radius: 9px; padding: 9px 12px }
input:focus { outline: none; border-color: var(--accent2) }
.dresults { position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; right: -60px;
  background: var(--card2, var(--card)); border: 1px solid var(--hair); border-radius: 12px;
  box-shadow: 0 22px 44px -20px #0c0d0b44; overflow: hidden; max-height: 330px; overflow-y: auto }
.dhit { display: block; width: 100%; text-align: left; background: none; border: 0; font: inherit;
  border-top: 1px solid var(--hair); padding: 11px 14px; cursor: pointer }
.dhit:first-child { border-top: 0 }
.dhit:hover { background: var(--wash) }
.dhit-t { display: block; font-size: 14px; font-weight: 700; color: var(--ink) }
.dhit-x { display: block; font-size: 12.5px; color: var(--ink3); line-height: 1.45; margin-top: 3px }
.dnone { font-size: 13px; color: var(--ink3); padding: 12px 14px; margin: 0 }
@media (max-width: 760px) { .dresults { right: 0 } }
</style>
