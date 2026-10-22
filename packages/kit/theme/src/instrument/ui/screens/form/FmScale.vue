<script setup>
/* an opinion scale (NPS): the numbers from `startat` to `outof` in a row, a label at each end */
import { computed } from 'vue'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object, required: true }, modelValue: { default: null }, ctx: { type: Object, default: () => ({}) }, words: { type: Object, default: () => ({}) }, error: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = computed(() => props.field.params || {})
const start = computed(() => Number(p.value.startat ?? 0))
const end = computed(() => Number(p.value.outof) || 10)
const steps = computed(() => { const a = []; for (let i = start.value; i <= end.value; i++) a.push(i); return a })
const value = computed(() => (props.modelValue == null || props.modelValue === '' ? null : Number(props.modelValue)))
const labelStart = computed(() => (p.value.labelstart !== undefined ? p.value.labelstart : props.words['nps-label-start']))
const labelEnd = computed(() => (p.value.labelend !== undefined ? p.value.labelend : props.words['nps-label-end']))
function pick(i) { if (p.value.disabled !== undefined) return; emit('update:modelValue', i); emit('enter', 'pick') }
</script>

<template>
  <div class="ff ff-scale" :class="{ 'ff-err': error }">
    <FmLabel :field="field" :ctx="ctx" :words="words" tag="div" />
    <div class="ff-steps" role="radiogroup">
      <button v-for="i in steps" :key="i" type="button" class="ff-step" :class="{ on: value === i }" role="radio" :aria-checked="value === i" :disabled="p.disabled !== undefined" @click="pick(i)">{{ i }}</button>
    </div>
    <div v-if="labelStart || labelEnd" class="ff-ends"><span>{{ labelStart }}</span><span>{{ labelEnd }}</span></div>
    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
  </div>
</template>
