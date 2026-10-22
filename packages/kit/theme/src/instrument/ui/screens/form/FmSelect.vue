<script setup>
/* a select box: the options as forms.md lists them ("value" label), a placeholder, one selected */
import { computed, ref, onMounted } from 'vue'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object, required: true }, modelValue: { default: '' }, ctx: { type: Object, default: () => ({}) }, words: { type: Object, default: () => ({}) }, error: { type: String, default: '' }, autofocus: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = computed(() => props.field.params || {})
const id = computed(() => 'f_' + props.field.name)
const input = ref(null)
onMounted(() => { if (props.autofocus && input.value) setTimeout(() => input.value.focus(), 60) })
</script>

<template>
  <div class="ff ff-select" :class="{ 'ff-err': error }">
    <FmLabel :field="field" :ctx="ctx" :words="words" :id="id" />
    <select ref="input" :id="id" :value="modelValue" class="qwordin ff-in" :disabled="p.disabled !== undefined" @change="(e) => emit('update:modelValue', e.target.value)" @keydown.enter.prevent="emit('enter')">
      <option value="" disabled>{{ p.placeholder || words['select-placeholder'] }}</option>
      <option v-for="o in p.options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
  </div>
</template>
