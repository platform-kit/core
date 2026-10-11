<script setup>
/* A choice with an "other" — the last option opens a line to write in, the way a
   Typeform "other" does. The number keys pick as on any choice screen; on "other"
   the line takes focus and Enter sends it. The answer is the option's value, with
   the written text alongside for "other". */
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import ScreenHead from './ScreenHead.vue'
const props = defineProps({ screen: { type: Object, required: true } })
const emit = defineEmits(['answer'])
const other = ref(false), text = ref(''), input = ref(null)
function pick(o) {
  if (o.other) { other.value = true; nextTick(() => { const el = Array.isArray(input.value) ? input.value[0] : input.value; el && el.focus() }); return }
  emit('answer', o.v, {})
}
function sendOther() { const t = text.value.trim(); if (t) emit('answer', 'other', { text: t }) }
/* the number keys, as on any choice screen — unless the line is being written in */
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return
  const n = +e.key; const o = (props.screen.options || [])[n - 1]
  if (n >= 1 && o) { e.preventDefault(); pick(o) }   /* the digit must not land in the line it opens */
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="qzin qpick">
    <ScreenHead :eyebrow="screen.eyebrow" :headline="screen.headline" :sub="screen.sub" />
    <div class="qopts">
      <template v-for="(o, n) in screen.options || []" :key="o.v">
        <button v-if="!(o.other && other)" type="button" class="qopt" @click="pick(o)">
          <span class="k">{{ n + 1 }}</span>
          <span class="qoptl">{{ o.label }}</span>
        </button>
        <div v-else class="qpick-other">
          <span class="k">{{ n + 1 }}</span>
          <input ref="input" v-model="text" class="qwordin qpick-in" autocomplete="off" :placeholder="screen.placeholder" :aria-label="o.label" @keydown.enter.prevent="sendOther" />
          <button type="button" class="qbtn" :disabled="!text.trim()" @click="sendOther">{{ screen.submit }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.qpick-other { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 6px 0 0 14px }
.qpick-other .k { font-family: var(--m, ui-monospace, Menlo, monospace); font-size: 11px; width: 20px; height: 20px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--qhair); color: var(--qink3) }
.qz .qpick-in { margin: 0; width: 100% }
.qbtn:disabled { opacity: .35; cursor: default }
</style>
