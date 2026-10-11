<script setup>
/* A condition as rows — a field, a comparison, a value — never as the expression it becomes
   (src/lib/forms/condition.js writes that). A condition written by hand that rows cannot say is
   shown as it is, and can only be cleared. */
import { computed } from 'vue'
import { rowsOf, exprOf, OPS } from '@platform-kit/kit/lib/forms/condition.js'
import { us } from '@platform-kit/kit/lib/strings.js'
const props = defineProps({ modelValue: { type: String, default: '' }, fields: { type: Array, default: () => [] }, label: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const W = (us('forms').admin || {}).condition || {}
const rows = computed(() => rowsOf(props.modelValue))
const custom = computed(() => rows.value === null)
function set(list) { emit('update:modelValue', exprOf(list)) }
function change(i, k, v) { const list = rows.value.map((r) => ({ ...r })); list[i][k] = v; if (k === 'op' && (v === 'set' || v === 'unset')) list[i].value = ''; set(list) }
function add() { set([...(rows.value || []), { field: (props.fields[0] && props.fields[0].name) || '', op: 'is', value: '' }]) }
function remove(i) { const list = rows.value.slice(); list.splice(i, 1); set(list) }
const needsValue = (op) => op !== 'set' && op !== 'unset'
/* a field by its question (a block's params, or a compiled field's own), else its name */
const label_ = (f) => { const q = f.question || (f.params && f.params.question); return q && q !== '...' ? q : f.name }
</script>

<template>
  <div class="ce">
    <span v-if="label" class="ce-label">{{ label }}</span>
    <p v-if="custom" class="ce-custom"><code>{{ W.custom.replace('{cond}', modelValue) }}</code> <button type="button" class="ui-btn ui-ghost ui-sm" @click="emit('update:modelValue', '')">{{ W.clear }}</button></p>
    <template v-else>
      <p v-if="!rows.length" class="ui-hint ce-none">{{ W.none }}</p>
      <div v-for="(r, i) in rows" :key="i" class="ce-row">
        <select class="ui-select" :value="r.field" :aria-label="W.field" @change="change(i, 'field', $event.target.value)">
          <option v-for="f in fields" :key="f.name" :value="f.name">{{ label_(f) }}</option>
          <option v-if="!fields.some((f) => f.name === r.field)" :value="r.field">{{ r.field }}</option>
        </select>
        <select class="ui-select ce-op" :value="r.op" :aria-label="W.op" @change="change(i, 'op', $event.target.value)">
          <option v-for="o in OPS" :key="o" :value="o">{{ W[o] }}</option>
        </select>
        <input v-if="needsValue(r.op)" class="ui-input" :value="r.value" :aria-label="W.value" @input="change(i, 'value', $event.target.value)" />
        <button type="button" class="ui-iconbtn" title="Remove" @click="remove(i)">×</button>
      </div>
      <button type="button" class="ui-btn ui-ghost ui-sm ce-add" @click="add">{{ W.add }}</button>
    </template>
  </div>
</template>

<style scoped>
.ce { display: flex; flex-direction: column; gap: 6px }
.ce-label { font-size: 12px; font-weight: 600; color: var(--ink2) }
.ce-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; align-items: center }
.ce-op { min-width: 0 }
.ce-add { align-self: flex-start }
.ce-none { margin: 0 }
.ce-custom { margin: 0; font-size: 13px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap } .ce-custom code { font-size: 12px }
</style>
