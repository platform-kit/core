<script setup>
/* a rating: `outof` stars (or hearts), the chosen one and every one before it lit */
import { computed, ref } from 'vue'
import FmLabel from './FmLabel.vue'
const props = defineProps({ field: { type: Object, required: true }, modelValue: { default: null }, ctx: { type: Object, default: () => ({}) }, words: { type: Object, default: () => ({}) }, error: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'enter'])
const p = computed(() => props.field.params || {})
const n = computed(() => Number(p.value.outof) || 5)
const hover = ref(0)
const value = computed(() => Number(props.modelValue) || 0)
const lit = (i) => i <= (hover.value || value.value)
const heart = computed(() => p.value.icon === 'heart' || p.value.icon === 'hearts')
function pick(i) { if (p.value.disabled !== undefined) return; emit('update:modelValue', i); emit('enter', 'pick') }
</script>

<template>
  <div class="ff ff-rating" :class="{ 'ff-err': error, 'ff-nolabels': p.hidelabels !== undefined }">
    <FmLabel :field="field" :ctx="ctx" :words="words" tag="div" />
    <div class="ff-stars" role="radiogroup" @mouseleave="hover = 0">
      <button v-for="i in n" :key="i" type="button" class="ff-star" :class="{ lit: lit(i), heart }" role="radio" :aria-checked="value === i" :aria-label="i + ' ' + (i === 1 ? words['star-singular'] : words['star-plural'])" :disabled="p.disabled !== undefined" @mouseenter="hover = i" @click="pick(i)">
        <svg v-if="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h1C12.2 6.1 13.6 5 15.6 5 19 5 21.1 8.5 19.6 11.8 17.5 16.4 12 21 12 21z"/></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>
      </button>
    </div>
    <p v-if="p.hidelabels === undefined && value" class="ff-hint">{{ value }} {{ value === 1 ? words['star-singular'] : words['star-plural'] }}</p>
    <p v-if="error" class="ff-msg" role="alert">{{ error }}</p>
  </div>
</template>
