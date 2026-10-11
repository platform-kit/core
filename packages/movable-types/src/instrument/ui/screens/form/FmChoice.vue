<script setup>
/* a choice input and a picture choice: one of the choices, or several with `multiple`; a picture
   choice shows each choice's image over its label; `horizontal` lays them in a row, `supersize`
   makes them large; the number keys pick as they do on every screen of the runner */
import { computed } from 'vue'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object, required: true }, modelValue: { default: null }, ctx: { type: Object, default: () => ({}) }, words: { type: Object, default: () => ({}) }, error: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = computed(() => props.field.params || {})
const multiple = computed(() => p.value.multiple !== undefined)
const picture = computed(() => props.field.kind === 'picture')
const chosen = computed(() => (multiple.value ? (Array.isArray(props.modelValue) ? props.modelValue : []) : props.modelValue == null ? '' : String(props.modelValue)))
const isOn = (v) => (multiple.value ? chosen.value.includes(v) : chosen.value === v)
function pick(v) {
  if (p.value.disabled !== undefined) return
  if (multiple.value) { const cur = [...chosen.value]; const i = cur.indexOf(v); if (i >= 0) cur.splice(i, 1); else cur.push(v); emit('update:modelValue', cur) }
  else { emit('update:modelValue', v); emit('enter', 'pick') }
}
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
</script>

<template>
  <div class="ff" :class="[picture ? 'ff-picture' : 'ff-choice', { 'ff-err': error, 'ff-horizontal': p.horizontal !== undefined, 'ff-super': p.supersize !== undefined, 'ff-nolabels': p.hidelabels !== undefined }]">
    <FmLabel :field="field" :ctx="ctx" :words="words" tag="div" />
    <p v-if="multiple && p.hideformtext === undefined" class="ff-hint">{{ words['choose-many'] }}</p>
    <div class="ff-choices" :role="multiple ? 'group' : 'radiogroup'">
      <button v-for="(c, n) in p.choices" :key="c.value" type="button" class="qopt ff-opt" :class="{ on: isOn(c.value) }" :role="multiple ? 'checkbox' : 'radio'" :aria-checked="isOn(c.value)" :disabled="p.disabled !== undefined" @click="pick(c.value)">
        <img v-if="picture && c.image" class="ff-pic" :src="c.image" alt="" loading="lazy" />
        <span class="k">{{ letters[n] || n + 1 }}</span>
        <span v-if="!(picture && p.hidelabels !== undefined)" class="qoptl">{{ c.label }}</span>
        <span v-if="multiple" class="ff-tick" aria-hidden="true">✓</span>
      </button>
    </div>
    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
  </div>
</template>
