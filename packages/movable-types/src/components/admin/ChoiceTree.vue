<script setup>
/*
 * A prompt's choices as a tree, edited as rows: each a line of words, ↑ ↓ to reorder among its
 * siblings, × to remove it (and what is under it), and "+ Follow-up" to add a choice the reader
 * is offered next, indented under it. The component nests itself for the children; the parent
 * writes the tree back into the file's list (joinChoices) — nobody types the indentation.
 */
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  depth: { type: Number, default: 0 },
  max: { type: Number, default: 3 },
})
const emit = defineEmits(['update:modelValue'])
const node = (text) => ({ key: '', text, children: [] })
const put = (list) => emit('update:modelValue', list)
const list = () => props.modelValue.map((c) => ({ ...c, children: (c.children || []).slice() }))
function edit(i, text) { const l = list(); l[i].text = text; put(l) }
function add() { put(list().concat([node('New choice')])) }
function addUnder(i) { const l = list(); l[i].children = l[i].children.concat([node('New follow-up')]); put(l) }
function drop(i) { put(list().filter((_, j) => j !== i)) }
function move(i, d) { const l = list(); const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; put(l) }
function children(i, kids) { const l = list(); l[i].children = kids; put(l) }
</script>

<template>
  <div class="ct" :class="{ nested: depth > 0 }">
    <div v-for="(c, i) in modelValue" :key="i" class="ct-node">
      <div class="ct-row">
        <span v-if="depth > 0" class="ct-elbow" aria-hidden="true" />
        <input :value="c.text" class="ui-input" :placeholder="depth ? 'A follow-up the reader may pick' : 'A choice the reader may pick'" @input="edit(i, $event.target.value)" />
        <button type="button" class="ui-btn ui-ghost ui-sm" :disabled="i === 0" title="Earlier" @click="move(i, -1)">↑</button>
        <button type="button" class="ui-btn ui-ghost ui-sm" :disabled="i >= modelValue.length - 1" title="Later" @click="move(i, 1)">↓</button>
        <button v-if="depth < max - 1" type="button" class="ui-btn ui-ghost ui-sm ct-sub" title="A choice offered after this one" @click="addUnder(i)">+ Follow-up</button>
        <button type="button" class="ui-btn ui-ghost ui-danger ui-sm" title="Remove, and everything under it" @click="drop(i)">×</button>
      </div>
      <ChoiceTree v-if="c.children && c.children.length" :model-value="c.children" :depth="depth + 1" :max="max" @update:model-value="children(i, $event)" />
    </div>
    <button v-if="depth === 0" type="button" class="ui-btn ui-ghost ui-sm ct-add" @click="add">+ Add a choice</button>
  </div>
</template>

<style scoped>
.ct { display: flex; flex-direction: column; gap: 6px }
.ct.nested { margin: 4px 0 2px 26px; padding-left: 12px; border-left: 2px solid var(--hair) }
.ct-node { display: flex; flex-direction: column; gap: 6px }
.ct-row { display: flex; align-items: center; gap: 6px }
.ct-row .ui-input { flex: 1; min-width: 0 }
.ct-elbow { width: 10px; height: 10px; flex: none; border-left: 2px solid var(--hair); border-bottom: 2px solid var(--hair); border-bottom-left-radius: 6px; margin: -8px 0 0 -14px }
.ct-sub { white-space: nowrap }
.ct-add { align-self: flex-start; margin-top: 2px }
</style>
