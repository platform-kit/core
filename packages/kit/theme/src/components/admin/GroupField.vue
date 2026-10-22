<script setup>
/* A group field of a content model in the drawer: its sub-fields inline, each with the control of its kind
   (ModelLeaf.vue), under a rule with the group's label; the value is one mapping in the entry's frontmatter. */
import ModelLeaf from './ModelLeaf.vue'
import { shownHolds } from 'platformkit/lib/models/entry.js'
const props = defineProps({ fields: { type: Array, default: () => [] }, modelValue: { type: Object, default: undefined }, col: { type: String, default: '' }, errors: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update:modelValue'])
/* a field of a row that only one kind of row has — "which event" on a mention is a question with no
   answer, and asking it is how a form starts teaching a grammar */
const on = (g) => !g.shown || shownHolds(g.shown, props.modelValue || {})
function setSub(key, v) { const next = { ...(props.modelValue || {}) }; if (v === undefined || v === '' || v === null) delete next[key]; else next[key] = v; emit('update:modelValue', Object.keys(next).length ? next : undefined) }
</script>

<template>
  <div class="gf">
    <div v-for="g in fields.filter(on)" :key="g.key" class="gf-f">
      <span class="gf-label">{{ g.label }}<em v-if="g.required">*</em><small v-if="g.help"> — {{ g.help }}</small></span>
      <ModelLeaf :field="g" :model-value="(modelValue || {})[g.key]" :col="col" @update:model-value="setSub(g.key, $event)" />
      <em v-if="errors[g.key]" class="ui-err gf-err">{{ errors[g.key] }}</em>
    </div>
  </div>
</template>

<style scoped>
.gf { display: flex; flex-direction: column; gap: 12px; padding: 14px 14px 12px; background: var(--wash); border: 1px solid var(--hair); border-radius: 10px }
.gf-f { display: flex; flex-direction: column; gap: 4px }
.gf-label { font-family: var(--m); font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink3) } .gf-label em { font-style: normal; color: var(--accent2); margin-left: 3px } .gf-label small { color: var(--ink3); text-transform: none; letter-spacing: 0; font-family: var(--s) }
.gf-err { font-size: 12px }
</style>
