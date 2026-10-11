<script setup>
/* status-bar: the chosen file's name and served address with Copy the address; nothing when nothing is chosen */
import { ref, computed } from 'vue'
import { CopyIcon, CheckIcon } from 'lucide-vue-next'
import { useMedia } from './use-media.js'
const { selection, usedBy, W } = useMedia()
const B = W.bar, F = W.file
const fill = (t, m) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
/* the records that name the chosen file: the count, the titles on hover */
const used = computed(() => usedBy(one.value))
const usedLine = computed(() => (used.value.length === 1 ? F['used-by-one'] : fill(F['used-by'], { n: used.value.length })))
const usedTitles = computed(() => used.value.map((r) => r.title).join('\n'))
const one = computed(() => (selection.value.length === 1 && selection.value[0].type !== 'dir' ? selection.value[0] : null))
const copied = ref(false)
async function copy() { if (!one.value || !one.value.url) return; try { await navigator.clipboard.writeText(one.value.url); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch (e) { /* no clipboard */ } }
</script>

<template>
  <div v-if="one" class="mr-status">
    <span class="mr-status-name">{{ one.basename }}</span>
    <span v-if="used.length" class="mr-status-used" :title="usedTitles">{{ usedLine }}</span>
    <code class="mr-status-url">{{ one.url }}</code>
    <button type="button" class="ui-btn ui-ghost ui-sm" @click="copy"><component :is="copied ? CheckIcon : CopyIcon" :size="13" />{{ copied ? F.copied : B['copy-address'] }}</button>
  </div>
</template>
