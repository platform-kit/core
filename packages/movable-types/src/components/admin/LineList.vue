<script setup>
/*
 * A list of one-line strings edited as rows: an input each, a grip to drag
 * them into order, remove, and add. Used for a test's statements and a
 * question's options — anywhere a markdown file holds `- ...` lines.
 */
import draggable from 'vuedraggable'
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  addLabel: { type: String, default: '+ Add line' },
  numbered: { type: Boolean, default: false },
  multiline: { type: Boolean, default: false },   /* a line that is a sentence: a field that grows with it, never truncated */
})
const fit = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
const vAutosize = { mounted: fit, updated: fit }
const emit = defineEmits(['update:modelValue'])
const rows = () => props.modelValue.map((text, i) => ({ text, i }))
function set(i, v) { const a = props.modelValue.slice(); a[i] = v; emit('update:modelValue', a) }
function remove(i) { const a = props.modelValue.slice(); a.splice(i, 1); emit('update:modelValue', a) }
function add() { emit('update:modelValue', props.modelValue.concat('')) }
function onEnd(e) { if (e.oldIndex === e.newIndex) return; const a = props.modelValue.slice(); const [m] = a.splice(e.oldIndex, 1); a.splice(e.newIndex, 0, m); emit('update:modelValue', a) }
</script>

<template>
  <div class="ll">
    <draggable :model-value="rows()" item-key="i" handle=".ll-grip" class="ll-list" ghost-class="ll-ghost" :animation="150" :force-fallback="true" :fallback-tolerance="4" @end="onEnd">
      <template #item="{ element, index }">
        <div class="ll-row">
          <button type="button" class="ll-grip" tabindex="-1" aria-label="Drag to reorder">⋮⋮</button>
          <span v-if="numbered" class="ll-n">{{ index + 1 }}</span>
          <textarea v-if="multiline" v-autosize :value="element.text" rows="1" :placeholder="placeholder" @input="fit($event.target); set(index, $event.target.value)" />
          <input v-else :value="element.text" type="text" :placeholder="placeholder" @input="set(index, $event.target.value)" />
          <button type="button" class="ll-rm" title="Remove" @click="remove(index)">×</button>
        </div>
      </template>
    </draggable>
    <button type="button" class="ll-add" @click="add">{{ addLabel }}</button>
  </div>
</template>

<style scoped>
.ll { display: flex; flex-direction: column; gap: 6px }
.ll-list { display: flex; flex-direction: column; gap: 4px }
.ll-row { display: flex; align-items: flex-start; gap: 6px }
.ll-row .ll-grip, .ll-row .ll-rm, .ll-row .ll-n { margin-top: 2px }
.ll-ghost { opacity: .4 }
.ll-grip { flex: 0 0 auto; width: 20px; font: inherit; font-size: 11px; letter-spacing: -2px; color: var(--ink3); background: none; border: 0; cursor: grab; padding: 0 }
.ll-n { flex: 0 0 22px; font-family: var(--m); font-size: 11px; color: var(--ink3); text-align: right }
.ll-row input { flex: 1; min-width: 0; font: inherit; font-size: 13px; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 0 10px; height: 32px; box-sizing: border-box }
.ll-row textarea { flex: 1; min-width: 0; font: inherit; font-size: 13px; line-height: 1.45; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 8px; padding: 6px 10px; min-height: 32px; box-sizing: border-box; resize: none }
.ll-row input:focus, .ll-row textarea:focus { outline: 2px solid var(--accent2); outline-offset: -1px; border-color: transparent }
.ll-rm { flex: 0 0 auto; width: 28px; height: 28px; font: inherit; font-size: 15px; line-height: 1; color: var(--ink3); background: none; border: 1px solid transparent; border-radius: 7px; cursor: pointer }
.ll-rm:hover { color: #b3261e; background: #b3261e0d; border-color: #b3261e44 }
.ll-add { align-self: flex-start; font: inherit; font-size: 12px; color: var(--ink3); background: none; border: 1px dashed var(--hair); border-radius: 7px; padding: 5px 10px; cursor: pointer; margin-top: 2px }
.ll-add:hover { color: var(--ink); border-color: var(--ink3) }
</style>
