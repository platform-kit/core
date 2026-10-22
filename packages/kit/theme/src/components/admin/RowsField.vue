<script setup>
/* A list field of a content model in the drawer: rows of one kind (ModelLeaf.vue) or of a group
   (GroupField.vue), added, dragged by a grip and removed; the value is a list in the entry's frontmatter. */
import draggable from 'vuedraggable'
import ModelLeaf from './ModelLeaf.vue'
import GroupField from './GroupField.vue'
import { us } from 'platformkit/lib/strings.js'
const props = defineProps({ field: { type: Object, required: true }, modelValue: { type: Array, default: undefined }, col: { type: String, default: '' }, errors: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update:modelValue'])
const W = (us('models').drawer || {}).entry || {}
const rows = () => (Array.isArray(props.modelValue) ? props.modelValue.map((r) => ({ v: r })) : [])
const put = (list) => emit('update:modelValue', list.length ? list.map((r) => r.v) : undefined)
function add() { put([...rows(), { v: props.field.of === 'group' ? {} : props.field.of === 'boolean' ? false : props.field.of === 'multi-select' || props.field.of === 'tags' ? [] : '' }]) }
function setRow(i, v) { const list = rows(); list[i] = { v }; put(list) }
function remove(i) { const list = rows(); list.splice(i, 1); put(list) }
function reorder(list) { put(list) }
const leaf = () => ({ kind: props.field.of, choices: props.field.choices, options: props.field.options, many: props.field.many })
</script>

<template>
  <div class="rf">
    <draggable :model-value="rows()" item-key="v" handle=".rf-grip" class="rf-rows" ghost-class="rf-ghost" :animation="150" @update:model-value="reorder">
      <template #item="{ element: r, index: i }">
        <div class="rf-row" :class="{ 'rf-group': field.of === 'group' }">
          <span class="rf-grip" aria-hidden="true">⋮⋮</span>
          <div class="rf-ctl">
            <GroupField v-if="field.of === 'group'" :fields="field.fields || []" :model-value="r.v" :col="col" :errors="errors[i] || {}" @update:model-value="setRow(i, $event || {})" />
            <ModelLeaf v-else :field="leaf()" :model-value="r.v" :col="col" @update:model-value="setRow(i, $event)" />
            <em v-if="typeof errors[i] === 'string'" class="ui-err rf-err">{{ errors[i] }}</em>
          </div>
          <button type="button" class="ui-iconbtn" :title="W['remove-row']" @click="remove(i)">×</button>
        </div>
      </template>
    </draggable>
    <p v-if="!rows().length" class="ui-hint rf-none">{{ W['no-rows'] }}</p>
    <button type="button" class="ui-btn ui-ghost ui-sm" @click="add">{{ W['add-row'] }}</button>
  </div>
</template>

<style scoped>
.rf { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; width: 100% }
.rf-rows { display: flex; flex-direction: column; gap: 6px; width: 100% }
.rf-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: start; width: 100%; padding: 8px 6px 8px 4px; border: 1px solid var(--hair); border-radius: 10px; background: var(--card) }
.rf-group { padding: 6px 6px 6px 4px }
.rf-group :deep(.gf) { border: 0; background: none; padding: 4px 6px 2px }
.rf-grip { color: var(--ink3); font-size: 11px; letter-spacing: -2px; cursor: grab; padding-top: 10px }
.rf-ctl { min-width: 0; display: flex; flex-direction: column; gap: 4px }
.rf-ghost { opacity: .4 }
.rf-none { margin: 0 }
.rf-err { font-size: 12px }
</style>
